import './Piece.css';
import { pieceArtwork } from './pieceArtwork';

export default function Piece({ type }) {
  const art = pieceArtwork(type);
  if (!art) return null;
  return (
    <div className="chess-piece" draggable={false}>
      <img {...art} draggable={false} className="piece-svg piece-art" />
    </div>
  );
}
