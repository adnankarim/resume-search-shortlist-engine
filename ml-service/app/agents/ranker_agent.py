"""
Ranker Agent — uses cross-encoder reranking + final score computation.
Calls the cross-encoder model and computes weighted final scores.
"""

import logging
import time

from . import config as cfg
from .state import AgentState
from .tools import cross_encoder_rerank, fetch_candidate_profiles

log = logging.getLogger(__name__)


async def ranker_agent_node(state: AgentState, writer):
    """LangGraph node: Ranker Agent."""
    start = time.time()
    fused = state.get("fused_candidates", [])
    evidence_packs = state.get("evidence_packs", {})
    mission_spec = state.get("mission_spec", {})

    # Only rerank top K_RERANK
    top_candidates = fused[:cfg.K_RERANK]

    writer({"event": "agent_start", "agent": "Ranker", "stage": 5,
            "message": f"🏆 Reranking top {len(top_candidates)} candidates using cross-encoder AI model..."})

    # Build query text from mission spec
    must_have = mission_spec.get("must_have", [])
    nice_to_have = mission_spec.get("nice_to_have", [])
    raw_query = mission_spec.get("raw_query", "")
    query_text = raw_query if raw_query else f"Skills: {'; '.join(must_have + nice_to_have)}."

    # Build rerank payload
    rerank_input = []
    for candidate in top_candidates:
        cid = candidate["candidate_id"]
        pack = evidence_packs.get(cid, {})
        evidence_items = pack.get("evidence", [])
        # Concatenate evidence text for reranking
        evidence_text = " | ".join([e.get("text_snippet", "") for e in evidence_items])
        if not evidence_text:
            evidence_text = f"Skills: {', '.join(candidate.get('matched_skills', []))}"
        rerank_input.append({
            "candidate_id": cid,
            "text": evidence_text,
        })

    # Call cross-encoder
    rerank_scores = {}
    if rerank_input:
        writer({"event": "tool_call", "agent": "Ranker", "tool": "cross_encoder_rerank",
                "message": f"🔧 Running cross-encoder model on {len(rerank_input)} candidates..."})

        try:
            results = cross_encoder_rerank.invoke({
                "query": query_text,
                "candidates": rerank_input,
            })

            for r in results:
                rerank_scores[r["candidate_id"]] = r["score"]

            scores_list = [r["score"] for r in results]
            writer({"event": "tool_result", "agent": "Ranker", "tool": "cross_encoder_rerank",
                    "message": f"📊 Cross-encoder scored {len(results)} candidates "
                               f"(score range: {min(scores_list):.3f} to "
                               f"{max(scores_list):.3f})"})
        except Exception as e:
            log.warning(f"Cross-encoder reranking failed: {e}")
            writer({"event": "agent_thought", "agent": "Ranker",
                    "message": f"⚠️ Cross-encoder failed ({str(e)[:50]}), using RRF scores only"})
            for candidate in top_candidates:
                rerank_scores[candidate["candidate_id"]] = 0.0

    # Compute final scores
    writer({"event": "agent_thought", "agent": "Ranker",
            "message": f"📐 Computing final scores (RRF weight: {cfg.W_RRF}, CE weight: {cfg.W_CE})..."})

    # Normalize scores
    rrf_scores = {c["candidate_id"]: c["rrf_score"] for c in top_candidates}
    rrf_max = max(rrf_scores.values()) if rrf_scores else 1.0
    ce_scores = rerank_scores
    ce_values = [v for v in ce_scores.values() if v != 0.0]
    ce_max = max(ce_values) if ce_values else 1.0
    ce_min = min(ce_values) if ce_values else 0.0
    ce_range = ce_max - ce_min if ce_max != ce_min else 1.0

    final_results_raw = []
    for candidate in top_candidates:
        cid = candidate["candidate_id"]
        rrf_norm = (rrf_scores.get(cid, 0) / rrf_max) if rrf_max > 0 else 0
        ce_raw = ce_scores.get(cid, 0)
        ce_norm = (ce_raw - ce_min) / ce_range if ce_range > 0 else 0

        final_score = cfg.W_RRF * rrf_norm + cfg.W_CE * ce_norm
        # Scale to 0-100
        final_score_pct = round(final_score * 100, 1)

        final_results_raw.append({
            "candidate_id": cid,
            "final_score": final_score_pct,
            "rrf_score": round(rrf_scores.get(cid, 0), 6),
            "rerank_score": round(ce_raw, 4),
            "dense_rank": candidate.get("dense_rank"),
            "sparse_rank": candidate.get("sparse_rank"),
            "matched_skills": candidate.get("matched_skills", []),
            "matched_count": candidate.get("matched_count", 0),
        })

    # Sort by final score
    final_results_raw.sort(key=lambda x: x["final_score"], reverse=True)

    elapsed = time.time() - start
    top3 = final_results_raw[:3]
    top3_scores = ", ".join(f"{r['final_score']}%" for r in top3)
    writer({"event": "stage_complete", "stage": "ranking", "timing_ms": round(elapsed * 1000),
            "message": f"✅ Ranking complete: top scores = {top3_scores} "
                       f"({round(elapsed * 1000)}ms)"})

    return {
        "rerank_scores": rerank_scores,
        "final_results": final_results_raw,
        "current_agent": "ranker",
        "stage_timings": {**state.get("stage_timings", {}), "ranking": elapsed},
    }
