"""
LangGraph StateGraph — the orchestrator that wires all agents together.
Defines the pipeline: JD Understanding → Retrieval → Fusion → Evidence → Ranking → Assembly.
"""

import uuid
import logging
from langgraph.graph import StateGraph, START, END

from .state import AgentState
from .jd_agent import jd_agent_node
from .retriever_agent import retriever_agent_node
from .fusion import fusion_node
from .evidence_agent import evidence_agent_node
from .ranker_agent import ranker_agent_node
from .assembly import assembly_node

log = logging.getLogger(__name__)


def build_graph():
    """Build and compile the LangGraph agent pipeline."""
    graph = StateGraph(AgentState)

    # Add nodes (each is an async function that takes state + writer)
    graph.add_node("jd_understanding", jd_agent_node)
    graph.add_node("retrieval", retriever_agent_node)
    graph.add_node("fusion", fusion_node)
    graph.add_node("evidence_building", evidence_agent_node)
    graph.add_node("ranking", ranker_agent_node)
    graph.add_node("assembly", assembly_node)

    # Define edges (linear pipeline)
    graph.add_edge(START, "jd_understanding")
    graph.add_edge("jd_understanding", "retrieval")
    graph.add_edge("retrieval", "fusion")
    graph.add_edge("fusion", "evidence_building")
    graph.add_edge("evidence_building", "ranking")
    graph.add_edge("ranking", "assembly")
    graph.add_edge("assembly", END)

    return graph.compile()


def create_initial_state(query_text: str, filters: dict = None) -> AgentState:
    """Create the initial state for a pipeline run."""
    return {
        "query_text": query_text,
        "filters": filters or {},
        "mission_spec": None,
        "sparse_results": [],
        "dense_results": [],
        "fused_candidates": [],
        "evidence_packs": {},
        "rerank_scores": {},
        "final_results": [],
        "messages": [],
        "current_agent": "",
        "stage_timings": {},
        "request_id": str(uuid.uuid4()),
    }


# Singleton compiled graph
_compiled_graph = None

def get_graph():
    """Get or create the compiled graph singleton."""
    global _compiled_graph
    if _compiled_graph is None:
        log.info("Building LangGraph agent pipeline...")
        _compiled_graph = build_graph()
        log.info("Agent pipeline compiled successfully")
    return _compiled_graph
