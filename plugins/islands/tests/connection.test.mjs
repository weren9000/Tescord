import assert from "node:assert/strict";
import test from "node:test";
import { GameConnection } from "../web/connection.mjs";

test("lost mutation responses keep their request safe to retry", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  globalThis.location = {
    href: "https://example.test/plugins/islands/play.html",
  };
  const connection = new GameConnection();
  connection.token = "test-session";
  try {
    for (const response of [
      new Response("<html>Bad gateway</html>", { status: 502 }),
      new Response("{", { status: 200 }),
      new Response(JSON.stringify({ detail: "Server failure" }), {
        status: 500,
      }),
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(
        connection.request("api/rooms/room/commands", {
          request_id: "same-on-retry",
        }),
        (error) => error.uncertain === true,
      );
    }
    globalThis.fetch = async () => {
      throw new TypeError("Network lost");
    };
    await assert.rejects(
      connection.request("api/rooms", {}),
      (error) => error.uncertain === true,
    );
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Version conflict" }), {
        status: 409,
      });
    await assert.rejects(
      connection.request("api/rooms/room/commands", {}),
      (error) => error.status === 409 && !error.uncertain,
    );
    globalThis.fetch = async () =>
      new Response("<html>Unavailable</html>", { status: 503 });
    await assert.rejects(
      connection.request("api/rooms"),
      (error) => !error.uncertain,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
  }
});
