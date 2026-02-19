"""
LangChain tools that agents can call.
Includes MongoDB queries, embedding, cross-encoder reranking, and skill extraction.
"""

import re
import logging
import math
from typing import Optional
from langchain_core.tools import tool
from pymongo import MongoClient

from . import config as cfg

log = logging.getLogger(__name__)

# ─── MongoDB client (lazy singleton) ───

_mongo_client: Optional[MongoClient] = None

def _get_db():
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = MongoClient(cfg.MONGO_URI)
    return _mongo_client[cfg.MONGO_DB]


# ─── Skill aliases (subset mirroring server/src/utils/skillNormalization.js) ───

SKILL_ALIASES = {
    "ml": "machine learning", "js": "javascript", "ts": "typescript",
    "py": "python", "c#": "csharp", "c sharp": "csharp", "c++": "cpp",
    "golang": "go", "dl": "deep learning", "nlp": "natural language processing",
    "cv": "computer vision", "ai": "artificial intelligence",
    "llm": "large language models", "llms": "large language models",
    "genai": "generative ai", "gen ai": "generative ai",
    "sklearn": "scikit-learn", "scikit learn": "scikit-learn",
    "tf": "tensorflow", "react.js": "react", "reactjs": "react",
    "vue.js": "vue", "vuejs": "vue", "angular.js": "angular",
    "angularjs": "angular", "next.js": "nextjs", "node.js": "nodejs",
    "node js": "nodejs", "node": "nodejs", "express.js": "express",
    "expressjs": "express", "fast api": "fastapi",
    "postgres": "postgresql", "pg": "postgresql", "mongo": "mongodb",
    "amazon web services": "aws", "gcp": "google cloud platform",
    "google cloud": "google cloud platform", "k8s": "kubernetes",
    "html5": "html", "css3": "css",
}

def normalize_skill(raw: str) -> str:
    cleaned = raw.strip().lower().rstrip(".,;:")
    return SKILL_ALIASES.get(cleaned, cleaned)

def normalize_skills(raw_list: list[str]) -> list[str]:
    seen = set()
    result = []
    for raw in raw_list:
        canonical = normalize_skill(raw)
        if canonical and canonical not in seen:
            seen.add(canonical)
            result.append(canonical)
    return result


# ─── Tools ───

@tool
def search_skills_db(skills: list[str], mode: str = "match_any", min_match: int = 1) -> list[dict]:
    """Search the skills database for candidates matching the given skills.
    
    Args:
        skills: List of normalized skill names to search for.
        mode: 'match_all' to require all skills, 'match_any' for at least min_match.
        min_match: Minimum number of skills a candidate must have (for match_any mode).
    
    Returns:
        List of {candidate_id, matched_skills, matched_count, avg_confidence}
    """
    db = _get_db()
    normalized = normalize_skills(skills)
    if not normalized:
        return []

    threshold = len(normalized) if mode == "match_all" else max(1, min_match)

    pipeline = [
        {"$match": {"skillCanonical": {"$in": normalized}}},
        {"$group": {
            "_id": "$resumeId",
            "matchedSkills": {"$push": "$skillCanonical"},
            "matchedCount": {"$sum": 1},
            "avgConfidence": {"$avg": "$confidence"},
        }},
        {"$match": {"matchedCount": {"$gte": threshold}}},
        {"$sort": {"matchedCount": -1, "avgConfidence": -1}},
        {"$limit": cfg.K_POOL},
    ]

    results = list(db.resume_skills.aggregate(pipeline))
    return [
        {
            "candidate_id": r["_id"],
            "matched_skills": r["matchedSkills"],
            "matched_count": r["matchedCount"],
            "avg_confidence": r.get("avgConfidence", 0),
        }
        for r in results
    ]


