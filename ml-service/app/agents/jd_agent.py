"""
JD Understanding Agent — parses raw query/JD into structured MissionSpec.
Uses OpenAI function calling to extract skills, requirements, and constraints.
"""

import logging
import time
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.types import Command

from . import config as cfg
from .state import AgentState, MissionSpec

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a recruitment query analyst. Your job is to parse a recruiter's search query or job description into structured requirements.

Given the user's query, you MUST extract:
1. **must_have**: Skills, technologies, or qualifications that are explicitly required. Be specific. Normalize technology names (e.g., "React.js" → "react", "Node" → "nodejs").
2. **nice_to_have**: Skills mentioned as preferred, bonus, or optional.
3. **negative_constraints**: Technologies, roles, or domains explicitly excluded (look for "not", "except", "excluding", "no").
4. **min_years**: Minimum years of experience if mentioned (extract the number only).
5. **location**: Preferred location if mentioned.
6. **clarifications**: Anything ambiguous or missing that the recruiter might want to specify. Keep these concise.

IMPORTANT RULES:
- Extract ACTUAL skill names, not generic descriptions. "experience with databases" → "databases"
- Normalize common aliases: "JS" → "javascript", "ML" → "machine learning", "k8s" → "kubernetes"
- If the query is just a list of skills, put them all in must_have.
- Keep everything lowercase.
- Return valid JSON matching the schema exactly.

You must respond with a JSON object matching this schema:
{
    "must_have": ["skill1", "skill2"],
    "nice_to_have": ["skill3"],
    "negative_constraints": ["excluded1"],
    "min_years": null or number,
    "location": null or "location string",
    "clarifications": ["suggestion1"]
}"""


async def jd_agent_node(state: AgentState, writer):
    """LangGraph node: JD Understanding Agent."""
    start = time.time()

    writer({"event": "agent_start", "agent": "JD Understanding", "stage": 1,
            "message": "🧠 Analyzing your query to extract structured requirements..."})

    query = state.get("query_text", "")
    if not query:
        writer({"event": "agent_thought", "agent": "JD Understanding",
                "message": "⚠️ No query provided, using empty mission spec"})
        empty_spec = MissionSpec(raw_query="").model_dump()
        return {
            "mission_spec": empty_spec,
            "current_agent": "jd_understanding",
            "stage_timings": {**state.get("stage_timings", {}), "jd_understanding": time.time() - start},
        }

    writer({"event": "agent_thought", "agent": "JD Understanding",
            "message": f"📝 Reading query: \"{query[:100]}{'...' if len(query) > 100 else ''}\""})

    # Call OpenAI with structured output
    llm = ChatOpenAI(
        model=cfg.OPENAI_MODEL,
        temperature=cfg.OPENAI_TEMPERATURE,
        api_key=cfg.OPENAI_API_KEY,
    )

    writer({"event": "tool_call", "agent": "JD Understanding",
            "tool": "openai_parse", "message": "🔧 Calling OpenAI to parse requirements..."})

    response = await llm.ainvoke([
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=f"Parse this recruitment query:\n\n{query}"),
    ])

    # Parse LLM response
    import json
    try:
        # Try to extract JSON from the response
        content = response.content
        # Handle markdown code blocks
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        
        parsed = json.loads(content.strip())
        mission_spec = MissionSpec(
            must_have=parsed.get("must_have", []),
            nice_to_have=parsed.get("nice_to_have", []),
            negative_constraints=parsed.get("negative_constraints", []),
            min_years=parsed.get("min_years"),
            location=parsed.get("location"),
            clarifications=parsed.get("clarifications", []),
            raw_query=query,
        )
    except (json.JSONDecodeError, Exception) as e:
        log.warning(f"Failed to parse LLM response, falling back to keyword extraction: {e}")
        writer({"event": "agent_thought", "agent": "JD Understanding",
                "message": "⚠️ LLM parse failed, using keyword extraction fallback..."})
        mission_spec = _fallback_parse(query)

    spec_dict = mission_spec.model_dump()

    writer({"event": "mission_spec", "agent": "JD Understanding", "data": spec_dict,
            "message": f"✅ Extracted {len(mission_spec.must_have)} must-have skills, "
                       f"{len(mission_spec.nice_to_have)} nice-to-have"})

    elapsed = time.time() - start
    writer({"event": "stage_complete", "stage": "jd_understanding", "timing_ms": round(elapsed * 1000),
            "message": f"✅ JD Understanding complete ({round(elapsed * 1000)}ms)"})

    return {
        "mission_spec": spec_dict,
        "current_agent": "jd_understanding",
        "stage_timings": {**state.get("stage_timings", {}), "jd_understanding": elapsed},
    }


def _fallback_parse(query: str) -> MissionSpec:
    """Deterministic fallback: extract skills from query using regex."""
    import re
    from .tools import normalize_skills

    # Extract years
    years_match = re.search(r"(\d+)\+?\s*(?:years?|yrs?|YOE)", query, re.IGNORECASE)
    min_years = int(years_match.group(1)) if years_match else None

    # Split query into potential skills
    tokens = re.split(r"[,;.\n]+", query)
    skills = []
    for token in tokens:
        cleaned = token.strip().lower()
        # Remove common non-skill words
        cleaned = re.sub(r"\b(with|and|or|experience|in|of|the|a|an|for|to|is|are|we|need|looking|senior|junior|mid|level|developer|engineer|specialist)\b", " ", cleaned)
        cleaned = cleaned.strip()
        if cleaned and len(cleaned) > 1 and len(cleaned) < 50:
            skills.append(cleaned)

    normalized = normalize_skills(skills)
    return MissionSpec(
        must_have=normalized,
        min_years=min_years,
        raw_query=query,
        clarifications=["Query was parsed using keyword extraction. Provide a more detailed JD for better results."],
    )
