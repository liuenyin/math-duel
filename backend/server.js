import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { judgeAnswerSteps } from './ai.js';
import { problemPool } from './problemPool.js';
import { registerUser, loginUser, getProfile, recordMatchResult, saveRoom, loadAllRooms, deleteRoom, saveRoomImmediate, getRecentMatches } from './db.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Math Duel API running ✅'));

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

let rooms = {};
const globalChat = []; // { senderName, message, timestamp }
const surrenderTimers = {}; // { roomId: setTimeout handle }

const getActiveRoomsList = () => {
  const list = Object.keys(rooms).map(id => {
    const r = rooms[id];
    return {
      id,
      status: r.status,
      playersA: r.players.filter(p => p.team === 'A').map(p => p.name),
      playersB: r.players.filter(p => p.team === 'B').map(p => p.name),
      dataset: r.config?.dataset || 'all',
      createdAt: r.createdAt
    };
  });

  // Sort: waiting > playing > ended, then by newest
  const statusOrder = { waiting: 0, playing: 1, ended: 2 };
  return list.sort((a, b) => {
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    return b.createdAt - a.createdAt;
  });
};

const broadcastActiveRooms = () => {
  io.emit('activeRoomsUpdate', getActiveRoomsList());
};

// Helpers
const getTeamCount = (room, team) => room.players.filter(p => p.team === team).length;
const totalPaperScore = (room) => room.config.points.reduce((a, b) => a + b, 0);
const checkWinCondition = (roomId) => {
  const room = rooms[roomId];
  const total = totalPaperScore(room);
  const winReq = total / 2;
  if (room.teamScores.A > winReq) return 'A';
  if (room.teamScores.B > winReq) return 'B';
  return null;
};

const handleSurrender = (roomId, surrenderTeam) => {
  const room = rooms[roomId];
  if (!room || room.status !== 'playing') return;
  // Cancel any pending surrender timer to avoid double-fire
  if (surrenderTimers[roomId]) {
    clearTimeout(surrenderTimers[roomId]);
    delete surrenderTimers[roomId];
  }
  const winner = surrenderTeam === 'A' ? 'B' : 'A';
  room.status = 'ended';
  io.to(roomId).emit('matchEnded', { winner, room, surrenderTeam });
  broadcastActiveRooms();
  recordMatchAndSave(roomId, winner, true);
};

// Helper: record match result to database and clean up room
async function recordMatchAndSave(roomId, winnerTeam, isSurrender) {
  const room = rooms[roomId];
  if (!room) return;
  const teamAPlayers = room.players.filter(p => p.team === 'A').map(p => ({ name: p.name, isRegistered: !!p.isRegistered }));
  const teamBPlayers = room.players.filter(p => p.team === 'B').map(p => ({ name: p.name, isRegistered: !!p.isRegistered }));
  // Only record if at least one registered player exists
  const hasRegistered = [...teamAPlayers, ...teamBPlayers].some(p => p.isRegistered);
  if (hasRegistered) {
    try {
      const ratingChanges = await recordMatchResult(
        roomId, winnerTeam, isSurrender,
        teamAPlayers, teamBPlayers,
        room.teamScores.A, room.teamScores.B,
        room.config?.dataset
      );
      // Emit rating changes to room so UI can show them
      if (ratingChanges) {
        io.to(roomId).emit('ratingChanges', ratingChanges);
      }
    } catch (e) {
      console.error('[DB] recordMatchAndSave error:', e.message);
    }
  }
  await saveRoomImmediate(roomId, room);
}

// Schedule a surrender with 60-second grace period for reconnection
function scheduleSurrender(roomId, team) {
  // Don't schedule if there's already a pending timer
  if (surrenderTimers[roomId]) return;

  const room = rooms[roomId];
  if (!room || room.status !== 'playing') return;

  const msg = {
    senderId: 'system', senderName: '系统', team: 'system',
    message: `${team}队所有成员已断线，60秒内无人重连将自动判负...`,
    chatType: 'all', timestamp: Date.now()
  };
  room.chatHistory.push(msg);
  if (room.chatHistory.length > 200) room.chatHistory.shift();
  io.to(roomId).emit('chatMessage', msg);
  io.to(roomId).emit('roomUpdate', room);

  surrenderTimers[roomId] = setTimeout(() => {
    delete surrenderTimers[roomId];
    // Re-check if the team is still empty
    const r = rooms[roomId];
    if (!r || r.status !== 'playing') return;
    const active = r.players.filter(p => p.team === team && p.connected !== false).length;
    if (active === 0) {
      handleSurrender(roomId, team);
    }
  }, 60000); // 60 seconds
}

