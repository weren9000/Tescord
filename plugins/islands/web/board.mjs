export const RADIUS = 120;
export const CENTER = { x: 450, y: 340 };
export const SAMPLE_TILES = [
  { q: 0, r: 0, terrain: "forest", number: 8 },
  { q: 0, r: -1, terrain: "pasture", number: 3 },
  { q: 1, r: -1, terrain: "mountains", number: 10 },
  { q: 1, r: 0, terrain: "pasture", number: 5 },
  { q: 0, r: 1, terrain: "forest", number: 9 },
  { q: -1, r: 1, terrain: "pasture", number: 6 },
  { q: -1, r: 0, terrain: "mountains", number: 4 },
];
const round = (n) => Math.round(n * 1000) / 1000;
export function buildBoard(spec = SAMPLE_TILES) {
  const vertices = new Map(),
    edges = new Map();
  const tiles = spec.map((tile, index) => {
    const x = CENTER.x + Math.sqrt(3) * RADIUS * (tile.q + tile.r / 2),
      y = CENTER.y + 1.5 * RADIUS * tile.r;
    const corners = Array.from({ length: 6 }, (_, i) => {
      const angle = ((i * 60 - 90) * Math.PI) / 180;
      const point = {
        x: round(x + RADIUS * Math.cos(angle)),
        y: round(y + RADIUS * Math.sin(angle)),
      };
      const id = `${point.x},${point.y}`;
      if (!vertices.has(id)) vertices.set(id, { id, ...point, tiles: [] });
      vertices.get(id).tiles.push(index);
      return id;
    });
    const tileEdges = corners.map((a, i) => {
      const b = corners[(i + 1) % 6],
        id = [a, b].sort().join("|");
      if (!edges.has(id)) edges.set(id, { id, a, b, tiles: [] });
      edges.get(id).tiles.push(index);
      return id;
    });
    return { ...tile, id: index, x, y, vertices: corners, edges: tileEdges };
  });
  return { tiles, vertices, edges };
}

// Only visual placement. Game-rule legality will be supplied by the future server.
export function canPlace(kind, targetId, placements, board) {
  if (!["road", "settlement", "city"].includes(kind)) return false;
  const targets = kind === "road" ? board.edges : board.vertices;
  if (!targets.has(targetId)) return false;
  return !placements.some(
    (p) => (p.kind === "road") === (kind === "road") && p.targetId === targetId,
  );
}
