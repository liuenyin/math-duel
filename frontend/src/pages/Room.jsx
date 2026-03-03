import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import renderMathInElement from 'katex/contrib/auto-render';

export default function Room({ socket, playerName }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const config = location.state?.config;

  const [room, setRoom] = useState(null);
  const [paper, setPaper] = useState([]);
  const [totalProblems, setTotalProblems] = useState(0);
  const [activeProb, setActiveProb] = useState(0);
  const [replacingProbs, setReplacingProbs] = useState({}); // { index: true }

  const [answer, setAnswer] = useState('');
  const [steps, setSteps] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [winnerTeam, setWinnerTeam] = useState(null);
  const [judging, setJudging] = useState(false);

  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatTab, setChatTab] = useState('all');
  const chatEndRef = useRef(null);
  const problemRef = useRef(null);

  useEffect(() => {
    if (!playerName) { navigate('/'); return; }

    socket.on('roomUpdate', (updatedRoom) => {
      setRoom(updatedRoom);
      if (updatedRoom.status === 'playing' || updatedRoom.status === 'generating') {
        setWinnerTeam(null);
        setFeedbackMsg('');
      }
    });

    // Full paper reset (start of new game)
    socket.on('paperGenerated', (data) => {
      setPaper(data.paper || []);
      setTotalProblems(data.total || 0);
      setActiveProb(0);
      setAnswer('');
      setSteps('');
      setReplacingProbs({});
    });

    // Single problem arrives incrementally
    socket.on('problemAdded', (data) => {
      setPaper(prev => {
        const newPaper = [...prev];
        newPaper[data.index] = data.problem;
        return newPaper;
      });
      setTotalProblems(data.total);
    });

    // Single problem being replaced
    socket.on('problemReplacing', (data) => {
      setReplacingProbs(prev => ({ ...prev, [data.probIndex]: true }));
    });

    // Single problem replaced
    socket.on('problemReplaced', (data) => {
      setPaper(prev => {
        const newPaper = [...prev];
        newPaper[data.probIndex] = data.problem;
        return newPaper;
      });
      setReplacingProbs(prev => {
        const n = { ...prev };
        delete n[data.probIndex];
        return n;
      });
    });

    socket.on('judgingPending', () => setJudging(true));

    socket.on('answerResult', (data) => {
      setJudging(false);
      setFeedbackMsg(data.message);
      setTimeout(() => setFeedbackMsg(''), 6000);
    });

    socket.on('problemLocked', (data) => {
      if (data.probIndex === activeProb) {
        setFeedbackMsg(`${data.team} 队以 ≥95% 的得分攻破了本题！`);
      }
    });

    socket.on('matchEnded', (data) => {
      setWinnerTeam(data.winner);
    });

    socket.on('chatMessage', (msg) => {
      setChatMessages(prev => [...prev, msg]);
    });

    socket.on('globalError', (data) => alert(data.message));

    const doJoin = () => {
      socket.emit('joinRoom', { roomId: id, playerName, config }, (res) => {
        if (res && res.error) { alert(res.error); navigate('/'); }
      });
    };

    if (socket.connected) { doJoin(); }
    else { socket.once('connect', doJoin); }

    return () => {
      socket.off('roomUpdate');
      socket.off('paperGenerated');
      socket.off('problemAdded');
      socket.off('problemReplacing');
      socket.off('problemReplaced');
      socket.off('judgingPending');
      socket.off('answerResult');
      socket.off('problemLocked');
      socket.off('matchEnded');
      socket.off('chatMessage');
      socket.off('globalError');
      socket.off('connect', doJoin);
    };
  }, [id, playerName, navigate, socket, config]);

  // Render KaTeX with auto-render
  useEffect(() => {
    if (room && paper.length > 0 && paper[activeProb] && problemRef.current) {
      problemRef.current.textContent = paper[activeProb].problem;
      try {
        renderMathInElement(problemRef.current, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false }
          ],
          throwOnError: false
        });
      } catch (e) { /* fallback: raw text already set */ }
    }
  }, [activeProb, paper, room]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatTab]);

  if (!room) {
    return (
      <div className="page-container" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 1rem' }}></div>
          <p style={{ color: 'var(--text-secondary)' }}>正在连接房间...</p>
        </div>
      </div>
    );
  }

  const me = room.players.find(p => p.id === socket.id);
  if (!me) return null;

  const teamA = room.players.filter(p => p.team === 'A');
  const teamB = room.players.filter(p => p.team === 'B');
  const targetScore = room.config.points.reduce((a, b) => a + b, 0) / 2;

  const handleJoinTeam = (teamStr) => {
    if (me.team !== teamStr) socket.emit('switchTeam', { roomId: id, team: teamStr });
  };

  const submitAnswer = (e) => {
    e.preventDefault();
    if (!answer.trim() && !steps.trim()) return;
    socket.emit('submitAnswerSteps', { roomId: id, probIndex: activeProb, answer, steps });
  };

  const isProbLockedByOther = (idx) => {
    const lock = room.state.locks[idx];
    return lock && lock !== me.team;
  };
  const isProbLockedByUs = (idx) => {
    const lock = room.state.locks[idx];
    return lock === me.team;
  };

  const sendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socket.emit('sendChat', { roomId: id, message: chatInput.trim(), chatType: chatTab });
    setChatInput('');
  };

  const handleReplaceProblem = (idx) => {
    if (confirm(`确定要换掉第 ${idx + 1} 题吗？该题的得分将被重置。`)) {
      socket.emit('replaceProblem', { roomId: id, probIndex: idx });
    }
  };

  const filteredMessages = chatMessages.filter(m =>
    chatTab === 'all' ? m.chatType === 'all' : (m.chatType === 'team' && m.team === me.team)
  );

  const teamAColor = '#10b981';
  const teamBColor = '#3b82f6';

  const isGenerating = room.status === 'playing' && paper.length < totalProblems && totalProblems > 0;
  const hasPaper = paper.length > 0;

  return (
    <div className="page-container animate-fade-in" style={{ maxWidth: '1400px' }}>
      {/* Header bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          数学对决 · 房间 <span style={{ color: 'var(--accent-color)' }}>{id}</span>
        </h2>
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <h3 style={{ color: teamAColor, fontSize: '1rem', fontWeight: 600 }}>A队：{room.teamScores.A.toFixed(1)} / {targetScore}</h3>
          <h3 style={{ color: teamBColor, fontSize: '1rem', fontWeight: 600 }}>B队：{room.teamScores.B.toFixed(1)} / {targetScore}</h3>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1.25rem', width: '100%' }}>

        {/* Play Area */}
        <div className="glass-panel" style={{ flex: 3, display: 'flex', flexDirection: 'column', minHeight: '500px' }}>

          {winnerTeam && (
            <div style={{
              background: 'linear-gradient(135deg, #10b981, #34d399)',
              color: 'white', padding: '1rem', borderRadius: '10px',
              marginBottom: '1rem', textAlign: 'center', fontWeight: 'bold',
              fontSize: '1.1rem', boxShadow: '0 2px 12px rgba(16, 185, 129, 0.3)'
            }}>
              🏆 比赛结束！{winnerTeam} 队获胜！
            </div>
          )}

          {feedbackMsg && (
            <div style={{
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              color: 'var(--text-primary)', padding: '0.85rem 1rem',
              borderRadius: '10px', marginBottom: '1rem', textAlign: 'center', fontSize: '0.95rem'
            }}>
              {feedbackMsg}
            </div>
          )}

          {room.status === 'waiting' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2rem' }}>
              <h3 style={{ fontWeight: 600 }}>选择你的队伍并准备</h3>
              <div style={{ display: 'flex', gap: '1.5rem', width: '100%', justifyContent: 'center' }}>
                <div style={{
                  flex: 1, padding: '1.25rem', border: `2px solid ${teamAColor}`,
                  borderRadius: '12px', textAlign: 'center',
                  background: me.team === 'A' ? 'rgba(16, 185, 129, 0.06)' : 'transparent', transition: 'all 0.2s'
                }}>
                  <h4 style={{ color: teamAColor, marginBottom: '0.75rem', fontWeight: 600 }}>A队（{teamA.length}人）</h4>
                  {teamA.map(p => <div key={p.id} style={{ padding: '0.2rem 0', fontSize: '0.95rem' }}>{p.name} {p.ready ? '✅' : ''}</div>)}
                  <button className="btn" style={{ marginTop: '1rem', fontSize: '0.9rem' }} onClick={() => handleJoinTeam('A')}>加入 A 队</button>
                </div>
                <div style={{
                  flex: 1, padding: '1.25rem', border: `2px solid ${teamBColor}`,
                  borderRadius: '12px', textAlign: 'center',
                  background: me.team === 'B' ? 'rgba(59, 130, 246, 0.06)' : 'transparent', transition: 'all 0.2s'
                }}>
                  <h4 style={{ color: teamBColor, marginBottom: '0.75rem', fontWeight: 600 }}>B队（{teamB.length}人）</h4>
                  {teamB.map(p => <div key={p.id} style={{ padding: '0.2rem 0', fontSize: '0.95rem' }}>{p.name} {p.ready ? '✅' : ''}</div>)}
                  <button className="btn btn-blue" style={{ marginTop: '1rem', fontSize: '0.9rem' }} onClick={() => handleJoinTeam('B')}>加入 B 队</button>
                </div>
              </div>
              <button
                className={`btn ${me.ready ? 'btn-secondary' : ''}`}
                onClick={() => socket.emit('setReady', { roomId: id, ready: !me.ready })}
                style={{ width: '50%' }}
              >
                {me.ready ? "取消准备" : "已准备 ✓"}
              </button>
            </div>
          )}

          {/* Show paper area when playing (even if still generating remaining problems) */}
          {(room.status === 'playing' || room.status === 'ended') && hasPaper && (
            <div style={{ flex: 1, display: 'flex' }}>
              {/* Sidebar Paper Nav */}
              <div style={{
                width: '180px', borderRight: '1px solid var(--glass-border)',
                paddingRight: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', overflowY: 'auto'
              }}>
                <h4 style={{ marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  题目列表 {isGenerating && <span className="animate-pulse" style={{ fontSize: '0.75rem', color: 'var(--accent-color)' }}>({paper.length}/{totalProblems})</span>}
                </h4>
                {/* Show existing problems + placeholders for ones still generating */}
                {Array.from({ length: totalProblems || paper.length }).map((_, idx) => {
                  const exists = !!paper[idx];
                  const isReplacing = replacingProbs[idx];
                  const lockedByUs = exists && isProbLockedByUs(idx);
                  const lockedByOther = exists && isProbLockedByOther(idx);
                  const isActive = activeProb === idx;
                  return (
                    <div key={idx} onClick={() => exists && !isReplacing && setActiveProb(idx)}
                      style={{
                        padding: '0.45rem 0.5rem', cursor: exists && !isReplacing ? 'pointer' : 'default',
                        background: isActive && exists ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                        borderRadius: '8px',
                        border: lockedByOther ? '1.5px solid #ef4444' : (lockedByUs ? '1.5px solid #22c55e' : '1.5px solid transparent'),
                        fontSize: '0.85rem', fontWeight: isActive ? 600 : 400,
                        color: !exists || isReplacing ? 'var(--text-secondary)' : (isActive ? 'var(--accent-color)' : 'var(--text-primary)'),
                        transition: 'all 0.15s ease',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        opacity: exists && !isReplacing ? 1 : 0.5
                      }}
                    >
                      <span>
                        {!exists || isReplacing ? (
                          <span className="animate-pulse">⏳ 第{idx + 1}题 生成中...</span>
                        ) : (
                          `第${idx + 1}题（${room.config.points[idx]}分）`
                        )}
                      </span>
                      {lockedByOther && <span style={{ fontSize: '0.7rem', color: '#ef4444' }}>🔒</span>}
                      {lockedByUs && <span style={{ fontSize: '0.7rem', color: '#22c55e' }}>✓</span>}
                    </div>
                  )
                })}
              </div>

              {/* Problem Content Area */}
              <div style={{ flex: 1, paddingLeft: '1rem', display: 'flex', flexDirection: 'column' }}>
                {paper[activeProb] && !replacingProbs[activeProb] ? (
                  <>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{
                        fontSize: '0.78rem', fontWeight: 600,
                        background: 'linear-gradient(135deg, var(--accent-color), var(--accent-blue))',
                        color: 'white', padding: '0.2rem 0.6rem', borderRadius: '6px'
                      }}>
                        难度：{paper[activeProb]?.difficulty}
                      </span>
                      {paper[activeProb]?.tags?.map(t => (
                        <span key={t} style={{
                          fontSize: '0.78rem', background: 'rgba(16, 185, 129, 0.08)',
                          border: '1px solid rgba(16, 185, 129, 0.15)',
                          color: 'var(--text-secondary)', padding: '0.2rem 0.6rem', borderRadius: '6px'
                        }}>{t}</span>
                      ))}
                      {/* Replace button */}
                      {room.status === 'playing' && !isProbLockedByUs(activeProb) && !isProbLockedByOther(activeProb) && (
                        <button
                          onClick={() => handleReplaceProblem(activeProb)}
                          style={{
                            marginLeft: 'auto', fontSize: '0.75rem', padding: '0.2rem 0.5rem',
                            background: 'transparent', border: '1px solid rgba(239,68,68,0.3)',
                            color: '#ef4444', borderRadius: '6px', cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={(e) => { e.target.style.background = 'rgba(239,68,68,0.08)'; }}
                          onMouseLeave={(e) => { e.target.style.background = 'transparent'; }}
                        >
                          🔄 换题
                        </button>
                      )}
                    </div>

                    <div ref={problemRef}
                      style={{
                        flex: 1, fontSize: '1.1rem', padding: '1.5rem',
                        backgroundColor: 'rgba(16, 185, 129, 0.03)',
                        border: '1px solid rgba(16, 185, 129, 0.1)',
                        borderRadius: '10px', marginBottom: '1.25rem',
                        overflowX: 'auto', lineHeight: 1.8, color: 'var(--text-primary)'
                      }}
                    />

                    {room.status === 'playing' && (
                      <form onSubmit={submitAnswer} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        {isProbLockedByOther(activeProb) ? (
                          <div style={{
                            color: '#ef4444', textAlign: 'center', fontWeight: 600,
                            padding: '1rem', background: 'rgba(239, 68, 68, 0.06)',
                            borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.15)'
                          }}>
                            本题已被对方队伍攻破锁定，无法得分。
                          </div>
                        ) : (
                          <>
                            <div>
                              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>最终答案</label>
                              <input type="text" className="input-field" placeholder="例如：5, x=2" value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={judging} />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>解题过程（推导过程占80%分值！）</label>
                              <textarea className="input-field" placeholder="描述你的解题思路、推导过程等，过程分占总分的80%！" rows={3} value={steps} onChange={(e) => setSteps(e.target.value)} disabled={judging} />
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                              <button type="submit" className="btn" disabled={(!answer.trim() && !steps.trim()) || judging} style={{ flex: 1 }}>
                                {judging ? '批改中...' : '提交答案'}
                              </button>
                              <button type="button" className="btn btn-secondary" onClick={() => socket.emit('voteSkip', { roomId: id })}>
                                {room.skipVotes[me.team] ? '已投票跳过' : '投票跳过本卷'}
                              </button>
                            </div>
                          </>
                        )}
                      </form>
                    )}
                  </>
                ) : (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
                    <div className="loading-spinner"></div>
                    <p className="animate-pulse" style={{ color: 'var(--text-secondary)' }}>
                      {replacingProbs[activeProb] ? '正在更换题目...' : 'AI 正在生成第 ' + (activeProb + 1) + ' 题...'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* No paper and not waiting — initial generation state */}
          {room.status === 'playing' && !hasPaper && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
              <div className="loading-spinner"></div>
              <h3 className="animate-pulse" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>AI 正在出题...</h3>
            </div>
          )}
        </div>

        {/* Chat Panel */}
        <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '500px', minWidth: '260px', maxWidth: '320px' }}>
          <div style={{ display: 'flex', gap: '0', marginBottom: '0.75rem', borderBottom: '1px solid var(--glass-border)' }}>
            <button onClick={() => setChatTab('all')}
              style={{
                flex: 1, padding: '0.5rem', border: 'none', cursor: 'pointer',
                background: chatTab === 'all' ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                color: chatTab === 'all' ? 'var(--accent-color)' : 'var(--text-secondary)',
                fontWeight: chatTab === 'all' ? 600 : 400, fontSize: '0.85rem',
                borderBottom: chatTab === 'all' ? '2px solid var(--accent-color)' : '2px solid transparent',
                transition: 'all 0.2s'
              }}>💬 全体聊天</button>
            <button onClick={() => setChatTab('team')}
              style={{
                flex: 1, padding: '0.5rem', border: 'none', cursor: 'pointer',
                background: chatTab === 'team' ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                color: chatTab === 'team' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                fontWeight: chatTab === 'team' ? 600 : 400, fontSize: '0.85rem',
                borderBottom: chatTab === 'team' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                transition: 'all 0.2s'
              }}>🔒 队内聊天</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.25rem', minHeight: 0 }}>
            {filteredMessages.length === 0 && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'center', marginTop: '2rem' }}>
                {chatTab === 'all' ? '暂无消息，发一条吧！' : '队内暂无消息'}
              </p>
            )}
            {filteredMessages.map((msg, i) => (
              <div key={i} style={{
                padding: '0.35rem 0.5rem', borderRadius: '6px',
                background: msg.senderId === socket.id ? 'rgba(16, 185, 129, 0.08)' : 'rgba(0,0,0,0.03)',
                fontSize: '0.82rem'
              }}>
                <span style={{ fontWeight: 600, fontSize: '0.78rem', color: msg.team === 'A' ? teamAColor : teamBColor }}>
                  {msg.senderName}
                </span>
                <span style={{ color: 'var(--text-primary)', marginLeft: '0.4rem' }}>{msg.message}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={sendChat} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <input type="text" className="input-field"
              placeholder={chatTab === 'all' ? '发送给所有人...' : '发送给队友...'}
              value={chatInput} onChange={(e) => setChatInput(e.target.value)}
              style={{ fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}
            />
            <button type="submit" className={chatTab === 'all' ? 'btn' : 'btn btn-blue'}
              style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>发送</button>
          </form>
        </div>

      </div>
    </div>
  );
}
