# Resume Search MVP

High-accuracy resume search system for 4,607 structured resumes with deterministic skill matching, hybrid retrieval, and explainable results.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  React UI   │────▶│  Express API │────▶│  MongoDB     │
│  (Vite)     │     │  (Node)      │     │  (Local)     │
│  :5173      │     │  :3001       │     │  :27017      │
└─────────────┘     └──────┬───────┘     └──────────────┘
                           │
                    ┌──────▼───────┐
                    │ ML Service   │
                    │ (FastAPI)    │
                    │ :8000        │
                    └──────────────┘
```

## System Flow

### 1. Ingestion Pipeline (`ingestion/ingest.py`)
The ingestion process transforms raw resume data into searchable artifacts.

1.  **Read & ID**: Reads `master_resumes.jsonl`. Generates a deterministic `resumeId` based on the MD5 hash of the email (if present) or the resume content.
2.  **PII Extraction** (`pii_handler.py`):
    *   Extracts specific fields: name, email, phone, LinkedIn/GitHub URLs, and address.
    *   Stores them in a separate `resumes_pii` collection.
    *   **Redaction**: Uses Regex patterns to replace these entities with `[REDACTED]` in the searchable text to prevent PII leakage into embeddings.
3.  **Skill Extraction** (`skill_extractor.py`):
    *   Maps raw text to canonical skills (e.g., "React.js" -> "React").
    *   **Confidence Scoring**: Assigns weights based on source:
        *   **1.0**: Structured fields (Skills section, Technical Environment).
        *   **0.9**: Project technologies.
        *   **0.6**: Narrative text (Descriptions, Responsibilities).
    *   Stored in the `resume_skills` ledger for fast filtering.
4.  **Chunking** (`chunker.py`):
    *   Splits resume text into semantic sections rather than arbitrary token windows.
    *   **Sections**: Summary, Experience (one chunk per role), Projects (one chunk per project), Education (one chunk per degree), and Skills.
    *   Preserves context like "Responsibilities" and "Dates" within each chunk.
5.  **Embedding**: Generates vector embeddings for each chunk using `sentence-transformers/all-MiniLM-L6-v2`.
6.  **Storage**: Saves user-agnostic chunks + embeddings to `resume_chunks`.

### 2. Search Pipeline (`server/src/services/searchService.js`)
When a user searches for candidates:

1.  **Query Analysis**: User input is split into distinct skill terms (e.g., "Python", "Machine Learning").
2.  **Candidate Gating**:
    *   Finds all resumes that possess the required skills using the `resume_skills` ledger.
    *   **Logic**: `Count(Matched Skills) >= Threshold`.
    *   This excludes irrelevant candidates *before* expensive vector search.
3.  **Hybrid Retrieval**:
    *   **Lexical Search**: Regex-based keyword matching on chunk text. Scores based on term frequency.
    *   **Vector Search**: Computes Cosine Similarity between the query embedding and chunk embeddings (fetched from ML Service).
4.  **Rank Fusion (RRF)**:
    *   Combines the two ranked lists using Reciprocal Rank Fusion.
    *   **Formula**: `Score = 1 / (k + rank_lexical) + 1 / (k + rank_vector)` with `k=60`.
    *   Evidence is collected from the top-scoring chunks for each candidate.
5.  **Scoring**:
    Computes a normalized `finalScore` (0-100) for the UI:
    *   **Skill Score (50%)**: `(Matched Skills / Total Query Skills) * 50`
    *   **Semantic Score (50%)**: `Min(RRF_Score * 1500, 50)`
    *   **Final Score**: `Skill Score + Semantic Score`
6.  **Evidence**: Returns the top 3 matching snippets per candidate to explain *why* they matched.

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.10+
- MongoDB (local or Atlas)

### 1. Configure MongoDB
- Open `.env` and replace `<db_password>` with your Atlas password.
- Verify the `MONGO_URI` matches your cluster.

### 2. Run Ingestion (one-time)
```bash
cd ingestion
pip install -r requirements.txt
python ingest.py
```
This processes all 4,607 resumes: extracts PII, builds skills ledger, generates chunks, computes embeddings, and writes everything to MongoDB.

### 3. Start ML Service
```bash
cd ml-service
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 4. Start API Server
```bash
cd server
npm install
npm run dev
```

### 5. Start Frontend
```bash
cd client
npm install
npm run dev
```

Visit [http://localhost:5173](http://localhost:5173)

## Search Features

- **Skill chip input** — comma or enter separated, paste support
- **Match modes** — Match ALL or Match at least N of K
- **Hybrid retrieval** — Lexical + Vector search with RRF fusion
- **Explainable results** — Evidence snippets + matched skills for each candidate
- **PII minimization** — No personal data in search surface or embeddings

## Project Structure

```
resume-search/
├── client/          # React (Vite) frontend
├── server/          # Node/Express API
├── ml-service/      # Python FastAPI embedding + reranking
├── ingestion/       # Python data pipeline
└── scripts/         # Index creation utilities
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/search` | Search resumes by skills |
| GET | `/api/resume/:id` | Get candidate profile |
| POST | `/api/admin/ingest` | Ingestion instructions |
| GET | `/api/health` | Server health check |
| POST | `/embed` | Get embeddings (ML) |
| POST | `/rerank` | Rerank results (ML) |
| GET | `/health` | ML service health |
