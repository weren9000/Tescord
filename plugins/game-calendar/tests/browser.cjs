const {
  chromium,
  expect,
} = require("../../../frontend/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = "http://127.0.0.1:8012/plugins/game-calendar/";
const output = "artifacts/game-calendar";
const image = {
  url: "/plugins/game-calendar/images/" + "a".repeat(64) + ".webp",
  kind: "cover",
  source_url: "https://vk.com/club42",
};
const fixture = {
  id: 1,
  name: "Лес, легенды; новая глава",
  region: "Урал",
  type: "Полевая",
  status: "Заявлена",
  start_date: "2026-10-22",
  end_date: "2026-10-24",
  organizer: "Мастера",
  description: "<img src=x onerror=alert(1)>",
  website: "https://example.test",
  source_url: "https://kogda-igra.ru/game/1/",
  image,
};
const events = [
  fixture,
  {
    ...fixture,
    id: 2,
    name: "Конвент",
    region: "Москва",
    type: "Конвент",
    image: null,
  },
  {
    ...fixture,
    id: 3,
    name: "Очень длинное название игры ".repeat(12),
    start_date: "2026-10-23",
    end_date: "2026-11-02",
  },
  {
    ...fixture,
    id: 4,
    name: "Без даты",
    start_date: null,
    end_date: null,
    image: null,
  },
  {
    ...fixture,
    id: 5,
    name: "Один день",
    start_date: "2026-11-12",
    end_date: "2026-11-12",
  },
];
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1536, height: 1024 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: new Date("2026-10-22T12:00:00Z") });
    let mode = "normal";
    await page.route("**/api/events", (route) =>
      mode === "error"
        ? route.fulfill({ status: 503, body: "{}" })
        : route.fulfill({
            json: {
              ready: mode !== "empty",
              stale: mode === "stale",
              updated_at: "2026-10-22T10:00:00Z",
              events: mode === "empty" ? [] : events,
            },
          }),
    );
    await page.route("**/images/*", (route) => route.fulfill({ status: 404 }));
    await page.goto(base);
    await expect(page.locator("#calendar")).toBeVisible();
    await expect(page.locator(".calendar-day")).toHaveCount(35);
    await expect(page.locator(".day-event-card")).toHaveCount(2);
    // The thumbnail must select a day, never open a dialog.
    await page
      .locator('[data-date="2026-10-23"] .calendar-banner')
      .first()
      .click();
    await expect(page.locator("#detail")).not.toBeVisible();
    await expect(page.locator(".day-event-card")).toHaveCount(3);
    await expect(page.locator(".day-heading h2")).toHaveText("23 октября");
    await page.locator('[data-date="2026-10-24"]').click();
    await expect(page.locator(".day-event-card")).toHaveCount(3);
    await page.locator('[data-date="2026-10-25"]').click();
    await expect(page.locator(".day-event-card")).toHaveCount(1);
    await page.locator("#calendar-next").click();
    await expect(page.locator("#calendar-month")).toContainText("ноябрь");
    await expect(page.locator(".calendar-day")).toHaveCount(42);
    await expect(page.locator(".day-stage-empty")).toBeVisible();
    await page.locator("#calendar-prev").click();
    await page.locator("#calendar-today").click();
    await expect(page.locator(".day-heading h2")).toHaveText("22 октября");
    await page.locator(".card-open").first().click();
    await expect(page.locator("#detail")).toBeVisible();
    await expect(page.locator("#detail-description img")).toHaveCount(0);
    await expect(page.locator("#vk-community")).toHaveAttribute(
      "href",
      "https://vk.com/club42",
    );
    const downloaded = page.waitForEvent("download");
    await page.locator("#export").click();
    const content = fs.readFileSync(await (await downloaded).path(), "utf8");
    assert(content.includes("DTEND;VALUE=DATE:20261025"));
    assert(content.includes("SUMMARY:Лес\\, легенды\\; новая глава"));
    await page.keyboard.press("Escape");
    await page.locator(".card-favorite").first().click();
    await expect(page.locator("#detail")).not.toBeVisible();
    await page.locator("#saved-toggle").click();
    await expect(page.locator(".day-event-card")).toHaveCount(1);
    await page.reload();
    await expect(page.locator("#saved-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".day-heading h2")).toHaveText("22 октября");
    await page.locator("#saved-toggle").click();
    await page.locator("#toggle-filters").click();
    await page.locator("#region").selectOption("Москва");
    await expect(page.locator(".day-event-card")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("#filter-options")).toBeHidden();
    await page.locator("#toggle-filters").click();
    await page.locator("#reset").click();
    await page.locator("#filter-close").click();
    await page.locator("#search").fill("легенды мастера");
    await expect(page.locator(".day-event-card")).toHaveCount(1);
    await page.locator("#search").fill("");
    await page.locator("#calendar-month").click();
    await page.locator("#date-input").fill("2026-10-23");
    await page.locator("#date-form button").click();
    await expect(page.locator(".day-event-card")).toHaveCount(3);
    for (const width of [1536, 1024, 959, 768, 430, 393, 360, 320]) {
      await page.setViewportSize({ width, height: 852 });
      const mobile = width < 960;
      await expect(page.locator(".calendar-day")).toHaveCount(mobile ? 31 : 35);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "page overflow " + width,
      );
      if (mobile) {
        const dock = await page.locator(".calendar-panel").boundingBox();
        assert(dock.y + dock.height <= 853, "dock outside viewport");
        await page.locator('[data-date="2026-10-22"]').click();
        await page.locator(".card-cover").first().click();
        await expect(page.locator("#detail")).not.toBeVisible();
        const rail = page.locator(".day-event-rail");
        await rail.evaluate((el) => (el.scrollLeft = el.scrollWidth));
        await page.waitForTimeout(100);
        const before = await rail.evaluate((el) => el.scrollLeft);
        assert(before > 0, "carousel can scroll");
        await page.locator('[data-date="2026-10-23"]').click();
        await expect(page.locator(".day-event-card")).toHaveCount(3);
      }
      await page.screenshot({
        path: output + "/redesign-fixture-" + width + ".png",
      });
    }
    // Month filter must not pin navigation to the old month.
    await page.locator("#toggle-filters").click();
    await page.locator("#month").selectOption("2026-11");
    await page.locator("#filter-close").click();
    await page.locator("#calendar-next").click();
    await expect(page.locator("#calendar-month")).toContainText("декабрь");
    await page.locator("#calendar-prev").click();
    await expect(page.locator("#calendar-month")).toContainText("ноябрь");
    await page.locator("#calendar-month").click();
    await page.locator("#date-input").fill("2026-11-12");
    await page.locator("#date-form button").click();
    await page.reload();
    await expect(page.locator(".day-heading h2")).toHaveText("12 ноября");
    await expect(page.locator(".day-event-card")).toHaveCount(1);
    await page.locator("#calendar-today").click();
    await page.locator(".undated-link").click();
    await expect(page.locator(".event")).toHaveCount(1);
    await page.locator("#toggle-filters").click();
    await page.locator("#reset").click();
    await page.locator("#filter-close").click();
    await expect(page.locator(".event")).toHaveCount(5);
    await page.locator("#layout-toggle").click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#layout-menu")).toBeHidden();
    await page.locator("#layout-toggle").click();
    await page.locator('[data-layout="calendar"]').click();
    mode = "stale";
    await page.reload();
    await expect(page.locator("#notice")).toBeVisible();
    mode = "error";
    await page.reload();
    await expect(page.locator("#error")).toBeVisible();
    await expect(page.locator("#calendar")).toBeHidden();
    mode = "normal";
    await page.locator("#retry").click();
    await expect(page.locator("#calendar")).toBeVisible();
    mode = "empty";
    await page.reload();
    await expect(page.locator("#empty")).toBeVisible();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: day/thumbnail selection, inclusive multi-day dates, month navigation, desktop details, mobile carousel, favorites, persistence, filters, ICS, unknown dates, empty/error/retry, widths 320–1536",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
