import { icon } from "./icons.js";
const $ = (id) => document.getElementById(id);
const storageKey = "kvachat.plugin.game-calendar.favorites.v1";
const stateStorageKey = "kvachat.plugin.game-calendar.state.v2";
const layoutStorageKey = "kvachat.plugin.game-calendar.layout.v1";
let events = [],
  saved = new Set(),
  view = "all",
  layout = "calendar",
  calendarMonth = "",
  selectedDate = "",
  limit = 60,
  active = null,
  toastTimer;
let restoredState = null;
let ready = false,
  loaded = false,
  storageAvailable = true;
try {
  const values = JSON.parse(localStorage.getItem(storageKey) || "[]");
  if (Array.isArray(values))
    saved = new Set(values.filter(Number.isSafeInteger));
  restoredState = JSON.parse(localStorage.getItem(stateStorageKey) || "null");
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
      : `${day(e.start_date, { day: "numeric", month: "short" })} — ${day(e.end_date || e.start_date, { day: "numeric", month: "short", year: "numeric" })}`;
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
    (view === "undated" ||
      layout === "calendar" ||
      !$("month").value ||
      (e.start_date?.slice(0, 7) <= $("month").value &&
        (e.end_date || e.start_date)?.slice(0, 7) >= $("month").value)) &&
    (!$("saved-toggle").matches('[aria-pressed="true"]') || saved.has(e.id)) &&
    (view !== "undated" || !e.start_date) &&
    (view !== "upcoming" || !e.end_date || e.end_date >= today())
  );
}
function artwork(e, detail = false) {
  const box = element("div", "event-art" + (detail ? " detail-art" : ""));
  box.setAttribute("aria-hidden", "true");

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
const mobileFilters = matchMedia("(max-width: 959px)");
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
function calendarEvents(filtered, date) {
  return filtered.filter(
    (e) =>
      e.start_date &&
      e.start_date <= date &&
      (e.end_date || e.start_date) >= date,
  );
}
function imageUrl(event) {
  return /^\/plugins\/game-calendar\/images\/[a-f0-9]{64}\.webp$/.test(
    event.image?.url || "",
  )
    ? event.image.url
    : null;
}
function eventImage(event) {
  const url = imageUrl(event);
  if (!url) return null;
  const img = element("img", event.image.kind === "avatar" ? "avatar-art" : "");
  img.src = url;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("error", () => {
    img.closest(".day-event-card")?.classList.remove("has-cover");
    img.remove();
  });
  return img;
}
function vkCommunityUrl(event) {
  for (const value of [event.image?.source_url, event.website]) {
    const source = externalUrl(value);
    if (source && /^(www\.|m\.)?vk\.(com|ru)$/.test(new URL(source).hostname))
      return source;
  }
  if (/^[a-zA-Z0-9_.]{2,100}$/.test(event.vk_group || "")) {
    return (
      "https://vk.com/" +
      (/^\d+$/.test(event.vk_group) ? "club" : "") +
      event.vk_group
    );
  }
  return null;
}
function iconButton(name, label, action) {
  const button = element("button", "icon-button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(icon(name));
  button.addEventListener("click", action);
  return button;
}
function chooseDate(date) {
  selectedDate = date;
  calendarMonth = date.slice(0, 7);
  $("day-stage").scrollTop = 0;
  if ($("month").value) $("month").value = calendarMonth;
  render();
}
function changeMonth(offset) {
  const next = shiftMonth(calendarMonth, offset);
  const last = new Date(
    Number(next.slice(0, 4)),
    Number(next.slice(5)),
    0,
  ).getDate();
  chooseDate(
    next +
      "-" +
      String(Math.min(Number(selectedDate.slice(8)), last)).padStart(2, "0"),
  );
}
function metadata(name, value) {
  const row = element("span", "card-meta-item");
  row.append(icon(name), document.createTextNode(value));
  return row;
}
function renderDayStage(filtered) {
  const stage = $("day-stage");
  const previousScroll = stage.scrollTop;
  stage.replaceChildren();
  const dayEvents = calendarEvents(filtered, selectedDate);
  const heading = element("header", "day-heading");
  heading.append(
    element("h2", "", day(selectedDate, { day: "numeric", month: "long" })),
  );
  const forms = {
    one: "событие",
    few: "события",
    many: "событий",
    other: "событий",
  };
  heading.append(
    element(
      "p",
      "",
      dayEvents.length +
        " " +
        forms[new Intl.PluralRules("ru").select(dayEvents.length)],
    ),
  );
  stage.append(heading);
  if (!dayEvents.length) {
    const empty = element("div", "day-stage-empty");
    empty.append(icon("calendar"), element("p", "", "Нет мероприятий"));
    const upcoming = filtered
      .filter((e) => e.start_date > selectedDate)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
    if (upcoming) {
      const next = element("button", "secondary", "Ближайший день с играми");
      next.addEventListener("click", () => chooseDate(upcoming.start_date));
      empty.append(next);
    }
    stage.append(empty);
  } else {
    const rail = element("div", "day-event-rail");
    rail.setAttribute("aria-label", "Мероприятия");
    rail.tabIndex = 0;
    dayEvents.forEach((event) => {
      const card = element(
        "article",
        "day-event-card" + (imageUrl(event) ? " has-cover" : ""),
      );
      card.dataset.eventId = event.id;
      const hero = element("div", "card-cover");
      const img = eventImage(event);
      if (img) hero.append(img);
      const title = element("h3", "card-title", event.name);
      hero.append(title);
      {
        const open = iconButton("expand", "Подробнее: " + event.name, () =>
          openEvent(event),
        );
        open.classList.add("card-open");
        hero.append(open);
        hero.addEventListener("click", (e) => {
          if (!e.target.closest("button")) openEvent(event);
        });
      }
      const meta = element("div", "card-meta");
      meta.append(metadata("calendar", range(event)));
      if (event.region) meta.append(metadata("location", event.region));
      const favorite = iconButton("star", "Избранное: " + event.name, () => {
        toggleSaved(event.id);
        document
          .querySelector(
            '.day-event-card[data-event-id="' + event.id + '"] .card-favorite',
          )
          ?.focus({ preventScroll: true });
      });
      favorite.classList.add("card-favorite");
      favorite.setAttribute("aria-pressed", String(saved.has(event.id)));
      meta.append(favorite);
      card.append(hero, meta);
      const body = element("div", "card-body");
      if (event.type) {
        const types = element("div", "tags");
        types.append(element("span", "tag", event.type));
        body.append(types);
      }
      const bottom = element("div", "card-bottom");
      const actions = element("div", "card-actions");
      actions.append(
        iconButton("info", "Подробнее: " + event.name, () => openEvent(event)),
      );
      const vk = vkCommunityUrl(event);
      if (vk) {
        const link = element("a", "icon-button primary");
        link.href = vk;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.title = "Открыть сообщество VK";
        link.setAttribute("aria-label", "Открыть сообщество VK");
        link.append(icon("expand"));
        actions.append(link);
      }
      bottom.append(actions);
      body.append(bottom);
      card.append(body);
      if (warning(event))
        card.append(element("span", "card-status", event.status));
      rail.append(card);
    });
    stage.append(rail);
  }
  const unknown = filtered.filter((e) => !e.start_date).length;
  if (unknown) {
    const button = element(
      "button",
      "quiet undated-link",
      "Без даты · " + unknown,
    );
    button.addEventListener("click", () => {
      view = "undated";
      $("period").value = view;
      $("month").value = "";
      layout = "feed";
      render();
    });
    stage.append(button);
  }
  stage.scrollTop = previousScroll;
}
function renderMonthGrid(filtered) {
  const grid = $("month-grid"),
    previousMonth = grid.dataset.month,
    previousScroll = grid.scrollLeft;
  grid.dataset.month = calendarMonth;
  grid.replaceChildren();
  const mobile = mobileFilters.matches;
  grid.classList.toggle("week-rail", mobile);
  const first = calendarDate(calendarMonth + "-01");
  const last = calendarDate(shiftMonth(calendarMonth, 1) + "-01");
  last.setUTCDate(0);
  const offset = (first.getUTCDay() + 6) % 7,
    count = mobile
      ? last.getUTCDate()
      : Math.ceil((offset + last.getUTCDate()) / 7) * 7;
  const start = new Date(first);
  if (!mobile) start.setUTCDate(1 - offset);
  if (!mobile)
    for (const weekday of calendarWeekdays)
      grid.append(element("span", "weekday", weekday));
  grid.style.setProperty("--weeks", String(count / 7));
  for (let i = 0; i < count; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const iso = isoDate(date),
      dayEvents = calendarEvents(filtered, iso);
    const cell = element(
      "button",
      "calendar-day" +
        (iso.slice(0, 7) !== calendarMonth ? " outside" : "") +
        (iso === selectedDate ? " selected" : "") +
        (iso === today() ? " today" : ""),
    );
    cell.type = "button";
    cell.dataset.date = iso;
    cell.setAttribute(
      "aria-label",
      day(iso, { day: "numeric", month: "long", year: "numeric" }) +
        ", событий: " +
        dayEvents.length,
    );
    cell.setAttribute("aria-pressed", String(iso === selectedDate));
    if (iso === today()) cell.setAttribute("aria-current", "date");
    cell.append(element("span", "calendar-date", String(date.getUTCDate())));
    if (mobile)
      cell.append(
        element(
          "span",
          "calendar-weekday",
          calendarWeekdays[(date.getUTCDay() + 6) % 7],
        ),
      );
    const banners = element("span", "calendar-day-banners");
    const previews = dayEvents
      .filter((e) => imageUrl(e))
      .slice(0, mobile ? 2 : 3);
    for (const event of previews) {
      const banner = element("span", "calendar-banner");
      const img = eventImage(event);
      if (img) banner.append(img);
      banners.append(banner);
    }
    if (dayEvents.length > previews.length)
      banners.append(
        element(
          "span",
          "calendar-overflow",
          previews.length
            ? "+" + (dayEvents.length - previews.length)
            : String(dayEvents.length),
        ),
      );
    cell.append(banners);
    cell.addEventListener("click", () => {
      chooseDate(iso);
      $("month-grid")
        .querySelector('[data-date="' + iso + '"]')
        ?.focus({ preventScroll: true });
    });
    cell.addEventListener("keydown", (e) => {
      const offsets = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
      };
      if (offsets[e.key]) {
        e.preventDefault();
        const next = new Date(date);
        next.setUTCDate(next.getUTCDate() + offsets[e.key]);
        chooseDate(isoDate(next));
        $("month-grid")
          .querySelector('[data-date="' + selectedDate + '"]')
          ?.focus({ preventScroll: true });
      }
    });
    grid.append(cell);
  }
  if (mobile) {
    grid.scrollLeft = previousMonth === calendarMonth ? previousScroll : 0;
    const selected = grid.querySelector(".selected");
    if (selected) {
      const box = selected.getBoundingClientRect(),
        outer = grid.getBoundingClientRect();
      if (box.left < outer.left || box.right > outer.right)
        grid.scrollLeft +=
          box.left - outer.left - (grid.clientWidth - box.width) / 2;
    }
  }
}
function renderCalendar(filtered) {
  if (!selectedDate) selectedDate = today();
  if (!calendarMonth) calendarMonth = selectedDate.slice(0, 7);
  $("calendar-month").textContent = monthLabel(calendarMonth).replace(
    " г.",
    "",
  );
  renderDayStage(filtered);
  renderMonthGrid(filtered);
}
function saveViewState() {
  try {
    localStorage.setItem(layoutStorageKey, layout);
    localStorage.setItem(
      stateStorageKey,
      JSON.stringify({
        date: selectedDate,
        filters: Object.fromEntries(
          ["search", "region", "type", "month", "period"].map((id) => [
            id,
            $(id).value,
          ]),
        ),
        saved: $("saved-toggle").getAttribute("aria-pressed") === "true",
      }),
    );
  } catch {
    /* Session state remains available without storage. */
  }
}
function updateFilters() {
  const count =
    ["region", "type", "month"].filter((id) => $(id).value).length +
    (view !== "all" ? 1 : 0);
  $("reset").hidden = !count && !$("search").value.trim();
  $("filter-count").hidden = !count;
  $("filter-count").textContent = count;
  $("toggle-filters").setAttribute("aria-expanded", String(filtersExpanded));
  $("filter-options").hidden = !filtersExpanded;
}
$("toggle-filters").addEventListener("click", () => {
  filtersExpanded = !filtersExpanded;
  updateFilters();
  if (filtersExpanded) $("region").focus();
});
$("filter-close").addEventListener("click", () => {
  filtersExpanded = false;
  updateFilters();
  $("toggle-filters").focus();
});
$("saved-toggle").addEventListener("click", () => {
  $("saved-toggle").setAttribute(
    "aria-pressed",
    String($("saved-toggle").getAttribute("aria-pressed") !== "true"),
  );
  render();
});
updateFilters();
function render() {
  updateFilters();
  document.body.classList.toggle("calendar-mode", layout === "calendar");
  if (!loaded) return;
  const filtered = events.filter(matches);
  saveViewState();
  $("empty").hidden = (layout === "calendar" && ready) || filtered.length > 0;
  $("events").replaceChildren();
  $("calendar").hidden = layout !== "calendar" || !ready;
  $("events").hidden = layout === "calendar";
  $("more").hidden = layout === "calendar" || filtered.length <= limit;
  $("layout-toggle").replaceChildren(
    icon(layout === "calendar" ? "calendar" : "menu"),
  );
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
  if (layout === "calendar" && ready) {
    renderCalendar(filtered);
    saveViewState();
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
    const favorite = element("button", "icon-button");
    favorite.append(icon("star"));
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
  $("calendar").hidden = true;
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
    if (restoredState) {
      const date = restoredState.date;
      if (
        /^20\d{2}-\d{2}-\d{2}$/.test(date || "") &&
        !Number.isNaN(Date.parse(date))
      ) {
        selectedDate = date;
        calendarMonth = date.slice(0, 7);
      }
      for (const id of ["search", "region", "type", "month", "period"]) {
        const value = restoredState.filters?.[id];
        if (typeof value === "string") $(id).value = value;
      }
      view = $("period").value || "all";
      $("saved-toggle").setAttribute(
        "aria-pressed",
        String(restoredState.saved === true),
      );
      restoredState = null;
    }
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
for (const id of ["search", "region", "type", "month", "period"])
  $(id).addEventListener(id === "search" ? "input" : "change", () => {
    if (id === "period") {
      view = $("period").value;
      if (view === "undated") layout = "feed";
    }
    if (id === "month" && $("month").value) {
      calendarMonth = $("month").value;
      selectedDate = calendarMonth + "-01";
    }
    limit = 60;
    $("day-stage").scrollTop = 0;
    render();
  });
$("reset").addEventListener("click", () => {
  for (const id of ["search", "region", "type", "month"]) $(id).value = "";
  view = "all";
  $("period").value = "all";
  limit = 60;
  render();
});
$("more").addEventListener("click", () => {
  limit += 60;
  render();
});
function closeLayout() {
  $("layout-menu").hidden = true;
  $("layout-toggle").setAttribute("aria-expanded", "false");
}
$("layout-toggle").addEventListener("click", () => {
  const menu = $("layout-menu");
  menu.hidden = !menu.hidden;
  $("layout-toggle").setAttribute("aria-expanded", String(!menu.hidden));
  if (!menu.hidden) menu.querySelector("button").focus();
});
document.querySelectorAll("[data-layout]").forEach((button) =>
  button.addEventListener("click", () => {
    layout = button.dataset.layout;
    if (layout === "calendar" && view === "undated") {
      view = "all";
      $("period").value = "all";
    }
    closeLayout();
    render();
    $("layout-toggle").focus();
  }),
);
$("calendar-prev").addEventListener("click", () => changeMonth(-1));
$("calendar-next").addEventListener("click", () => changeMonth(1));
$("calendar-today").addEventListener("click", () => chooseDate(today()));
$("calendar-month").addEventListener("click", () => {
  $("date-input").value = selectedDate;
  $("date-picker").showModal();
});
$("date-close").addEventListener("click", () => $("date-picker").close());
$("date-form").addEventListener("submit", (e) => {
  e.preventDefault();
  chooseDate($("date-input").value);
  $("date-picker").close();
});
$("info-toggle").addEventListener("click", () => {
  closeLayout();
  $("source-info").showModal();
});
$("info-close").addEventListener("click", () => $("source-info").close());
document.addEventListener("click", (e) => {
  if (!e.target.closest(".layout-switcher")) closeLayout();
  if (
    !e.target.closest("#filter-options") &&
    !e.target.closest("#toggle-filters")
  ) {
    filtersExpanded = false;
    updateFilters();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$("layout-menu").hidden) {
      closeLayout();
      $("layout-toggle").focus();
    }
    if (filtersExpanded) {
      filtersExpanded = false;
      updateFilters();
      $("toggle-filters").focus();
    }
  }
});
mobileFilters.addEventListener("change", () => {
  if (layout === "calendar") render();
});
document
  .querySelectorAll("[data-icon]")
  .forEach((node) => node.replaceChildren(icon(node.dataset.icon)));
$("close").replaceChildren(icon("close"));
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
