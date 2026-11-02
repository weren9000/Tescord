// Requires a running emulator with an isolated debug WebView app.
// Never touches the real ru.kvachat.android app. Always closes this emulator.
const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const {
  chromium,
  expect,
} = require("../../../frontend/node_modules/@playwright/test");
const WebSocket = require("../../../frontend/node_modules/ws");
const root = path.resolve(__dirname, "../../..");
const serial = process.env.ISLANDS_TEST_EMULATOR || "emulator-5554";
if (!/^emulator-\d+$/.test(serial))
  throw Error("Only an emulator is supported");
const adb = path.join(root, ".tools/sdk/platform-tools/adb.exe");
const command = (...args) =>
  execFileSync(adb, ["-s", serial, ...args], {
    timeout: 15000,
    windowsHide: true,
  })
    .toString()
    .trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function main() {
  let fixture, mobile, browser, forwardPort, page;
  const packageName = "ru.kvachat.islandscheck";
  const upstreams = new Set();
  try {
    assert.equal(
      command("shell", "pm", "list", "packages", packageName),
      "package:" + packageName,
      "Install the isolated debug test app first",
    );
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    fixture = spawn(
      process.env.ISLANDS_TEST_PYTHON ||
        path.join(root, "backend/.venv/Scripts/python.exe"),
      [path.join(__dirname, "serve_fixture.py"), "--port", String(port)],
      {
        cwd: root,
        env: { ...process.env, PYTHONPATH: path.join(root, "plugins/islands") },
        windowsHide: true,
        stdio: "ignore",
      },
    );
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin + "/health")).ok) break;
      } catch {}
      if (fixture.exitCode !== null) throw Error("Fixture failed to start");
      await delay(100);
    }
    const activity = command(
      "shell",
      "cmd",
      "package",
      "resolve-activity",
      "--brief",
      packageName,
    )
      .split(/\r?\n/)
      .at(-1);
    assert.ok(activity.startsWith(packageName + "/"));
    command("shell", "am", "start", "-n", activity);
    let pid;
    for (let i = 0; i < 40; i++) {
      try {
        pid = command("shell", "pidof", packageName);
        if (/^\d+$/.test(pid)) break;
      } catch {}
      await delay(250);
    }
    assert.match(pid, /^\d+$/);
    forwardPort = await freePort();
    command(
      "forward",
      `tcp:${forwardPort}`,
      "localabstract:webview_devtools_remote_" + pid,
    );
    for (let i = 0; i < 40; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${forwardPort}/json/version`)).ok)
          break;
      } catch {}
      await delay(250);
    }
    mobile = await chromium.connectOverCDP(`http://127.0.0.1:${forwardPort}`, {
      noDefaults: true,
    });
    page = mobile.contexts()[0].pages()[0];
    page.setDefaultTimeout(15000);
    await page.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (
        url.origin !== "https://kvachat.ru" ||
        !url.pathname.startsWith("/plugins/islands/")
      )
        return route.abort();
      const pathname = url.pathname.slice("/plugins/islands".length);
      const response = await fetch(origin + pathname + url.search, {
        method: request.method(),
        headers: { ...request.headers(), host: new URL(origin).host },
        ...(request.postDataBuffer() ? { body: request.postDataBuffer() } : {}),
      });
      const headers = Object.fromEntries(response.headers);
      delete headers["content-length"];
      delete headers["content-encoding"];
      let body = Buffer.from(await response.arrayBuffer());
      if (pathname === "/_test/fixture.js")
        body = Buffer.from(
          body
            .toString()
            .replaceAll("location.origin", "'https://kvachat.ru'")
            .replace(
              "fetch('/_test/grant/'",
              "fetch('https://kvachat.ru/plugins/islands/_test/grant/'",
            ),
        );
      await route.fulfill({
        status: response.status,
        headers,
        body,
      });
    });
    await page.routeWebSocket(
      "wss://kvachat.ru/plugins/islands/**",
      (socket) => {
        const url = new URL(socket.url());
        const upstream = new WebSocket(
          origin.replace("http:", "ws:") +
            url.pathname.slice("/plugins/islands".length),
          { headers: { Origin: "https://kvachat.ru" } },
        );
        upstreams.add(upstream);
        const pending = [];
        socket.onMessage((message) =>
          upstream.readyState === WebSocket.OPEN
            ? upstream.send(message)
            : pending.push(message),
        );
        upstream.on("open", () => {
          for (const message of pending) upstream.send(message);
          pending.length = 0;
        });
        upstream.on("message", (data, binary) =>
          socket.send(binary ? data : data.toString()),
        );
        upstream.on("error", () => socket.close());
        upstream.on("close", () => {
          upstreams.delete(upstream);
          socket.close();
        });
        socket.onClose(() => upstream.close());
      },
    );
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("https://localhost/");
    await page.setContent(
      `<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="frame-src https://kvachat.ru/plugins/islands/; object-src 'none'; base-uri 'self'"><link rel="stylesheet" href="https://kvachat.ru/plugins/islands/_test/fixture.css"></head><body><header>Локальная проверка Android · вымышленные игроки</header><iframe src="https://kvachat.ru/plugins/islands/play.html" title="Острова"></iframe><script src="https://kvachat.ru/plugins/islands/_test/fixture.js"></script></body></html>`,
    );
    const game = page.frameLocator("iframe");
    await game
      .getByRole("button", { name: "Создать партию", exact: true })
      .click();
    const code = await game.locator(".room-code").textContent();
    browser = await chromium.launch({ headless: true });
    const peers = [];
    for (let i = 1; i <= 2; i++) {
      const other = await browser.newPage();
      await other.goto(origin + "/_test/?player=" + i);
      const f = other.frameLocator("iframe");
      await f.getByLabel("Код приглашения").fill(code);
      await f
        .getByRole("button", { name: "Присоединиться", exact: true })
        .click();
      peers.push(f);
    }
    const frames = [game, ...peers];
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
    await game
      .getByRole("button", { name: "Начать партию", exact: true })
      .click();
    await game.locator("#board").waitFor();
    const output = path.join(root, "artifacts/islands-android");
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, "board.png") });
    assert.equal(
      await game
        .locator("body")
        .evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    command("shell", "input", "keyevent", "KEYCODE_HOME");
    console.log(
      "Android game started; waiting 95 seconds in background to exceed session lifetime.",
    );
    await delay(95000);
    command("shell", "am", "start", "-n", activity);
    await game.getByRole("button", { name: "Пауза", exact: true }).click();
    await expect(game.getByRole("heading", { name: /^Пауза · / })).toBeVisible({
      timeout: 20000,
    });
    for (const f of peers)
      await expect(f.getByRole("heading", { name: /^Пауза · / })).toBeVisible();
    await game
      .getByRole("button", { name: "Продолжить партию", exact: true })
      .click();
    await game.getByRole("button", { name: "Правила", exact: true }).click();
    await expect(game.getByRole("dialog")).toBeVisible();
    await game.getByRole("button", { name: "Закрыть", exact: true }).click();
    await game.locator("body").evaluate(() => location.reload());
    await game.locator(".room-entry").first().click();
    await expect(game.locator("#board .tile-hit")).toHaveCount(19);
    await page.screenshot({ path: path.join(output, "restored.png") });
    assert.deepEqual(errors, []);
    console.log(
      "PASS Android WebView: scoped login, three clients, background resume after 95 s, synchronized pause/resume, dialog, reload and durable room.",
    );
  } catch (error) {
    if (page) {
      const output = path.join(root, "artifacts/islands-android");
      fs.mkdirSync(output, { recursive: true });
      await page
        .screenshot({ path: path.join(output, "failure.png") })
        .catch(() => {});
      console.error("Android page:", page.url());
      for (const frame of page.frames())
        console.error(
          "Frame:",
          frame.url(),
          (
            await frame
              .locator("body")
              .innerText()
              .catch(() => "")
          ).slice(0, 1000),
        );
    }
    throw error;
  } finally {
    for (const upstream of upstreams) upstream.terminate();
    if (browser) await browser.close();
    if (mobile) await mobile.close();
    if (fixture) fixture.kill();
    try {
      command("shell", "am", "force-stop", packageName);
    } catch {}
    if (forwardPort)
      try {
        command("forward", "--remove", `tcp:${forwardPort}`);
      } catch {}
    try {
      command("emu", "kill");
      console.log("Android emulator closed.");
    } catch {}
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
