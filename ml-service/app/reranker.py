"""
Optional reranking service using cross-encoder.
"""

import os
import logging

log = logging.getLogger(__name__)

RERANK_MODEL = os.getenv("RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")


class Reranker:
    def __init__(self):
        self._model = None
        # Lazy load - only initialize when first used

    def _load(self):
        if self._model is None:
            try:
                from sentence_transformers import CrossEncoder
                log.info(f"Loading reranker model: {RERANK_MODEL}")
                self._model = CrossEncoder(RERANK_MODEL)
                log.info("Reranker model loaded")
            except Exception as e:
                log.warning(f"Could not load reranker: {e}")

    def is_loaded(self) -> bool:
        return self._model is not None

    def rerank(self, query: str, documents: list[str], top_k: int = 100) -> list[tuple[int, float]]:
        """
        Rerank documents by relevance to query.
        Returns list of (original_index, score) sorted by score descending.
        """
        self._load()
        if self._model is None:
            # Fallback: return original order with uniform scores
            return [(i, 1.0) for i in range(min(top_k, len(documents)))]

        pairs = [(query, doc) for doc in documents]
        scores = self._model.predict(pairs)

        # Create (index, score) pairs and sort
        indexed_scores = [(i, float(s)) for i, s in enumerate(scores)]
        indexed_scores.sort(key=lambda x: x[1], reverse=True)

        return indexed_scores[:top_k]
