"""
Assembly Node — final step that enriches results with profile data,
applies hard relevance filtering, and builds the ShortlistResponse.
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

# Domain keywords used for hard-filter matching
DOMAIN_KEYWORDS = {
    "digital marketing": ["marketing", "seo", "sem", "ppc", "content", "brand", "advertising", "media", "campaign", "crm", "growth"],
    "python development": ["python", "django", "flask", "fastapi", "backend"],
    "data engineering": ["data engineer", "etl", "pipeline", "spark", "airflow", "warehouse"],
    "frontend development": ["frontend", "react", "angular", "vue", "css", "javascript", "typescript", "ui"],
    "backend development": ["backend", "api", "server", "microservice", "nodejs", "java", "go"],
    "machine learning": ["machine learning", "ml", "deep learning", "ai", "neural", "nlp", "computer vision", "model"],
    "devops": ["devops", "ci/cd", "kubernetes", "docker", "terraform", "infrastructure", "sre"],
    "data science": ["data scien", "analytics", "statistics", "jupyter", "pandas", "tableau", "visualization"],
    "product management": ["product manager", "roadmap", "stakeholder", "agile", "scrum"],
    "cloud engineering": ["cloud", "aws", "azure", "gcp", "infrastructure"],
    "mobile development": ["mobile", "ios", "android", "swift", "kotlin", "flutter", "react native"],
    "cybersecurity": ["security", "penetration", "vulnerability", "compliance", "soc", "firewall"],
    "qa engineering": ["qa", "quality assurance", "testing", "automation test", "selenium"],
    "ui/ux design": ["design", "ux", "ui", "figma", "sketch", "wireframe", "prototype", "user research"],
}


def _is_domain_relevant(headline: str, core_domain: str) -> bool:
    """Check if a candidate's headline is relevant to the core domain."""
    if not core_domain:
        return True  # No domain filter specified

    headline_lower = headline.lower()
    domain_lower = core_domain.lower()

    # Direct domain mention in headline
    if domain_lower in headline_lower:
        return True

    # Check domain keyword overlap
    keywords = DOMAIN_KEYWORDS.get(domain_lower, [])
    if not keywords:
        # For unknown domains, do a simple substring check
        # Split domain into words and check if any appear in headline
        domain_words = domain_lower.split()
        return any(word in headline_lower for word in domain_words if len(word) > 2)

    return any(kw in headline_lower for kw in keywords)


