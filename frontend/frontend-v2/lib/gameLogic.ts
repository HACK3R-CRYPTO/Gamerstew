export const MATCH_STATUS = ['Proposed', 'Accepted', 'Completed', 'Cancelled'];

export const GAME_TYPES = [
  { id: 0, label: 'Rock-Paper-Scissors', icon: '✊', description: 'Classic choice game' },
  { id: 1, label: 'Dice Roll', icon: '🎲', description: 'Predict the roll (1-6)' },
  { id: 3, label: 'Coin Flip', icon: '🪙', description: 'Heads or Tails' },
];

export const MOVES = {
  RPS: [
    { id: 0, icon: '✊', label: 'Rock' },
    { id: 1, icon: '✋', label: 'Paper' },
    { id: 2, icon: '✌️', label: 'Scissors' },
  ],
  DICE: [
    { id: 1, icon: '⚀', label: 'Roll 1' },
    { id: 2, icon: '⚁', label: 'Roll 2' },
    { id: 3, icon: '⚂', label: 'Roll 3' },
    { id: 4, icon: '⚃', label: 'Roll 4' },
    { id: 5, icon: '⚄', label: 'Roll 5' },
    { id: 6, icon: '⚅', label: 'Roll 6' },
  ],
  COIN: [
    { id: 0, icon: '👤', label: 'Heads' },
    { id: 1, icon: '🦅', label: 'Tails' },
  ],
};

export const getMoveDisplay = (gameType: number, moveId: number | null | undefined): { icon: string; label: string } => {
  if (moveId === null || moveId === undefined) return { icon: '❓', label: 'Unknown' };

  if (gameType === 0) {
    const move = MOVES.RPS.find(m => m.id === moveId);
    return move ? { icon: move.icon, label: move.label } : { icon: '❓', label: 'Unknown' };
  } else if (gameType === 1) {
    const diceIcons = ['?', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    return { icon: diceIcons[moveId] || '❓', label: `Roll ${moveId}` };
  } else if (gameType === 3) {
    const move = MOVES.COIN.find(m => m.id === moveId);
    return move ? { icon: move.icon, label: move.label } : { icon: '❓', label: 'Unknown' };
  }
  return { icon: '❓', label: 'Unknown' };
};
