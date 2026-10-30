const {
  chromium,
  expect,
} = require("../../../frontend/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = "http://127.0.0.1:8012/plugins/game-calendar/";
const key = "kvachat.plugin.game-calendar.vacations.v1";
const event = (id, start_date, end_date) => ({
  id,
  name: `Игра ${id}`,
  start_date,
  end_date,
  region: "Урал",
  type: "Полевая",
  status: "Заявлена",
});
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1536, height: 1024 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: new Date("2026-10-30T12:00:00Z") });
    await page.route("**/api/events", (route) =>
      route.fulfill({
        json: {
          ready: true,
          events: [
            event(1, "2026-11-08", "2026-11-11"),
            event(2, "2026-11-20", "2026-11-22"),
            event(3, "2026-11-21", "2026-11-21"),
            event(4, null, null),
            event(5, "2026-11-12", "2026-11-12"),
          ],
        },
      }),
    );
    await page.goto(base);
    await expect(page.locator("#calendar")).toBeVisible();
    await page.locator("#toggle-filters").click();
    await page.locator("#vacation-filter").click();
    await expect(page.locator("#vacation-dialog")).toBeVisible();
    const starts = page.locator('#vacation-rows [name="start"]');
    const ends = page.locator('#vacation-rows [name="end"]');
    await starts.first().fill("2026-11-10");
    await ends.first().fill("2026-11-09");
    await page
      .getByRole("button", { name: "Сохранить отпуск", exact: true })
      .click();
    await expect(page.locator("#vacation-error")).toContainText("Окончание");
    await ends.first().fill("2026-11-20");
    await page.locator("#vacation-add").click();
    await page
      .getByRole("button", { name: "Сохранить отпуск", exact: true })
      .click();
    await expect(page.locator("#vacation-dialog")).toBeHidden();
    await expect(page.locator(".calendar-day.selected")).toHaveAttribute(
      "data-date",
      "2026-11-10",
    );
    await expect(page.locator(".vacation-day")).toHaveCount(11);
    await expect(page.locator("#vacation-chip")).toBeVisible();
    await expect(page.locator(".day-event-card")).toHaveCount(1);
    await expect(page.locator(".day-event-card")).toContainText(
      "Частично в отпуске",
    );
    await expect(page.locator(".day-event-card .vacation-tag")).toBeVisible();
    await page.locator('[data-date="2026-11-09"]').click();
    await expect(page.locator(".day-event-card")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Изменить отпуск", exact: true }),
    ).toBeVisible();
    await page.locator('[data-date="2026-11-20"]').click();
    await expect(page.locator(".day-event-card")).toHaveCount(1);
    await page.locator("#layout-toggle").click();
    await page.locator('[data-layout="feed"]').click();
    await expect(page.locator(".event")).toHaveCount(3);
    await page.reload();
    await expect(page.locator(".event")).toHaveCount(3);
    await page.locator("#vacation-toggle").click();
    await starts.first().fill("2026-11-15");
    await page.locator("#vacation-close").focus();
    page.once("dialog", (d) => d.dismiss());
    await page.keyboard.press("Escape");
    await expect(page.locator("#vacation-dialog")).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.keyboard.press("Escape");
    await expect(page.locator("#vacation-dialog")).toBeHidden();
    await page.locator("#toggle-filters").click();
    await page.locator("#period").selectOption("undated");
    await expect(page.locator("#vacation-chip")).toBeHidden();
    await expect(page.locator(".event")).toHaveCount(1);
    await page.locator("#reset").click();
    await expect(page.locator(".event")).toHaveCount(5);
    await page.locator("#layout-toggle").click();
    await page.locator('[data-layout="calendar"]').click();
    await expect(page.locator(".vacation-day")).toHaveCount(11);
    fs.mkdirSync("artifacts/game-calendar", { recursive: true });
    for (const width of [1536, 1024, 393, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: `artifacts/game-calendar/vacation-calendar-${width}.png`,
      });
      await page.locator("#vacation-toggle").click();
      await page.screenshot({
        path: `artifacts/game-calendar/vacation-editor-${width}.png`,
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert(
        await page
          .locator("#vacation-dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      );
      await page.keyboard.press("Escape");
    }
    // Failed writes keep the editor and previously saved dates intact.
    await page.locator("#vacation-toggle").click();
    await starts.first().fill("2026-11-14");
    await page.evaluate(() => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw Error("quota");
      };
    });
    await page
      .getByRole("button", { name: "Сохранить отпуск", exact: true })
      .click();
    await expect(page.locator("#vacation-error")).toContainText(
      "Не удалось сохранить",
    );
    assert.equal(
      await page.evaluate(
        (k) => JSON.parse(localStorage.getItem(k)).intervals[0].start,
        key,
      ),
      "2026-11-10",
    );
    await page.evaluate(() => {
      Storage.prototype.setItem = window.originalSetItem;
    });
    await page
      .getByRole("button", { name: "Удалить интервал", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Сохранить отпуск", exact: true })
      .click();
    await expect(page.locator(".vacation-day")).toHaveCount(0);
    // Adjacent and overlapping intervals cover a full event, without duplicates.
    await page.evaluate(
      (k) =>
        localStorage.setItem(
          k,
          JSON.stringify({
            enabled: true,
            intervals: [
              { start: "2026-11-08", end: "2026-11-09" },
              { start: "2026-11-10", end: "2026-11-11" },
              { start: "2026-11-10", end: "2026-11-10" },
              { start: "2027-12-28", end: "2028-03-01" },
            ],
          }),
        ),
      key,
    );
    await page.reload();
    await page.locator("#layout-toggle").click();
    await page.locator('[data-layout="feed"]').click();
    await expect(page.locator(".event")).toHaveCount(1);
    await expect(page.locator(".event .vacation-tag")).toHaveCount(0);
    await page.locator("#layout-toggle").click();
    await page.locator('[data-layout="calendar"]').click();
    await page.locator("#calendar-month").click();
    await page.locator("#date-input").fill("2028-02-29");
    await page.locator("#date-form button").click();
    await expect(page.locator('[data-date="2028-02-29"]')).toHaveClass(
      /vacation-day/,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: vacation validation, inclusive overlap, partial/full coverage, persistence, cancel, quota error, filtering, leap year, screenshots 320–1536",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
