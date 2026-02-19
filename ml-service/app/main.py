"""
FastAPI ML service for embedding and reranking.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from .embedder import Embedder
from .reranker import Reranker
from .agents.streaming import router as agents_router

app = FastAPI(title="Resume Search ML Service", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include agentic pipeline router
app.include_router(agents_router)

# Initialize models
embedder = Embedder()
reranker = Reranker()


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]


class RerankRequest(BaseModel):
    query: str
    documents: list[str]
    top_k: int = 100


class RerankResult(BaseModel):
    index: int
    score: float


class RerankResponse(BaseModel):
    results: list[RerankResult]


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": embedder.is_loaded(),
        "reranker_loaded": reranker.is_loaded(),
    }


@app.post("/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest):
    embeddings = embedder.encode(request.texts)
    return EmbedResponse(embeddings=embeddings)


@app.post("/rerank", response_model=RerankResponse)
async def rerank(request: RerankRequest):
    results = reranker.rerank(request.query, request.documents, request.top_k)
    return RerankResponse(
        results=[RerankResult(index=r[0], score=r[1]) for r in results]
    )


class IngestRequest(BaseModel):
    limit: int = 100
    file_path: str = "/app/master_resumes_production.jsonl"


@app.post("/ingest")
async def ingest(request: IngestRequest):
    """
    Triggers the ingestion script as a subprocess.
    """
    import subprocess
    import os
    
    # Path to ingestion script (relative to /app)
    script_path = "/app/ingestion/ingest.py"
    data_path = request.file_path
    
    if not os.path.exists(script_path):
        return {"status": "error", "message": f"Script not found at {script_path}"}
    
    if not os.path.exists(data_path):
         return {"status": "error", "message": f"Data file not found at {data_path}"}
        
    try:
        # Run ingestion script
        # We use python3 explicitely
        cmd = [
            "python3", 
            script_path, 
            data_path, 
            "--limit", str(request.limit)
        ]
        
        # Run in background or wait? For MVP wait is easier to debug but blocking
        # Let's wait for now to return status
        result = subprocess.run(cmd, capture_output=True, text=True, cwd="/app/ingestion")
        
        if result.returncode != 0:
            return {
                "status": "error", 
                "message": "Ingestion failed",
                "stderr": result.stderr,
                "stdout": result.stdout
            }
            
        return {
            "status": "success", 
            "message": "Ingestion completed",
            "stdout": result.stdout
        }
        
    except Exception as e:
        return {"status": "error", "message": str(e)}
