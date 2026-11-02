import { GameConnection } from "./connection.mjs";
import { renderBoard, pieceAsset, terrainAsset } from "./game-board.mjs";

const RESOURCES = {
  wood: "Древесина",
  brick: "Кирпич",
  wool: "Шерсть",
  grain: "Зерно",
  ore: "Руда",
};
const DEVELOPMENTS = {
  knight: "Рыцарь",
  road_building: "Дорожное строительство",
  plenty: "Изобилие",
  monopoly: "Монополия",
  victory: "Победное очко",
};
const DETAILS = {
  knight:
    "Переместите разбойника и заберите случайный ресурс у одного соседа. Три рыцаря дают право на крупнейшую армию.",
  road_building:
    "Постройте две дороги бесплатно. Ограничения соединения дорог сохраняются.",
  plenty: "Возьмите два доступных ресурса из банка. Можно выбрать одинаковые.",
  monopoly:
    "Выберите ресурс. Все соперники передадут вам все свои карты этого ресурса.",
  victory:
    "Даёт одно скрытое победное очко. Учитывается автоматически, в том числе в ход покупки.",
};
const COLORS = {
  amethyst: "Аметист",
  cyan: "Бирюза",
  coral: "Коралл",
  gold: "Золото",
};
const game = document.querySelector("#game"),
  errorBox = document.querySelector("#error");
const dialog = document.querySelector("#dialog"),
  dialogContent = document.querySelector("#dialog-content");
const connection = new GameConnection();
let room = null,
  busy = false,
  candidate = null,
  uncertain = null,
  mode = null,
  rooms = [],
  listLoading = false,
  requestGeneration = 0;
const viewport = { zoom: 1, x: 0, y: 0 };

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, action, disabled = false, className = "") {
  const node = el("button", text, className);
  node.type = "button";
  node.disabled = disabled;
  node.addEventListener("click", action);
  return node;
}
function image(name, alt = "", className = "") {
  const img = el("img", null, className);
  img.src = `assets/${name}.webp`;
  img.alt = alt;
  return img;
}
function actions(...nodes) {
  const row = el("div", null, "actions");
  row.append(...nodes);
  return row;
}
function error(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}
function heading(text) {
  const h = el("h2", text);
  h.id = "dialog-title";
  return h;
}
function showDialog(title, ...nodes) {
  dialogContent.replaceChildren(heading(title), ...nodes);
  if (!dialog.open) dialog.showModal();
}
function hideDialog() {
  dialog.close();
}
document.querySelector("#dialog-close").addEventListener("click", hideDialog);
document
  .querySelector("#theme")
  .addEventListener("click", () => document.body.classList.toggle("light"));
document.querySelector("#rooms").addEventListener("click", () => {
  if (busy || uncertain) {
    error("Сначала дождитесь результата текущего действия.");
    return;
  }
  room = null;
  candidate = null;
  connection.watch(null);
  void loadRooms();
});

function resourceText(resources) {
  return Object.entries(resources)
    .filter(([, n]) => n)
    .map(([r, n]) => `${RESOURCES[r]} ×${n}`)
    .join(", ");
}
function name(uid) {
  return room?.state.players.find((p) => p.id === uid)?.nick || "Игрок";
}
function isMyTurn() {
  return room && room.state.active === room.state.me.id;
}
function disabled() {
  return busy || !!uncertain;
}

async function loadRooms() {
  if (!connection.user) return;
  const generation = ++requestGeneration;
  listLoading = true;
  render();
  try {
    const data = await connection.request("api/rooms");
    if (generation === requestGeneration) rooms = data;
  } catch (exc) {
    error(exc.message);
  } finally {
    if (generation === requestGeneration) {
      listLoading = false;
      render();
    }
  }
}
function enter(view) {
  requestGeneration++;
  room = view;
  candidate = null;
  mode = null;
  uncertain = null;
  viewport.zoom = 1;
  viewport.x = 0;
  viewport.y = 0;
  connection.watch(view.id);
  render();
}
function update(view) {
  if (!room || view.id !== room.id || view.version < room.version) return;
  if (view.version !== room.version) candidate = null;
  room = view;
  render();
}

