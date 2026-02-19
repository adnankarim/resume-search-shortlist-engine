# Resume Search AI — Agentic RAG Platform

A production-grade, agentic RAG (Retrieval-Augmented Generation) platform for intelligent candidate discovery. This system moves beyond simple keyword matching to understand recruitment intent, leveraging a multi-agent pipeline to search, rank, and explain candidate matches with high precision.

---

## 🚀 Key Features

### 🧠 Agentic Search Pipeline
*   **Intent Understanding**: Uses GPT-4o via LangGraph to parse unstructured queries (e.g., "Senior Python dev with 5y exp in fintech") into structured search intent (`MissionSpec`).
*   **Hybrid Retrieval**: Combines **Dense Vector Search** (semantic meaning) and **Sparse Keyword Search** (BM25) using **Reciprocal Rank Fusion (RRF)** for best-of-both-world recall.
*   **Cross-Encoder Reranking**: Re-scores top candidates using a Cross-Encoder model (`ms-marco-MiniLM-L-6-v2`) to filter out false positives and ensure high precision.
*   **Evidence Extraction**: Agents automatically extract "proof snippets" from resumes to explain *why* a candidate matches.

### 💻 Professional Research Interface
*   **GPT-Style UX**: Modern 3-panel layout with specific "Mission Control" features for recruiters.
*   **Persistent Sessions**: Search sessions are saved to MongoDB, allowing users to return to previous searches, view history, and resume analysis.
*   **Real-time Agent transparency**: "Glass box" UI shows the agent's thought process, tool calls, and stage progression in real-time via Server-Sent Events (SSE).
*   **Weak Match Fallback**: Intelligent handling of low-confidence results with clear UI signaling.

### 🏗️ Enterprise-Grade Architecture
*   **Microservices**: Decoupled Node.js API Gateway (auth/sessions) and Python ML Service (heavy lifting).
*   **Dockerized**: Fully containerized setup for consistent deployment.
*   **Privacy-First**: PII (Personally Identifiable Information) is redacted during ingestion to prevent model leakage.

---

## 🏗️ Architecture

```mermaid
graph TD
    Client[React Client (Vite)] <-->|REST / SSE| Node[Node.js API Gateway]
    Node <-->|Internal API| Python[Python ML Service (FastAPI)]
    
    subgraph "Agentic Pipeline (LangGraph)"
        start((Start)) --> Intent[Query Analysis Agent]
        Intent --> Retrieval[Hybrid Retrieval Tool]
        Retrieval --> Rerank[Cross-Encoder Reranker]
        Rerank --> Evidence[Evidence Extraction]
        Evidence --> Assembly[Final Assembly]
    end
    
    Python -->|Orchestrates| Agentic Pipeline
    
    Retrieval <-->|Vector Search| Mongo[MongoDB (Atlas/Local)]
    Node <-->|Session Store| Mongo
```

---

## 🤖 The Agentic Pipeline (Deep Dive)

The core of the system is a **LangGraph** state machine that orchestrates the search process:

1.  **Stage 1: Intent Analysis** (`jd_agent.py`)
    *   **Model**: OpenAI GPT-4o-mini
    *   **Goal**: Converts natural language into a `MissionSpec` JSON object containing:
        *   `keywords`: Mandatory technical skills.
        *   `experience_level`: Years of experience required.
        *   `domain`: Core domain (e.g., "Full Stack", "Data Science").
        *   `constraints`: Location, education, etc.

2.  **Stage 2: Hybrid Retrieval** (`retriever.py`)
    *   **Dense Search**: Embeds the query using `sentence-transformers/all-MiniLM-L6-v2` and finds nearest neighbors in the resume vector space.
    *   **Sparse Search**: Uses keyword matching (MongoDB text search/regex) to find specific hard skills.
    *   **Fusion**: Merges lists using **RRF (Reciprocal Rank Fusion)**, giving higher weight to candidates that appear in both streams.

