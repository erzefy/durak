export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
  value: number;
}

export interface PlayerState {
  id: string;
  name: string;
  cards: Card[];
  isAttacker: boolean;
  isReady: boolean;
}

export interface LobbyState {
  id: string;
  name: string;
  hostId: string;
  players: PlayerState[];
  maxPlayers: number;
  status: 'waiting' | 'starting' | 'playing' | 'finished';
}

export interface GameState {
  lobbyId: string;
  deck: Card[];
  trump: Card;
  players: {
    [key: string]: {
      name: string;
      cards: Card[];
      isAttacker: boolean;
    }
  };
  table: {
    attacking: Card[];
    defending: Card[];
  };
  currentTurn: string;
  status: 'waiting' | 'playing' | 'finished' | 'taking_cards';
  winner?: string;
  maxPlayers: number;
  currentPlayers: number;
  nextDefender?: string;
  canTakeCards: boolean;
  turnOrder: string[]; // Порядок ходов игроков
  passedPlayers: string[]; // Игроки, которые пропустили ход
}