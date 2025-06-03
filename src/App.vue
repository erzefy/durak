<script setup>
import { ref, onMounted, computed } from 'vue'
import { io } from 'socket.io-client'

const socket = io('http://localhost:3005')

const gameState = ref(null)
const selectedCard = ref(null)
const lobbies = ref([])
const currentLobby = ref(null)
const playerName = ref('')
const status = ref('')
const showLobbyForm = ref(true)
const isDefending = computed(() => 
  gameState.value?.nextDefender === socket.id
)

const createLobby = () => {
  if (!playerName.value) {
    status.value = 'Введите имя игрока';
    return;
  }
  socket.emit('createLobby', { 
    name: `Лобби ${playerName.value}`,
    playerName: playerName.value
  });
  showLobbyForm.value = false;
}

const joinLobby = (lobby) => {
  if (!playerName.value) {
    status.value = 'Введите имя игрока';
    return;
  }
  socket.emit('joinLobby', { 
    lobbyId: lobby.id,
    playerName: playerName.value
  });
  showLobbyForm.value = false;
}

const toggleReady = () => {
  socket.emit('toggleReady');
}

const startGame = () => {
  if (currentLobby.value && currentLobby.value.hostId === socket.id) {
    socket.emit('startGame', { lobbyId: currentLobby.value.id });
  }
}

const endTurn = () => {
  if (gameState.value?.currentTurn === socket.id) {
    socket.emit('endTurn', {
      lobbyId: gameState.value.lobbyId
    });
  }
}

const passTurn = () => {
  if (gameState.value?.currentTurn === socket.id) {
    socket.emit('passTurn', {
      lobbyId: gameState.value.lobbyId
    });
  }
}

const takeCards = () => {
  if (gameState.value?.canTakeCards && gameState.value?.nextDefender === socket.id) {
    socket.emit('takeCards', {
      lobbyId: gameState.value.lobbyId
    });
  }
}

onMounted(() => {
  socket.emit('getLobbies');

  socket.on('lobbiesList', (data) => {
    lobbies.value = data;
  });

  socket.on('lobbyCreated', ({ lobby }) => {
    currentLobby.value = lobby;
    status.value = `Лобби создано: ${lobby.id}`;
  });

  socket.on('playerJoined', ({ lobby }) => {
    currentLobby.value = lobby;
    status.value = 'Игрок присоединился к лобби';
  });

  socket.on('playerLeft', ({ lobby, playerId }) => {
    currentLobby.value = lobby;
    status.value = 'Игрок покинул лобби';
  });

  socket.on('playerStatusUpdated', ({ lobby }) => {
    currentLobby.value = lobby;
  });

  socket.on('lobbiesUpdated', (data) => {
    lobbies.value = data;
  });

  socket.on('gameStarted', (state) => {
    gameState.value = state;
    status.value = 'Игра началась!';
  });

  socket.on('gameStateUpdated', (state) => {
    gameState.value = state;
    updateGameStatus();
  });

  socket.on('gameEnded', ({ winner }) => {
    status.value = winner === socket.id ? 'Вы победили!' : 'Вы проиграли!';
    gameState.value = null;
    currentLobby.value = null;
    showLobbyForm.value = true;
  });

  socket.on('connect', () => {
    status.value = 'Подключено к серверу';
  });

  socket.on('disconnect', () => {
    status.value = 'Отключено от сервера';
    gameState.value = null;
    currentLobby.value = null;
    showLobbyForm.value = true;
  });
});

const updateGameStatus = () => {
  if (!gameState.value) return;
  
  if (gameState.value.status === 'taking_cards') {
    status.value = gameState.value.nextDefender === socket.id 
      ? 'Вы должны взять карты' 
      : 'Игрок берет карты';
  } else if (gameState.value.currentTurn === socket.id) {
    status.value = isDefending.value ? 'Ваш ход: защищайтесь' : 'Ваш ход: атакуйте';
  } else {
    status.value = isDefending.value ? 'Ожидание атаки' : 'Ход игрока';
  }
}

