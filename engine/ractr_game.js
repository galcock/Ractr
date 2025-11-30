// RactrGame – "Everlight Crossroads" town zone.
// Goal: stop being a space-survival clone and feel like an EQ-style client:
// - You walk around a small town (top-down).
// - There are NPCs with names over their heads.
// - There’s an EQ-ish HUD: HP/MP bars, XP bar, level, gold, hotbar, chat log.
// Controls:
// - WASD / arrows: move
// - Space: dash / sprint
// - J: interact with nearest NPC (shows chat line)

class RactrGame {
  constructor(engine) {
    this.engine = engine;
    this.canvas = engine.canvas;
    this.ctx = engine.ctx;

    this.time = 0;
    this.state = "intro"; // intro | playing

    // --- World / zone definition ---
    this.zone = {
      id: "everlight_town",
      name: "Everlight Crossroads",
      levelRange: [1, 5],
      description:
        "A frontier town at the edge of the Everlight Forest, where new adventurers wake up.",
    };

    // Player state (simple, but RPG-ish)
    this.player = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 14,
      baseSpeed: 150,
      dashSpeed: 280,
      dashCooldown: 0,
      dashCooldownMax: 0.65,

      name: "Adventurer",
      classId: "Warden",
      level: 1,
      xp: 0,
      xpToNext: 120,
      maxHealth: 120,
      health: 120,
      maxMana: 60,
      mana: 60,
      strength: 10,
      agility: 11,
      intelligence: 9,
      attackPower: 15,
      defense: 3,
      critChance: 0.05,
      gold: 12,

      facingAngle: 0,
    };

    // Simple “fake MMO” hooks
    this.totalPlayTime = 0;

    // Town layout: buildings + NPCs
    this.buildings = [];
    this.npcs = [];
    this.hotbarSlots = [
      { key: "1", name: "Minor Heal" },
      { key: "2", name: "Spirit Bolt" },
      { key: "3", name: "Sprint" },
      { key: "4", name: "Campfire" },
      { key: "5", name: "" },
      { key: "6", name: "" },
      { key: "7", name: "" },
      { key: "8", name: "" },
    ];

    this.chatLog = [
      { system: true, text: "Welcome to Everlight Crossroads." },
      { system: true, text: "Press Space or Enter to stand up." },
    ];

    this.pendingInteract = false;
    this._attachCoreInput();
    this._attachInteractInput();

    this._initTownLayout();
    this._resetPlayerToInn();

