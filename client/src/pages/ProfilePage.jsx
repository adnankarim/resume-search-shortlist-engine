import { useState, useEffect } from 'react'
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom'
import { getResume, deleteResume } from '../services/api'

export default function ProfilePage() {
    const { resumeId } = useParams()
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [deleting, setDeleting] = useState(false)

    // Skills from search query for highlighting
    const querySkills = (searchParams.get('skills') || '').split(',').filter(Boolean)

    useEffect(() => {
        async function fetchProfile() {
            try {
                const result = await getResume(resumeId)
                setData(result)
            } catch (err) {
                setError(err.message)
            } finally {
                setLoading(false)
            }
        }
        fetchProfile()
    }, [resumeId])

    const handleDelete = async () => {
        if (!window.confirm("Are you sure you want to delete this resume? This action cannot be undone.")) return;

        setDeleting(true);
        try {
            await deleteResume(resumeId);
            // Redirect to home/search
            navigate('/');
        } catch (err) {
            alert(`Failed to delete: ${err.message}`);
            setDeleting(false);
        }
    }

    if (loading) {
        return (
            <div className="profile-page">
                <div className="loading-state">
                    <div className="spinner"></div>
                    <p>Loading profile…</p>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="profile-page">
                <Link to="/" className="back-link">← Back to search</Link>
                <div className="error-state">⚠ {error}</div>
            </div>
        )
    }

    const { profile, skills, chunks } = data
    const latestExp = profile.experience?.[0]

    return (
        <div className="profile-page">
            <div className="flex justify-between items-center">
                <Link to="/" className="back-link">← Back to search</Link>
                <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-red-500 hover:text-red-700 text-sm font-medium px-3 py-1 border border-transparent hover:border-red-200 rounded transition"
                >
                    {deleting ? 'Deleting...' : 'Delete Resume'}
                </button>
            </div>

            {/* Profile Header */}
            <div className="profile-header">
                <h1 className="profile-title">
                    {profile.personal_info?.name || 'Candidate Profile'}
                </h1>
                <div className="text-lg text-gray-600 mb-2 font-medium">
                    {latestExp ? `${latestExp.title} at ${latestExp.company}` : (profile.personal_info?.headline || 'No headline')}
                </div>

                {profile.personal_info?.summary && (
                    <p className="profile-subtitle">{profile.personal_info.summary}</p>
                )}

                <div className="profile-info mt-4 pt-4 border-t border-gray-100">
                    {profile.totalYOE > 0 && (
                        <span className="profile-info-item">📅 {profile.totalYOE} years experience</span>
                    )}
                    {(profile.locationCity || profile.locationCountry) && (
                        <span className="profile-info-item">
                            📍 {[profile.locationCity, profile.locationCountry].filter(Boolean).join(', ')}
                        </span>
                    )}
                    {profile.remotePreference && (
                        <span className="profile-info-item">🏠 {profile.remotePreference}</span>
                    )}
                    {profile.personal_info?.email && (
                        <span className="profile-info-item">✉️ {profile.personal_info.email}</span>
                    )}
                </div>
            </div>

            {/* Skills */}
            {skills && skills.length > 0 && (
                <div className="profile-skills-section">
                    <h2 className="section-title">🎯 Skills ({skills.length})</h2>
                    <div className="skills-grid">
                        {skills.map(s => (
                            <span
                                key={s.skill}
                                className={`skill-chip ${querySkills.includes(s.skill) ? 'matched' : 'unmatched'}`}
                            >
                                {s.skill}
                                {s.confidence >= 0.9 && ' ★'}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Experience */}
            {profile.experience && profile.experience.length > 0 && (
                <div className="profile-section">
                    <h2 className="section-title">💼 Experience</h2>
                    {profile.experience.map((exp, idx) => (
                        <div key={idx} className="experience-item">
                            <div className="exp-title">{exp.title}</div>
                            <div className="exp-company">{exp.company} {exp.companyInfo?.industry ? `· ${exp.companyInfo.industry}` : ''}</div>
                            <div className="exp-dates">
                                {exp.dates?.start} — {exp.dates?.end || 'Present'}
                                {exp.dates?.duration ? ` (${exp.dates.duration})` : ''}
                            </div>

                            {exp.responsibilities && exp.responsibilities.length > 0 && (
                                <ul className="exp-responsibilities">
                                    {exp.responsibilities.slice(0, 5).map((r, i) => (
                                        <li key={i}>{r}</li>
                                    ))}
                                    {exp.responsibilities.length > 5 && (
                                        <li style={{ color: 'var(--text-muted)' }}>
                                            +{exp.responsibilities.length - 5} more
                                        </li>
                                    )}
                                </ul>
                            )}

                            {exp.technicalEnvironment && (
                                <div className="exp-tech">
                                    {[
                                        ...(exp.technicalEnvironment.technologies || []),
                                        ...(exp.technicalEnvironment.tools || []),
                                    ].map((t, i) => (
                                        <span key={i} className="tech-tag">{t}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Projects */}
            {profile.projects && profile.projects.length > 0 && (
                <div className="profile-section">
                    <h2 className="section-title">🚀 Projects</h2>
                    {profile.projects.map((proj, idx) => (
                        <div key={idx} className="project-item">
                            <div className="exp-title">{proj.name}</div>
                            {proj.role && <div className="exp-company">{proj.role}</div>}
                            {proj.description && (
                                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.3rem', lineHeight: '1.5' }}>
                                    {proj.description}
                                </p>
                            )}
                            {proj.impact && (
                                <p style={{ fontSize: '0.82rem', color: 'var(--skill-matched)', marginTop: '0.3rem' }}>
                                    Impact: {proj.impact}
                                </p>
                            )}
                            {proj.technologies && proj.technologies.length > 0 && (
                                <div className="exp-tech" style={{ marginTop: '0.4rem' }}>
                                    {proj.technologies.map((t, i) => (
                                        <span key={i} className="tech-tag">{t}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Education */}
            {profile.education && profile.education.length > 0 && (
                <div className="profile-section">
                    <h2 className="section-title">🎓 Education</h2>
                    {profile.education.map((edu, idx) => (
                        <div key={idx} className="education-item">
                            <div className="exp-title">
                                {edu.degree?.level && `${edu.degree.level}'s`} in {edu.degree?.field || edu.degree?.major}
                            </div>
                            <div className="exp-company">{edu.institution?.name}</div>
                            <div className="exp-dates">
                                {edu.dates?.start} — {edu.dates?.expected_graduation || edu.dates?.end || ''}
                            </div>
                            {edu.achievements?.gpa && (
                                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                                    GPA: {edu.achievements.gpa}
                                    {edu.achievements.honors && ` · ${edu.achievements.honors}`}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Evidence Chunks */}
            {chunks && chunks.length > 0 && (
                <div className="profile-section">
                    <h2 className="section-title">📋 Evidence Chunks</h2>
                    {chunks.map((chunk, idx) => (
                        <div key={idx} style={{ marginBottom: '0.75rem' }}>
                            <div className="evidence-label">
                                {chunk.sectionType} #{chunk.sectionOrdinal + 1}
                                {chunk.skillsInChunk && chunk.skillsInChunk.length > 0 && (
                                    <span style={{ marginLeft: '0.5rem', fontWeight: 400, textTransform: 'none' }}>
                                        Skills: {chunk.skillsInChunk.join(', ')}
                                    </span>
                                )}
                            </div>
                            <div className="evidence-snippet">
                                {chunk.chunkText}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
