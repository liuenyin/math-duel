import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { io } from 'socket.io-client';
import Lobby from './pages/Lobby';
import Room from './pages/Room';
import './index.css';

// Connect to backend (using same host, different port for local dev)
const socketUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const socket = io(socketUrl);

function App() {
  const [playerName, setPlayerName] = useState('');

  useEffect(() => {
    socket.on('connect', () => {
      console.log('Connected to server:', socket.id);
    });

    return () => {
      socket.off('connect');
    };
  }, []);

  return (
    <Router>
      <div className="app-container">
        <header className="app-header">
          <h1 className="app-title">数学对决</h1>
          <p style={{ color: 'var(--text-secondary)' }}>实时数学竞赛挑战</p>
        </header>

        <main>
          <Routes>
            <Route
              path="/"
              element={<Lobby socket={socket} playerName={playerName} setPlayerName={setPlayerName} />}
            />
            <Route
              path="/room/:id"
              element={<Room socket={socket} playerName={playerName} setPlayerName={setPlayerName} />}
            />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
