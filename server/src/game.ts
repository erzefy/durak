import { Card, GameState } from './interfaces';

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

  initializeGame(playerIds: string[]): GameState {
    const deck = this.createDeck();
    const trump = deck.pop()!;
    const players: GameState['players'] = {};

    playerIds.forEach((id, index) => {
      players[id] = {
        cards: deck.splice(0, 6),
        isAttacker: index === 0
      };
    });

    return {
      deck,
      trump,
      players,
      table: {
        attacking: [],
        defending: []
      },
      currentTurn: playerIds[0]
    };
  }

  canDefend(attackingCard: Card, defendingCard: Card, trump: Card): boolean {
    if (defendingCard.suit === trump.suit && attackingCard.suit !== trump.suit) {
      return true;
    }
    return defendingCard.suit === attackingCard.suit && defendingCard.value > attackingCard
    .value;
  }
}