    if (this.canvas && this.canvas.classList) {
      this.canvas.classList.add("ractr-active");
    }
  }

  // ---------------- INPUT ----------------

  _attachCoreInput() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === " " || key === "enter") {
        if (this.state === "intro") {
          this.state = "playing";
          this._pushChatSystem("You wake up in the Everlight Inn.");
        }
      }
    });
  }

  _attachInteractInput() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === "j") {
        this.pendingInteract = true;
      }
    });
  }

  // ------------- WORLD INIT -------------

  _initTownLayout() {
    // We don’t have tiles / assets, so we fake a town with rectangles.
    // Coordinates are in canvas space; we’ll compute relative later.

    // Buildings: inn, shop, gatehouse, etc.
    this.buildings = [
      {
        id: "inn",
        name: "Everlight Inn",
        x: 140,
        y: 130,
        w: 200,
        h: 120,
        color: "#4b3424",
        roofColor: "#8b5a2b",
      },
      {
        id: "shop",
        name: "General Goods",
        x: 430,
        y: 140,
        w: 170,
        h: 110,
        color: "#3e2f27",
        roofColor: "#7a5634",
      },
      {
        id: "guildhall",
        name: "Warden Guildhall",
        x: 210,
        y: 310,
        w: 220,
        h: 120,
        color: "#3c3430",
        roofColor: "#6f4a3a",
      },
      {
        id: "gatehouse",
        name: "North Gate",
        x: 420,
        y: 310,
        w: 190,
        h: 100,
        color: "#3b3f4a",
        roofColor: "#70788a",
      },
    ];

    // NPCs
    this.npcs = [
      {
        id: "innkeeper",
        name: "Seren the Innkeeper",
        x: 230,
        y: 190,
        dialog: [
          "A rough night? Rooms are cheap, stories are free.",
          "Most new Wardens head to the forest north of the gate.",
        ],
      },
      {
        id: "merchant",
        name: "Kerrin the Trader",
        x: 490,
        y: 200,
        dialog: [
          "If it rattles, clinks, or burns, I’ve probably got it.",
          "Bring me wolf pelts and I’ll see what I can do.",
        ],
      },
      {
        id: "guildmaster",
        name: "Guildmaster Elowen",
        x: 260,
        y: 350,
        dialog: [
          "Wardens watch the line between forest and stone.",
          "You’re green now, but you’ll harden fast.",
        ],
      },
      {
        id: "gate_guard",
        name: "Gate Guard Bren",
        x: 480,
        y: 350,
        dialog: [
          "Beyond this gate? Wolves, bandits, and worse.",
          "We’ll open it for you when you’re ready.",
        ],
      },
    ];
  }

  _resetPlayerToInn() {
    // Roughly the center of the inn
    this.player.x = 240;
    this.player.y = 220;
    this.player.vx = 0;
    this.player.vy = 0;
  }

  // ------------- CHAT HELPERS -------------

  _pushChatSystem(text) {
    this.chatLog.push({ system: true, text });
    if (this.chatLog.length > 10) {
      this.chatLog.shift();
    }
  }

  _pushChatNpc(npc, line) {
    this.chatLog.push({ system: false, from: npc.name, text: line });
    if (this.chatLog.length > 10) {
      this.chatLog.shift();
    }
  }

  // ------------- UPDATE LOOP -------------

  update(dt, input) {
    this.time += dt;

    if (this.state !== "playing") {
      return;
    }

    this.totalPlayTime += dt;

    // Level the character *very* gently over time for now
    this._grantExplorationXp(dt);

    this._updatePlayer(dt, input);
    this._handleInteractIfRequested();
  }

  _updatePlayer(dt, input) {
    const p = this.player;

    if (p.dashCooldown > 0) {
      p.dashCooldown = Math.max(0, p.dashCooldown - dt);
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
    }

    p.vx = moveX * speed;
    p.vy = moveY * speed;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (moveX !== 0 || moveY !== 0) {
      p.facingAngle = Math.atan2(moveY, moveX);
    }

    // Clamp to a soft "town area" derived from canvas
    const rect = this._getTownRect();
    const r = p.radius;
    if (p.x < rect.minX + r) p.x = rect.minX + r;
    if (p.x > rect.maxX - r) p.x = rect.maxX - r;
    if (p.y < rect.minY + r) p.y = rect.minY + r;
    if (p.y > rect.maxY - r) p.y = rect.maxY - r;
  }

  _handleInteractIfRequested() {
    if (!this.pendingInteract) return;
    this.pendingInteract = false;

    // Find nearest NPC within a reasonable radius
    const p = this.player;
    let bestNpc = null;
    let bestDist = 80;

    for (const npc of this.npcs) {
      const dx = npc.x - p.x;
      const dy = npc.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < bestDist) {
        bestDist = d;
        bestNpc = npc;
      }
    }

    if (!bestNpc) {
      this._pushChatSystem("No one nearby to talk to.");
      return;
    }

    // Pick a random line from the NPC
    if (Array.isArray(bestNpc.dialog) && bestNpc.dialog.length) {
      const line =
        bestNpc.dialog[Math.floor(Math.random() * bestNpc.dialog.length)];
      this._pushChatNpc(bestNpc, line);
      // tiny XP bump so it feels like progression
      this._grantXp(2);
    }
  }

  _grantExplorationXp(dt) {
    // 1 XP every ~3 seconds of active play
    const rate = 1 / 3;
    this._grantXp(rate * dt);
  }

  _grantXp(amount) {
    const p = this.player;
    p.xp += amount;
    while (p.xp >= p.xpToNext) {
      p.xp -= p.xpToNext;
      p.level += 1;

      // Light stat growth
      p.maxHealth += 10;
      p.maxMana += 4;
      p.strength += 1;
      p.agility += 1;
      p.intelligence += 1;
      p.attackPower += 2;
      p.defense += 1;
      p.critChance += 0.003;
      p.health = p.maxHealth;
      p.mana = p.maxMana;

      const base = 120;
      const exp = 1.25;
      p.xpToNext = Math.floor(base * Math.pow(p.level, exp)) + 40;

      this._pushChatSystem(`You have gained a level! (${p.level})`);
    }
  }

  // ------------- RENDERING -------------

  render(ctx, width, height) {
    // Background sky
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#050711");
    sky.addColorStop(0.3, "#171c33");
    sky.addColorStop(1, "#060811");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const rect = this._getTownRect();
    this._renderGround(ctx, rect);
    this._renderBuildings(ctx, rect);
    this._renderNpcAreaHighlights(ctx, rect);

    // NPCs
    for (const npc of this.npcs) {
      this._renderNpc(ctx, npc);
    }

    // Player
    this._renderPlayer(ctx, this.player);

    // HUD
    this._renderTopBars(ctx, width, height);
    this._renderRpgPanel(ctx, width, height);
    this._renderZonePanel(ctx, width, height);
    this._renderHotbar(ctx, width, height);
    this._renderChatLog(ctx, width, height);

    if (this.state === "intro") {
      this._renderIntroOverlay(ctx, width, height);
    }
  }

  _getTownRect() {
    const c = this.canvas;
    const pad = 80;
    const width = c.clientWidth || c.width || 960;
    const height = c.clientHeight || c.height || 540;
    const minX = pad;
    const maxX = width - pad;
    const minY = pad + 20;
    const maxY = height - pad - 40;
    return {
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  _renderGround(ctx, rect) {
    const tile = 36;
    for (let y = rect.minY; y < rect.maxY; y += tile) {
      for (let x = rect.minX; x < rect.maxX; x += tile) {
        const n =
          Math.sin(x * 0.05) * 0.4 + Math.cos(y * 0.04) * 0.4 + Math.random() * 0.1;
        const g = 120 + Math.round(n * 40);
        const b = 80 + Math.round(n * 30);
        ctx.fillStyle = `rgb(30, ${g}, ${b})`;
        ctx.fillRect(x, y, tile + 1, tile + 1);
      }
    }

    // Soft border
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.strokeRect(rect.minX, rect.minY, rect.width, rect.height);
  }

  _renderBuildings(ctx, rect) {
    for (const b of this.buildings) {
      // Building base
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);

      // Roof
      ctx.fillStyle = b.roofColor;
      ctx.fillRect(b.x, b.y, b.w, 20);

      // Door hint
      ctx.fillStyle = "#d2c9b0";
      ctx.fillRect(b.x + b.w / 2 - 8, b.y + b.h - 20, 16, 20);

      // Name
      ctx.font =
        "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.textAlign = "center";
      ctx.fillText(b.name, b.x + b.w / 2, b.y - 4);
    }
  }

  _renderNpcAreaHighlights(ctx, rect) {
    // Simple hint rings around building front areas (like EQ shops)
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = "rgba(250, 230, 180, 0.3)";
    for (const b of this.buildings) {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h + 10;
      ctx.beginPath();
      ctx.arc(cx, cy, 36, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _renderNpc(ctx, npc) {
    // Light glow orb + name
    ctx.save();
    const t = this.time;
    const wobble = 1 + Math.sin(t * 3 + npc.x * 0.04) * 0.1;
    const r = 12 * wobble;

    const grad = ctx.createRadialGradient(npc.x, npc.y, 0, npc.x, npc.y, r * 1.8);
    grad.addColorStop(0, "rgba(240, 240, 255, 0.95)");
    grad.addColorStop(1, "rgba(160, 200, 255, 0.05)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(npc.x, npc.y, r * 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#f4f8ff";
    ctx.arc(npc.x, npc.y, r * 0.8, 0, Math.PI * 2);
    ctx.fill();

    // Name
    ctx.font =
      "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(230, 230, 255, 0.96)";
    ctx.fillText(npc.name, npc.x, npc.y - r - 8);
    ctx.restore();
  }

  _renderPlayer(ctx, p) {
    ctx.save();
    const t = this.time;
    const breath = 0.07 * Math.sin(t * 3) + 1;
    const r = p.radius * breath;

    // Aura
    ctx.beginPath();
    const aura = ctx.createRadialGradient(
      p.x,
      p.y,
      r * 0.5,
      p.x,
      p.y,
      r * 2.2
    );
    aura.addColorStop(0, "rgba(105, 195, 255, 0.7)");
    aura.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = aura;
    ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Core
    ctx.beginPath();
    ctx.fillStyle = "#5f9cff";
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Inner light
    ctx.beginPath();
    const inner = 0.7 + 0.3 * Math.sin(t * 8);
    ctx.fillStyle = `rgba(255,255,255,${0.2 + 0.25 * inner})`;
    ctx.arc(p.x, p.y, r * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Facing “blade”
    const angle = p.facingAngle || 0;
    const bladeLen = r + 10;
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
    ctx.fillStyle = "rgba(255, 240, 200, 0.95)";
    ctx.fill();
    ctx.strokeStyle = "rgba(60, 40, 20, 0.9)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  _renderTopBars(ctx, width, height) {
    const p = this.player;

    // Time + “session” indicator
    ctx.save();
    ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.textAlign = "left";
    ctx.fillText(`Session: ${this.totalPlayTime.toFixed(1)}s`, 12, 20);

    ctx.textAlign = "right";
    ctx.fillText(`Lv ${p.level}`, width - 12, 20);

    // HP / MP bars in the center top
    const barWidth = Math.min(260, width * 0.5);
    const barHeight = 10;
    const barX = (width - barWidth) / 2;
    const barY = 32;

    // HP
    const hpRatio = Math.max(0, Math.min(1, p.health / p.maxHealth));
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    const hpGrad = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
    hpGrad.addColorStop(0, "#3dd68c");
    hpGrad.addColorStop(0.5, "#f5d76e");
    hpGrad.addColorStop(1, "#ff6b81");
    ctx.fillStyle = hpGrad;
    ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, barY + 0.5, barWidth - 1, barHeight - 1);

    // MP
    const mpRatio = Math.max(0, Math.min(1, p.mana / p.maxMana));
    const mpY = barY + barHeight + 4;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(barX, mpY, barWidth, barHeight);
    const mpGrad = ctx.createLinearGradient(barX, mpY, barX + barWidth, mpY);
    mpGrad.addColorStop(0, "#76c2ff");
    mpGrad.addColorStop(1, "#3f76e0");
    ctx.fillStyle = mpGrad;
    ctx.fillRect(barX, mpY, barWidth * mpRatio, barHeight);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.strokeRect(barX + 0.5, mpY + 0.5, barWidth - 1, barHeight - 1);

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
    ctx.fillStyle = "rgba(190, 210, 255, 0.96)";
    ctx.fillText(`${levelLine} · XP ${xpLine}`, 8, y);

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
    const panelWidth = Math.min(220, width * 0.4);
    const panelHeight = 34;
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

  _renderHotbar(ctx, width, height) {
    const barWidth = Math.min(420, width - 80);
    const barHeight = 40;
    const x = (width - barWidth) / 2;
    const y = height - barHeight - 14;

    ctx.save();
    ctx.fillStyle = "rgba(5, 6, 12, 0.85)";
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const radius = 8;
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + barWidth - radius, y);
    ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
    ctx.lineTo(x + barWidth, y + barHeight - radius);
    ctx.quadraticCurveTo(
      x + barWidth,
      y + barHeight,
      x + barWidth - radius,
      y + barHeight
    );
    ctx.lineTo(x + radius, y + barHeight);
    ctx.quadraticCurveTo(x, y + barHeight, x, y + barHeight - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const slotCount = this.hotbarSlots.length;
    const slotWidth = (barWidth - 16) / slotCount;
    const slotHeight = barHeight - 10;
    const slotY = y + 5;

    ctx.font = "10px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";

    for (let i = 0; i < slotCount; i++) {
      const slot = this.hotbarSlots[i];
      const slotX = x + 8 + i * slotWidth;
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1;
      ctx.strokeRect(slotX, slotY, slotWidth - 4, slotHeight);

      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillText(
        slot.key,
        slotX + (slotWidth - 4) / 2,
        slotY + 10
      );

      if (slot.name) {
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText(
          slot.name,
          slotX + (slotWidth - 4) / 2,
          slotY + 22
        );
      }
    }

    ctx.restore();
  }

  _renderChatLog(ctx, width, height) {
    const logWidth = Math.min(360, width * 0.48);
    const logHeight = Math.min(130, height * 0.3);
    const x = 10;
    const y = height - logHeight - 14;

    ctx.save();
    ctx.fillStyle = "rgba(5, 6, 12, 0.8)";
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;

    ctx.beginPath();
    const radius = 8;
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + logWidth - radius, y);
    ctx.quadraticCurveTo(x + logWidth, y, x + logWidth, y + radius);
    ctx.lineTo(x + logWidth, y + logHeight - radius);
    ctx.quadraticCurveTo(
      x + logWidth,
      y + logHeight,
      x + logWidth - radius,
      y + logHeight
    );
    ctx.lineTo(x + radius, y + logHeight);
    ctx.quadraticCurveTo(x, y + logHeight, x, y + logHeight - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";

    const lineHeight = 14;
    let currentY = y + 16;
    for (const entry of this.chatLog) {
      if (currentY > y + logHeight - 4) break;
      if (entry.system) {
        ctx.fillStyle = "rgba(180, 215, 255, 0.95)";
        ctx.fillText(entry.text, x + 8, currentY);
      } else {
        ctx.fillStyle = "rgba(230, 230, 255, 0.95)";
        ctx.fillText(`${entry.from}: ${entry.text}`, x + 8, currentY);
      }
      currentY += lineHeight;
    }

    ctx.restore();
  }

  _renderIntroOverlay(ctx, width, height) {
    const centerX = width / 2;
    const centerY = height / 2;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.font = "24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("RACTR · Everlight Crossroads", centerX, centerY - 10);

    ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(
      "You awaken in a border-town at the edge of the Everlight Forest.",
      centerX,
      centerY + 16
    );
    ctx.fillText(
      "Move with WASD / arrows. Space to dash. J to talk to NPCs.",
      centerX,
      centerY + 36
    );
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText(
      "Press Space or Enter to stand up.",
      centerX,
      centerY + 58
    );

    ctx.restore();
  }
}

// Expose to window
if (typeof window !== "undefined") {
  window.RactrGame = RactrGame;
}
