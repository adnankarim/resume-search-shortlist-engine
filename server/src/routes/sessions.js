/**
 * /api/sessions — CRUD endpoints for persistent search sessions.
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Session = require("../models/session");

const router = express.Router();

/**
 * GET /api/sessions — List all sessions, grouped-ready (sorted by updatedAt desc).
 * Returns lightweight list (no results/agentEvents to keep it fast).
 */
router.get("/", async (req, res) => {
    try {
        const sessions = await Session.find(
            {},
            {
                sessionId: 1,
                title: 1,
                queryText: 1,
                status: 1,
                totalTime: 1,
                totalCandidatesFound: 1,
                createdAt: 1,
                updatedAt: 1,
            }
        )
            .sort({ updatedAt: -1 })
            .limit(100)
            .lean();

        res.json({ sessions });
    } catch (err) {
        console.error("Error listing sessions:", err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/sessions/:id — Get full session with results and events.
 */
router.get("/:id", async (req, res) => {
    try {
        const session = await Session.findOne({
            sessionId: req.params.id,
        }).lean();

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        res.json({ session });
    } catch (err) {
        console.error("Error fetching session:", err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/sessions — Create a new session.
 * Body: { queryText, title? }
 * Returns the created session with its sessionId.
 */
router.post("/", async (req, res) => {
    try {
        const { queryText, title } = req.body;

        if (!queryText || !queryText.trim()) {
            return res.status(400).json({ error: "queryText is required" });
        }

        // Auto-generate title from first ~60 chars of query
        const autoTitle =
            title ||
            queryText.trim().slice(0, 60) + (queryText.length > 60 ? "…" : "");

        const session = await Session.create({
            sessionId: uuidv4(),
            queryText: queryText.trim(),
            title: autoTitle,
            status: "running",
        });

        res.status(201).json({ session: session.toObject() });
    } catch (err) {
        console.error("Error creating session:", err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/sessions/:id — Update session (save results, events, status, etc.)
 * Body: any subset of { title, status, missionSpec, results, agentEvents, stageTimings, totalTime, totalCandidatesFound }
 */
router.put("/:id", async (req, res) => {
    try {
        const allowedFields = [
            "title",
            "status",
            "missionSpec",
            "results",
            "agentEvents",
            "stageTimings",
            "totalTime",
            "totalCandidatesFound",
        ];

        const update = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                update[field] = req.body[field];
            }
        }

        const session = await Session.findOneAndUpdate(
            { sessionId: req.params.id },
            { $set: update },
            { new: true }
        ).lean();

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        res.json({ session });
    } catch (err) {
        console.error("Error updating session:", err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/sessions/:id — Delete a session.
 */
router.delete("/:id", async (req, res) => {
    try {
        const result = await Session.deleteOne({ sessionId: req.params.id });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Error deleting session:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