@tool
def lexical_search_chunks(query_text: str, candidate_ids: list[str], limit: int = 300) -> list[dict]:
    """Search resume chunks using lexical/keyword matching.
    
    Args:
        query_text: The search query text.
        candidate_ids: List of candidate IDs to search within.
        limit: Maximum results to return.
    
    Returns:
        List of {chunk_id, candidate_id, section_type, chunk_text, score, rank}
    """
    db = _get_db()
    terms = [t for t in re.split(r"[,;\s]+", query_text) if len(t) > 1]
    if not terms:
        return []

    escaped = [re.escape(t) for t in terms]
    regex_pattern = "|".join(escaped)

    query_filter = {"chunkText": {"$regex": regex_pattern, "$options": "i"}}
    if candidate_ids:
        query_filter["resumeId"] = {"$in": candidate_ids[:cfg.K_POOL]}

    chunks = list(
        db.resume_chunks.find(
            query_filter,
            {"chunkId": 1, "resumeId": 1, "sectionType": 1, "sectionOrdinal": 1, "chunkText": 1},
        ).limit(limit)
    )

    scored = []
    for chunk in chunks:
        score = 0
        text = chunk.get("chunkText", "")
        for term in terms:
            matches = re.findall(re.escape(term), text, re.IGNORECASE)
            score += len(matches)
        scored.append({
            "chunk_id": chunk.get("chunkId", str(chunk.get("_id", ""))),
            "candidate_id": chunk.get("resumeId", ""),
            "section_type": chunk.get("sectionType", ""),
            "chunk_text": text[:cfg.MAX_CHARS_PER_CHUNK],
            "score": score,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    for i, s in enumerate(scored):
        s["rank"] = i + 1
    return scored[:limit]


@tool
def vector_search_chunks(query_text: str, candidate_ids: list[str], limit: int = 300) -> list[dict]:
    """Search resume chunks using vector/semantic similarity.
    
    Args:
        query_text: The search query text for embedding.
        candidate_ids: List of candidate IDs to search within.
        limit: Maximum results to return.
    
    Returns:
        List of {chunk_id, candidate_id, section_type, chunk_text, score, rank}
    """
    from ..embedder import Embedder

    db = _get_db()

    # Get query embedding
    embedder = Embedder()
    query_embedding = embedder.encode([query_text])[0]

    # Fetch candidate chunks with embeddings
    query_filter = {}
    if candidate_ids:
        query_filter["resumeId"] = {"$in": candidate_ids[:cfg.K_POOL]}

    chunks = list(
        db.resume_chunks.find(
            query_filter,
            {"chunkId": 1, "resumeId": 1, "sectionType": 1, "sectionOrdinal": 1,
             "chunkText": 1, "embedding": 1},
        )
    )

    # Compute cosine similarity
    scored = []
    for chunk in chunks:
        emb = chunk.get("embedding")
        if not emb or len(emb) == 0:
            continue

        sim = _cosine_similarity(query_embedding, emb)
        scored.append({
            "chunk_id": chunk.get("chunkId", str(chunk.get("_id", ""))),
            "candidate_id": chunk.get("resumeId", ""),
            "section_type": chunk.get("sectionType", ""),
            "chunk_text": chunk.get("chunkText", "")[:cfg.MAX_CHARS_PER_CHUNK],
            "score": sim,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    scored = scored[:limit]
    for i, s in enumerate(scored):
        s["rank"] = i + 1
    return scored


@tool
def fetch_candidate_profiles(candidate_ids: list[str]) -> list[dict]:
    """Fetch core profile data for a list of candidates.
    
    Args:
        candidate_ids: List of candidate resume IDs.
    
    Returns:
        List of profile dicts with summary, experience, location, etc.
    """
    db = _get_db()
    profiles = list(
        db.resumes_core.find(
            {"resumeId": {"$in": candidate_ids}},
            {
                "resumeId": 1, "summary": 1, "totalYOE": 1,
                "locationCountry": 1, "locationCity": 1,
                "experience.title": 1, "experience.company": 1,
                "skills": 1,
                "personal_info.name": 1,
            },
        )
    )
    return [
        {
            "candidate_id": p.get("resumeId", ""),
            "name": p.get("personal_info", {}).get("name", ""),
            "summary": p.get("summary", ""),
            "total_yoe": p.get("totalYOE", 0),
            "location_country": p.get("locationCountry", ""),
            "location_city": p.get("locationCity", ""),
            "headline": _make_headline(p.get("experience", [])),
            "skills": p.get("skills", {}),
        }
        for p in profiles
    ]


@tool
def fetch_candidate_chunks(candidate_id: str) -> list[dict]:
    """Fetch all text chunks for a specific candidate (without embeddings).
    
    Args:
        candidate_id: The resume ID of the candidate.
    
    Returns:
        List of {chunk_id, section_type, chunk_text}
    """
    db = _get_db()
    chunks = list(
        db.resume_chunks.find(
            {"resumeId": candidate_id},
            {"chunkId": 1, "sectionType": 1, "sectionOrdinal": 1, "chunkText": 1},
        ).sort([("sectionType", 1), ("sectionOrdinal", 1)])
    )
    return [
        {
            "chunk_id": c.get("chunkId", str(c.get("_id", ""))),
            "section_type": c.get("sectionType", ""),
            "chunk_text": c.get("chunkText", "")[:cfg.MAX_CHARS_PER_CHUNK],
        }
        for c in chunks
    ]


@tool
def cross_encoder_rerank(query: str, candidates: list[dict]) -> list[dict]:
    """Rerank candidates using the cross-encoder model.
    
    Args:
        query: The search query text.
        candidates: List of {candidate_id, text} to rerank.
    
    Returns:
        List of {candidate_id, score} sorted by score descending.
    """
    from ..reranker import Reranker

    reranker = Reranker()
    documents = [c["text"][:512] for c in candidates]  # Truncate for safety
    
    if not documents:
        return []
    
    results = reranker.rerank(query, documents, top_k=len(documents))
    
    output = []
    for idx, score in results:
        if idx < len(candidates):
            output.append({
                "candidate_id": candidates[idx]["candidate_id"],
                "score": score,
            })
    return output


# ─── Helper functions ───

def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    denom = mag_a * mag_b
    return dot / denom if denom > 0 else 0.0


def _make_headline(experience: list) -> str:
    if not experience:
        return "No title available"
    latest = experience[0]
    title = latest.get("title", "")
    company = latest.get("company", "")
    if title and company:
        return f"{title} at {company}"
    return title or company or "No title available"
