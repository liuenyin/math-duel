import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const MATH_TAG_CATEGORIES = {
  'MATH (英文)': ['代数', '计数与概率', '几何', '中级代数', '数论', '预备代数', '预备微积分']
};

const OB_TAG_CATEGORIES = {
  'OlympiadBench (中文)': [
    '代数', '几何', '组合', '数论', '数列', '三角函数',
    '初等函数', '概率统计', '不等式', '平面几何', '立体几何',
    '极坐标与参数方程', '向量', '导数', '复数', '逻辑', '集合', '解析几何'
  ]
};

const MATH_DIFFICULTIES = ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5'];
const OB_DIFFICULTIES = ['高考', '竞赛'];

export default function Lobby({ socket, playerName, setPlayerName }) {
  const [roomId, setRoomId] = useState('');
  const navigate = useNavigate();

  const [showSettings, setShowSettings] = useState(false);
  const [numQuestions, setNumQuestions] = useState(3);
  const [pointsStr, setPointsStr] = useState("10,20,30");

  const [dataset, setDataset] = useState('all');
  const [selectedMathDiffs, setSelectedMathDiffs] = useState([...MATH_DIFFICULTIES]);
  const [selectedObDiffs, setSelectedObDiffs] = useState([...OB_DIFFICULTIES]);

  const [includeTags, setIncludeTags] = useState([]);
  const [excludeTags, setExcludeTags] = useState([]);

  // Active rooms & Global Chat
  const [activeRooms, setActiveRooms] = useState([]);
  const [globalChat, setGlobalChat] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef(null);

  useEffect(() => {
    socket.emit('joinLobby');

    const handleRoomsUpdate = (rooms) => setActiveRooms(rooms);
    const handleChatHistory = (history) => setGlobalChat(history);
    const handleNewChat = (msg) => setGlobalChat(prev => [...prev, msg]);

    socket.on('activeRoomsUpdate', handleRoomsUpdate);
    socket.on('globalChatHistory', handleChatHistory);
    socket.on('newGlobalChat', handleNewChat);

    return () => {
      socket.off('activeRoomsUpdate', handleRoomsUpdate);
      socket.off('globalChatHistory', handleChatHistory);
      socket.off('newGlobalChat', handleNewChat);
    };
  }, [socket]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [globalChat]);

  const toggleArrayItem = (item, list, setList) => {
    if (list.includes(item)) setList(list.filter(t => t !== item));
    else setList([...list, item]);
  };

  const toggleTag = (tag, list, setList, otherList, setOtherList) => {
    if (list.includes(tag)) {
      setList(list.filter(t => t !== tag));
    } else {
      setList([...list, tag]);
      if (otherList.includes(tag)) {
        setOtherList(otherList.filter(t => t !== tag));
      }
    }
  };

  const handleCreateRoom = () => {
    if (!playerName.trim()) { alert("请先输入你的昵称！"); return; }
    const pts = pointsStr.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    if (pts.length !== numQuestions) {
      alert(`请提供恰好 ${numQuestions} 个逗号分隔的分值。`);
      return;
    }

    let diffs = [];
    if (dataset === 'math') diffs = selectedMathDiffs;
    else if (dataset === 'olympiad') diffs = selectedObDiffs;
    else diffs = [...selectedMathDiffs, ...selectedObDiffs];

    if (diffs.length === 0) {
      alert("请至少选择一个难度级别！");
      return;
    }

    const config = {
      numQuestions,
      dataset,
      difficulties: diffs,
      points: pts,
      includeTags,
      excludeTags,
    };

    const newRoomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    navigate(`/room/${newRoomId}`, { state: { config } });
  };

  const handleJoinRoom = (e, id) => {
    if (e) e.preventDefault();
    const targetRoomId = id || roomId;
    if (!playerName.trim()) { alert("请先输入你的昵称！"); return; }
    if (!targetRoomId.trim()) { alert("请输入房间代码！"); return; }
    navigate(`/room/${targetRoomId.toUpperCase()}`);
  };

  const sendGlobalChat = (e) => {
    e.preventDefault();
    if (!playerName.trim()) { alert("请先输入你的昵称！"); return; }
    if (!chatInput.trim()) return;
    socket.emit('sendGlobalChat', { playerName: playerName.trim(), message: chatInput.trim() });
    setChatInput('');
  };

  const getTagChipClass = (tag) => {
    if (includeTags.includes(tag)) return 'tag-chip tag-chip-include';
    if (excludeTags.includes(tag)) return 'tag-chip tag-chip-exclude';
    return 'tag-chip tag-chip-default';
  };

  const activeCategories = dataset === 'math' ? MATH_TAG_CATEGORIES
    : dataset === 'olympiad' ? OB_TAG_CATEGORIES
      : { ...MATH_TAG_CATEGORIES, ...OB_TAG_CATEGORIES };

  return (
    <div className="page-container animate-fade-in" style={{ maxWidth: '1200px', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>

      {/* ===== LEFT PANEL: ROOM CREATION ===== */}
      <div className="glass-panel" style={{ flex: '1 1 500px', display: 'flex', flexDirection: 'column', gap: '1.5rem', alignSelf: 'flex-start' }}>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>你的昵称</label>
          <input type="text" className="input-field" placeholder="输入你的昵称"
            value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={15} />
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)' }} />

        {/* 加入已有房间 */}
        <div>
          <p style={{ marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>加入已有房间</p>
          <form onSubmit={(e) => handleJoinRoom(e, null)} style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="text" className="input-field" placeholder="房间代码"
              value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} maxLength={6} />
            <button type="submit" className="btn btn-blue" style={{ whiteSpace: 'nowrap' }}>加入</button>
          </form>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)' }} />

        {/* 创建房间 */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>创建新房间</p>
            <button className="btn btn-secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
              onClick={() => setShowSettings(!showSettings)}>
              {showSettings ? '收起设置' : '高级设置'}
            </button>
          </div>

          {showSettings && (
            <div style={{
              padding: '1.25rem', backgroundColor: 'rgba(16, 185, 129, 0.04)',
              border: '1px solid rgba(16, 185, 129, 0.1)', borderRadius: '12px',
              marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem'
            }}>
              {/* Dataset Selection */}
              <div>
                <label style={{ fontSize: '0.9rem', fontWeight: 500, display: 'block', marginBottom: '0.5rem' }}>题库来源</label>
                <select className="input-field" value={dataset} onChange={(e) => setDataset(e.target.value)}>
                  <option value="all">全量混合题库 (14000+题)</option>
                  <option value="math">MATH (英文：12500题，含AMC/AIME级别)</option>
                  <option value="olympiad">OlympiadBench (中文：2300+题，高考/竞赛真题)</option>
                </select>
              </div>

              {/* Questions count */}
              <div>
                <label style={{ fontSize: '0.9rem', fontWeight: 500 }}>题目数量：{numQuestions}</label>
                <input type="range" min="1" max="10" value={numQuestions}
                  onChange={(e) => setNumQuestions(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-color)' }} />
              </div>

              {/* Points */}
              <div>
                <label style={{ fontSize: '0.9rem', fontWeight: 500 }}>每题分值（逗号分隔）</label>
                <input type="text" className="input-field" value={pointsStr} onChange={(e) => setPointsStr(e.target.value)} />
              </div>

              {/* Difficulties */}
              <div style={{ borderTop: '1px solid rgba(16,185,129,0.1)', paddingTop: '1rem' }}>
                <label style={{ fontSize: '0.9rem', fontWeight: 500, display: 'block', marginBottom: '0.5rem' }}>难度偏好</label>

                {(dataset === 'math' || dataset === 'all') && (
                  <div style={{ marginBottom: '0.8rem' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>MATH 难度 (Level 1-5)：</div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {MATH_DIFFICULTIES.map(d => (
                        <span key={d} className={`tag-chip ${selectedMathDiffs.includes(d) ? 'tag-chip-include' : 'tag-chip-default'}`}
                          onClick={() => toggleArrayItem(d, selectedMathDiffs, setSelectedMathDiffs)}>
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {(dataset === 'olympiad' || dataset === 'all') && (
                  <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>OlympiadBench 难度：</div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {OB_DIFFICULTIES.map(d => (
                        <span key={d} className={`tag-chip ${selectedObDiffs.includes(d) ? 'tag-chip-include' : 'tag-chip-default'}`}
                          onClick={() => toggleArrayItem(d, selectedObDiffs, setSelectedObDiffs)}>
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Include Tags */}
              <div style={{ borderTop: '1px solid rgba(16,185,129,0.1)', paddingTop: '1rem' }}>
                <label style={{ fontSize: '0.9rem', fontWeight: 500, color: '#059669' }}>✅ 包含标签（点击选中）</label>
                {Object.entries(activeCategories).map(([category, tags]) => (
                  <div key={category} className="tag-category">
                    <div className="tag-category-label">{category}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {tags.map(tag => (
                        <span key={tag} className={getTagChipClass(tag)}
                          onClick={() => toggleTag(tag, includeTags, setIncludeTags, excludeTags, setExcludeTags)}
                          style={includeTags.includes(tag) ? {} : { opacity: 0.7 }}>{tag}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Exclude Tags */}
              <div>
                <label style={{ fontSize: '0.9rem', fontWeight: 500, color: '#dc2626' }}>🚫 排除标签（点击排除）</label>
                {Object.entries(activeCategories).map(([category, tags]) => (
                  <div key={category} className="tag-category">
                    <div className="tag-category-label">{category}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {tags.map(tag => (
                        <span key={tag}
                          className={excludeTags.includes(tag) ? 'tag-chip tag-chip-exclude' : 'tag-chip tag-chip-default'}
                          onClick={() => toggleTag(tag, excludeTags, setExcludeTags, includeTags, setIncludeTags)}
                          style={excludeTags.includes(tag) ? {} : { opacity: 0.7 }}>{tag}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button className="btn" style={{ width: '100%', marginTop: 'auto' }} onClick={handleCreateRoom}>
            创建房间
          </button>
        </div>
      </div>

      {/* ===== RIGHT PANEL: ACTIVE ROOMS & CHAT ===== */}
      <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '1.5rem', alignSelf: 'stretch' }}>

        {/* Active Rooms */}
        <div className="glass-panel" style={{ flex: '0 0 auto', maxHeight: '40vh', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>
            在场对局 ({activeRooms.length})
          </h3>
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.8rem', paddingRight: '0.5rem' }}>
            {activeRooms.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem 0' }}>暂无正在进行的房间</p>
            ) : (
              activeRooms.map(r => (
                <div key={r.id} style={{
                  background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.1)',
                  padding: '0.8rem 1rem', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>房间 {r.id}</span>
                      <span style={{
                        fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px',
                        background: r.status === 'playing' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                        color: r.status === 'playing' ? '#ef4444' : '#10b981'
                      }}>
                        {r.status === 'playing' ? '对决中' : (r.status === 'ended' ? '已结束' : '等待中')}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      题库：{r.dataset === 'math' ? 'MATH' : r.dataset === 'olympiad' ? 'OlympiadBench' : '混合'}
                    </div>
                    {/* Add players VS info */}
                    <div style={{ fontSize: '0.85rem', marginTop: '0.4rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ color: '#10b981', fontWeight: 500 }}>{r.playersA?.join(', ') || '等待加入'}</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontStyle: 'italic' }}>VS</span>
                      <span style={{ color: '#3b82f6', fontWeight: 500 }}>{r.playersB?.join(', ') || '等待加入'}</span>
                    </div>
                  </div>
                  <button className={`btn ${r.status === 'waiting' ? '' : 'btn-secondary'}`}
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                    onClick={() => handleJoinRoom(null, r.id)}>
                    {r.status === 'waiting' ? '加入' : '旁观'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Global Chat */}
        <div className="glass-panel" style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: '350px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>
            🌍 公共水区
          </h3>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingRight: '0.5rem' }}>
            {globalChat.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', paddingTop: '2rem' }}>随便聊点什么...</p>
            ) : (
              globalChat.map((msg, i) => (
                <div key={i} style={{ fontSize: '0.88rem', background: 'rgba(0,0,0,0.02)', padding: '0.4rem 0.6rem', borderRadius: '6px' }}>
                  <span style={{ fontWeight: 600, color: 'var(--accent-color)' }}>{msg.senderName}</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', marginLeft: '0.4rem' }}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div style={{ marginTop: '0.2rem', color: 'var(--text-primary)', wordBreak: 'break-word' }}>{msg.message}</div>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
          <form onSubmit={sendGlobalChat} style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <input type="text" className="input-field" placeholder="输入聊天内容..."
              value={chatInput} onChange={(e) => setChatInput(e.target.value)} style={{ fontSize: '0.9rem' }} />
            <button type="submit" className="btn btn-blue" style={{ padding: '0 1.25rem' }}>发送</button>
          </form>
        </div>
      </div>

      <div style={{ width: '100%', textAlign: 'center', marginTop: '2rem', padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>基于大模型的数学对战引擎 &copy; 2026</a>
        &nbsp;|&nbsp;
        <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>内部测试群：1080382240</span>
      </div>

    </div>
  );
}