async def assembly_node(state: AgentState, writer):
    """LangGraph node: Assembly — builds final ShortlistResponse with hard filtering + weak-match fallback."""
    start = time.time()
    final_results_raw = state.get("final_results", [])
    evidence_packs = state.get("evidence_packs", {})
    mission_spec_dict = state.get("mission_spec", {})
    request_id = state.get("request_id", "")

    writer({"event": "agent_start", "agent": "Assembly", "stage": 6,
            "message": "📦 Assembling final shortlist with {} candidates...".format(len(final_results_raw))})

    # Get core_domain for filtering
    core_domain = mission_spec_dict.get("core_domain", "")

    # Fetch profile data for enrichment (top candidates)
    candidate_ids = [r["candidate_id"] for r in final_results_raw[:cfg.MAX_RESULTS * 2]]

    writer({"event": "tool_call", "agent": "Assembly", "tool": "fetch_candidate_profiles",
            "message": "🔧 Enriching {} candidates with profile data...".format(len(candidate_ids))})

    profiles = fetch_candidate_profiles.invoke({"candidate_ids": candidate_ids})
    profile_map = {p["candidate_id"]: p for p in profiles}

    writer({"event": "tool_result", "agent": "Assembly", "tool": "fetch_candidate_profiles",
            "message": "📊 Loaded {} candidate profiles".format(len(profiles))})

    def _build_result(r):
        """Build a ShortlistResult from a raw result dict."""
        cid = r["candidate_id"]
        profile = profile_map.get(cid, {})
        headline = profile.get("headline", "No title available")
        pack_dict = evidence_packs.get(cid, {"candidate_id": cid, "evidence": [], "highlights": []})
        return ShortlistResult(
            candidate_id=cid,
            name=profile.get("name", ""),
            final_score=r["final_score"],
            score_breakdown=ScoreBreakdown(
                rrf_score=r.get("rrf_score", 0),
                rerank_score=r.get("rerank_score", 0),
                dense_rank=r.get("dense_rank"),
                sparse_rank=r.get("sparse_rank"),
            ),
            evidence_pack=EvidencePack(**pack_dict) if isinstance(pack_dict, dict) else pack_dict,
            highlights=pack_dict.get("highlights", []),
            headline=headline,
            total_yoe=profile.get("total_yoe", 0),
            location_country=profile.get("location_country", ""),
            location_city=profile.get("location_city", ""),
            summary=profile.get("summary", ""),
            matched_skills=r.get("matched_skills", []),
        ).model_dump()

    # ----- Pass 1: apply hard filters -----
    strong_results = []
    filtered_count = 0
    domain_filtered_count = 0
    score_filtered_count = 0

    for r in final_results_raw:
        cid = r["candidate_id"]
        profile = profile_map.get(cid, {})
        headline = profile.get("headline", "No title available")

        # --- Hard filter 1: minimum score threshold ---
        if cfg.HARD_FILTER_ENABLED and r["final_score"] < cfg.MIN_RELEVANCE_SCORE:
            score_filtered_count += 1
            filtered_count += 1
            continue

        # --- Hard filter 2: core domain relevance ---
        if cfg.HARD_FILTER_ENABLED and core_domain and not _is_domain_relevant(headline, core_domain):
            domain_filtered_count += 1
            filtered_count += 1
            continue

        strong_results.append(_build_result(r))

        if len(strong_results) >= cfg.MAX_RESULTS:
            break

    # Log filtering summary
    if filtered_count > 0:
        writer({"event": "agent_thought", "agent": "Assembly",
                "message": "🔍 Filtered out {} candidates ({} below {}% score, {} outside '{}' domain)".format(
                    filtered_count, score_filtered_count, int(cfg.MIN_RELEVANCE_SCORE),
                    domain_filtered_count, core_domain or "none")})

    # ----- Determine match quality -----
    match_quality = "strong"
    results = strong_results

    if len(strong_results) == 0 and len(final_results_raw) > 0:
        # No strong matches — fall back to top candidates as WEAK matches
        match_quality = "weak"
        WEAK_LIMIT = min(10, cfg.MAX_RESULTS)
        for r in final_results_raw[:WEAK_LIMIT]:
            results.append(_build_result(r))

        best_score = max((r.get("final_score", 0) for r in results), default=0)
        writer({"event": "agent_thought", "agent": "Assembly",
                "message": "⚠️ No strong matches found (best score: {:.0f}%). "
                           "Returning top {} as weak matches.".format(best_score, len(results))})

    elif len(final_results_raw) == 0:
        match_quality = "none"
        writer({"event": "agent_thought", "agent": "Assembly",
                "message": "❌ No candidates found in the database matching this query."})

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
        match_quality=match_quality,
    )

    elapsed = time.time() - start

    if match_quality == "weak":
        writer({"event": "stage_complete", "stage": "assembly", "timing_ms": round(elapsed * 1000),
                "message": "⚠️ No strong matches. Showing {} weak matches ({}ms)".format(
                    len(results), round(elapsed * 1000))})
    else:
        writer({"event": "stage_complete", "stage": "assembly", "timing_ms": round(elapsed * 1000),
                "message": "✅ Shortlist assembled: {} candidates returned ({} filtered, {}ms)".format(
                    len(results), filtered_count, round(elapsed * 1000))})

    # Send final result
    writer({"event": "result", "data": response.model_dump(),
            "message": "🎯 Pipeline complete! Returning {} {} candidates.".format(
                len(results), "weak-match" if match_quality == "weak" else "ranked")})

    return {
        "current_agent": "assembly",
        "stage_timings": {**state.get("stage_timings", {}), "assembly": elapsed},
    }

