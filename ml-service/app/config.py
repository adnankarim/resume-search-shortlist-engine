"""Configuration for ML service."""

import os

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
RERANK_MODEL = os.getenv("RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
HOST = os.getenv("ML_HOST", "0.0.0.0")
PORT = int(os.getenv("ML_PORT", "8000"))
