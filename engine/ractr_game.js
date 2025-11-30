// RactrGame: Everlight Crossroads – EQ-inspired top-down ARPG zone.
// - WASD / arrows: move
// - Space: dash
// - J: basic attack (projectile) toward nearest enemy
// - Survive, kill mobs, gain XP & levels.

// -------------------- Entity Types --------------------

class RactrMob {
  constructor(x, y, opts = {}) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;

    this.radius = opts.radius || 16;
    this.maxHealth = opts.maxHealth || 40;
    this.health = this.maxHealth;
    this.moveSpeed = opts.moveSpeed || 55;
    this.name = opts.name || "Forest Wisp";
    this.level = opts.level || 1;
    this.baseXp = opts.baseXp || 18;

    this.colorBody = opts.colorBody || "#53f5b8";
    this.colorCore = opts.colorCore || "#f0fff8";

    this.behavior = opts.behavior || "chaser"; // "chaser" | "wander"
    this.wanderAngle = Math.random() * Math.PI * 2;
    this.wanderTimer = 0;

    this.aggroRange = opts.aggroRange || 260;
    this.attackRange = opts.attackRange || 32;
    this.attackCooldown = 0;
    this.attackCooldownMax = opts.attackCooldownMax || 1.3;
    this.contactDamage = opts.contactDamage || 10;

    this.alive = true;
    this.hitFlash = 0;
  }

  takeDamage(amount) {
    this.health -= amount;
    this.hitFlash = 0.18;
    if (this.health <= 0) {
      this.alive = false;
    }
  }

  update(dt, player, zoneBounds) {
    if (!this.alive) return;

    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (this.attackCooldown > 0) this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);

    if (this.behavior === "chaser") {
      if (dist < this.aggroRange) {
        // Move toward player
        const s = this.moveSpeed;
        const mag = dist || 1;
        this.vx = (dx / mag) * s;
        this.vy = (dy / mag) * s;
      } else {
        // Idle drift
        this._wander(dt);
      }
    } else {
      this._wander(dt);
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Soft clamp to zone
    if (zoneBounds) {
      const { minX, maxX, minY, maxY } = zoneBounds;
      if (this.x < minX + this.radius) this.x = minX + this.radius;
      if (this.x > maxX - this.radius) this.x = maxX - this.radius;
      if (this.y < minY + this.radius) this.y = minY + this.radius;
      if (this.y > maxY - this.radius) this.y = maxY - this.radius;
    }
  }

  _wander(dt) {
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 1 + Math.random() * 2.5;
      this.wanderAngle = Math.random() * Math.PI * 2;
    }
    const s = this.moveSpeed * 0.5;
    this.vx = Math.cos(this.wanderAngle) * s;
    this.vy = Math.sin(this.wanderAngle) * s;
  }
}

class RactrProjectile {
  constructor(x, y, vx, vy, opts = {}) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.radius = opts.radius || 6;
    this.life = opts.life || 0.6;
    this.maxLife = this.life;
    this.damage = opts.damage || 20;
  }

  update(dt) {
    this.life -= dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  get alive() {
    return this.life > 0;
  }
}

// -------------------- RactrGame --------------------

class RactrGame {
  constructor(engine) {
    this.engine = engine;
    this.canvas = engine.canvas;
    this.ctx = engine.ctx;

    this.time = 0;
    this.state = "intro"; // intro | playing | dead
    this.bestTime = 0;
    this.runTime = 0;

    // World / zone definition
    this.zone = {
      id: "everlight_crossroads",
      name: "Everlight Crossroads",
      levelRange: [1, 3],
      description: "A forest edge crossroads where new adventurers take their first steps.",
    };

    // Zone layout (in canvas space)
    this.zoneBounds = {
      padding: 40,
      get minX() {
        return this.padding;
      },
      get maxX() {
        return (typeof window !== "undefined"
          ? (window.innerWidth || 960)
          : 960) - this.padding;
      },
      get minY() {
        return this.padding + 40;
      },
      get maxY() {
        return (typeof window !== "undefined"
          ? (window.innerHeight || 540)
          : 540) - this.padding;
      },
    };

    // Player core state
    this.player = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 16,
      baseSpeed: 185,
      dashSpeed: 360,
      dashCooldown: 0,
      dashCooldownMax: 0.55,
      invulnTime: 0,
      maxHealth: 120,
      health: 120,
      maxMana: 60,
      mana: 60,
      // RPG stats
      name: "Adventurer",
      classId: "Warden",
      level: 1,
      xp: 0,
      xpToNext: 130,
      strength: 10,
      agility: 12,
      intelligence: 9,
      attackPower: 14,
      defense: 3,
      critChance: 0.06,
      gold: 0,
      facingAngle: 0,
      attackCooldown: 0,
      attackCooldownMax: 0.45,
    };

