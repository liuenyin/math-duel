import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const TAG_CATEGORIES = {
  '代数': [
    '一元二次方程', '不等式', '柯西不等式', '均值不等式（AM-GM）',
    '韦达定理', '多项式', '二项式定理', '数列与递推',
    '函数与图像', '对数与指数'
  ],
  '几何': [
    '三角形全等与相似', '圆的性质', '坐标几何', '向量',
    '三角函数', '正弦余弦定理', '解析几何（椭圆/双曲线/抛物线）',
    '立体几何', '面积与体积', '几何变换'
  ],
  '数论': [
    '整除性与模运算', '质数与分解', '同余方程',
    '费马小定理', '欧拉函数', '丢番图方程'
  ],
  '组合': [
    '排列组合', '容斥原理', '鸽巢原理',
    '递推计数', '生成函数', '图论基础'
  ],
  '概率与统计': [
    '古典概率', '条件概率与贝叶斯',
    '期望与方差', '随机变量'
  ],
  '微积分': [
    '极限', '导数与微分', '积分', '微分方程'
  ]
};

const DIFFICULTY_MARKERS = [
  { value: 800, label: '入门' },
  { value: 1000, label: '中考' },
  { value: 1400, label: '高考基础' },
  { value: 1800, label: '高考压轴' },
  { value: 2200, label: '高联一试' },
  { value: 2800, label: '高联二试' },
  { value: 3500, label: 'IMO' },
];

const AI_PRESETS = [
  { name: 'DeepSeek', description: '出题 Chat / 判卷 Reasoner' },
];

export default function Lobby({ playerName, setPlayerName }) {
  const [roomId, setRoomId] = useState('');
  const navigate = useNavigate();

  const [showSettings, setShowSettings] = useState(false);
  const [numQuestions, setNumQuestions] = useState(3);
  const [minDiff, setMinDiff] = useState(1200);
  const [maxDiff, setMaxDiff] = useState(1900);
  const [pointsStr, setPointsStr] = useState("10,20,30");
  const [includeTags, setIncludeTags] = useState([]);
  const [excludeTags, setExcludeTags] = useState([]);



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
    if (!playerName.trim()) {
      alert("请先输入你的昵称！");
      return;
    }
    const pts = pointsStr.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    if (pts.length !== numQuestions) {
      alert(`请提供恰好 ${numQuestions} 个逗号分隔的分值。`);
      return;
    }

    const config = {
      numQuestions,
      minDifficulty: minDiff,
      maxDifficulty: maxDiff,
      points: pts,
      includeTags,
      excludeTags,
    };


    const newRoomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    navigate(`/room/${newRoomId}`, { state: { config } });
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (!playerName.trim()) { alert("请先输入你的昵称！"); return; }
    if (!roomId.trim()) { alert("请输入房间代码！"); return; }
    navigate(`/room/${roomId.toUpperCase()}`);
  };

  const getTagChipClass = (tag) => {
    if (includeTags.includes(tag)) return 'tag-chip tag-chip-include';
    if (excludeTags.includes(tag)) return 'tag-chip tag-chip-exclude';
    return 'tag-chip tag-chip-default';
  };

  // Dual range slider handlers
  const handleMinDiff = (val) => {
    val = Math.min(val, maxDiff - 100);
    setMinDiff(val);
  };
  const handleMaxDiff = (val) => {
    val = Math.max(val, minDiff + 100);
    setMaxDiff(val);
  };

  const pct = (v) => ((v - 800) / (3500 - 800)) * 100;

  return (
    <div className="page-container animate-fade-in">
      <div className="glass-panel" style={{ width: '100%', maxWidth: '580px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>你的昵称</label>
          <input type="text" className="input-field" placeholder="输入你的昵称"
            value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={15} />
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)' }} />

        {/* 加入房间 */}
        <div>
          <p style={{ marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>加入已有房间</p>
          <form onSubmit={handleJoinRoom} style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="text" className="input-field" placeholder="房间代码"
              value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} maxLength={6} />
            <button type="submit" className="btn btn-blue" style={{ whiteSpace: 'nowrap' }}>加入</button>
          </form>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)' }} />

        {/* 创建房间 */}
        <div>
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
              {/* Questions count */}
              <div>
                <label style={{ fontSize: '0.9rem', fontWeight: 500 }}>题目数量：{numQuestions}</label>
                <input type="range" min="1" max="10" value={numQuestions}
                  onChange={(e) => setNumQuestions(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-color)' }} />
              </div>

              {/* Difficulty Dual Range Slider */}
              <div>
                <label style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                  难度范围：<span style={{ color: 'var(--accent-color)', fontWeight: 700 }}>{minDiff}</span> — <span style={{ color: 'var(--accent-blue)', fontWeight: 700 }}>{maxDiff}</span>
                </label>
                <div className="dual-range-container">
                  <div className="dual-range-track">
                    <div className="dual-range-fill" style={{ left: `${pct(minDiff)}%`, width: `${pct(maxDiff) - pct(minDiff)}%` }} />
                  </div>
                  <input type="range" min="800" max="3500" step="50" value={minDiff}
                    onChange={(e) => handleMinDiff(parseInt(e.target.value))}
                    className="dual-range-input" />
                  <input type="range" min="800" max="3500" step="50" value={maxDiff}
                    onChange={(e) => handleMaxDiff(parseInt(e.target.value))}
                    className="dual-range-input" />
                  {/* Reference markers */}
                  <div className="dual-range-markers">
                    {DIFFICULTY_MARKERS.map(m => (
                      <div key={m.value} className="dual-range-marker" style={{ left: `${pct(m.value)}%` }}>
                        <div className="dual-range-marker-tick" />
                        <div className="dual-range-marker-label">{m.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Points */}
              <div>
                <label style={{ fontSize: '0.9rem', fontWeight: 500 }}>每题分值（逗号分隔）</label>
                <input type="text" className="input-field" value={pointsStr} onChange={(e) => setPointsStr(e.target.value)} />
              </div>

              {/* AI Model Info */}
              <div style={{ borderTop: '1px solid rgba(16,185,129,0.1)', paddingTop: '1rem' }}>
                <label style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--accent-color)', marginBottom: '0.5rem', display: 'block' }}>🤖 AI 模型</label>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '0.6rem 0.8rem', background: 'rgba(16,185,129,0.05)', borderRadius: '0.4rem', border: '1px solid rgba(16,185,129,0.1)' }}>
                  <div>出题：<strong>DeepSeek Chat</strong>（快速稳定）</div>
                  <div>判卷：<strong>DeepSeek Reasoner</strong>（推理精准）</div>
                </div>
              </div>

              {/* Include Tags */}
              <div>
                <label style={{ fontSize: '0.9rem', fontWeight: 500, color: '#059669' }}>✅ 包含标签（点击选中）</label>
                {Object.entries(TAG_CATEGORIES).map(([category, tags]) => (
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
                {Object.entries(TAG_CATEGORIES).map(([category, tags]) => (
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

          <button className="btn" style={{ width: '100%' }} onClick={handleCreateRoom}>
            创建房间
          </button>
        </div>

      </div>
    </div>
  );
}
