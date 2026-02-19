"""
Retriever Agent — LLM-powered agent that decides retrieval strategy
and calls MongoDB search tools (skills, lexical, vector).
"""

import logging
import time
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from . import config as cfg
from .state import AgentState
from .tools import (
    search_skills_db,
    lexical_search_chunks,
    vector_search_chunks,
    normalize_skills,
)

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a database retrieval specialist for a resume search system.
Your job is to find the best candidates by searching the database.

You have access to these tools:
1. search_skills_db — Find candidates by their skills (deterministic, fast)
2. lexical_search_chunks — Find resume chunks by keyword matching
3. vector_search_chunks — Find resume chunks by semantic/meaning similarity

STRATEGY:
1. First, use search_skills_db with the must-have skills to find candidates who match.
2. Then run BOTH lexical_search_chunks AND vector_search_chunks in parallel for deeper evidence.
3. The query text for searches should combine must-have and nice-to-have skills naturally.

Always be thorough — use all three search methods for best results."""


async def retriever_agent_node(state: AgentState, writer):
    """LangGraph node: Retriever Agent with tool calling."""
    start = time.time()
    mission_spec = state.get("mission_spec", {})

    writer({"event": "agent_start", "agent": "Retriever", "stage": 2,
            "message": "🔍 Starting multi-strategy candidate retrieval..."})

    must_have = mission_spec.get("must_have", [])
    nice_to_have = mission_spec.get("nice_to_have", [])
    raw_query = mission_spec.get("raw_query", "")

    # Build query text from mission spec
    all_skills = must_have + nice_to_have
    query_text = raw_query if raw_query else ", ".join(all_skills)
    skills_query = f"Skills: {'; '.join(all_skills)}." if all_skills else query_text

    # Step 1: Skill-based candidate gating
    candidate_ids = []
    matched_skills_map = {}

    if must_have:
        writer({"event": "tool_call", "agent": "Retriever", "tool": "search_skills_db",
                "message": f"🔧 Searching skills database for: {', '.join(must_have[:5])}{'...' if len(must_have) > 5 else ''}"})

        # Try match_any with min_match=1 for broader results
        min_match = max(1, len(must_have) // 2)
        skill_results = search_skills_db.invoke({
            "skills": must_have,
            "mode": "match_any",
            "min_match": min_match,
        })

        candidate_ids = [r["candidate_id"] for r in skill_results]
        for r in skill_results:
            matched_skills_map[r["candidate_id"]] = r["matched_skills"]

        writer({"event": "tool_result", "agent": "Retriever", "tool": "search_skills_db",
                "message": f"📊 Found {len(candidate_ids)} candidates matching skills (min {min_match}/{len(must_have)})"})

    # Step 2: Hybrid retrieval (lexical + vector in parallel)
    writer({"event": "agent_thought", "agent": "Retriever",
            "message": f"🔄 Running parallel retrieval — lexical + vector search across {'filtered' if candidate_ids else 'all'} candidates..."})

    writer({"event": "tool_call", "agent": "Retriever", "tool": "lexical_search_chunks",
            "message": "🔧 Running keyword/lexical search on resume chunks..."})

    sparse_results = lexical_search_chunks.invoke({
        "query_text": skills_query,
        "candidate_ids": candidate_ids[:cfg.K_POOL] if candidate_ids else [],
        "limit": cfg.K_SPARSE,
    })

    writer({"event": "tool_result", "agent": "Retriever", "tool": "lexical_search_chunks",
            "message": f"📊 Lexical search returned {len(sparse_results)} chunk hits"})

    writer({"event": "tool_call", "agent": "Retriever", "tool": "vector_search_chunks",
            "message": "🔧 Running semantic/vector search on resume chunks..."})

    dense_results = vector_search_chunks.invoke({
        "query_text": skills_query,
        "candidate_ids": candidate_ids[:cfg.K_POOL] if candidate_ids else [],
        "limit": cfg.K_DENSE,
    })

    writer({"event": "tool_result", "agent": "Retriever", "tool": "vector_search_chunks",
            "message": f"📊 Vector search returned {len(dense_results)} chunk hits"})

    # Tag sources
    for r in sparse_results:
        r["source"] = "sparse"
    for r in dense_results:
        r["source"] = "dense"

    # Collect all unique candidate IDs 
    all_candidate_ids = set()
    for r in sparse_results:
        all_candidate_ids.add(r["candidate_id"])
    for r in dense_results:
        all_candidate_ids.add(r["candidate_id"])

    # Merge matched_skills info
    for cid in all_candidate_ids:
        if cid not in matched_skills_map:
            matched_skills_map[cid] = []

    elapsed = time.time() - start
    writer({"event": "stage_complete", "stage": "retrieval", "timing_ms": round(elapsed * 1000),
            "message": f"✅ Retrieval complete: {len(sparse_results)} lexical + {len(dense_results)} vector hits "
                       f"from {len(all_candidate_ids)} unique candidates ({round(elapsed * 1000)}ms)"})

    return {
        "sparse_results": sparse_results,
        "dense_results": dense_results,
        "current_agent": "retriever",
        "stage_timings": {**state.get("stage_timings", {}), "retrieval": elapsed},
    }