const playCard = (card) => {
  if (gameState.value?.currentTurn === socket.id) {
    socket.emit('playCard', {
      lobbyId: gameState.value.lobbyId,
      card,
      isDefending: isDefending.value
    });
    selectedCard.value = card;
  }
}
</script>

<template>
  <div class="game-container">
    <!-- Форма входа -->
    <div v-if="showLobbyForm" class="lobby-form">
      <div class="input-group">
        <input v-model="playerName" 
               placeholder="Введите ваше имя"
               @keyup.enter="createLobby" />
      </div>
      
      <!-- Список доступных лобби -->
      <div class="lobbies-list" v-if="lobbies.length > 0">
        <h3>Доступные лобби:</h3>
        <div v-for="lobby in lobbies" :key="lobby.id" class="lobby-item">
          <span>{{ lobby.name }} ({{ lobby.players.length }}/{{ lobby.maxPlayers }})</span>
          <button @click="joinLobby(lobby)" 
                  :disabled="!playerName">
            Присоединиться
          </button>
        </div>
      </div>
      
      <button @click="createLobby" 
              :disabled="!playerName" 
              class="create-lobby-btn">
        Создать новое лобби
      </button>
    </div>

    <!-- Лобби -->
    <div v-else-if="currentLobby && !gameState" class="lobby-view">
      <h2>{{ currentLobby.name }}</h2>
      <div class="players-list">
        <div v-for="player in currentLobby.players" 
             :key="player.id" 
             class="player-item"
             :class="{ host: player.id === currentLobby.hostId }">
          <span>{{ player.name }}</span>
          <span v-if="player.id === currentLobby.hostId">(Хост)</span>
          <span v-if="player.isReady" class="ready-status">Готов</span>
        </div>
      </div>
      
      <div class="lobby-controls">
        <button v-if="currentLobby.hostId === socket.id"
                @click="startGame"
                :disabled="currentLobby.players.length < 2">
          Начать игру
        </button>
        <button v-else
                @click="toggleReady">
          {{ currentLobby.players.find(p => p.id === socket.id)?.isReady ? 'Не готов' : 'Готов' }}
        </button>
      </div>
    </div>

    <!-- Игровой стол -->
    <div v-else-if="gameState" class="game-board">
      <!-- Статус игры -->
      <div class="status">{{ status }}</div>

      <!-- Карты других игроков -->
      <div class="other-players">
        <div v-for="player in gameState.players.others" 
             :key="player.id"
             class="opponent"
             :class="{ current: player.id === gameState.currentTurn }">
          <div class="player-name">{{ player.name }}</div>
          <div class="opponent-hand">
            <div v-for="i in player.cardCount" 
                 :key="i" 
                 class="card card-back" />
          </div>
        </div>
      </div>

      <!-- Игровой стол -->
      <div class="table">
        <div class="deck-area">
          <div v-if="gameState.deck.length" class="card card-back deck">
            {{ gameState.deck.length }}
          </div>
          <div class="trump-card" v-if="gameState.trump">
            <div class="card" :class="gameState.trump.suit">
              {{ gameState.trump.rank }}
            </div>
          </div>
        </div>

        <div class="playing-field">
          <div v-for="(attack, index) in gameState.table.attacking" 
               :key="'attack' + index" 
               class="card-pair">
            <div class="card" :class="attack.suit">
              {{ attack.rank }}
            </div>
            <div v-if="gameState.table.defending[index]" 
                 class="card defending" 
                 :class="gameState.table.defending[index].suit">
              {{ gameState.table.defending[index].rank }}
            </div>
          </div>
        </div>
      </div>

      <!-- Контролы игры -->
      <div class="game-actions" v-if="gameState.currentTurn === socket.id">
        <button @click="endTurn" 
                :disabled="gameState.status === 'taking_cards'">
          Завершить ход
        </button>
        <button @click="passTurn" 
                :disabled="!gameState.table.attacking.length">
          Пропустить
        </button>
        <button v-if="gameState.canTakeCards && gameState.nextDefender === socket.id"
                @click="takeCards">
          Взять карты
        </button>
      </div>

      <!-- Карты игрока -->
      <div class="player-hand">
        <div v-for="card in gameState.players.self.cards" 
             :key="`${card.suit}-${card.rank}`"
             class="card"
             :class=" [
               card.suit, 
               { 
                 'selected': selectedCard && selectedCard.suit === card.suit && selectedCard.rank === card.rank,
                 'playable': gameState.currentTurn === socket.id
               }
             ]"
             @click="playCard(card)">
          {{ card.rank }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.game-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.lobby-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  align-items: center;
  padding: 20px;
}

