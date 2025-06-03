import { Card, GameState, PlayerState } from './interfaces';

export class GameService {
  private createDeck(): Card[] {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const ranks = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const deck: Card[] = [];

    suits.forEach(suit => {
      ranks.forEach((rank, index) => {
        deck.push({ suit: suit as Card['suit'], rank: rank as Card['rank'], value: index + 6 });
      });
    });

    return this.shuffle(deck);
  }

  private shuffle(deck: Card[]): Card[] {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  private shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  initializeGame(playerIds: string[], lobbyId: string, playerInfos: PlayerState[]): GameState {
    const deck = this.createDeck();
    const trump = deck.pop()!;
    const players: GameState['players'] = {};
    
    // Определяем порядок ходов
    const turnOrder = this.shuffleArray([...playerIds]);

    turnOrder.forEach((id, index) => {
      const playerInfo = playerInfos.find(p => p.id === id);
      players[id] = {
        name: playerInfo?.name || `Player ${index + 1}`,
        cards: deck.splice(0, 6),
        isAttacker: index === 0
      };
    });

    return {
      lobbyId,
      deck,
      trump,
      players,
      table: {
        attacking: [],
        defending: []
      },
      currentTurn: turnOrder[0],
      status: 'playing',
      maxPlayers: playerIds.length,
      currentPlayers: playerIds.length,
      nextDefender: turnOrder[1],
      canTakeCards: false,
      turnOrder,
      passedPlayers: []
    };
  }

  getPlayerView(gameState: GameState, playerId: string) {
    const { players, ...baseState } = gameState;
    
    // Создаем представление других игроков (без их карт)
    const otherPlayers = Object.entries(players)
      .filter(([id]) => id !== playerId)
      .map(([id, player]) => ({
        id,
        name: player.name,
        cardCount: player.cards.length,
        isAttacker: player.isAttacker
      }));

    return {
      ...baseState,
      players: {
        self: players[playerId],
        others: otherPlayers
      }
    };
  }

  handleTakeCards(gameState: GameState, playerId: string): void {
    if (!gameState.canTakeCards || gameState.nextDefender !== playerId) return;

    const defender = gameState.players[playerId];
    defender.cards.push(...gameState.table.attacking, ...gameState.table.defending);
    
    gameState.table.attacking = [];
    gameState.table.defending = [];
    gameState.canTakeCards = false;
    
    // Добираем карты всем игрокам
    this.dealCards(gameState);
    
    // Передаем ход следующему игроку после взявшего
    const currentIndex = gameState.turnOrder.indexOf(playerId);
    const nextIndex = (currentIndex + 1) % gameState.turnOrder.length;
    gameState.currentTurn = gameState.turnOrder[nextIndex];
    gameState.nextDefender = gameState.turnOrder[(nextIndex + 1) % gameState.turnOrder.length];
    gameState.passedPlayers = [];
  }

  canPass(gameState: GameState, playerId: string): boolean {
    return gameState.currentTurn === playerId && 
           gameState.table.attacking.length > 0 && 
           !gameState.passedPlayers.includes(playerId);
  }

  handlePassTurn(gameState: GameState, playerId: string): void {
    if (!this.canPass(gameState, playerId)) return;

    gameState.passedPlayers.push(playerId);
    
    // Если все игроки кроме защищающегося пропустили ход
    if (gameState.passedPlayers.length === gameState.turnOrder.length - 1) {
      this.endTurn(gameState);
    } else {
      // Передаем ход следующему игроку
      const currentIndex = gameState.turnOrder.indexOf(playerId);
      let nextIndex = (currentIndex + 1) % gameState.turnOrder.length;
      
      // Пропускаем защищающегося игрока
      if (gameState.turnOrder[nextIndex] === gameState.nextDefender) {
        nextIndex = (nextIndex + 1) % gameState.turnOrder.length;
      }
      
      gameState.currentTurn = gameState.turnOrder[nextIndex];
    }
  }

  handlePlayerDisconnect(gameState: GameState, playerId: string): void {
    // Если отключившийся игрок ходил, передаем ход следующему
    if (gameState.currentTurn === playerId) {
      const currentIndex = gameState.turnOrder.indexOf(playerId);
      const nextIndex = (currentIndex + 1) % gameState.turnOrder.length;
      gameState.currentTurn = gameState.turnOrder[nextIndex];
    }

    // Удаляем игрока из порядка ходов
    gameState.turnOrder = gameState.turnOrder.filter(id => id !== playerId);
    delete gameState.players[playerId];
    
    // Обновляем количество игроков
    gameState.currentPlayers--;
    
    // Если осталось меньше 2 игроков, игра заканчивается
    if (gameState.currentPlayers < 2) {
      gameState.status = 'finished';
      if (gameState.currentPlayers === 1) {
        gameState.winner = Object.keys(gameState.players)[0];
      }
    }
  }

  private dealCards(gameState: GameState): void {
    // Раздаем карты всем игрокам до 6
    Object.values(gameState.players).forEach(player => {
      while (player.cards.length < 6 && gameState.deck.length > 0) {
        player.cards.push(gameState.deck.pop()!);
      }
    });
  }

  public endTurn(gameState: GameState): void {
    // Проверяем окончание игры
    if (this.checkGameEnd(gameState)) {
      gameState.status = 'finished';
      return;
    }

    // Раздаем карты
    this.dealCards(gameState);

    // Очищаем стол
    gameState.table.attacking = [];
    gameState.table.defending = [];

    // Сбрасываем список пропустивших ход
    gameState.passedPlayers = [];    // Определяем следующего атакующего и защищающегося
    if (gameState.nextDefender) {
      const currentDefenderIndex = gameState.turnOrder.indexOf(gameState.nextDefender);
      gameState.currentTurn = gameState.nextDefender;
      gameState.nextDefender = gameState.turnOrder[(currentDefenderIndex + 1) % gameState.turnOrder.length];
    } else {
      const currentIndex = gameState.turnOrder.indexOf(gameState.currentTurn);
      gameState.currentTurn = gameState.turnOrder[(currentIndex + 1) % gameState.turnOrder.length];
      gameState.nextDefender = gameState.turnOrder[(currentIndex + 2) % gameState.turnOrder.length];
    }
    
    // Обновляем статусы атакующих
    Object.values(gameState.players).forEach(player => {
      player.isAttacker = false;
    });
    gameState.players[gameState.currentTurn].isAttacker = true;
  }

  canDefend(attackingCard: Card, defendingCard: Card, trump: Card): boolean {
    if (defendingCard.suit === trump.suit && attackingCard.suit !== trump.suit) {
      return true;
    }
    return defendingCard.suit === attackingCard.suit && defendingCard.value > attackingCard
    .value;
  }

    public makeMove(gameState: GameState, playerId: string, card: Card, isDefending: boolean): boolean {
    const player = gameState.players[playerId];
    
    if (!player || gameState.currentTurn !== playerId) {
      return false;
    }

    if (isDefending) {
      return this.defendCard(gameState, playerId, card);
    } else {
      return this.attackCard(gameState, playerId, card);
    }
  }

  private attackCard(gameState: GameState, playerId: string, card: Card): boolean {
    const player = gameState.players[playerId];
    
    // Проверяем, может ли игрок атаковать
    if (!player.isAttacker) {
      return false;
    }

    // Проверяем, есть ли такая карта у игрока
    if (!this.hasCard(player.cards, card)) {
      return false;
    }

    // Проверяем, можно ли добавить карту на стол
    if (gameState.table.attacking.length > 0) {
      const validRanks = new Set([
        ...gameState.table.attacking.map(c => c.rank),
        ...gameState.table.defending.map(c => c.rank)
      ]);
      if (!validRanks.has(card.rank)) {
        return false;
      }
    }

    // Добавляем карту на стол
    gameState.table.attacking.push(card);
    player.cards = player.cards.filter(c => 
      !(c.suit === card.suit && c.rank === card.rank)
    );

    return true;
  }

  private defendCard(gameState: GameState, playerId: string, card: Card): boolean {
    const player = gameState.players[playerId];
    
    // Проверяем, есть ли атакующая карта
    const lastAttackingCard = gameState.table.attacking[
      gameState.table.attacking.length - 1
    ];
    if (!lastAttackingCard) {
      return false;
    }

    // Проверяем, может ли карта побить атакующую
    if (!this.canDefend(lastAttackingCard, card, gameState.trump)) {
      return false;
    }

    // Добавляем карту в защиту
    gameState.table.defending.push(card);
    player.cards = player.cards.filter(c => 
      !(c.suit === card.suit && c.rank === card.rank)
    );

    return true;
  }

  private hasCard(cards: Card[], card: Card): boolean {
    return cards.some(c => c.suit === card.suit && c.rank === card.rank);
  }

  private checkGameEnd(gameState: GameState): boolean {
    if (gameState.deck.length === 0) {
      const playersWithoutCards = Object.entries(gameState.players)
        .filter(([_, player]) => player.cards.length === 0);
      
      if (playersWithoutCards.length > 0) {
        gameState.winner = playersWithoutCards[0][0];
        return true;
      }
    }
    return false;
  }
}