import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';

export default function Profile({ socket }) {
    const { username } = useParams();
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;
        socket.emit('getProfile', { username }, (data) => {
            if (!isMounted) return;
            setProfile(data);
            setLoading(false);
        });
        return () => { isMounted = false; };
    }, [username, socket]);

    if (loading) {
        return (
            <div className="page-container animate-fade-in" style={{ maxWidth: '900px' }}>
                <div style={{ textAlign: 'center', padding: '4rem 0' }}>
                    <div className="loading-spinner" style={{ margin: '0 auto 1rem' }}></div>
                    <p style={{ color: 'var(--text-secondary)' }}>加载中...</p>
                </div>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="page-container animate-fade-in" style={{ maxWidth: '900px' }}>
                <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem' }}>
                    <h2 style={{ color: 'var(--text-primary)' }}>用户不存在</h2>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '1rem' }}>
                        找不到用户 <strong>{username}</strong>
                    </p>
                    <Link to="/" className="btn" style={{ marginTop: '1.5rem', display: 'inline-block' }}>返回大厅</Link>
                </div>
            </div>
        );
    }

    const winRate = profile.games_played > 0
        ? ((profile.wins / profile.games_played) * 100).toFixed(1)
        : '0.0';

    // Rating color based on value
    const getRatingColor = (r) => {
        if (r >= 2000) return '#ef4444'; // red - master
        if (r >= 1800) return '#f59e0b'; // amber
        if (r >= 1600) return '#8b5cf6'; // purple
        if (r >= 1400) return '#3b82f6'; // blue
        if (r >= 1200) return '#10b981'; // green
        return '#6b7280'; // gray
    };

    // Simple SVG line chart for rating history
    const renderRatingChart = () => {
        const history = profile.ratingHistory || [];
        if (history.length < 2) {
            return <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>暂无足够数据绘制曲线</p>;
        }

        const ratings = history.map(h => h.rating);
        const minR = Math.min(...ratings) - 50;
        const maxR = Math.max(...ratings) + 50;
        const range = maxR - minR || 1;
        const w = 500, h = 180, pad = 30;

        const points = ratings.map((r, i) => {
            const x = pad + (i / (ratings.length - 1)) * (w - 2 * pad);
            const y = pad + (1 - (r - minR) / range) * (h - 2 * pad);
            return `${x},${y}`;
        }).join(' ');

        // Grid lines
        const gridLines = [];
        const steps = 4;
        for (let i = 0; i <= steps; i++) {
            const y = pad + (i / steps) * (h - 2 * pad);
            const val = Math.round(maxR - (i / steps) * range);
            gridLines.push(
                <g key={i}>
                    <line x1={pad} y1={y} x2={w - pad} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                    <text x={pad - 5} y={y + 4} textAnchor="end" fill="var(--text-secondary)" fontSize="10">{val}</text>
                </g>
            );
        }

        return (
            <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
                {gridLines}
                <polyline fill="none" stroke="var(--accent-color)" strokeWidth="2" points={points} />
                {/* Dot at the end */}
                {ratings.length > 0 && (() => {
                    const lastX = pad + ((ratings.length - 1) / (ratings.length - 1)) * (w - 2 * pad);
                    const lastY = pad + (1 - (ratings[ratings.length - 1] - minR) / range) * (h - 2 * pad);
                    return <circle cx={lastX} cy={lastY} r="4" fill="var(--accent-color)" />;
                })()}
            </svg>
        );
    };

    return (
        <div className="page-container animate-fade-in" style={{ maxWidth: '900px' }}>
            <div style={{ marginBottom: '1rem' }}>
                <Link to="/" style={{ color: 'var(--accent-color)', textDecoration: 'none', fontSize: '0.9rem' }}>← 返回大厅</Link>
            </div>

            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>

                {/* Left: User Info */}
                <div className="glass-panel" style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    {/* Avatar placeholder */}
                    <div style={{
                        width: '100px', height: '100px', borderRadius: '50%',
                        background: 'linear-gradient(135deg, var(--accent-color), var(--accent-blue))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '2.5rem', color: 'white', fontWeight: 700
                    }}>
                        {username.charAt(0).toUpperCase()}
                    </div>

                    <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>{username}</h2>

                    {/* Stats table */}
                    <div style={{ width: '100%', fontSize: '0.9rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--glass-border)' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Rating</span>
                            <span style={{ fontWeight: 700, color: getRatingColor(profile.rating), fontSize: '1.1rem' }}>{profile.rating}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--glass-border)' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>胜/负/投降</span>
                            <span style={{ color: 'var(--text-primary)' }}>
                                <span style={{ color: '#10b981' }}>{profile.wins}</span>
                                {' / '}
                                <span style={{ color: '#ef4444' }}>{profile.losses}</span>
                                {' / '}
                                <span style={{ color: '#f59e0b' }}>{profile.surrenders}</span>
                            </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--glass-border)' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>总场次</span>
                            <span style={{ color: 'var(--text-primary)' }}>{profile.games_played}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--glass-border)' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>胜率</span>
                            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{winRate}%</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>注册时间</span>
                            <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>{new Date(profile.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>

                    {/* Win rate donut */}
                    <div style={{ position: 'relative', width: '140px', height: '140px' }}>
                        <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                            <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(239,68,68,0.2)" strokeWidth="3" />
                            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#10b981" strokeWidth="3"
                                strokeDasharray={`${winRate} ${100 - parseFloat(winRate)}`} strokeLinecap="round" />
                        </svg>
                        <div style={{
                            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                            textAlign: 'center'
                        }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>胜率</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--accent-color)' }}>{winRate}%</div>
                        </div>
                    </div>
                </div>

                {/* Right: Rating chart + Match history */}
                <div style={{ flex: '2 1 400px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    {/* Rating chart */}
                    <div className="glass-panel">
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>Rating 变化</h3>
                        {renderRatingChart()}
                    </div>

                    {/* Match history */}
                    <div className="glass-panel" style={{ flex: 1 }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>对局记录</h3>
                        <div style={{ overflowY: 'auto', maxHeight: '400px' }}>
                            {(!profile.recentMatches || profile.recentMatches.length === 0) ? (
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>暂无对局记录</p>
                            ) : (
                                <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                                            <th style={{ padding: '0.5rem 0.3rem', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 500 }}>ID</th>
                                            <th style={{ padding: '0.5rem 0.3rem', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 500 }}>对阵</th>
                                            <th style={{ padding: '0.5rem 0.3rem', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 500 }}>Rating 变化</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {profile.recentMatches.map(m => {
                                            const rc = m.rating_changes?.[username];
                                            const isTeamA = (m.team_a_players || []).includes(username);
                                            const myTeam = isTeamA ? 'A' : 'B';
                                            const isWin = m.winner_team === myTeam;
                                            const teamANames = (m.team_a_players || []).join(', ');
                                            const teamBNames = (m.team_b_players || []).join(', ');

                                            return (
                                                <tr key={m.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                                    <td style={{ padding: '0.5rem 0.3rem', color: 'var(--text-secondary)' }}>#{m.id}</td>
                                                    <td style={{ padding: '0.5rem 0.3rem' }}>
                                                        <span style={{ color: isWin ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                                                            {isWin ? '胜' : (m.is_surrender && !isWin ? '投降' : '负')}
                                                        </span>
                                                        {' '}
                                                        <span style={{ color: 'var(--text-primary)' }}>
                                                            {teamANames} <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>vs</span> {teamBNames}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '0.5rem 0.3rem', textAlign: 'right', fontWeight: 600 }}>
                                                        {rc ? (
                                                            <span>
                                                                <span style={{ color: rc.change >= 0 ? '#10b981' : '#ef4444' }}>
                                                                    {rc.change >= 0 ? '+' : ''}{rc.change}
                                                                </span>
                                                                <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}> → {rc.after}</span>
                                                            </span>
                                                        ) : (
                                                            <span style={{ color: 'var(--text-secondary)' }}>—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
