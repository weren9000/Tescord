const $ = (id) => document.getElementById(id);
const storageKey = "kvachat.plugin.game-calendar.favorites.v1";
let events = [],
  saved = new Set(),
  view = "upcoming",
  limit = 60,
  active = null,
  toastTimer;
let ready = false,
  loaded = false,
  storageAvailable = true;
try {
  const values = JSON.parse(localStorage.getItem(storageKey) || "[]");
  if (Array.isArray(values))
    saved = new Set(values.filter(Number.isSafeInteger));
} catch {
  storageAvailable = false;
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const day = (iso, options) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", ...options }).format(
    new Date(iso + "T12:00:00Z"),
  );
const range = (e) =>
  !e.start_date
    ? "Дата уточняется"
    : e.start_date === e.end_date
      ? day(e.start_date, { day: "numeric", month: "long", year: "numeric" })
      : `${day(e.start_date, { day: "numeric", month: "short" })} — ${day(e.end_date, { day: "numeric", month: "short", year: "numeric" })}`;
const warning = (e) => /отмен|перенес|отлож|неизвест|уточн/i.test(e.status);
const element = (tag, cls, text) => {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
const externalUrl = (value) => {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};
function toast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}
function toggleSaved(id) {
  saved.has(id) ? saved.delete(id) : saved.add(id);
  try {
    localStorage.setItem(storageKey, JSON.stringify([...saved]));
  } catch {
    storageAvailable = false;
  }
  render();
  updateSaveButton();
  if (!storageAvailable)
    toast(
      "Избранное доступно до закрытия страницы: сохранение в браузере недоступно.",
    );
}
function updateSaveButton() {
  if (active) {
    $("favorite-detail").textContent = saved.has(active.id)
      ? "Убрать из избранного"
      : "В избранное";
    $("favorite-detail").setAttribute(
      "aria-pressed",
      String(saved.has(active.id)),
    );
  }
}
function fillSelect(id, values, empty) {
  const select = $(id),
    previous = select.value;
  select.replaceChildren(new Option(empty, ""));
  for (const [value, label] of values) select.add(new Option(label, value));
  if (values.some(([value]) => value === previous)) select.value = previous;
}
function tags(e) {
  const box = element("div", "tags");
  if (e.type) box.append(element("span", "tag", e.type));
  if (e.status)
    box.append(
      element(
        "span",
        "tag " +
          (/отмен/i.test(e.status) ? "danger" : warning(e) ? "warning" : ""),
        e.status,
      ),
    );
  return box;
}
function matches(e) {
  const q = $("search").value.trim().toLocaleLowerCase("ru");
  const terms = q.split(/\s+/).filter(Boolean);
  const hay = [e.name, e.region, e.venue, e.organizer, e.type]
    .join(" ")
    .toLocaleLowerCase("ru");
  return (
    terms.every((t) => hay.includes(t)) &&
    (!$("region").value || e.region === $("region").value) &&
    (!$("type").value || e.type === $("type").value) &&
    (!$("month").value || e.start_date?.slice(0, 7) === $("month").value) &&
    (view !== "saved" || saved.has(e.id)) &&
    (view !== "upcoming" || !e.end_date || e.end_date >= today())
  );
}
function artwork(e, detail = false) {
  const box = element("div", "event-art" + (detail ? " detail-art" : ""));
  box.setAttribute("aria-hidden", "true");
  box.append(element("span", "art-placeholder", "✦"));
  if (
    /^\/plugins\/game-calendar\/images\/[a-f0-9]{64}\.webp$/.test(
      e.image?.url || "",
    )
  ) {
    const img = element("img", e.image.kind === "avatar" ? "avatar-art" : "");
    img.alt = "";
    img.loading = detail ? "eager" : "lazy";
    img.decoding = "async";
    img.addEventListener("load", () => box.classList.add("has-image"));
    img.addEventListener("error", () => {
      img.remove();
      box.classList.remove("has-image");
    });
    img.src = e.image.url;
    box.append(img);
  }
  return box;
}
const mobileFilters = matchMedia("(max-width: 720px)");
let filtersExpanded = false;
function updateFilters() {
  const count = ["region", "type", "month"].filter((id) => $(id).value).length;
  $("reset").hidden = !count && !$("search").value.trim();
  $("toggle-filters").textContent = count ? `Фильтры · ${count}` : "Фильтры";
  $("toggle-filters").setAttribute("aria-expanded", String(filtersExpanded));
  $("filter-options").hidden = mobileFilters.matches && !filtersExpanded;
}
$("toggle-filters").addEventListener("click", () => {
  filtersExpanded = !filtersExpanded;
  updateFilters();
});
mobileFilters.addEventListener("change", updateFilters);
updateFilters();
function render() {
  updateFilters();
  $("saved-count").textContent = saved.size;
  document
    .querySelectorAll("[data-view]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.view === view)),
    );
  if (!loaded) return;
  const filtered = events.filter(matches);
  $("count").textContent = String(filtered.length);
  $("count").setAttribute("aria-label", `Найдено игр: ${filtered.length}`);
  $("empty").hidden = filtered.length > 0;
  $("events").replaceChildren();
  $("more").hidden = filtered.length <= limit;
  $("empty-title").textContent = !ready
    ? "Календарь готовится"
    : view === "saved" && !saved.size
      ? "Здесь будут ваши планы"
      : "Игр не найдено";
  $("empty-description").textContent = !ready
    ? "Первая загрузка данных ещё не завершена. Зайдите немного позже."
    : view === "saved" && !saved.size
      ? "Нажмите на звезду рядом с игрой, чтобы сохранить её."
      : "Попробуйте другой период, регион или сбросьте фильтры.";
  let previousMonth = "";
  for (const e of filtered.slice(0, limit)) {
    const month = e.start_date?.slice(0, 7) || "unknown";
    if (month !== previousMonth) {
      $("events").append(
        element(
          "h2",
          "month-title",
          month === "unknown"
            ? "Без точной даты"
            : day(e.start_date, { month: "long", year: "numeric" }),
        ),
      );
      previousMonth = month;
    }
    const card = element(
      "article",
      "event" + (/отмен/i.test(e.status) ? " cancelled" : ""),
    );
    card.dataset.eventId = e.id;
    const date = element("div", "date-box");
    date.setAttribute("aria-label", range(e));
    date.append(
      element(
        "strong",
        "",
        e.start_date ? String(Number(e.start_date.slice(8))) : "—",
      ),
      element(
        "small",
        "",
        e.start_date ? day(e.start_date, { month: "short" }) : "дата",
      ),
    );
    const main = element("div", "event-main");
    const title = element("button", "event-title", e.name);
    title.addEventListener("click", () => openEvent(e));
    main.append(title);
    const meta = element("div", "event-meta");
    meta.append(element("span", "", e.region || "Регион уточняется"));
    meta.append(element("span", "", range(e)));
    main.append(meta);
    if (e.organizer) main.append(element("p", "event-organizer", e.organizer));
    const favorite = element(
      "button",
      "icon-button",
      saved.has(e.id) ? "★" : "☆",
    );
    favorite.setAttribute(
      "aria-label",
      (saved.has(e.id) ? "Убрать из избранного: " : "В избранное: ") + e.name,
    );
    favorite.setAttribute("aria-pressed", String(saved.has(e.id)));
    favorite.addEventListener("click", () => {
      toggleSaved(e.id);
      document.querySelector(`[data-event-id="${e.id}"] .icon-button`)?.focus();
    });
    const heading = element("div", "event-heading");
    heading.append(date, tags(e), favorite);
    card.append(artwork(e), heading, main);
    $("events").append(card);
  }
}
function openEvent(e) {
  active = e;
  document.querySelector(".detail-art")?.remove();
  document.querySelector(".art-credit")?.remove();
  if (e.image) {
    $("detail-title").before(artwork(e, true));
    const source = externalUrl(e.image.source_url);
    if (source) {
      const credit = element(
        "a",
        "art-credit",
        "Изображение сообщества · ВКонтакте ↗",
      );
      credit.href = source;
      credit.target = "_blank";
      credit.rel = "noopener noreferrer";
      document.querySelector(".detail-art").after(credit);
    }
  }
  $("detail-title").textContent = e.name;
  $("detail-date").textContent = range(e);
  $("detail-tags").replaceChildren(tags(e));
  $("detail-info").replaceChildren();
  for (const [name, value] of [
    ["Регион", e.region],
    ["Полигон", e.venue],
    ["Организаторы", e.organizer],
    ["Игроков", e.players],
  ])
    if (value !== null && value !== undefined && value !== "")
      $("detail-info").append(
        element("dt", "", name),
        element("dd", "", String(value)),
      );
  $("detail-description").textContent = e.description;
  $("detail-description").hidden = !e.description;
  const website = externalUrl(e.website);
  $("organizer-link").hidden = !website;
  $("organizer-link").href = website || "#";
  $("source-event").href =
    externalUrl(e.source_url) || "https://kogda-igra.ru/";
  $("export").disabled = !e.start_date;
  updateSaveButton();
  history.replaceState(null, "", `#event-${e.id}`);
  if (!$("detail").open) $("detail").showModal();
}
function escapeIcs(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}
function foldIcs(line) {
  let result = "",
    part = "",
    bytes = 0;
  for (const character of line) {
    const size = new TextEncoder().encode(character).length;
    if (bytes + size > 75) {
      result += part + "\r\n";
      part = " ";
      bytes = 1;
    }
    part += character;
    bytes += size;
  }
  return result + part;
}
function downloadCalendar() {
  if (!active?.start_date) return;
  const end = new Date(active.end_date + "T12:00:00Z");
  end.setUTCDate(end.getUTCDate() + 1);
  const text =
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//KvaChat//Game Calendar//RU",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:kogda-igra-${active.id}@kvachat.ru`,
      `DTSTAMP:${new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "")}`,
      `DTSTART;VALUE=DATE:${active.start_date.replaceAll("-", "")}`,
      `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replaceAll("-", "")}`,
      `SUMMARY:${escapeIcs(active.name)}`,
      `LOCATION:${escapeIcs([active.region, active.venue].filter(Boolean).join(", "))}`,
      `DESCRIPTION:${escapeIcs(active.source_url + "\n" + active.status)}`,
      ...(/отмен/i.test(active.status) ? ["STATUS:CANCELLED"] : []),
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(foldIcs)
      .join("\r\n") + "\r\n";
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/calendar;charset=utf-8" }),
  );
  const a = element("a", "");
  a.href = url;
  a.download = `game-${active.id}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function load() {
  loaded = false;
  $("loading").hidden = false;
  $("error").hidden = true;
  $("empty").hidden = true;
  $("events").replaceChildren();
  $("more").hidden = true;
  try {
    const response = await fetch("./api/events");
    if (!response.ok) throw Error("calendar");
    const data = await response.json();
    if (!Array.isArray(data.events)) throw Error("events");
    events = data.events;
    ready = data.ready;
    loaded = true;
    $("updated").textContent = data.updated_at
      ? "Обновлено " +
        new Intl.DateTimeFormat("ru-RU", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(data.updated_at))
      : "Ожидается первая загрузка";
    $("notice").hidden = !ready || (!data.stale && !data.last_attempt_failed);
    $("notice").textContent =
      "Обновление задерживается. Показываем последнюю сохранённую версию; проверьте даты на сайте организаторов.";
    fillSelect(
      "region",
      [...new Set(events.map((e) => e.region).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "ru"))
        .map((v) => [v, v]),
      "Все регионы",
    );
    fillSelect(
      "type",
      [...new Set(events.map((e) => e.type).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "ru"))
        .map((v) => [v, v]),
      "Все форматы",
    );
    fillSelect(
      "month",
      [...new Set(events.map((e) => e.start_date?.slice(0, 7)).filter(Boolean))]
        .sort()
        .map((v) => [v, day(v + "-01", { month: "long", year: "numeric" })]),
      "Любой месяц",
    );
    render();
    const id = Number(location.hash.match(/^#event-(\d+)$/)?.[1]);
    const e = events.find((e) => e.id === id);
    if (e) openEvent(e);
  } catch {
    $("error").hidden = false;
    $("updated").textContent = "Не удалось получить данные";
  } finally {
    $("loading").hidden = true;
  }
}
for (const id of ["search", "region", "type", "month"])
  $(id).addEventListener(id === "search" ? "input" : "change", () => {
    limit = 60;
    render();
  });
document.querySelectorAll("[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    view = b.dataset.view;
    limit = 60;
    render();
  }),
);
$("reset").addEventListener("click", () => {
  for (const id of ["search", "region", "type", "month"]) $(id).value = "";
  limit = 60;
  render();
  $("search").focus();
});
$("more").addEventListener("click", () => {
  limit += 60;
  render();
});
$("retry").addEventListener("click", load);
$("close").addEventListener("click", () => $("detail").close());
$("detail").addEventListener("close", () => {
  active = null;
  history.replaceState(null, "", location.pathname + location.search);
});
$("detail").addEventListener("click", (e) => {
  if (e.target === $("detail")) {
    const r = $("detail").getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      $("detail").close();
  }
});
$("favorite-detail").addEventListener(
  "click",
  () => active && toggleSaved(active.id),
);
$("export").addEventListener("click", downloadCalendar);
$("share").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast("Ссылка скопирована — можно отправить её в чат.");
  } catch {
    toast(
      "Не удалось скопировать. Ссылка на игру находится в адресной строке.",
    );
  }
});
load();
