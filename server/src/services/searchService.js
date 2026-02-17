/**
 * Search service: candidate gating, hybrid retrieval, rank fusion, scoring.
 */

const mongoose = require("mongoose");
const ResumeSkill = require("../models/resumeSkill");
const ResumeChunk = require("../models/resumeChunk");
const { normalizeSkills } = require("../utils/skillNormalization");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

/**
 * Gate candidates via skills ledger (deterministic).
 * Returns { resumeId, matchedSkills, matchedCount }[]
 */
async function gateCandidates(normalizedSkills, mode, minMatch) {
    const threshold =
        mode === "match_all" ? normalizedSkills.length : minMatch || 1;

    // Aggregation: find resumes that have at least `threshold` of the requested skills
    const pipeline = [
        { $match: { skillCanonical: { $in: normalizedSkills } } },
        {
            $group: {
                _id: "$resumeId",
                matchedSkills: { $push: "$skillCanonical" },
                matchedCount: { $sum: 1 },
                avgConfidence: { $avg: "$confidence" },
            },
        },
        { $match: { matchedCount: { $gte: threshold } } },
        { $sort: { matchedCount: -1, avgConfidence: -1 } },
    ];

    const results = await ResumeSkill.aggregate(pipeline);

    return results.map((r) => ({
        resumeId: r._id,
        matchedSkills: r.matchedSkills,
        matchedCount: r.matchedCount,
        avgConfidence: r.avgConfidence,
    }));
}

/**
 * Lexical search on chunk text (regex-based fallback for local MongoDB).
 */
async function lexicalSearch(query, candidateIds, limit = 200) {
    // Build regex from query terms (OR search)
    const terms = query
        .split(/[,;\s]+/)
        .filter((t) => t.length > 1)
        .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

    if (terms.length === 0) return [];

    const regexPattern = terms.join("|");

    const chunks = await ResumeChunk.find(
        {
            resumeId: { $in: candidateIds },
            chunkText: { $regex: regexPattern, $options: "i" },
        },
        { chunkId: 1, resumeId: 1, sectionType: 1, sectionOrdinal: 1, chunkText: 1 }
    )
        .limit(limit)
        .lean();

    // Score chunks by number of term matches
    return chunks.map((chunk, idx) => {
        let score = 0;
        for (const term of terms) {
            const regex = new RegExp(term, "gi");
            const matches = chunk.chunkText.match(regex);
            if (matches) score += matches.length;
        }
        return { ...chunk, score, rank: idx + 1 };
    }).sort((a, b) => b.score - a.score);
}

/**
 * Vector search: get query embedding from ML service, then compute cosine similarity.
 * For local MongoDB (no $vectorSearch), we fetch embeddings and compute in Node.
 */
