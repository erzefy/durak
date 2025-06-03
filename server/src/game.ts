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

  private findLowestTrump(cards: Card[], trumpSuit: Card['suit']): Card | null {
    const trumpCards = cards.filter(card => card.suit === trumpSuit);
    return trumpCards.length > 0 ? 
      trumpCards.reduce((lowest, card) => card.value < lowest.value ? card : lowest) : 
      null;
  }

  initializeGame(playerIds: string[], lobbyId: string, playerInfos: PlayerState[]): GameState {
    const deck = this.createDeck();
    const trump = deck.pop()!;
    deck.unshift(trump); // Кладём козырь под низ колоды
    const players: GameState['players'] = {};
    
    // Раздаём каждому игроку по 6 карт
    playerIds.forEach((id, index) => {
      const playerInfo = playerInfos.find(p => p.id === id);
      players[id] = {
        name: playerInfo?.name || `Player ${index + 1}`,
        cards: deck.splice(deck.length - 6, 6),
        isAttacker: false,
        hasPickedUpCards: false
      };
    });

    // Определяем первого игрока (у кого младший козырь)
    let firstPlayerId = playerIds[0];
    let lowestTrumpValue = Infinity;

    playerIds.forEach(id => {
      const lowestTrump = this.findLowestTrump(players[id].cards, trump.suit);
      if (lowestTrump && lowestTrump.value < lowestTrumpValue) {
        lowestTrumpValue = lowestTrump.value;
        firstPlayerId = id;
      }
    });

    // Устанавливаем порядок ходов, начиная с игрока с младшим козырем
    const startIndex = playerIds.indexOf(firstPlayerId);
    const turnOrder = [
      ...playerIds.slice(startIndex),
      ...playerIds.slice(0, startIndex)
    ];

    players[firstPlayerId].isAttacker = true;

    return {
      lobbyId,
      deck,
      trump,
      players,
      table: {
        attacking: [],
        defending: []
      },
      currentTurn: firstPlayerId,
      nextDefender: turnOrder[1],
      status: 'playing',
      maxPlayers: playerIds.length,
      currentPlayers: playerIds.length,
      canTakeCards: false,
      turnOrder,
      passedPlayers: [],
      roundEnded: false,
      firstMove: true
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

  private canAddCard(gameState: GameState): boolean {
    // Нельзя подкидывать больше 6 карт
    if (gameState.table.attacking.length >= 6) {
      return false;
    }

    // Нельзя подкидывать больше, чем карт у защищающегося
    const defender = gameState.players[gameState.nextDefender];
    return defender.cards.length >= gameState.table.attacking.length + 1;
  }

  private isValidCardToAdd(gameState: GameState, card: Card, playerId: string): boolean {
    // Первый ход - можно класть любую карту, кроме козыря если есть другие
    if (gameState.table.attacking.length === 0) {
      const player = gameState.players[playerId];
      const hasNonTrumpCards = player.cards.some(c => c.suit !== gameState.trump.suit);
      if (hasNonTrumpCards && card.suit === gameState.trump.suit) {
        return false;
      }
      return true;
    }

    // Подкидывать можно только карты того же достоинства
    const validRanks = new Set([
      ...gameState.table.attacking.map(c => c.rank),
      ...gameState.table.defending.filter(c => c !== null).map(c => c.rank)
    ]);

    return validRanks.has(card.rank);
  }

  private canDefend(attackingCard: Card, defendingCard: Card, gameState: GameState): boolean {
    // Козырем можно бить любую карту не козырной масти
    if (defendingCard.suit === gameState.trump.suit && attackingCard.suit !== gameState.trump.suit) {
      return true;
    }

    // Козырь можно бить только старшим козырем
    if (attackingCard.suit === gameState.trump.suit) {
      return defendingCard.suit === gameState.trump.suit && defendingCard.value > attackingCard.value;
    }

    // Обычную карту можно бить только старшей картой той же масти
    return defendingCard.suit === attackingCard.suit && defendingCard.value > attackingCard.value;
  }

  public handleTakeCards(gameState: GameState, playerId: string): void {
    if (!gameState.canTakeCards || gameState.nextDefender !== playerId) return;

    const defender = gameState.players[playerId];
    
    // Забираем все карты со стола
    const allTableCards = [...gameState.table.attacking, ...gameState.table.defending.filter(c => c !== null)];
    defender.cards.push(...allTableCards);
    
    // Очищаем стол
    gameState.table.attacking = [];
    gameState.table.defending = [];
    
    // Отмечаем, что игрок взял карты
    defender.hasPickedUpCards = true;
    gameState.canTakeCards = false;
    
    // Добираем карты всем игрокам
    this.dealCards(gameState);
    
    // Ход переходит к следующему после взявшего
    const currentIndex = gameState.turnOrder.indexOf(playerId);
    const nextIndex = (currentIndex + 1) % gameState.turnOrder.length;
    gameState.currentTurn = gameState.turnOrder[nextIndex];
    gameState.nextDefender = gameState.turnOrder[(nextIndex + 1) % gameState.turnOrder.length];
    
    // Сбрасываем флаги раунда
    gameState.passedPlayers = [];
    gameState.roundEnded = true;

    // Обновляем статусы атакующих
    Object.values(gameState.players).forEach(player => {
      player.isAttacker = false;
    });
    gameState.players[gameState.currentTurn].isAttacker = true;
  }

  public makeMove(gameState: GameState, playerId: string, card: Card, isDefending: boolean): boolean {
    const player = gameState.players[playerId];
    
    if (!player) return false;

    // Проверяем, может ли игрок ходить
    if (isDefending) {
      if (playerId !== gameState.nextDefender) return false;
    } else {
      if (playerId !== gameState.currentTurn && !player.isAttacker) return false;
      if (player.hasPickedUpCards) return false;  // Нельзя подкидывать, если взял карты
    }

    if (isDefending) {
      return this.defendCard(gameState, playerId, card);
    } else {
      return this.attackCard(gameState, playerId, card);
    }
  }

  private attackCard(gameState: GameState, playerId: string, card: Card): boolean {
    const player = gameState.players[playerId];
    
    // Проверяем базовые условия
    if (!this.hasCard(player.cards, card)) return false;
    if (!this.canAddCard(gameState)) return false;
    if (!this.isValidCardToAdd(gameState, card, playerId)) return false;

    // Добавляем карту на стол
    gameState.table.attacking.push(card);
    player.cards = player.cards.filter(c => 
      !(c.suit === card.suit && c.rank === card.rank)
    );

    // Даем возможность взять карты защищающемуся
    gameState.canTakeCards = true;

    // Если это первая карта в атаке, все кроме защищающегося могут подкидывать
    if (gameState.table.attacking.length === 1) {
      Object.entries(gameState.players).forEach(([id, p]) => {
        p.isAttacker = id !== gameState.nextDefender;
      });
    }

    return true;
  }

  private defendCard(gameState: GameState, playerId: string, card: Card): boolean {
    const player = gameState.players[playerId];
    
    // Проверяем, есть ли атакующая карта
    const lastAttackingCard = gameState.table.attacking[
      gameState.table.defending.length
    ];
    if (!lastAttackingCard) return false;

    // Проверяем, может ли карта побить атакующую
    if (!this.canDefend(lastAttackingCard, card, gameState)) return false;

    // Добавляем карту в защиту
    gameState.table.defending.push(card);
    player.cards = player.cards.filter(c => 
      !(c.suit === card.suit && c.rank === card.rank)
    );

    // Если все карты отбиты
    if (gameState.table.defending.length === gameState.table.attacking.length) {
      gameState.canTakeCards = false;
    }

    return true;
  }

  public endTurn(gameState: GameState): void {
    // Проверяем окончание игры
    if (this.checkGameEnd(gameState)) {
      return;
    }

    // Сбрасываем флаг взятия карт для всех игроков
    Object.values(gameState.players).forEach(player => {
      player.hasPickedUpCards = false;
    });

    // Раздаем карты
    this.dealCards(gameState);

    // Очищаем стол
    gameState.table.attacking = [];
    gameState.table.defending = [];

    // Сбрасываем список пропустивших ход
    gameState.passedPlayers = [];

    // Определяем следующего атакующего и защищающегося
    // Если защищающийся отбился, он становится следующим атакующим
    if (!gameState.roundEnded && gameState.table.defending.length === gameState.table.attacking.length) {
      const prevDefender = gameState.nextDefender;
      const defenderIndex = gameState.turnOrder.indexOf(prevDefender);
      gameState.currentTurn = prevDefender;
      gameState.nextDefender = gameState.turnOrder[(defenderIndex + 1) % gameState.turnOrder.length];
    } else {
      // Если защищающийся взял карты или пропустил ход
      const currentIndex = gameState.turnOrder.indexOf(gameState.currentTurn);
      gameState.currentTurn = gameState.turnOrder[(currentIndex + 1) % gameState.turnOrder.length];
      gameState.nextDefender = gameState.turnOrder[(currentIndex + 2) % gameState.turnOrder.length];
    }

    // Обновляем статусы атакующих
    Object.values(gameState.players).forEach(player => {
      player.isAttacker = false;
    });
    gameState.players[gameState.currentTurn].isAttacker = true;

    gameState.canTakeCards = false;
    gameState.roundEnded = false;
    gameState.firstMove = false;
  }

  private dealCards(gameState: GameState): void {
    // Добор карт начинается с атакующего
    const startIndex = gameState.turnOrder.indexOf(gameState.currentTurn);
    const dealOrder = [
      ...gameState.turnOrder.slice(startIndex),
      ...gameState.turnOrder.slice(0, startIndex)
    ];

    // Защищающийся всегда берет последним
    const defenderIndex = dealOrder.indexOf(gameState.nextDefender);
    if (defenderIndex !== -1) {
      dealOrder.push(dealOrder.splice(defenderIndex, 1)[0]);
    }

    // Раздаем карты всем игрокам до 6
    dealOrder.forEach(playerId => {
      const player = gameState.players[playerId];
      while (player.cards.length < 6 && gameState.deck.length > 0) {
        player.cards.push(gameState.deck.pop()!);
      }
    });
  }

  private checkGameEnd(gameState: GameState): boolean {
    // Проверяем, есть ли игроки без карт
    if (gameState.deck.length === 0) {
      const playersWithoutCards = Object.entries(gameState.players)
        .filter(([_, player]) => player.cards.length === 0);
      
      // Если есть игроки без карт, они выбывают из игры
      playersWithoutCards.forEach(([id, _]) => {
        const index = gameState.turnOrder.indexOf(id);
        if (index !== -1) {
          gameState.turnOrder.splice(index, 1);
        }
      });

      // Если остался только один игрок с картами - он проиграл
      const playersWithCards = Object.keys(gameState.players)
        .filter(id => gameState.players[id].cards.length > 0);

      if (playersWithCards.length === 1) {
        gameState.status = 'finished';
        // Находим предыдущего игрока в порядке ходов - он победитель
        const loser = playersWithCards[0];
        const loserIndex = gameState.turnOrder.indexOf(loser);
        const winnerIndex = (loserIndex + 1) % gameState.turnOrder.length;
        gameState.winner = gameState.turnOrder[winnerIndex];
        return true;
      }
    }

    return false;
  }

  private hasCard(cards: Card[], card: Card): boolean {
    return cards.some(c => c.suit === card.suit && c.rank === card.rank);
  }

  public handlePlayerDisconnect(gameState: GameState, playerId: string): void {
    // Если отключившийся игрок ходил, передаем ход следующему
    if (gameState.currentTurn === playerId) {
      const currentIndex = gameState.turnOrder.indexOf(playerId);
      const nextIndex = (currentIndex + 1) % gameState.turnOrder.length;
      gameState.currentTurn = gameState.turnOrder[nextIndex];
    }

    // Если отключившийся игрок защищался
    if (gameState.nextDefender === playerId) {
      const currentDefenderIndex = gameState.turnOrder.indexOf(playerId);
      gameState.nextDefender = gameState.turnOrder[(currentDefenderIndex + 1) % gameState.turnOrder.length];
    }

    // Удаляем игрока из порядка ходов и из игры
    gameState.turnOrder = gameState.turnOrder.filter(id => id !== playerId);
    delete gameState.players[playerId];
    
    // Обновляем количество игроков
    gameState.currentPlayers--;
    
    // Если осталось меньше 2 игроков, игра заканчивается
    if (gameState.currentPlayers < 2) {
      gameState.status = 'finished';
      if (gameState.currentPlayers === 1) {
        // Последний оставшийся игрок побеждает
        gameState.winner = Object.keys(gameState.players)[0];
      }
    }

    // Сбрасываем список пропустивших ход
    gameState.passedPlayers = gameState.passedPlayers.filter(id => id !== playerId);
  }
}