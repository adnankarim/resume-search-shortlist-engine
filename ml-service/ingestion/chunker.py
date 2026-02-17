"""
Chunk generation for resume data.
Creates text chunks from structured resume fields for search and embedding.
"""

import hashlib
import uuid
from pii_handler import sanitize_text
from skill_extractor import get_skills_in_text


def generate_chunks(resume: dict, resume_id: str, pii_patterns: list) -> list[dict]:
    """
    Generate search chunks from a resume.
    Returns a list of chunk documents ready for MongoDB insertion.
    """
    chunks = []

    # 1. Summary chunk
    summary = resume.get("personal_info", {}).get("summary", "")
    if summary:
        sanitized = sanitize_text(summary, pii_patterns)
        chunks.append(_make_chunk(
            resume_id=resume_id,
            section_type="summary",
            section_ordinal=0,
            chunk_text=sanitized,
            start_date="",
            end_date="",
        ))

    # 2. Experience chunks (one per experience entry)
    for idx, exp in enumerate(resume.get("experience", [])):
        text_parts = []

        title = exp.get("title", "")
        company = exp.get("company", "")
        if title and company:
            text_parts.append(f"{title} at {company}")
        elif title:
            text_parts.append(title)

        # Employment info
        emp_type = exp.get("employment_type", "")
        level = exp.get("level", "")
        if emp_type or level:
            text_parts.append(f"({', '.join(filter(None, [level, emp_type]))})")

        # Dates
        dates = exp.get("dates", {})
        duration = dates.get("duration", "")
        if duration:
            text_parts.append(f"Duration: {duration}")

        # Responsibilities
        responsibilities = exp.get("responsibilities", [])
        if responsibilities:
            text_parts.append("Responsibilities:")
            for resp in responsibilities:
                text_parts.append(f"- {resp}")

        # Technical environment
        tech_env = exp.get("technical_environment", {})
        tech_items = []
        for key in ["technologies", "tools", "methodologies"]:
            items = tech_env.get(key, [])
            if items:
                tech_items.extend(items)
        if tech_items:
            text_parts.append(f"Technical Environment: {', '.join(tech_items)}")

        chunk_text = "\n".join(text_parts)
        sanitized = sanitize_text(chunk_text, pii_patterns)

        start_date = dates.get("start", "")
        end_date = dates.get("end", "")

        chunks.append(_make_chunk(
            resume_id=resume_id,
            section_type="experience",
            section_ordinal=idx,
            chunk_text=sanitized,
            start_date=start_date,
            end_date=end_date,
        ))

    # 3. Project chunks (one per project)
    for idx, proj in enumerate(resume.get("projects", [])):
        text_parts = []

        name = proj.get("name", "")
        if name:
            text_parts.append(f"Project: {name}")

        role = proj.get("role", "")
        if role:
            text_parts.append(f"Role: {role}")

        description = proj.get("description", "")
        if description:
            text_parts.append(description)

        impact = proj.get("impact", "")
        if impact:
            text_parts.append(f"Impact: {impact}")

        technologies = proj.get("technologies", [])
        if technologies:
            text_parts.append(f"Technologies: {', '.join(technologies)}")

        chunk_text = "\n".join(text_parts)
        sanitized = sanitize_text(chunk_text, pii_patterns)

        chunks.append(_make_chunk(
            resume_id=resume_id,
            section_type="project",
            section_ordinal=idx,
            chunk_text=sanitized,
            start_date="",
            end_date="",
        ))

    # 4. Education chunks (one per education entry)
    for idx, edu in enumerate(resume.get("education", [])):
        text_parts = []

        degree = edu.get("degree", {})
        level = degree.get("level", "")
        field = degree.get("field", "")
        major = degree.get("major", "")
        if level and field:
            text_parts.append(f"{level}'s degree in {field}")
        if major and major != field:
            text_parts.append(f"Major: {major}")

        institution = edu.get("institution", {})
        inst_name = institution.get("name", "")
        if inst_name:
            text_parts.append(f"Institution: {inst_name}")

        dates = edu.get("dates", {})
        start = dates.get("start", "")
        end = dates.get("expected_graduation", dates.get("end", ""))
        if start and end:
            text_parts.append(f"Period: {start} - {end}")

        achievements = edu.get("achievements", {})
        coursework = achievements.get("relevant_coursework", [])
        if coursework:
            text_parts.append(f"Coursework: {', '.join(coursework)}")

        honors = achievements.get("honors", "")
        if honors:
            text_parts.append(f"Honors: {honors}")

        gpa = achievements.get("gpa")
        if gpa:
            text_parts.append(f"GPA: {gpa}")

        chunk_text = "\n".join(text_parts)
        sanitized = sanitize_text(chunk_text, pii_patterns)

        chunks.append(_make_chunk(
            resume_id=resume_id,
            section_type="education",
            section_ordinal=idx,
            chunk_text=sanitized,
            start_date=start,
            end_date=end,
        ))

    # 5. Skills overview chunk (combined technical skills)
    skills_section = resume.get("skills", {})
    technical = skills_section.get("technical", {})
    if technical:
        text_parts = ["Technical Skills:"]
        for category, items in technical.items():
            if isinstance(items, list):
                skill_names = []
                for item in items:
                    if isinstance(item, dict):
                        name = item.get("name", "")
                        level = item.get("level", "")
                        if name:
                            skill_names.append(f"{name} ({level})" if level else name)
                    elif isinstance(item, str):
                        skill_names.append(item)
                if skill_names:
                    cat_label = category.replace("_", " ").title()
                    text_parts.append(f"{cat_label}: {', '.join(skill_names)}")

        if len(text_parts) > 1:
            chunk_text = "\n".join(text_parts)
            sanitized = sanitize_text(chunk_text, pii_patterns)
            chunks.append(_make_chunk(
                resume_id=resume_id,
                section_type="skills",
                section_ordinal=0,
                chunk_text=sanitized,
                start_date="",
                end_date="",
            ))

    return chunks


def _make_chunk(
    resume_id: str,
    section_type: str,
    section_ordinal: int,
    chunk_text: str,
    start_date: str,
    end_date: str,
) -> dict:
    """Create a chunk document."""
    # Generate deterministic chunkId
    chunk_id = hashlib.md5(
        f"{resume_id}:{section_type}:{section_ordinal}:{uuid.uuid4()}".encode()
    ).hexdigest()

    skills_in_chunk = get_skills_in_text(chunk_text)

    return {
        "chunkId": chunk_id,
        "resumeId": resume_id,
        "sectionType": section_type,
        "sectionOrdinal": section_ordinal,
        "chunkText": chunk_text,
        "skillsInChunk": skills_in_chunk,
        "startDate": start_date,
        "endDate": end_date,
        # embedding will be added later
    }
