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
    if (winner === socket.id) {
      status.value = 'Поздравляем! Вы победили!';
    } else if (gameState.value?.players.others.find(p => p.id === winner)) {
      status.value = `Игрок ${gameState.value.players.others.find(p => p.id === winner).name} победил!`;
    } else {
      status.value = 'Игра окончена!';
    }
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

const getSuitSymbol = (suit) => {
  const symbols = {
    'hearts': '♥',
    'diamonds': '♦',
    'clubs': '♣',
    'spades': '♠'
  };
  return symbols[suit] || suit;
}

const canAttackWith = (card) => {
  if (!gameState.value || gameState.value.currentTurn !== socket.id) return false;
  if (!gameState.value.players.self.isAttacker) return false;
  if (gameState.value.players.self.hasPickedUpCards) return false; // Нельзя подкидывать, если взял карты

  // Первый ход
  if (gameState.value.table.attacking.length === 0) {
    // Если есть не козырные карты, нельзя ходить козырем
    const hasNonTrumpCards = gameState.value.players.self.cards.some(
      c => c.suit !== gameState.value.trump.suit
    );
    if (hasNonTrumpCards && card.suit === gameState.value.trump.suit) {
      return false;
    }
    return true;
  }

  // Нельзя подкидывать больше 6 карт
  if (gameState.value.table.attacking.length >= 6) return false;

  // Нельзя подкидывать больше, чем карт у защищающегося
  const defender = gameState.value.players.others.find(
    p => p.id === gameState.value.nextDefender
  );
  if (defender && defender.cardCount <= gameState.value.table.attacking.length) {
    return false;
  }

  // Подкидывать можно только карты тех же достоинств, что уже есть на столе
  const validRanks = new Set([
    ...gameState.value.table.attacking.map(c => c.rank),
    ...gameState.value.table.defending.filter(c => c !== null).map(c => c.rank)
  ]);

  return validRanks.has(card.rank);
}

const canDefendWith = (card) => {
  if (!gameState.value || gameState.value.nextDefender !== socket.id) return false;
  
  const lastAttackingCard = gameState.value.table.attacking[
    gameState.value.table.defending.length
  ];
  if (!lastAttackingCard) return false;

  // Если атакующая карта козырная
  if (lastAttackingCard.suit === gameState.value.trump.suit) {
    // Можно бить только старшим козырем
    return card.suit === gameState.value.trump.suit && card.value > lastAttackingCard.value;
  }

  // Если карта защиты козырная, а атакующая нет - можно бить
  if (card.suit === gameState.value.trump.suit && lastAttackingCard.suit !== gameState.value.trump.suit) {
    return true;
  }

  // В остальных случаях можно бить только старшей картой той же масти
  return card.suit === lastAttackingCard.suit && card.value > lastAttackingCard.value;
}