function cancelSurrenderTimer(roomId) {
  if (surrenderTimers[roomId]) {
    clearTimeout(surrenderTimers[roomId]);
    delete surrenderTimers[roomId];
    const room = rooms[roomId];
    if (room) {
      const msg = {
        senderId: 'system', senderName: '系统', team: 'system',
        message: '玩家已重连，比赛继续！',
        chatType: 'all', timestamp: Date.now()
      };
      room.chatHistory.push(msg);
      if (room.chatHistory.length > 200) room.chatHistory.shift();
      io.to(roomId).emit('chatMessage', msg);
    }
  }
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Global Lobby
  socket.on('joinLobby', () => {
    socket.emit('activeRoomsUpdate', getActiveRoomsList());
    socket.emit('globalChatHistory', globalChat);
  });

  // ===== AUTH =====
  socket.on('register', async ({ username, password }, callback) => {
    const result = await registerUser(username, password);
    if (callback) callback(result);
  });

  socket.on('login', async ({ username, password }, callback) => {
    const result = await loginUser(username, password);
    if (callback) callback(result);
  });

  socket.on('getProfile', async ({ username }, callback) => {
    const profile = await getProfile(username);
    if (callback) callback(profile);
  });

  socket.on('getRecentMatches', async (data, callback) => {
    const matches = await getRecentMatches(15);
    if (callback) callback(matches);
  });

  socket.on('sendGlobalChat', ({ playerName, message }) => {
    if (!playerName || !message.trim()) return;
    const msg = {
      senderName: playerName,
      message: message.substring(0, 500),
      timestamp: Date.now()
    };
    globalChat.push(msg);
    if (globalChat.length > 50) globalChat.shift();
    io.emit('newGlobalChat', msg);
  });

  socket.on('joinRoom', ({ roomId, playerName, config }, callback) => {
    // Leave previous room if any to prevent cross-room ghost state
    if (socket.data && socket.data.roomId && socket.data.roomId !== roomId) {
      const oldRoomId = socket.data.roomId;
      socket.leave(oldRoomId);
      if (rooms[oldRoomId]) {
        rooms[oldRoomId].players = rooms[oldRoomId].players.filter(p => p.id !== socket.id);
        if (rooms[oldRoomId].players.length === 0) {
          delete rooms[oldRoomId];
          deleteRoom(oldRoomId);
        }
        else io.to(oldRoomId).emit('roomUpdate', rooms[oldRoomId]);
      }
    }

    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = {
        config: config || { numQuestions: 3, points: [10, 20, 30], minDifficulty: 1200, maxDifficulty: 1900 },
        players: [],
        teamScores: { A: 0, B: 0 },
        status: 'waiting',
        problems: [], // generated ones
        preGenerating: false, // flag to indicate async generation in progress
        state: { scoresTracker: { A: {}, B: {} }, locks: {} },
        skipVotes: { A: false, B: false },
        replaceVotes: {}, // { probIndex: { A: false, B: false } }
        chatHistory: [],
        createdAt: Date.now()
      };

      // PRE-GENERATE problems immediately upon room creation
      if (config) {
        preGenerateProblems(roomId);
      }
      broadcastActiveRooms();
    }

    let player = rooms[roomId].players.find(p => p.id === socket.id);
    const isRegistered = !!config?.isRegistered;
    if (!player) {
      player = rooms[roomId].players.find(p => p.name === playerName && p.connected === false);
      if (player && rooms[roomId].status !== 'ended') {
        // Safety: only allow reconnect if registration status matches
        if (player.isRegistered && !isRegistered) {
          // Unregistered user trying to take a registered user's spot — deny
          if (callback) callback({ error: '该名称已被注册用户占用' });
          return;
        }
        player.id = socket.id; // Reclaim spot
        player.connected = true;
        // Cancel pending surrender timer if this team is now active again
        cancelSurrenderTimer(roomId);
      } else if (rooms[roomId].status === 'waiting') {
        const teamA = getTeamCount(rooms[roomId], 'A');
        const teamB = getTeamCount(rooms[roomId], 'B');
        const assignTeam = teamA <= teamB ? 'A' : 'B';
        player = { id: socket.id, name: playerName, team: assignTeam, score: 0, ready: false, connected: true, isRegistered };
        rooms[roomId].players.push(player);
      }
    } else {
      player.name = playerName;
      player.connected = true;
      cancelSurrenderTimer(roomId);
    }

    // Store roomId on socket for chat
    socket.data = socket.data || {};
    socket.data.roomId = roomId;

    io.to(roomId).emit('roomUpdate', rooms[roomId]);
    if (rooms[roomId].status === 'playing' && rooms[roomId].problems.length > 0) {
      // Mask problems to avoid leaking answers/solutions to clients
      const maskedPaper = rooms[roomId].problems.map(p => ({
        problem: p.problem, tags: p.tags, difficulty: p.difficulty, source: p.source
      }));
      socket.emit('paperGenerated', { paper: maskedPaper, total: rooms[roomId].config.numQuestions });
    }

    if (callback) callback({ success: true, room: rooms[roomId] });
  });

  socket.on('switchTeam', ({ roomId, team }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'waiting') return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.team = team;
      io.to(roomId).emit('roomUpdate', room);
    }
  });

  socket.on('setReady', ({ roomId, ready }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.ready = ready;
      io.to(roomId).emit('roomUpdate', room);

      const allReady = room.players.length >= 2 && room.players.every(p => p.ready);
      const hasTeamA = getTeamCount(room, 'A') > 0;
      const hasTeamB = getTeamCount(room, 'B') > 0;

      if (allReady && hasTeamA && hasTeamB && room.status === 'waiting') {
        startGame(roomId);
        broadcastActiveRooms();
      }
    }
  });

  socket.on('leaveRoom', ({ roomId }) => {
    socket.leave(roomId);
    if (socket.data.roomId === roomId) delete socket.data.roomId;
    if (rooms[roomId]) {
      if (rooms[roomId].status === 'waiting') {
        rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
        if (rooms[roomId].players.length === 0) {
          delete rooms[roomId];
          deleteRoom(roomId);
        } else {
          rooms[roomId].players.forEach(p => p.ready = false);
          io.to(roomId).emit('roomUpdate', rooms[roomId]);
        }
      } else if (rooms[roomId].status === 'playing') {
        const player = rooms[roomId].players.find(p => p.id === socket.id);
        if (player) player.connected = false;

        const teamAActive = rooms[roomId].players.filter(p => p.team === 'A' && p.connected !== false).length;
        const teamBActive = rooms[roomId].players.filter(p => p.team === 'B' && p.connected !== false).length;
        if (teamAActive === 0) scheduleSurrender(roomId, 'A');
        else if (teamBActive === 0) scheduleSurrender(roomId, 'B');
        else io.to(roomId).emit('roomUpdate', rooms[roomId]);
      } else {
        // ended status: remove player and clean up if empty
        rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
        if (rooms[roomId].players.length === 0) {
          delete rooms[roomId];
          deleteRoom(roomId);
        } else {
          io.to(roomId).emit('roomUpdate', rooms[roomId]);
        }
      }
      broadcastActiveRooms();
    }
  });

  socket.on('surrender', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return; // Spectators cannot surrender

    room.chatHistory.push({
      senderId: 'system',
      senderName: '系统',
      team: 'system',
      message: `${player.name} (${player.team}队) 发起了投降！`,
      chatType: 'all',
      timestamp: Date.now()
    });

    handleSurrender(roomId, player.team);
  });

  // ===== Chat =====
  socket.on('sendChat', ({ roomId, message, chatType, playerName }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);

    // If not a player and trying to send team chat, block it.
    if (!player && chatType === 'team') return;

    const pName = player ? player.name : (playerName || '旁观者');
    const pTeam = player ? player.team : 'spectator';

    const msg = {
      senderId: socket.id,
      senderName: pName,
      team: pTeam,
      message: message.substring(0, 500),
      chatType,
      timestamp: Date.now()
    };

    room.chatHistory.push(msg);
    if (room.chatHistory.length > 200) room.chatHistory.shift();

    if (chatType === 'all') {
      io.to(roomId).emit('chatMessage', msg);
    } else {
      const teamPlayers = room.players.filter(p => p.team === player.team);
      for (const tp of teamPlayers) {
        io.to(tp.id).emit('chatMessage', msg);
      }
    }
  });

  // ===== Replace single problem =====
  socket.on('replaceProblem', async ({ roomId, probIndex }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const team = player.team;

    // Only allow if problem is not locked
    if (room.state.locks[probIndex]) {
      socket.emit('globalError', { message: '该题已被锁定，无法更换。' });
      return;
    }

    // Initialize replace vote state for this problem if not exists
    if (!room.replaceVotes[probIndex]) {
      room.replaceVotes[probIndex] = { A: false, B: false };
    }

    room.replaceVotes[probIndex][team] = true;
    io.to(roomId).emit('roomUpdate', room);

    const otherTeam = team === 'A' ? 'B' : 'A';

    // Check if both teams agreed
    if (room.replaceVotes[probIndex].A && room.replaceVotes[probIndex].B) {
      // Both agreed, reset vote and proceed
      room.replaceVotes[probIndex] = { A: false, B: false };
      io.to(roomId).emit('problemReplacing', { probIndex });

      const msg = {
        senderId: 'system', senderName: '系统', team: 'system',
        message: `双队同意，正在重新生成第 ${probIndex + 1} 题...`, chatType: 'all', timestamp: Date.now()
      };
      room.chatHistory.push(msg);
      io.to(roomId).emit('chatMessage', msg);

      try {
        const existingProblems = room.problems.filter((_, i) => i !== probIndex);
        const existingIds = new Set(existingProblems.map(p => p.id));
        const newProbs = problemPool.getRandomProblems(1, room.config, existingIds);
        const newProb = newProbs[0];

        // Critical: Update backend problem state
        room.problems[probIndex] = newProb;

        // Reset scores for this problem
        room.state.scoresTracker.A[probIndex] = 0;
        room.state.scoresTracker.B[probIndex] = 0;
        delete room.state.locks[probIndex];
        // Recalculate team scores
        room.teamScores.A = Object.values(room.state.scoresTracker.A).reduce((a, b) => a + b, 0);
        room.teamScores.B = Object.values(room.state.scoresTracker.B).reduce((a, b) => a + b, 0);

        const masked = { problem: newProb.problem, tags: newProb.tags, difficulty: newProb.difficulty };
        io.to(roomId).emit('problemReplaced', { probIndex, problem: masked });
        io.to(roomId).emit('roomUpdate', room);
      } catch (e) {
        console.error('[replaceProblem] error:', e.message);
        io.to(roomId).emit('globalError', { message: '更换题目失败，请重试。' });
      }
    } else {
      // Notify the other team
      const msg = {
        senderId: 'system', senderName: '系统', team: 'system',
        message: `${team}队请求更换第 ${probIndex + 1} 题，请${otherTeam}队确认。`, chatType: 'all', timestamp: Date.now()
      };
      room.chatHistory.push(msg);
      if (room.chatHistory.length > 200) room.chatHistory.shift();
      io.to(roomId).emit('chatMessage', msg);
    }
  });

  // ===== Vote Skip Paper =====
  socket.on('voteSkip', async ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const team = player.team;

    room.skipVotes[team] = true;
    io.to(roomId).emit('roomUpdate', room);

    const otherTeam = team === 'A' ? 'B' : 'A';

    if (room.skipVotes.A && room.skipVotes.B) {
      room.skipVotes = { A: false, B: false };
      const msg = {
        senderId: 'system', senderName: '系统', team: 'system',
        message: `双队同意，正在跳过并更换整套试卷...`, chatType: 'all', timestamp: Date.now()
      };
      room.chatHistory.push(msg);
      io.to(roomId).emit('chatMessage', msg);

      // Reset match values
      room.replaceVotes = {};
      room.state.scoresTracker = { A: {}, B: {} };
      room.state.locks = {};
      room.teamScores = { A: 0, B: 0 };
      room.players.forEach(p => p.score = 0);
      io.to(roomId).emit('roomUpdate', room);
      io.to(roomId).emit('paperGenerated', { paper: [], total: room.config.numQuestions || 3 });

      // Regenerate the paper
      await preGenerateProblems(roomId);
    } else {
      const msg = {
        senderId: 'system', senderName: '系统', team: 'system',
        message: `${team}队投票跳过本套试卷，请${otherTeam}队确认。`, chatType: 'all', timestamp: Date.now()
      };
      room.chatHistory.push(msg);
      if (room.chatHistory.length > 200) room.chatHistory.shift();
      io.to(roomId).emit('chatMessage', msg);
    }
  });

  socket.on('submitAnswerSteps', async ({ roomId, probIndex, answer, steps }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const team = player.team;
    const probData = room.problems[probIndex];
    if (!probData) return;
    const maxPts = room.config.points[probIndex];

    if (room.state.locks[probIndex] && room.state.locks[probIndex] !== team) {
      socket.emit('answerResult', { message: '本题已被对方队伍攻破锁定！' });
      return;
    }

    socket.emit('judgingPending', { probIndex });
    const aiResult = await judgeAnswerSteps(probData.answer, probData.solution, answer, steps);
    const scoreVal = (aiResult.scorePercent / 100) * maxPts;

    const currentTeamScoreOnProb = room.state.scoresTracker[team][probIndex] || 0;
    if (scoreVal > currentTeamScoreOnProb) {
      const diff = scoreVal - currentTeamScoreOnProb;
      room.state.scoresTracker[team][probIndex] = scoreVal;
      room.teamScores[team] += diff;
      player.score += diff;

      socket.emit('answerResult', {
        message: `得分 ${aiResult.scorePercent}%！（${scoreVal.toFixed(1)} 分）：${aiResult.feedback}`
      });

      // Broadcast to chat so everyone can see
      const chatMsg = {
        senderId: 'system', senderName: '系统', team: 'system',
        message: `${team}队 ${player.name} 第${probIndex + 1}题获得 ${aiResult.scorePercent}%（${scoreVal.toFixed(1)}分）：${aiResult.feedback}`,
        chatType: 'all', timestamp: Date.now()
      };
      room.chatHistory.push(chatMsg);
      if (room.chatHistory.length > 200) room.chatHistory.shift();
      io.to(roomId).emit('chatMessage', chatMsg);

      if (aiResult.scorePercent >= 95) {
        room.state.locks[probIndex] = team;
        const otherTeam = team === 'A' ? 'B' : 'A';
        const otherScore = room.state.scoresTracker[otherTeam][probIndex] || 0;
        room.teamScores[otherTeam] -= otherScore;
        room.state.scoresTracker[otherTeam][probIndex] = 0;
        io.to(roomId).emit('problemLocked', { probIndex, team });
      }

      io.to(roomId).emit('roomUpdate', room);

      const winner = checkWinCondition(roomId);
      if (winner) {
        room.status = 'ended';
        io.to(roomId).emit('matchEnded', { winner, room });
        recordMatchAndSave(roomId, winner, false);
      } else {
        saveRoom(roomId, room);
      }
    } else {
      socket.emit('answerResult', {
        message: `得分 ${aiResult.scorePercent}%，未超过队伍在本题的最高分。反馈：${aiResult.feedback}`
      });

      // Still broadcast to chat even if didn't beat best
      const chatMsg = {
        senderId: 'system', senderName: '系统', team: 'system',
        message: `${team}队 ${player.name} 第${probIndex + 1}题获得 ${aiResult.scorePercent}%（未刷新最高分）：${aiResult.feedback}`,
        chatType: 'all', timestamp: Date.now()
      };
      room.chatHistory.push(chatMsg);
      if (room.chatHistory.length > 200) room.chatHistory.shift();
      io.to(roomId).emit('chatMessage', chatMsg);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        if (room.status === 'waiting') {
          room.players.splice(playerIndex, 1);
          if (room.players.length === 0) {
            delete rooms[roomId];
            deleteRoom(roomId);
          } else {
            room.players.forEach(p => p.ready = false);
            io.to(roomId).emit('roomUpdate', room);
          }
        } else if (room.status === 'playing') {
          room.players[playerIndex].connected = false;
          const teamAActive = room.players.filter(p => p.team === 'A' && p.connected !== false).length;
          const teamBActive = room.players.filter(p => p.team === 'B' && p.connected !== false).length;
          if (teamAActive === 0) scheduleSurrender(roomId, 'A');
          else if (teamBActive === 0) scheduleSurrender(roomId, 'B');
          else io.to(roomId).emit('roomUpdate', room);
        } else {
          // ended: remove player and clean up
          room.players.splice(playerIndex, 1);
          if (room.players.length === 0) {
            delete rooms[roomId];
            deleteRoom(roomId);
          } else {
            io.to(roomId).emit('roomUpdate', room);
          }
        }
        broadcastActiveRooms();
      }
    }
  });
});

