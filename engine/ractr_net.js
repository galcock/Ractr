// RactrNetClient: thin client-side networking layer scaffold.
// This file defines the networking surface used by the game. It is fully
// optional: if no backend URLs are provided in ractr_config.json, all
// operations become no-ops and the game remains purely single-player.

class RactrNetClient {
  constructor(config) {
    const safeCfg = config || {};
    this.websocketUrl = safeCfg.websocketUrl || "";
    this.httpBaseUrl = safeCfg.httpBaseUrl || "";

    this.ws = null;
    this.wsConnected = false;
    this.wsLastAttempt = 0;
    this.wsReconnectDelay = 5; // seconds between reconnect attempts

    this.playerId = null;
  }

  applyConfig(config) {
    if (!config) return;
    if (typeof config.websocketUrl === "string") {
      this.websocketUrl = config.websocketUrl;
    }
    if (typeof config.httpBaseUrl === "string") {
      this.httpBaseUrl = config.httpBaseUrl;
    }
  }

  // Called each frame; safe when no backend is available.
  // "context" is a lightweight snapshot of player + world
  // state that the server might care about.
  tick(dt, context) {
    if (!this.websocketUrl) return;

    this.wsLastAttempt += dt;
    if (!this.ws && this.wsLastAttempt >= this.wsReconnectDelay) {
      this._tryConnect();
    }

    if (this.wsConnected && context && context.player) {
      const payload = {
        type: "client_tick",
        player: context.player,
        timeAlive: context.timeAlive,
        zoneId: context.zoneId
      };
      this._sendJson(payload);
    }
  }

  _tryConnect() {
    this.wsLastAttempt = 0;
    try {
      const ws = new WebSocket(this.websocketUrl);
      this.ws = ws;

      ws.onopen = () => {
        this.wsConnected = true;
        const msg = {
          type: "hello_client",
          clientVersion: "ractr-web-1",
          timestamp: Date.now()
        };
        this._sendJson(msg);
      };

      ws.onclose = () => {
        this.wsConnected = false;
        this.ws = null;
      };

      ws.onerror = () => {
        // Connection failed or errored out. We mark as disconnected and
        // allow the reconnect timer to try again later.
        this.wsConnected = false;
      };

      ws.onmessage = (event) => {
        this._handleServerMessage(event.data);
      };
    } catch (e) {
      // If constructing the WebSocket throws (e.g., bad URL), just
      // disable the socket and keep the game fully local.
      this.ws = null;
      this.wsConnected = false;
    }
  }

  _sendJson(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(obj));
    } catch (e) {
      // Swallow errors in absence of a real backend.
    }
  }

  _handleServerMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }

    if (!msg || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "welcome": {
        // Initial handshake from server, usually assigning a stable playerId.
        if (msg.playerId) {
          this.playerId = msg.playerId;
        }
        break;
      }
      case "world_snapshot": {
        // Future work:
        // - Apply authoritative world/zone state
        // - Sync positions of other players and NPCs
        // For now, this is intentionally a no-op.
        break;
      }
      case "server_event": {
        // Future work:
        // - Combat log lines
        // - Loot / reward notifications
        // - Chat and system messages
        break;
      }
      default: {
        // Unknown message types are ignored to keep the client robust
        // across server-side upgrades.
        break;
      }
    }
  }

  notifyRunStarted(playerSnapshot) {
    if (!this.httpBaseUrl) return;
    const payload = {
      player: playerSnapshot,
      ts: Date.now()
    };
    try {
      fetch(this.httpBaseUrl + "/runs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch (e) {
      // Ignore; offline-friendly.
    }
  }

  notifyRunEnded(payload) {
    if (!this.httpBaseUrl) return;
    const body = {
      player: payload.player,
      timeAlive: payload.timeAlive,
      ts: Date.now()
    };
    try {
      fetch(this.httpBaseUrl + "/runs/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).catch(() => {});
    } catch (e) {
      // Ignore; offline-friendly.
    }
  }

  notifyLevelUp(playerSnapshot) {
    if (!this.httpBaseUrl) return;
    const payload = {
      player: playerSnapshot,
      ts: Date.now()
    };
    try {
      fetch(this.httpBaseUrl + "/player/levelup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch (e) {
      // Ignore; offline-friendly.
    }
  }
}

if (typeof window !== "undefined") {
  window.RactrNetClient = RactrNetClient;
}