    // Entities
    this.mobs = [];
    this.projectiles = [];

    // Visual helpers
    this.pulses = [];
    this.lastHitTime = -999;
    this.lastKillTime = -999;

    // Cached HUD text
    this.cachedHealthText = "";
    this.cachedRpgLine = "";

    // Input helpers
    this.pendingAttack = false;
    this.isCharSheetHintShown = false;

    this._attachCoreInput();
    this._attachAttackInput();

    // Initial spawn & positioning
    this._resetRunState();

    if (this.canvas && this.canvas.classList) {
      this.canvas.classList.add("ractr-active");
    }
  }

  // -------------------- Input hooks --------------------

  _attachCoreInput() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.key === " " || e.key === "Enter") {
        if (this.state === "intro" || this.state === "dead") {
          this._startRun();
        }
      }
    });
  }

  _attachAttackInput() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === "j") {
        this.pendingAttack = true;
      }
    });
  }

  // -------------------- Run lifecycle --------------------

  _resetRunState() {
    const bounds = this.zoneBounds;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2 + 30;

    this.player.x = centerX;
    this.player.y = centerY;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.health = this.player.maxHealth;
    this.player.mana = this.player.maxMana;
    this.player.invulnTime = 0;
    this.player.dashCooldown = 0;
    this.player.attackCooldown = 0;

    this.mobs = [];
    this.projectiles = [];
    this.pulses = [];

    this.runTime = 0;
    this.time = 0;
    this.lastHitTime = -999;
    this.lastKillTime = -999;
    this.pendingAttack = false;

    // Spawn an initial pack of mobs
    this._spawnInitialMobs();
  }

  _spawnInitialMobs() {
    const bounds = this._getStaticZoneRect();
    const mobDefs = [
      { name: "Everlight Wisp", colorBody: "#53f5b8", level: 1 },
      { name: "Stone Scarab", colorBody: "#f5d253", level: 2 },
      { name: "Rooted Shade", colorBody: "#b28cff", level: 2 },
    ];

    for (let i = 0; i < 9; i++) {
      const def = mobDefs[i % mobDefs.length];

      const x = bounds.minX + 80 + Math.random() * (bounds.width - 160);
      const y = bounds.minY + 80 + Math.random() * (bounds.height - 160);

      const levelJitter = (Math.random() < 0.35) ? 1 : 0;
      const level = def.level + levelJitter;

      const maxHp = 30 + level * 18 + Math.floor(Math.random() * 12);
      const moveSpeed = 50 + level * 12;

      const mob = new RactrMob(x, y, {
        radius: 16 + Math.random() * 4,
        maxHealth: maxHp,
        moveSpeed,
        name: def.name,
        level,
        baseXp: 16 + level * 8,
        colorBody: def.colorBody,
        colorCore: "#f0fff8",
        behavior: "chaser",
        aggroRange: 260 + level * 20,
        contactDamage: 12 + level * 4,
      });

      this.mobs.push(mob);
    }
  }

  _startRun() {
    this.state = "playing";
    this._resetRunState();
  }

  _endRun() {
    this.state = "dead";
    this.bestTime = Math.max(this.bestTime, this.runTime);
  }

  // -------------------- Update loop --------------------

  update(dt, input) {
    this.time += dt;

    if (this.state === "intro") {
      this._updatePulses(dt);
      return;
    }

    if (this.state === "dead") {
      this._updatePulses(dt);
      return;
    }

    this.runTime += dt;

    this._updatePulses(dt);
    this._updatePlayer(dt, input);
    this._updateMobs(dt);
    this._updateProjectiles(dt);
    this._handleCollisions();
    this._maybeSpawnExtraMobs(dt);
  }

  _updatePlayer(dt, input) {
    const p = this.player;

    if (p.invulnTime > 0) {
      p.invulnTime = Math.max(0, p.invulnTime - dt);
    }
    if (p.dashCooldown > 0) {
      p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    }
    if (p.attackCooldown > 0) {
      p.attackCooldown = Math.max(0, p.attackCooldown - dt);
    }

    // Movement
    let moveX = 0;
    let moveY = 0;
    if (input.left) moveX -= 1;
    if (input.right) moveX += 1;
    if (input.up) moveY -= 1;
    if (input.down) moveY += 1;

    const mag = Math.hypot(moveX, moveY) || 1;
    moveX /= mag;
    moveY /= mag;

    let speed = p.baseSpeed;
    if (input.dash && p.dashCooldown <= 0) {
      speed = p.dashSpeed;
      p.dashCooldown = p.dashCooldownMax;
      // Dash pulse
      this._registerPulse(p.x, p.y, "rgba(150, 230, 255, 0.9)", p.radius + 34, 0.4, 4);
    }

    p.vx = moveX * speed;
    p.vy = moveY * speed;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (moveX !== 0 || moveY !== 0) {
      p.facingAngle = Math.atan2(moveY, moveX);
    }

    // Clamp to zone bounds
    const rect = this._getStaticZoneRect();
    if (p.x < rect.minX + p.radius) p.x = rect.minX + p.radius;
    if (p.x > rect.maxX - p.radius) p.x = rect.maxX - p.radius;
    if (p.y < rect.minY + p.radius) p.y = rect.minY + p.radius;
    if (p.y > rect.maxY - p.radius) p.y = rect.maxY - p.radius;

    // Attack
    if (this.pendingAttack && p.attackCooldown <= 0) {
      this._performAttack();
      p.attackCooldown = p.attackCooldownMax;
    }
    this.pendingAttack = false;
  }

  _performAttack() {
    const p = this.player;
    const speed = 520;
    const projectileLife = 0.6;
    const baseDamage = p.attackPower + Math.round(p.strength * 0.4 + p.agility * 0.2);

    // Aim at nearest mob
    let target = null;
    let bestDist = Infinity;
    for (const mob of this.mobs) {
      if (!mob.alive) continue;
      const dx = mob.x - p.x;
      const dy = mob.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < bestDist) {
        bestDist = d;
        target = mob;
      }
    }

    let dirX, dirY;
    if (target && bestDist > 1) {
      dirX = (target.x - p.x) / bestDist;
      dirY = (target.y - p.y) / bestDist;
    } else {
      dirX = Math.cos(p.facingAngle || 0);
      dirY = Math.sin(p.facingAngle || 0);
    }

    const proj = new RactrProjectile(
      p.x + dirX * (p.radius + 4),
      p.y + dirY * (p.radius + 4),
      dirX * speed,
      dirY * speed,
      { damage: baseDamage, radius: 7, life: projectileLife }
    );

    this.projectiles.push(proj);

    this._registerPulse(
      p.x + dirX * (p.radius + 6),
      p.y + dirY * (p.radius + 6),
      "rgba(255, 255, 200, 0.9)",
      p.radius + 20,
      0.2,
      2.5
    );
  }

  _updateMobs(dt) {
    const p = this.player;
    const rect = this._getStaticZoneRect();

    for (const mob of this.mobs) {
      mob.update(dt, p, rect);
    }

    // Cull dead mobs (keep a short delay for feel if you want; for now, immediate)
    this.mobs = this.mobs.filter((m) => m.alive || m.health > 0);
  }

  _updateProjectiles(dt) {
    for (const proj of this.projectiles) {
      proj.update(dt);
    }
    const rect = this._getStaticZoneRect();
    this.projectiles = this.projectiles.filter((proj) => {
      if (!proj.alive) return false;
      if (
        proj.x < rect.minX - 40 ||
        proj.x > rect.maxX + 40 ||
        proj.y < rect.minY - 40 ||
        proj.y > rect.maxY + 40
      ) {
        return false;
      }
      return true;
    });
  }

  _handleCollisions() {
    const p = this.player;

    if (p.health <= 0) return;

    // Mob -> player contact
    for (const mob of this.mobs) {
      if (!mob.alive) continue;
      const dx = mob.x - p.x;
      const dy = mob.y - p.y;
      const dist = Math.hypot(dx, dy);
      const r = mob.radius + p.radius * 0.8;

      if (dist <= r) {
        if (p.invulnTime <= 0) {
          const damage = mob.contactDamage || 10;
          this._dealDamageToPlayer(damage);
          p.invulnTime = 0.7;
          this.lastHitTime = this.time;
        }
      }
    }

    // Projectile -> mob
    for (const proj of this.projectiles) {
      if (!proj.alive) continue;
      for (const mob of this.mobs) {
        if (!mob.alive) continue;
        const dx = mob.x - proj.x;
        const dy = mob.y - proj.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= mob.radius + proj.radius) {
          mob.takeDamage(proj.damage);
          proj.life = 0;

          if (!mob.alive) {
            this._onMobKilled(mob);
          }
          break;
        }
      }
    }
  }

  _dealDamageToPlayer(amount) {
    const p = this.player;
    const mitigated = Math.max(0, amount - p.defense * 0.5);
    const final = Math.max(1, Math.round(mitigated));

    p.health = Math.max(0, p.health - final);
    this._registerPulse(p.x, p.y, "rgba(255, 60, 90, 0.9)", p.radius + 38, 0.45, 4);
    this.lastHitTime = this.time;

    if (p.health <= 0) {
      this._endRun();
    }
  }

  _onMobKilled(mob) {
    this.lastKillTime = this.time;

    const baseXp = mob.baseXp || 16;
    const xp = baseXp + Math.round(Math.random() * 6);
    this._grantXp(xp);

    this._registerPulse(
      mob.x,
      mob.y,
      "rgba(170, 255, 210, 0.9)",
      mob.radius + 40,
      0.55,
      3.5
    );

    this.player.gold += 1 + Math.round(Math.random() * 3);
  }

  _grantXp(amount) {
    const p = this.player;
    p.xp += amount;

    while (p.xp >= p.xpToNext) {
      p.xp -= p.xpToNext;
      p.level += 1;

      const hpGain = 14;
      const manaGain = 6;
      const strGain = 2;
      const agiGain = 2;
      const intGain = 1;

      p.strength += strGain;
      p.agility += agiGain;
      p.intelligence += intGain;
      p.maxHealth += hpGain + Math.round(strGain * 1.3);
      p.maxMana += manaGain + Math.round(intGain * 1.1);
      p.attackPower += 3 + Math.round(strGain * 0.7);
      p.defense += 1 + Math.round(strGain * 0.3);
      p.critChance += agiGain * 0.003;

      p.health = p.maxHealth;
      p.mana = p.maxMana;

      // Exponential-ish XP curve
      const base = 130;
      const exp = 1.28;
      p.xpToNext = Math.floor(base * Math.pow(p.level, exp)) + 60;

      this._registerPulse(
        p.x,
        p.y,
        "rgba(120, 220, 255, 0.95)",
        p.radius + 60,
        0.7,
        5
      );
    }
  }

  _maybeSpawnExtraMobs(dt) {
    // Over time, slowly add more mobs up to a cap, based on how long you've survived.
    const maxBase = 9;
    const extra = Math.floor(this.runTime / 20); // +1 mob every 20 seconds
    const maxMobs = Math.min(20, maxBase + extra);

    if (this.mobs.length >= maxMobs) return;
    if (Math.random() > 0.015) return; // rare-ish chance per frame

    const rect = this._getStaticZoneRect();
    const x = rect.minX + 60 + Math.random() * (rect.width - 120);
    const y = rect.minY + 60 + Math.random() * (rect.height - 120);

    const level = 1 + Math.floor(this.runTime / 45);
    const maxHp = 40 + level * 20;
    const moveSpeed = 60 + level * 10;

    const mob = new RactrMob(x, y, {
      radius: 16,
      maxHealth: maxHp,
      moveSpeed,
      name: level >= 3 ? "Crossroads Lurker" : "Everlight Wisp",
      level,
      baseXp: 20 + level * 10,
      colorBody: level >= 3 ? "#ff6b81" : "#53f5b8",
      colorCore: "#ffffff",
      behavior: "chaser",
      aggroRange: 280 + level * 30,
      contactDamage: 12 + level * 5,
    });

    this.mobs.push(mob);
  }

  // -------------------- Visual helpers --------------------

  _registerPulse(x, y, color, radius, duration, thickness) {
    if (this.pulses.length > 64) this.pulses.shift();
    this.pulses.push({
      x,
      y,
      radius,
      maxRadius: radius,
      color,
      life: duration,
      maxLife: duration,
      thickness: thickness || 2,
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

  _getStaticZoneRect() {
    const c = this.canvas;
    const pad = 60;
    const width = c.clientWidth || c.width || 960;
    const height = c.clientHeight || c.height || 540;

    const minX = pad;
    const maxX = width - pad;
    const minY = pad + 40;
    const maxY = height - pad;

    return {
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  // -------------------- Rendering --------------------

  render(ctx, width, height) {
    // Background sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#040615");
    sky.addColorStop(0.35, "#151b33");
    sky.addColorStop(1, "#090d18");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const rect = this._getStaticZoneRect();

    // Ground tiles
    this._renderGround(ctx, rect);

    // Paths and stone circle
    this._renderRoads(ctx, rect);

    // Mobs, player, projectiles
    for (const mob of this.mobs) {
      this._renderMob(ctx, mob);
    }

    for (const proj of this.projectiles) {
      this._renderProjectile(ctx, proj);
    }

    this._renderPlayer(ctx, this.player);

    // Pulses / vfx
    for (const pulse of this.pulses) {
      const t = pulse.life / pulse.maxLife;
      const alpha = t;
      ctx.beginPath();
      ctx.strokeStyle = pulse.color
        .replace("0.9", alpha.toFixed(3))
        .replace("0.95", alpha.toFixed(3));
      ctx.lineWidth = pulse.thickness || 2;
      ctx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // UI
    this._renderTopHud(ctx, width, height);
    this._renderRpgPanel(ctx, width, height);
    this._renderZonePanel(ctx, width, height);

    // Intro / death overlays
    this._renderStateOverlay(ctx, width, height);
  }

  _renderGround(ctx, rect) {
    const tileSize = 36;
    for (let y = rect.minY; y < rect.maxY; y += tileSize) {
      for (let x = rect.minX; x < rect.maxX; x += tileSize) {
        const noise = (Math.sin(x * 0.06) + Math.cos(y * 0.05)) * 0.04;
        const baseGreen = 120 + (noise * 60) | 0;
        const baseBlue = 80 + (noise * 40) | 0;
        ctx.fillStyle = `rgb(40, ${baseGreen}, ${baseBlue})`;
        ctx.fillRect(x, y, tileSize + 1, tileSize + 1);

        // subtle tile highlight
        ctx.strokeStyle = "rgba(0,0,0,0.09)";
        ctx.strokeRect(x, y, tileSize, tileSize);
      }
    }

    // Outer darker border
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 3;
    ctx.strokeRect(rect.minX, rect.minY, rect.width, rect.height);
  }

  _renderRoads(ctx, rect) {
    const roadWidth = 72;
    const centerX = (rect.minX + rect.maxX) / 2;
    const centerY = (rect.minY + rect.maxY) / 2 + 20;

    ctx.save();
    ctx.globalAlpha = 0.95;

    // Vertical road
    const vRoadGrad = ctx.createLinearGradient(centerX, rect.minY, centerX, rect.maxY);
    vRoadGrad.addColorStop(0, "#3a3126");
    vRoadGrad.addColorStop(0.5, "#4a3b2d");
    vRoadGrad.addColorStop(1, "#2f251c");
    ctx.fillStyle = vRoadGrad;
    ctx.fillRect(centerX - roadWidth / 2, rect.minY, roadWidth, rect.height);

    // Horizontal road
    const hRoadGrad = ctx.createLinearGradient(rect.minX, centerY, rect.maxX, centerY);
    hRoadGrad.addColorStop(0, "#3a3126");
    hRoadGrad.addColorStop(0.5, "#514131");
    hRoadGrad.addColorStop(1, "#3a3126");
    ctx.fillStyle = hRoadGrad;
    ctx.fillRect(rect.minX, centerY - roadWidth / 2, rect.width, roadWidth);

    // Stone circle at intersection
    ctx.beginPath();
    ctx.strokeStyle = "rgba(190, 172, 140, 0.98)";
    ctx.lineWidth = 4;
    ctx.arc(centerX, centerY, 52, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = "rgba(80, 65, 40, 0.9)";
    ctx.lineWidth = 1;
    ctx.arc(centerX, centerY, 52, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  _renderMob(ctx, mob) {
    if (!mob.alive) return;

    // Body
    ctx.save();
    ctx.beginPath();
    const wobble = 1 + Math.sin(this.time * 3 + mob.x * 0.05) * 0.15;
    const radius = mob.radius * wobble;
    ctx.fillStyle = mob.colorBody;
    ctx.shadowColor = mob.colorBody;
    ctx.shadowBlur = 15;
    ctx.arc(mob.x, mob.y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Core
    ctx.beginPath();
    ctx.fillStyle = mob.colorCore;
    ctx.shadowBlur = 0;
    ctx.arc(mob.x, mob.y, radius * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Hit flash overlay
    if (mob.hitFlash > 0) {
      const alpha = mob.hitFlash / 0.18;
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,255,255,${0.45 * alpha})`;
      ctx.arc(mob.x, mob.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Health bar
    const barWidth = 40;
    const barHeight = 4;
    const barX = mob.x - barWidth / 2;
    const barY = mob.y - mob.radius - 12;
    const hpRatio = Math.max(0, Math.min(1, mob.health / mob.maxHealth));

    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = "#f85f7f";
    ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(barX + 0.5, barY + 0.5, barWidth - 1, barHeight - 1);

    // Name + level
    ctx.font = "10px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "rgba(245, 235, 220, 0.96)";
    ctx.textAlign = "center";
    ctx.fillText(`${mob.name} [${mob.level}]`, mob.x, barY - 4);
  }

  _renderProjectile(ctx, proj) {
    const t = proj.life / proj.maxLife;
    const alpha = 0.4 + 0.6 * t;

    ctx.save();
    ctx.beginPath();
    const grad = ctx.createRadialGradient(
      proj.x,
      proj.y,
      0,
      proj.x,
      proj.y,
      proj.radius * 2
    );
    grad.addColorStop(0, `rgba(255, 255, 210, ${alpha})`);
    grad.addColorStop(0.5, `rgba(255, 220, 160, ${alpha * 0.8})`);
    grad.addColorStop(1, `rgba(255, 180, 120, 0)`);
    ctx.fillStyle = grad;
    ctx.arc(proj.x, proj.y, proj.radius * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _renderPlayer(ctx, p) {
    ctx.save();

    const t = this.time;
    const breath = 0.07 * Math.sin(t * 3) + 1;
    const radius = p.radius * breath;

    // Outer aura
    ctx.beginPath();
    const auraGrad = ctx.createRadialGradient(
      p.x,
      p.y,
      radius * 0.5,
      p.x,
      p.y,
      radius * 2.1
    );
    auraGrad.addColorStop(0, "rgba(120, 210, 255, 0.65)");
    auraGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = auraGrad;
    ctx.arc(p.x, p.y, radius * 2.1, 0, Math.PI * 2);
    ctx.fill();

    // Core
    ctx.beginPath();
    const coreColor = "#5f9cff";
    ctx.fillStyle = coreColor;
    ctx.globalAlpha = p.invulnTime > 0 ? (Math.sin(t * 24) > 0 ? 0.4 : 1) : 1;
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Inner white pulse
    ctx.beginPath();
    const innerPulse = 0.7 + 0.3 * Math.sin(t * 8);
    ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.25 * innerPulse})`;
    ctx.arc(p.x, p.y, radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Heading / "blade" indicator
    const angle = p.facingAngle || 0;
    const bladeLen = radius + 10;
    const bladeWidth = 6;
    const tipX = p.x + Math.cos(angle) * bladeLen;
    const tipY = p.y + Math.sin(angle) * bladeLen;
    const leftX = p.x + Math.cos(angle + Math.PI * 0.5) * bladeWidth;
    const leftY = p.y + Math.sin(angle + Math.PI * 0.5) * bladeWidth;
    const rightX = p.x + Math.cos(angle - Math.PI * 0.5) * bladeWidth;
    const rightY = p.y + Math.sin(angle - Math.PI * 0.5) * bladeWidth;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 240, 190, 0.95)";
    ctx.fill();
    ctx.strokeStyle = "rgba(80, 60, 40, 0.9)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  _renderTopHud(ctx, width, height) {
    const p = this.player;

    // Time + best
    ctx.save();
    ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.textAlign = "left";
    ctx.fillText(`Time: ${this.runTime.toFixed(2)}s`, 12, 20);
    ctx.textAlign = "right";
    ctx.fillText(`Best: ${this.bestTime.toFixed(2)}s`, width - 12, 20);

    // Health bar center-top
    const barWidth = Math.min(260, width * 0.5);
    const barHeight = 12;
    const barX = (width - barWidth) / 2;
    const barY = 34;
    const healthRatio = Math.max(0, Math.min(1, p.health / p.maxHealth));

    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(barX, barY, barWidth, barHeight);

    const hpGrad = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
    hpGrad.addColorStop(0, "#3dd68c");
    hpGrad.addColorStop(0.5, "#f5d76e");
    hpGrad.addColorStop(1, "#ff6b81");
    ctx.fillStyle = hpGrad;
    ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);

    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, barY + 0.5, barWidth - 1, barHeight - 1);

    const hpPercent = Math.round(healthRatio * 100);
    const healthText = `HP ${Math.ceil(p.health)}/${p.maxHealth} (${hpPercent}%)`;
    if (healthText !== this.cachedHealthText) {
      this.cachedHealthText = healthText;
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(this.cachedHealthText, barX + barWidth / 2, barY - 3);

    // Low-health vignette
    if (healthRatio < 0.35) {
      const vignetteStrength = (1 - healthRatio) * 0.32;
      ctx.fillStyle = `rgba(255,40,80,${vignetteStrength})`;
      ctx.fillRect(0, 0, width, height);
    }

    ctx.restore();
  }

  _renderRpgPanel(ctx, width, height) {
    const p = this.player;
    const panelPadding = 8;
    const panelWidth = Math.min(220, width * 0.45);
    const panelX = panelPadding;
    const panelY = panelPadding;

    ctx.save();
    ctx.translate(panelX, panelY);

    const lineHeight = 12;
    const totalLines = 8;
    const panelHeight = totalLines * lineHeight + 14;

    ctx.fillStyle = "rgba(5, 6, 10, 0.7)";
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;

    const radius = 6;
    const w = panelWidth;
    const h = panelHeight;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(w - radius, 0);
    ctx.quadraticCurveTo(w, 0, w, radius);
    ctx.lineTo(w, h - radius);
    ctx.quadraticCurveTo(w, h, w - radius, h);
    ctx.lineTo(radius, h);
    ctx.quadraticCurveTo(0, h, 0, h - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    let y = 13;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${p.name} – ${p.classId}`, 8, y);

    y += lineHeight;
    const levelLine = `Lv ${p.level}`;
    const xpLine = `${Math.floor(p.xp)}/${p.xpToNext}`;
    const rpgLine = `${levelLine} · XP ${xpLine}`;
    if (rpgLine !== this.cachedRpgLine) {
      this.cachedRpgLine = rpgLine;
    }
    ctx.fillStyle = "rgba(190, 210, 255, 0.96)";
    ctx.fillText(this.cachedRpgLine, 8, y);

    const xpRatio = Math.max(0, Math.min(1, p.xp / p.xpToNext));
    const xpBarX = 8;
    const xpBarY = y + 3;
    const xpBarWidth = panelWidth - 16;
    const xpBarHeight = 4;

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(xpBarX, xpBarY, xpBarWidth, xpBarHeight);
    ctx.fillStyle = "rgba(120, 230, 255, 0.95)";
    ctx.fillRect(xpBarX, xpBarY, xpBarWidth * xpRatio, xpBarHeight);

    y += lineHeight + 6;
    ctx.fillStyle = "rgba(210, 255, 210, 0.9)";
    ctx.fillText(`HP ${Math.ceil(p.health)}/${p.maxHealth}`, 8, y);

    y += lineHeight;
    ctx.fillStyle = "rgba(200, 220, 255, 0.9)";
    ctx.fillText(`Mana ${Math.ceil(p.mana)}/${p.maxMana}`, 8, y);

    y += lineHeight;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(
      `STR ${Math.round(p.strength)}  AGI ${Math.round(
        p.agility
      )}  INT ${Math.round(p.intelligence)}`,
      8,
      y
    );

    y += lineHeight;
    const critPercent = (p.critChance * 100).toFixed(1);
    ctx.fillText(
      `ATK ${Math.round(p.attackPower)}  DEF ${Math.round(
        p.defense
      )}  Crit ${critPercent}%`,
      8,
      y
    );

    y += lineHeight;
    ctx.fillStyle = "rgba(245, 215, 110, 0.9)";
    ctx.fillText(`Gold ${p.gold}`, 8, y);

    ctx.restore();
  }

  _renderZonePanel(ctx, width, height) {
    const zone = this.zone;
    const padding = 8;
    const panelWidth = Math.min(210, width * 0.4);
    const panelHeight = 32;
    const panelX = width - panelWidth - padding;
    const panelY = padding;

    ctx.save();
    ctx.translate(panelX, panelY);

    ctx.fillStyle = "rgba(5, 6, 10, 0.7)";
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    const radius = 6;
    const w = panelWidth;
    const h = panelHeight;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(w - radius, 0);
    ctx.quadraticCurveTo(w, 0, w, radius);
    ctx.lineTo(w, h - radius);
    ctx.quadraticCurveTo(w, h, w - radius, h);
    ctx.lineTo(radius, h);
    ctx.quadraticCurveTo(0, h, 0, h - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(210, 225, 255, 0.96)";
    ctx.fillText(zone.name, 8, 13);

    if (zone.levelRange && zone.levelRange.length === 2) {
      const range = `Lv ${zone.levelRange[0]}–${zone.levelRange[1]}`;
      ctx.fillStyle = "rgba(180, 200, 255, 0.9)";
      ctx.fillText(range, 8, 25);
    }

    ctx.restore();
  }

  _renderStateOverlay(ctx, width, height) {
    const centerX = width / 2;
    const centerY = height / 2;

    ctx.save();
    ctx.textAlign = "center";

    if (this.state === "intro") {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = "26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("RACTR · Everlight Crossroads", centerX, centerY - 10);

      ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(
        "Move with WASD / arrows. Space to dash. Press J to attack. Survive and level up.",
        centerX,
        centerY + 16
      );
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText(
        "Press Space or Enter to begin your first run.",
        centerX,
        centerY + 38
      );
    } else if (this.state === "dead") {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "rgba(255,120,140,0.96)";
      ctx.font = "26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("You have fallen at the crossroads.", centerX, centerY - 10);

      ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(
        `This run: ${this.runTime.toFixed(2)}s · Best: ${this.bestTime.toFixed(
          2
        )}s · Lv ${this.player.level}`,
        centerX,
        centerY + 16
      );
      ctx.fillText(
        "Press Space or Enter to try again.",
        centerX,
        centerY + 38
      );
    }

    ctx.restore();
  }
}

// Make RactrGame available globally
if (typeof window !== "undefined") {
  window.RactrGame = RactrGame;
}
