import { useWriteContract, useAccount } from 'wagmi';
import { CHESS_LEDGER_ADDRESS, chessLedgerAbi } from '../contracts/chessLedgerAbi';

export function formatMoves(moveHistory) {
  const parts = [];
  for (let i = 0; i < moveHistory.length; i += 2) {
    const num = Math.floor(i / 2) + 1;
    const white = moveHistory[i];
    const black = moveHistory[i + 1];
    parts.push(black ? `${num}. ${white} ${black}` : `${num}. ${white}`);
  }
  return parts.join(' ');
}

export function usePublishGame() {
  const { isConnected } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();

  const publishGame = async (game) => {
    if (!isConnected) {
      return { published: false, reason: 'wallet-not-connected' };
    }

    if (!CHESS_LEDGER_ADDRESS) {
      console.warn('Chess ledger contract address not configured');
      return { published: false, reason: 'no-contract-address' };
    }

    try {
      const movesString = formatMoves(game.moveHistory || []);
      const hash = await writeContractAsync({
        address: CHESS_LEDGER_ADDRESS,
        abi: chessLedgerAbi,
        functionName: 'publishGame',
        args: [game.id, game.result, movesString, game.engineColor],
      });
      return { published: true, txHash: hash };
    } catch (err) {
      console.error('Failed to publish game on-chain:', err);
      return { published: false, reason: 'tx-failed', error: err };
    }
  };

  return { publishGame, isPending };
}
