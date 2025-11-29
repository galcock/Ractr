// RactrGame: simple survival mini-game so ractr.com is instantly playable.
// Move with WASD / arrows, Space to dash. Avoid red hazards. Survive as long as possible.

class RactrGame {
  constructor(engine) {
    this.engine = engine;

    // Config will be loaded asynchronously from ractr_config.json
    this.config = {
      player: {
        maxHealth: 100,
        dashCooldown: 0.6,
        baseSpeed: 180,
        dashSpeed: 360
      },
      hazards: {
        baseSpawnInterval: 1.4,
        minSpawnInterval: 0.4,
        spawnIntervalDecayPerSecond: 0.05,
        baseSpeed: 80,
        randomSpeed: 140,
        damagePerHit: 20,
        maxOnScreen: 42
      },
      difficulty: {
        speedIncreasePerSecond: 10,
        spawnCountIncreaseTimes: [12, 24, 36]
      },
      visuals: {
        backgroundGradient: ["#05060a", "#101426"],
        hazardColor: "rgba(255, 85, 120, ALPHA)",
        playerCoreColor: "#5f9cff"
      }
    };

    // Player state (will be initialized/refreshed from config)
    this.player = {
      x: 200,
      y: 200,
      vx: 0,
      vy: 0,
      radius: 16,
      baseSpeed: this.config.player.baseSpeed,
      dashSpeed: this.config.player.dashSpeed,
      dashCooldown: 0,
      maxHealth: this.config.player.maxHealth,
      health: this.config.player.maxHealth,
      invulnTime: 0
    };

    // Hazards (red orbs that spawn from edges)
    this.hazards = [];
    this.spawnTimer = 0;
    this.spawnInterval = this.config.hazards.baseSpawnInterval;

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

    // Difficulty progression helpers
    this.difficultyDuration = 60; // seconds to reach maximum difficulty

    // Feedback / UX helpers
    this.lastHitTime = -999; // time of last damaging collision
    this.lastNearMissTime = -999; // time of last near-miss event
    this.lastNearMissPulseTime = -999; // throttle near-miss pulses

    // Near-miss streak for subtle risk-reward feedback
    this.nearMissStreak = 0;

    // Transient visual effects (small, cheap list)
    this.pulses = [];

    // Cache for HUD text metrics to avoid allocations every frame
    this._cachedHealthText = "";

    this._attachStartInput();
    this._loadConfig();
  }

