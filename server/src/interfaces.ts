export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
  value: number;
}

export interface GameState {
  deck: Card[];
  trump: Card;
  players: {
    [key: string]: {
      cards: Card[];
      isAttacker: boolean;
    }
  };
  table: {
    attacking: Card[];
    defending: Card[];
  };
  currentTurn: string;
}