/*
 * Deterministic game state for Dope Farm PvP.
 *
 * Update: Harvest no longer converts directly into cash.
 * - Harvest produces GOODS into player inventory (player.goods).
 * - Store sells GOODS into cash via game.sellGoods(...).
 *
 * Marijuana:
 * - Cheap strains decay in market value over time (floor at 10%).
 * - Pests can stall growth for a day.
 * - Rot can destroy cheap weed (0 value) or reduce premium weed (50% value).
 *
 * Determinism:
 * - All hazards use a seeded RNG inside endDay().
 */

export class RNG {
  constructor(seed = 1) {
    this.state = seed >>> 0;
  }
  next() {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state;
  }
  random() {
    return (this.next() & 0xfffffff) / 0x10000000;
  }
}

export class Cell {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    // ground, lake, bank, store, farmhouse0, farmhouse1
    this.type = "ground";
    this.ownerTeam = null; // 0 | 1 | null
    this.crop = null;      // { type, stage, growth, skipGrowth, rotPenalty, rotDestroyed }
  }
}

export class Player {
  constructor(id, team, x, y, config) {
    this.id = id;
    this.team = team;
    this.x = x;
    this.y = y;

    this.energy = config.energyMax;
    this.cash = config.startingCash;
    this.bank = 0;

    // what seed type Interact plants when on owned farmland
    this.activeSeed = "wheat";

    // two item slots reserved for later
    this.items = [null, null];

    // GOODS: harvested items you can sell at the store
    // each entry: { type: 'wheat'|'mj_cheap'|'mj_premium', qualityMult: 1|0.5|0 }
    this.goods = [];
  }
}

export class GameState {
  constructor(seed = 1, config = {}) {
    const defaults = {
      width: 14,
      height: 12,
      energyMax: 10,
      startingCash: 10,
      landCost: 20,
      crops: {},
      market: {},
      hazards: {},
    };
    this.config = Object.assign({}, defaults, config);

    this.rng = new RNG(seed);
    this.day = 1;

    this.width = this.config.width;
    this.height = this.config.height;

    this.grid = [];
    for (let y = 0; y < this.height; y++) {
      const row = [];
      for (let x = 0; x < this.width; x++) row.push(new Cell(x, y));
      this.grid.push(row);
    }

    this.setupBoard();

    this.players = [];
    this.setupPlayers();
    this.currentPlayerIndex = 0;
  }

