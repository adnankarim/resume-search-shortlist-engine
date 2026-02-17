const mongoose = require("mongoose");

const resumePiiSchema = new mongoose.Schema(
    {
        resumeId: { type: String, required: true, unique: true },
        name: String,
        email: String,
        phone: String,
        linkedin: String,
        github: String,
        address: {
            city: String,
            country: String,
        },
    },
    { collection: "resumes_pii" }
);

module.exports = mongoose.model("ResumePii", resumePiiSchema);