  _loadConfig() {
    try {
      fetch("engine/ractr_config.json")
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load ractr_config.json");
          return res.json();
        })
        .then((cfg) => {
          this.config = cfg;
          // Apply config values to current runtime state
          this._applyConfigToPlayer();
          this.spawnInterval = this.config.hazards.baseSpawnInterval;
        })
        .catch(() => {
          // If loading fails, keep defaults defined in the constructor
        });
    } catch (e) {
      // In very old browsers without fetch, silently keep defaults
    }
  }

  _applyConfigToPlayer() {
    const pCfg = this.config.player;
    const p = this.player;
    p.baseSpeed = pCfg.baseSpeed;
    p.dashSpeed = pCfg.dashSpeed;
    p.maxHealth = pCfg.maxHealth;
    // Only reset health fully outside of an active run
    if (this.state !== "playing") {
      p.health = p.maxHealth;
    } else if (p.health > p.maxHealth) {
      p.health = p.maxHealth;
    }
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
    // Ensure latest config is applied when a new run starts
    this._applyConfigToPlayer();

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
    this.spawnTimer = 0.4; // start slightly sooner than full interval for early engagement
    this.spawnInterval = this.config.hazards.baseSpawnInterval;

    this.timeAlive = 0;
    this.nearMissStreak = 0;
    this.state = "playing";

    // Clear transient effects
    this.pulses.length = 0;
    this.lastHitTime = -999;
    this.lastNearMissTime = -999;
    this.lastNearMissPulseTime = -999;
  }

  _difficultyFactor() {
    // 0 at start, 1 at or after difficultyDuration seconds
    const t = Math.max(0, Math.min(this.difficultyDuration, this.timeAlive));
    return t / this.difficultyDuration;
  }

  update(dt, input) {
    this.time += dt;

    // Update transient visual effects every frame
    this._updatePulses(dt);

    if (this.state !== "playing") {
      // Even in intro / gameover we keep time flowing for visuals
      return;
    }

    this.timeAlive += dt;

    const hCfg = this.config.hazards;

    // Difficulty scaling over ~60 seconds to reach very hard state
    // Spawn interval shrinks from baseSpawnInterval down to minSpawnInterval
    const factor = this._difficultyFactor();
    const targetInterval = hCfg.minSpawnInterval;
    const baseInterval = hCfg.baseSpawnInterval;
    // Smoothstep for gentler start and smoother late ramp
    const eased = factor * factor * (3 - 2 * factor);
    this.spawnInterval = baseInterval + (targetInterval - baseInterval) * eased;

    this._updatePlayer(dt, input);
    this._updateHazards(dt);
    this._checkCollisions();
  }

  _updatePlayer(dt, input) {
    const p = this.player;
    const pCfg = this.config.player;

    if (p.invulnTime > 0) {
      p.invulnTime = Math.max(0, p.invulnTime - dt);
    }

    let speed = p.baseSpeed;
    if (input.dash && p.dashCooldown <= 0) {
      speed = p.dashSpeed;
      p.dashCooldown = pCfg.dashCooldown;
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

  _currentHazardSpeed() {
    const hCfg = this.config.hazards;
    const dCfg = this.config.difficulty;
    const factor = this._difficultyFactor();

    // Base speed grows to 1.6x over difficultyDuration for a smoother ramp
    const speedMultiplier = 1 + 0.6 * factor;
    const base = hCfg.baseSpeed * speedMultiplier;

    // Additional linear increase from difficulty.speedIncreasePerSecond,
    // scaled so the first 60s are challenging but manageable.
    const linearScale = 0.15;
    const linearIncrease = (dCfg.speedIncreasePerSecond || 0) * linearScale * this.timeAlive;

    return base + linearIncrease;
  }

  _spawnHazard() {
    const canvas = this.engine.canvas;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;

    const hCfg = this.config.hazards;
    const dCfg = this.config.difficulty;

    // Number of hazards spawned at once based on timeAlive
    let spawnCount = 1;
    const times = dCfg.spawnCountIncreaseTimes || [];
    for (let i = 0; i < times.length; i++) {
      if (this.timeAlive >= times[i]) {
        spawnCount++;
      }
    }

    const maxOnScreen = hCfg.maxOnScreen || 40;
    const availableSlots = Math.max(0, maxOnScreen - this.hazards.length);
    if (availableSlots <= 0) {
      return;
    }

    spawnCount = Math.min(spawnCount, availableSlots);

    for (let i = 0; i < spawnCount; i++) {
      // Choose a random edge: 0=top,1=right,2=bottom,3=left
      const edge = Math.floor(Math.random() * 4);
      const baseSpeed = this._currentHazardSpeed();
      const randomBonus = Math.random() * hCfg.randomSpeed;
      const speed = baseSpeed + randomBonus;
      let x, y, vx, vy;

      // Slight bias so more hazards approach the player rather than exiting quickly
      const drift = 40;

      if (edge === 0) {
        x = Math.random() * w;
        y = -20;
        vx = (Math.random() - 0.5) * drift;
        vy = speed;
      } else if (edge === 1) {
        x = w + 20;
        y = Math.random() * h;
        vx = -speed;
        vy = (Math.random() - 0.5) * drift;
      } else if (edge === 2) {
        x = Math.random() * w;
        y = h + 20;
        vx = (Math.random() - 0.5) * drift;
        vy = -speed;
      } else {
        x = -20;
        y = Math.random() * h;
        vx = speed;
        vy = (Math.random() - 0.5) * drift;
      }

      // Slight size variation over time: early game smaller, late game a mix
      const sizeFactor = 0.5 + 0.5 * this._difficultyFactor();
      const baseRadius = 8 + Math.random() * 8;
      const radius = baseRadius * (0.6 + 0.8 * sizeFactor);

      this.hazards.push({
        x,
        y,
        vx,
        vy,
        radius,
        // Cache radius squared for cheaper collision checks
        radiusSq: radius * radius
      });
    }
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

    const margin = 80;
    const minX = -margin;
    const maxX = w + margin;
    const minY = -margin;
    const maxY = h + margin;

    // Move hazards and cull those far off-screen
    this.hazards = this.hazards.filter((hzd) => {
      hzd.x += hzd.vx * dt;
      hzd.y += hzd.vy * dt;

      if (hzd.x < minX || hzd.x > maxX || hzd.y < minY || hzd.y > maxY) {
        return false;
      }
      return true;
    });
  }

  _registerPulse(x, y, color, radius, duration, thickness) {
    // Cheap guard against unbounded growth in extreme cases
    if (this.pulses.length > 64) {
      this.pulses.shift();
    }
    this.pulses.push({
      x,
      y,
      radius,
      maxRadius: radius,
      color,
      life: duration,
      maxLife: duration,
      thickness: thickness || 2
    });
  }

  _updatePulses(dt) {
    if (!this.pulses.length) return;
    this.pulses = this.pulses.filter((p) => {
      p.life -= dt;
      const t = p.life / p.maxLife;
      p.radius = p.maxRadius * t;
      return p.life > 0;
    });
  }

  _checkCollisions() {
    const p = this.player;
    const pr = p.radius;

    if (p.health <= 0) return;

    const hCfg = this.config.hazards;
    const damage = hCfg.damagePerHit;

    // Threshold for considering a "near miss" (slightly larger than hit radius)
    const nearMissPadding = 14;
    const nearMissPulseCooldown = 0.09; // limit near-miss flashes for clarity

    let hadHit = false;
    let registeredNearMiss = false;

    for (const hzd of this.hazards) {
      const dx = hzd.x - p.x;
      const dy = hzd.y - p.y;
      const distSq = dx * dx + dy * dy;
      const r = hzd.radius + pr;
      const hitRadiusSq = r * r;

      if (distSq <= hitRadiusSq) {
        // Hit: apply damage instead of instant death
        if (p.invulnTime <= 0) {
          p.health = Math.max(0, p.health - damage);
          // Brief invulnerability to prevent rapid drain from overlapping hazards
          p.invulnTime = 0.45;
          this.lastHitTime = this.time;
          hadHit = true;

          // Hit pulse feedback (thicker, more saturated)
          this._registerPulse(
            p.x,
            p.y,
            "rgba(255, 90, 120, 0.9)",
            pr + 32,
            0.32,
            3.5
          );

          if (p.health <= 0) {
            this.state = "gameover";
            this.bestTime = Math.max(this.bestTime, this.timeAlive);
          }
        }
      } else {
        const nearR = r + nearMissPadding;
        if (distSq <= nearR * nearR) {
          // Close, but no damage — register a near miss for subtle feedback
          registeredNearMiss = true;
          this.lastNearMissTime = this.time;
          if (this.time - this.lastNearMissPulseTime > nearMissPulseCooldown) {
            this.lastNearMissPulseTime = this.time;
            this._registerPulse(
              p.x,
              p.y,
              "rgba(245, 215, 110, 0.8)",
              pr + 20,
              0.24,
              2.4
            );
          }
        }
      }
    }

    if (hadHit) {
      // Reset streak on hit
      this.nearMissStreak = 0;
    } else if (registeredNearMiss) {
      // Build up streak slowly with sustained close calls
      this.nearMissStreak = Math.min(this.nearMissStreak + 1, 99);
    }
  }

  render(ctx, width, height) {
    const vCfg = this.config.visuals || {};
    const bg0 = (vCfg.backgroundGradient && vCfg.backgroundGradient[0]) || "#05060a";
    const bg1 = (vCfg.backgroundGradient && vCfg.backgroundGradient[1]) || "#101426";

    // Background gradient
    const grd = ctx.createLinearGradient(0, 0, width, height);
    grd.addColorStop(0, bg0);
    grd.addColorStop(1, bg1);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, width, height);

    // Subtle grid (skip on very small canvases for perf)
    if (width > 320 && height > 240) {
      ctx.strokeStyle = "rgba(255,255,255,0.025)";
      ctx.lineWidth = 1;
      const gridSize = 56;
      const xStart = width % gridSize;
      const yStart = height % gridSize;
      ctx.beginPath();
      for (let x = xStart; x < width; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = yStart; y < height; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
    }

    // Cache some values for this frame
    const timeNow = this.time;

    // Hazards
    const hazardColorTemplate = vCfg.hazardColor || "rgba(255, 85, 120, ALPHA)";
    ctx.beginPath();
    for (const hzd of this.hazards) {
      const alpha = 0.45 + 0.25 * Math.sin(timeNow * 5 + hzd.x * 0.02);
      const color = hazardColorTemplate.replace("ALPHA", alpha.toFixed(3));
      ctx.fillStyle = color;
      ctx.moveTo(hzd.x + hzd.radius, hzd.y);
      ctx.arc(hzd.x, hzd.y, hzd.radius, 0, Math.PI * 2);
    }
    ctx.fill();

    // Orbiters around the player
    const p = this.player;
    ctx.fillStyle = "rgba(156, 200, 255, 0.55)";
    for (const orb of this.orbiters) {
      const angle = orb.angle + timeNow * orb.speed;
      const ox = p.x + Math.cos(angle) * orb.radius;
      const oy = p.y + Math.sin(angle) * orb.radius;

      const r = 3 + (orb.radius % 5);
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Transient pulses (near-miss / hit flashes)
    for (const pulse of this.pulses) {
      const t = pulse.life / pulse.maxLife;
      const alpha = t;
      ctx.beginPath();
      ctx.strokeStyle = pulse.color
        .replace("0.9", alpha.toFixed(3))
        .replace("0.8", alpha.toFixed(3));
      ctx.lineWidth = pulse.thickness || 2;
      ctx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Player core (blink slightly when invulnerable)
    const invulnBlink = p.invulnTime > 0 ? (Math.sin(timeNow * 40) > 0 ? 1 : 0.4) : 1;
    ctx.beginPath();
    const coreColor = vCfg.playerCoreColor || "#5f9cff";
    const coreColorWithAlpha = coreColor.startsWith("#") ? coreColor : coreColor;
    ctx.fillStyle = coreColorWithAlpha;
    ctx.globalAlpha = invulnBlink;
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Player inner pulse
    const innerPulse = 0.7 + 0.3 * Math.sin(timeNow * 8);
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.25 * innerPulse})`;
    ctx.arc(p.x, p.y, p.radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Player outline with hit/near-miss feedback tint
    let outlineColor = "#c2dcff";
    const hitAge = timeNow - this.lastHitTime;
    const nearMissAge = timeNow - this.lastNearMissTime;
    if (hitAge >= 0 && hitAge < 0.28) {
      outlineColor = "#ff5c7a"; // recent damage
    } else if (nearMissAge >= 0 && nearMissAge < 0.25) {
      outlineColor = "#f5d76e"; // near miss
    }

    ctx.beginPath();
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 2;
    ctx.arc(p.x, p.y, p.radius + 1, 0, Math.PI * 2);
    ctx.stroke();

    // HUD text (in-canvas)
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`Time: ${this.timeAlive.toFixed(2)}s`, 12, 20);
    ctx.textAlign = "right";
    ctx.fillText(`Best: ${this.bestTime.toFixed(2)}s`, width - 12, 20);

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

    // Low-health overlay on bar
    if (healthRatio < 0.35) {
      const warningPulse = 0.5 + 0.5 * Math.sin(timeNow * 6);
      ctx.fillStyle = `rgba(255,0,40,${0.25 * warningPulse})`;
      ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);
    }

    // Border
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, barY + 0.5, barWidth - 1, barHeight - 1);

    // Health text with percent for clearer feedback
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    const healthPercent = Math.round(healthRatio * 100);
    const healthText = `Health: ${Math.ceil(p.health)}/${p.maxHealth} (${healthPercent}%)`;
    if (healthText !== this._cachedHealthText) {
      this._cachedHealthText = healthText;
    }
    ctx.fillText(this._cachedHealthText, barX + barWidth / 2, barY - 3);

    // Near-miss streak indicator (subtle score multiplier hint)
    if (this.nearMissStreak > 0) {
      const streakMultiplier = 1 + Math.min(this.nearMissStreak, 20) * 0.05;
      ctx.fillStyle = "rgba(245, 215, 110, 0.9)";
      ctx.font = "10px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(
        `Risk x${streakMultiplier.toFixed(2)} (${this.nearMissStreak})`,
        width - 12,
        barY + barHeight + 12
      );
    }

    // Subtle low-health vignette overlay and global damage flash
    if (healthRatio < 0.35) {
      const vignetteStrength = (1 - healthRatio) * 0.32;
      ctx.fillStyle = `rgba(255,40,80,${vignetteStrength})`;
      ctx.fillRect(0, 0, width, height);
    }

    const recentHitAge = timeNow - this.lastHitTime;
    if (recentHitAge >= 0 && recentHitAge < 0.18) {
      const fade = 1 - recentHitAge / 0.18;
      ctx.fillStyle = `rgba(255,90,120,${0.25 * fade})`;
      ctx.fillRect(0, 0, width, height);
    }

    // State overlays
    ctx.textAlign = "center";

    if (this.state === "intro") {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("RACTR ENGINE · DASH", width / 2, height / 2 - 10);
      ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText(
        "Move with WASD / arrows. Space to dash. Hazards chip away your health.",
        width / 2,
        height / 2 + 16
      );
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText("Press Space or Enter to start", width / 2, height / 2 + 38);
    } else if (this.state === "gameover") {
      ctx.fillStyle = "rgba(255,120,140,0.95)";
      ctx.font = "24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("GAME OVER", width / 2, height / 2 - 10);
      ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(
        `You survived ${this.timeAlive.toFixed(2)} seconds`,
        width / 2,
        height / 2 + 16
      );
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText("Press Space or Enter to try again", width / 2, height / 2 + 38);
    }

    ctx.restore();
  }
}

// Ensure RactrGame is globally accessible for index.html
if (typeof window !== "undefined") {
  window.RactrGame = RactrGame;
}