.input-group {
  display: flex;
  gap: 10px;
}

.input-group input {
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 1em;
}

.lobbies-list {
  width: 100%;
  max-width: 600px;
}

.lobby-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  border: 1px solid #ccc;
  margin: 5px 0;
  border-radius: 4px;
}

.lobby-view {
  text-align: center;
  padding: 20px;
}

.players-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 20px 0;
}

.player-item {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: center;
}

.ready-status {
  color: #4CAF50;
}

.host::after {
  content: "👑";
  margin-left: 5px;
}

.lobby-controls {
  margin-top: 20px;
}

.game-board {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
  background: #076324;
  border-radius: 15px;
  box-shadow: 0 0 10px rgba(0,0,0,0.3);
}

.other-players {
  display: flex;
  justify-content: space-around;
  flex-wrap: wrap;
  gap: 20px;
  margin-bottom: 20px;
}

.opponent {
  text-align: center;
  padding: 10px;
  border-radius: 8px;
  background: rgba(255,255,255,0.1);
}

.opponent.current {
  background: rgba(255,255,0,0.2);
}

.player-name {
  color: white;
  margin-bottom: 5px;
}

.card {
  width: 60px;
  height: 90px;
  border: 2px solid #000;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: white;
  font-weight: bold;
  font-size: 1.2em;
  position: relative;
  transition: transform 0.2s;
}

.card-back {
  background: linear-gradient(45deg, #1a1a1a, #333);
  border: 2px solid gold;
  color: transparent;
}

.deck {
  color: white;
  font-size: 0.8em;
}

.player-hand, .opponent-hand {
  display: flex;
  gap: 10px;
  justify-content: center;
  min-height: 100px;
}

.deck-area {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-bottom: 20px;
}

.playing-field {
  display: flex;
  gap: 20px;
  justify-content: center;
  flex-wrap: wrap;
  min-height: 200px;
  padding: 20px;
  background: rgba(255,255,255,0.1);
  border-radius: 10px;
}

.card-pair {
  position: relative;
  width: 70px;
  height: 100px;
}

.card-pair .defending {
  position: absolute;
  top: 20px;
  left: 10px;
}

.selected {
  transform: translateY(-10px);
  box-shadow: 0 0 10px rgba(255,255,255,0.5);
}

.playable:hover {
  transform: translateY(-5px);
  box-shadow: 0 0 15px rgba(255,255,255,0.3);
}

.hearts, .diamonds {
  color: #ff0000;
}

.clubs, .spades {
  color: #000;
}

.game-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 10px 0;
}

.status {
  text-align: center;
  color: white;
  font-size: 1.2em;
  margin-bottom: 10px;
}

button {
  padding: 10px 20px;
  border: none;
  border-radius: 5px;
  background: #4CAF50;
  color: white;
  cursor: pointer;
  font-size: 1em;
  transition: background 0.3s;
}

button:hover:not(:disabled) {
  background: #45a049;
}

button:disabled {
  background: #cccccc;
  cursor: not-allowed;
  opacity: 0.7;
}
</style>
