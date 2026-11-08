import './Piece.css';

function Piece({ type }) {
  const pieceType = Math.abs(type);
  const isWhite = type > 0;

  const renderPiece = () => {
    switch (pieceType) {
      case 1: // King
        if (isWhite) {
          return (
            <img draggable={false} src="/whiteking.svg" alt="White King" className="piece-svg" />
          );
        }
        return (
          <img draggable={false} src="/blackking.svg" alt="Black King" className="piece-svg" />
        );

      case 2: // Pawn
        if (isWhite) {
          return (
            <img draggable={false} src="/white-pawn.svg" alt="White Pawn" className="piece-svg" />
          );
        }
        return (
          <img draggable={false} src="/blackpawn.svg" alt="Black Pawn" className="piece-svg" />
        );

      case 3: // Knight
        if (isWhite) {
          return (
            <img
              draggable={false}
              src="/whiteknight.svg"
              alt="White Knight"
              className="piece-svg"
            />
          );
        }
        return (
          <img draggable={false} src="/blackknight.svg" alt="Black Knight" className="piece-svg" />
        );

      case 4: // Rook
        if (isWhite) {
          return (
            <img draggable={false} src="/whiterook.svg" alt="White Rook" className="piece-svg" />
          );
        }
        return <img draggable={false} src="/rook.svg" alt="Black Rook" className="piece-svg" />;

      case 5: // Bishop
        if (isWhite) {
          return (
            <img
              draggable={false}
              src="/white bishop.svg"
              alt="White Bishop"
              className="piece-svg"
            />
          );
        }
        return (
          <img draggable={false} src="/black bishop.svg" alt="Black Bishop" className="piece-svg" />
        );

      case 6: // Queen
        if (isWhite) {
          return (
            <img draggable={false} src="/whitequeen.svg" alt="White Queen" className="piece-svg" />
          );
        }
        return (
          <img draggable={false} src="/blackqueen.svg" alt="Black Queen" className="piece-svg" />
        );

      default:
        return null;
    }
  };

  return (
    <div className="chess-piece" draggable={false}>
      {renderPiece()}
    </div>
  );
}

export default Piece;
