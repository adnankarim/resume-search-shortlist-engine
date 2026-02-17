const mongoose = require("mongoose");

const resumeCoreSchema = new mongoose.Schema(
    {
        resumeId: { type: String, required: true, unique: true, index: true },
        summary: String,
        locationCountry: String,
        locationCity: String,
        remotePreference: String,
        totalYOE: Number,
        experience: [mongoose.Schema.Types.Mixed],
        projects: [mongoose.Schema.Types.Mixed],
        education: [mongoose.Schema.Types.Mixed],
        skills: mongoose.Schema.Types.Mixed,
        certifications: [mongoose.Schema.Types.Mixed],
        updatedAt: String,
    },
    { collection: "resumes_core" }
);

module.exports = mongoose.model("ResumeCore", resumeCoreSchema);
