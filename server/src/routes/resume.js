/**
 * GET /api/resume/:resumeId — View candidate profile
 */

const express = require("express");
const router = express.Router();
const ResumeCore = require("../models/resumeCore");
const ResumeChunk = require("../models/resumeChunk");
const ResumeSkill = require("../models/resumeSkill");

router.get("/count", async (req, res) => {
    try {
        const count = await ResumeCore.countDocuments();
        res.json({ count });
    } catch (err) {
        console.error("Count fetch error:", err);
        res.status(500).json({ error: "Failed to fetch count" });
    }
});

router.get("/:resumeId", async (req, res) => {
    try {
        const { resumeId } = req.params;

        // Get core profile (no PII)
        const profile = await ResumeCore.findOne({ resumeId }).lean();
        if (!profile) {
            return res.status(404).json({ error: "Resume not found" });
        }

        // Get skills ledger
        const skills = await ResumeSkill.find({ resumeId })
            .sort({ confidence: -1 })
            .lean();

        // Get chunks (without embeddings, for display)
        const chunks = await ResumeChunk.find(
            { resumeId },
            { embedding: 0 }
        )
            .sort({ sectionType: 1, sectionOrdinal: 1 })
            .lean();

        res.json({
            profile,
            skills: skills.map((s) => ({
                skill: s.skillCanonical,
                confidence: s.confidence,
                evidenceCount: s.evidenceCount,
                sources: s.evidenceSources,
            })),
            chunks: chunks.map((c) => ({
                sectionType: c.sectionType,
                sectionOrdinal: c.sectionOrdinal,
                chunkText: c.chunkText,
                skillsInChunk: c.skillsInChunk,
            })),
        });
    } catch (err) {
        console.error("Resume fetch error:", err);
        res.status(500).json({ error: "Failed to fetch resume" });
    }
});

router.delete("/:resumeId", async (req, res) => {
    try {
        const { resumeId } = req.params;

        // Delete from all collections
        await Promise.all([
            ResumeCore.deleteMany({ resumeId }),
            ResumeSkill.deleteMany({ resumeId }),
            ResumeChunk.deleteMany({ resumeId })
        ]);

        // Note: Vector DB deletion is not implemented in this MVP
        // but the resume will effectively be gone from search results
        // as the main profile is deleted.

        res.json({ status: "success", message: "Resume deleted" });
    } catch (err) {
        console.error("Resume delete error:", err);
        res.status(500).json({ error: "Failed to delete resume" });
    }
});

module.exports = router;
