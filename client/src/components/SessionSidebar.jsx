import { useState, useEffect } from 'react'
import { getSessions, deleteSession } from '../services/api'

/**
 * ChatGPT-style session sidebar.
 * Groups sessions by Today / Yesterday / Older.
 */
export default function SessionSidebar({
    activeSessionId,
    onSelectSession,
    onNewSearch,
    collapsed,
    onToggle,
}) {
    const [sessions, setSessions] = useState([])
    const [loading, setLoading] = useState(true)

    const fetchSessions = async () => {
        try {
            const data = await getSessions()
            setSessions(data.sessions || [])
        } catch (err) {
            console.error('Failed to load sessions:', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchSessions()
    }, [])

    // Refresh sessions when activeSessionId changes (new session was created)
    useEffect(() => {
        if (activeSessionId) {
            fetchSessions()
        }
    }, [activeSessionId])

    const handleDelete = async (e, sessionId) => {
        e.stopPropagation()
        if (!window.confirm('Delete this session?')) return
        try {
            await deleteSession(sessionId)
            setSessions(prev => prev.filter(s => s.sessionId !== sessionId))
            if (activeSessionId === sessionId) {
                onNewSearch()
            }
        } catch (err) {
            console.error('Failed to delete session:', err)
        }
    }

    // Group sessions by day
    const grouped = groupByDay(sessions)

    return (
        <div className={`session-sidebar ${collapsed ? 'collapsed' : ''}`}>
            <div className="sidebar-top">
                <button className="new-search-btn" onClick={onNewSearch}>
                    <span className="new-search-icon">+</span>
                    {!collapsed && <span>New Search</span>}
                </button>
                <button className="collapse-sidebar-btn" onClick={onToggle}>
                    {collapsed ? '▸' : '◂'}
                </button>
            </div>

            {!collapsed && (
                <div className="session-list">
                    {loading ? (
                        <div className="session-loading">
                            <span className="session-loading-dots">
                                <span>●</span><span>●</span><span>●</span>
                            </span>
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="session-empty">
                            <p>No searches yet</p>
                            <p className="session-empty-hint">Start by describing your ideal candidate</p>
                        </div>
                    ) : (
                        Object.entries(grouped).map(([group, items]) => (
                            <div key={group} className="session-group">
                                <div className="session-group-label">{group}</div>
                                {items.map(session => (
                                    <div
                                        key={session.sessionId}
                                        className={`session-item ${activeSessionId === session.sessionId ? 'active' : ''}`}
                                        onClick={() => onSelectSession(session.sessionId)}
                                    >
                                        <div className="session-item-content">
                                            <span className="session-item-title">{session.title}</span>
                                            <span className={`session-item-status ${session.status}`}>
                                                {session.status === 'completed' && '✓'}
                                                {session.status === 'running' && '⟳'}
                                                {session.status === 'failed' && '✕'}
                                            </span>
                                        </div>
                                        {session.totalTime > 0 && (
                                            <span className="session-item-meta">
                                                {session.totalTime.toFixed(1)}s · {session.totalCandidatesFound || 0} results
                                            </span>
                                        )}
                                        <button
                                            className="session-delete-btn"
                                            onClick={(e) => handleDelete(e, session.sessionId)}
                                            title="Delete session"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    )
}

function groupByDay(sessions) {
    const groups = {}
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const weekAgo = new Date(today)
    weekAgo.setDate(weekAgo.getDate() - 7)

    for (const session of sessions) {
        const date = new Date(session.updatedAt || session.createdAt)
        let group
        if (date >= today) {
            group = 'Today'
        } else if (date >= yesterday) {
            group = 'Yesterday'
        } else if (date >= weekAgo) {
            group = 'Previous 7 days'
        } else {
            group = 'Older'
        }
        if (!groups[group]) groups[group] = []
        groups[group].push(session)
    }

    return groups
}
