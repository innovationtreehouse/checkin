"use client";

import { useState, useEffect } from "react";

type DailyStat = {
    date: string;
    count: number;
    median: number;
    p90: number;
    p99: number;
};

// A dependency-free SVG Line Chart Component
function SvgLineChart({ data }: { data: DailyStat[] }) {
    if (data.length === 0) return <div style={{ color: 'var(--color-text-muted)' }}>No data available.</div>;

    const width = 800;
    const height = 400;
    const padding = 40;
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    // Find max value to scale the Y axis
    const maxP99 = Math.max(...data.map(d => d.p99), 100); // minimum scale is 100ms
    const yMax = Math.ceil(maxP99 / 100) * 100 + 50; // Add some headroom

    const getX = (index: number) => padding + (index / (data.length - 1)) * graphWidth;
    const getY = (value: number) => height - padding - (value / yMax) * graphHeight;

    const createPath = (key: 'median' | 'p90' | 'p99') => {
        return data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d[key])}`).join(' ');
    };

    return (
        <div style={{ width: '100%', overflowX: 'auto', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '12px' }}>
            <svg width="100%" height="auto" viewBox={`0 0 ${width} ${height}`} style={{ minWidth: '600px', display: 'block' }}>
                {/* Background Grid */}
                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                    const y = padding + graphHeight * ratio;
                    const val = Math.round(yMax * (1 - ratio));
                    return (
                        <g key={ratio}>
                            <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="4,4" />
                            <text x={padding - 10} y={y + 4} fill="var(--color-text-muted)" fontSize="12" textAnchor="end">{val}ms</text>
                        </g>
                    );
                })}

                {/* Data Lines */}
                <path d={createPath('median')} fill="none" stroke="#4ade80" strokeWidth="3" style={{ filter: 'drop-shadow(0 2px 4px rgba(74, 222, 128, 0.4))' }} />
                <path d={createPath('p90')} fill="none" stroke="#facc15" strokeWidth="3" style={{ opacity: 0.8 }} />
                <path d={createPath('p99')} fill="none" stroke="#ef4444" strokeWidth="3" style={{ opacity: 0.8 }} />

                {/* Data Points and Tooltips (simulated via titles for simplicity) */}
                {data.map((d, i) => (
                    <g key={i}>
                        <circle cx={getX(i)} cy={getY(d.p99)} r="4" fill="#ef4444" className="graph-point">
                            <title>{d.date} - P99: {d.p99}ms ({d.count} scans)</title>
                        </circle>
                        <circle cx={getX(i)} cy={getY(d.p90)} r="4" fill="#facc15" className="graph-point">
                            <title>{d.date} - P90: {d.p90}ms ({d.count} scans)</title>
                        </circle>
                        <circle cx={getX(i)} cy={getY(d.median)} r="4" fill="#4ade80" className="graph-point">
                            <title>{d.date} - Median: {d.median}ms ({d.count} scans)</title>
                        </circle>

                        {/* X-Axis Labels (every 5 days to avoid crowding) */}
                        {i % 5 === 0 && (
                            <text x={getX(i)} y={height - 15} fill="var(--color-text-muted)" fontSize="12" textAnchor="middle">
                                {d.date.substring(5)} {/* Show MM-DD */}
                            </text>
                        )}
                    </g>
                ))}
            </svg>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginTop: '1rem', fontSize: '0.9rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: '12px', height: '12px', background: '#4ade80', borderRadius: '50%' }}></div>
                    <span>Median</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: '12px', height: '12px', background: '#facc15', borderRadius: '50%' }}></div>
                    <span>P90</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: '12px', height: '12px', background: '#ef4444', borderRadius: '50%' }}></div>
                    <span>P99</span>
                </div>
            </div>
            <style jsx>{`
                .graph-point {
                    transition: r 0.2s ease;
                    cursor: pointer;
                }
                .graph-point:hover {
                    r: 8;
                }
            `}</style>
        </div>
    );
}

type UpdateInfo = {
    updateAvailable: boolean;
    currentSha: string;
    latestSha: string;
    changes?: string[];
};

export default function SystemHealthPage() {
    const [stats, setStats] = useState<DailyStat[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

    useEffect(() => {
        fetch('/api/admin/system-health')
            .then(res => res.json())
            .then(data => {
                if (data && data.days) {
                    setStats(data.days);
                }
            })
            .catch(console.error)
            .finally(() => setLoading(false));

        fetch('/api/admin/update-status')
            .then(res => res.json())
            .then(setUpdateInfo)
            .catch(console.error);
    }, []);

    return (
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "1rem" }}>
            <div className="glass-container animate-float" style={{ padding: '2rem', marginBottom: '2rem' }}>
                <h1 className="text-gradient" style={{ marginTop: 0 }}>System Health</h1>
                <p style={{ color: 'var(--color-text-muted)' }}>
                    Monitor the backend performance and round-trip response times for Kiosk functionality.
                </p>
            </div>

            {updateInfo?.updateAvailable && (
                <div className="glass-container" style={{
                    padding: '2rem',
                    marginBottom: '2rem',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    boxShadow: '0 8px 32px 0 rgba(59, 130, 246, 0.15)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <div style={{
                                width: '12px',
                                height: '12px',
                                background: '#ef4444',
                                borderRadius: '50%',
                                boxShadow: '0 0 8px #ef4444'
                            }}></div>
                            <h3 style={{ margin: 0, color: 'var(--color-primary)' }}>Update Available</h3>
                            <span style={{
                                fontSize: '0.8rem',
                                background: 'rgba(255,255,255,0.1)',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '4px',
                                color: 'var(--color-text-muted)'
                            }}>
                                {updateInfo.currentSha.substring(0, 7)} → {updateInfo.latestSha.substring(0, 7)}
                            </span>
                        </div>
                        <a
                            href="https://github.com/innovationtreehouse/checkin"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="glass-button"
                            style={{
                                background: 'var(--color-primary)',
                                color: 'white',
                                border: 'none',
                                padding: '0.6rem 1.2rem',
                                fontSize: '0.9rem'
                            }}
                        >
                            Upgrade Now
                        </a>
                    </div>

                    {updateInfo.changes && updateInfo.changes.length > 0 && (
                        <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                            <p style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--color-text-muted)' }}>Changes in this version:</p>
                            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: 'var(--color-text-main)', opacity: 0.8 }}>
                                {updateInfo.changes.slice(0, 5).map((change, idx) => (
                                    <li key={idx} style={{ marginBottom: '0.25rem' }}>{change}</li>
                                ))}
                                {updateInfo.changes.length > 5 && (
                                    <li style={{ listStyle: 'none', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                        ...and {updateInfo.changes.length - 5} more changes
                                    </li>
                                )}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            <div className="glass-container" style={{ padding: '2rem' }}>
                <h3 style={{ marginTop: 0, color: 'var(--color-primary)' }}>Badge Scan Response Times (Last 30 Days)</h3>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
                    This graph displays the operational latency of the badge scanning system. Lower values indicate faster responses.
                </p>
                
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--color-text-muted)' }}>
                        Loading metrics...
                    </div>
                ) : stats ? (
                    <SvgLineChart data={stats} />
                ) : (
                    <div style={{ textAlign: 'center', padding: '4rem', color: '#ef4444' }}>
                        Failed to load metrics.
                    </div>
                )}
            </div>
        </div>
    );
}
