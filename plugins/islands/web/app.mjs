import { buildBoard, canPlace, CENTER, RADIUS } from "./board.mjs";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const ns = "http://www.w3.org/2000/svg";
const board = buildBoard();
const svg = $("#board");
const terrains = {
  forest: {
    title: "Изумрудный лес",
    resource: "Древесина",
    description:
      "Солнечные поляны среди старых деревьев. Здесь начинается дорога к вашему первому поселению.",
    alt: "Сказочный лес с солнечными полянами",
    index: 1,
  },
  mountains: {
    title: "Каменные вершины",
    resource: "Руда",
    description:
      "Тёплый свет касается скал, а в их глубине скрываются рудные жилы — основа будущих городов.",
    alt: "Горные хребты с рудными прожилками",
    index: 2,
  },
  pasture: {
    title: "Солнечные луга",
    resource: "Шерсть",
    description:
      "Стада пасутся среди мягких холмов. Открытая земля даёт простор новым дорогам и поселениям.",
    alt: "Светлое пастбище с небольшими стадами овец",
    index: 3,
  },
};
const pieceNames = { road: "Дорога", settlement: "Поселение", city: "Город" };
const imagePath = (name) => `./assets/${name}.webp`;
let selectedTile = 0,
  selectedTerrain = "forest",
  mode = null,
  pending = null,
  zoom = 1;
let viewCenter = { ...CENTER };
let placements = [
  { kind: "settlement", targetId: board.tiles[0].vertices[4] },
  { kind: "city", targetId: board.tiles[0].vertices[1] },
  { kind: "road", targetId: board.tiles[0].edges[4] },
];
const initialPlacements = placements.map((p) => ({ ...p }));
const history = [];

function node(type, attributes = {}, text) {
  const element = document.createElementNS(ns, type);
  for (const [key, value] of Object.entries(attributes))
    element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}
