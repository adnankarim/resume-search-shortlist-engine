"""
Centralized configuration for the agentic shortlist pipeline.
All values are tunable via environment variables or config file — no code changes needed.
"""

import os
import json
import logging

log = logging.getLogger(__name__)

# --- LLM ---
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_TEMPERATURE = float(os.getenv("OPENAI_TEMPERATURE", "0.1"))

# --- Retrieval ---
K_DENSE = int(os.getenv("K_DENSE", "300"))
K_SPARSE = int(os.getenv("K_SPARSE", "300"))
K_POOL = int(os.getenv("K_POOL", "500"))

# --- Fusion ---
RRF_K = int(os.getenv("RRF_K", "60"))

# --- Evidence ---
MAX_CHUNKS_PER_CANDIDATE = int(os.getenv("MAX_CHUNKS_PER_CANDIDATE", "5"))
MAX_CHARS_PER_CHUNK = int(os.getenv("MAX_CHARS_PER_CHUNK", "800"))
MAX_TOTAL_CHARS_PER_CANDIDATE = int(os.getenv("MAX_TOTAL_CHARS_PER_CANDIDATE", "2500"))

# --- Reranking ---
K_RERANK = int(os.getenv("K_RERANK", "100"))

# --- Final scoring weights ---
W_RRF = float(os.getenv("W_RRF", "0.35"))
W_CE = float(os.getenv("W_CE", "0.65"))

# --- Hard filtering ---
MIN_RELEVANCE_SCORE = float(os.getenv("MIN_RELEVANCE_SCORE", "20"))  # Minimum % to include in results
HARD_FILTER_ENABLED = os.getenv("HARD_FILTER_ENABLED", "true").lower() in ("true", "1", "yes")
MAX_RESULTS = int(os.getenv("MAX_RESULTS", "25"))

# --- MongoDB ---
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "resume_search")

# --- ML Service (self) ---
ML_HOST = os.getenv("ML_HOST", "0.0.0.0")
ML_PORT = int(os.getenv("ML_PORT", "8000"))

# --- LangSmith (optional observability) ---
LANGSMITH_API_KEY = os.getenv("LANGSMITH_API_KEY", "")
LANGSMITH_PROJECT = os.getenv("LANGSMITH_PROJECT", "resume-shortlist")

def get_config_summary() -> dict:
    """Return current config as a dict for debugging."""
    return {
        "openai_model": OPENAI_MODEL,
        "retrieval": {"K_dense": K_DENSE, "K_sparse": K_SPARSE, "K_pool": K_POOL},
        "fusion": {"rrf_k": RRF_K},
        "evidence": {
            "max_chunks": MAX_CHUNKS_PER_CANDIDATE,
            "max_chars_chunk": MAX_CHARS_PER_CHUNK,
            "max_chars_total": MAX_TOTAL_CHARS_PER_CANDIDATE,
        },
        "rerank": {"K_rerank": K_RERANK},
        "scoring": {"w_rrf": W_RRF, "w_ce": W_CE},
    }
