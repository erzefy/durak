import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { GameService } from './game';
import { GameState, Card, LobbyState, PlayerState } from './interfaces';

const app = express();
const server = http.createServer(app);
const gameService = new GameService();

const io = new Server(server, {
  cors: { origin: '*' },
});

// Хранилище лобби и игр
const lobbies = new Map<string, LobbyState>();
const games = new Map<string, GameState>();

// Хранение информации о том, в каком лобби находится игрок
const playerLobbies = new Map<string, string>();

io.on('connection', (socket: Socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Создание лобби
  socket.on('createLobby', ({ name, playerName }: { name: string, playerName: string }) => {
    const lobbyId = Math.random().toString(36).substring(7);
    
    const lobby: LobbyState = {
      id: lobbyId,
      name,
      hostId: socket.id,
      players: [{
        id: socket.id,
        name: playerName,
        cards: [],
        isAttacker: false,
        isReady: false
      }],
      maxPlayers: 4,
      status: 'waiting'
    };

    lobbies.set(lobbyId, lobby);
    playerLobbies.set(socket.id, lobbyId);
    
    socket.join(lobbyId);
    socket.emit('lobbyCreated', { lobbyId, lobby });
    io.emit('lobbiesUpdated', Array.from(lobbies.values()));
  });

  // Получение списка доступных лобби
  socket.on('getLobbies', () => {
    const availableLobbies = Array.from(lobbies.values())
      .filter(lobby => lobby.status === 'waiting' && lobby.players.length < lobby.maxPlayers);
    socket.emit('lobbiesList', availableLobbies);
  });

  // Присоединение к лобби
  socket.on('joinLobby', ({ lobbyId, playerName }: { lobbyId: string, playerName: string }) => {
    const lobby = lobbies.get(lobbyId);
    if (lobby && lobby.status === 'waiting' && lobby.players.length < lobby.maxPlayers) {
      const newPlayer: PlayerState = {
        id: socket.id,
        name: playerName,
        cards: [],
        isAttacker: false,
        isReady: false
      };
      
      lobby.players.push(newPlayer);
      playerLobbies.set(socket.id, lobbyId);
      
      socket.join(lobbyId);
      io.to(lobbyId).emit('playerJoined', { lobby });
      io.emit('lobbiesUpdated', Array.from(lobbies.values()));
    }
  });

  // Готовность игрока
  socket.on('toggleReady', () => {
    const lobbyId = playerLobbies.get(socket.id);
    if (lobbyId) {
      const lobby = lobbies.get(lobbyId);
      if (lobby) {
        const player = lobby.players.find(p => p.id === socket.id);
        if (player) {
          player.isReady = !player.isReady;
          io.to(lobbyId).emit('playerStatusUpdated', { lobby });
        }
      }
    }
  });

  // Старт игры (только для хоста)
  socket.on('startGame', ({ lobbyId }: { lobbyId: string }) => {
    const lobby = lobbies.get(lobbyId);
    if (lobby && socket.id === lobby.hostId && lobby.players.length >= 2) {
      const allReady = lobby.players.every(player => player.isReady || player.id === lobby.hostId);      if (allReady) {
        lobby.status = 'playing';
        const gameState = gameService.initializeGame(
          lobby.players.map(p => p.id),
          lobbyId,
          lobby.players
        );
        games.set(lobbyId, gameState);
        
        // Отправляем начальное состояние каждому игроку
        lobby.players.forEach(player => {
          const playerView = gameService.getPlayerView(gameState, player.id);
          io.to(player.id).emit('gameStarted', playerView);
        });
      }
    }
  });

  // Обработка хода
  socket.on('playCard', ({ lobbyId, card, isDefending }: { lobbyId: string, card: Card, isDefending: boolean }) => {
    const gameState = games.get(lobbyId);
    if (!gameState || gameState.currentTurn !== socket.id) return;

    if (gameService.makeMove(gameState, socket.id, card, isDefending)) {
      const lobby = lobbies.get(lobbyId);
      if (lobby) {
        lobby.players.forEach(player => {
          const playerView = gameService.getPlayerView(gameState, player.id);
          io.to(player.id).emit('gameStateUpdated', playerView);
        });
      }
    }
  });

  // Взятие карт
  socket.on('takeCards', ({ lobbyId }: { lobbyId: string }) => {
    const gameState = games.get(lobbyId);
    if (!gameState || !gameState.canTakeCards || gameState.nextDefender !== socket.id) return;

    gameService.handleTakeCards(gameState, socket.id);
    
    const lobby = lobbies.get(lobbyId);
    if (lobby) {
      lobby.players.forEach(player => {
        const playerView = gameService.getPlayerView(gameState, player.id);
        io.to(player.id).emit('gameStateUpdated', playerView);
      });
    }
  });

  // Пропуск хода
  socket.on('passTurn', ({ lobbyId }: { lobbyId: string }) => {
    const gameState = games.get(lobbyId);
    if (!gameState || !gameService.canPass(gameState, socket.id)) return;

    gameService.handlePassTurn(gameState, socket.id);
    
    const lobby = lobbies.get(lobbyId);
    if (lobby) {
      lobby.players.forEach(player => {
        const playerView = gameService.getPlayerView(gameState, player.id);
        io.to(player.id).emit('gameStateUpdated', playerView);
      });
    }
  });

  // Завершение хода
  socket.on('endTurn', ({ lobbyId }: { lobbyId: string }) => {
    const gameState = games.get(lobbyId);
    if (!gameState || gameState.currentTurn !== socket.id) return;

    gameService.endTurn(gameState);
    
    const lobby = lobbies.get(lobbyId);
    if (lobby) {
      // Проверяем окончание игры
      if (gameState.status === 'finished') {
        lobby.status = 'finished';
        io.to(lobbyId).emit('gameEnded', { winner: gameState.winner });
      } else {
        lobby.players.forEach(player => {
          const playerView = gameService.getPlayerView(gameState, player.id);
          io.to(player.id).emit('gameStateUpdated', playerView);
        });
      }
    }
  });

  // Отключение игрока
  socket.on('disconnect', () => {
    const lobbyId = playerLobbies.get(socket.id);
    if (lobbyId) {
      const lobby = lobbies.get(lobbyId);
      if (lobby) {
        // Удаляем игрока из лобби
        lobby.players = lobby.players.filter(p => p.id !== socket.id);
        
        if (lobby.players.length === 0) {
          // Если лобби пустое, удаляем его
          lobbies.delete(lobbyId);
          games.delete(lobbyId);
        } else if (lobby.status === 'playing') {
          // Если игра идет, обрабатываем выход игрока
          const gameState = games.get(lobbyId);
          if (gameState) {
            gameService.handlePlayerDisconnect(gameState, socket.id);
            
            lobby.players.forEach(player => {
              const playerView = gameService.getPlayerView(gameState, player.id);
              io.to(player.id).emit('gameStateUpdated', playerView);
            });
          }
        } else if (socket.id === lobby.hostId && lobby.players.length > 0) {
          // Если вышел хост, назначаем нового
          lobby.hostId = lobby.players[0].id;
        }
        
        io.to(lobbyId).emit('playerLeft', { 
          lobby,
          playerId: socket.id 
        });
        io.emit('lobbiesUpdated', Array.from(lobbies.values()));
      }
      playerLobbies.delete(socket.id);
    }
  });
});

server.listen(3005, '0.0.0.0', () => {
  console.log('Server is running on port 3005');
});