3.  **Stage 3: Information Gain (Reranking)** (`reranker.py`)
    *   **Model**: `cross-encoder/ms-marco-MiniLM-L-6-v2`
    *   **Action**: Takes the top ~50 pairs of (Query, Resume Chunk) and predicts a relevance score (0-1).
    *   **Benefit**: Cross-encoders are computationally expensive but strictly more accurate than bi-encoders (vectors) because they attend to the query and document simultaneously.

4.  **Stage 4: Evidence & Assembly** (`assembly.py`)
    *   **Action**: Selects the highest-scoring text chunks for each candidate.
    *   **Fallback**: If strict filtering removes all candidates, the agent automatically triggers a "Weak Match" fallback mode, returning top candidates with a warning flag (`match_quality="weak"`), ensuring the user isn't left with an empty screen.

---

## 🛠️ Technology Stack

### Frontend
*   **Framework**: React 18 + Vite
*   **State Management**: React Hooks + Context API
*   **Styling**: Custom CSS variables (Glassmorphism design system)
*   **Streaming**: `fetch-event-source` for real-time agent events

### Backend (API Gateway)
*   **Runtime**: Node.js 18 + Express
*   **Database**: Mongoose (ODM)
*   **Features**: Session management, CRUD operations, Proxy to ML service

### ML Service
*   **Runtime**: Python 3.10 + FastAPI
*   **Orchestration**: LangChain + LangGraph
*   **LLM**: OpenAI (GPT-3.5/4o)
*   **Vector Models**: `sentence-transformers`, `HuggingFace`
*   **Server**: Uvicorn

### Data & Infrastructure
*   **Database**: MongoDB (stores Vectors + Metadata + Sessions)
*   **Containerization**: Docker & Docker Compose

---

## 🚀 Getting Started

### Prerequisites
*   Docker & Docker Compose installed.
*   OpenAI API Key.
*   MongoDB Instance (Local or Atlas URI).

### 1. Environment Setup
Create a `.env` file in the root directory:

```ini
# Core
OPENAI_API_KEY=sk-...
MONGO_URI=mongodb://mongo:27017  # or your Atlas URI

# ML Service Config
OPENAI_MODEL=gpt-4o-mini
EMBEDDING_MODEL_NAME=all-MiniLM-L6-v2
RERANK_MODEL_NAME=cross-encoder/ms-marco-MiniLM-L-6-v2

# Pipeline Tunables
K_DENSE=300
K_SPARSE=300
MIN_RELEVANCE_SCORE=20
```

### 2. Run with Docker Compose
The easiest way to start the entire capabilities stack:

```bash
docker-compose up --build
```
This starts:
*   `mongo` (Database)
*   `ml-service` (Python Agent API @ port 8000)
*   `server` (Node.js API @ port 5000)
*   `client` (React App @ port 3000)

### 3. Verification
Visit **http://localhost:3000**.
1.  Click **"🤖 AI Agent Search"**.
2.  Type a query: *"Senior Frontend Engineer with React and TypeScript, at least 5 years experience, preferably in London."*
3.  Watch the agents break down the request, search the database, rerank results, and present a shortlist.

---

## 📚 Data Ingestion (Optional)
If you need to ingest new resumes:

1.  Place raw JSON/PDF data in `ingestion/data/`.
2.  Run the ingestion script:
    ```bash
    cd ingestion
    pip install -r requirements.txt
    python ingest.py
    ```
    This script handles:
    *   **PII Redaction**: Removes names/emails before embedding.
    *   **Chunking**: Splits resumes into semantic sections (Experience, Skills, Summary).
    *   **Vectorization**: Creates embeddings for each chunk.

---

## 🔒 Security & Performance
*   **PII Safety**: Resume text is scanned for patterns (email, phone) and redacted before embedding.
*   **Optimization**: 
    *   `node_modules` cached in Docker volumes.
    *   ML models downloaded once and cached to `ai-models` volume.
    *   React build optimized with Vite.

---

*Built with ❤️ by the Agentic AI Team.*
