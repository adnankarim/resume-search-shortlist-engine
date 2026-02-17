"""
PII extraction and sanitization for resume data.
Extracts personal_info PII fields into a separate document,
and sanitizes text to remove PII before embedding.
"""

import re


def extract_pii(resume: dict, resume_id: str) -> dict:
    """Extract PII fields from resume into a resumes_pii document."""
    pi = resume.get("personal_info", {})
    location = pi.get("location", {})
    return {
        "resumeId": resume_id,
        "name": pi.get("name", ""),
        "email": pi.get("email", ""),
        "phone": pi.get("phone", ""),
        "linkedin": pi.get("linkedin", ""),
        "github": pi.get("github", ""),
        "address": {
            "city": location.get("city", ""),
            "country": location.get("country", ""),
        },
    }


def get_pii_patterns(resume: dict) -> list[re.Pattern]:
    """Build regex patterns for PII found in this resume."""
    pi = resume.get("personal_info", {})
    patterns = []

    # Email pattern
    email = pi.get("email", "")
    if email:
        patterns.append(re.compile(re.escape(email), re.IGNORECASE))

    # Phone pattern
    phone = pi.get("phone", "")
    if phone:
        # Escape and allow flexible whitespace/dash
        phone_escaped = re.escape(phone)
        patterns.append(re.compile(phone_escaped, re.IGNORECASE))

    # Name pattern (full name match)
    name = pi.get("name", "")
    if name and len(name) > 2:
        patterns.append(re.compile(re.escape(name), re.IGNORECASE))

    # LinkedIn URL
    linkedin = pi.get("linkedin", "")
    if linkedin:
        patterns.append(re.compile(re.escape(linkedin), re.IGNORECASE))

    # GitHub URL
    github = pi.get("github", "")
    if github:
        patterns.append(re.compile(re.escape(github), re.IGNORECASE))

    # Generic email pattern (catch any emails)
    patterns.append(re.compile(
        r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}',
        re.IGNORECASE
    ))

    # Generic phone pattern (catch any phone numbers)
    patterns.append(re.compile(
        r'\+?\d[\d\s\-\(\)]{7,}\d'
    ))

    return patterns


def sanitize_text(text: str, pii_patterns: list[re.Pattern]) -> str:
    """Remove PII from text using the provided patterns."""
    if not text:
        return text

    sanitized = text
    for pattern in pii_patterns:
        sanitized = pattern.sub("[REDACTED]", sanitized)

    return sanitized


def build_sanitized_personal_info(resume: dict) -> dict:
    """Return a sanitized version of personal_info for resumes_core."""
    pi = resume.get("personal_info", {})
    location = pi.get("location", {})
    return {
        "summary": pi.get("summary", ""),
        "locationCountry": location.get("country", ""),
        "locationCity": location.get("city", ""),
        "remotePreference": location.get("remote_preference", ""),
    }