async function mutation(path, body, onSuccess) {
  if (busy) return false;
  busy = true;
  error("");
  render();
  try {
    const result = await connection.request(path, body);
    uncertain = null;
    onSuccess(result);
    return true;
  } catch (exc) {
    if (exc.uncertain) uncertain = { path, body, onSuccess };
    else uncertain = null;
    error(exc.message);
    if (exc.status === 409 && room) {
      try {
        update(await connection.request("api/rooms/" + room.id));
      } catch {
        /* reconnect will refresh */
      }
    }
    return false;
  } finally {
    busy = false;
    render();
  }
}
async function send(command) {
  if (!room || disabled()) return false;
  const current = room;
  return mutation(
    `api/rooms/${current.id}/commands`,
    { request_id: crypto.randomUUID(), version: current.version, command },
    (result) => {
      candidate = null;
      if (result.left) {
        room = null;
        connection.watch(null);
        void loadRooms();
      } else update(result);
    },
  );
}
function choose(command, label) {
  if (disabled()) return;
  candidate = { command, label, version: room.version };
  render();
  document.querySelector(".pending")?.scrollIntoView({ block: "nearest" });
}

function render() {
  if (!connection.user) return;
  const focus = document.activeElement?.getAttribute("data-focus");
  const children = [];
  if (uncertain) {
    const banner = el("section", null, "pending");
    banner.append(
      el("span", "Проверяем результат последнего действия. Повтор безопасен."),
      button(
        "Проверить и повторить",
        () => {
          const item = uncertain;
          void mutation(item.path, item.body, item.onSuccess);
        },
        busy,
      ),
    );
    children.push(banner);
  }
  children.push(
    room
      ? room.state.status === "lobby"
        ? renderLobby()
        : renderMatch()
      : renderRooms(),
  );
  game.replaceChildren(...children);
  if (focus)
    [...game.querySelectorAll("[data-focus]")]
      .find((n) => n.getAttribute("data-focus") === focus)
      ?.focus({ preventScroll: true });
}

function renderRooms() {
  const section = el("section", null, "welcome");
  const hero = el("div", null, "welcome-hero");
  hero.append(
    el("span", "ВАШ НОВЫЙ МИР", "eyebrow"),
    el("h2", "Один остров. Тысяча решений."),
    el(
      "p",
      "Соберите 3–4 друзей. Стройте, торгуйте и первыми наберите 10 очков.",
    ),
  );
  section.append(
    hero,
    button(
      "Создать партию",
      () =>
        void mutation("api/rooms", { request_id: crypto.randomUUID() }, enter),
      disabled(),
      "primary",
    ),
  );
  const form = el("form", null, "join-form"),
    label = el("label", "Код приглашения"),
    input = el("input");
  input.maxLength = 12;
  input.autocomplete = "off";
  input.pattern = "[0-9A-Fa-f]{12}";
  input.required = true;
  input.placeholder = "12 символов";
  input.setAttribute("aria-label", "Код приглашения");
  label.append(input);
  const submit = button("Присоединиться", () => {}, disabled());
  submit.type = "submit";
  form.append(label, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!disabled())
      void mutation(
        "api/rooms/join",
        { code: input.value.trim().toUpperCase() },
        enter,
      );
  });
  section.append(form, el("h3", "Мои партии"));
  if (listLoading) section.append(el("p", "Загружаем партии…", "muted"));
  else if (!rooms.length)
    section.append(
      el(
        "p",
        "Пока нет партий. Создайте остров или присоединитесь по коду друга.",
        "muted",
      ),
    );
  const list = el("div", null, "room-list");
  for (const item of rooms) {
    const node = button(
      "",
      async () => {
        try {
          enter(await connection.request("api/rooms/" + item.id));
        } catch (exc) {
          error(exc.message);
        }
      },
      disabled(),
      "room-entry",
    );
    node.append(
      el("strong", item.players.join(" · ")),
      el(
        "small",
        {
          lobby: "Сбор игроков",
          playing: "Продолжить партию",
          finished: "Партия завершена",
          abandoned: "Завершена без победителя",
        }[item.status],
      ),
    );
    list.append(node);
  }
  section.append(
    list,
    button("Обновить список", () => void loadRooms(), listLoading),
  );
  return section;
}