function activate(element, handler) {
  element.addEventListener("click", (event) => {
    if (!suppressClick) handler(event);
  });
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      handler(event);
    }
  });
}
function renderLand() {
  const layer = $("#land-layer");
  layer.replaceChildren();
  for (const tile of board.tiles) {
    const points = tile.vertices
      .map((id) => {
        const p = board.vertices.get(id);
        return `${p.x},${p.y}`;
      })
      .join(" ");
    const group = node("g", {
      class: `tile${tile.id === selectedTile ? " selected" : ""}`,
      tabindex: 0,
      role: "button",
      "aria-pressed": tile.id === selectedTile,
      "aria-label": `${terrains[tile.terrain].title}, жетон ${tile.number}`,
      "data-tile": tile.id,
    });
    const clip = node("clipPath", { id: `hex-${tile.id}` });
    clip.append(node("polygon", { points }));
    group.append(clip);
    group.append(
      node("polygon", { points, fill: "#1c2530", filter: "url(#land-shadow)" }),
    );
    group.append(
      node("image", {
        href: imagePath(`terrain-${tile.terrain}`),
        x: tile.x - RADIUS,
        y: tile.y - RADIUS,
        width: RADIUS * 2,
        height: RADIUS * 2,
        preserveAspectRatio: "xMidYMid slice",
        "clip-path": `url(#hex-${tile.id})`,
      }),
    );
    group.append(node("polygon", { points, class: "tile-border" }));
    group.append(
      node("circle", {
        cx: tile.x,
        cy: tile.y,
        r: 24,
        class: "number-token",
        "pointer-events": "none",
      }),
    );
    const frequent = [6, 8].includes(tile.number),
      count = 6 - Math.abs(7 - tile.number);
    group.append(
      node(
        "text",
        {
          x: tile.x,
          y: tile.y + 5,
          class: `number-label${frequent ? " frequent" : ""}`,
        },
        tile.number,
      ),
    );
    for (let i = 0; i < count; i++)
      group.append(
        node("circle", {
          cx: tile.x + (i - (count - 1) / 2) * 4,
          cy: tile.y + 14,
          r: 1.3,
          class: `probability-dot${frequent ? " frequent" : ""}`,
        }),
      );
    activate(group, () => selectTile(tile.id));
    layer.append(group);
  }
}
function selectTile(id) {
  selectedTile = id;
  selectedTerrain = board.tiles[id].terrain;
  $$(".tile").forEach((tile) => {
    const selected = Number(tile.dataset.tile) === id;
    tile.classList.toggle("selected", selected);
    tile.setAttribute("aria-pressed", String(selected));
  });
  showTerrain(selectedTerrain);
}
function showTerrain(kind) {
  const terrain = terrains[kind];
  selectedTerrain = kind;
  $("#terrain-title").textContent = terrain.title;
  $("#terrain-resource").textContent = terrain.resource;
  $("#terrain-description").textContent = terrain.description;
  $("#terrain-image").src = imagePath(`terrain-${kind}`);
  $("#terrain-image").alt = terrain.alt;
  $("#terrain-art").setAttribute(
    "aria-label",
    `Рассмотреть ${terrain.title.toLowerCase()} крупно`,
  );
  $("#terrain-index").textContent = `0${terrain.index} / 03`;
  $$("[data-terrain]").forEach((button) =>
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.terrain === kind),
    ),
  );
}
function pieceNode(placement, ghost = false) {
  const group = node("g", {
    class: `board-piece${ghost ? " ghost-piece" : ""}`,
    "data-kind": placement.kind,
    "data-target": placement.targetId,
  });
  if (placement.kind === "road") {
    const edge = board.edges.get(placement.targetId),
      a = board.vertices.get(edge.a),
      b = board.vertices.get(edge.b);
    const length = Math.hypot(b.x - a.x, b.y - a.y),
      angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    group.setAttribute(
      "transform",
      `translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2}) rotate(${angle})`,
    );
    group.append(
      node("image", {
        href: imagePath("piece-road"),
        x: -length / 2 + 8,
        y: -19,
        width: length - 16,
        height: 38,
        preserveAspectRatio: "none",
      }),
    );
  } else {
    const point = board.vertices.get(placement.targetId),
      size = placement.kind === "city" ? 80 : 62;
    group.append(
      node("ellipse", {
        cx: point.x,
        cy: point.y + 3,
        rx: size * 0.32,
        ry: size * 0.13,
        fill: "#754bff",
        stroke: "#d4c1ff",
        "stroke-width": 1.2,
      }),
    );
    group.append(
      node("image", {
        href: imagePath(`piece-${placement.kind}`),
        x: point.x - size / 2,
        y: point.y - size * 0.83,
        width: size,
        height: size,
      }),
    );
  }
  return group;
}
function renderPieces() {
  $("#roads-layer").replaceChildren();
  $("#buildings-layer").replaceChildren();
  const ordered = [...placements].sort(
    (a, b) =>
      (board.vertices.get(a.targetId)?.y || 0) -
      (board.vertices.get(b.targetId)?.y || 0),
  );
  for (const placement of ordered)
    $(placement.kind === "road" ? "#roads-layer" : "#buildings-layer").append(
      pieceNode(placement),
    );
  $("#undo").disabled = history.length === 0;
}
function choosePiece(kind) {
  mode = mode === kind ? null : kind;
  pending = null;
  $("#ghost-layer").replaceChildren();
  $("#placement-bar").hidden = true;
  $$("[data-piece]").forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.piece === mode)),
  );
  $("#board-hint").textContent = mode
    ? `${pieceNames[mode]}: выберите свободное ${mode === "road" ? "ребро" : "пересечение"}, затем подтвердите размещение.`
    : "Нажмите на тайл, чтобы рассмотреть его.";
  if (mode && window.innerWidth <= 600 && zoom < 1.2) setZoom(1.2);
  renderTargets();
}
function renderTargets() {
  const layer = $("#targets-layer");
  layer.replaceChildren();
  if (!mode) return;
  const targets = mode === "road" ? board.edges : board.vertices;
  let index = 0;
  for (const [id, target] of targets) {
    if (!canPlace(mode, id, placements, board)) continue;
    const group = node("g", {
      role: "button",
      tabindex: 0,
      class: `piece-target${mode === "road" ? " road-target" : ""}`,
      "aria-label": `Место для фишки «${pieceNames[mode]}» ${++index}`,
      "data-placement": id,
    });
    if (mode === "road") {
      const a = board.vertices.get(target.a),
        b = board.vertices.get(target.b);
      const attributes = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      group.append(
        node("line", {
          ...attributes,
          stroke: "transparent",
          "stroke-width": 48,
          "pointer-events": "stroke",
        }),
        node("line", {
          ...attributes,
          class: "target-visual",
          "pointer-events": "none",
        }),
      );
    } else
      group.append(
        node("circle", {
          cx: target.x,
          cy: target.y,
          r: 36,
          fill: "transparent",
        }),
        node("circle", {
          cx: target.x,
          cy: target.y,
          r: 13,
          class: "target-visual",
          "pointer-events": "none",
        }),
      );
    activate(group, () => selectPlacement(id));
    layer.append(group);
  }
}
function selectPlacement(id) {
  if (!mode || !canPlace(mode, id, placements, board)) return;
  pending = { kind: mode, targetId: id };
  $("#ghost-layer").replaceChildren(pieceNode(pending, true));
  $("#placement-label").textContent = `${pieceNames[mode]} · выбранное место`;
  $("#placement-bar").hidden = false;
  $("#confirm-placement").focus({ preventScroll: true });
}
function cancelPlacement() {
  pending = null;
  $("#ghost-layer").replaceChildren();
  $("#placement-bar").hidden = true;
  if (mode) $(`[data-piece="${mode}"]`).focus({ preventScroll: true });
}
$("#confirm-placement").addEventListener("click", () => {
  if (!pending || !canPlace(pending.kind, pending.targetId, placements, board))
    return;
  const placement = { ...pending };
  history.push(placement);
  placements.push(placement);
  cancelPlacement();
  renderPieces();
  renderTargets();
  $("#board-hint").textContent =
    `${pieceNames[placement.kind]} на поле. Можно выбрать следующее место или другую фишку.`;
});
$("#cancel-placement").addEventListener("click", cancelPlacement);
$("#undo").addEventListener("click", () => {
  const last = history.pop();
  if (!last) return;
  placements = placements.filter((p) => p !== last);
  cancelPlacement();
  renderPieces();
  renderTargets();
  $("#board-hint").textContent = "Последнее размещение отменено.";
});
$("#reset-board").addEventListener("click", () => {
  placements = initialPlacements.map((p) => ({ ...p }));
  history.length = 0;
  mode = null;
  pending = null;
  $("#ghost-layer").replaceChildren();
  $("#placement-bar").hidden = true;
  $$("[data-piece]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  renderPieces();
  renderTargets();
  selectTile(0);
  fit();
  $("#board-hint").textContent = "Исходный вид восстановлен.";
});
$$("[data-piece]").forEach((button) =>
  button.addEventListener("click", () => choosePiece(button.dataset.piece)),
);
$$("[data-terrain]").forEach((button) =>
  button.addEventListener("click", () =>
    selectTile(
      board.tiles.find((tile) => tile.terrain === button.dataset.terrain).id,
    ),
  ),
);

function updateView() {
  const width = (window.innerWidth <= 600 ? 700 : 900) / zoom,
    height = 680 / zoom;
  viewCenter.x = Math.max(
    CENTER.x - 230,
    Math.min(CENTER.x + 230, viewCenter.x),
  );
  viewCenter.y = Math.max(
    CENTER.y - 180,
    Math.min(CENTER.y + 180, viewCenter.y),
  );
  svg.setAttribute(
    "viewBox",
    `${viewCenter.x - width / 2} ${viewCenter.y - height / 2} ${width} ${height}`,
  );
  $("#zoom-value").value = `${Math.round(zoom * 100)}%`;
  $("#zoom-out").disabled = zoom <= 0.8;
  $("#zoom-in").disabled = zoom >= 2.4;
}
function setZoom(value) {
  zoom = Math.max(0.8, Math.min(2.4, value));
  updateView();
}
function fit() {
  viewCenter = { ...CENTER };
  zoom = 1;
  updateView();
}
$("#zoom-in").addEventListener("click", () => setZoom(zoom + 0.2));
$("#zoom-out").addEventListener("click", () => setZoom(zoom - 0.2));
$("#zoom-fit").addEventListener("click", fit);
svg.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
  },
  { passive: false },
);
let drag = null,
  suppressClick = false;
