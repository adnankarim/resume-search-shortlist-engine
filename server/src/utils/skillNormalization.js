/**
 * Skill normalization utility for query-time processing.
 * Must stay in sync with ingestion/skill_aliases.py
 */

const SKILL_ALIASES = {
    // Programming Languages
    "ml": "machine learning",
    "js": "javascript",
    "ts": "typescript",
    "py": "python",
    "rb": "ruby",
    "c#": "csharp",
    "c sharp": "csharp",
    "c++": "cpp",
    "cplusplus": "cpp",
    "golang": "go",
    "objective c": "objective-c",
    "obj-c": "objective-c",
    "visual basic 6.0": "visual basic",
    "vb": "visual basic",

    // AI/ML
    "dl": "deep learning",
    "nlp": "natural language processing",
    "cv": "computer vision",
    "ai": "artificial intelligence",
    "llm": "large language models",
    "llms": "large language models",
    "genai": "generative ai",
    "gen ai": "generative ai",
    "rl": "reinforcement learning",
    "nn": "neural networks",
    "cnn": "convolutional neural networks",
    "rnn": "recurrent neural networks",
    "lstm": "long short-term memory",
    "gan": "generative adversarial networks",
    "sklearn": "scikit-learn",
    "scikit learn": "scikit-learn",
    "svm": "support vector machines",
    "support vector machine": "support vector machines",

    // Frameworks
    "tf": "tensorflow",
    "react.js": "react",
    "reactjs": "react",
    "react js": "react",
    "vue.js": "vue",
    "vuejs": "vue",
    "angular.js": "angular",
    "angularjs": "angular",
    "next.js": "nextjs",
    "nuxt.js": "nuxtjs",
    "express.js": "express",
    "expressjs": "express",
    "express js": "express",
    "node.js": "nodejs",
    "nodejs": "nodejs",
    "node js": "nodejs",
    "node": "nodejs",
    "fast api": "fastapi",
    "spring boot": "spring boot",
    "springboot": "spring boot",
    ".net": ".net",
    "dotnet": ".net",
    "rails": "ruby on rails",
    "ror": "ruby on rails",
    "tailwind": "tailwindcss",
    "tailwind css": "tailwindcss",
    "material ui": "material ui",
    "mui": "material ui",

    // Databases
    "postgres": "postgresql",
    "pg": "postgresql",
    "mongo": "mongodb",
    "sql server": "sql server",
    "ms-sql server": "sql server",
    "mssql": "sql server",
    "ms sql": "sql server",
    "dynamo db": "dynamodb",
    "elastic search": "elasticsearch",

    // Cloud & DevOps
    "amazon web services": "aws",
    "gcp": "google cloud platform",
    "google cloud": "google cloud platform",
    "microsoft azure": "azure",
    "k8s": "kubernetes",
    "ci/cd": "ci/cd",
    "cicd": "ci/cd",
    "devops / devsecops": "devops",

    // Misc
    "html5": "html",
    "css3": "css",
    "sass": "sass",
    "scss": "sass",
    "agile / scrum management": "agile",
    "safe - agile craft": "safe",
};

function normalizeSkill(raw) {
    if (!raw) return "";
    const cleaned = raw.trim().toLowerCase().replace(/[.,;:]+$/, "");
    return SKILL_ALIASES[cleaned] || cleaned;
}

function normalizeSkills(rawList) {
    const seen = new Set();
    const result = [];
    for (const raw of rawList) {
        const canonical = normalizeSkill(raw);
        if (canonical && !seen.has(canonical)) {
            seen.add(canonical);
            result.push(canonical);
        }
    }
    return result;
}

module.exports = { normalizeSkill, normalizeSkills, SKILL_ALIASES };
