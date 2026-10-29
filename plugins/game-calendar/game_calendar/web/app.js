const $ = (id) => document.getElementById(id);
const storageKey = "kvachat.plugin.game-calendar.favorites.v1";
const layoutStorageKey = "kvachat.plugin.game-calendar.layout.v1";
let events = [],
  saved = new Set(),
  view = "upcoming",
  layout = "feed",
  calendarMonth = "",
  selectedDate = "",
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
  const storedLayout = localStorage.getItem(layoutStorageKey);
  if (["feed", "calendar"].includes(storedLayout)) layout = storedLayout;
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
const calendarWeekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const calendarDate = (value) => new Date(value + "T12:00:00Z");
const isoDate = (date) => date.toISOString().slice(0, 10);
const monthLabel = (month) =>
  day(month + "-01", { month: "long", year: "numeric" });
const shiftMonth = (month, offset) => {
  const date = calendarDate(month + "-01");
  date.setUTCMonth(date.getUTCMonth() + offset);
  return isoDate(date).slice(0, 7);
};
function activeCalendarMonth(filtered) {
  const selected = $("month").value;
  if (selected) return selected;
  if (calendarMonth) return calendarMonth;
  const current = today().slice(0, 7);
  return filtered.some((e) => e.start_date?.startsWith(current))
    ? current
    : filtered.find((e) => e.start_date)?.start_date.slice(0, 7) || current;
}
function calendarEvents(filtered, date) {
  return filtered.filter((e) => e.start_date === date);
}
function selectCalendarDate(filtered, date) {
  const month = activeCalendarMonth(filtered);
  const first = filtered.find((e) =>
    e.start_date?.startsWith(month),
  )?.start_date;
  selectedDate = calendarEvents(filtered, date).length
    ? date
    : first || `${month}-01`;
}
function vkCommunityUrl(event) {
  const source = externalUrl(event.image?.source_url);
  if (!source) return null;
  const host = new URL(source).hostname.toLowerCase();
  return [
    "vk.com",
    "vk.ru",
    "www.vk.com",
    "www.vk.ru",
    "m.vk.com",
    "m.vk.ru",
  ].includes(host)
    ? source
    : null;
}
function calendarBanner(event, compact = false) {
  const button = element(
    "button",
    "calendar-banner" + (compact ? " compact" : ""),
  );
  button.type = "button";
  button.style.setProperty(
    "--image",
    event.image?.url ? `url("${event.image.url}")` : "none",
  );
  button.setAttribute("aria-label", `Открыть игру: ${event.name}`);
  button.append(element("span", "calendar-banner-title", event.name));
  if (!compact && event.type)
    button.append(element("span", "calendar-banner-type", event.type));
  button.addEventListener("click", () => openEvent(event));
  return button;
}
function renderDayStage(filtered) {
  const stage = $("day-stage");
  const dayEvents = calendarEvents(filtered, selectedDate);
  stage.replaceChildren();
  const heading = element(
    "h2",
    "day-stage-title",
    selectedDate
      ? day(selectedDate, { day: "numeric", month: "long" })
      : "Выберите день",
  );
  stage.append(heading);
  if (!dayEvents.length) {
    stage.append(element("p", "day-stage-empty", "В этот день игр нет."));
    return;
  }
  const rail = element("div", "day-event-rail");
  for (const event of dayEvents) {
    const card = element("article", "day-event-card");
    card.style.setProperty(
      "--image",
      event.image?.url ? `url("${event.image.url}")` : "none",
    );
    const open = element("button", "day-event-open", event.name);
    open.type = "button";
    open.addEventListener("click", () => openEvent(event));
    const meta = element(
      "p",
      "day-event-meta",
      [event.type, event.region].filter(Boolean).join(" · "),
    );
    card.append(open, meta);
    rail.append(card);
  }
  stage.append(rail);
}
function renderMonthGrid(filtered) {
  const grid = $("month-grid");
  grid.replaceChildren();
  const mobile = matchMedia("(max-width: 720px)").matches;
  grid.classList.toggle("week-rail", mobile);
  if (!mobile)
    for (const weekday of calendarWeekdays)
      grid.append(element("span", "weekday", weekday));
  const first = calendarDate(calendarMonth + "-01");
  const start = mobile ? calendarDate(selectedDate) : new Date(first);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  for (let index = 0; index < (mobile ? 7 : 42); index += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const iso = isoDate(date);
    const dayEvents = calendarEvents(filtered, iso);
    const cell = element(
      "div",
      "calendar-day" +
        (iso.slice(0, 7) !== calendarMonth ? " outside" : "") +
        (iso === selectedDate ? " selected" : ""),
    );
    cell.tabIndex = 0;
    cell.setAttribute("role", "button");
    cell.setAttribute(
      "aria-label",
      `${day(iso, { day: "numeric", month: "long" })}${dayEvents.length ? `, игр: ${dayEvents.length}` : ""}`,
    );
    cell.append(element("span", "calendar-date", String(date.getUTCDate())));
    const banners = element("span", "calendar-day-banners");
    for (const event of dayEvents.slice(0, 2))
      banners.append(calendarBanner(event, true));
    if (dayEvents.length > 2)
      banners.append(
        element("span", "calendar-overflow", `+${dayEvents.length - 2}`),
      );
    cell.append(banners);
    cell.addEventListener("click", (click) => {
      if (click.target.closest(".calendar-banner")) return;
      calendarMonth = iso.slice(0, 7);
      selectedDate = iso;
      render();
    });
    cell.addEventListener("keydown", (key) => {
      if (key.key === "Enter" || key.key === " ") {
        key.preventDefault();
        cell.click();
      }
    });
    grid.append(cell);
  }
  if (mobile) {
    const selected = grid.querySelector(".calendar-day.selected");
    if (selected)
      grid.scrollLeft = Math.max(
        0,
        selected.offsetLeft - (grid.clientWidth - selected.clientWidth) / 2,
      );
  }
}
function renderCalendar(filtered) {
  calendarMonth = activeCalendarMonth(filtered);
  if (!selectedDate || !selectedDate.startsWith(calendarMonth))
    selectCalendarDate(filtered, `${calendarMonth}-01`);
  $("calendar-month").textContent = monthLabel(calendarMonth);
  renderDayStage(filtered);
  renderMonthGrid(filtered);
}
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
  $("calendar").hidden = layout !== "calendar" || filtered.length === 0;
  $("events").hidden = layout === "calendar";
  $("more").hidden = layout === "calendar" || filtered.length <= limit;
  $("layout-toggle").textContent = layout === "calendar" ? "▦" : "☷";
  document
    .querySelectorAll("[data-layout]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.layout === layout),
      ),
    );
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
  if (layout === "calendar" && filtered.length) {
    renderCalendar(filtered);
    return;
  }
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
  const vkCommunity = vkCommunityUrl(e);
  $("vk-community").hidden = !vkCommunity;
  $("vk-community").href = vkCommunity || "#";
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
    if (id === "month") calendarMonth = $("month").value;
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
$("layout-toggle").addEventListener("click", () => {
  const menu = $("layout-menu");
  menu.hidden = !menu.hidden;
  $("layout-toggle").setAttribute("aria-expanded", String(!menu.hidden));
});
document.querySelectorAll("[data-layout]").forEach((button) =>
  button.addEventListener("click", () => {
    layout = button.dataset.layout;
    try {
      localStorage.setItem(layoutStorageKey, layout);
    } catch {
      storageAvailable = false;
    }
    $("layout-menu").hidden = true;
    $("layout-toggle").setAttribute("aria-expanded", "false");
    render();
  }),
);
$("calendar-prev").addEventListener("click", () => {
  calendarMonth = shiftMonth(calendarMonth || today().slice(0, 7), -1);
  selectedDate = "";
  render();
});
$("calendar-next").addEventListener("click", () => {
  calendarMonth = shiftMonth(calendarMonth || today().slice(0, 7), 1);
  selectedDate = "";
  render();
});
$("calendar-today").addEventListener("click", () => {
  calendarMonth = today().slice(0, 7);
  selectedDate = today();
  render();
});
$("calendar-month").addEventListener("click", () => {
  const select = $("month");
  select.value = calendarMonth;
  if (typeof select.showPicker === "function") {
    select.showPicker();
    return;
  }
  filtersExpanded = true;
  updateFilters();
  select.focus();
});
document.addEventListener("click", (click) => {
  if (!click.target.closest(".layout-switcher")) {
    $("layout-menu").hidden = true;
    $("layout-toggle").setAttribute("aria-expanded", "false");
  }
});
mobileFilters.addEventListener("change", () => {
  if (layout === "calendar") render();
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
