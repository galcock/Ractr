// RactrGame: high-level game orchestrator and single-player client.
// In this phase, RactrGame becomes a coordinator that leans on the
// modular engine surface (state, entities, UI, audio, net) when
// available, but continues to provide a complete single-player
// experience via legacy inline logic if any module is missing.

class RactrGame {
  constructor(engine) {
    this.engine = engine;

    // Core configuration scaffold: engine-level defaults that can be
    // overridden via engine/ractr_config.json.
    this.config = {
      player: {
        maxHealth: 100,
        dashCooldown: 0.6,
        baseSpeed: 180,
        dashSpeed: 360,
        baseMaxMana: 50,
        baseAttackPower: 10,
        baseDefense: 2,
        baseCritChance: 0.05,
        baseXpPerSecondSurvived: 1,
        baseStrength: 10,
        baseAgility: 10,
        baseIntelligence: 10
      },
      hazards: {
        baseSpawnInterval: 1.4,
        minSpawnInterval: 0.5,
        spawnIntervalDecayPerSecond: 0.05,
        baseSpeed: 80,
        randomSpeed: 140,
        damagePerHit: 20,
        maxOnScreen: 40,
        xpOnHitTaken: 2
      },
      difficulty: {
        speedIncreasePerSecond: 10,
        spawnCountIncreaseTimes: [10, 20, 30]
      },
      visuals: {
        backgroundGradient: ["#05060a", "#101426"],
        hazardColor: "rgba(255, 85, 120, ALPHA)",
        playerCoreColor: "#5f9cff"
      },
      progression: {
        baseXpToLevel: 100,
        xpLevelExponent: 1.3,
        hpPerLevel: 10,
        manaPerLevel: 5,
        attackPerLevel: 2,
        defensePerLevel: 1,
        strengthPerLevel: 1,
        agilityPerLevel: 1,
        intelligencePerLevel: 1
      },
      meta: {
        startingZoneId: "training_grounds",
        zones: {
          training_grounds: {
            name: "Training Grounds",
            levelRange: [1, 3]
          }
        }
      },
      net: {
        websocketUrl: "",
        httpBaseUrl: ""
      }
    };

    // --- Core game state --------------------------------------------------

    // Prefer external RactrGameState if present; otherwise fall back
    // to a minimal inline structure that mimics its shape closely.
    if (typeof RactrGameState === "function") {
      this.gameState = new RactrGameState(this.config);
    } else {
      this.gameState = this._createLegacyInlineState();
    }

    // Entity accessors (always point at gameState containers).
    this.player = this.gameState.player;
    this.hazards = this.gameState.hazards;

    // Legacy hazard spawning values.
    this.spawnTimer = 0;
    this.spawnInterval = this.config.hazards.baseSpawnInterval;

    // Visual orbiters for player representation.
    this.orbiters = [];
    for (let i = 0; i < 24; i++) {
      this.orbiters.push({
        angle: (i / 24) * Math.PI * 2,
        radius: 40 + (i % 5) * 12,
        speed: 0.6 + (i % 3) * 0.2
      });
    }

    this.difficultyDuration = 60;

    // Hit / near-miss feedback.
    this.lastHitTime = -999;
    this.lastNearMissTime = -999;
    this.lastNearMissPulseTime = -999;
    this.nearMissStreak = 0;

    // Pulse visual effects.
    this.pulses = [];

    // Cached HUD strings for minor perf wins.
    this._cachedHealthText = "";
    this._cachedLevelText = "";

    // Optional networking surface.
    if (typeof RactrNetClient === "function") {
      this.net = new RactrNetClient(this.config.net);
    } else {
      this.net = {
        applyConfig: function () {},
        tick: function () {},
        notifyRunStarted: function () {},
        notifyRunEnded: function () {},
        notifyLevelUp: function () {}
      };
    }

    // Optional UI & audio modules (must fail gracefully).
    this.ui = typeof RactrUI !== "undefined" ? RactrUI : null;
    this.audio = typeof RactrAudio !== "undefined" ? RactrAudio : null;

    this.isCharacterSheetOpen = false;

    this._attachStartInput();
    this._attachUiInput();
    this._loadConfig();

    if (this.engine && this.engine.canvas && this.engine.canvas.classList) {
      this.engine.canvas.classList.add("ractr-active");
    }
  }

