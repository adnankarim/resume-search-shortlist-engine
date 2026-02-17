/**
 * Script to create MongoDB indexes.
 * Run this after ingestion to ensure optimal query performance.
 *
 * Usage: node scripts/create_indexes.js
 */

const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB = process.env.MONGO_DB || "resume_search";

async function createIndexes() {
    const client = new MongoClient(MONGO_URI, {
        serverApi: {
            version: ServerApiVersion.v1,
        },
    });
    await client.connect();
    const db = client.db(MONGO_DB);

    console.log("Creating indexes...\n");

    // resumes_core
    await db.collection("resumes_core").createIndex({ resumeId: 1 }, { unique: true });
    await db.collection("resumes_core").createIndex({ totalYOE: 1 });
    await db.collection("resumes_core").createIndex({ locationCountry: 1 });
    console.log("✓ resumes_core indexes created");

    // resumes_pii
    await db.collection("resumes_pii").createIndex({ resumeId: 1 }, { unique: true });
    console.log("✓ resumes_pii indexes created");

    // resume_skills
    await db.collection("resume_skills").createIndex(
        { resumeId: 1, skillCanonical: 1 },
        { unique: true }
    );
    await db.collection("resume_skills").createIndex({ skillCanonical: 1 });
    await db.collection("resume_skills").createIndex({ resumeId: 1 });
    console.log("✓ resume_skills indexes created");

    // resume_chunks
    await db.collection("resume_chunks").createIndex({ chunkId: 1 }, { unique: true });
    await db.collection("resume_chunks").createIndex({ resumeId: 1 });
    await db.collection("resume_chunks").createIndex({ sectionType: 1 });
    console.log("✓ resume_chunks indexes created");

    // Text index for lexical search (if using MongoDB text search instead of regex)
    await db.collection("resume_chunks").createIndex(
        { chunkText: "text" },
        { name: "chunks_text" }
    );
    console.log("✓ Text search index created on resume_chunks.chunkText");

    console.log("\nAll indexes created successfully!");

    // Print collection stats
    const collections = ["resumes_core", "resumes_pii", "resume_skills", "resume_chunks"];
    console.log("\nCollection stats:");
    for (const col of collections) {
        const count = await db.collection(col).countDocuments();
        console.log(`  ${col}: ${count} documents`);
    }

    await client.close();
}

createIndexes().catch((err) => {
    console.error("Failed to create indexes:", err);
    process.exit(1);
});
