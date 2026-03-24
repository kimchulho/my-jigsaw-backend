export const TAB_SIZE_RATIO = 0.2;

// Deterministic hash function to generate random edge directions
function getHash(x: number, y: number, isHorizontal: boolean): number {
  // Classic GLSL pseudo-random function for excellent grid noise
  const seed = x * 12.9898 + y * 78.233 + (isHorizontal ? 43.21 : 12.34);
  const rand = Math.sin(seed) * 43758.5453123;
  return (rand - Math.floor(rand)) >= 0.5 ? 1 : -1;
}

export function getEdgeType(col: number, row: number, edge: number, gridCols: number, gridRows: number) {
  if (edge === 0 && row === 0) return 0;
  if (edge === 2 && row === gridRows - 1) return 0;
  if (edge === 3 && col === 0) return 0;
  if (edge === 1 && col === gridCols - 1) return 0;

  switch (edge) {
    case 0: // Top edge -> horizontal edge at (col, row)
      return getHash(col, row, true) === 1 ? -1 : 1;
    case 1: // Right edge -> vertical edge at (col+1, row)
      return getHash(col + 1, row, false) === 1 ? 1 : -1;
    case 2: // Bottom edge -> horizontal edge at (col, row+1)
      return getHash(col, row + 1, true) === 1 ? 1 : -1;
    case 3: // Left edge -> vertical edge at (col, row)
      return getHash(col, row, false) === 1 ? -1 : 1;
    default: 
      return 0;
  }
}

function generateEdgePath(x1: number, y1: number, x2: number, y2: number, tabType: number, tabDepth: number) {
  if (tabType === 0) {
    return `L ${x2},${y2}`;
  }
  
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.sqrt(dx * dx + dy * dy);
  const nx = dy / L;
  const ny = -dx / L;
  
  const p = (t: number, d: number) => {
    // d is originally up to 0.2. We scale it so the max depth is exactly tabDepth.
    const px = x1 + t * dx + tabType * (d / 0.2) * tabDepth * nx;
    const py = y1 + t * dy + tabType * (d / 0.2) * tabDepth * ny;
    return `${px},${py}`;
  };

  const c1 = `C ${p(0.2, 0)} ${p(0.35, 0)} ${p(0.35, 0.05)}`;
  const c2 = `C ${p(0.35, 0.15)} ${p(0.25, 0.2)} ${p(0.5, 0.2)}`;
  const c3 = `C ${p(0.75, 0.2)} ${p(0.65, 0.15)} ${p(0.65, 0.05)}`;
  const c4 = `C ${p(0.65, 0)} ${p(0.8, 0)} ${p(1, 0)}`;

  return `${c1} ${c2} ${c3} ${c4}`;
}

export function getPiecePath(col: number, row: number, gridCols: number, gridRows: number, pieceWidth: number, pieceHeight: number) {
  const baseSize = Math.min(pieceWidth, pieceHeight);
  const tabDepth = baseSize * TAB_SIZE_RATIO;
  const startX = tabDepth;
  const startY = tabDepth;
  
  const topTab = getEdgeType(col, row, 0, gridCols, gridRows);
  const rightTab = getEdgeType(col, row, 1, gridCols, gridRows);
  const bottomTab = getEdgeType(col, row, 2, gridCols, gridRows);
  const leftTab = getEdgeType(col, row, 3, gridCols, gridRows);
  
  let path = `M ${startX},${startY} `;
  path += generateEdgePath(startX, startY, startX + pieceWidth, startY, topTab, tabDepth);
  path += generateEdgePath(startX + pieceWidth, startY, startX + pieceWidth, startY + pieceHeight, rightTab, tabDepth);
  path += generateEdgePath(startX + pieceWidth, startY + pieceHeight, startX, startY + pieceHeight, bottomTab, tabDepth);
  path += generateEdgePath(startX, startY + pieceHeight, startX, startY, leftTab, tabDepth);
  path += ' Z';
  
  return path;
}