  // ---------------------------------------------------------------------------
  // State initialization and configuration
  // ---------------------------------------------------------------------------

  _createLegacyInlineState() {
    const player = this._createInitialPlayer();
    return {
      player,
      hazards: [],
      time: 0,
      timeAlive: 0,
      bestTime: 0,
      state: "intro",
      applyConfig: null,
      syncFromSnapshot: null
    };
  }

  _createInitialPlayer() {
    return {
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
      maxMana: this.config.player.baseMaxMana,
      mana: this.config.player.baseMaxMana,
      invulnTime: 0,
      id: "local-player",
      name: "Adventurer",
      classId: "dashblade",
      level: 1,
      xp: 0,
      xpToNext: 100,
      strength: this.config.player.baseStrength,
      agility: this.config.player.baseAgility,
      intelligence: this.config.player.baseIntelligence,
      attackPower: this.config.player.baseAttackPower,
      defense: this.config.player.baseDefense,
      critChance: this.config.player.baseCritChance,
      gold: 0,
      inventory: [],
      zoneId: this.config.meta.startingZoneId,
      _initializedFromConfig: false,
      snapshot: function () {
        return {
          id: this.id,
          name: this.name,
          classId: this.classId,
          level: this.level,
          xp: this.xp,
          xpToNext: this.xpToNext,
          strength: this.strength,
          agility: this.agility,
          intelligence: this.intelligence,
          maxHealth: this.maxHealth,
          health: this.health,
          maxMana: this.maxMana,
          mana: this.mana,
          attackPower: this.attackPower,
          defense: this.defense,
          critChance: this.critChance,
          gold: this.gold,
          inventory: this.inventory.slice(),
          zoneId: this.zoneId
        };
      }
    };
  }

  getPlayerStateSnapshot() {
    const p = this.player;
    if (!p) return null;
    if (typeof p.snapshot === "function") {
      return p.snapshot();
    }
    return {
      id: p.id,
      name: p.name,
      classId: p.classId,
      level: p.level,
      xp: p.xp,
      xpToNext: p.xpToNext,
      strength: p.strength,
      agility: p.agility,
      intelligence: p.intelligence,
      maxHealth: p.maxHealth,
      health: p.health,
      maxMana: p.maxMana,
      mana: p.mana,
      attackPower: p.attackPower,
      defense: p.defense,
      critChance: p.critChance,
      gold: p.gold,
      inventory: Array.isArray(p.inventory) ? p.inventory.slice() : [],
      zoneId: p.zoneId
    };
  }

