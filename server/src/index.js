const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const mongoose = require("mongoose");
const path = require("path");

// Load env
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const searchRoutes = require("./routes/search");
const resumeRoutes = require("./routes/resume");
const adminRoutes = require("./routes/admin");
const shortlistRoutes = require("./routes/shortlist");
const sessionsRoutes = require("./routes/sessions");

const app = express();
const PORT = process.env.PORT || 3001;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB = process.env.MONGO_DB || "resume_search";

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));

// Routes
app.use("/api/search", searchRoutes);
app.use("/api/resume", resumeRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/shortlist", shortlistRoutes);
app.use("/api/sessions", sessionsRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error", message: err.message });
});

// Connect to MongoDB and start server
async function start() {
  try {
    const mongoUrl = `${MONGO_URI}/${MONGO_DB}`;
    await mongoose.connect(mongoUrl, {
      serverApi: { version: "1" },
    });
    console.log(`Connected to MongoDB: ${mongoUrl}`);

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
