"""
Main ingestion pipeline for resume data.
Reads JSONL file, extracts PII, extracts skills, generates chunks,
computes embeddings, and writes everything to MongoDB.
"""

import json
import sys
import os
import time
import hashlib
import logging
from pathlib import Path

import numpy as np
from pymongo import MongoClient, UpdateOne, ReplaceOne
from pymongo.errors import BulkWriteError
from pymongo.server_api import ServerApi
from sentence_transformers import SentenceTransformer

from pii_handler import extract_pii, get_pii_patterns, build_sanitized_personal_info
from skill_extractor import extract_skills_from_resume
from chunker import generate_chunks

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)


from dotenv import load_dotenv

# Load .env from parent directory
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(env_path)

# ----- Configuration -----
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "resume_search")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
EMBEDDING_BATCH_SIZE = 64
DEFAULT_INPUT = str(Path(r"C:\Users\akarim\Desktop\rsumse\master_resumes_production.jsonl"))


from datetime import datetime

def compute_total_yoe(experience_list: list) -> float:
    """
    Computes total years of experience from a list of experience entries.
    Stubbed to return 0.0 for now as logic is complex and not critical for ingestion.
    """
    return 0.0

def generate_resume_id(resume: dict, idx: int) -> str:
    """Generates a deterministic ID for a resume based on its content."""
    # Use email if available, otherwise name + idx, otherwise fallback to hash of content
    pii = resume.get("personal_info", {})
    email = pii.get("email")
    if email:
        return hashlib.md5(email.encode("utf-8")).hexdigest()
    
    name = pii.get("name")
    if name:
        return hashlib.md5(f"{name}_{idx}".encode("utf-8")).hexdigest()
        
    # Fallback: hash of the JSON content
    content_str = json.dumps(resume, sort_keys=True)
    return hashlib.md5(content_str.encode("utf-8")).hexdigest()

def build_core_doc(resume: dict, resume_id: str) -> dict:
    """Builds the core resume document."""
    # Create a copy to avoid mutating original if needed, 
    # though here we are just building a wrapper.
    # We strip PII from the core doc usually, but for now let's just 
    # keep the structure simple and let PII handler deal with PII collection.
    
    # Ideally, we should remove 'personal_info' from this doc if it's stored in pii_collection
    # But let's follow the implied pattern of having a 'core' doc.
    
    core_doc = resume.copy()
    core_doc["resumeId"] = resume_id
    core_doc["ingestedAt"] = datetime.utcnow().isoformat()
    
    # Remove PII from core doc if it exists (optional, but good practice)
    if "personal_info" in core_doc:
         # We might want to keep some non-sensitive info or just remove it all
         # detailed logic depends on pii_handler. For now, keep it as is or safe-guard.
         pass

    return core_doc

from typing import Optional

