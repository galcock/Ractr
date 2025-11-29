// RactrGame: simple survival mini-game so ractr.com is instantly playable.
// Move with WASD / arrows, Space to dash. Avoid red hazards. Survive as long as possible.

class RactrGame {
  constructor(engine) {
    this.engine = engine;

    // Player state
    this.player = {
      x: 200,
      y: 200,
      vx: 0,
      vy: 0,
      radius: 16,
      baseSpeed: 180,
      dashSpeed: 360,
      dashCooldown: 0,
      maxHealth: 100,
      health: 100,
      invulnTime: 0
    };

    // Hazards (red orbs that spawn from edges)
    this.hazards = [];
    this.spawnTimer = 0;
    this.spawnInterval = 1.4; // seconds, will shrink over time

    // Orbiters just for visual flair
    this.orbiters = [];
    for (let i = 0; i < 24; i++) {
      this.orbiters.push({
        angle: (i / 24) * Math.PI * 2,
        radius: 40 + (i % 5) * 12,
        speed: 0.6 + (i % 3) * 0.2
      });
    }

    // Game state
    this.state = "intro"; // "intro" | "playing" | "gameover"
    this.time = 0;
    this.timeAlive = 0;
    this.bestTime = 0;

    this._attachStartInput();
  }

  _attachStartInput() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.key === " " || e.key === "Enter") {
        if (this.state === "intro" || this.state === "gameover") {
          this._startGame();
        }
      }
    });
  }

  _startGame() {
    const canvas = this.engine.canvas;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;

    this.player.x = w / 2;
    this.player.y = h / 2;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.dashCooldown = 0;
    this.player.health = this.player.maxHealth;
    this.player.invulnTime = 0;

    this.hazards = [];
    this.spawnTimer = 0;
    this.spawnInterval = 1.4;

    this.timeAlive = 0;
    this.state = "playing";
  }

  update(dt, input) {
    this.time += dt;

    if (this.state !== "playing") {
      // Even in intro / gameover we keep time flowing for visuals
      return;
    }

    this.timeAlive += dt;

    // Gradually make the game harder
    this.spawnInterval = Math.max(0.5, 1.4 - this.timeAlive * 0.05);

    this._updatePlayer(dt, input);
    this._updateHazards(dt);
    this._checkCollisions();
  }

  _updatePlayer(dt, input) {
    const p = this.player;

    if (p.invulnTime > 0) {
      p.invulnTime = Math.max(0, p.invulnTime - dt);
    }

    let speed = p.baseSpeed;
    if (input.dash && p.dashCooldown <= 0) {
      speed = p.dashSpeed;
      p.dashCooldown = 0.6; // seconds
    }
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);

    let moveX = 0;
    let moveY = 0;
    if (input.left) moveX -= 1;
    if (input.right) moveX += 1;
    if (input.up) moveY -= 1;
    if (input.down) moveY += 1;

    const mag = Math.hypot(moveX, moveY) || 1;
    moveX /= mag;
    moveY /= mag;

    p.vx = moveX * speed;
    p.vy = moveY * speed;

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Clamp to canvas bounds in CSS pixels
    const canvas = this.engine.canvas;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    p.x = Math.min(Math.max(p.radius + 8, p.x), w - p.radius - 8);
    p.y = Math.min(Math.max(p.radius + 8, p.y), h - p.radius - 8);
  }

  _spawnHazard() {
    const canvas = this.engine.canvas;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;

    // Choose a random edge: 0=top,1=right,2=bottom,3=left
    const edge = Math.floor(Math.random() * 4);
    const speed = 80 + Math.random() * 140 + this.timeAlive * 10;
    let x, y, vx, vy;

    if (edge === 0) {
      x = Math.random() * w;
      y = -20;
      vx = (Math.random() - 0.5) * 60;
      vy = speed;
    } else if (edge === 1) {
      x = w + 20;
      y = Math.random() * h;
      vx = -speed;
      vy = (Math.random() - 0.5) * 60;
    } else if (edge === 2) {
      x = Math.random() * w;
      y = h + 20;
      vx = (Math.random() - 0.5) * 60;
      vy = -speed;
    } else {
      x = -20;
      y = Math.random() * h;
      vx = speed;
      vy = (Math.random() - 0.5) * 60;
    }

    this.hazards.push({
      x,
      y,
      vx,
      vy,
      radius: 10 + Math.random() * 10
    });
  }

  _updateHazards(dt) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this._spawnHazard();
      this.spawnTimer = this.spawnInterval;
    }

    const canvas = this.engine.canvas;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;

    // Move hazards and cull those far off-screen
    this.hazards = this.hazards.filter((hzd) => {
      hzd.x += hzd.vx * dt;
      hzd.y += hzd.vy * dt;

      const margin = 80;
      if (
        hzd.x < -margin ||
        hzd.x > w + margin ||
        hzd.y < -margin ||
        hzd.y > h + margin
      ) {
        return false;
      }
      return true;
    });
  }

  _checkCollisions() {
    const p = this.player;
    const pr = p.radius;

    if (p.health <= 0) return;

    for (const hzd of this.hazards) {
      const dx = hzd.x - p.x;
      const dy = hzd.y - p.y;
      const r = hzd.radius + pr;
      if (dx * dx + dy * dy <= r * r) {
        // Hit: apply damage instead of instant death
        if (p.invulnTime <= 0) {
          const damage = 25;
          p.health = Math.max(0, p.health - damage);
          // Brief invulnerability to prevent rapid drain from overlapping hazards
          p.invulnTime = 0.4;

          if (p.health <= 0) {
            this.state = "gameover";
            this.bestTime = Math.max(this.bestTime, this.timeAlive);
          }
        }
      }
    }
  }

  render(ctx, width, height) {
    // Background gradient
    const grd = ctx.createLinearGradient(0, 0, width, height);
    grd.addColorStop(0, "#05060a");
    grd.addColorStop(1, "#101426");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, width, height);

    // Subtle grid
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = width % gridSize; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = height % gridSize; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, height);
      ctx.stroke();
    }

    // Hazards
    for (const hzd of this.hazards) {
      ctx.beginPath();
      const alpha = 0.4 + 0.3 * Math.sin(this.time * 5 + hzd.x * 0.02);
      ctx.fillStyle = `rgba(255, 85, 120, ${alpha.toFixed(3)})`;
      ctx.arc(hzd.x, hzd.y, hzd.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Orbiters around the player
    const p = this.player;
    for (const orb of this.orbiters) {
      const angle = orb.angle + this.time * orb.speed;
      const ox = p.x + Math.cos(angle) * orb.radius;
      const oy = p.y + Math.sin(angle) * orb.radius;

      const r = 3 + (orb.radius % 5);
      ctx.beginPath();
      ctx.fillStyle = "rgba(156, 200, 255, 0.55)";
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player core (blink slightly when invulnerable)
    const invulnBlink = p.invulnTime > 0 ? (Math.sin(this.time * 40) > 0 ? 1 : 0.4) : 1;
    ctx.beginPath();
    ctx.fillStyle = `rgba(95,156,255,${invulnBlink})`;
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();

    // Player inner pulse
    const pulse = 0.7 + 0.3 * Math.sin(this.time * 8);
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.25 * pulse})`;
    ctx.arc(p.x, p.y, p.radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Player outline
    ctx.beginPath();
    ctx.strokeStyle = "#c2dcff";
    ctx.lineWidth = 2;
    ctx.arc(p.x, p.y, p.radius + 1, 0, Math.PI * 2);
    ctx.stroke();

    // HUD text (in-canvas)
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(
      `Time: ${this.timeAlive.toFixed(2)}s`,
      12,
      20
    );
    ctx.textAlign = "right";
    ctx.fillText(
      `Best: ${this.bestTime.toFixed(2)}s`,
      width - 12,
      20
    );

    // Health bar
    const barWidth = Math.min(220, width * 0.3);
    const barHeight = 10;
    const barX = (width - barWidth) / 2;
    const barY = 32;
    const healthRatio = Math.max(0, Math.min(1, p.health / p.maxHealth));

    // Background
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Health fill with gradient
    const hpGrd = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
    hpGrd.addColorStop(0, "#3dd68c");
    hpGrd.addColorStop(0.5, "#f5d76e");
    hpGrd.addColorStop(1, "#ff6b81");
    ctx.fillStyle = hpGrd;
    ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);

    // Border
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, barY + 0.5, barWidth - 1, barHeight - 1);

    // Health text
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(
      `Health: ${Math.ceil(p.health)}/${p.maxHealth}`,
      barX + barWidth / 2,
      barY - 3
    );

    // State overlays
    ctx.textAlign = "center";

    if (this.state === "intro") {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("RACTR ENGINE · DASH", width / 2, height / 2 - 10);
      ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText(
        "Move with WASD / arrows. Space to dash. Hazards now chip away your health.",
        width / 2,
        height / 2 + 16
      );
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText(
        "Press Space or Enter to start",
        width / 2,
        height / 2 + 38
      );
    } else if (this.state === "gameover") {
      ctx.fillStyle = "rgba(255,120,140,0.95)";
      ctx.font = "24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("GAME OVER", width / 2, height / 2 - 10);
      ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(
        `You survived ${this.timeAlive.toFixed(2)} seconds",
        width / 2,
        height / 2 + 16
      );
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(
        "Press Space or Enter to try again",
        width / 2,
        height / 2 + 38
      );
    }

    ctx.restore();
  }
}