function playerCard(p, lobby = false) {
  const node = el(
    "article",
    null,
    "player " +
      p.color +
      (room.state.active === p.id && !lobby ? " active" : ""),
  );
  const copy = el("div", null, "player-copy");
  copy.append(
    el("strong", p.nick + (p.id === room.state.me.id ? " · вы" : "")),
  );
  copy.append(
    el(
      "small",
      lobby
        ? p.ready
          ? "Готов к игре"
          : "Выбирает цвет и готовность"
        : `Ресурсы: ${p.resource_count} · Развитие: ${p.development_count}`,
    ),
  );
  if (!lobby)
    copy.append(el("small", `Дорога: ${p.road_length} · Рыцари: ${p.knights}`));
  if (!lobby && p.development_count)
    copy.append(
      image("card-back", `${p.development_count} карт развития`, "deck-back"),
    );
  node.append(el("span", null, "owner"), copy);
  if (!lobby)
    node.append(
      el(
        "span",
        p.id === room.state.me.id ? room.state.me.score : p.score,
        "player-score",
      ),
    );
  return node;
}
function renderLobby() {
  const state = room.state,
    me = state.players.find((p) => p.id === state.me.id),
    section = el("section", null, "welcome");
  section.append(
    el("span", "СБОР ДРУЗЕЙ", "eyebrow"),
    el("h2", "Кто отправится на остров?"),
    el(
      "p",
      "Передайте код друзьям. Для начала нужны 3–4 игрока и готовность каждого.",
    ),
  );
  section.append(
    actions(
      el("span", room.code, "room-code"),
      button("Скопировать код", async () => {
        try {
          await navigator.clipboard.writeText(room.code);
          error("");
        } catch {
          error("Не удалось скопировать. Выделите код вручную.");
        }
      }),
    ),
  );
  const list = el("div", null, "lobby-grid");
  state.players.forEach((p) => list.append(playerCard(p, true)));
  section.append(list, el("h3", "Ваш цвет"));
  const colors = actions();
  for (const [color, label] of Object.entries(COLORS)) {
    const b = button(
      label,
      () => void send({ type: "color", color }),
      disabled() ||
        state.players.some((p) => p.id !== me.id && p.color === color),
      color,
    );
    b.prepend(el("span", null, "owner"));
    b.setAttribute("aria-pressed", String(me.color === color));
    colors.append(b);
  }
  section.append(
    colors,
    el(
      "p",
      "Все участники играют по одним правилам. Порядок хода и поле определятся при старте.",
      "muted",
    ),
  );
  const controls = actions(
    button(
      me.ready ? "Отменить готовность" : "Я готов",
      () => void send({ type: "ready", ready: !me.ready }),
      disabled(),
      "primary",
    ),
  );
  if (state.host === me.id)
    controls.append(
      button(
        "Начать партию",
        () => void send({ type: "start" }),
        disabled() ||
          state.players.length < 3 ||
          !state.players.every((p) => p.ready),
        "primary",
      ),
    );
  controls.append(
    button(
      "Покинуть лобби",
      () => confirmAction("Покинуть лобби?", { type: "leave" }),
      disabled(),
    ),
  );
  section.append(controls);
  return section;
}

