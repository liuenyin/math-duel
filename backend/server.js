import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { generateSingleProblem, judgeAnswerSteps } from './ai.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const rooms = {};

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

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinRoom', ({ roomId, playerName, config }, callback) => {
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = {
        config: config || { numQuestions: 3, points: [10, 20, 30], minDifficulty: 1200, maxDifficulty: 1900 },
        players: [],
        teamScores: { A: 0, B: 0 },
        status: 'waiting',
        problems: [],
        state: { scoresTracker: { A: {}, B: {} }, locks: {} },
        skipVotes: { A: false, B: false },
        chatHistory: []
      };
    }

    let player = rooms[roomId].players.find(p => p.id === socket.id);
    if (!player) {
      const teamA = getTeamCount(rooms[roomId], 'A');
      const teamB = getTeamCount(rooms[roomId], 'B');
      const assignTeam = teamA <= teamB ? 'A' : 'B';
      player = { id: socket.id, name: playerName, team: assignTeam, score: 0, ready: false };
      rooms[roomId].players.push(player);
    } else {
      player.name = playerName;
    }

    // Store roomId on socket for chat
    socket.data = socket.data || {};
    socket.data.roomId = roomId;

    io.to(roomId).emit('roomUpdate', rooms[roomId]);
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
      }
    }
  });

  socket.on('voteSkip', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    room.skipVotes[player.team] = true;
    io.to(roomId).emit('roomUpdate', room);

    if (room.skipVotes.A && room.skipVotes.B) {
      // Both teams vote skip — regenerate entire paper
      room.skipVotes = { A: false, B: false };
      io.to(roomId).emit('roomUpdate', room);
      startGame(roomId);
    }
  });

  // ===== Chat =====
  socket.on('sendChat', ({ roomId, message, chatType }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const msg = {
      senderId: socket.id,
      senderName: player.name,
      team: player.team,
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
    // Only allow if problem is not locked
    if (room.state.locks[probIndex]) {
      socket.emit('globalError', { message: '该题已被锁定，无法更换。' });
      return;
    }

    io.to(roomId).emit('problemReplacing', { probIndex });

    try {
      const aiConfig = room.config.aiConfig || null;
      const existingProblems = room.problems.filter((_, i) => i !== probIndex);
      const newProb = await generateSingleProblem(room.config, aiConfig, existingProblems);

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
    const aiConfig = room.config.aiConfig || null;
    const aiResult = await judgeAnswerSteps(probData.answer, probData.solution, answer, steps, aiConfig);
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
      }
    } else {
      socket.emit('answerResult', {
        message: `得分 ${aiResult.scorePercent}%，未超过队伍在本题的最高分。反馈：${aiResult.feedback}`
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        if (room.players.length === 0) {
          delete rooms[roomId];
        } else {
          room.players.forEach(p => p.ready = false);
          if (room.status === 'waiting') io.to(roomId).emit('roomUpdate', room);
        }
      }
    }
  });
});

async function startGame(roomId) {
  const room = rooms[roomId];
  const numQ = room.config.numQuestions || 3;
  room.status = 'playing';
  room.skipVotes = { A: false, B: false };
  room.problems = [];
  room.state.scoresTracker = { A: {}, B: {} };
  room.state.locks = {};
  room.teamScores = { A: 0, B: 0 };
  room.players.forEach(p => p.score = 0);
  io.to(roomId).emit('paperGenerated', { paper: [], total: numQ }); // clear frontend
  io.to(roomId).emit('roomUpdate', room);

  const aiConfig = room.config.aiConfig || null;

  // Generate problems one by one
  for (let i = 0; i < numQ; i++) {
    try {
      const prob = await generateSingleProblem(room.config, aiConfig, room.problems);
      room.problems.push(prob);
      const masked = { problem: prob.problem, tags: prob.tags, difficulty: prob.difficulty };
      io.to(roomId).emit('problemAdded', { index: i, problem: masked, total: numQ });
      console.log(`[Game] Room ${roomId}: problem ${i + 1}/${numQ} generated`);
    } catch (error) {
      console.error(`Failed to generate problem ${i + 1}:`, error);
      // Push fallback
      const fallback = {
        problem: `求 $x$，已知 $3^x = ${Math.pow(3, i + 2)}$。`,
        answer: `${i + 2}`, solution: `$3^x = 3^{${i + 2}}$，$x=${i + 2}$。`,
        tags: ['对数与指数'], difficulty: 1000
      };
      room.problems.push(fallback);
      const masked = { problem: fallback.problem, tags: fallback.tags, difficulty: fallback.difficulty };
      io.to(roomId).emit('problemAdded', { index: i, problem: masked, total: numQ });
    }
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
