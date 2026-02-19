import { useState, useRef, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { searchResumes, fetchShortlistV2 } from '../services/api'

// Feature flag — toggle V2 agentic search via URL param or localStorage
function useV2Flag() {
    const [v2, setV2] = useState(() => {
        const url = new URL(window.location.href)
        if (url.searchParams.has('v2')) return url.searchParams.get('v2') === 'true'
        return localStorage.getItem('useShortlistV2') === 'true'
    })
    const toggle = () => {
        setV2(prev => {
            localStorage.setItem('useShortlistV2', (!prev).toString())
            return !prev
        })
    }
    return [v2, toggle]
}

const STAGE_LABELS = {
    jd_understanding: { icon: '🧠', label: 'Understanding Query' },
    retrieval: { icon: '🔍', label: 'Searching Database' },
    fusion: { icon: '🔀', label: 'Fusing Results' },
    evidence_building: { icon: '📋', label: 'Building Evidence' },
    ranking: { icon: '🏆', label: 'Ranking Candidates' },
    assembly: { icon: '📦', label: 'Assembling Results' },
}

export default function SearchPage() {
    // V1 state
    const [skills, setSkills] = useState([])
    const [inputValue, setInputValue] = useState('')
    const [mode, setMode] = useState('match_all')
    const [minMatch, setMinMatch] = useState(1)
    const [results, setResults] = useState(null)
    const [meta, setMeta] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [totalCount, setTotalCount] = useState(null)
    const inputRef = useRef(null)

    // V2 state
    const [useV2, toggleV2] = useV2Flag()
    const [queryText, setQueryText] = useState('')
    const [agentEvents, setAgentEvents] = useState([])
    const [missionSpec, setMissionSpec] = useState(null)
    const [v2Results, setV2Results] = useState(null)
    const [completedStages, setCompletedStages] = useState([])
    const [activeAgent, setActiveAgent] = useState(null)
    const [showScores, setShowScores] = useState(false)
    const [pipelineActive, setPipelineActive] = useState(false)
    const streamController = useRef(null)
    const eventsEndRef = useRef(null)

    useEffect(() => {
        fetch('/api/resume/count')
            .then(res => res.json())
            .then(data => setTotalCount(data.count))
            .catch(err => console.error('Failed to fetch count:', err))
    }, [])

    // Auto-scroll agent events
    useEffect(() => {
        eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [agentEvents])

    // ─── V1 handlers ───
    const addSkill = useCallback((value) => {
        const trimmed = value.trim()
        if (trimmed && !skills.includes(trimmed.toLowerCase())) {
            setSkills(prev => [...prev, trimmed.toLowerCase()])
        }
        setInputValue('')
    }, [skills])

    const removeSkill = useCallback((skill) => {
        setSkills(prev => prev.filter(s => s !== skill))
    }, [])

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            if (useV2) {
                handleV2Search()
            } else {
                addSkill(inputValue)
            }
        } else if (!useV2 && e.key === 'Backspace' && !inputValue && skills.length > 0) {
            removeSkill(skills[skills.length - 1])
        }
    }

    const handlePaste = (e) => {
        if (useV2) return
        e.preventDefault()
        const pasted = e.clipboardData.getData('text')
        const parts = pasted.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)
        parts.forEach(addSkill)
    }

    const handleV1Search = async () => {
        let currentSkills = [...skills]
        if (inputValue.trim()) {
            const skillToAdd = inputValue.trim().toLowerCase()
            if (!currentSkills.includes(skillToAdd)) {
                currentSkills.push(skillToAdd)
                setSkills(currentSkills)
            }
            setInputValue('')
        }
        if (currentSkills.length === 0) return

        setLoading(true)
        setError(null)
        try {
            const data = await searchResumes({
                skills: currentSkills,
                mode,
                minMatch: mode === 'match_at_least' ? minMatch : currentSkills.length,
                limit: 20,
            })
            setResults(data.results)
            setMeta(data.meta)
        } catch (err) {
            setError(err.message)
            setResults(null)
        } finally {
            setLoading(false)
        }
    }

    // ─── V2 handlers ───
    const handleV2Search = () => {
        const query = queryText.trim()
        if (!query) return

        // Reset state
        setAgentEvents([])
        setMissionSpec(null)
        setV2Results(null)
        setCompletedStages([])
        setActiveAgent(null)
        setError(null)
        setPipelineActive(true)
        setResults(null)

        // Cancel any existing stream
        streamController.current?.abort()

        streamController.current = fetchShortlistV2({
            queryText: query,
            onEvent: (eventType, data) => {
                handleAgentEvent(eventType, data)
            },
            onError: (err) => {
                setError(err?.message || 'Pipeline failed')
                setPipelineActive(false)
            },
            onDone: () => {
                setPipelineActive(false)
                setActiveAgent(null)
            },
        })
    }

    const handleAgentEvent = (eventType, data) => {
        const timestamp = new Date().toLocaleTimeString()

        switch (eventType) {
            case 'agent_start':
                setActiveAgent(data.agent)
                setAgentEvents(prev => [...prev, { type: 'agent_start', ...data, timestamp }])
                break

            case 'agent_thought':
                setAgentEvents(prev => [...prev, { type: 'thought', ...data, timestamp }])
                break

            case 'tool_call':
                setAgentEvents(prev => [...prev, { type: 'tool_call', ...data, timestamp }])
                break

            case 'tool_result':
                setAgentEvents(prev => [...prev, { type: 'tool_result', ...data, timestamp }])
                break

            case 'stage_complete':
                setCompletedStages(prev => [...prev, data.stage])
                setAgentEvents(prev => [...prev, { type: 'stage_complete', ...data, timestamp }])
                break

            case 'mission_spec':
                setMissionSpec(data.data || data)
                setAgentEvents(prev => [...prev, { type: 'mission_spec', ...data, timestamp }])
                break

            case 'result':
                setV2Results(data.data || data)
                setAgentEvents(prev => [...prev, { type: 'result', message: data.message, timestamp }])
                setPipelineActive(false)
                setActiveAgent(null)
                break

            case 'error':
                setError(data.message)
                setPipelineActive(false)
                setActiveAgent(null)
                break

            case 'done':
                setPipelineActive(false)
                setActiveAgent(null)
                break

            default:
                if (data.message) {
                    setAgentEvents(prev => [...prev, { type: 'info', ...data, timestamp }])
                }
        }
    }

    const cancelPipeline = () => {
        streamController.current?.abort()
        setPipelineActive(false)
        setActiveAgent(null)
    }

    const truncate = (text, maxLen = 200) => {
        if (!text || text.length <= maxLen) return text
        return text.slice(0, maxLen) + '…'
    }

    // Use V2 results if available
    const displayResults = useV2 ? (v2Results?.results || null) : results

    return (
        <div className="search-page">
            {/* ─── Mode Toggle ─── */}
            <div className="v2-toggle">
                <button
                    className={`v2-toggle-btn ${useV2 ? 'active' : ''}`}
                    onClick={toggleV2}
                    title={useV2 ? 'Switch to classic search' : 'Switch to AI-powered search'}
                >
                    {useV2 ? '🤖 AI Agent Search' : '🔍 Classic Search'}
                </button>
            </div>

            {/* ─── V2 Search Bar ─── */}
            {useV2 ? (
                <div className="search-bar v2">
                    <div className="v2-query-area">
                        <textarea
                            value={queryText}
                            onChange={e => setQueryText(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    handleV2Search()
                                }
                            }}
                            placeholder="Describe the ideal candidate or paste a job description...&#10;&#10;Example: Looking for a senior Python developer with 5+ years experience in machine learning, familiar with AWS and Docker. Must know PyTorch or TensorFlow."
                            rows={4}
                            className="v2-textarea"
                            disabled={pipelineActive}
                        />
                    </div>
                    <div className="search-controls">
                        <button
                            className="search-btn v2"
                            onClick={handleV2Search}
                            disabled={!queryText.trim() || pipelineActive}
                        >
                            {pipelineActive ? '⏳ Agents Working…' : '🤖 AI Search'}
                        </button>
                        {pipelineActive && (
                            <button className="cancel-btn" onClick={cancelPipeline}>
                                ✕ Cancel
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                /* ─── V1 Search Bar ─── */
                <div className="search-bar">
                    <div className="search-input-area" onClick={() => inputRef.current?.focus()}>
                        {skills.map(skill => (
                            <span key={skill} className="skill-chip input">
                                {skill}
                                <button className="remove-btn" onClick={(e) => { e.stopPropagation(); removeSkill(skill) }}>×</button>
                            </span>
                        ))}
                        <input
                            ref={inputRef}
                            type="text"
                            value={inputValue}
                            onChange={e => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            placeholder={skills.length === 0 ? 'Enter skills (e.g. python, javascript, machine learning)' : 'Add more skills…'}
                        />
                    </div>
                    <div className="search-controls">
                        <div className="mode-toggle">
                            <button className={`mode-btn ${mode === 'match_all' ? 'active' : ''}`} onClick={() => setMode('match_all')}>Match ALL</button>
                            <button className={`mode-btn ${mode === 'match_at_least' ? 'active' : ''}`} onClick={() => setMode('match_at_least')}>Match at least N</button>
                        </div>
                        {mode === 'match_at_least' && (
                            <div className="min-match-input">
                                <label>Min:</label>
                                <input type="number" min={1} max={skills.length || 1} value={minMatch} onChange={e => setMinMatch(Math.max(1, parseInt(e.target.value) || 1))} />
                                <label>of {skills.length}</label>
                            </div>
                        )}
                        <button className="search-btn" onClick={handleV1Search} disabled={(skills.length === 0 && !inputValue.trim()) || loading}>
                            {loading ? 'Searching…' : '⌕ Search Candidates'}
                        </button>
                    </div>
                </div>
            )}

            {/* ─── Agent Activity Panel (V2 only) ─── */}
            {useV2 && agentEvents.length > 0 && (
                <div className="agent-panel">
                    <div className="agent-panel-header">
                        <h3>🤖 Agent Activity</h3>
                        {/* Stage Progress */}
                        <div className="stage-progress">
                            {Object.entries(STAGE_LABELS).map(([key, { icon, label }]) => (
                                <div
                                    key={key}
                                    className={`stage-chip ${completedStages.includes(key) ? 'completed' : ''} ${activeAgent === label || activeAgent === key ? 'active' : ''}`}
                                >
                                    <span>{icon}</span>
                                    <span className="stage-label">{label}</span>
                                    {completedStages.includes(key) && <span className="checkmark">✓</span>}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="agent-events">
                        {agentEvents.map((ev, i) => (
                            <div key={i} className={`agent-event ${ev.type}`}>
                                <span className="event-time">{ev.timestamp}</span>
                                <span className={`event-badge ${ev.type}`}>
                                    {ev.type === 'agent_start' && '🤖'}
                                    {ev.type === 'thought' && '💭'}
                                    {ev.type === 'tool_call' && '🔧'}
                                    {ev.type === 'tool_result' && '📊'}
                                    {ev.type === 'stage_complete' && '✅'}
                                    {ev.type === 'mission_spec' && '📋'}
                                    {ev.type === 'result' && '🎯'}
                                    {ev.type === 'info' && 'ℹ️'}
                                </span>
                                {ev.agent && <span className="event-agent">[{ev.agent}]</span>}
                                <span className="event-message">{ev.message}</span>
                                {ev.timing_ms && <span className="event-timing">{ev.timing_ms}ms</span>}
                            </div>
                        ))}
                        {pipelineActive && (
                            <div className="agent-event thinking">
                                <span className="thinking-dots">
                                    <span>●</span><span>●</span><span>●</span>
                                </span>
                            </div>
                        )}
                        <div ref={eventsEndRef} />
                    </div>
                </div>
            )}

            {/* ─── MissionSpec Panel (V2 only) ─── */}
            {useV2 && missionSpec && (
                <MissionSpecPanel spec={missionSpec} />
            )}

            {/* ─── Status ─── */}
            {error && <div className="error-state">⚠ {error}</div>}

            {!useV2 && meta && (
                <div className="search-meta">
                    <span><strong>{meta.totalCandidates}</strong> candidates matched</span>
                    <span>·</span>
                    <span><strong>{meta.resultsReturned}</strong> results shown</span>
                    <span>·</span>
                    <span>{meta.latencyMs}ms</span>
                </div>
            )}

            {useV2 && v2Results && (
                <div className="search-meta v2">
                    <span><strong>{v2Results.total_candidates_found || v2Results.results?.length}</strong> candidates ranked</span>
                    <span>·</span>
                    <span><strong>{v2Results.results?.length}</strong> returned</span>
                    {v2Results.stage_timings && (
                        <>
                            <span>·</span>
                            <span>{Object.values(v2Results.stage_timings).reduce((a, b) => a + b, 0).toFixed(1)}s total</span>
                        </>
                    )}
                    <button className="dev-toggle" onClick={() => setShowScores(!showScores)}>
                        {showScores ? '🔒 Hide Scores' : '🔓 Show Scores'}
                    </button>
                </div>
            )}

            {/* ─── Loading (V1 only) ─── */}
            {!useV2 && loading && (
                <div className="loading-state">
                    <div className="spinner" />
                    <p>Searching across {totalCount ? `${totalCount.toLocaleString()} resumes` : 'resumes'}…</p>
                </div>
            )}

            {/* ─── Empty State ─── */}
            {!loading && !pipelineActive && !displayResults && !error && (
                <div className="empty-state">
                    <div className="empty-state-icon">{useV2 ? '🤖' : '🔍'}</div>
                    <h3>{useV2 ? 'AI-Powered Candidate Search' : 'Search for candidates by skills'}</h3>
                    <p>{useV2
                        ? 'Describe the ideal candidate or paste a job description. Our AI agents will analyze, search, and rank candidates for you.'
                        : 'Enter one or more skills above to find matching resumes with evidence-backed results.'
                    }</p>
                </div>
            )}

            {/* ─── Results ─── */}
            {displayResults && displayResults.length === 0 && (
                <div className="empty-state">
                    <div className="empty-state-icon">📭</div>
                    <h3>No candidates found</h3>
                    <p>{useV2 ? 'Try a different query or broader requirements.' : 'Try fewer skills or switch to "Match at least N" mode.'}</p>
                </div>
            )}

            {displayResults && displayResults.length > 0 && (
                <div className="results-grid">
                    {displayResults.map((r, idx) => (
                        <div key={r.resumeId || r.candidate_id} className="result-card-wrapper" style={{ position: 'relative' }}>
                            <Link to={`/profile/${r.resumeId || r.candidate_id}`} className="result-card">
                                <div className="result-card-header">
                                    <div className="result-card-top">
                                        <div className="result-headline">{truncate(r.headline, 60)}</div>
                                        <button
                                            className="delete-btn"
                                            onClick={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                if (window.confirm('Delete this resume?')) {
                                                    if (useV2) {
                                                        setV2Results(prev => ({
                                                            ...prev,
                                                            results: prev.results.filter(res => res.candidate_id !== r.candidate_id)
                                                        }))
                                                    } else {
                                                        setResults(prev => prev.filter(res => res.resumeId !== r.resumeId))
                                                    }
                                                    import('../services/api').then(api => api.deleteResume(r.resumeId || r.candidate_id).catch(err => console.error(err)))
                                                }
                                            }}
                                            title="Delete Resume"
                                        >🗑</button>
                                    </div>
                                    <div className="result-meta">
                                        {(r.totalYOE || r.total_yoe) > 0 && (
                                            <span className="result-meta-item">📅 {r.totalYOE || r.total_yoe} yrs</span>
                                        )}
                                        {(r.locationCountry || r.location_country) && (
                                            <span className="result-meta-item">📍 {r.locationCountry || r.location_country}</span>
                                        )}
                                    </div>

                                    {/* Score badges */}
                                    <div className="result-score-container">
                                        <span className="result-score-badge similarity" title={`Score: ${r.finalScore || r.final_score}`}>
                                            🎯 {Math.round(r.finalScore || r.final_score || 0)}% Match
                                        </span>
                                        {(r.matchedSkills || r.matched_skills)?.length > 0 && (
                                            <span className="result-score-badge skills">
                                                {(r.matchedSkills || r.matched_skills).length} skills
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* V2: Dev score breakdown */}
                                {useV2 && showScores && r.score_breakdown && (
                                    <div className="result-score-breakdown v2">
                                        <span>RRF: {r.score_breakdown.rrf_score?.toFixed(4)}</span>
                                        <span>CE: {r.score_breakdown.rerank_score?.toFixed(3)}</span>
                                        {r.score_breakdown.dense_rank && <span>Dense: #{r.score_breakdown.dense_rank}</span>}
                                        {r.score_breakdown.sparse_rank && <span>Sparse: #{r.score_breakdown.sparse_rank}</span>}
                                    </div>
                                )}

                                {/* V1: Score breakdown */}
                                {!useV2 && (
                                    <div className="result-score-breakdown" style={{
                                        padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.03)',
                                        fontSize: '0.75rem', color: 'var(--text-muted)',
                                        display: 'flex', justifyContent: 'space-between',
                                        borderTop: '1px solid rgba(255,255,255,0.05)'
                                    }}>
                                        <span>AI Similarity: {r.semanticScore}%</span>
                                        <span>Skills Match: {r.skillScore}%</span>
                                    </div>
                                )}

                                {/* Matched Skills */}
                                <div className="result-skills">
                                    {(r.matchedSkills || r.matched_skills || []).slice(0, 5).map(skill => (
                                        <span key={skill} className="skill-chip matched small">✓ {skill}</span>
                                    ))}
                                    {(r.matchedSkills || r.matched_skills || []).length > 5 && (
                                        <span className="skill-chip matched small">+{(r.matchedSkills || r.matched_skills).length - 5}</span>
                                    )}
                                </div>

                                {/* V2: Evidence pack + highlights */}
                                {useV2 && r.evidence_pack?.evidence?.length > 0 && (
                                    <div className="result-evidence v2">
                                        {r.highlights?.length > 0 && (
                                            <div className="evidence-highlights">
                                                {r.highlights.map((h, i) => (
                                                    <div key={i} className="highlight-item">
                                                        <span className="highlight-icon">✨</span>
                                                        <span>{truncate(h, 100)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <div className="evidence-chunks">
                                            {r.evidence_pack.evidence.slice(0, 2).map((e, i) => (
                                                <div key={i} className="evidence-chunk">
                                                    <span className={`match-badge ${e.why_matched}`}>
                                                        {e.why_matched === 'both' ? '🔗' : e.why_matched === 'dense' ? '🧠' : '📝'}
                                                        {e.why_matched}
                                                    </span>
                                                    {e.section && <span className="evidence-section">[{e.section}]</span>}
                                                    <span className="evidence-text">{truncate(e.text_snippet, 120)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* V1: Basic evidence */}
                                {!useV2 && r.evidence && r.evidence.length > 0 && (
                                    <div className="result-evidence">
                                        <div className="evidence-snippet">
                                            {truncate(r.evidence[0].chunkText, 120)}
                                        </div>
                                    </div>
                                )}
                            </Link>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// ─── MissionSpec Panel Component ───
function MissionSpecPanel({ spec }) {
    const [collapsed, setCollapsed] = useState(false)

    if (!spec) return null

    return (
        <div className={`mission-spec-panel ${collapsed ? 'collapsed' : ''}`}>
            <div className="mission-spec-header" onClick={() => setCollapsed(!collapsed)}>
                <h3>📋 Extracted Requirements</h3>
                <span className="collapse-toggle">{collapsed ? '▶' : '▼'}</span>
            </div>
            {!collapsed && (
                <div className="mission-spec-body">
                    {spec.must_have?.length > 0 && (
                        <div className="spec-section">
                            <label>Must Have</label>
                            <div className="spec-chips">
                                {spec.must_have.map((s, i) => (
                                    <span key={i} className="spec-chip must">{s}</span>
                                ))}
                            </div>
                        </div>
                    )}
                    {spec.nice_to_have?.length > 0 && (
                        <div className="spec-section">
                            <label>Nice to Have</label>
                            <div className="spec-chips">
                                {spec.nice_to_have.map((s, i) => (
                                    <span key={i} className="spec-chip nice">{s}</span>
                                ))}
                            </div>
                        </div>
                    )}
                    {spec.negative_constraints?.length > 0 && (
                        <div className="spec-section">
                            <label>Excluded</label>
                            <div className="spec-chips">
                                {spec.negative_constraints.map((s, i) => (
                                    <span key={i} className="spec-chip negative">{s}</span>
                                ))}
                            </div>
                        </div>
                    )}
                    {spec.min_years && (
                        <div className="spec-section">
                            <label>Min Experience</label>
                            <span className="spec-value">{spec.min_years}+ years</span>
                        </div>
                    )}
                    {spec.location && (
                        <div className="spec-section">
                            <label>Location</label>
                            <span className="spec-value">{spec.location}</span>
                        </div>
                    )}
                    {spec.clarifications?.length > 0 && (
                        <div className="spec-section clarifications">
                            <label>💡 Suggestions</label>
                            {spec.clarifications.map((c, i) => (
                                <div key={i} className="clarification">{c}</div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
