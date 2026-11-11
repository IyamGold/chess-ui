// Every transport uses this ordering rule. An old HTTP response must not undo
// a newer opponent move or a terminal server result.
export function mergeSnapshot(previous, incoming) {
  const oldPly = previous?.moveHistory?.length ?? -1;
  const newPly = incoming.moveHistory?.length;
  if (newPly !== undefined && newPly < oldPly) return previous;
  if (previous?.result && !incoming.result) return previous;
  if (
    newPly === oldPly &&
    previous?.clock?.serverNow > incoming.clock?.serverNow
  )
    return previous;
  return { ...previous, ...incoming };
}

export function previewMove(board, uci) {
  const index = (file, rank) =>
    (8 - Number(rank)) * 8 + 'abcdefgh'.indexOf(file);
  const from = index(uci[0], uci[1]),
    to = index(uci[2], uci[3]);
  const next = [...board],
    piece = next[from],
    type = Math.abs(piece);
  // En passant removes the captured pawn from its original rank.
  if (type === 2 && from % 8 !== to % 8 && !next[to])
    next[to + (piece > 0 ? 8 : -8)] = 0;
  if (type === 1 && Math.abs(to - from) === 2) {
    const rookFrom = to > from ? from + 3 : from - 4;
    const rookTo = to > from ? from + 1 : from - 1;
    next[rookTo] = next[rookFrom];
    next[rookFrom] = 0;
  }
  next[to] = uci[4]
    ? Math.sign(piece) * { q: 6, r: 4, b: 5, n: 3 }[uci[4]]
    : piece;
  next[from] = 0;
  return next;
}