svg.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  suppressClick = false;
  drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    center: { ...viewCenter },
    moved: false,
  };
});
svg.addEventListener("pointermove", (event) => {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x,
    dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 6) return;
  if (!drag.moved) {
    drag.moved = true;
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("dragging");
  }
  const matrix = svg.getScreenCTM();
  viewCenter = {
    x: drag.center.x - dx / matrix.a,
    y: drag.center.y - dy / matrix.d,
  };
  updateView();
});
function endDrag(event) {
  if (!drag || drag.id !== event.pointerId) return;
  suppressClick = drag.moved;
  drag = null;
  svg.classList.remove("dragging");
  if (svg.hasPointerCapture(event.pointerId))
    svg.releasePointerCapture(event.pointerId);
}
svg.addEventListener("pointerup", endDrag);
svg.addEventListener("pointercancel", endDrag);
svg.addEventListener("keydown", (event) => {
  if (
    event.target !== svg ||
    !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
  )
    return;
  event.preventDefault();
  viewCenter.x +=
    event.key === "ArrowLeft" ? -40 : event.key === "ArrowRight" ? 40 : 0;
  viewCenter.y +=
    event.key === "ArrowUp" ? -40 : event.key === "ArrowDown" ? 40 : 0;
  updateView();
});
window.addEventListener("resize", updateView);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
    if (pending) cancelPlacement();
    else if (mode) choosePiece(mode);
  }
});

