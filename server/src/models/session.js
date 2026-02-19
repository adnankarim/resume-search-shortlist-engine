const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
    {
        sessionId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        title: {
            type: String,
            default: "New Search",
        },
        queryText: {
            type: String,
            required: true,
        },
        status: {
            type: String,
            enum: ["running", "completed", "failed"],
            default: "running",
        },
        missionSpec: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
        results: {
            type: [mongoose.Schema.Types.Mixed],
            default: [],
        },
        agentEvents: {
            type: [mongoose.Schema.Types.Mixed],
            default: [],
        },
        stageTimings: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        totalTime: {
            type: Number,
            default: 0,
        },
        totalCandidatesFound: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true, // adds createdAt, updatedAt
    }
);

// Index for listing sessions sorted by recent
sessionSchema.index({ updatedAt: -1 });

module.exports = mongoose.model("Session", sessionSchema);
