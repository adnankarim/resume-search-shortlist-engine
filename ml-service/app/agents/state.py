"""
Shared agent state for the LangGraph pipeline.
This TypedDict flows through every node in the graph.
"""

from __future__ import annotations
from typing import TypedDict, Annotated, Optional
from pydantic import BaseModel, Field
from langgraph.graph.message import add_messages


# ─── Pydantic models (for serialization + validation) ───

class MissionSpec(BaseModel):
    """Structured output from JD Understanding Agent."""
    must_have: list[str] = Field(default_factory=list, description="Required skills/qualifications")
    nice_to_have: list[str] = Field(default_factory=list, description="Preferred skills")
    negative_constraints: list[str] = Field(default_factory=list, description="Skills/domains to exclude")
    min_years: Optional[int] = Field(default=None, description="Minimum years of experience")
    location: Optional[str] = Field(default=None, description="Preferred location")
    weights: dict[str, float] = Field(default_factory=dict, description="Facet weights")
    clarifications: list[str] = Field(default_factory=list, description="Missing info suggestions")
    raw_query: str = Field(default="", description="Original query text")


class RetrievalHit(BaseModel):
    """A single retrieval result (chunk-level)."""
    chunk_id: str = ""
    candidate_id: str
    section_type: str = ""
    chunk_text: str = ""
    score: float = 0.0
    rank: int = 0
    source: str = ""  # "dense" | "sparse"


class FusedCandidate(BaseModel):
    """Candidate after RRF fusion."""
    candidate_id: str
    rrf_score: float
    dense_rank: Optional[int] = None
    sparse_rank: Optional[int] = None
    matched_skills: list[str] = Field(default_factory=list)
    matched_count: int = 0


class EvidenceItem(BaseModel):
    """Single piece of evidence for a candidate."""
    chunk_id: str = ""
    section: str = ""
    text_snippet: str = ""
    why_matched: str = ""  # "dense" | "sparse" | "both"


class EvidencePack(BaseModel):
    """Bounded evidence pack for a candidate."""
    candidate_id: str
    evidence: list[EvidenceItem] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list, description="Top 3 snippets for card")


class ScoreBreakdown(BaseModel):
    """Score breakdown for transparency."""
    rrf_score: float = 0.0
    rerank_score: float = 0.0
    dense_rank: Optional[int] = None
    sparse_rank: Optional[int] = None


class ShortlistResult(BaseModel):
    """Final result for a single candidate."""
    candidate_id: str
    final_score: float = 0.0
    score_breakdown: ScoreBreakdown = Field(default_factory=ScoreBreakdown)
    evidence_pack: EvidencePack = Field(default_factory=lambda: EvidencePack(candidate_id=""))
    highlights: list[str] = Field(default_factory=list)
    headline: str = ""
    total_yoe: int = 0
    location_country: str = ""
    location_city: str = ""
    summary: str = ""
    matched_skills: list[str] = Field(default_factory=list)


class ShortlistResponse(BaseModel):
    """Full response from the pipeline."""
    request_id: str
    mission_spec: MissionSpec
    results: list[ShortlistResult] = Field(default_factory=list)
    suggested_refinements: list[str] = Field(default_factory=list)
    stage_timings: dict[str, float] = Field(default_factory=dict)
    total_candidates_found: int = 0


# ─── LangGraph State ───

class AgentState(TypedDict):
    """Shared state flowing through all LangGraph nodes."""
    # Input
    query_text: str
    filters: dict

    # Stage outputs
    mission_spec: Optional[dict]          # MissionSpec as dict
    sparse_results: list[dict]            # RetrievalHit dicts
    dense_results: list[dict]             # RetrievalHit dicts
    fused_candidates: list[dict]          # FusedCandidate dicts
    evidence_packs: dict                  # candidateId -> EvidencePack dict
    rerank_scores: dict                   # candidateId -> float
    final_results: list[dict]             # ShortlistResult dicts

    # LangGraph message passing
    messages: Annotated[list, add_messages]

    # Metadata
    current_agent: str
    stage_timings: dict
    request_id: str
