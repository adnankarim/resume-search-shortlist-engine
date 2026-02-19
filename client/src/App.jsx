import { useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import SearchPage from './pages/SearchPage'
import ProfilePage from './pages/ProfilePage'
import IngestionPage from './pages/IngestionPage'
import SessionSidebar from './components/SessionSidebar'

function App() {
    const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false)
    const [activeSessionId, setActiveSessionId] = useState(null)
    const [sessionRefreshKey, setSessionRefreshKey] = useState(0)

    const handleNewSearch = useCallback(() => {
        setActiveSessionId(null)
    }, [])

    const handleSelectSession = useCallback((sessionId) => {
        setActiveSessionId(sessionId)
    }, [])

    const handleSessionCreated = useCallback((sessionId) => {
        setActiveSessionId(sessionId)
        setSessionRefreshKey(k => k + 1)
    }, [])

    return (
        <BrowserRouter>
            <div className="app-shell">
                {/* Top Bar */}
                <header className="top-bar">
                    <div className="top-bar-left">
                        <button
                            className="sidebar-menu-btn"
                            onClick={() => setLeftSidebarCollapsed(prev => !prev)}
                            title={leftSidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
                        >
                            ☰
                        </button>
                        <Link to="/" className="logo" onClick={handleNewSearch}>
                            <span className="logo-icon">◉</span>
                            <span className="logo-text">ResumeSearch</span>
                        </Link>
                    </div>
                    <nav className="top-bar-nav">
                        <Link to="/" className="nav-link" onClick={handleNewSearch}>Search</Link>
                        <Link to="/ingestion" className="nav-link">Ingest</Link>
                    </nav>
                </header>

                {/* 3-Panel Layout */}
                <div className="app-layout">
                    {/* Left Sidebar */}
                    <SessionSidebar
                        activeSessionId={activeSessionId}
                        onSelectSession={handleSelectSession}
                        onNewSearch={handleNewSearch}
                        collapsed={leftSidebarCollapsed}
                        onToggle={() => setLeftSidebarCollapsed(prev => !prev)}
                        key={sessionRefreshKey}
                    />

                    {/* Main Content */}
                    <main className="main-content">
                        <Routes>
                            <Route
                                path="/"
                                element={
                                    <SearchPage
                                        activeSessionId={activeSessionId}
                                        onSessionCreated={handleSessionCreated}
                                    />
                                }
                            />
                            <Route path="/profile/:resumeId" element={<ProfilePage />} />
                            <Route path="/ingestion" element={<IngestionPage />} />
                        </Routes>
                    </main>
                </div>
            </div>
        </BrowserRouter>
    )
}

export default App
