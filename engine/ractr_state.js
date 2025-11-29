// RactrState: foundational game, player, and world state scaffolding.
// For now, RactrGame still holds most logic, but new MMORPG-grade systems
// will be built around this state container and gradually migrated.

class RactrPlayerState {
  constructor(config, metaConfig) {
    const playerCfg = config && config.player ? config.player : {};
    const metaCfg = metaConfig || {};

    this.id = "local-player";
    this.name = "Adventurer";
    this.classId = "dashblade";

    this.level = 1;
    this.xp = 0;
    this.xpToNext = 100;

    this.strength = playerCfg.baseStrength || 10;
    this.agility = playerCfg.baseAgility || 10;
    this.intelligence = playerCfg.baseIntelligence || 10;

    this.maxHealth = playerCfg.maxHealth || 100;
    this.health = this.maxHealth;

    this.maxMana = playerCfg.baseMaxMana || 50;
    this.mana = this.maxMana;

    this.attackPower = playerCfg.baseAttackPower || 10;
    this.defense = playerCfg.baseDefense || 2;
    this.critChance = playerCfg.baseCritChance || 0.05;

    this.gold = 0;
    this.inventory = [];

    this.zoneId = (metaCfg && metaCfg.startingZoneId) || "training_grounds";

    // Runtime-only movement/combat fields
    this.x = 200;
    this.y = 200;
    this.vx = 0;
    this.vy = 0;
    this.radius = 16;
    this.baseSpeed = playerCfg.baseSpeed || 180;
    this.dashSpeed = playerCfg.dashSpeed || 360;
    this.dashCooldown = 0;
    this.invulnTime = 0;

    this._initializedFromConfig = false;
  }

  snapshot() {
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
}

class RactrWorldState {
  constructor(config) {
    const metaCfg = (config && config.meta) || {};
    this.zones = metaCfg.zones || {
      training_grounds: {
        id: "training_grounds",
        name: "Training Grounds",
        levelRange: [1, 3]
      }
    };
  }
}

class RactrGameState {
  constructor(config) {
    this.config = config || {};

    // High-level loop state
    this.time = 0;
    this.timeAlive = 0;
    this.bestTime = 0;
    this.state = "intro"; // intro | playing | gameover

    // Player + world containers
    this.world = new RactrWorldState(this.config);
    this.player = new RactrPlayerState(this.config, this.config.meta);

    // Active hazards/enemies in the current zone (kept compatible with
    // the existing dash survival gameplay for now).
    this.hazards = [];
  }
}

if (typeof window !== "undefined") {
  window.RactrPlayerState = RactrPlayerState;
  window.RactrWorldState = RactrWorldState;
  window.RactrGameState = RactrGameState;
}
