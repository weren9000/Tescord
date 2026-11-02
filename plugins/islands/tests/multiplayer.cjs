const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { chromium } = require("../../../frontend/node_modules/playwright");

async function main() {
  const repo = path.resolve(__dirname, "../../..");
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const python =
    process.env.ISLANDS_TEST_PYTHON ||
    path.join(
      repo,
      "backend/.venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
  const server = spawn(
    python,
    [path.join(__dirname, "serve_fixture.py"), "--port", String(port)],
    {
      cwd: repo,
      env: { ...process.env, PYTHONPATH: path.join(repo, "plugins/islands") },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let serverErrors = "";
  server.stderr.on("data", (chunk) => (serverErrors += chunk));
  let browser;
  try {
    const origin = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await fetch(origin + "/health")).ok) break;
      } catch {}
      if (server.exitCode !== null)
        throw new Error("Fixture stopped: " + serverErrors);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ headless: true });
    const contexts = await Promise.all(
      [0, 1, 2].map(() =>
        browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      ),
    );
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    const errors = [];
    pages.forEach((page) =>
      page.on("pageerror", (exc) => errors.push(exc.message)),
    );
    for (let i = 0; i < pages.length; i++)
      await pages[i].goto(origin + "/_test/?player=" + i);
    const frames = pages.map((p) => p.frameLocator("iframe"));
    await frames[0]
      .getByRole("button", { name: "Создать партию", exact: true })
      .click();
    await frames[0].locator(".room-code").waitFor();
    const code = await frames[0].locator(".room-code").textContent();
    for (let i = 1; i < 3; i++) {
      await frames[i].getByLabel("Код приглашения").fill(code);
      await frames[i]
        .getByRole("button", { name: "Присоединиться", exact: true })
        .click();
      await frames[i]
        .getByRole("button", { name: "Я готов", exact: true })
        .waitFor();
    }
    await frames[0].locator(".player").filter({ hasText: "Вера" }).waitFor();
    const output = path.join(repo, "artifacts/islands-multiplayer");
    fs.mkdirSync(output, { recursive: true });
    await pages[0].screenshot({
      path: path.join(output, "lobby.png"),
      fullPage: true,
    });
    for (const f of frames)
      await f.locator(".player").filter({ hasText: "Вера" }).waitFor();
    for (let i = 0; i < 3; i++) {
      await frames[i]
        .getByRole("button", { name: "Я готов", exact: true })
        .click();
      for (const f of frames)
        await f
          .locator(".player")
          .filter({ hasText: ["Аня", "Борис", "Вера"][i] })
          .getByText("Готов к игре", { exact: true })
          .waitFor();
    }
    await frames[0]
      .getByRole("button", { name: "Начать партию", exact: true })
      .click();
    for (const frame of frames) await frame.locator("#board").waitFor();
    for (let step = 0; step < 12; step++) {
      let active = -1;
      for (let attempt = 0; attempt < 50 && active < 0; attempt++) {
        for (let i = 0; i < 3; i++)
          if (await frames[i].locator("#board .target").count()) {
            active = i;
            break;
          }
        if (active < 0)
          await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.notEqual(
        active,
        -1,
        "Current player must have a legal setup target",
      );
      const frame = frames[active];
      await frame.locator("#board .target").first().click();
      if (step === 0) {
        assert.match(
          await frame.locator(".pending").innerText(),
          /Порт:|Без порта/,
        );
        await pages[active].setViewportSize({ width: 393, height: 851 });
        await pages[active].screenshot({
          path: path.join(output, "placement-port-mobile.png"),
        });
        await pages[active].setViewportSize({ width: 1440, height: 900 });
      }
      await frame
        .locator(".pending")
        .getByRole("button", { name: "Подтвердить", exact: true })
        .click();
      await frame.locator(".pending").waitFor({ state: "hidden" });
    }
    let roller = -1;
    for (let attempt = 0; attempt < 40 && roller < 0; attempt++) {
      for (let i = 0; i < 3; i++)
        if (
          await frames[i]
            .getByRole("button", { name: "Бросить кубики", exact: true })
            .count()
        ) {
          roller = i;
          break;
        }
      if (roller < 0) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.notEqual(roller, -1);
    const frame = frames[roller];
    await frame
      .getByRole("button", { name: "Бросить кубики", exact: true })
      .click();
    // A first-turn seven has no discards; the initial hand has at most 3 cards.
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const robber = frame.locator(".tile-hit.available");
      if (await robber.count()) {
        await robber.first().click();
        await frame
          .locator(".pending")
          .getByRole("button", { name: "Подтвердить", exact: true })
          .click();
      }
      const steal = frame.getByRole("button", { name: /^Забрать карту · / });
      if (await steal.count()) await steal.first().click();
    }
    await frame
      .getByRole("button", { name: "Завершить ход", exact: true })
      .waitFor();
    // Exercise a real offer and rejection without changing the fixture's hands.
    const handsBefore = await Promise.all(
      frames.map((f) =>
        f
          .locator(".resource-card")
          .evaluateAll((cards) =>
            cards.map((c) => c.getAttribute("aria-label")),
          ),
      ),
    );
    const resourceLabels = ["Древесина", "Кирпич", "Шерсть", "Зерно", "Руда"];
    const giveIndex = handsBefore[roller].findIndex(
      (label) => Number(label.split(": ")[1]) > 0,
    );
    assert.notEqual(giveIndex, -1);
    const recipient = (roller + 1) % 3;
    const recipientName = ["Аня", "Борис", "Вера"][recipient];
    await frame
      .getByRole("button", { name: "Предложить обмен", exact: true })
      .click();
    await frame
      .getByLabel("Отдаю · " + resourceLabels[giveIndex], { exact: true })
      .fill("1");
    await frame
      .getByLabel("Получаю · " + resourceLabels[(giveIndex + 1) % 5], {
        exact: true,
      })
      .fill("1");
    await frame
      .getByRole("combobox", { name: "Кому предложить", exact: true })
      .selectOption({ label: recipientName });
    await frame
      .getByRole("button", { name: "Предложить", exact: true })
      .click();
    await frames[recipient]
      .getByRole("button", { name: "Отказаться", exact: true })
      .click();
    await frame
      .getByText("Отказ от обмена: " + recipientName, { exact: true })
      .waitFor();
    await pages[roller].screenshot({
      path: path.join(output, "trade-declined.png"),
    });
    assert.deepEqual(
      await Promise.all(
        frames.map((f) =>
          f
            .locator(".resource-card")
            .evaluateAll((cards) =>
              cards.map((c) => c.getAttribute("aria-label")),
            ),
        ),
      ),
      handsBefore,
    );
    await frame
      .getByRole("button", { name: "Отменить предложение", exact: true })
      .click();
    await frame.locator(".trade-summary").waitFor({ state: "hidden" });
    await pages[roller].setViewportSize({ width: 320, height: 900 });
    await frame
      .getByRole("button", { name: "Обмен с банком", exact: true })
      .click();
    const bankDialog = frame.getByRole("dialog");
    for (const label of resourceLabels)
      assert.match(
        await bankDialog.innerText(),
        new RegExp(label + " [234]:1"),
      );
    assert.equal(
      await bankDialog.evaluate((node) => node.scrollWidth > node.clientWidth),
      false,
    );
    await pages[roller].screenshot({
      path: path.join(output, "bank-rates-320.png"),
    });
    await pages[roller].keyboard.press("Escape");
    await bankDialog.waitFor({ state: "hidden" });
    await pages[roller].setViewportSize({ width: 1440, height: 900 });
    await pages[roller].screenshot({
      path: path.join(output, "board-desktop.png"),
    });
    assert.equal(
      new Set(
        await frame
          .locator("#board image[clip-path]")
          .evaluateAll((images) => images.map((i) => i.getAttribute("href"))),
      ).size,
      19,
    );
    for (const width of [1024, 393, 320]) {
      await pages[roller].setViewportSize({ width, height: 900 });
      await pages[roller].screenshot({
        path: path.join(output, `board-${width}.png`),
      });
      const overflow = await frame
        .locator("body")
        .evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `No horizontal overflow at ${width}`);
    }
    await frame
      .getByRole("button", { name: "Переключить тему", exact: true })
      .click();
    await pages[roller].screenshot({
      path: path.join(output, "board-light-320.png"),
    });
    await frame
      .locator(".hand")
      .evaluate((node) => node.scrollIntoView({ block: "start" }));
    await pages[roller].screenshot({
      path: path.join(output, "hand-light-320.png"),
    });
    await frame.getByRole("button", { name: "Правила", exact: true }).click();
    await frame.getByRole("dialog").waitFor();
    await pages[roller].keyboard.press("Escape");
    await frame.getByRole("dialog").waitFor({ state: "hidden" });
    // Losing the entire page also loses the in-memory token; the parent issues
    // a new scoped grant, then the durable room can be reopened.
    await pages[roller].reload();
    await frames[roller].locator(".room-entry").first().click();
    await frames[roller].locator("#board").waitFor();
    assert.equal(await frames[roller].locator("#board .tile-hit").count(), 19);
    await frames[roller]
      .getByRole("button", { name: "Завершить ход", exact: true })
      .click();
    for (const f of frames)
      await f
        .locator(".turn-banner")
        .filter({ hasNotText: "Кубики:" })
        .waitFor();
    await frames[roller]
      .getByRole("button", { name: "Пауза", exact: true })
      .click();
    for (const f of frames)
      await f.getByRole("heading", { name: /^Пауза · / }).waitFor();
    await frames[roller]
      .getByRole("button", { name: "Продолжить партию", exact: true })
      .click();
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        result: "PASS",
        players: 3,
        setupActions: 12,
        viewports: [1440, 1024, 393, 320],
        reconnect: true,
        tradeDecline: true,
        bankRatesInDialog: true,
        diceClearedForNextTurn: true,
        browserErrors: errors,
        artifacts: output,
      }),
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
    await new Promise((resolve) => {
      if (server.exitCode !== null) return resolve();
      server.once("exit", resolve);
      setTimeout(resolve, 5000);
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
