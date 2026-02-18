export const CHESS_LEDGER_ADDRESS = import.meta.env.VITE_CHESS_LEDGER_ADDRESS;

export const chessLedgerAbi = [
  {
    name: 'publishGame',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'gameId', type: 'string' },
      { name: 'result', type: 'string' },
      { name: 'moves', type: 'string' },
      { name: 'engineColor', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'GamePublished',
    type: 'event',
    inputs: [
      { name: 'index', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'gameId', type: 'string', indexed: false },
      { name: 'result', type: 'string', indexed: false },
    ],
  },
  {
    name: 'getGameCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
];
