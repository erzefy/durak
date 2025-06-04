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
const playerLobbies = new Map<string, string>();

function updateGameState(gameState: GameState, lobby: LobbyState) {
  // Проверяем окончание игры
  if (gameState.status === 'finished') {
    lobby.status = 'finished';
    io.to(gameState.lobbyId).emit('gameEnded', { 
      winner: gameState.winner,
      gameState: gameState // Отправляем финальное состояние игры
    });
    return;
  }

  // Отправляем обновленное состояние каждому игроку
  lobby.players.forEach(player => {
    const playerView = gameService.getPlayerView(gameState, player.id);
    io.to(player.id).emit('gameStateUpdated', playerView);
  });
}

io.on('connection', (socket: Socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Создание лобби
  socket.on('createLobby', ({ name, playerName }: { name: string, playerName: string }) => {
    const lobbyId = Math.random().toString(36).substring(7);
    
    const lobby: LobbyState = {
      id: lobbyId,
      name,
      hostId: socket.id,      players: [{
        id: socket.id,
        name: playerName,
        cards: [],
        isAttacker: false,
        isReady: false,
        hasPickedUpCards: false
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
    if (lobby && lobby.status === 'waiting' && lobby.players.length < lobby.maxPlayers) {      const newPlayer: PlayerState = {
        id: socket.id,
        name: playerName,
        cards: [],
        isAttacker: false,
        isReady: false,
        hasPickedUpCards: false
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
    const lobby = lobbies.get(lobbyId);
    
    if (!gameState || !lobby) return;
    
    // Проверяем, может ли игрок сделать ход
    if (isDefending && gameState.nextDefender !== socket.id) return;
    if (!isDefending && gameState.currentTurn !== socket.id && !gameState.players[socket.id]?.isAttacker) return;
    if (gameState.players[socket.id]?.hasPickedUpCards) return;

    if (gameService.makeMove(gameState, socket.id, card, isDefending)) {
      updateGameState(gameState, lobby);
    }
  });

  // Взятие карт
  socket.on('takeCards', ({ lobbyId }: { lobbyId: string }) => {
    const gameState = games.get(lobbyId);
    const lobby = lobbies.get(lobbyId);
    
    if (!gameState || !lobby || !gameState.canTakeCards || gameState.nextDefender !== socket.id) return;

    gameService.handleTakeCards(gameState, socket.id);
    updateGameState(gameState, lobby);
  });
  // Пропуск хода
  socket.on('passTurn', ({ lobbyId }: { lobbyId: string }) => {
    const gameState = games.get(lobbyId);
    const lobby = lobbies.get(lobbyId);
    
    if (!gameState || !lobby || gameState.currentTurn !== socket.id) return;
    if (gameState.table.attacking.length === 0) return;

    // Добавляем игрока в список пропустивших ход
    if (!gameState.passedPlayers.includes(socket.id)) {
      gameState.passedPlayers.push(socket.id);
    }

    // Если все игроки кроме защищающегося пропустили ход
    if (gameState.passedPlayers.length >= Object.keys(gameState.players).length - 1) {
      gameService.endTurn(gameState);
    } else {
      // Передаем ход следующему игроку
      const currentIndex = gameState.turnOrder.indexOf(socket.id);
      let nextIndex = (currentIndex + 1) % gameState.turnOrder.length;
      
      // Пропускаем защищающегося игрока
      if (gameState.turnOrder[nextIndex] === gameState.nextDefender) {
        nextIndex = (nextIndex + 1) % gameState.turnOrder.length;
      }
      
      gameState.currentTurn = gameState.turnOrder[nextIndex];
    }

    updateGameState(gameState, lobby);
  });

  // Завершение хода
  socket.on('endTurn', ({ lobbyId }: { lobbyId: string }) => {
    const gameState = games.get(lobbyId);
    const lobby = lobbies.get(lobbyId);
    
    if (!gameState || !lobby || gameState.currentTurn !== socket.id) return;
    
    // Проверяем, все ли карты отбиты или взяты
    const allCardsDefended = gameState.table.attacking.length === gameState.table.defending.length;
    const cardsAreTaken = gameState.status === 'taking_cards';
    
    if (!allCardsDefended && !cardsAreTaken) return;

    gameService.endTurn(gameState);
    updateGameState(gameState, lobby);
  });

  // Отключение игрока
  socket.on('disconnect', () => {
    const lobbyId = playerLobbies.get(socket.id);
    if (!lobbyId) return;

    const lobby = lobbies.get(lobbyId);
    if (!lobby) return;

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
        
        // Если осталось меньше 2 игроков, завершаем игру
        if (Object.keys(gameState.players).length < 2) {
          gameState.status = 'finished';
          gameState.winner = Object.keys(gameState.players)[0];
          lobby.status = 'finished';
          io.to(lobbyId).emit('gameEnded', { 
            winner: gameState.winner,
            gameState: gameState
          });
        } else {
          updateGameState(gameState, lobby);
        }
      }
    } else if (socket.id === lobby.hostId && lobby.players.length > 0) {
      // Если вышел хост, назначаем нового
      lobby.hostId = lobby.players[0].id;
    }
    
    io.to(lobbyId).emit('playerLeft', { lobby, playerId: socket.id });
    io.emit('lobbiesUpdated', Array.from(lobbies.values()));
    playerLobbies.delete(socket.id);
  });
});

server.listen(3005, '0.0.0.0', () => {
  console.log('Server is running on port 3005');
});