// Pre-generate problems concurrently (all fire at once, each emits as it resolves)
async function preGenerateProblems(roomId) {
  const room = rooms[roomId];
  if (!room || room.preGenerating) return;
  room.preGenerating = true;

  const numQ = room.config.numQuestions || 3;

  console.log(`[Game] Room ${roomId}: Fetching ${numQ} problems from pool...`);
  try {
    const problems = problemPool.getRandomProblems(numQ, room.config);
    room.problems = problems;

    // If we're already playing, emit them immediately
    if (room.status === 'playing') {
      room.problems.forEach((prob, i) => {
        const masked = { problem: prob.problem, tags: prob.tags, difficulty: prob.difficulty };
        io.to(roomId).emit('problemAdded', { index: i, problem: masked, total: numQ });
      });
    }
  } catch (error) {
    console.error(`[Game] Room ${roomId}: Failed to fetch problems:`, error.message);
    room.problems = new Array(numQ).fill(null).map((_, i) => ({
      problem: `求 $x$，已知 $3^x = ${Math.pow(3, i + 2)}$。`,
      answer: `${i + 2}`, solution: `$3^x = 3^{${i + 2}}$，$x=${i + 2}$。`,
      tags: ['对数与指数'], difficulty: 1000
    }));
  }

  room.preGenerating = false;
  console.log(`[Game] Room ${roomId}: All ${numQ} problems ready.`);
}

