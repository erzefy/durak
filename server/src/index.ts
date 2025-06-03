import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { GameService } from './game';
import { GameState, Card } from './interfaces';

interface LobbyData {
  name: string;
}

interface Lobby {
  id: string;
  name: string;
  players: string[];
  maxPlayers: number;
}

const app = express();
const server = http.createServer(app);
const gameService = new GameService();
const games = new Map<string, GameState>();

const io = new Server(server, {
  cors: { origin: '*' },
});

// Хранилище лобби
const lobbies = new Map<string, Lobby>();

io.on('connection', (socket: Socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Обработка создания лобби
  socket.on('createLobby', (data: LobbyData) => {
    const lobbyId = Math.random().toString(36).substring(7);
    
    lobbies.set(lobbyId, {
      id: lobbyId,
      name: data.name,
      players: [socket.id],
      maxPlayers: 2
    });

    socket.join(lobbyId);
    console.log(`Lobby created: ${lobbyId}`);
    
    socket.emit('lobbyCreated', { lobbyId, name: data.name });
  });

  socket.on('message', (msg: string) => {
    console.log('Message received:', msg);
    io.emit('message', `${socket.id}: ${msg}`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    lobbies.forEach((lobby, lobbyId) => {
      if (lobby.players.includes(socket.id)) {
        lobby.players = lobby.players.filter(id => id !== socket.id);
        if (lobby.players.length === 0) {
          lobbies.delete(lobbyId);
        }
      }
    });
  });

  socket.on('startGame', (lobbyId: string) => {
    const lobby = lobbies.get(lobbyId);
    if (lobby) {
      const gameState = gameService.initializeGame(lobby.players);
      games.set(lobbyId, gameState);
      
      // Отправляем начальное состояние каждому игроку
      lobby.players.forEach(playerId => {
        const playerView = {
          ...gameState,
          players: {
            self: gameState.players[playerId],
            opponent: {
              cardCount: 6 // Фиксированное количество карт для тестирования
            }
          }
        };
        io.to(playerId).emit('gameStarted', playerView);
      });
    }
  });

  socket.on('playCard', ({ lobbyId, card }: { lobbyId: string, card: Card }) => {
    const gameState = games.get(lobbyId);
    if (!gameState || gameState.currentTurn !== socket.id) return;

    // Здесь будет логика хода
    // ...
  });
});

server.listen(3005, '0.0.0.0', () => {
  console.log('Server is running on port 3005');
});