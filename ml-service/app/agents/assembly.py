"""
Assembly Node — final step that enriches results with profile data
and builds the ShortlistResponse.
"""

import logging
import time

from . import config as cfg
from .state import (
    AgentState,
    ShortlistResult,
    ShortlistResponse,
    ScoreBreakdown,
    EvidencePack,
    MissionSpec,
)
from .tools import fetch_candidate_profiles

log = logging.getLogger(__name__)


async def assembly_node(state: AgentState, writer):
    """LangGraph node: Assembly — builds final ShortlistResponse."""
    start = time.time()
    final_results_raw = state.get("final_results", [])
    evidence_packs = state.get("evidence_packs", {})
    mission_spec_dict = state.get("mission_spec", {})
    request_id = state.get("request_id", "")

    writer({"event": "agent_start", "agent": "Assembly", "stage": 6,
            "message": f"📦 Assembling final shortlist with {len(final_results_raw)} candidates..."})

    # Fetch profile data for enrichment
    candidate_ids = [r["candidate_id"] for r in final_results_raw[:50]]  # Top 50 max

    writer({"event": "tool_call", "agent": "Assembly", "tool": "fetch_candidate_profiles",
            "message": f"🔧 Enriching {len(candidate_ids)} candidates with profile data..."})

    profiles = fetch_candidate_profiles.invoke({"candidate_ids": candidate_ids})
    profile_map = {p["candidate_id"]: p for p in profiles}

    writer({"event": "tool_result", "agent": "Assembly", "tool": "fetch_candidate_profiles",
            "message": f"📊 Loaded {len(profiles)} candidate profiles"})

    # Build ShortlistResult for each candidate
    results = []
    for r in final_results_raw[:50]:
        cid = r["candidate_id"]
        profile = profile_map.get(cid, {})
        pack_dict = evidence_packs.get(cid, {"candidate_id": cid, "evidence": [], "highlights": []})

        result = ShortlistResult(
            candidate_id=cid,
            final_score=r["final_score"],
            score_breakdown=ScoreBreakdown(
                rrf_score=r.get("rrf_score", 0),
                rerank_score=r.get("rerank_score", 0),
                dense_rank=r.get("dense_rank"),
                sparse_rank=r.get("sparse_rank"),
            ),
            evidence_pack=EvidencePack(**pack_dict) if isinstance(pack_dict, dict) else pack_dict,
            highlights=pack_dict.get("highlights", []),
            headline=profile.get("headline", "No title available"),
            total_yoe=profile.get("total_yoe", 0),
            location_country=profile.get("location_country", ""),
            location_city=profile.get("location_city", ""),
            summary=profile.get("summary", ""),
            matched_skills=r.get("matched_skills", []),
        )
        results.append(result.model_dump())

    # Build MissionSpec clarifications as suggested refinements
    mission_spec = MissionSpec(**mission_spec_dict) if mission_spec_dict else MissionSpec()
    suggested_refinements = mission_spec.clarifications

    # Build response
    response = ShortlistResponse(
        request_id=request_id,
        mission_spec=mission_spec,
        results=results,
        suggested_refinements=suggested_refinements,
        stage_timings=state.get("stage_timings", {}),
        total_candidates_found=len(final_results_raw),
    )

    elapsed = time.time() - start

    writer({"event": "stage_complete", "stage": "assembly", "timing_ms": round(elapsed * 1000),
            "message": f"✅ Shortlist assembled: {len(results)} candidates returned ({round(elapsed * 1000)}ms)"})

    # Send final result
    writer({"event": "result", "data": response.model_dump(),
            "message": f"🎯 Pipeline complete! Returning {len(results)} ranked candidates."})

    return {
        "current_agent": "assembly",
        "stage_timings": {**state.get("stage_timings", {}), "assembly": elapsed},
    }