  setupBoard() {
    // left farmland: cols 0–4 team 0
    // neutral lane: cols 5–8 with 2×2 lake centered
    // right farmland: cols 9–13 team 1
    // top row = bank, bottom row = store
    const leftCols = 5;
    const middleCols = 4;
    const lakeColsStart = leftCols + Math.floor((middleCols - 2) / 2);
    const lakeRowsStart = Math.floor((this.height - 2) / 2);

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid[y][x];

        if (y === 0) {
          cell.type = "bank";
          cell.ownerTeam = null;
          continue;
        }
        if (y === this.height - 1) {
          cell.type = "store";
          cell.ownerTeam = null;
          continue;
        }
        if (y === 1 && (x === 1 || x === 2)) {
          cell.type = "farmhouse0";
          cell.ownerTeam = 0;
          continue;
        }
        if (
          y === this.height - 2 &&
          (x === this.width - 2 || x === this.width - 3)
        ) {
          cell.type = "farmhouse1";
          cell.ownerTeam = 1;
          continue;
        }

        if (x < leftCols) {
          cell.type = "ground";
          cell.ownerTeam = 0;
        } else if (x >= leftCols + middleCols) {
          cell.type = "ground";
          cell.ownerTeam = 1;
        } else {
          // neutral lane
          if (
            x >= lakeColsStart &&
            x < lakeColsStart + 2 &&
            y >= lakeRowsStart &&
            y < lakeRowsStart + 2
          ) {
            cell.type = "lake";
            cell.ownerTeam = null;
          } else {
            cell.type = "ground";
            cell.ownerTeam = null;
          }
        }
      }
    }
  }

  setupPlayers() {
    const cfg = this.config;
    // Team 0
    this.players.push(new Player(0, 0, 1, 3, cfg));
    this.players.push(new Player(1, 0, 3, 4, cfg));
    // Team 1
    this.players.push(new Player(2, 1, this.width - 2, this.height - 4, cfg));
    this.players.push(new Player(3, 1, this.width - 4, this.height - 5, cfg));
  }

  inBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  getCell(x, y) {
    if (!this.inBounds(x, y)) return null;
    return this.grid[y][x];
  }

  isPassable(x, y) {
    const cell = this.getCell(x, y);
    if (!cell) return false;
    if (cell.type === "lake") return false;
    for (const p of this.players) {
      if (p.x === x && p.y === y) return false;
    }
    return true;
  }

  movePlayer(player, dx, dy) {
    if (player.energy <= 0) return { success: false };
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (!this.isPassable(nx, ny)) return { success: false };
    player.x = nx;
    player.y = ny;
    player.energy -= 1;
    return { success: true };
  }

  interact(player) {
    const cell = this.getCell(player.x, player.y);
    if (!cell) return { type: "none" };

    if (cell.type === "bank") return { type: "bank" };
    if (cell.type === "store") return { type: "store" };
    if (cell.type === "farmhouse0" || cell.type === "farmhouse1") return { type: "farmhouse" };
    if (cell.type === "lake") return { type: "lake" };

    // ground
    if (cell.type === "ground") {
      // harvest if mature
      if (cell.crop && this.isCropMature(cell.crop)) {
        const ok = this.harvestCropToGoods(player, cell);
        return { type: ok ? "harvest" : "none" };
      }

      // plant if empty + owned
      if (!cell.crop && cell.ownerTeam === player.team) {
        const ok = this.plantCrop(player, cell);
        return { type: ok ? "plant" : "none" };
      }
    }

    return { type: "none" };
  }

  isCropMature(crop) {
    const cfg = this.config.crops[crop.type];
    if (!cfg) return false;
    return crop.stage >= (cfg.growthStages - 1);
  }

  plantCrop(player, cell) {
    const type = player.activeSeed || "wheat";
    const cfg = this.config.crops[type];
    if (!cfg) return false;

    if (player.cash < cfg.seedCost) return false;
    if (player.energy < cfg.plantEnergy) return false;

    player.cash -= cfg.seedCost;
    player.energy -= cfg.plantEnergy;

    cell.crop = {
      type,
      stage: 0,
      growth: 0,
      skipGrowth: false,
      rotPenalty: 0,     // 0 or 0.5
      rotDestroyed: false
    };
    return true;
  }

  /**
   * Harvest now produces GOODS, not cash.
   * Cash is earned when you SELL goods at the Store.
   */
  harvestCropToGoods(player, cell) {
    const crop = cell.crop;
    const cfg = this.config.crops[crop.type];
    if (!cfg) return false;

    if (player.energy < cfg.harvestEnergy) return false;
    player.energy -= cfg.harvestEnergy;

    let qualityMult = 1;

    if (crop.type.startsWith("mj")) {
      if (crop.rotDestroyed) qualityMult = 0;
      else if (crop.rotPenalty > 0) qualityMult = 0.5;
    }

    player.goods.push({ type: crop.type, qualityMult });
    cell.crop = null;
    return true;
  }

  /** Weed market multiplier based on day, with floor. Non-weed = 1. */
  getMarketMultiplier(cropType) {
    if (!cropType.startsWith("mj")) return 1;
    const m = this.config.market[cropType];
    if (!m) return 1;
    const mult = 1 - m.decayPerDay * (this.day - 1);
    return Math.max(m.floor, mult);
  }

  /**
   * Sell qty goods of cropType from player's goods inventory.
   * Returns payout (cash added to player.cash).
   */
  sellGoods(player, cropType, qty) {
    const cfg = this.config.crops[cropType];
    if (!cfg) return 0;

    const goods = player.goods || [];
    const idxs = [];
    for (let i = 0; i < goods.length; i++) {
      if (goods[i].type === cropType) idxs.push(i);
    }
    const sellCount = Math.min(qty, idxs.length);
    if (sellCount <= 0) return 0;

    const mult = this.getMarketMultiplier(cropType);
    let payout = 0;

    // remove from end so indexes stay valid
    for (let k = 0; k < sellCount; k++) {
      const idx = idxs[idxs.length - 1 - k];
      const g = goods[idx];
      const unit = Math.max(0, Math.round(cfg.baseValue * mult * g.qualityMult));
      payout += unit;
      goods.splice(idx, 1);
    }

    player.cash += payout;
    return payout;
  }

  endTurn() {
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    if (this.currentPlayerIndex === 0) this.endDay();
  }

  endDay() {
    // hazards + growth
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid[y][x];
        const crop = cell.crop;
        if (!crop) continue;

        const cfg = this.config.crops[crop.type];
        if (!cfg) continue;

        // Weed hazards
        if (crop.type.startsWith("mj")) {
          const hz = this.config.hazards[crop.type];
          if (hz && !crop.rotDestroyed) {
            // pest => stall growth one day
            if (this.rng.random() < hz.pestChance) {
              crop.skipGrowth = true;
            }

            // rot
            if (this.rng.random() < hz.rotChance) {
              if (hz.rotEffect === "destroy") {
                crop.rotDestroyed = true; // will sell for 0 when harvested
              } else if (hz.rotEffect === "reduce") {
                if (crop.rotPenalty === 0) crop.rotPenalty = 0.5;
              }
            }
          }
        }

        // growth (if not destroyed)
        if (!crop.rotDestroyed) {
          if (crop.skipGrowth) {
            crop.skipGrowth = false;
          } else {
            crop.growth += 1;
            if (crop.growth >= cfg.growthRate) {
              crop.growth = 0;
              crop.stage += 1;
            }
          }
        }
      }
    }

    // reset energy
    for (const p of this.players) {
      p.energy = this.config.energyMax;
    }

    this.day += 1;
  }
}
