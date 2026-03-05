// Entry point for Dope Farm PvP hotseat demo.
// This module wires the GameState simulation with a UI suitable for
// pass‑and‑play testing. Each player acts in sequence until their energy
// or time limit runs out. After all four have acted the day advances.

import { GameState } from '../sim/GameState.js';

// UI configuration. turnTime is loaded from balance defaults.
let uiConfig = {
  turnTime: 45,
};

let game;
let timerId = null;
let remainingTime;

// DOM references
const gridEl = document.getElementById('grid');
const hudContentEl = document.getElementById('hud-content');
const actionTrayEl = document.getElementById('action-tray');
const overlayEl = document.getElementById('overlay');
const overlayMsgEl = document.getElementById('overlay-message');
const overlayBtn = document.getElementById('overlay-continue');
const storeUiEl = document.getElementById('store-ui');
const storeContentEl = document.getElementById('store-content');
const closeStoreBtn = document.getElementById('close-store');
const bankUiEl = document.getElementById('bank-ui');
const bankContentEl = document.getElementById('bank-content');
const closeBankBtn = document.getElementById('close-bank');

// Load balance defaults and create initial game state. This function is async
// because it fetches the JSON config from the data folder.
async function init() {
  // Fetch config JSON from data folder
  let configData = {};
  try {
    const resp = await fetch('../data/balance_defaults.json');
    configData = await resp.json();
  } catch (err) {
    console.error('Failed to load balance_defaults.json:', err);
  }
  // Set UI turnTime from config
  uiConfig.turnTime = configData.turnTime || 45;
  // Seed for deterministic RNG
  const seed = Date.now() & 0xffffffff;
  // Create game state with config
  game = new GameState(seed, configData);
  remainingTime = uiConfig.turnTime;
  buildGrid();
  // Start with overlay for first player
  showOverlayForPlayer(game.currentPlayerIndex);
}

function buildGrid() {
  gridEl.innerHTML = '';
  gridEl.style.gridTemplateColumns = `repeat(${game.width}, 32px)`;
  gridEl.style.gridTemplateRows = `repeat(${game.height}, 32px)`;
  for (let y = 0; y < game.height; y++) {
    for (let x = 0; x < game.width; x++) {
      const cellDiv = document.createElement('div');
      cellDiv.className = 'cell';
      cellDiv.dataset.x = x;
      cellDiv.dataset.y = y;
      gridEl.appendChild(cellDiv);
    }
  }
}

// Render the board and players
function render() {
  const cells = gridEl.children;
  // Clear cell classes and content
  for (const cellDiv of cells) {
    cellDiv.className = 'cell';
    cellDiv.innerHTML = '';
  }
  // Add terrain classes
  for (let y = 0; y < game.height; y++) {
    for (let x = 0; x < game.width; x++) {
      const cell = game.getCell(x, y);
      const index = y * game.width + x;
      const cellDiv = cells[index];
      // Terrain backgrounds
      switch (cell.type) {
        case 'ground':
          if (cell.ownerTeam === 0) {
            cellDiv.classList.add('farmland0');
          } else if (cell.ownerTeam === 1) {
            cellDiv.classList.add('farmland1');
          } else {
            cellDiv.classList.add('neutral');
          }
          break;
        case 'lake':
          cellDiv.classList.add('lake');
          break;
        case 'bank':
          cellDiv.classList.add('bank');
          break;
        case 'store':
          cellDiv.classList.add('store');
          break;
        case 'farmhouse0':
          cellDiv.classList.add('farmhouse0');
          break;
        case 'farmhouse1':
          cellDiv.classList.add('farmhouse1');
          break;
        case 'thorns':
          cellDiv.classList.add('thorns');
          break;
      }
      // Crop rendering with weed support
      if (cell.crop) {
        const crop = cell.crop;
        const cropDiv = document.createElement('div');
        cropDiv.classList.add('crop');
        // Determine class and text based on crop type
        let letter = '';
        if (crop.type === 'wheat') {
          cropDiv.classList.add('wheat');
          letter = 'W';
        } else if (crop.type === 'mj_cheap') {
          cropDiv.classList.add('mjcheap');
          letter = 'C';
        } else if (crop.type === 'mj_premium') {
          cropDiv.classList.add('mjpremium');
          letter = 'P';
        } else {
          // fallback unknown crop
          letter = '?';
        }
        // If crop has been destroyed by rot, show X
        if (crop.rotDestroyed) {
          cropDiv.classList.add('destroyed');
          cropDiv.textContent = '✖';
        } else {
          // Compose text: letter + stage number (1‑based)
          cropDiv.textContent = `${letter}${crop.stage + 1}`;
          // Indicate rot penalty if present
          if (crop.rotPenalty > 0) {
            cropDiv.classList.add('rot');
          }
        }
        cellDiv.appendChild(cropDiv);
      }
    }
  }
  // Render players
  for (const p of game.players) {
    const idx = p.y * game.width + p.x;
    const cellDiv = cells[idx];
    const playerDiv = document.createElement('div');
    playerDiv.className = `player team${p.team}`;
    playerDiv.textContent = `P${p.id}`;
    cellDiv.appendChild(playerDiv);
  }
  // Update HUD
  updateHUD();
}

