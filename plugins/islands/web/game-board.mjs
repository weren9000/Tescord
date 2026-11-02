const NS = "http://www.w3.org/2000/svg";
const COLORS = {
  amethyst: "#ac84ed",
  cyan: "#53cfdd",
  coral: "#ed8d78",
  gold: "#eabe60",
};
const LANDS = {
  forest: "Лес",
  hills: "Холмы",
  pasture: "Пастбище",
  fields: "Поля",
  mountains: "Горы",
  desert: "Пустыня",
};
const PORTS = {
  wood: "Древесина",
  brick: "Кирпич",
  wool: "Шерсть",
  grain: "Зерно",
  ore: "Руда",
  any: "Любой",
};
export function pieceAsset(kind, color) {
  return `piece-${kind}${color === "amethyst" ? "" : "-" + color}`;
}
export function terrainAsset(tiles, tile) {
  const index =
    tiles
      .filter((item) => item.terrain === tile.terrain)
      .findIndex((item) => item.id === tile.id) + 1;
  return `terrain-${tile.terrain}${index > 1 ? "-" + index : ""}`;
}
const point = (p) => ({ x: 350 + p.x * 64, y: 320 + p.y * 64 });
function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}
function activate(node, label, action) {
  node.setAttribute("role", "button");
  node.setAttribute("tabindex", "0");
  node.setAttribute("aria-label", label);
  node.addEventListener("click", action);
  node.addEventListener("keydown", (event) => {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      action();
    }
  });
}

