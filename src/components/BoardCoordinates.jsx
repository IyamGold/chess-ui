export default function BoardCoordinates({ x, y, orientation = 'white' }) {
  const black = orientation === 'black';
  return (
    <>
      {y === (black ? 0 : 7) && (
        <span className="board-coordinate file" aria-hidden="true">
          {'abcdefgh'[x]}
        </span>
      )}
      {x === (black ? 7 : 0) && (
        <span className="board-coordinate rank" aria-hidden="true">
          {8 - y}
        </span>
      )}
    </>
  );
}