function updateHUD() {
  const current = game.players[game.currentPlayerIndex];
  hudContentEl.innerHTML = '';
  const hudList = [];
  hudList.push(`Day: ${game.day}`);
  hudList.push(`Player ${current.id} (Team ${current.team})`);
  hudList.push(`Energy: ${current.energy}`);
  hudList.push(`Cash: $${current.cash.toFixed(0)}`);
  hudList.push(`Bank: $${current.bank.toFixed(0)}`);
  hudList.push(`Active Seed: ${current.activeSeed}`);
  hudList.push(`Time: ${remainingTime.toFixed(0)}s`);
  hudContentEl.textContent = hudList.join(' | ');
}

function showOverlayForPlayer(playerIndex) {
  const p = game.players[playerIndex];
  overlayMsgEl.textContent = `Player ${p.id} (Team ${p.team}) - Pass device and start your turn.`;
  overlayEl.classList.remove('hidden');
  actionTrayEl.classList.add('hidden');
  // Pause any running timer
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

// Called when overlay button clicked to begin player's turn
function startTurn() {
  overlayEl.classList.add('hidden');
  remainingTime = uiConfig.turnTime;
  startTimer();
  renderActionTray();
  render();
}

function startTimer() {
  if (timerId) clearInterval(timerId);
  timerId = setInterval(() => {
    remainingTime -= 1;
    if (remainingTime <= 0) {
      remainingTime = 0;
      updateHUD();
      endCurrentPlayerTurn();
    } else {
      updateHUD();
    }
  }, 1000);
}

function renderActionTray() {
  actionTrayEl.innerHTML = '';
  const p = game.players[game.currentPlayerIndex];
  // Helper to create button
  function createButton(label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'action-button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }
  // Movement buttons (up, left, right, down)
  const moveUp = createButton('↑', () => performMove(0, -1));
  const moveDown = createButton('↓', () => performMove(0, 1));
  const moveLeft = createButton('←', () => performMove(-1, 0));
  const moveRight = createButton('→', () => performMove(1, 0));
  const interactBtn = createButton('Interact', () => performInteract());
  const endBtn = createButton('End Turn', () => endCurrentPlayerTurn());
  actionTrayEl.append(moveUp, moveLeft, moveRight, moveDown, interactBtn, endBtn);
  actionTrayEl.classList.remove('hidden');
  updateActionButtons();
}

function updateActionButtons() {
  // Disable movement or interact if no energy
  const p = game.players[game.currentPlayerIndex];
  const buttons = actionTrayEl.querySelectorAll('button');
  buttons.forEach(btn => {
    btn.disabled = false;
  });
  if (p.energy <= 0) {
    // Only allow End Turn if no energy
    buttons.forEach(btn => {
      if (btn.textContent !== 'End Turn') btn.disabled = true;
    });
  }
}

function performMove(dx, dy) {
  const p = game.players[game.currentPlayerIndex];
  const result = game.movePlayer(p, dx, dy);
  if (result.success) {
    render();
  }
  updateActionButtons();
  if (p.energy <= 0) {
    endCurrentPlayerTurn();
  }
}

function performInteract() {
  const p = game.players[game.currentPlayerIndex];
  const result = game.interact(p);
  render();
  updateActionButtons();
  // Branch on interaction type to open UIs
  if (result.type === 'bank') {
    openBank();
  } else if (result.type === 'store') {
    openStore();
  }
  if (p.energy <= 0) {
    endCurrentPlayerTurn();
  }
}

function endCurrentPlayerTurn() {
  // Close any UI
  closeStore();
  closeBank();
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  actionTrayEl.classList.add('hidden');
  game.endTurn();
  render();
  showOverlayForPlayer(game.currentPlayerIndex);
}

// Store UI logic: simple seed purchase
let storeInventory = [];

function buildStoreInventory() {
  // Build store items from game config. Items include seeds for each crop.
  storeInventory = [];
  const crops = game.config.crops;
  for (const type in crops) {
    const cfg = crops[type];
    const displayName = (function () {
      if (type === 'wheat') return 'Wheat Seed';
      if (type === 'mj_cheap') return 'Cheap MJ Seed';
      if (type === 'mj_premium') return 'Premium MJ Seed';
      return type + ' Seed';
    })();
    storeInventory.push({
      name: displayName,
      price: cfg.seedCost,
      action(player) {
        if (player.cash >= cfg.seedCost) {
          player.cash -= cfg.seedCost;
          // Set the active seed so planting uses this seed type
          player.activeSeed = type;
        }
      }
    });
  }
  // Additional example item: increase energy max (not essential)
  storeInventory.push({
    name: 'Upgrade Energy',
    price: 10,
    action(player) {
      if (player.cash >= 10) {
        player.cash -= 10;
        // Increase player's max energy for the rest of the game
        player.energy += 5;
      }
    }
  });
}

function openStore() {
  const p = game.players[game.currentPlayerIndex];
  // Build store inventory on open to reflect latest config
  buildStoreInventory();
  storeContentEl.innerHTML = '';
  storeInventory.forEach(item => {
    const div = document.createElement('div');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = item.name + ' ';
    const btn = document.createElement('button');
    btn.textContent = `Buy ($${item.price})`;
    btn.disabled = p.cash < item.price;
    btn.addEventListener('click', () => {
      if (p.cash >= item.price) {
        item.action(p);
        render();
        openStore();
      }
    });
    div.appendChild(nameSpan);
    div.appendChild(btn);
    storeContentEl.appendChild(div);
  });
  storeUiEl.classList.remove('hidden');
  // Pause timer while in store
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

function closeStore() {
  if (!storeUiEl.classList.contains('hidden')) {
    storeUiEl.classList.add('hidden');
    // Resume timer
    startTimer();
  }
}
closeStoreBtn.addEventListener('click', closeStore);

function openBank() {
  const p = game.players[game.currentPlayerIndex];
  bankContentEl.innerHTML = '';
  // Deposit input
  const depositContainer = document.createElement('div');
  depositContainer.textContent = 'Deposit:';
  const depositInput = document.createElement('input');
  depositInput.type = 'number';
  depositInput.min = 0;
  depositInput.max = p.cash;
  depositInput.value = 0;
  const depositBtn = document.createElement('button');
  depositBtn.textContent = 'Deposit';
  depositBtn.addEventListener('click', () => {
    const amount = parseInt(depositInput.value, 10);
    if (!isNaN(amount) && amount > 0 && amount <= p.cash) {
      p.cash -= amount;
      p.bank += amount;
      render();
      openBank();
    }
  });
  depositContainer.append(depositInput, depositBtn);
  bankContentEl.appendChild(depositContainer);
  // Show balances
  const balances = document.createElement('p');
  balances.textContent = `Cash: $${p.cash.toFixed(0)} | Bank: $${p.bank.toFixed(0)}`;
  bankContentEl.appendChild(balances);
  bankUiEl.classList.remove('hidden');
  // Pause timer
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

function closeBank() {
  if (!bankUiEl.classList.contains('hidden')) {
    bankUiEl.classList.add('hidden');
    startTimer();
  }
}
closeBankBtn.addEventListener('click', closeBank);

// Event listeners
overlayBtn.addEventListener('click', startTurn);

// Initialize the game once DOM is ready
window.addEventListener('DOMContentLoaded', init);