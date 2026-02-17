/**
 * POST /api/search — Main search endpoint
 */

const express = require("express");
const router = express.Router();
const { normalizeSkills } = require("../utils/skillNormalization");
const ResumeCore = require("../models/resumeCore");
const {
    gateCandidates,
    lexicalSearch,
    vectorSearch,
    reciprocalRankFusion,
    collectEvidence,
    buildFinalResults,
} = require("../services/searchService");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

router.post("/", async (req, res) => {
    try {
        const {
            skills = [],
            mode = "match_all",
            minMatch = 1,
            minYOE,
            locationCountry,
            limit = 50,
            enableRerank = false,
        } = req.body;

        if (!skills || skills.length === 0) {
            return res.status(400).json({ error: "skills[] is required" });
        }

        const startTime = Date.now();

        // 1. Normalize skills
        const normalizedSkills = normalizeSkills(skills);
        if (normalizedSkills.length === 0) {
            return res.status(400).json({ error: "No valid skills after normalization" });
        }

        // 2. Candidate gating
        let candidates = await gateCandidates(normalizedSkills, mode, minMatch);

        if (candidates.length === 0) {
            return res.json({
                results: [],
                meta: {
                    query: { skills: normalizedSkills, mode, minMatch },
                    totalCandidates: 0,
                    latencyMs: Date.now() - startTime,
                },
            });
        }

        // 3. Apply optional filters on candidates
        if (minYOE || locationCountry) {
            const candidateIds = candidates.map((c) => c.resumeId);
            const filterQuery = { resumeId: { $in: candidateIds } };
            if (minYOE) filterQuery.totalYOE = { $gte: minYOE };
            if (locationCountry) {
                filterQuery.locationCountry = { $regex: locationCountry, $options: "i" };
            }

            const filtered = await ResumeCore.find(filterQuery, { resumeId: 1 }).lean();
            const filteredIds = new Set(filtered.map((r) => r.resumeId));
            candidates = candidates.filter((c) => filteredIds.has(c.resumeId));
        }

        const candidateIds = candidates.map((c) => c.resumeId);

        // 4. Hybrid retrieval (parallel)
        const queryText = normalizedSkills.join(", ");
        const [lexResults, vecResults] = await Promise.all([
            lexicalSearch(queryText, candidateIds, 200),
            vectorSearch(normalizedSkills, candidateIds, 200),
        ]);

        // 5. Rank fusion
        const rrfScores = reciprocalRankFusion(lexResults, vecResults);

        // 6. Collect evidence
        const evidenceMap = collectEvidence(lexResults, vecResults);

        // 7. Build final results
        let results = buildFinalResults(
            candidates,
            rrfScores,
            evidenceMap,
            normalizedSkills.length,
            enableRerank ? 100 : limit
        );

        // 8. Optional reranking
        if (enableRerank && results.length > 0) {
            try {
                const rerankDocs = results.map((r) =>
                    r.evidence.map((e) => e.chunkText).join(" | ")
                );

                const rerankResponse = await fetch(`${ML_SERVICE_URL}/rerank`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        query: `Skills: ${normalizedSkills.join("; ")}.`,
                        documents: rerankDocs,
                        top_k: limit,
                    }),
                });

                if (rerankResponse.ok) {
                    const rerankData = await rerankResponse.json();
                    const reranked = rerankData.results.map((r) => ({
                        ...results[r.index],
                        rerankScore: r.score,
                    }));
                    results = reranked;
                }
            } catch (err) {
                console.warn("Reranking failed, using RRF results:", err.message);
            }
        }

        // Truncate to limit
        results = results.slice(0, limit);

        // 9. Enrich with core profile data
        const resumeIds = results.map((r) => r.resumeId);
        const profiles = await ResumeCore.find(
            { resumeId: { $in: resumeIds } },
            {
                resumeId: 1,
                summary: 1,
                totalYOE: 1,
                locationCountry: 1,
                locationCity: 1,
                "experience.title": 1,
                "experience.company": 1,
            }
        ).lean();

        const profileMap = {};
        for (const p of profiles) {
            profileMap[p.resumeId] = p;
        }

        const enrichedResults = results.map((r) => {
            const profile = profileMap[r.resumeId] || {};
            const latestExp = profile.experience?.[0];
            return {
                ...r,
                headline: latestExp
                    ? `${latestExp.title || ""} at ${latestExp.company || ""}`
                    : "No title available",
                totalYOE: profile.totalYOE || 0,
                locationCountry: profile.locationCountry || "",
                locationCity: profile.locationCity || "",
                summary: profile.summary || "",
            };
        });

        const latencyMs = Date.now() - startTime;

        res.json({
            results: enrichedResults,
            meta: {
                query: { skills: normalizedSkills, mode, minMatch },
                totalCandidates: candidates.length,
                resultsReturned: enrichedResults.length,
                latencyMs,
                hybridStats: {
                    lexicalHits: lexResults.length,
                    vectorHits: vecResults.length,
                },
            },
        });
    } catch (err) {
        console.error("Search error:", err);
        res.status(500).json({ error: "Search failed", message: err.message });
    }
});

module.exports = router;