const playCard = (card) => {
  if (!gameState.value || !gameState.value.lobbyId) return;

  const isDefendingNow = gameState.value.nextDefender === socket.id;
  
  // Проверяем, можно ли сыграть карту
  if (isDefendingNow) {
    if (!canDefendWith(card)) {
      status.value = 'Этой картой нельзя отбиться!';
      return;
    }
  } else {
    if (!canAttackWith(card)) {
      status.value = 'Этой картой сейчас нельзя ходить!';
      return;
    }
  }

  socket.emit('playCard', {
    lobbyId: gameState.value.lobbyId,
    card,
    isDefending: isDefendingNow
  });
  selectedCard.value = card;
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
    <div v-else-if="gameState" class="game-board">      <!-- Статус игры -->
      <div class="game-info">
        <div class="status">{{ status }}</div>
        <div class="trump-info" v-if="gameState.trump">
          Козырь: <span :class="gameState.trump.suit">{{ getSuitSymbol(gameState.trump.suit) }}</span>
        </div>
        <div class="turn-info">
          <template v-if="gameState.status === 'playing'">
            <span v-if="gameState.currentTurn === socket.id">
              {{ isDefending ? 'Ваш ход: Отбейтесь от карт' : 'Ваш ход: Атакуйте' }}
            </span>
            <span v-else>
              {{ isDefending ? 'Ожидайте атаки' : 'Ход игрока: ' + (gameState.players.others.find(p => p.id === gameState.currentTurn)?.name || 'Противник') }}
            </span>
          </template>
          <span v-else-if="gameState.status === 'taking_cards'">
            {{ gameState.nextDefender === socket.id ? 'Вы берете карты' : 'Игрок берет карты' }}
          </span>
        </div>
      </div>

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
              <div class="card-content">
                <div class="card-top">{{ attack.rank }}</div>
                <div class="card-suit">
                  {{ getSuitSymbol(attack.suit) }}
                </div>
                <div class="card-bottom">{{ attack.rank }}</div>
              </div>
            </div>
            <div v-if="gameState.table.defending[index]" 
                 class="card defending" 
                 :class="gameState.table.defending[index].suit">
              <div class="card-content">
                <div class="card-top">{{ gameState.table.defending[index].rank }}</div>
                <div class="card-suit">
                  {{ getSuitSymbol(gameState.table.defending[index].suit) }}
                </div>
                <div class="card-bottom">{{ gameState.table.defending[index].rank }}</div>
              </div>
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
             ]"             @click="playCard(card)">
          <div class="card-content">
            <div class="card-top">{{ card.rank }}</div>
            <div class="card-suit">
              {{ getSuitSymbol(card.suit) }}
            </div>
            <div class="card-bottom">{{ card.rank }}</div>
          </div>
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
  width: 100px;
  height: 150px;
  background: white;
  border: 2px solid #333;
  border-radius: 10px;
  margin: 5px;
  position: relative;
  box-shadow: 2px 2px 5px rgba(0, 0, 0, 0.2);
}

.card-back {
  background: linear-gradient(45deg, #1a1a1a, #333);
  border: 2px solid gold;
  color: transparent;
}

.deck {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
}

.trump-card {
  transform: rotate(90deg);
  margin-left: -30px;
}

.deck-pile {
  position: relative;
}

.deck-pile::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
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
  justify-content: center;
  align-items: center;
  min-height: 200px;
  padding: 20px;
}

.card-pair {
  display: flex;
  flex-direction: column;
  margin: 0 10px;
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

.game-info {
  background: rgba(0,0,0,0.5);
  padding: 15px;
  border-radius: 10px;
  color: white;
  margin-bottom: 20px;
  text-align: center;
}

.trump-info {
  margin: 10px 0;
  font-size: 1.2em;
}

.trump-info span {
  font-size: 1.5em;
  vertical-align: middle;
}

.turn-info {
  font-size: 1.1em;
  font-weight: bold;
}

/* Улучшаем отображение мастей */
.hearts, .diamonds {
  color: #ff4444;
  text-shadow: 0 0 2px rgba(255,255,255,0.5);
}

.clubs, .spades {
  color: #333;
  text-shadow: 0 0 2px rgba(255,255,255,0.5);
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

.card-content {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 5px;
}

.card-top {
  text-align: left;
}

.card-suit {
  font-size: 24px;
  text-align: center;
}

.card-bottom {
  text-align: right;
  transform: rotate(180deg);
}

.trump-card {
  transform: rotate(-90deg);
  margin-left: -30px; /* Сдвигаем козырь влево, чтобы он выглядел как-будто лежит под колодой */
}

.playing-field .card-pair {
  position: relative;
  perspective: 1000px;
}

.playing-field .defending {
  transform: translate(20px, 20px);
  box-shadow: 2px 2px 5px rgba(0,0,0,0.3);
}

/* Добавляем подсветку для карт, которыми можно ходить */
.card.playable {
  box-shadow: 0 0 10px #4CAF50;
}

.card.playable:hover {
  transform: translateY(-10px);
  box-shadow: 0 0 15px #4CAF50;
}

/* Подсветка для текущего игрока */
.opponent.current {
  box-shadow: 0 0 15px rgba(255,255,0,0.5);
  background: rgba(255,255,0,0.2);
}

/* Анимация для взятия карт */
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}

.card.taking {
  animation: shake 0.5s ease-in-out;
}
</style>
