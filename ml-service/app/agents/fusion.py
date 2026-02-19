"""
Fusion Node — deterministic Reciprocal Rank Fusion (no LLM).
Merges sparse + dense retrieval results into a unified ranked list.
"""

import logging
import time

from . import config as cfg
from .state import AgentState

log = logging.getLogger(__name__)


def _aggregate_to_resume_ranks(results: list[dict]) -> dict[str, int]:
    """Aggregate chunk-level results to resume-level, keeping best rank per resume."""
    resume_ranks = {}
    for r in results:
        cid = r.get("candidate_id", "")
        rank = r.get("rank", 999)
        if cid not in resume_ranks or rank < resume_ranks[cid]:
            resume_ranks[cid] = rank
    return resume_ranks


async def fusion_node(state: AgentState, writer):
    """LangGraph node: RRF Fusion."""
    start = time.time()

    writer({"event": "agent_start", "agent": "Fusion", "stage": 3,
            "message": "🔀 Fusing lexical + vector results using Reciprocal Rank Fusion..."})

    sparse_results = state.get("sparse_results", [])
    dense_results = state.get("dense_results", [])
    k = cfg.RRF_K

    # Aggregate to resume level
    sparse_ranks = _aggregate_to_resume_ranks(sparse_results)
    dense_ranks = _aggregate_to_resume_ranks(dense_results)

    # Collect all candidate IDs
    all_ids = set(sparse_ranks.keys()) | set(dense_ranks.keys())

    writer({"event": "agent_thought", "agent": "Fusion",
            "message": f"📊 Fusing {len(sparse_ranks)} lexical candidates + {len(dense_ranks)} vector candidates "
                       f"= {len(all_ids)} unique candidates (k={k})"})

    # Compute RRF scores
    fused = []
    for cid in all_ids:
        rrf_score = 0.0
        sr = sparse_ranks.get(cid)
        dr = dense_ranks.get(cid)

        if sr is not None:
            rrf_score += 1.0 / (k + sr)
        if dr is not None:
            rrf_score += 1.0 / (k + dr)

        # Collect matched_skills from sparse results
        matched_skills = []
        for r in sparse_results:
            if r.get("candidate_id") == cid:
                matched_skills = r.get("matched_skills", [])
                break

        fused.append({
            "candidate_id": cid,
            "rrf_score": rrf_score,
            "dense_rank": dr,
            "sparse_rank": sr,
            "matched_skills": matched_skills,
            "matched_count": len(matched_skills),
        })

    # Sort by RRF score and cap
    fused.sort(key=lambda x: x["rrf_score"], reverse=True)
    fused = fused[:cfg.K_POOL]

    # Stats
    both_count = len(set(sparse_ranks.keys()) & set(dense_ranks.keys()))
    sparse_only = len(set(sparse_ranks.keys()) - set(dense_ranks.keys()))
    dense_only = len(set(dense_ranks.keys()) - set(sparse_ranks.keys()))

    elapsed = time.time() - start
    writer({"event": "stage_complete", "stage": "fusion", "timing_ms": round(elapsed * 1000),
            "message": f"✅ Fusion complete: {len(fused)} candidates ranked "
                       f"(both: {both_count}, lexical-only: {sparse_only}, vector-only: {dense_only}) "
                       f"({round(elapsed * 1000)}ms)"})

    return {
        "fused_candidates": fused,
        "current_agent": "fusion",
        "stage_timings": {**state.get("stage_timings", {}), "fusion": elapsed},
    }