function phaseLabel() {
  const state = room.state;
  if (state.status === "finished") return `${name(state.winner)} побеждает!`;
  if (state.status === "abandoned") return "Партия завершена без победителя";
  if (state.paused_by) return `Пауза · ${name(state.paused_by)}`;
  if (state.actions.discard) return `Сброс ресурсов: ${state.actions.discard}`;
  const phase = {
    setup_settlement: "Поставьте начальное поселение",
    setup_road: "Поставьте начальную дорогу",
    roll: "Время бросить кубики",
    main: "Стройте и торгуйте",
    discard: "Ждём сброса ресурсов",
    robber: "Переместите разбойника",
    steal: "Выберите, у кого забрать карту",
    free_roads: "Постройте бесплатную дорогу",
  }[state.phase];
  return isMyTurn() ? phase : `Ходит ${name(state.active)}`;
}

function renderMatch() {
  const state = room.state,
    allowed = state.actions,
    ended = state.status !== "playing",
    blocked = disabled() || ended || !!state.paused_by;
  const layout = el("div", null, "match-layout"),
    main = el("div"),
    table = el("section", null, "table"),
    banner = el("div", null, "turn-banner");
  banner.append(
    el("span", `ХОД ${state.turn || "РАССТАНОВКИ"} · ДО 10 ОЧКОВ`, "eyebrow"),
    el("h2", phaseLabel()),
  );
  if (state.dice)
    banner.append(
      el(
        "small",
        `Кубики: ${state.dice[0]} + ${state.dice[1]} = ${state.dice[0] + state.dice[1]}`,
      ),
    );
  table.append(banner);
  const wrap = el("div", null, "board-wrap");
  wrap.append(
    renderBoard(
      state,
      mode,
      choose,
      (tile) => {
        if (tile.port)
          return showDialog(
            "Порт",
            image("piece-port", "", "detail"),
            el(
              "p",
              tile.port === "any"
                ? "Поселение или город у этого порта позволяет обменивать три одинаковых ресурса на один другой."
                : `Поселение или город у этого порта даёт курс 2:1 для ресурса «${RESOURCES[tile.port]}».`,
            ),
          );
        showDialog(
          {
            forest: "Лес",
            hills: "Холмы",
            pasture: "Пастбище",
            fields: "Поля",
            mountains: "Горы",
            desert: "Пустыня",
          }[tile.terrain],
          image(terrainAsset(room.state.board.tiles, tile), "", "detail"),
          el(
            "p",
            tile.number
              ? `При результате ${tile.number} поселение получает один ресурс, город — два. Разбойник блокирует выдачу с этого тайла.`
              : "Пустыня не производит ресурсы.",
          ),
        );
      },
      viewport,
    ),
  );
  const zoom = el("div", null, "zoom");
  for (const [label, delta] of [
    ["−", -0.25],
    ["+", 0.25],
    ["Сброс", 0],
  ]) {
    const b = button(label, () => {
      viewport.zoom = delta
        ? Math.max(0.8, Math.min(2.5, viewport.zoom + delta))
        : 1;
      if (!delta) {
        viewport.x = 0;
        viewport.y = 0;
      }
      render();
    });
    b.setAttribute(
      "aria-label",
      delta < 0
        ? "Уменьшить поле"
        : delta > 0
          ? "Увеличить поле"
          : "Сбросить масштаб",
    );
    zoom.append(b);
  }
  wrap.append(zoom);
  table.append(wrap);
  const dock = el("div", null, "build-dock");
  if (candidate) {
    const pending = el("div", null, "pending");
    pending.append(
      el("span", candidate.label),
      button(
        "Подтвердить",
        () => void send(candidate.command),
        blocked || candidate.version !== room.version,
        "primary",
      ),
      button(
        "Отмена",
        () => {
          candidate = null;
          render();
        },
        busy,
      ),
    );
    dock.append(pending);
  }
  if (!ended) {
    const primary = actions();
    if (allowed.roll)
      primary.append(
        button(
          "Бросить кубики",
          () => void send({ type: "roll" }),
          blocked,
          "primary",
        ),
      );
    if (allowed.discard)
      primary.append(
        button(
          `Выбрать карты для сброса (${allowed.discard})`,
          () =>
            resourcesDialog(
              "Сброс ресурсов",
              "Количество карт для сброса: " + allowed.discard + ".",
              state.me.hand,
              (resources) => send({ type: "discard", resources }),
            ),
          blocked,
          "primary",
        ),
      );
    for (const victim of allowed.victims)
      primary.append(
        button(
          "Забрать карту · " + name(victim),
          () => void send({ type: "steal", victim }),
          blocked,
          "primary",
        ),
      );
    if (allowed.end_turn)
      primary.append(
        button(
          "Завершить ход",
          () => void send({ type: "end_turn" }),
          blocked,
          "primary",
        ),
      );
    if (primary.childElementCount) dock.append(primary);
    const build = el("div", null, "build-buttons");
    for (const [kind, label, cost] of [
      ["road", "Дорога", "1 древесина · 1 кирпич"],
      [
        "settlement",
        "Поселение",
        "1 древесина · 1 кирпич · 1 шерсть · 1 зерно",
      ],
      ["city", "Город", "2 зерна · 3 руды"],
    ]) {
      const ids =
        allowed[
          { road: "roads", settlement: "settlements", city: "cities" }[kind]
        ];
      const b = button(
        "",
        () => {
          mode = kind;
          candidate = null;
          render();
        },
        blocked || !ids.length,
      );
      b.setAttribute("aria-label", label);
      b.setAttribute("aria-pressed", String(mode === kind));
      b.dataset.focus = kind;
      b.append(
        image(
          pieceAsset(
            kind,
            state.players.find((p) => p.id === state.me.id).color,
          ),
        ),
        el("span", label),
        el(
          "small",
          state.phase.startsWith("setup_") || state.phase === "free_roads"
            ? "Начальное / бесплатное размещение"
            : cost,
        ),
      );
      build.append(b);
    }
    dock.append(build);
    if (!isMyTurn() && !allowed.discard)
      dock.append(
        el(
          "small",
          "Пока соперник ходит, можно рассмотреть поле и свои карты.",
        ),
      );
    else if (allowed.settlements.length || allowed.roads.length)
      dock.append(
        el(
          "small",
          "Выберите постройку и подсвеченное место. На телефоне увеличьте поле кнопкой +.",
        ),
      );
  }
  table.append(dock);
  main.append(table, renderHand(blocked));
  const side = el("aside", null, "side"),
    players = el("section", null, "player-list");
  state.players.forEach((p) => players.append(playerCard(p)));
  side.append(players);
  if (state.trade) side.append(renderOffer(blocked));
  const bank = el("section", null, "panel");
  bank.append(
    el("h3", "Торговля и банк"),
    el("p", resourceText(state.bank), "muted"),
  );
  const canTrade = isMyTurn() && state.phase === "main" && !blocked;
  bank.append(
    actions(
      button("Обмен с банком", () => tradeDialog(true), !canTrade),
      button("Предложить обмен", () => tradeDialog(false), !canTrade),
    ),
  );
  bank.append(
    el(
      "p",
      "Ваш курс: " +
        Object.entries(allowed.bank_rates)
          .map(([r, n]) => `${RESOURCES[r]} ${n}:1`)
          .join(" · "),
      "muted",
    ),
  );
  side.append(bank);
  const journal = el("section", null, "panel");
  journal.append(el("h3", "Хроника острова"));
  const log = el("ol", null, "log");
  for (const entry of [...state.log].reverse())
    log.append(el("li", entry.text));
  journal.append(log);
  side.append(journal);
  const management = el("section", null, "panel");
  management.append(el("h3", "Партия"));
  if (state.longest_road)
    management.append(
      el("p", "Самая длинная дорога · " + name(state.longest_road)),
    );
  if (state.largest_army)
    management.append(
      el("p", "Крупнейшая армия · " + name(state.largest_army)),
    );
  if (!ended) {
    management.append(
      button(
        state.paused_by ? "Продолжить партию" : "Пауза",
        () => void send({ type: state.paused_by ? "resume" : "pause" }),
        disabled() ||
          (!!state.paused_by &&
            ![state.paused_by, state.host].includes(state.me.id)),
      ),
    );
    const voted = state.abandon_votes.includes(state.me.id);
    management.append(
      button(
        voted ? "Отозвать голос за завершение" : "Завершить по согласию",
        () =>
          voted
            ? void send({ type: "abandon_vote", vote: false })
            : confirmAction(
                "Завершить партию без победителя?",
                { type: "abandon_vote", vote: true },
                "Партия закончится только после согласия всех участников.",
              ),
        disabled(),
      ),
    );
    if (state.abandon_votes.length)
      management.append(
        el(
          "p",
          `За завершение: ${state.abandon_votes.length} из ${state.players.length}`,
        ),
      );
  }
  management.append(el("small", "Код партии: " + room.code));
  side.append(management);
  layout.append(main, side);
  return layout;
}