async function vectorSearch(querySkills, candidateIds, limit = 200) {
    try {
        // Get query embedding
        const queryText = `Skills: ${querySkills.join("; ")}.`;
        const response = await fetch(`${ML_SERVICE_URL}/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ texts: [queryText] }),
        });

        if (!response.ok) {
            console.warn("ML service /embed failed, skipping vector search");
            return [];
        }

        const data = await response.json();
        const queryEmbedding = data.embeddings[0];

        // Fetch candidate chunks with embeddings
        const chunks = await ResumeChunk.find(
            { resumeId: { $in: candidateIds } },
            {
                chunkId: 1,
                resumeId: 1,
                sectionType: 1,
                sectionOrdinal: 1,
                chunkText: 1,
                embedding: 1,
            }
        ).lean();

        // Compute cosine similarity
        const scored = chunks
            .filter((c) => c.embedding && c.embedding.length > 0)
            .map((chunk) => {
                const sim = cosineSimilarity(queryEmbedding, chunk.embedding);
                return {
                    chunkId: chunk.chunkId,
                    resumeId: chunk.resumeId,
                    sectionType: chunk.sectionType,
                    sectionOrdinal: chunk.sectionOrdinal,
                    chunkText: chunk.chunkText,
                    score: sim,
                };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        return scored.map((s, idx) => ({ ...s, rank: idx + 1 }));
    } catch (err) {
        console.warn("Vector search failed:", err.message);
        return [];
    }
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
}

/**
 * Reciprocal Rank Fusion.
 * Aggregates chunk-level results to resume-level, then computes RRF scores.
 */
function reciprocalRankFusion(lexicalResults, vectorResults, k = 60) {
    // Aggregate to resume level: best rank per resume per list
    const lexicalResumeRanks = aggregateToResumeRanks(lexicalResults);
    const vectorResumeRanks = aggregateToResumeRanks(vectorResults);

    // Collect all resume IDs
    const allResumeIds = new Set([
        ...Object.keys(lexicalResumeRanks),
        ...Object.keys(vectorResumeRanks),
    ]);

    // Compute RRF scores
    const rrfScores = {};
    for (const id of allResumeIds) {
        let score = 0;
        if (lexicalResumeRanks[id] !== undefined) {
            score += 1.0 / (k + lexicalResumeRanks[id]);
        }
        if (vectorResumeRanks[id] !== undefined) {
            score += 1.0 / (k + vectorResumeRanks[id]);
        }
        rrfScores[id] = score;
    }

    return rrfScores;
}

function aggregateToResumeRanks(results) {
    const resumeRanks = {};
    for (const r of results) {
        const current = resumeRanks[r.resumeId];
        if (current === undefined || r.rank < current) {
            resumeRanks[r.resumeId] = r.rank;
        }
    }
    return resumeRanks;
}

/**
 * Collect best evidence chunks per resume.
 */
function collectEvidence(lexicalResults, vectorResults) {
    const evidenceMap = {}; // resumeId -> { chunkText, sectionType, sectionOrdinal, score }[]

    const addEvidence = (results) => {
        for (const r of results) {
            if (!evidenceMap[r.resumeId]) {
                evidenceMap[r.resumeId] = [];
            }
            // Avoid duplicates
            const exists = evidenceMap[r.resumeId].find(
                (e) =>
                    e.sectionType === r.sectionType &&
                    e.sectionOrdinal === r.sectionOrdinal
            );
            if (!exists) {
                evidenceMap[r.resumeId].push({
                    chunkText: r.chunkText,
                    sectionType: r.sectionType,
                    sectionOrdinal: r.sectionOrdinal,
                    score: r.score || 0,
                });
            }
        }
    };

    addEvidence(lexicalResults);
    addEvidence(vectorResults);

    // Sort evidence per resume by score, keep top 3
    for (const id of Object.keys(evidenceMap)) {
        evidenceMap[id].sort((a, b) => b.score - a.score);
        evidenceMap[id] = evidenceMap[id].slice(0, 3);
    }

    return evidenceMap;
}

/**
 * Build final ranked results.
 */
function buildFinalResults(
    candidates,
    rrfScores,
    evidenceMap,
    totalQuerySkills,
    limit
) {
    // Merge candidate info with RRF scores
    const results = candidates.map((c) => {
        const rrfScore = rrfScores[c.resumeId] || 0;
        const coverageRatio = c.matchedCount / totalQuerySkills;

        // rrfScore is typically 1/(k+rank) + 1/(k+rank). Max for k=60 is ~0.033
        // Let's scale RRF to ~0-50 and Coverage to ~0-50
        const semanticScore = Math.min(rrfScore * 1500, 50); // Scale RRF to 0-50
        const skillScore = coverageRatio * 50;              // Scale Coverage to 0-50
        const finalScore = semanticScore + skillScore;

        return {
            resumeId: c.resumeId,
            matchedSkills: c.matchedSkills,
            matchedCount: c.matchedCount,
            totalQuerySkills,
            coverageRatio: Math.round(coverageRatio * 100) / 100,
            rrfScore: Math.round(rrfScore * 10000) / 10000,
            semanticScore: Math.round(semanticScore * 10) / 10,
            skillScore: Math.round(skillScore * 10) / 10,
            finalScore: Math.round(finalScore * 10) / 10,
            evidence: evidenceMap[c.resumeId] || [],
        };
    });

    // Sort by final score
    results.sort((a, b) => b.finalScore - a.finalScore);

    return results.slice(0, limit);
}

module.exports = {
    gateCandidates,
    lexicalSearch,
    vectorSearch,
    reciprocalRankFusion,
    collectEvidence,
    buildFinalResults,
};
