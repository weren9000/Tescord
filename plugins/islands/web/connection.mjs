export class GameConnection extends EventTarget {
  token = null;
  user = null;
  socket = null;
  roomId = null;
  timer = null;
  retry = 0;
  origins = [];
  stopped = false;

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async start() {
    const config = await this.request("api/config", undefined, false);
    this.origins = config.parent_origins;
    window.addEventListener("message", (event) => {
      if (event.source !== parent || !this.origins.includes(event.origin))
        return;
      if (event.data?.type === "islands:hello") this.ready();
      if (
        event.data?.type === "islands:grant" &&
        typeof event.data.grant === "string"
      )
        void this.authorize(event.data.grant);
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this.ready();
        if (!this.socket && this.roomId) this.connect();
      }
    });
    window.addEventListener("online", () => {
      this.ready();
      this.connect();
    });
    window.addEventListener("pagehide", () => this.stop());
    this.ready();
  }

  ready() {
    if (parent === window) return;
    for (const origin of this.origins)
      parent.postMessage({ type: "islands:ready" }, origin);
  }

  async authorize(grant) {
    if (this.authenticating || this.stopped) return;
    this.authenticating = true;
    try {
      const result = await this.request("api/auth", { grant }, false);
      const changed = this.user?.id !== result.user.id;
      if (changed) {
        this.roomId = null;
        this.closeSocket();
      }
      this.token = result.token;
      this.user = result.user;
      if (this.socket?.readyState === WebSocket.OPEN)
        this.socket.send(
          JSON.stringify({ type: "authenticate", token: this.token }),
        );
      else if (this.roomId) this.connect();
      this.emit("authorized", { user: this.user, changed });
      this.emit(
        "status",
        this.roomId
          ? this.socket?.readyState === WebSocket.OPEN
            ? "Партия синхронизирована"
            : "Подключаемся к партии…"
          : "Вы вошли как " + this.user.nick,
      );
    } catch (error) {
      this.emit("error", error.message);
    } finally {
      this.authenticating = false;
    }
  }

  async request(path, body, authenticated = true) {
    if (authenticated && !this.token)
      throw new Error("Откройте игру через Квачат.");
    let response;
    try {
      response = await fetch(new URL(path, location.href), {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(authenticated ? { Authorization: "Bearer " + this.token } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      const error = new Error(
        "Связь прервалась. Результат действия пока неизвестен.",
      );
      error.uncertain = body !== undefined;
      throw error;
    }
    let result;
    try {
      result = await response.json();
    } catch {
      const error = new Error(
        "Не удалось прочитать ответ сервера. Проверьте результат действия повтором.",
      );
      error.status = response.status;
      error.uncertain =
        body !== undefined && (response.ok || response.status >= 500);
      if (response.status === 401) this.ready();
      throw error;
    }
    if (!response.ok) {
      if (response.status === 401) this.ready();
      const error = new Error(
        typeof result.detail === "string"
          ? result.detail
          : "Проверьте данные запроса.",
      );
      error.status = response.status;
      error.uncertain = body !== undefined && response.status >= 500;
      throw error;
    }
    return result;
  }

  watch(roomId) {
    this.roomId = roomId;
    this.retry = 0;
    this.connect();
  }

  closeSocket() {
    clearTimeout(this.timer);
    if (this.socket) {
      const old = this.socket;
      this.socket = null;
      old.onclose = null;
      old.close();
    }
  }

  connect() {
    this.closeSocket();
    if (!this.roomId || !this.token || this.stopped) return;
    const url = new URL("api/rooms/" + this.roomId + "/stream", location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () =>
      socket.send(JSON.stringify({ type: "authenticate", token: this.token }));
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "state") {
          this.retry = 0;
          this.emit("status", "Партия синхронизирована");
          this.emit("state", message.room);
        }
      } catch {
        this.emit("error", "Не удалось прочитать обновление партии.");
      }
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (event.code === 4404) {
        this.emit("removed", null);
        this.roomId = null;
        return;
      }
      if (event.code === 4401) this.ready();
      this.emit("status", "Связь потеряна. Восстанавливаем партию…");
      this.timer = setTimeout(
        () => this.connect(),
        Math.min(15000, 1000 * 2 ** this.retry++),
      );
    };
    socket.onerror = () => {
      /* onclose schedules a bounded reconnect */
    };
  }

  stop() {
    this.stopped = true;
    this.closeSocket();
    this.token = null;
  }
}