function renderHand(blocked) {
  const state = room.state,
    section = el("section", null, "panel hand");
  section.append(el("h3", `Ваша рука · Очки: ${state.me.score}`));
  const cards = el("div", null, "resource-hand");
  for (const [r, label] of Object.entries(RESOURCES)) {
    const card = button(
      "",
      () =>
        showDialog(
          label,
          image("resource-" + r, label, "detail"),
          el("p", `У вас: ${state.me.hand[r]}. Эти карты видны только вам.`),
        ),
      false,
      "resource-card",
    );
    card.setAttribute("aria-label", `${label}: ${state.me.hand[r]}`);
    card.append(
      image("resource-" + r),
      el("span", label, "card-label"),
      el("b", state.me.hand[r]),
    );
    cards.append(card);
  }
  section.append(cards);
  const development = el("div", null, "development");
  for (const card of state.me.development) {
    const b = button("", () => developmentDialog(card), false);
    b.append(
      image("development-" + card.kind),
      el("strong", DEVELOPMENTS[card.kind]),
      el(
        "small",
        card.kind === "victory"
          ? state.status === "finished"
            ? "+1 победное очко"
            : "+1 скрытое очко"
          : card.bought_turn === state.turn
            ? "Доступна со следующего хода"
            : state.actions.development.includes(card.id)
              ? "Можно сыграть"
              : "Ожидает вашего хода",
      ),
    );
    development.append(b);
  }
  section.append(
    development,
    button(
      `Купить карту развития · осталось ${state.deck_count}`,
      () => void send({ type: "buy_development" }),
      blocked || !state.actions.buy_development,
    ),
  );
  section.append(
    el(
      "small",
      "Стоимость: 1 шерсть · 1 зерно · 1 руда. За ход можно сыграть одну ранее купленную карту.",
    ),
  );
  return section;
}
function renderOffer(blocked) {
  const trade = room.state.trade,
    me = room.state.me.id,
    section = el("section", null, "panel trade-summary");
  section.append(
    el("h3", "Обмен · " + name(trade.from)),
    el("p", "Предлагает: " + resourceText(trade.give)),
    el("p", "Хочет: " + resourceText(trade.want)),
  );
  if (trade.declined.length)
    section.append(
      el(
        "p",
        "Отказ от обмена: " + trade.declined.map(name).join(", "),
        "muted",
      ),
    );
  if (trade.from === me)
    section.append(
      button(
        "Отменить предложение",
        () => void send({ type: "trade_cancel", offer: trade.id }),
        blocked,
      ),
    );
  else if (!trade.to || trade.to === me)
    section.append(
      actions(
        button(
          "Принять",
          () => void send({ type: "trade_accept", offer: trade.id }),
          blocked ||
            Object.entries(trade.want).some(
              ([r, n]) => room.state.me.hand[r] < n,
            ),
          "primary",
        ),
        button(
          "Отказаться",
          () => void send({ type: "trade_decline", offer: trade.id }),
          blocked || trade.declined.includes(me),
        ),
      ),
    );
  else section.append(el("p", "Получатель: " + name(trade.to), "muted"));
  return section;
}
function resourceInputs(title, limits) {
  const fieldset = el("fieldset");
  fieldset.append(el("legend", title));
  const grid = el("div", null, "resource-inputs"),
    inputs = {};
  for (const [r, label] of Object.entries(RESOURCES)) {
    const field = el("label", label),
      input = el("input");
    input.type = "number";
    input.min = "0";
    input.max = String(limits[r]);
    input.step = "1";
    input.value = "0";
    input.inputMode = "numeric";
    input.setAttribute("aria-label", title + " · " + label);
    field.append(input);
    grid.append(field);
    inputs[r] = input;
  }
  fieldset.append(grid);
  return {
    node: fieldset,
    read: () =>
      Object.fromEntries(
        Object.entries(inputs).map(([r, input]) => [r, Number(input.value)]),
      ),
  };
}
function dialogSubmit(form, label, action) {
  const notice = el("p", "", "dialog-error");
  notice.setAttribute("role", "alert");
  const submit = button(label, () => {}, false, "primary");
  submit.type = "submit";
  form.append(notice, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (disabled()) return;
    submit.disabled = true;
    try {
      if (await action()) hideDialog();
      else notice.textContent = errorBox.textContent;
    } catch (exc) {
      notice.textContent = exc.message;
    } finally {
      submit.disabled = false;
    }
  });
}
function resourcesDialog(title, description, limits, action) {
  const form = el("form"),
    fields = resourceInputs("Количество", limits);
  form.append(el("p", description), fields.node);
  dialogSubmit(form, "Подтвердить", () => action(fields.read()));
  showDialog(title, form);
}
function tradeDialog(bank) {
  const state = room.state,
    form = el("form"),
    give = resourceInputs("Отдаю", state.me.hand),
    want = resourceInputs(
      "Получаю",
      bank
        ? state.bank
        : Object.fromEntries(Object.keys(RESOURCES).map((r) => [r, 19])),
    );
  form.append(
    el(
      "p",
      bank
        ? "Ваш курс: " +
            Object.entries(state.actions.bank_rates)
              .map(([r, n]) => `${RESOURCES[r]} ${n}:1`)
              .join(" · ") +
            ". Отдавайте карты каждого вида в количестве, кратном его курсу."
        : "Предложение действует до следующего вашего действия. Обмен выполняется после согласия соперника.",
    ),
    give.node,
    want.node,
  );
  let select;
  if (!bank) {
    const label = el("label", "Кому предложить");
    select = el("select");
    select.setAttribute("aria-label", "Кому предложить");
    const any = el("option", "Всем игрокам");
    any.value = "";
    select.append(any);
    for (const p of state.players.filter((p) => p.id !== state.me.id)) {
      const option = el("option", p.nick);
      option.value = p.id;
      select.append(option);
    }
    label.append(select);
    form.append(label);
  }
  dialogSubmit(form, bank ? "Обменять" : "Предложить", () =>
    send({
      type: bank ? "bank_trade" : "trade_offer",
      give: give.read(),
      want: want.read(),
      ...(bank ? {} : { target: select.value || null }),
    }),
  );
  showDialog(bank ? "Обмен с банком" : "Обмен с игроками", form);
}
function developmentDialog(card) {
  const form = el("form");
  form.append(
    image("development-" + card.kind, DEVELOPMENTS[card.kind], "detail"),
  );
  form.append(el("p", DETAILS[card.kind]));
  if (!room.state.actions.development.includes(card.id)) {
    form.append(
      el(
        "p",
        card.kind === "victory"
          ? "Очко уже учтено в вашем счёте."
          : "Сейчас карту сыграть нельзя.",
      ),
    );
    showDialog(DEVELOPMENTS[card.kind], form);
    return;
  }
  let fields, select;
  if (card.kind === "plenty") {
    fields = resourceInputs("Взять из банка", room.state.bank);
    form.append(fields.node);
  }
  if (card.kind === "monopoly") {
    const label = el("label", "Ресурс");
    select = el("select");
    select.setAttribute("aria-label", "Ресурс");
    for (const [r, title] of Object.entries(RESOURCES)) {
      const option = el("option", title);
      option.value = r;
      select.append(option);
    }
    label.append(select);
    form.append(label);
  }
  dialogSubmit(form, "Сыграть карту", () =>
    send({
      type: "play_development",
      card: card.id,
      ...(fields ? { resources: fields.read() } : {}),
      ...(select ? { resource: select.value } : {}),
    }),
  );
  showDialog(DEVELOPMENTS[card.kind], form);
}
function confirmAction(
  title,
  command,
  description = "Действие будет сохранено для всей партии.",
) {
  showDialog(
    title,
    el("p", description),
    button(
      "Подтвердить",
      async () => {
        if (await send(command)) hideDialog();
      },
      disabled(),
      "primary",
    ),
  );
}

