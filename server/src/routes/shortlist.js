/**
 * POST /api/shortlist — SSE proxy to Python agent pipeline.
 * Streams real-time agent events from the ML service to the frontend.
 */

const express = require("express");
const router = express.Router();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

router.post("/", async (req, res) => {
    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    try {
        const response = await fetch(`${ML_SERVICE_URL}/agents/shortlist`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            res.write(`event: error\ndata: ${JSON.stringify({ message: errorText })}\n\n`);
            res.end();
            return;
        }

        // Pipe the SSE stream through
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk);
        }

        res.end();
    } catch (err) {
        console.error("Shortlist proxy error:", err);
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
        res.end();
    }
});

module.exports = router;
