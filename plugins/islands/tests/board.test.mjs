import test from "node:test";
import assert from "node:assert/strict";
import { buildBoard, canPlace, RADIUS } from "../web/board.mjs";

test("the seven-hex sample has shared vertices and edges without cracks", () => {
  const board = buildBoard();
  assert.equal(board.tiles.length, 7);
  assert.equal(board.vertices.size, 24);
  assert.equal(board.edges.size, 30);
  assert.equal(
    [...board.edges.values()].filter((edge) => edge.tiles.length === 1).length,
    18,
  );
  assert.equal(
    [...board.edges.values()].filter((edge) => edge.tiles.length === 2).length,
    12,
  );
  for (const edge of board.edges.values()) {
    const a = board.vertices.get(edge.a),
      b = board.vertices.get(edge.b);
    assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - RADIUS) < 0.002);
    assert.ok(
      edge.tiles.every((id) => board.tiles[id].edges.includes(edge.id)),
    );
  }
  assert.ok(
    [...board.vertices.values()].every((vertex) => vertex.tiles.length <= 3),
  );
});

test("visual placement rejects unknown targets and occupied building or road slots", () => {
  const board = buildBoard();
  const vertex = board.tiles[0].vertices[0],
    edge = board.tiles[0].edges[0];
  const placed = [
    { kind: "settlement", targetId: vertex },
    { kind: "road", targetId: edge },
  ];
  assert.equal(canPlace("city", vertex, placed, board), false);
  assert.equal(canPlace("settlement", vertex, placed, board), false);
  assert.equal(canPlace("road", edge, placed, board), false);
  assert.equal(canPlace("city", edge, [], board), false);
  assert.equal(canPlace("road", vertex, [], board), false);
  assert.equal(canPlace("unknown", vertex, [], board), false);
  assert.equal(canPlace("city", "missing", [], board), false);
  assert.equal(
    canPlace("city", board.tiles[0].vertices[1], placed, board),
    true,
  );
  assert.equal(canPlace("road", board.tiles[0].edges[1], placed, board), true);
});
