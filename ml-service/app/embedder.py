"""
Embedding service using sentence-transformers.
"""

import os
import logging
from sentence_transformers import SentenceTransformer

log = logging.getLogger(__name__)

MODEL_NAME = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")


class Embedder:
    def __init__(self):
        log.info(f"Loading embedding model: {MODEL_NAME}")
        self._model = SentenceTransformer(MODEL_NAME)
        log.info(f"Model loaded. Dimension: {self._model.get_sentence_embedding_dimension()}")

    def is_loaded(self) -> bool:
        return self._model is not None

    def encode(self, texts: list[str]) -> list[list[float]]:
        """Encode texts to embedding vectors."""
        embeddings = self._model.encode(texts, show_progress_bar=False)
        return [emb.tolist() for emb in embeddings]

    def dimension(self) -> int:
        return self._model.get_sentence_embedding_dimension()
