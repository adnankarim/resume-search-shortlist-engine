import { useState, useRef, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { searchResumes, fetchShortlistV2, getSession, createSession, updateSession } from '../services/api'
import AgentPanel from '../components/AgentPanel'

const STAGE_LABELS = {
    jd_understanding: { icon: '🧠', label: 'Understanding Query' },
    retrieval: { icon: '🔍', label: 'Searching Database' },
    fusion: { icon: '🔀', label: 'Fusing Results' },
    evidence_building: { icon: '📋', label: 'Building Evidence' },
    ranking: { icon: '🏆', label: 'Ranking Candidates' },
    assembly: { icon: '📦', label: 'Assembling Results' },
}

export default function SearchPage({ activeSessionId, onSessionCreated }) {
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

    // Session state
    const [currentSessionId, setCurrentSessionId] = useState(null)
    const [loadingSession, setLoadingSession] = useState(false)
    const [sessionLoaded, setSessionLoaded] = useState(false)

    // Agent panel state
    const [agentPanelOpen, setAgentPanelOpen] = useState(false)

    // Timing state
    const [stageTimings, setStageTimings] = useState({})
    const [totalTime, setTotalTime] = useState(0)
    const pipelineStartTime = useRef(null)
    const runningSessionId = useRef(null)

    // Sort state for results table
    const [sortField, setSortField] = useState('final_score')
    const [sortDir, setSortDir] = useState('desc')

    // Search mode
    const [searchMode, setSearchMode] = useState('ai') // 'ai' | 'classic'

    useEffect(() => {
        fetch('/api/resume/count')
            .then(res => res.json())
            .then(data => setTotalCount(data.count))
            .catch(err => console.error('Failed to fetch count:', err))
    }, [])

    // Load session when activeSessionId changes
    useEffect(() => {
        if (activeSessionId) {
            // If we are currently running this session locally, don't reload from DB
            // to avoid overwriting the live pipeline state
            if (runningSessionId.current === activeSessionId && pipelineActive) {
                return
            }
            loadSession(activeSessionId)
        } else {
            // New search — reset everything
            resetState()
        }
    }, [activeSessionId])

    const resetState = () => {
        setQueryText('')
        setAgentEvents([])
        setMissionSpec(null)
        setV2Results(null)
        setCompletedStages([])
        setActiveAgent(null)
        setError(null)
        setPipelineActive(false)
        setCurrentSessionId(null)
        setSessionLoaded(false)
        setStageTimings({})
        setTotalTime(0)
        setResults(null)
        setMeta(null)
        runningSessionId.current = null
    }

    const loadSession = async (sessionId) => {
        setLoadingSession(true)
        try {
            const data = await getSession(sessionId)
            const session = data.session
            // If running locally, don't overwrite
            if (runningSessionId.current === sessionId && pipelineActive) return

            setCurrentSessionId(session.sessionId)
            setQueryText(session.queryText || '')
            setMissionSpec(session.missionSpec || null)
            setV2Results(session.results?.length > 0 ? { results: session.results, total_candidates_found: session.totalCandidatesFound, match_quality: session.match_quality } : null)
            setAgentEvents(session.agentEvents || [])
            setStageTimings(session.stageTimings || {})
            setTotalTime(session.totalTime || 0)
            setCompletedStages(Object.keys(session.stageTimings || {}))
            setSessionLoaded(true)

            // Only force pipeline inactive if it's not the one we are running
            // (Though the check at start of function should handle this)
            setPipelineActive(false)
            setError(null)
        } catch (err) {
            console.error('Failed to load session:', err)
            setError('Failed to load session')
        } finally {
            setLoadingSession(false)
        }
    }

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
            if (searchMode === 'ai') {
                if (e.key === 'Enter' && !e.shiftKey) handleV2Search()
            } else {
                addSkill(inputValue)
            }
        } else if (searchMode === 'classic' && e.key === 'Backspace' && !inputValue && skills.length > 0) {
            removeSkill(skills[skills.length - 1])
        }
    }

    const handlePaste = (e) => {
        if (searchMode === 'ai') return
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
    const handleV2Search = async () => {
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
        setStageTimings({})
        setTotalTime(0)
        setSessionLoaded(false)
        pipelineStartTime.current = Date.now()

        // Create session in DB
        let sessionId = null
        try {
            const data = await createSession(query)
            sessionId = data.session.sessionId
            runningSessionId.current = sessionId // protect from loadSession override
            setCurrentSessionId(sessionId)
            onSessionCreated?.(sessionId)
        } catch (err) {
            console.error('Failed to create session:', err)
        }

        // Cancel any existing stream
        streamController.current?.abort()

        const collectedEvents = []
        const collectedTimings = {}

        streamController.current = fetchShortlistV2({
            queryText: query,
            onEvent: (eventType, data) => {
                const event = handleAgentEvent(eventType, data)
                if (event) collectedEvents.push(event)

                // Collect stage timings
                if (eventType === 'stage_complete' && data.timing_ms != null) {
                    const stage = data.stage
                    collectedTimings[stage] = data.timing_ms / 1000
                    setStageTimings(prev => ({ ...prev, [stage]: data.timing_ms / 1000 }))
                }

                // On result, save to session
                if (eventType === 'result' && sessionId) {
                    const elapsed = (Date.now() - pipelineStartTime.current) / 1000
                    setTotalTime(elapsed)
                    const resultData = data.data || data
                    updateSession(sessionId, {
                        status: 'completed',
                        missionSpec: resultData.mission_spec || null,
                        results: resultData.results || [],
                        agentEvents: collectedEvents,
                        stageTimings: collectedTimings,
                        totalTime: elapsed,
                        totalCandidatesFound: resultData.total_candidates_found || resultData.results?.length || 0,
                    }).catch(err => console.error('Failed to save session:', err))
                }
            },
            onError: (err) => {
                setError(err?.message || 'Pipeline failed')
                setPipelineActive(false)
                if (sessionId) {
                    updateSession(sessionId, { status: 'failed' }).catch(() => { })
                }
            },
            onDone: () => {
                setPipelineActive(false)
                setActiveAgent(null)
                if (!pipelineStartTime.current) return
                const elapsed = (Date.now() - pipelineStartTime.current) / 1000
                setTotalTime(elapsed)
            },
        })
    }

    const handleAgentEvent = (eventType, data) => {
        const timestamp = new Date().toLocaleTimeString()
        let event = null

        switch (eventType) {
            case 'agent_start':
                setActiveAgent(data.agent)
                event = { type: 'agent_start', ...data, timestamp }
                setAgentEvents(prev => [...prev, event])
                break
            case 'agent_thought':
                event = { type: 'thought', ...data, timestamp }
                setAgentEvents(prev => [...prev, event])
                break
            case 'tool_call':
                event = { type: 'tool_call', ...data, timestamp }
                setAgentEvents(prev => [...prev, event])
                break
            case 'tool_result':
                event = { type: 'tool_result', ...data, timestamp }
                setAgentEvents(prev => [...prev, event])
                break
            case 'stage_complete':
                setCompletedStages(prev => [...prev, data.stage])
                event = { type: 'stage_complete', ...data, timestamp }
                setAgentEvents(prev => [...prev, event])
                break
            case 'mission_spec':
                setMissionSpec(data.data || data)
                event = { type: 'mission_spec', ...data, timestamp }
                setAgentEvents(prev => [...prev, event])
                break
            case 'result':
                setV2Results(data.data || data)
                event = { type: 'result', message: data.message, timestamp }
                setAgentEvents(prev => [...prev, event])
                setPipelineActive(false)
                setActiveAgent(null)
                runningSessionId.current = null
                break
            case 'error':
                setError(data.message)
                setPipelineActive(false)
                setActiveAgent(null)
                runningSessionId.current = null
                break
            case 'done':
                setPipelineActive(false)
                setActiveAgent(null)
                runningSessionId.current = null
                break
            default:
                if (data.message) {
                    event = { type: 'info', ...data, timestamp }
                    setAgentEvents(prev => [...prev, event])
                }
        }
        return event
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

    // Sorting
    const handleSort = (field) => {
        if (sortField === field) {
            setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
        } else {
            setSortField(field)
            setSortDir('desc')
        }
    }

    const displayResults = searchMode === 'ai' ? (v2Results?.results || null) : results
    const sortedResults = displayResults ? [...displayResults].sort((a, b) => {
        let aVal, bVal
        switch (sortField) {
            case 'final_score':
                aVal = a.finalScore || a.final_score || 0
                bVal = b.finalScore || b.final_score || 0
                break
            case 'name':
                aVal = (a.name || a.headline || '').toLowerCase()
                bVal = (b.name || b.headline || '').toLowerCase()
                return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
            case 'experience':
                aVal = a.totalYOE || a.total_yoe || 0
                bVal = b.totalYOE || b.total_yoe || 0
                break
            default:
                aVal = a.finalScore || a.final_score || 0
                bVal = b.finalScore || b.final_score || 0
        }
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal
    }) : null

    const isAI = searchMode === 'ai'
    const hasEvents = agentEvents.length > 0
    const matchQuality = v2Results?.match_quality || 'strong'

    return (
        <div className="search-page-v3">
            {/* Mode selector (minimal) */}
            <div className="search-mode-bar">
                <button
                    className={`mode-tab ${searchMode === 'ai' ? 'active' : ''}`}
                    onClick={() => setSearchMode('ai')}
                >
                    🤖 AI Agent Search
                </button>
                <button
                    className={`mode-tab ${searchMode === 'classic' ? 'active' : ''}`}
                    onClick={() => setSearchMode('classic')}
                >
                    🔍 Classic Search
                </button>
                {hasEvents && (
                    <button
                        className={`agent-panel-toggle ${agentPanelOpen ? 'active' : ''}`}
                        onClick={() => setAgentPanelOpen(!agentPanelOpen)}
                        title="Toggle Agent Panel"
                    >
                        🤖 Agents {pipelineActive && '⟳'}
                    </button>
                )}
            </div>

            {/* Loading session */}
            {loadingSession && (
                <div className="loading-state">
                    <div className="spinner" />
                    <p>Loading session…</p>
                </div>
            )}

            {/* Search Input */}
            {!loadingSession && (
                <>
                    {isAI ? (
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
                                    placeholder="Describe the ideal candidate or paste a job description...&#10;&#10;Example: Senior Python developer with 5+ years in ML, AWS, Docker."
                                    rows={3}
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
                                    {pipelineActive ? '⏳ Agents Working…' : '🤖 Run Analysis'}
                                </button>
                                {pipelineActive && (
                                    <button className="cancel-btn" onClick={cancelPipeline}>
                                        ✕ Cancel
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
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
                                    <button className={`mode-btn ${mode === 'match_at_least' ? 'active' : ''}`} onClick={() => setMode('match_at_least')}>Match ≥ N</button>
                                </div>
                                {mode === 'match_at_least' && (
                                    <div className="min-match-input">
                                        <label>Min:</label>
                                        <input type="number" min={1} max={skills.length || 1} value={minMatch} onChange={e => setMinMatch(Math.max(1, parseInt(e.target.value) || 1))} />
                                        <label>of {skills.length}</label>
                                    </div>
                                )}
                                <button className="search-btn" onClick={handleV1Search} disabled={(skills.length === 0 && !inputValue.trim()) || loading}>
                                    {loading ? 'Searching…' : '⌕ Search'}
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ─── Inline Agent Progress (during pipeline) ─── */}
            {isAI && pipelineActive && (
                <div className="agent-progress-inline">
                    <div className="agent-progress-header">
                        <span className="agent-progress-pulse"></span>
                        <span>Agents analyzing your query…</span>
                    </div>
                    <div className="agent-timeline-inline">
                        {Object.entries(STAGE_LABELS).map(([key, { icon, label }]) => {
                            const isCompleted = completedStages.includes(key)
                            const isActive = activeAgent === label || activeAgent === key
                            const timing = stageTimings[key]
                            return (
                                <div key={key} className={`timeline-step ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}>
                                    <div className="timeline-step-marker">
                                        {isCompleted ? '✓' : isActive ? <span className="step-spinner"></span> : <span className="step-dot"></span>}
                                    </div>
                                    <div className="timeline-step-info">
                                        <span className="timeline-step-label">{icon} {label}</span>
                                        {timing != null && <span className="timeline-step-time">{timing.toFixed(1)}s</span>}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Error */}
            {error && <div className="error-state">⚠ {error}</div>}

            {/* V1 Meta */}
            {!isAI && meta && (
                <div className="search-meta">
                    <span><strong>{meta.totalCandidates}</strong> candidates matched</span>
                    <span>·</span>
                    <span><strong>{meta.resultsReturned}</strong> results shown</span>
                    <span>·</span>
                    <span>{meta.latencyMs}ms</span>
                </div>
            )}

            {/* V2 Results Meta */}
            {isAI && v2Results && !pipelineActive && (
                <>
                    {/* Weak match banner */}
                    {matchQuality === 'weak' && (
                        <div className="weak-match-banner">
                            <div className="weak-match-icon">⚠️</div>
                            <div className="weak-match-text">
                                <strong>No strong matches found for your query.</strong>
                                <p>The candidates below are <em>weak matches</em> — they may have some relevant experience but don't closely match your requirements. Consider broadening your search criteria or adjusting the required skills.</p>
                            </div>
                        </div>
                    )}

                    {matchQuality === 'none' && (
                        <div className="no-match-banner">
                            <div className="no-match-icon">❌</div>
                            <div className="no-match-text">
                                <strong>No candidates found matching this query.</strong>
                                <p>Try a broader description, different skills, or fewer constraints.</p>
                            </div>
                        </div>
                    )}

                    <div className={`results-meta-bar ${matchQuality === 'weak' ? 'weak' : ''}`}>
                        <div className="results-meta-left">
                            <span className="results-meta-count">
                                <strong>{v2Results.results?.length}</strong> {matchQuality === 'weak' ? 'weak matches' : 'candidates'}
                            </span>
                            <span className="results-meta-sep">·</span>
                            <span className="results-meta-total">
                                {v2Results.total_candidates_found || v2Results.results?.length} analyzed
                            </span>
                            <span className="results-meta-sep">·</span>
                            <span className="results-meta-time">
                                ⏱ {totalTime.toFixed(1)}s
                            </span>
                        </div>
                        <div className="results-meta-right">
                            <button className="dev-toggle" onClick={() => setShowScores(!showScores)}>
                                {showScores ? '🔒 Hide Scores' : '🔓 Scores'}
                            </button>
                            <button
                                className="rerun-btn"
                                onClick={handleV2Search}
                                title="Re-run analysis"
                            >
                                🔄 Re-run
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* Loading (V1) */}
            {!isAI && loading && (
                <div className="loading-state">
                    <div className="spinner" />
                    <p>Searching across {totalCount ? `${totalCount.toLocaleString()} resumes` : 'resumes'}…</p>
                </div>
            )}

            {/* Empty State */}
            {!loading && !pipelineActive && !sortedResults && !error && !loadingSession && (
                <div className="empty-state">
                    <div className="empty-state-icon">{isAI ? '🤖' : '🔍'}</div>
                    <h3>{isAI ? 'AI-Powered Candidate Search' : 'Search for candidates by skills'}</h3>
                    <p>{isAI
                        ? 'Describe the ideal candidate or paste a job description. Our AI agents will analyze, search, and rank candidates for you.'
                        : 'Enter one or more skills above to find matching resumes.'
                    }</p>
                    {isAI && (
                        <div className="empty-state-examples">
                            <p className="examples-label">Try:</p>
                            {['Senior full-stack developer with React and Node.js',
                                'Data scientist with Python, PyTorch, 3+ years experience',
                                'DevOps engineer familiar with AWS, Kubernetes, CI/CD'
                            ].map((ex, i) => (
                                <button key={i} className="example-query-btn" onClick={() => setQueryText(ex)}>
                                    {ex}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* No Results */}
            {sortedResults && sortedResults.length === 0 && (
                <div className="empty-state">
                    <div className="empty-state-icon">📭</div>
                    <h3>No candidates found</h3>
                    <p>{isAI ? 'Try a different query or broader requirements.' : 'Try fewer skills.'}</p>
                </div>
            )}

            {/* ─── Results Table ─── */}
            {sortedResults && sortedResults.length > 0 && (
                <div className="results-section">
                    <table className="results-table">
                        <thead>
                            <tr>
                                <th className="th-rank">#</th>
                                <th className="th-sortable" onClick={() => handleSort('name')}>
                                    Candidate {sortField === 'name' && (sortDir === 'asc' ? '▲' : '▼')}
                                </th>
                                <th className="th-sortable th-score" onClick={() => handleSort('final_score')}>
                                    Match {sortField === 'final_score' && (sortDir === 'asc' ? '▲' : '▼')}
                                </th>
                                <th className="th-skills">Skills</th>
                                <th className="th-sortable th-exp" onClick={() => handleSort('experience')}>
                                    Exp {sortField === 'experience' && (sortDir === 'asc' ? '▲' : '▼')}
                                </th>
                                <th className="th-location">Location</th>
                                <th className="th-actions">View</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedResults.map((r, idx) => {
                                const score = Math.round(r.finalScore || r.final_score || 0)
                                const yoe = r.totalYOE || r.total_yoe || 0
                                const location = r.location_country || r.locationCountry || ''
                                const matchedSkills = r.matchedSkills || r.matched_skills || []
                                const name = r.name || truncate(r.headline, 40) || 'Unknown'

                                return (
                                    <tr key={r.resumeId || r.candidate_id} className="result-row">
                                        <td className="td-rank">{idx + 1}</td>
                                        <td className="td-candidate">
                                            <div className="candidate-cell">
                                                <Link to={`/profile/${r.resumeId || r.candidate_id}`} className="candidate-name-link">
                                                    {name}
                                                </Link>
                                                <span className="candidate-headline">{truncate(r.headline, 50)}</span>
                                            </div>
                                        </td>
                                        <td className="td-score">
                                            <div className={`score-badge ${score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low'}`}>
                                                {score}%
                                            </div>
                                            {isAI && showScores && r.score_breakdown && (
                                                <div className="score-detail">
                                                    RRF:{r.score_breakdown.rrf_score?.toFixed(3)} CE:{r.score_breakdown.rerank_score?.toFixed(2)}
                                                </div>
                                            )}
                                        </td>
                                        <td className="td-skills">
                                            <div className="skills-cell">
                                                {matchedSkills.slice(0, 3).map(s => (
                                                    <span key={s} className="skill-chip matched tiny">✓ {s}</span>
                                                ))}
                                                {matchedSkills.length > 3 && (
                                                    <span className="skill-more">+{matchedSkills.length - 3}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="td-exp">{yoe > 0 ? `${yoe}y` : '—'}</td>
                                        <td className="td-location">{location || '—'}</td>
                                        <td className="td-actions">
                                            <Link to={`/profile/${r.resumeId || r.candidate_id}`} className="view-btn">
                                                →
                                            </Link>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>

                    {/* Total time footer */}
                    {isAI && totalTime > 0 && (
                        <div className="results-footer">
                            <span>Analysis completed in <strong>{totalTime.toFixed(1)}s</strong></span>
                            <span className="results-footer-sep">·</span>
                            <span>{sortedResults.length} candidates returned</span>
                        </div>
                    )}
                </div>
            )}

            {/* Agent Panel (right slide-out) */}
            <AgentPanel
                open={agentPanelOpen}
                onClose={() => setAgentPanelOpen(false)}
                agentEvents={agentEvents}
                stageLabels={STAGE_LABELS}
                completedStages={completedStages}
                activeAgent={activeAgent}
                pipelineActive={pipelineActive}
                missionSpec={missionSpec}
                stageTimings={stageTimings}
                totalTime={totalTime}
            />
        </div>
    )
}
