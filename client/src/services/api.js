const API_BASE = '/api';

export async function searchResumes({ skills, mode, minMatch, minYOE, locationCountry, limit, enableRerank }) {
    const res = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            skills,
            mode: mode || 'match_all',
            minMatch: minMatch || 1,
            minYOE,
            locationCountry,
            limit: limit || 20,
            enableRerank: enableRerank || false,
        }),
    });
    if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
    return res.json();
}

export async function getResume(resumeId) {
    const res = await fetch(`${API_BASE}/resume/${resumeId}`);
    if (!res.ok) throw new Error(`Failed to fetch resume: ${res.statusText}`);
    return res.json();
}

export async function deleteResume(resumeId) {
    const res = await fetch(`${API_BASE}/resume/${resumeId}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Failed to delete resume: ${res.statusText}`);
    return res.json();
}
