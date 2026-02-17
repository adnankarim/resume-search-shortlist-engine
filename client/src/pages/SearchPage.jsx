import { useState, useRef, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { searchResumes } from '../services/api'

export default function SearchPage() {
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

    // Fetch total count on mount for display purposes
    useEffect(() => {
        fetch('/api/resume/count')
            .then(res => res.json())
            .then(data => setTotalCount(data.count))
            .catch(err => console.error('Failed to fetch count:', err))
    }, [])

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
            addSkill(inputValue)
        } else if (e.key === 'Backspace' && !inputValue && skills.length > 0) {
            removeSkill(skills[skills.length - 1])
        }
    }

    const handlePaste = (e) => {
        e.preventDefault()
        const pasted = e.clipboardData.getData('text')
        const parts = pasted.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)
        parts.forEach(addSkill)
    }

    const handleSearch = async () => {
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

    const truncate = (text, maxLen = 200) => {
        if (!text || text.length <= maxLen) return text
        return text.slice(0, maxLen) + '…'
    }

    return (
        <div className="search-page">
            {/* Search Bar */}
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
                        <button
                            className={`mode-btn ${mode === 'match_all' ? 'active' : ''}`}
                            onClick={() => setMode('match_all')}
                        >
                            Match ALL
                        </button>
                        <button
                            className={`mode-btn ${mode === 'match_at_least' ? 'active' : ''}`}
                            onClick={() => setMode('match_at_least')}
                        >
                            Match at least N
                        </button>
                    </div>

                    {mode === 'match_at_least' && (
                        <div className="min-match-input">
                            <label>Min:</label>
                            <input
                                type="number"
                                min={1}
                                max={skills.length || 1}
                                value={minMatch}
                                onChange={e => setMinMatch(Math.max(1, parseInt(e.target.value) || 1))}
                            />
                            <label>of {skills.length}</label>
                        </div>
                    )}

                    <button
                        className="search-btn"
                        onClick={handleSearch}
                        disabled={(skills.length === 0 && !inputValue.trim()) || loading}
                    >
                        {loading ? 'Searching…' : '⌕ Search Candidates'}
                    </button>
                </div>
            </div>

            {/* Status */}
            {error && <div className="error-state">⚠ {error}</div>}

            {meta && (
                <div className="search-meta">
                    <span><strong>{meta.totalCandidates}</strong> candidates matched</span>
                    <span>·</span>
                    <span><strong>{meta.resultsReturned}</strong> results shown</span>
                    <span>·</span>
                    <span>{meta.latencyMs}ms</span>
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div className="loading-state">
                    <div className="spinner"></div>
                    <p>Searching across {totalCount ? `${totalCount.toLocaleString()} resumes` : 'resumes'}…</p>
                </div>
            )}

            {/* Empty State */}
            {!loading && !results && !error && (
                <div className="empty-state">
                    <div className="empty-state-icon">🔍</div>
                    <h3>Search for candidates by skills</h3>
                    <p>Enter one or more skills above to find matching resumes with evidence-backed results.</p>
                </div>
            )}

            {/* Results */}
            {results && results.length === 0 && (
                <div className="empty-state">
                    <div className="empty-state-icon">📭</div>
                    <h3>No candidates found</h3>
                    <p>Try fewer skills or switch to "Match at least N" mode.</p>
                </div>
            )}

            {results && results.length > 0 && (
                <div className="results-grid">
                    {results.map((r, idx) => (
                        <div key={r.resumeId} className="result-card-wrapper" style={{ position: 'relative' }}>
                            <Link to={`/profile/${r.resumeId}`} className="result-card">
                                <div className="result-card-header">
                                    <div className="result-card-top">
                                        <div className="result-headline">{truncate(r.headline, 60)}</div>
                                        <button
                                            className="delete-btn"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                if (window.confirm('Delete this resume?')) {
                                                    // optimistically remove
                                                    setResults(prev => prev.filter(res => res.resumeId !== r.resumeId));
                                                    // call api
                                                    import('../services/api').then(api => api.deleteResume(r.resumeId).catch(err => console.error(err)));
                                                }
                                            }}
                                            title="Delete Resume"
                                        >
                                            🗑
                                        </button>
                                    </div>
                                    <div className="result-meta">
                                        {r.totalYOE > 0 && (
                                            <span className="result-meta-item">📅 {r.totalYOE} yrs</span>
                                        )}
                                        {r.locationCountry && (
                                            <span className="result-meta-item">📍 {r.locationCountry}</span>
                                        )}
                                    </div>
                                    <div className="result-score-container" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                        <span className="result-score-badge similarity" title={`Hybrid score: ${r.finalScore}/100`}>
                                            🎯 {Math.round(r.finalScore)}% Match
                                        </span>
                                        <span className="result-score-badge skills">
                                            {r.matchedCount}/{r.totalQuerySkills} skills
                                        </span>
                                    </div>
                                </div>

                                <div className="result-score-breakdown" style={{
                                    padding: '0.5rem 1rem',
                                    background: 'rgba(255,255,255,0.03)',
                                    fontSize: '0.75rem',
                                    color: 'var(--text-muted)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    borderTop: '1px solid rgba(255,255,255,0.05)'
                                }}>
                                    <span>AI Similarity: {r.semanticScore}%</span>
                                    <span>Skills Match: {r.skillScore}%</span>
                                </div>

                                <div className="result-skills">
                                    {r.matchedSkills.slice(0, 5).map(skill => (
                                        <span key={skill} className="skill-chip matched small">✓ {skill}</span>
                                    ))}
                                    {r.matchedSkills.length > 5 && (
                                        <span className="skill-chip matched small">+{r.matchedSkills.length - 5}</span>
                                    )}
                                </div>

                                {r.evidence && r.evidence.length > 0 && (
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