  _loadConfig() {
    try {
      fetch("engine/ractr_config.json")
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load ractr_config.json");
          return res.json();
        })
        .then((cfg) => {
          if (cfg.player) {
            this.config.player = Object.assign({}, this.config.player, cfg.player);
          }
          if (cfg.hazards) {
            this.config.hazards = Object.assign({}, this.config.hazards, cfg.hazards);
          }
          if (cfg.difficulty) {
            this.config.difficulty = Object.assign({}, this.config.difficulty, cfg.difficulty);
          }
          if (cfg.visuals) {
            this.config.visuals = Object.assign({}, this.config.visuals, cfg.visuals);
          }
          if (cfg.progression) {
            this.config.progression = Object.assign({}, this.config.progression, cfg.progression);
          }
          if (cfg.meta) {
            this.config.meta = Object.assign({}, this.config.meta, cfg.meta);
          }
          if (cfg.net) {
            this.config.net = Object.assign({}, this.config.net, cfg.net);
            if (this.net && typeof this.net.applyConfig === "function") {
              this.net.applyConfig(this.config.net);
            }
          }

          if (this.gameState && typeof this.gameState.applyConfig === "function") {
            this.gameState.applyConfig(this.config);
            this.player = this.gameState.player;
            this.hazards = this.gameState.hazards;
          }

          this._applyConfigToPlayer();
          this.spawnInterval = this.config.hazards.baseSpawnInterval;
        })
        .catch(() => {
          this._applyConfigToPlayer();
        });
    } catch (e) {
      this._applyConfigToPlayer();
    }
  }

  _applyConfigToPlayer() {
    const pCfg = this.config.player;
    const progCfg = this.config.progression;
    const p = this.player;

    if (!p) return;

    p.baseSpeed = pCfg.baseSpeed;
    p.dashSpeed = pCfg.dashSpeed;

    if (!p._initializedFromConfig) {
      p.level = p.level || 1;
      p.xp = p.xp || 0;

      p.strength = pCfg.baseStrength;
      p.agility = pCfg.baseAgility;
      p.intelligence = pCfg.baseIntelligence;

      p.maxHealth = pCfg.maxHealth + Math.round(p.strength * 1.5);
      p.maxMana = pCfg.baseMaxMana + Math.round(p.intelligence * 1.2);
      p.attackPower =
        pCfg.baseAttackPower +
        Math.round(p.strength * 0.6) +
        Math.round(p.agility * 0.2);
      p.defense = pCfg.baseDefense + Math.round(p.strength * 0.3);
      p.critChance = pCfg.baseCritChance + p.agility * 0.001;

      p.health = p.maxHealth;
      p.mana = p.maxMana;
      p.xpToNext = this._computeXpForLevel(p.level + 1, progCfg);
      p.zoneId = this.config.meta.startingZoneId;

      p._initializedFromConfig = true;
    } else {
      const levelBonus = p.level - 1;
      const strengthBonus = (progCfg.strengthPerLevel || 0) * levelBonus;
      const agilityBonus = (progCfg.agilityPerLevel || 0) * levelBonus;
      const intBonus = (progCfg.intelligencePerLevel || 0) * levelBonus;

      p.strength = pCfg.baseStrength + strengthBonus;
      p.agility = pCfg.baseAgility + agilityBonus;
      p.intelligence = pCfg.baseIntelligence + intBonus;

      p.maxHealth =
        pCfg.maxHealth +
        Math.round(p.strength * 1.5) +
        levelBonus * (progCfg.hpPerLevel || 0);
      p.maxMana =
        pCfg.baseMaxMana +
        Math.round(p.intelligence * 1.2) +
        levelBonus * (progCfg.manaPerLevel || 0);
      p.attackPower =
        pCfg.baseAttackPower +
        Math.round(p.strength * 0.6) +
        Math.round(p.agility * 0.2) +
        levelBonus * (progCfg.attackPerLevel || 0);
      p.defense =
        pCfg.baseDefense +
        Math.round(p.strength * 0.3) +
        levelBonus * (progCfg.defensePerLevel || 0);
      p.critChance = pCfg.baseCritChance + p.agility * 0.001;

      const state = this.gameState && this.gameState.state ? this.gameState.state : "intro";
      if (state !== "playing") {
        p.health = p.maxHealth;
        p.mana = p.maxMana;
      } else {
        if (p.health > p.maxHealth) p.health = p.maxHealth;
        if (p.mana > p.maxMana) p.mana = p.maxMana;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Input wiring
  // ---------------------------------------------------------------------------

  _attachStartInput() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.key === " " || e.key === "Enter") {
        const state = this.gameState && this.gameState.state ? this.gameState.state : "intro";
        if (state === "intro" || state === "gameover") {
          this._startGame();
        }
      }
    });
  }

  _attachUiInput() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === "i") {
        this.isCharacterSheetOpen = !this.isCharacterSheetOpen;
        if (this.ui && typeof this.ui.setPanelVisible === "function") {
          this.ui.setPanelVisible("character", this.isCharacterSheetOpen, this.getPlayerStateSnapshot());
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Game lifecycle
  // ---------------------------------------------------------------------------

  _startGame() {
    this._applyConfigToPlayer();

    const canvas = this.engine.canvas;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;

    const p = this.player;
    p.x = w / 2;
    p.y = h / 2;
    p.vx = 0;
    p.vy = 0;
    p.dashCooldown = 0;
    p.health = p.maxHealth;
    p.mana = p.maxMana;
    p.invulnTime = 0;

    this.hazards.length = 0;
    this.spawnTimer = 0.4;
    this.spawnInterval = this.config.hazards.baseSpawnInterval;

    if (this.gameState) {
      this.gameState.timeAlive = 0;
      this.gameState.state = "playing";
      if (Array.isArray(this.gameState.hazards)) {
        this.hazards = this.gameState.hazards;
      } else {
        this.gameState.hazards = this.hazards;
      }
    }

    this.nearMissStreak = 0;

    this.pulses.length = 0;
    this.lastHitTime = -999;
    this.lastNearMissTime = -999;
    this.lastNearMissPulseTime = -999;

    if (this.audio && typeof this.audio.onRunStarted === "function") {
      this.audio.onRunStarted();
    }

    this.net.notifyRunStarted(this.getPlayerStateSnapshot());
  }

  _difficultyFactor() {
    const timeAlive = this.gameState ? this.gameState.timeAlive : 0;
    const t = Math.max(0, Math.min(this.difficultyDuration, timeAlive));
    return t / this.difficultyDuration;
  }

  // ---------------------------------------------------------------------------
  // Update loop
  // ---------------------------------------------------------------------------

  update(dt, input) {
    if (!this.gameState) return;

    this.gameState.time += dt;
    const timeAliveBefore = this.gameState.timeAlive;

    this._updatePulses(dt);

    const state = this.gameState.state;
    if (state !== "playing") {
      if (this.ui && typeof this.ui.update === "function") {
        this.ui.update(dt, { state: this.gameState, player: this.player });
      }
      if (this.audio && typeof this.audio.update === "function") {
        this.audio.update(dt, { state: this.gameState, player: this.player });
      }
      return;
    }

    this.gameState.timeAlive = timeAliveBefore + dt;

    const hCfg = this.config.hazards;
    const factor = this._difficultyFactor();
    const baseInterval = hCfg.baseSpawnInterval;
    const targetInterval = hCfg.minSpawnInterval;
    const eased = factor * factor * (3 - 2 * factor);
    this.spawnInterval = baseInterval + (targetInterval - baseInterval) * eased;

    this._updatePlayer(dt, input);
    this._updateHazards(dt);
    this._checkCollisions();
    this._updatePlayerProgression(dt);

    const snapshot = {
      player: this.getPlayerStateSnapshot(),
      timeAlive: this.gameState.timeAlive,
      zoneId: this.player.zoneId
    };

    if (this.net && typeof this.net.tick === "function") {
      this.net.tick(dt, snapshot);
    }

    if (this.gameState && typeof this.gameState.syncFromSnapshot === "function") {
      this.gameState.syncFromSnapshot(snapshot);
      this.player = this.gameState.player;
      this.hazards = this.gameState.hazards;
    }

    if (this.ui && typeof this.ui.update === "function") {
      this.ui.update(dt, { state: this.gameState, player: this.player });
    }

    if (this.audio && typeof this.audio.update === "function") {
      this.audio.update(dt, { state: this.gameState, player: this.player });
    }
  }

  _updatePlayer(dt, input) {
    const p = this.player;
    const pCfg = this.config.player;

    if (!p) return;

    if (p.invulnTime > 0) {
      p.invulnTime = Math.max(0, p.invulnTime - dt);
    }

    let speed = p.baseSpeed;
    if (input.dash && p.dashCooldown <= 0) {
      speed = p.dashSpeed;
      p.dashCooldown = pCfg.dashCooldown;
      if (this.audio && typeof this.audio.playDash === "function") {
        this.audio.playDash();
      }
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

    const speedMultiplier = 1 + 0.6 * factor;
    const base = hCfg.baseSpeed * speedMultiplier;
    const linearScale = 0.15;
    const timeAlive = this.gameState ? this.gameState.timeAlive : 0;
    const linearIncrease =
      (dCfg.speedIncreasePerSecond || 0) * linearScale * timeAlive;

    return base + linearIncrease;
  }

  _spawnHazard() {
    const canvas = this.engine.canvas;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;

    const hCfg = this.config.hazards;
    const dCfg = this.config.difficulty;

    let spawnCount = 1;
    const times = dCfg.spawnCountIncreaseTimes || [];
    const timeAlive = this.gameState ? this.gameState.timeAlive : 0;
    for (let i = 0; i < times.length; i++) {
      if (timeAlive >= times[i]) {
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
      const edge = Math.floor(Math.random() * 4);
      const baseSpeed = this._currentHazardSpeed();
      const randomBonus = Math.random() * hCfg.randomSpeed;
      const speed = baseSpeed + randomBonus;
      let x;
      let y;
      let vx;
      let vy;
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

      const sizeFactor = 0.5 + 0.5 * this._difficultyFactor();
      const baseRadius = 8 + Math.random() * 8;
      const radius = baseRadius * (0.6 + 0.8 * sizeFactor);

      this.hazards.push({
        x,
        y,
        vx,
        vy,
        radius,
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

    this.hazards = this.hazards.filter((hzd) => {
      hzd.x += hzd.vx * dt;
      hzd.y += hzd.vy * dt;

      if (hzd.x < minX || hzd.x > maxX || hzd.y < minY || hzd.y > maxY) {
        return false;
      }
      return true;
    });

    if (this.gameState) {
      this.gameState.hazards = this.hazards;
    }
  }

  // ---------------------------------------------------------------------------
  // Visual pulses
  // ---------------------------------------------------------------------------

  _registerPulse(x, y, color, radius, duration, thickness) {
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

  // ---------------------------------------------------------------------------
  // Collisions & progression
  // ---------------------------------------------------------------------------

  _checkCollisions() {
    const p = this.player;
    const pr = p.radius;

    if (p.health <= 0) return;

    const hCfg = this.config.hazards;
    const damage = hCfg.damagePerHit;

    const nearMissPadding = 14;
    const nearMissPulseCooldown = 0.09;

    let hadHit = false;
    let registeredNearMiss = false;

    for (const hzd of this.hazards) {
      const dx = hzd.x - p.x;
      const dy = hzd.y - p.y;
      const distSq = dx * dx + dy * dy;
      const r = hzd.radius + pr;
      const hitRadiusSq = r * r;

      if (distSq <= hitRadiusSq) {
        if (p.invulnTime <= 0) {
          p.health = Math.max(0, p.health - damage);
          p.invulnTime = 0.45;
          this.lastHitTime = this.gameState ? this.gameState.time : 0;
          hadHit = true;

          this._registerPulse(
            p.x,
            p.y,
            "rgba(255, 90, 120, 0.9)",
            pr + 32,
            0.32,
            3.5
          );

          if (this.audio && typeof this.audio.playHit === "function") {
            this.audio.playHit();
          }

          if (p.health <= 0) {
            if (this.gameState) {
              this.gameState.state = "gameover";
              this.gameState.bestTime = Math.max(
                this.gameState.bestTime || 0,
                this.gameState.timeAlive || 0
              );
            }

            if (this.audio && typeof this.audio.onRunEnded === "function") {
              this.audio.onRunEnded();
            }

            this.net.notifyRunEnded({
              player: this.getPlayerStateSnapshot(),
              timeAlive: this.gameState ? this.gameState.timeAlive : 0
            });
          }
        }
      } else {
        const nearR = r + nearMissPadding;
        if (distSq <= nearR * nearR) {
          registeredNearMiss = true;
          const now = this.gameState ? this.gameState.time : 0;
          this.lastNearMissTime = now;
          if (now - this.lastNearMissPulseTime > nearMissPulseCooldown) {
            this.lastNearMissPulseTime = now;
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
      this.nearMissStreak = 0;
      const xpOnHit = hCfg.xpOnHitTaken || 0;
      if (xpOnHit > 0) {
        this._grantXp(xpOnHit);
      }
    } else if (registeredNearMiss) {
      this.nearMissStreak = Math.min(this.nearMissStreak + 1, 99);
    }
  }

  _updatePlayerProgression(dt) {
    const pCfg = this.config.player;
    const xpRate = pCfg.baseXpPerSecondSurvived || 0;
    if (xpRate > 0) {
      this._grantXp(xpRate * dt);
    }
  }

  _computeXpForLevel(level, progCfg) {
    const base = (progCfg && progCfg.baseXpToLevel) || 100;
    const exp = (progCfg && progCfg.xpLevelExponent) || 1.3;
    const clampedLevel = Math.max(1, level);
    return Math.floor(base * Math.pow(clampedLevel - 1, exp)) + base;
  }

  _grantXp(amount) {
    if (amount <= 0) return;
    const p = this.player;
    const progCfg = this.config.progression;

    p.xp += amount;
    let leveledUp = false;

    while (p.xp >= p.xpToNext) {
      p.xp -= p.xpToNext;
      p.level += 1;
      leveledUp = true;

      const strGain = progCfg.strengthPerLevel || 0;
      const agiGain = progCfg.agilityPerLevel || 0;
      const intGain = progCfg.intelligencePerLevel || 0;
      p.strength += strGain;
      p.agility += agiGain;
      p.intelligence += intGain;

      const hpGain = progCfg.hpPerLevel || 0;
      const manaGain = progCfg.manaPerLevel || 0;
      const atkGain = progCfg.attackPerLevel || 0;
      const defGain = progCfg.defensePerLevel || 0;

      p.maxHealth += hpGain + Math.round(strGain * 1.5);
      p.maxMana += manaGain + Math.round(intGain * 1.2);
      p.attackPower +=
        atkGain + Math.round(strGain * 0.6) + Math.round(agiGain * 0.2);
      p.defense += defGain + Math.round(strGain * 0.3);
      p.critChance += agiGain * 0.001;

      p.health = Math.min(p.maxHealth, p.health + Math.max(5, hpGain));
      p.mana = Math.min(p.maxMana, p.mana + Math.max(3, manaGain));

      p.xpToNext = this._computeXpForLevel(p.level + 1, progCfg);

      this._registerPulse(
        p.x,
        p.y,
        "rgba(120, 230, 255, 0.9)",
        p.radius + 40,
        0.6,
        4
      );

      if (this.audio && typeof this.audio.playLevelUp === "function") {
        this.audio.playLevelUp();
      }
    }

    if (leveledUp) {
      this.net.notifyLevelUp(this.getPlayerStateSnapshot());
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  render(ctx, width, height) {
    const vCfg = this.config.visuals || {};
    const bg0 =
      (vCfg.backgroundGradient && vCfg.backgroundGradient[0]) || "#05060a";
    const bg1 =
      (vCfg.backgroundGradient && vCfg.backgroundGradient[1]) || "#101426";

    const grd = ctx.createLinearGradient(0, 0, width, height);
    grd.addColorStop(0, bg0);
    grd.addColorStop(1, bg1);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, width, height);

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

    const timeNow = this.gameState ? this.gameState.time : 0;
    const hazardColorTemplate =
      vCfg.hazardColor || "rgba(255, 85, 120, ALPHA)";
    ctx.beginPath();
    for (const hzd of this.hazards) {
      const alpha = 0.45 + 0.25 * Math.sin(timeNow * 5 + hzd.x * 0.02);
      const color = hazardColorTemplate.replace("ALPHA", alpha.toFixed(3));
      ctx.fillStyle = color;
      ctx.moveTo(hzd.x + hzd.radius, hzd.y);
      ctx.arc(hzd.x, hzd.y, hzd.radius, 0, Math.PI * 2);
    }
    ctx.fill();

    if (this.hazards.length) {
      const dangerFactor = this._difficultyFactor();
      const accentAlpha = 0.1 + 0.35 * dangerFactor;
      const accentWidth = 1 + 1.5 * dangerFactor;
      const accentColor = `rgba(255, 110, 150, ${accentAlpha.toFixed(3)})`;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = accentWidth;
      for (const hzd of this.hazards) {
        ctx.beginPath();
        ctx.arc(hzd.x, hzd.y, hzd.radius + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

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

    const invulnBlink =
      p.invulnTime > 0 ? (Math.sin(timeNow * 40) > 0 ? 1 : 0.4) : 1;
    ctx.beginPath();
    const coreColor = vCfg.playerCoreColor || "#5f9cff";
    const coreColorWithAlpha = coreColor.startsWith("#") ? coreColor : coreColor;
    ctx.fillStyle = coreColorWithAlpha;
    ctx.globalAlpha = invulnBlink;
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const innerPulse = 0.7 + 0.3 * Math.sin(timeNow * 8);
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.25 * innerPulse})`;
    ctx.arc(p.x, p.y, p.radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

    let outlineColor = "#c2dcff";
    const hitAge = timeNow - this.lastHitTime;
    const nearMissAge = timeNow - this.lastNearMissTime;
    if (hitAge >= 0 && hitAge < 0.28) {
      outlineColor = "#ff5c7a";
    } else if (nearMissAge >= 0 && nearMissAge < 0.25) {
      outlineColor = "#f5d76e";
    }

    ctx.beginPath();
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 2;
    ctx.arc(p.x, p.y, p.radius + 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font =
      "12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    const timeAlive = this.gameState ? this.gameState.timeAlive : 0;
    const bestTime = this.gameState ? this.gameState.bestTime : 0;
    ctx.fillText(`Time: ${timeAlive.toFixed(2)}s`, 12, 20);
    ctx.textAlign = "right";
    ctx.fillText(`Best: ${bestTime.toFixed(2)}s`, width - 12, 20);

    const barWidth = Math.min(220, width * 0.3);
    const barHeight = 10;
    const barX = (width - barWidth) / 2;
    const barY = 32;
    const healthRatio = Math.max(0, Math.min(1, p.health / p.maxHealth));

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(barX, barY, barWidth, barHeight);

    const hpGrd = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
    hpGrd.addColorStop(0, "#3dd68c");
    hpGrd.addColorStop(0.5, "#f5d76e");
    hpGrd.addColorStop(1, "#ff6b81");
    ctx.fillStyle = hpGrd;
    ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);

    if (healthRatio < 0.35) {
      const warningPulse = 0.5 + 0.5 * Math.sin(timeNow * 6);
      ctx.fillStyle = `rgba(255,0,40,${0.25 * warningPulse})`;
      ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, barY + 0.5, barWidth - 1, barHeight - 1);

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font =
      "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    const healthPercent = Math.round(healthRatio * 100);
    const healthText = `Health: ${Math.ceil(p.health)}/${p.maxHealth} (${healthPercent}%)`;
    if (healthText !== this._cachedHealthText) {
      this._cachedHealthText = healthText;
    }
    ctx.fillText(this._cachedHealthText, barX + barWidth / 2, barY - 3);

    if (this.nearMissStreak > 0) {
      const streakMultiplier = 1 + Math.min(this.nearMissStreak, 20) * 0.05;
      ctx.fillStyle = "rgba(245, 215, 110, 0.9)";
      ctx.font =
        "10px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(
        `Risk x${streakMultiplier.toFixed(2)} (${this.nearMissStreak})`,
        width - 12,
        barY + barHeight + 12
      );
    }

    this._renderRpgHud(ctx, width, height);
    this._renderZoneHud(ctx, width, height);

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

    ctx.textAlign = "center";

    const state = this.gameState ? this.gameState.state : "intro";
    if (state === "intro") {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font =
        "24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("RACTR ENGINE b7 DASH", width / 2, height / 2 - 10);
      ctx.font =
        "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText(
        "Move with WASD / arrows. Space to dash. Hazards chip away your health.",
        width / 2,
        height / 2 + 16
      );
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText(
        "Press Space or Enter to start",
        width / 2,
        height / 2 + 38
      );
    } else if (state === "gameover") {
      ctx.fillStyle = "rgba(255,120,140,0.95)";
      ctx.font =
        "24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("GAME OVER", width / 2, height / 2 - 10);
      ctx.font =
        "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(
        `You survived ${timeAlive.toFixed(2)} seconds`,
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

  _renderRpgHud(ctx, width, height) {
    const p = this.player;

    const panelPadding = 8;
    const panelWidth = Math.min(200, width * 0.45);
    const panelX = panelPadding;
    const panelY = panelPadding;

    ctx.save();
    ctx.translate(panelX, panelY);

    const lineHeight = 12;
    let currentY = 0;
    const totalLines = 8;
    const panelHeight = totalLines * lineHeight + 12;

    ctx.fillStyle = "rgba(5, 6, 10, 0.6)";
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const radius = 6;
    const w = panelWidth;
    const h = panelHeight;
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

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font =
      "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";

    currentY += 12;
    ctx.fillText(p.name, 8, currentY);

    currentY += lineHeight;
    ctx.fillStyle = "rgba(190, 210, 255, 0.96)";
    ctx.fillText(`Class ${p.classId}`, 8, currentY);

    const xpRatio = Math.max(0, Math.min(1, p.xp / p.xpToNext));
    const levelText = `Lv ${p.level}`;
    const xpText = `${Math.floor(p.xp)}/${p.xpToNext}`;
    const combinedLevelText = `${levelText}  7b7 XP ${xpText}`;
    if (combinedLevelText !== this._cachedLevelText) {
      this._cachedLevelText = combinedLevelText;
    }

    ctx.fillStyle = "rgba(190, 210, 255, 0.96)";
    currentY += lineHeight;
    ctx.fillText(this._cachedLevelText, 8, currentY);

    const xpBarX = 8;
    const xpBarY = currentY + 3;
    const xpBarWidth = panelWidth - 16;
    const xpBarHeight = 4;

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(xpBarX, xpBarY, xpBarWidth, xpBarHeight);
    ctx.fillStyle = "rgba(120, 230, 255, 0.9)";
    ctx.fillRect(xpBarX, xpBarY, xpBarWidth * xpRatio, xpBarHeight);

    currentY += lineHeight + 6;
    ctx.fillStyle = "rgba(210, 255, 210, 0.9)";
    ctx.fillText(
      `HP ${Math.ceil(p.health)}/${p.maxHealth}`,
      8,
      currentY
    );

    currentY += lineHeight;
    ctx.fillStyle = "rgba(200, 220, 255, 0.9)";
    ctx.fillText(
      `Mana ${Math.ceil(p.mana)}/${p.maxMana}`,
      8,
      currentY
    );

    currentY += lineHeight;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(
      `STR ${Math.round(p.strength)}  AGI ${Math.round(
        p.agility
      )}  INT ${Math.round(p.intelligence)}`,
      8,
      currentY
    );

    currentY += lineHeight;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const critPercent = (p.critChance * 100).toFixed(1);
    ctx.fillText(
      `ATK ${Math.round(p.attackPower)}  DEF ${Math.round(
        p.defense
      )}  Crit ${critPercent}%`,
      8,
      currentY
    );

    currentY += lineHeight;
    ctx.fillStyle = "rgba(245, 215, 110, 0.9)";
    ctx.fillText(`Gold ${p.gold}`, 8, currentY);

    ctx.restore();
  }

  _renderZoneHud(ctx, width, height) {
    const meta = this.config.meta || {};
    const p = this.player;
    const zone = (meta.zones && meta.zones[p.zoneId]) || null;

    const label = zone ? zone.name : "Unknown Zone";
    const range =
      zone && zone.levelRange
        ? `Lv ${zone.levelRange[0]}-${zone.levelRange[1]}`
        : "";

    const padding = 8;
    const panelWidth = Math.min(170, width * 0.35);
    const panelHeight = range ? 32 : 20;
    const panelX = width - panelWidth - padding;
    const panelY = padding;

    ctx.save();
    ctx.translate(panelX, panelY);

    ctx.fillStyle = "rgba(5, 6, 10, 0.6)";
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const radius = 6;
    const w = panelWidth;
    const h = panelHeight;
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

    ctx.font =
      "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(210, 225, 255, 0.96)";
    ctx.fillText(label, 8, 13);

    if (range) {
      ctx.fillStyle = "rgba(180, 200, 255, 0.85)";
      ctx.fillText(range, 8, 25);
    }

    ctx.restore();
  }
}

if (typeof window !== "undefined") {
  window.RactrGame = RactrGame;
}