async function startGame(roomId) {
  const room = rooms[roomId];
  const numQ = room.config.numQuestions || 3;
  room.status = 'playing';
  room.skipVotes = { A: false, B: false };
  room.replaceVotes = {};
  room.state.scoresTracker = { A: {}, B: {} };
  room.state.locks = {};
  room.teamScores = { A: 0, B: 0 };
  room.players.forEach(p => p.score = 0);
  io.to(roomId).emit('paperGenerated', { paper: [], total: numQ });
  io.to(roomId).emit('roomUpdate', room);

  // If already generated, just emit them all now
  if (!room.preGenerating && room.problems.length === numQ) {
    room.problems.forEach((prob, i) => {
      const masked = { problem: prob.problem, tags: prob.tags, difficulty: prob.difficulty };
      io.to(roomId).emit('problemAdded', { index: i, problem: masked, total: numQ });
    });
  }
  // If preGenerating is still true, the preGenerateProblems function will emit them as they finish or when it ends
}

const PORT = process.env.PORT || 3001;

// Load rooms from Supabase on startup
async function boot() {
  try {
    const loaded = await loadAllRooms();
    rooms = { ...rooms, ...loaded };
    console.log(`[Boot] Restored ${Object.keys(loaded).length} rooms from database.`);
  } catch (e) {
    console.error('[Boot] Failed to load rooms:', e.message);
  }
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

boot();
