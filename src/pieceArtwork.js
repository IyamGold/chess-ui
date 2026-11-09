// One mapping for the board, promotion choices and colour selector.
// Existing numeric piece values and rules stay unchanged.
const names = {
  1: 'King',
  2: 'Pawn',
  3: 'Knight',
  4: 'Rook',
  5: 'Bishop',
  6: 'Queen',
};
export function pieceArtwork(type) {
  const name = names[Math.abs(type)];
  if (!name) return null;
  const color = type > 0 ? 'White' : 'Black';
  return {
    src: `/pieces/${color.toLowerCase()}-${name.toLowerCase()}.png`,
    alt: `${color} ${name}`,
  };
}
