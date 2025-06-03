<script setup>
import { ref, onMounted } from 'vue'
import { io } from 'socket.io-client'

const socket = io('http://192.168.31.10:3001')

const gameState = ref(null)
const selectedCard = ref(null)
const lobbyId = ref(null)
const status = ref('')

const createLobby = () => {
  status.value = 'Создание лобби...';
  socket.emit('createLobby', { name: 'Test Lobby' });
}

onMounted(() => {
  socket.on('lobbyCreated', (data) => {
    lobbyId.value = data.lobbyId;
    status.value = `Лобби создано: ${data.lobbyId}`;
    
    socket.emit('startGame', data.lobbyId);
    status.value += ' | Отправлен старт игры';
  });
  socket.on('gameStarted', (state) => {
    gameState.value = state;
    status.value = 'Игра началась!';
  });
  socket.on('connect', () => {
    status.value = 'Подключено к серверу';
  });
  socket.on('disconnect', () => {
    status.value = 'Отключено от сервера';
  });
});

const playCard = (card) => {
  if (gameState.value.currentTurn === socket.id) {
    socket.emit('playCard', {
      lobbyId: gameState.value.lobbyId,
      card
    })
    selectedCard.value = card // выделяем выбранную карту
  }
}
</script>

<template>
    <div>
    <button @click="createLobby">Создать лобби и начать игру</button>
    <div v-if="lobbyId">Лобби ID: {{ lobbyId }}</div>
    <div>{{ status }}</div>
    </div>
  <div v-if="gameState" class="game-board">
    <!-- Карты противника -->
    <div class="opponent-hand">
      <div v-for="i in gameState.players.opponent.cardCount" 
           :key="i" 
           class="card card-back" />
    </div>

    <!-- Игровой стол -->
    <div class="table">
      <div class="trump-card">
        <div class="card" :class="gameState.trump.suit">
          {{ gameState.trump.rank }}
        </div>
      </div>
      <div class="playing-field">
        <!-- Отображение карт на столе -->
      </div>
    </div>

    <!-- Карты игрока -->
    <div class="player-hand">
      <div v-for="card in gameState.players.self.cards" 
           :key="`${card.suit}-${card.rank}`"
           class="card"
           :class="[card.suit, { 'selected': selectedCard && selectedCard.suit === card.suit && selectedCard.rank === card.rank }]"
           @click="playCard(card)">
        {{ card.rank }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.game-board {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
}

.card {
  width: 60px;
  height: 90px;
  border: 1px solid #000;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: white;
}

.card-back {
  background: #45a049;
}

.player-hand, .opponent-hand {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.selected {
  transform: translateY(-10px);
}

.hearts, .diamonds {
  color: red;
}

.clubs, .spades {
  color: black;
}
</style>