export function renderBoard(state, mode, choose, describe, viewport) {
  const board = svg("svg", {
    id: "board",
    viewBox: "0 0 700 640",
    tabindex: "0",
    "aria-label":
      "Игровое поле. Стрелки перемещают поле, плюс и минус меняют масштаб.",
  });
  const defs = svg("defs");
  const scene = svg("g");
  board.append(defs, scene);
  const transform = () =>
    scene.setAttribute(
      "transform",
      `translate(${viewport.x} ${viewport.y}) translate(350 320) scale(${viewport.zoom}) translate(-350 -320)`,
    );
  transform();
  const player = (uid) => state.players.find((p) => p.id === uid);
  for (const tile of state.board.tiles) {
    const center = point(tile);
    const points = tile.vertices
      .map((id) => point(state.board.vertices[id]))
      .map((p) => `${p.x},${p.y}`)
      .join(" ");
    const clip = svg("clipPath", { id: "tile-" + tile.id });
    clip.append(svg("polygon", { points }));
    defs.append(clip);
    scene.append(
      svg("image", {
        href: `assets/${terrainAsset(state.board.tiles, tile)}.webp`,
        x: center.x - 65,
        y: center.y - 65,
        width: 130,
        height: 130,
        preserveAspectRatio: "xMidYMid slice",
        "clip-path": `url(#tile-${tile.id})`,
      }),
    );
    scene.append(svg("polygon", { points, class: "tile-outline" }));
    if (tile.number) {
      scene.append(
        svg("circle", { cx: center.x, cy: center.y, r: 18, class: "number" }),
      );
      scene.append(
        svg(
          "text",
          {
            x: center.x,
            y: center.y - 2,
            class:
              "number-label" + ([6, 8].includes(tile.number) ? " red" : ""),
          },
          tile.number,
        ),
      );
      const pips = 6 - Math.abs(7 - tile.number);
      for (let i = 0; i < pips; i++)
        scene.append(
          svg("circle", {
            cx: center.x + (i - (pips - 1) / 2) * 4,
            cy: center.y + 10,
            r: 1.1,
            class: "pip",
          }),
        );
    }
    if (tile.id === state.robber) {
      scene.append(
        svg("circle", {
          cx: center.x + 25,
          cy: center.y - 20,
          r: 14,
          fill: "#282333",
          stroke: "#e0c48b",
        }),
      );
      scene.append(
        svg("image", {
          href: "assets/piece-robber.webp",
          x: center.x + 7,
          y: center.y - 50,
          width: 36,
          height: 44,
        }),
      );
    }
    const allowed = state.actions.robber_tiles.includes(tile.id);
    const hit = svg("polygon", {
      points,
      class: "tile-hit" + (allowed ? " available" : ""),
    });
    activate(
      hit,
      `${LANDS[tile.terrain]}, ${tile.number || "без номера"}${tile.id === state.robber ? ", разбойник" : ""}${allowed ? ", переместить разбойника" : ""}`,
      () =>
        allowed
          ? choose(
              { type: "move_robber", tile: tile.id },
              "Переместить разбойника",
            )
          : describe(tile),
    );
    scene.append(hit);
  }
  const usedPorts = new Set();
  for (const vertex of Object.values(state.board.vertices)) {
    if (!vertex.port || usedPorts.has(vertex.id)) continue;
    const other = vertex.edges
      .map((id) => state.board.edges[id])
      .filter((edge) => edge.tiles.length === 1)
      .map(
        (edge) => state.board.vertices[edge.a === vertex.id ? edge.b : edge.a],
      )
      .find((v) => v.port === vertex.port && !usedPorts.has(v.id));
    if (!other) continue;
    usedPorts.add(vertex.id);
    usedPorts.add(other.id);
    const a = point(vertex),
      b = point(other),
      x = (a.x + b.x) / 2,
      y = (a.y + b.y) / 2;
    const length = Math.hypot(x - 350, y - 320),
      px = x + ((x - 350) / length) * 30,
      py = y + ((y - 320) / length) * 30;
    scene.append(
      svg("line", {
        x1: a.x,
        y1: a.y,
        x2: px,
        y2: py,
        stroke: "#d7b679",
        "stroke-width": 2,
      }),
    );
    scene.append(
      svg("line", {
        x1: b.x,
        y1: b.y,
        x2: px,
        y2: py,
        stroke: "#d7b679",
        "stroke-width": 2,
      }),
    );
    scene.append(
      svg("image", {
        href: "assets/piece-port.webp",
        x: px - 15,
        y: py - 15,
        width: 30,
        height: 30,
      }),
    );
    const portLabel = svg(
      "text",
      { x: px, y: py + 22, class: "port-label" },
      (vertex.port === "any" ? "3:1 " : "2:1 ") + PORTS[vertex.port],
    );
    const portHit = svg("g");
    portHit.append(
      svg("rect", {
        x: px - 23,
        y: py - 18,
        width: 46,
        height: 46,
        fill: "transparent",
      }),
      portLabel,
    );
    activate(
      portHit,
      "Порт: " +
        PORTS[vertex.port] +
        (vertex.port === "any" ? " 3 к 1" : " 2 к 1"),
      () => describe({ port: vertex.port }),
    );
    scene.append(portHit);
  }
  for (const [id, uid] of Object.entries(state.roads)) {
    const edge = state.board.edges[id],
      a = point(state.board.vertices[edge.a]),
      b = point(state.board.vertices[edge.b]);
    const group = svg("g");
    group.append(svg("title", {}, `Дорога · ${player(uid).nick}`));
    group.append(
      svg("line", {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke: COLORS[player(uid).color],
        class: "road-base",
      }),
    );
    group.append(
      svg("image", {
        href: `assets/${pieceAsset("road", player(uid).color)}.webp`,
        x: (a.x + b.x) / 2 - 27,
        y: (a.y + b.y) / 2 - 7,
        width: 54,
        height: 14,
        transform: `rotate(${(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI} ${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`,
      }),
    );
    scene.append(group);
  }
  for (const [id, building] of Object.entries(state.buildings)) {
    const p = point(state.board.vertices[id]),
      size = building.kind === "city" ? 45 : 35;
    const group = svg("g");
    group.append(
      svg(
        "title",
        {},
        `${building.kind === "city" ? "Город" : "Поселение"} · ${player(building.owner).nick}`,
      ),
    );
    group.append(
      svg("ellipse", {
        cx: p.x,
        cy: p.y + 7,
        rx: size * 0.4,
        ry: 7,
        fill: COLORS[player(building.owner).color],
        stroke: "#fff",
        "stroke-width": 1.5,
      }),
    );
    group.append(
      svg("image", {
        href: `assets/${pieceAsset(building.kind, player(building.owner).color)}.webp`,
        x: p.x - size / 2,
        y: p.y - size + 9,
        width: size,
        height: size,
      }),
    );
    scene.append(group);
  }
  const action =
    state.phase === "setup_settlement"
      ? "settlement"
      : ["setup_road", "free_roads"].includes(state.phase)
        ? "road"
        : mode;
  const targets =
    state.actions[
      { road: "roads", settlement: "settlements", city: "cities" }[action]
    ] || [];
  for (const id of targets) {
    let p;
    if (action === "road") {
      const edge = state.board.edges[id],
        a = point(state.board.vertices[edge.a]),
        b = point(state.board.vertices[edge.b]);
      p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else p = point(state.board.vertices[id]);
    const target = svg("circle", {
      cx: p.x,
      cy: p.y,
      r: 13,
      class: "target",
      "data-target": id,
    });
    const label = { road: "Дорога", settlement: "Поселение", city: "Город" }[
      action
    ];
    const port = action === "road" ? null : state.board.vertices[id].port;
    const description =
      `${label}, место ${Number(id) + 1}` +
      (action === "road"
        ? ""
        : port
          ? ` · Порт: ${PORTS[port]} ${port === "any" ? "3:1" : "2:1"}`
          : " · Без порта");
    activate(target, description, () => {
      const command =
        state.phase === "setup_settlement"
          ? { type: "setup_settlement", vertex: id }
          : state.phase === "setup_road"
            ? { type: "setup_road", edge: id }
            : { type: "build", kind: action, target: id };
      choose(command, description);
    });
    scene.append(target);
  }
  let drag = null;
  board.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: viewport.x,
      y: viewport.y,
      moved: false,
    };
  });
  board.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.startX,
      dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 6) {
      drag.moved = true;
      board.setPointerCapture(event.pointerId);
    }
    if (drag.moved) {
      const scale = 700 / board.getBoundingClientRect().width;
      viewport.x = Math.max(-600, Math.min(600, drag.x + dx * scale));
      viewport.y = Math.max(-600, Math.min(600, drag.y + dy * scale));
      transform();
    }
  });
  let suppress = false;
  board.addEventListener("pointerup", () => {
    suppress = !!drag?.moved;
    drag = null;
  });
  board.addEventListener("pointercancel", () => {
    drag = null;
  });
  board.addEventListener(
    "click",
    (event) => {
      if (suppress) {
        suppress = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
  board.addEventListener("keydown", (event) => {
    if (event.target !== board) return;
    const delta = {
      ArrowLeft: [30, 0],
      ArrowRight: [-30, 0],
      ArrowUp: [0, 30],
      ArrowDown: [0, -30],
    }[event.key];
    if (delta) {
      event.preventDefault();
      viewport.x += delta[0];
      viewport.y += delta[1];
      transform();
    }
  });
  return board;
}
