"""
Skill extraction from structured resume data.
Extracts skills from technical_environment, projects, skills section,
and narrative fields. Normalizes using skill_aliases.
"""

import re
from skill_aliases import normalize_skill


# Source confidence weights
CONFIDENCE_STRUCTURED = 1.0     # From technical_environment / skills section
CONFIDENCE_PROJECT = 0.9        # From project technologies
CONFIDENCE_NARRATIVE = 0.6      # From responsibilities / descriptions


def extract_skills_from_resume(resume: dict) -> list[dict]:
    """
    Extract all skills from a resume and return a list of skill ledger entries.
    
    Each entry: {
        skillCanonical, evidenceCount, evidenceSources[], confidence, lastSeen
    }
    """
    # skill_canonical -> { sources: set, count: int, max_confidence: float, last_date: str }
    skill_map = {}

    def _add_skill(raw: str, source_type: str, confidence: float, date: str = ""):
        canonical = normalize_skill(raw)
        if not canonical or len(canonical) < 2:
            return
        if canonical not in skill_map:
            skill_map[canonical] = {
                "sources": set(),
                "count": 0,
                "max_confidence": 0.0,
                "last_date": "",
            }
        entry = skill_map[canonical]
        entry["sources"].add(source_type)
        entry["count"] += 1
        entry["max_confidence"] = max(entry["max_confidence"], confidence)
        if date and date > entry["last_date"]:
            entry["last_date"] = date

    # 1. Extract from experience[].technical_environment
    for exp in resume.get("experience", []):
        tech_env = exp.get("technical_environment", {})
        dates = exp.get("dates", {})
        end_date = dates.get("end", dates.get("start", ""))

        for tech in tech_env.get("technologies", []):
            _add_skill(tech, "tech_env.technologies", CONFIDENCE_STRUCTURED, end_date)
        for tool in tech_env.get("tools", []):
            _add_skill(tool, "tech_env.tools", CONFIDENCE_STRUCTURED, end_date)
        for method in tech_env.get("methodologies", []):
            _add_skill(method, "tech_env.methodologies", CONFIDENCE_STRUCTURED, end_date)

        # Scan responsibilities for skill mentions (narrative)
        for resp in exp.get("responsibilities", []):
            _scan_narrative(resp, "experience.responsibilities", CONFIDENCE_NARRATIVE, end_date, _add_skill)

    # 2. Extract from projects[].technologies
    for proj in resume.get("projects", []):
        for tech in proj.get("technologies", []):
            _add_skill(tech, "project.technologies", CONFIDENCE_PROJECT, "")

        # Scan project description
        desc = proj.get("description", "")
        if desc:
            _scan_narrative(desc, "project.description", CONFIDENCE_NARRATIVE, "", _add_skill)

    # 3. Extract from skills section
    skills_section = resume.get("skills", {})
    technical = skills_section.get("technical", {})
    for category in technical.values():
        if isinstance(category, list):
            for item in category:
                if isinstance(item, dict):
                    name = item.get("name", "")
                    if name:
                        _add_skill(name, "skills.technical", CONFIDENCE_STRUCTURED, "")
                elif isinstance(item, str):
                    _add_skill(item, "skills.technical", CONFIDENCE_STRUCTURED, "")

    # 4. Extract from personal_info.summary (narrative)
    summary = resume.get("personal_info", {}).get("summary", "")
    if summary:
        _scan_narrative(summary, "personal_info.summary", CONFIDENCE_NARRATIVE, "", _add_skill)

    # Build ledger entries
    ledger = []
    for canonical, info in skill_map.items():
        ledger.append({
            "skillCanonical": canonical,
            "evidenceCount": info["count"],
            "evidenceSources": sorted(info["sources"]),
            "confidence": round(info["max_confidence"], 2),
            "lastSeen": info["last_date"],
        })

    return ledger


# Common tech terms to scan for in narrative text
_NARRATIVE_SKILL_PATTERNS = None

def _get_narrative_patterns() -> list[tuple[re.Pattern, str]]:
    """Lazily build regex patterns for common skills to detect in narrative."""
    global _NARRATIVE_SKILL_PATTERNS
    if _NARRATIVE_SKILL_PATTERNS is not None:
        return _NARRATIVE_SKILL_PATTERNS

    # Skills worth scanning for in narrative text
    scan_skills = [
        "Python", "Java", "JavaScript", "TypeScript", "C\\+\\+", "C#", "Go", "Rust",
        "Ruby", "PHP", "Scala", "Kotlin", "Swift", "R\\b", "MATLAB",
        "React", "Angular", "Vue", "Node\\.js", "Express", "Django", "Flask",
        "FastAPI", "Spring", "Rails",
        "TensorFlow", "PyTorch", "Keras", "Scikit-learn", "XGBoost",
        "SQL", "NoSQL", "MongoDB", "PostgreSQL", "MySQL", "Redis", "Elasticsearch",
        "AWS", "Azure", "GCP", "Docker", "Kubernetes",
        "Machine Learning", "Deep Learning", "NLP", "Computer Vision",
        "REST API", "GraphQL", "Microservices",
        "Git", "Jenkins", "CI/CD", "Terraform", "Ansible",
        "Agile", "Scrum", "DevOps",
        "Pandas", "NumPy", "Spark", "Kafka", "Hadoop",
        "Selenium", "Cypress", "Jest", "Pytest",
        "HTML", "CSS",
    ]

    _NARRATIVE_SKILL_PATTERNS = []
    for skill in scan_skills:
        try:
            pattern = re.compile(r'\b' + skill + r'\b', re.IGNORECASE)
            _NARRATIVE_SKILL_PATTERNS.append((pattern, skill.lower().replace("\\b", "").replace("\\.", ".").replace("\\+", "+")))
        except re.error:
            pass

    return _NARRATIVE_SKILL_PATTERNS


def _scan_narrative(text: str, source_type: str, confidence: float, date: str, add_fn):
    """Scan narrative text for skill mentions."""
    patterns = _get_narrative_patterns()
    for pattern, raw_skill in patterns:
        if pattern.search(text):
            add_fn(raw_skill, source_type, confidence, date)


def get_skills_in_text(text: str) -> list[str]:
    """Return list of canonical skills found in a text chunk."""
    patterns = _get_narrative_patterns()
    found = set()
    for pattern, raw_skill in patterns:
        if pattern.search(text):
            canonical = normalize_skill(raw_skill)
            if canonical:
                found.add(canonical)
    return sorted(found)
