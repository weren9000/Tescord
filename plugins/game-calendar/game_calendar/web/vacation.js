import { icon } from "./icons.js";

const key = "kvachat.plugin.game-calendar.vacations.v1";
export const validDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  value >= "2000-01-01" &&
  value <= "2100-12-31" &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
export function createVacation({ changed, notify }) {
  const $ = (id) => document.getElementById(id);
  let intervals = [],
    enabled = false,
    pendingFilter = false,
    initial = "";
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "{}");
    intervals = Array.isArray(stored.intervals)
      ? stored.intervals
          .filter(
            (r) =>
              r && validDate(r.start) && validDate(r.end) && r.start <= r.end,
          )
          .map(({ start, end }) => ({ start, end }))
      : [];
    enabled = stored.enabled === true && intervals.length > 0;
  } catch {
    /* Invalid or unavailable storage starts with an empty list. */
  }
  const contains = (date) =>
    intervals.some((r) => r.start <= date && date <= r.end);
  const overlaps = (event) =>
    !!event.start_date &&
    intervals.some(
      (r) =>
        r.start <= (event.end_date || event.start_date) &&
        r.end >= event.start_date,
    );
  const partial = (event) => {
    if (!overlaps(event)) return false;
    let cursor = event.start_date;
    const end = event.end_date || cursor;
    for (const r of [...intervals].sort((a, b) =>
      a.start.localeCompare(b.start),
    )) {
      if (r.end < cursor) continue;
      if (r.start > cursor) return true;
      if (r.end >= end) return false;
      const next = new Date(r.end + "T12:00:00Z");
      next.setUTCDate(next.getUTCDate() + 1);
      cursor = next.toISOString().slice(0, 10);
    }
    return true;
  };
  function sync() {
    $("vacation-filter").checked = enabled;
    $("vacation-chip").hidden = !enabled;
  }
  function persist(nextIntervals, nextEnabled) {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ intervals: nextIntervals, enabled: nextEnabled }),
      );
      return true;
    } catch {
      return false;
    }
  }
  function setEnabled(value) {
    if (value && !intervals.length) {
      open(true);
      sync();
      return;
    }
    enabled = value;
    if (!persist(intervals, enabled))
      notify(
        "Не удалось сохранить фильтр в браузере. Он действует до закрытия страницы.",
      );
    sync();
    changed(value);
  }
  const rows = () =>
    [...$("vacation-rows").children].map((row) => ({
      start: row.querySelector('[name="start"]').value,
      end: row.querySelector('[name="end"]').value,
    }));
  const snapshot = () => JSON.stringify(rows().filter((r) => r.start || r.end));
  function addRow(value = { start: "", end: "" }) {
    const row = document.createElement("div");
    row.className = "vacation-row";
    for (const [name, title] of [
      ["start", "Начало"],
      ["end", "Окончание"],
    ]) {
      const label = document.createElement("label");
      label.textContent = title;
      const input = document.createElement("input");
      input.type = "date";
      input.name = name;
      input.min = "2000-01-01";
      input.max = "2100-12-31";
      input.value = value[name];
      label.append(input);
      row.append(label);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.title = "Удалить интервал";
    remove.setAttribute("aria-label", remove.title);
    remove.append(icon("trash"));
    remove.addEventListener("click", () => {
      row.remove();
      $("vacation-add").focus();
    });
    row.append(remove);
    $("vacation-rows").append(row);
    return row;
  }
  function open(filter = false) {
    pendingFilter = filter;
    $("vacation-rows").replaceChildren();
    (intervals.length ? intervals : [{ start: "", end: "" }]).forEach(addRow);
    initial = snapshot();
    $("vacation-error").textContent = "";
    $("vacation-dialog").showModal();
    $("vacation-toggle").setAttribute("aria-expanded", "true");
  }
  function close() {
    if (initial !== snapshot() && !confirm("Отменить изменения отпуска?"))
      return;
    $("vacation-dialog").close();
  }
  $("vacation-toggle").addEventListener("click", () => open());
  $("vacation-close").addEventListener("click", close);
  $("vacation-dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  $("vacation-dialog").addEventListener("close", () => {
    pendingFilter = false;
    $("vacation-toggle").setAttribute("aria-expanded", "false");
    $("vacation-toggle").focus();
  });
  $("vacation-add").addEventListener("click", () =>
    addRow().querySelector("input").focus(),
  );
  $("vacation-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const next = rows().filter((r) => r.start || r.end);
    if (
      next.some(
        (r) => !validDate(r.start) || !validDate(r.end) || r.end < r.start,
      )
    ) {
      $("vacation-error").textContent =
        "Заполните обе даты. Окончание не должно быть раньше начала.";
      return;
    }
    const nextEnabled = next.length > 0 && (enabled || pendingFilter);
    if (!persist(next, nextEnabled)) {
      $("vacation-error").textContent =
        "Не удалось сохранить отпуск в браузере. Проверьте настройки хранения и попробуйте ещё раз.";
      return;
    }
    intervals = next;
    enabled = nextEnabled;
    $("vacation-dialog").close();
    sync();
    changed(enabled);
  });
  $("vacation-filter").addEventListener("change", () =>
    setEnabled($("vacation-filter").checked),
  );
  $("vacation-chip").addEventListener("click", () => setEnabled(false));
  sync();
  return {
    get enabled() {
      return enabled;
    },
    contains,
    overlaps,
    partial,
    open,
    setEnabled,
    nextDate(events, from) {
      return events
        .flatMap((event) =>
          event.start_date
            ? intervals
                .map((r) => {
                  const start = [r.start, event.start_date, from].sort().at(-1);
                  return start <= r.end &&
                    start <= (event.end_date || event.start_date)
                    ? start
                    : null;
                })
                .filter(Boolean)
            : [],
        )
        .sort()[0];
    },
  };
}
