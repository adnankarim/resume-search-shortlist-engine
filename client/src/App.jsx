import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import SearchPage from './pages/SearchPage'
import ProfilePage from './pages/ProfilePage'
import IngestionPage from './pages/IngestionPage'

function App() {
    return (
        <BrowserRouter>
            <div className="app">
                <header className="app-header">
                    <Link to="/" className="logo">
                        <span className="logo-icon">◉</span>
                        <span className="logo-text">ResumeSearch</span>
                    </Link>
                    <nav className="app-nav" style={{ marginLeft: 'auto', display: 'flex', gap: '20px' }}>
                        <Link to="/" style={{ color: 'white', textDecoration: 'none' }}>Search</Link>
                        <Link to="/ingestion" style={{ color: 'white', textDecoration: 'none' }}>Ingest</Link>
                    </nav>
                    <p className="logo-tagline">Intelligent Candidate Discovery</p>
                </header>
                <main className="app-main">
                    <Routes>
                        <Route path="/" element={<SearchPage />} />
                        <Route path="/profile/:resumeId" element={<ProfilePage />} />
                        <Route path="/ingestion" element={<IngestionPage />} />
                    </Routes>
                </main>
            </div>
        </BrowserRouter>
    )
}

export default App
