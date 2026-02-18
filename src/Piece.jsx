import './Piece.css';

function Piece({ type, onDragStart }) {
  const pieceType = Math.abs(type);
  const isWhite = type > 0;
  const fillColor = isWhite ? '#ffffff' : '#000000';
  const strokeColor = isWhite ? '#000000' : '#ffffff';

  const handleDragStart = (e) => {
    if (onDragStart) {
      onDragStart();
    }
  };

  const renderPiece = () => {
    switch (pieceType) {
      case 1: // King
        if (isWhite) {
          return <img src="/whiteking.svg" alt="White King" className="piece-svg" />;
        }
        return <img src="/blackking.svg" alt="Black King" className="piece-svg" />;

      case 2: // Pawn
        if (isWhite) {
          return <img src="/white-pawn.svg" alt="White Pawn" className="piece-svg" />;
        }
        return <img src="/blackpawn.svg" alt="Black Pawn" className="piece-svg" />;

      case 3: // Knight
        if (isWhite) {
          return <img src="/whiteknight.svg" alt="White Knight" className="piece-svg" />;
        }
        return <img src="/blackknight.svg" alt="Black Knight" className="piece-svg" />;

      case 4: // Rook
        if (isWhite) {
          return <img src="/whiterook.svg" alt="White Rook" className="piece-svg" />;
        }
        return <img src="/rook.svg" alt="Black Rook" className="piece-svg" />;

      case 5: // Bishop
        if (isWhite) {
          return <img src="/white bishop.svg" alt="White Bishop" className="piece-svg" />;
        }
        return <img src="/black bishop.svg" alt="Black Bishop" className="piece-svg" />;

      case 6: // Queen
        if (isWhite) {
          return <img src="/whitequeen.svg" alt="White Queen" className="piece-svg" />;
        }
        return <img src="/blackqueen.svg" alt="Black Queen" className="piece-svg" />;

      default:
        return null;
    }
  };

  return (
    <div
      className="chess-piece"
      draggable="true"
      onDragStart={handleDragStart}
    >
      {renderPiece()}
    </div>
  );
}

export default Piece;
