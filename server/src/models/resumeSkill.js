const mongoose = require("mongoose");

const resumeSkillSchema = new mongoose.Schema(
    {
        resumeId: { type: String, required: true, index: true },
        skillCanonical: { type: String, required: true, index: true },
        evidenceCount: Number,
        evidenceSources: [String],
        confidence: Number,
        lastSeen: String,
    },
    { collection: "resume_skills" }
);

resumeSkillSchema.index({ resumeId: 1, skillCanonical: 1 }, { unique: true });

module.exports = mongoose.model("ResumeSkill", resumeSkillSchema);
