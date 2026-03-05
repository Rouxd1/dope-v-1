/*
 * Deterministic game state for Dope Farm PvP.
 *
 * This engine models a 2v2 farming competition with four farmers on a
 * 14×12 board. The board contains farmland for each team on the left
 * and right, a neutral lane with a 2×2 lake in the middle, plus a bank
 * row at the top and a store row at the bottom. Each farmer has
 * limited energy per turn and can plant, harvest and interact with
 * buildings. Marijuana crops are modeled as high‑risk, high‑reward
 * crops whose value decays over time and which suffer from pests and
 * rot. The simulation is fully deterministic given a seed and a
 * sequence of player intents.
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
    // Returns [0,1)
    return (this.next() & 0xfffffff) / 0x10000000;
  }
}

export class Cell {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    // Types: ground, lake, thorns, bank, store, farmhouse0, farmhouse1
    this.type = 'ground';
    // Owner team: 0, 1 or null
    this.ownerTeam = null;
    // Crop object or null. Crop fields: type, stage, growth, skipGrowth,
    // rotPenalty, rotDestroyed
    this.crop = null;
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
    // The type of seed the player will plant. Defaults to wheat.
    this.activeSeed = 'wheat';
    // Inventory: not used yet, reserved for future tools/equipment.
    this.items = [null, null];
  }
}

export class GameState {
  constructor(seed = 1, config = {}) {
    // Merge provided config with defaults. Must include crops, market and hazards.
    const defaults = {
      width: 14,
      height: 12,
      energyMax: 10,
      startingCash: 10,
      landCost: 20,
      crops: {},
      market: {},
      hazards: {}
    };
    this.config = Object.assign({}, defaults, config);
    this.rng = new RNG(seed);
    this.day = 1;
    this.turnLog = [];
    this.players = [];
    this.currentPlayerIndex = 0;
    // Build grid
    this.width = this.config.width;
    this.height = this.config.height;
    this.grid = [];
    for (let y = 0; y < this.height; y++) {
      const row = [];
      for (let x = 0; x < this.width; x++) {
        row.push(new Cell(x, y));
      }
      this.grid.push(row);
    }
    this.setupBoard();
    this.setupPlayers();
  }

  setupBoard() {
    // Board zones: left farmland (columns 0–4) for team 0, neutral lane (5–8)
    // with a 2×2 lake, right farmland (9–13) for team 1, plus special rows
    // for bank, store and farmhouses.
    const leftCols = 5;
    const middleCols = 4;
    const rightCols = 5;
    const lakeColsStart = leftCols + Math.floor((middleCols - 2) / 2);
    const lakeRowsStart = Math.floor((this.height - 2) / 2);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid[y][x];
        // Top row: bank
        if (y === 0) {
          cell.type = 'bank';
          cell.ownerTeam = null;
          continue;
        }
        // Bottom row: store
        if (y === this.height - 1) {
          cell.type = 'store';
          cell.ownerTeam = null;
          continue;
        }
        // Farmhouse positions for each team (second row from top/bottom)
        if (y === 1 && (x === 1 || x === 2)) {
          cell.type = 'farmhouse0';
          cell.ownerTeam = 0;
          continue;
        }
        if (y === this.height - 2 && (x === this.width - 2 || x === this.width - 3)) {
          cell.type = 'farmhouse1';
          cell.ownerTeam = 1;
          continue;
        }
        // Left farmland
        if (x < leftCols) {
          cell.type = 'ground';
          cell.ownerTeam = 0;
        }
        // Right farmland
        else if (x >= leftCols + middleCols) {
          cell.type = 'ground';
          cell.ownerTeam = 1;
        }
        // Neutral lane
        else {
          // Central 2×2 lake
          if (x >= lakeColsStart && x < lakeColsStart + 2 && y >= lakeRowsStart && y < lakeRowsStart + 2) {
            cell.type = 'lake';
            cell.ownerTeam = null;
          } else {
            cell.type = 'ground';
            cell.ownerTeam = null;
          }
        }
      }
    }
  }

  setupPlayers() {
    const cfg = this.config;
    // Team 0 players start on left farmland near farmhouse
    this.players.push(new Player(0, 0, 1, 3, cfg));
    this.players.push(new Player(1, 0, 3, 4, cfg));
    // Team 1 players start on right farmland near farmhouse
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
    // Lake cannot be walked on
    if (cell.type === 'lake') return false;
    // Prevent walking onto another player
    for (const p of this.players) {
      if (p.x === x && p.y === y) return false;
    }
    return true;
  }

  movePlayer(player, dx, dy) {
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (!this.isPassable(nx, ny)) return { success: false };
    // Movement costs 1 energy
    if (player.energy <= 0) return { success: false };
    player.x = nx;
    player.y = ny;
    player.energy -= 1;
    return { success: true };
  }

  // Primary interaction: plant, harvest, open bank/store
  interact(player) {
    const cell = this.getCell(player.x, player.y);
    if (!cell) return { type: 'none' };
    // Buildings
    if (cell.type === 'bank') {
      return { type: 'bank' };
    }
    if (cell.type === 'store') {
      return { type: 'store' };
    }
    if (cell.type === 'ground') {
      // If crop exists and is mature: harvest
      if (cell.crop && this.isCropMature(cell.crop)) {
        this.harvestCrop(player, cell);
        return { type: 'harvest' };
      }
      // Otherwise attempt to plant
      if (!cell.crop && cell.ownerTeam === player.team) {
        this.plantCrop(player, cell);
        return { type: 'plant' };
      }
      return { type: 'none' };
    }
    return { type: 'none' };
  }

  isCropMature(crop) {
    const cfg = this.config.crops[crop.type];
    return crop.stage >= cfg.growthStages;
  }

  plantCrop(player, cell) {
    const seedType = player.activeSeed;
    const cropCfg = this.config.crops[seedType];
    if (!cropCfg) return false;
    // Check resources
    if (player.cash < cropCfg.seedCost) return false;
    if (player.energy < cropCfg.plantEnergy) return false;
    // Spend resources
    player.cash -= cropCfg.seedCost;
    player.energy -= cropCfg.plantEnergy;
    // Plant crop
    cell.crop = {
      type: seedType,
      stage: 0,
      growth: 0,
      skipGrowth: false,
      rotPenalty: 0,
      rotDestroyed: false
    };
    return true;
  }

  harvestCrop(player, cell) {
    const crop = cell.crop;
    const cropCfg = this.config.crops[crop.type];
    // Check energy for harvesting
    if (player.energy < cropCfg.harvestEnergy) return false;
    player.energy -= cropCfg.harvestEnergy;
    // Compute payout
    let value = cropCfg.baseValue;
    // Apply market decay for weed (mj types)
    if (crop.type.startsWith('mj')) {
      const marketCfg = this.config.market[crop.type];
      if (marketCfg) {
        const decay = marketCfg.decayPerDay;
        const floor = marketCfg.floor;
        const multiplier = Math.max(floor, 1 - decay * (this.day - 1));
        value *= multiplier;
      }
      // Apply rot penalty or destruction
      if (crop.rotDestroyed) {
        value = 0;
      } else if (crop.rotPenalty > 0) {
        value *= (1 - crop.rotPenalty);
      }
    }
    // Round to nearest integer
    value = Math.round(value);
    player.cash += value;
    // Clear crop
    cell.crop = null;
    return true;
  }

  endTurn() {
    // Advance to next player
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    // If we've looped back to player 0, end the day
    if (this.currentPlayerIndex === 0) {
      this.endDay();
    }
  }

  endDay() {
    // Process hazards and growth for each crop
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid[y][x];
        const crop = cell.crop;
        if (!crop) continue;
        const cropCfg = this.config.crops[crop.type];
        // Only apply hazards to marijuana crops
        if (crop.type.startsWith('mj')) {
          const hazardCfg = this.config.hazards[crop.type];
          if (hazardCfg) {
            // Pest: stalls growth for one day
            const pestRoll = this.rng.random();
            if (!crop.rotDestroyed && pestRoll < hazardCfg.pestChance) {
              crop.skipGrowth = true;
            }
            // Rot: destroy or reduce yield
            const rotRoll = this.rng.random();
            if (!crop.rotDestroyed && rotRoll < hazardCfg.rotChance) {
              if (hazardCfg.rotEffect === 'destroy') {
                crop.rotDestroyed = true;
              } else if (hazardCfg.rotEffect === 'reduce') {
                // Only apply penalty once
                if (crop.rotPenalty === 0) {
                  crop.rotPenalty = 0.5;
                }
              }
            }
          }
        }
        // Growth update (skip if destroyed or no skipGrowth flag)
        if (!crop.rotDestroyed) {
          if (crop.skipGrowth) {
            // Consume skip flag but don't grow this day
            crop.skipGrowth = false;
          } else {
            crop.growth += 1;
            if (crop.growth >= cropCfg.growthRate) {
              crop.growth = 0;
              crop.stage += 1;
            }
          }
        }
      }
    }
    // Reset players' energy
    for (const p of this.players) {
      p.energy = this.config.energyMax;
    }
    this.day += 1;
  }
}