const mongoose = require("mongoose");

const resumeChunkSchema = new mongoose.Schema(
    {
        chunkId: { type: String, required: true, unique: true },
        resumeId: { type: String, required: true, index: true },
        sectionType: {
            type: String,
            enum: ["summary", "experience", "project", "education", "skills"],
        },
        sectionOrdinal: Number,
        chunkText: String,
        embedding: [Number],
        skillsInChunk: [String],
        startDate: String,
        endDate: String,
    },
    { collection: "resume_chunks" }
);

module.exports = mongoose.model("ResumeChunk", resumeChunkSchema);