function showArt(title, asset, caption, kind = "ИЛЛЮСТРАЦИЯ") {
  $("#art-title").textContent = title;
  $("#art-kind").textContent = kind;
  $("#art-image").src = imagePath(asset);
  $("#art-image").alt = title;
  $("#art-caption").textContent = caption;
  $("#art-dialog").showModal();
}
$("#terrain-art").addEventListener("click", () => {
  const t = terrains[selectedTerrain];
  showArt(
    t.title,
    `terrain-${selectedTerrain}`,
    t.description,
    "ЗЕМЛИ ОСТРОВА",
  );
});
$$("[data-resource]").forEach((button) =>
  button.addEventListener("click", () => {
    const wood = button.dataset.resource === "wood";
    showArt(
      wood ? "Древесина" : "Руда",
      `resource-${button.dataset.resource}`,
      wood
        ? "Тёплое дерево, солнечный лес и крупный силуэт ресурса."
        : "Камень, металлические прожилки и прохладные горные оттенки.",
      "КАРТОЧКА РЕСУРСА",
    );
  }),
);
$("#help").addEventListener("click", () => $("#help-dialog").showModal());
$$("dialog").forEach((dialog) => {
  dialog
    .querySelector(".dialog-close")
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    const box = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom)
    )
      dialog.close();
  });
});
$("#theme-toggle").addEventListener("click", () => {
  const light = document.documentElement.dataset.theme !== "light";
  document.documentElement.dataset.theme = light ? "light" : "dark";
  $("#theme-toggle").setAttribute(
    "aria-label",
    light ? "Включить тёмную тему" : "Включить светлую тему",
  );
});
$("#retry-assets").addEventListener("click", () => location.reload());
document.addEventListener(
  "error",
  (event) => {
    if (event.target instanceof HTMLImageElement)
      $("#asset-error").hidden = false;
  },
  true,
);

renderLand();
renderPieces();
updateView();
async function loadAssets() {
  try {
    const response = await fetch("./assets/manifest.json");
    if (!response.ok) throw new Error("Manifest unavailable");
    const manifest = await response.json();
    await Promise.all(
      manifest.assets.map((asset) => {
        const image = new Image();
        image.src = `./assets/${asset.file}`;
        return image.decode();
      }),
    );
  } catch {
    $("#asset-error").hidden = false;
  } finally {
    $("#loading").hidden = true;
    $("#board-stage").setAttribute("aria-busy", "false");
  }
}
await loadAssets();
