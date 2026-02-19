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

/**
 * Shortlist V2 — streams agentic pipeline events via SSE.
 * @param {Object} params
 * @param {string} params.queryText - Free-text query or JD
 * @param {Object} params.filters - Optional filters
 * @param {Function} params.onEvent - Callback for each SSE event: (eventType, data) => void
 * @param {Function} params.onError - Callback for errors
 * @param {Function} params.onDone - Callback when stream ends
 * @returns {AbortController} controller to cancel the stream
 */
export function fetchShortlistV2({ queryText, filters, onEvent, onError, onDone }) {
    const controller = new AbortController();

    import('@microsoft/fetch-event-source').then(({ fetchEventSource }) => {
        fetchEventSource(`${API_BASE}/shortlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query_text: queryText, filters: filters || {} }),
            signal: controller.signal,
            onmessage(ev) {
                try {
                    const data = JSON.parse(ev.data);
                    onEvent?.(ev.event || 'update', data);
                } catch (e) {
                    // Non-JSON event, pass raw
                    onEvent?.(ev.event || 'update', { message: ev.data });
                }
            },
            onerror(err) {
                onError?.(err);
            },
            onclose() {
                onDone?.();
            },
            openWhenHidden: true,
        });
    });

    return controller;
}

// ─── Session API ───

export async function getSessions() {
    const res = await fetch(`${API_BASE}/sessions`);
    if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.statusText}`);
    return res.json();
}

export async function getSession(sessionId) {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}`);
    if (!res.ok) throw new Error(`Failed to fetch session: ${res.statusText}`);
    return res.json();
}

export async function createSession(queryText, title) {
    const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queryText, title }),
    });
    if (!res.ok) throw new Error(`Failed to create session: ${res.statusText}`);
    return res.json();
}

export async function updateSession(sessionId, data) {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to update session: ${res.statusText}`);
    return res.json();
}

export async function deleteSession(sessionId) {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Failed to delete session: ${res.statusText}`);
    return res.json();
}
