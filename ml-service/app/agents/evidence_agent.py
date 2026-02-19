"""
Evidence Builder Agent — LLM-powered agent that builds bounded evidence packs
for each candidate, selecting the most relevant chunks and generating highlights.
"""

import logging
import time
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from . import config as cfg
from .state import AgentState, EvidencePack, EvidenceItem

log = logging.getLogger(__name__)

HIGHLIGHT_PROMPT = """You are an evidence analyst for a recruitment platform.
Given a candidate's resume chunks and the job requirements, generate 3 concise highlight sentences (each under 100 characters).

Each highlight should explain WHY this candidate matches a specific requirement.
Format: one highlight per line, no bullets or numbers.

Requirements (must-have): {must_have}
Requirements (nice-to-have): {nice_to_have}

Candidate evidence:
{evidence_text}

Return exactly 3 highlight lines:"""


async def evidence_agent_node(state: AgentState, writer):
    """LangGraph node: Evidence Builder Agent."""
    start = time.time()
    fused = state.get("fused_candidates", [])
    mission_spec = state.get("mission_spec", {})
    sparse_results = state.get("sparse_results", [])
    dense_results = state.get("dense_results", [])

    # Only build evidence for top K_RERANK candidates
    top_candidates = fused[:cfg.K_RERANK]

    writer({"event": "agent_start", "agent": "Evidence Builder", "stage": 4,
            "message": f"📋 Building evidence packs for top {len(top_candidates)} candidates..."})

    # Index chunks by candidate from retrieval results
    sparse_by_candidate = _group_by_candidate(sparse_results)
    dense_by_candidate = _group_by_candidate(dense_results)

    evidence_packs = {}
    batch_size = 10
    for batch_idx in range(0, len(top_candidates), batch_size):
        batch = top_candidates[batch_idx:batch_idx + batch_size]

        if batch_idx > 0:
            writer({"event": "agent_thought", "agent": "Evidence Builder",
                    "message": f"📋 Processing candidates {batch_idx + 1}-{min(batch_idx + batch_size, len(top_candidates))}..."})

        for candidate in batch:
            cid = candidate["candidate_id"]
            sparse_chunks = sparse_by_candidate.get(cid, [])
            dense_chunks = dense_by_candidate.get(cid, [])

            evidence_pack = _build_evidence_for_candidate(
                cid, sparse_chunks, dense_chunks
            )
            evidence_packs[cid] = evidence_pack.model_dump()

    writer({"event": "agent_thought", "agent": "Evidence Builder",
            "message": f"✨ Built evidence packs for {len(evidence_packs)} candidates. Generating highlights with AI..."})

    # Generate highlights for top candidates using LLM
    llm = ChatOpenAI(
        model=cfg.OPENAI_MODEL,
        temperature=0.3,
        api_key=cfg.OPENAI_API_KEY,
    )

    # Only generate AI highlights for top 20
    top_for_highlights = list(evidence_packs.keys())[:20]
    must_have_str = ", ".join(mission_spec.get("must_have", []))
    nice_to_have_str = ", ".join(mission_spec.get("nice_to_have", []))

    highlights_generated = 0
    for cid in top_for_highlights:
        pack = evidence_packs[cid]
        evidence_text = "\n".join(
            "[{}] {}".format(e.get("section", ""), e.get("text_snippet", "")) for e in pack.get("evidence", [])
        )
        if not evidence_text:
            continue

        try:
            writer({"event": "tool_call", "agent": "Evidence Builder", "tool": "generate_highlights",
                    "message": f"🔧 Generating AI highlights for candidate {cid[:8]}..."})

            response = await llm.ainvoke([
                SystemMessage(content=HIGHLIGHT_PROMPT.format(
                    must_have=must_have_str or "general match",
                    nice_to_have=nice_to_have_str or "none specified",
                    evidence_text=evidence_text[:2000],
                )),
            ])

            highlights = [
                line.strip() for line in response.content.strip().split("\n")
                if line.strip() and len(line.strip()) > 5
            ][:3]

            pack["highlights"] = highlights
            highlights_generated += 1
        except Exception as e:
            log.warning(f"Failed to generate highlights for {cid}: {e}")
            # Fallback: use first evidence snippet
            pack["highlights"] = [
                e["text_snippet"][:100] for e in pack.get("evidence", [])[:3]
            ]

    elapsed = time.time() - start
    writer({"event": "stage_complete", "stage": "evidence_building", "timing_ms": round(elapsed * 1000),
            "message": f"✅ Evidence built: {len(evidence_packs)} packs, {highlights_generated} AI highlights "
                       f"({round(elapsed * 1000)}ms)"})

    return {
        "evidence_packs": evidence_packs,
        "current_agent": "evidence_builder",
        "stage_timings": {**state.get("stage_timings", {}), "evidence_building": elapsed},
    }


def _group_by_candidate(results: list[dict]) -> dict[str, list[dict]]:
    """Group retrieval results by candidate_id."""
    grouped = {}
    for r in results:
        cid = r.get("candidate_id", "")
        if cid not in grouped:
            grouped[cid] = []
        grouped[cid].append(r)
    return grouped


def _build_evidence_for_candidate(
    candidate_id: str,
    sparse_chunks: list[dict],
    dense_chunks: list[dict],
) -> EvidencePack:
    """Build a bounded evidence pack for a single candidate."""
    # Merge and deduplicate chunks
    seen_chunks = set()
    all_evidence = []

    for chunk in sparse_chunks:
        chunk_id = chunk.get("chunk_id", "")
        if chunk_id not in seen_chunks:
            seen_chunks.add(chunk_id)
            all_evidence.append(EvidenceItem(
                chunk_id=chunk_id,
                section=chunk.get("section_type", ""),
                text_snippet=chunk.get("chunk_text", "")[:cfg.MAX_CHARS_PER_CHUNK],
                why_matched="sparse",
            ))

    for chunk in dense_chunks:
        chunk_id = chunk.get("chunk_id", "")
        if chunk_id in seen_chunks:
            # Mark as both
            for e in all_evidence:
                if e.chunk_id == chunk_id:
                    e.why_matched = "both"
                    break
        else:
            seen_chunks.add(chunk_id)
            all_evidence.append(EvidenceItem(
                chunk_id=chunk_id,
                section=chunk.get("section_type", ""),
                text_snippet=chunk.get("chunk_text", "")[:cfg.MAX_CHARS_PER_CHUNK],
                why_matched="dense",
            ))

    # Sort by relevance (prefer "both", then by text length as a heuristic)
    match_order = {"both": 0, "sparse": 1, "dense": 2}
    all_evidence.sort(key=lambda e: (match_order.get(e.why_matched, 3), -len(e.text_snippet)))

    # Apply bounds
    bounded = []
    total_chars = 0
    for e in all_evidence:
        if len(bounded) >= cfg.MAX_CHUNKS_PER_CANDIDATE:
            break
        if total_chars + len(e.text_snippet) > cfg.MAX_TOTAL_CHARS_PER_CANDIDATE:
            # Truncate this snippet to fit
            remaining = cfg.MAX_TOTAL_CHARS_PER_CANDIDATE - total_chars
            if remaining > 50:
                e.text_snippet = e.text_snippet[:remaining] + "..."
                bounded.append(e)
            break
        total_chars += len(e.text_snippet)
        bounded.append(e)

    return EvidencePack(
        candidate_id=candidate_id,
        evidence=bounded,
        highlights=[e.text_snippet[:100] for e in bounded[:3]],  # Fallback highlights
    )
