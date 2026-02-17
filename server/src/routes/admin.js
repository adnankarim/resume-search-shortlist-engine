/**
 * POST /api/admin/ingest — Admin-only ingestion trigger
 */

const express = require("express");
const router = express.Router();

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const fetch = require("node-fetch");
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

// Configure Multer for disk storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, "../../uploads");
        // Ensure directory exists
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, "ingest-" + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

router.post("/ingest", upload.single("file"), async (req, res) => {
    try {
        const { limit } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        // Path inside the container (shared volume)
        // ML service sees /app/uploads
        // Server sees /app/uploads (if mapped correctly)
        // We configured both to map ./uploads (host) -> /app/uploads (container)
        const filePath = `/app/uploads/${file.filename}`;

        console.log(`Triggering ingestion for file: ${filePath}, limit: ${limit}`);

        // Trigger ingestion on ml-service
        const response = await fetch(`${AI_SERVICE_URL}/ingest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                limit: limit ? parseInt(limit) : undefined,
                file_path: filePath
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`ML Service reported error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Ingestion trigger failed:", error);
        res.status(500).json({ error: "Failed to trigger ingestion", details: error.message });
    }
});

module.exports = router;
