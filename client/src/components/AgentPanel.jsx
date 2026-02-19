import { useState } from 'react'

/**
 * Right slide-out agent panel — GPT-style tool panel.
 * Shows agent timeline, timing breakdown, expandable logs.
 */
export default function AgentPanel({
    open,
    onClose,
    agentEvents,
    stageLabels,
    completedStages,
    activeAgent,
    pipelineActive,
    missionSpec,
    stageTimings,
    totalTime,
}) {
    const [expandedAgent, setExpandedAgent] = useState(null)

    if (!open) return null

    // Group events by agent for expandable logs
    const agentGroups = {}
    for (const ev of agentEvents) {
        const agent = ev.agent || 'System'
        if (!agentGroups[agent]) agentGroups[agent] = []
        agentGroups[agent].push(ev)
    }

    // Calculate timing percentages
    const timingEntries = Object.entries(stageTimings || {})
    const totalTimingSum = timingEntries.reduce((sum, [, t]) => sum + t, 0)

    return (
        <div className="agent-panel-overlay">
            <div className="agent-right-panel">
                {/* Header */}
                <div className="panel-header">
                    <h3>🤖 Agent Details</h3>
                    <button className="panel-close-btn" onClick={onClose}>✕</button>
                </div>

                {/* Status */}
                <div className={`panel-status ${pipelineActive ? 'active' : 'done'}`}>
                    {pipelineActive ? (
                        <>
                            <span className="panel-status-pulse"></span>
                            <span>Agents Working…</span>
                        </>
                    ) : totalTime > 0 ? (
                        <>
                            <span className="panel-status-done">✅</span>
                            <span>Completed in <strong>{totalTime.toFixed(1)}s</strong></span>
                        </>
                    ) : (
                        <span className="panel-status-idle">No analysis running</span>
                    )}
                </div>

                {/* Agent Timeline */}
                <div className="panel-section">
                    <div className="panel-section-title">Agent Timeline</div>
                    <div className="agent-timeline">
                        {Object.entries(stageLabels).map(([key, { icon, label }]) => {
                            const isCompleted = completedStages.includes(key)
                            const isActive = activeAgent === label || activeAgent === key
                            const timing = stageTimings?.[key]

                            return (
                                <div
                                    key={key}
                                    className={`timeline-item ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}
                                    onClick={() => setExpandedAgent(expandedAgent === key ? null : key)}
                                >
                                    <div className="timeline-marker">
                                        {isCompleted ? '✓' : isActive ? (
                                            <span className="timeline-spinner"></span>
                                        ) : (
                                            <span className="timeline-dot"></span>
                                        )}
                                    </div>
                                    <div className="timeline-content">
                                        <div className="timeline-label">
                                            <span>{icon} {label}</span>
                                            {timing != null && (
                                                <span className="timeline-timing">{timing.toFixed(1)}s</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>

                {/* Timing Breakdown */}
                {timingEntries.length > 0 && (
                    <div className="panel-section">
                        <div className="panel-section-title">Time Breakdown</div>
                        <div className="timing-breakdown">
                            {timingEntries.map(([stage, time]) => {
                                const pct = totalTimingSum > 0 ? (time / totalTimingSum * 100) : 0
                                const stageInfo = stageLabels[stage] || { icon: '⚙', label: stage }
                                return (
                                    <div key={stage} className="timing-row">
                                        <span className="timing-label">{stageInfo.label}</span>
                                        <div className="timing-bar-bg">
                                            <div
                                                className="timing-bar-fill"
                                                style={{ width: `${pct}%` }}
                                            ></div>
                                        </div>
                                        <span className="timing-value">{time.toFixed(1)}s</span>
                                        <span className="timing-pct">{pct.toFixed(0)}%</span>
                                    </div>
                                )
                            })}
                            <div className="timing-total">
                                <span>Total</span>
                                <strong>{totalTimingSum.toFixed(1)}s</strong>
                            </div>
                        </div>
                    </div>
                )}

                {/* Mission Spec */}
                {missionSpec && (
                    <div className="panel-section">
                        <div className="panel-section-title">📋 Extracted Requirements</div>
                        <div className="panel-mission-spec">
                            {missionSpec.core_domain && (
                                <div className="panel-spec-row">
                                    <span className="panel-spec-label">Domain</span>
                                    <span className="panel-spec-chip domain">{missionSpec.core_domain}</span>
                                </div>
                            )}
                            {missionSpec.must_have?.length > 0 && (
                                <div className="panel-spec-row">
                                    <span className="panel-spec-label">Must Have</span>
                                    <div className="panel-spec-chips">
                                        {missionSpec.must_have.map((s, i) => (
                                            <span key={i} className="panel-spec-chip must">{s}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {missionSpec.nice_to_have?.length > 0 && (
                                <div className="panel-spec-row">
                                    <span className="panel-spec-label">Nice to Have</span>
                                    <div className="panel-spec-chips">
                                        {missionSpec.nice_to_have.map((s, i) => (
                                            <span key={i} className="panel-spec-chip nice">{s}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {missionSpec.min_years && (
                                <div className="panel-spec-row">
                                    <span className="panel-spec-label">Experience</span>
                                    <span className="panel-spec-value">{missionSpec.min_years}+ years</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Expandable Agent Logs */}
                {Object.keys(agentGroups).length > 0 && (
                    <div className="panel-section">
                        <div className="panel-section-title">📊 Agent Logs</div>
                        <div className="agent-logs">
                            {Object.entries(agentGroups).map(([agent, events]) => (
                                <div key={agent} className="agent-log-group">
                                    <div
                                        className="agent-log-header"
                                        onClick={() => setExpandedAgent(expandedAgent === agent ? null : agent)}
                                    >
                                        <span className="agent-log-name">🤖 {agent}</span>
                                        <span className="agent-log-count">{events.length} events</span>
                                        <span className="agent-log-toggle">{expandedAgent === agent ? '▾' : '▸'}</span>
                                    </div>
                                    {expandedAgent === agent && (
                                        <div className="agent-log-events">
                                            {events.map((ev, i) => (
                                                <div key={i} className={`agent-log-event ${ev.type}`}>
                                                    <span className="agent-log-event-icon">
                                                        {ev.type === 'agent_start' && '▶'}
                                                        {ev.type === 'thought' && '💭'}
                                                        {ev.type === 'tool_call' && '🔧'}
                                                        {ev.type === 'tool_result' && '📊'}
                                                        {ev.type === 'stage_complete' && '✅'}
                                                        {ev.type === 'info' && 'ℹ'}
                                                    </span>
                                                    <span className="agent-log-event-msg">{ev.message}</span>
                                                    {ev.timing_ms != null && (
                                                        <span className="agent-log-event-time">{ev.timing_ms}ms</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