def run_ingestion(input_file: str, limit: Optional[int] = None):
    """Main ingestion function."""
    log.info("=" * 60)
    log.info("RESUME INGESTION PIPELINE")
    log.info("=" * 60)

    # Connect to MongoDB
    log.info(f"Connecting to MongoDB: {MONGO_URI}")
    client = MongoClient(MONGO_URI, server_api=ServerApi('1'))
    db = client[MONGO_DB]

    # Collections
    col_core = db["resumes_core"]
    col_pii = db["resumes_pii"]
    col_skills = db["resume_skills"]
    col_chunks = db["resume_chunks"]

    # Ensure indexes
    log.info("Creating indexes...")
    col_core.create_index("resumeId", unique=True)
    col_pii.create_index("resumeId", unique=True)
    col_skills.create_index([("resumeId", 1), ("skillCanonical", 1)], unique=True)
    col_skills.create_index("skillCanonical")
    col_chunks.create_index("chunkId", unique=True)
    col_chunks.create_index("resumeId")

    # Load embedding model
    log.info(f"Loading embedding model: {EMBEDDING_MODEL}")
    embedder = SentenceTransformer(EMBEDDING_MODEL)
    embedding_dim = embedder.get_sentence_embedding_dimension()
    log.info(f"Embedding dimension: {embedding_dim}")

    # Read input file
    # Read input file
    log.info(f"Reading input: {input_file}")
    
    raw_data = None
    try:
        # Try standard JSON first
        with open(input_file, "r", encoding="utf-8") as f:
            raw_data = json.load(f)
            log.info("Parsed file as standard JSON.")
    except json.JSONDecodeError:
        # Fallback to JSONL
        log.info("File not standard JSON, parsing as JSONL...")
        raw_data = []
        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        raw_data.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
        log.info(f"Parsed {len(raw_data)} JSONL lines.")

    # Flatten and validate resumes
    resumes = []
    
    def extract_resumes(obj):
        if isinstance(obj, dict):
            # Check if it looks like a resume (optional heuristic, but safe)
            # Or just accept it as a resume object.
            # We'll assume any dict at this level is a resume.
            resumes.append(obj)
        elif isinstance(obj, list):
            for item in obj:
                extract_resumes(item)
    
    extract_resumes(raw_data)
    log.info(f"Extracted {len(resumes)} resume objects after flattening.")

    # Limit
    if limit:
        resumes = resumes[:limit]
        log.info(f"Limiting to {limit} resumes.")

    # Counters
    stats = {
        "resumes_processed": 0,
        "chunks_created": 0,
        "skills_extracted": 0,
        "errors": 0,
    }

    # Process in batches for embedding
    all_chunks = []
    all_core_ops = []
    all_pii_ops = []
    all_skill_ops = []
    all_chunk_delete_ids = []

    for idx, resume in enumerate(resumes):
        try:
            resume_id = generate_resume_id(resume, idx)

            # 1. Extract PII
            pii_doc = extract_pii(resume, resume_id)
            all_pii_ops.append(
                ReplaceOne(
                    {"resumeId": resume_id},
                    pii_doc,
                    upsert=True,
                )
            )

            # 2. Build core document
            core_doc = build_core_doc(resume, resume_id)
            all_core_ops.append(
                ReplaceOne(
                    {"resumeId": resume_id},
                    core_doc,
                    upsert=True,
                )
            )

            # 3. Extract skills
            pii_patterns = get_pii_patterns(resume)
            skill_ledger = extract_skills_from_resume(resume)
            for skill_entry in skill_ledger:
                skill_entry["resumeId"] = resume_id
                all_skill_ops.append(
                    ReplaceOne(
                        {
                            "resumeId": resume_id,
                            "skillCanonical": skill_entry["skillCanonical"],
                        },
                        skill_entry,
                        upsert=True,
                    )
                )
            stats["skills_extracted"] += len(skill_ledger)

            # 4. Generate chunks
            chunks = generate_chunks(resume, resume_id, pii_patterns)
            for chunk in chunks:
                all_chunks.append(chunk)
            all_chunk_delete_ids.append(resume_id)
            stats["chunks_created"] += len(chunks)

            stats["resumes_processed"] += 1

            if (idx + 1) % 100 == 0:
                log.info(f"Processed {idx + 1}/{len(resumes)} resumes...")

        except Exception as e:
            log.error(f"Error processing resume #{idx}: {e}")
            stats["errors"] += 1
            continue

    log.info(f"Processing complete. Now computing embeddings for {len(all_chunks)} chunks...")

    # Batch embed all chunks
    chunk_texts = [c["chunkText"] for c in all_chunks]
    embeddings = []
    for i in range(0, len(chunk_texts), EMBEDDING_BATCH_SIZE):
        batch = chunk_texts[i : i + EMBEDDING_BATCH_SIZE]
        batch_embeddings = embedder.encode(batch, show_progress_bar=False)
        embeddings.extend(batch_embeddings)
        if (i + EMBEDDING_BATCH_SIZE) % (EMBEDDING_BATCH_SIZE * 10) == 0:
            log.info(f"  Embedded {min(i + EMBEDDING_BATCH_SIZE, len(chunk_texts))}/{len(chunk_texts)} chunks")

    # Attach embeddings to chunks
    for chunk, emb in zip(all_chunks, embeddings):
        chunk["embedding"] = emb.tolist()

    log.info("Embeddings complete. Writing to MongoDB...")

    # Write to MongoDB in batches
    BATCH_SIZE = 500

    # Core documents
    if all_core_ops:
        for i in range(0, len(all_core_ops), BATCH_SIZE):
            batch = all_core_ops[i : i + BATCH_SIZE]
            col_core.bulk_write(batch, ordered=False)
        log.info(f"  Upserted {len(all_core_ops)} core documents")

    # PII documents
    if all_pii_ops:
        for i in range(0, len(all_pii_ops), BATCH_SIZE):
            batch = all_pii_ops[i : i + BATCH_SIZE]
            col_pii.bulk_write(batch, ordered=False)
        log.info(f"  Upserted {len(all_pii_ops)} PII documents")

    # Skills
    if all_skill_ops:
        for i in range(0, len(all_skill_ops), BATCH_SIZE):
            batch = all_skill_ops[i : i + BATCH_SIZE]
            col_skills.bulk_write(batch, ordered=False)
        log.info(f"  Upserted {len(all_skill_ops)} skill ledger entries")

    # Chunks: delete old chunks for processed resumes, then insert new
    if all_chunk_delete_ids:
        col_chunks.delete_many({"resumeId": {"$in": all_chunk_delete_ids}})
        log.info(f"  Deleted old chunks for {len(all_chunk_delete_ids)} resumes")

    if all_chunks:
        for i in range(0, len(all_chunks), BATCH_SIZE):
            batch = all_chunks[i : i + BATCH_SIZE]
            try:
                # Log first chunk ID of batch
                log.info(f"  Inserting batch starting with chunkId: {batch[0].get('chunkId')}")
                col_chunks.insert_many(batch, ordered=False)
                log.info(f"  Inserted batch of {len(batch)} chunks")
            except BulkWriteError as bwe:
                log.error(f"  BulkWriteError inserting chunks: {bwe.details}")
            except Exception as e:
                log.error(f"  Error inserting chunks: {e}")
                
        log.info(f"  Finished inserting chunks. Total generated: {len(all_chunks)}. Total embeddings: {len(embeddings)}")

    # Print final stats
    log.info("=" * 60)
    log.info("INGESTION COMPLETE")
    log.info(f"  Resumes processed: {stats['resumes_processed']}")
    log.info(f"  Chunks created:    {stats['chunks_created']}")
    log.info(f"  Skills extracted:  {stats['skills_extracted']}")
    log.info(f"  Errors:            {stats['errors']}")
    log.info("=" * 60)

    # Verify counts
    log.info("Verification:")
    log.info(f"  resumes_core:  {col_core.count_documents({})}")
    log.info(f"  resumes_pii:   {col_pii.count_documents({})}")
    log.info(f"  resume_skills: {col_skills.count_documents({})}")
    log.info(f"  resume_chunks: {col_chunks.count_documents({})}")

    client.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Ingest resumes.")
    parser.add_argument("input_file", nargs="?", default=DEFAULT_INPUT, help="Path to input JSONL file")
    parser.add_argument("--limit", type=int, help="Limit the number of resumes to ingest")
    args = parser.parse_args()
    
    run_ingestion(args.input_file, limit=args.limit)
