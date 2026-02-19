"""
Reranking service using OpenAI embeddings for cosine-similarity based reranking.
Falls back to sentence-transformers CrossEncoder if available.
"""

import os
import math
import logging
from typing import Optional

log = logging.getLogger(__name__)

RERANK_MODEL = os.getenv("RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")


class Reranker:
    def __init__(self):
        self._cross_encoder = None
        self._openai_client = None
        self._mode = None  # "cross_encoder" | "openai" | "fallback"

    def _load(self):
        if self._mode is not None:
            return

        # Try cross-encoder first
        try:
            from sentence_transformers import CrossEncoder
            log.info(f"Loading cross-encoder model: {RERANK_MODEL}")
            self._cross_encoder = CrossEncoder(RERANK_MODEL)
            self._mode = "cross_encoder"
            log.info("Cross-encoder model loaded successfully")
            return
        except Exception as e:
            log.warning(f"Could not load cross-encoder: {e}")

        # Fall back to OpenAI embeddings
        if OPENAI_API_KEY and OPENAI_API_KEY != "your-openai-api-key-here":
            try:
                from openai import OpenAI
                self._openai_client = OpenAI(api_key=OPENAI_API_KEY)
                self._mode = "openai"
                log.info(f"Using OpenAI embeddings for reranking ({OPENAI_EMBED_MODEL})")
                return
            except Exception as e:
                log.warning(f"Could not initialize OpenAI client: {e}")

        self._mode = "fallback"
        log.warning("No reranking backend available — using fallback uniform scores")

    def is_loaded(self) -> bool:
        return self._mode is not None and self._mode != "fallback"

    def rerank(self, query: str, documents: list[str], top_k: int = 100) -> list[tuple[int, float]]:
        """
        Rerank documents by relevance to query.
        Returns list of (original_index, score) sorted by score descending.
        """
        self._load()

        if self._mode == "cross_encoder":
            return self._rerank_cross_encoder(query, documents, top_k)
        elif self._mode == "openai":
            return self._rerank_openai(query, documents, top_k)
        else:
            # Fallback: return original order with uniform scores
            return [(i, 0.5) for i in range(min(top_k, len(documents)))]

    def _rerank_cross_encoder(self, query: str, documents: list[str], top_k: int) -> list[tuple[int, float]]:
        pairs = [(query, doc) for doc in documents]
        scores = self._cross_encoder.predict(pairs)
        indexed_scores = [(i, float(s)) for i, s in enumerate(scores)]
        indexed_scores.sort(key=lambda x: x[1], reverse=True)
        return indexed_scores[:top_k]

    def _rerank_openai(self, query: str, documents: list[str], top_k: int) -> list[tuple[int, float]]:
        """Rerank using OpenAI embeddings + cosine similarity."""
        try:
            # Batch all texts (query + documents) in one API call for efficiency
            all_texts = [query] + [doc[:2000] for doc in documents]  # Truncate long docs

            # Batch in groups of 100 to stay within API limits
            all_embeddings = []
            batch_size = 100
            for i in range(0, len(all_texts), batch_size):
                batch = all_texts[i:i + batch_size]
                response = self._openai_client.embeddings.create(
                    model=OPENAI_EMBED_MODEL,
                    input=batch,
                )
                all_embeddings.extend([item.embedding for item in response.data])

            query_emb = all_embeddings[0]
            doc_embeddings = all_embeddings[1:]

            # Compute cosine similarities
            indexed_scores = []
            for i, doc_emb in enumerate(doc_embeddings):
                sim = _cosine_similarity(query_emb, doc_emb)
                indexed_scores.append((i, sim))

            indexed_scores.sort(key=lambda x: x[1], reverse=True)
            return indexed_scores[:top_k]

        except Exception as e:
            log.error(f"OpenAI reranking failed: {e}")
            return [(i, 0.5) for i in range(min(top_k, len(documents)))]


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    denom = mag_a * mag_b
    return dot / denom if denom > 0 else 0.0
