// RactrEngine: tiny JS engine wrapper with a main loop and input handling.

class RactrEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      throw new Error(`RactrEngine: canvas '${canvasId}' not found`);
    }

    this.ctx = this.canvas.getContext("2d");
    this.game = null;

    this.lastTime = 0;
    this.running = false;

    this.keysDown = new Set();
    this._hookResize();
    this._hookInput();

    this.fps = 0;
    this._fpsLastSample = performance.now();
    this._fpsFrames = 0;
  }

  setGame(game) {
    this.game = game;
  }

  start() {
    if (!this.game) {
      console.warn("RactrEngine: no game set, not starting loop");
      return;
    }
    this.running = true;
    this.lastTime = performance.now();
    window.requestAnimationFrame(this._loop.bind(this));
  }

  stop() {
    this.running = false;
  }

  _loop(timestamp) {
    if (!this.running) return;

    const dt = (timestamp - this.lastTime) / 1000.0;
    this.lastTime = timestamp;

    this._updateFps(timestamp);

    if (this.game && typeof this.game.update === "function") {
      this.game.update(dt, this._inputSnapshot());
    }
    if (this.game && typeof this.game.render === "function") {
      this.game.render(this.ctx, this.canvas.width, this.canvas.height);
    }

    window.requestAnimationFrame(this._loop.bind(this));
  }

  _updateFps(now) {
    this._fpsFrames++;
    const diff = now - this._fpsLastSample;
    if (diff >= 500) {
      this.fps = (this._fpsFrames * 1000) / diff;
      this._fpsFrames = 0;
      this._fpsLastSample = now;

      const fpsEl = document.getElementById("hud-fps");
      if (fpsEl) {
        fpsEl.textContent = `FPS: ${this.fps.toFixed(0)}`;
      }
    }
  }

  _hookResize() {
    const resize = () => {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    window.addEventListener("resize", resize);
    resize();
  }

  _hookInput() {
    window.addEventListener("keydown", (e) => {
      this.keysDown.add(e.key.toLowerCase());
    });

    window.addEventListener("keyup", (e) => {
      this.keysDown.delete(e.key.toLowerCase());
    });
  }

  _inputSnapshot() {
    // Normalize common movement keys
    return {
      left:
        this.keysDown.has("a") ||
        this.keysDown.has("arrowleft") ||
        this.keysDown.has("h"),
      right:
        this.keysDown.has("d") ||
        this.keysDown.has("arrowright") ||
        this.keysDown.has("l"),
      up:
        this.keysDown.has("w") ||
        this.keysDown.has("arrowup") ||
        this.keysDown.has("k"),
      down:
        this.keysDown.has("s") ||
        this.keysDown.has("arrowdown") ||
        this.keysDown.has("j"),
      dash: this.keysDown.has(" ") || this.keysDown.has("shift"),
    };
  }
}