document.querySelector("#rules").addEventListener("click", () => {
  const text = el("div", null, "rules-copy");
  for (const paragraph of [
    "Играют 3–4 человека. Побеждает тот, кто набрал 10 очков в свой ход. Поселение даёт 1 очко, город — 2. Самая длинная дорога (от 5 участков) и крупнейшая армия (от 3 рыцарей) дают по 2 очка.",
    "Сначала каждый ставит поселение и дорогу, затем по одному комплекту в обратном порядке. Поселения не могут стоять рядом. Ресурсы у второго поселения становятся вашей начальной рукой.",
    "В свой ход бросьте два кубика. Земли с выпавшим числом производят ресурс: 1 для соседнего поселения, 2 для города. Если ресурсов одного вида не хватает нескольким игрокам, никто не получает этот вид.",
    "Семёрка: игроки с более чем 7 ресурсами сбрасывают половину, округляя вниз. Затем активный игрок перемещает разбойника и забирает одну случайную карту у соседа этого тайла. Разбойник блокирует производство земли.",
    "После броска можно строить, покупать карты и торговать. Дороги соединяются с вашей сетью и не проходят сквозь чужие поселения. Новый город заменяет ваше поселение. Нельзя строить на занятых местах.",
    "Обмен с банком — 4 одинаковых ресурса за 1 любой другой. Поселение у общего порта даёт курс 3:1, у специального — 2:1 для указанного ресурса. С игроками можно согласовать другой обмен в свой ход.",
    "За ход играется одна карта развития. Купленная в этом ходу станет доступна позже. Рыцаря и другие карты можно сыграть до броска. Победные очки учитываются сразу и скрыты от соперников до конца партии.",
    "Партия сохраняется после каждого действия. Если связь прервётся, вернитесь в «Мои партии». Пауза доступна любому игроку; продолжить может автор паузы или создатель. Завершение без победителя требует общего согласия.",
  ])
    text.append(el("p", paragraph));
  showDialog("Как играть", text);
});
connection.addEventListener(
  "status",
  (event) => (document.querySelector("#connection").textContent = event.detail),
);
connection.addEventListener("error", (event) => error(event.detail));
connection.addEventListener("authorized", (event) => {
  if (event.detail.changed) {
    room = null;
    uncertain = null;
    void loadRooms();
  }
});
connection.addEventListener("state", (event) => update(event.detail));
connection.addEventListener("removed", () => {
  room = null;
  void loadRooms();
});
void connection.start().catch((exc) => {
  error("Не удалось подключиться к игре. " + exc.message);
  const retry = button("Повторить подключение", () => location.reload());
  errorBox.append(retry);
});
