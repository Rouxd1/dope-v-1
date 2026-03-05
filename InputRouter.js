// ui/InputRouter.js
// Unifies desktop keyboard and mobile swipe into the same callbacks.
// Determinism note: input only calls deterministic sim methods; no time-based sim logic here.

export function createInputRouter({
  gridEl,
  onMove,      // (dx, dy) => void
  onInteract,  // () => void
  onSwap,      // () => void
  onEndTurn,   // () => void
  isInputEnabled, // () => boolean
}) {
  // ---------------------------
  // Keyboard (PC)
  // ---------------------------
  function handleKeyDown(e) {
    if (!isInputEnabled()) return;

    const key = e.key;

    // Movement: WASD + arrows
    if (key === "ArrowUp" || key === "w" || key === "W") { e.preventDefault(); onMove(0, -1); return; }
    if (key === "ArrowDown" || key === "s" || key === "S") { e.preventDefault(); onMove(0, 1); return; }
    if (key === "ArrowLeft" || key === "a" || key === "A") { e.preventDefault(); onMove(-1, 0); return; }
    if (key === "ArrowRight" || key === "d" || key === "D") { e.preventDefault(); onMove(1, 0); return; }

    // Interact: E or Enter
    if (key === "e" || key === "E" || key === "Enter") { e.preventDefault(); onInteract(); return; }

    // Swap: Tab or Q
    if (key === "Tab" || key === "q" || key === "Q") { e.preventDefault(); onSwap(); return; }

    // End turn: Space
    if (key === " ") { e.preventDefault(); onEndTurn(); return; }
  }

  // ---------------------------
  // Swipe-to-step (Mobile)
  // ---------------------------
  let touchStartX = 0;
  let touchStartY = 0;
  let touchActive = false;

  // Minimum swipe distance in pixels to count as a direction.
  const MIN_SWIPE_DIST = 28;

  function onTouchStart(e) {
    if (!isInputEnabled()) return;
    if (!e.touches || e.touches.length !== 1) return;

    touchActive = true;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }

  function onTouchMove(e) {
    // Prevent page scroll during a swipe that started on the grid.
    if (touchActive) {
      e.preventDefault();
    }
  }

  function onTouchEnd(e) {
    if (!isInputEnabled()) return;
    if (!touchActive) return;

    touchActive = false;

    const t = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
    if (!t) return;

    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;

    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (adx < MIN_SWIPE_DIST && ady < MIN_SWIPE_DIST) {
      // Too small: treat as a tap (do nothing).
      return;
    }

    // Determine primary direction
    if (adx > ady) {
      onMove(dx > 0 ? 1 : -1, 0);
    } else {
      onMove(0, dy > 0 ? 1 : -1);
    }
  }

  // Attach listeners
  window.addEventListener("keydown", handleKeyDown, { passive: false });

  // touchmove passive must be false so preventDefault works
  gridEl.addEventListener("touchstart", onTouchStart, { passive: true });
  gridEl.addEventListener("touchmove", onTouchMove, { passive: false });
  gridEl.addEventListener("touchend", onTouchEnd, { passive: true });

  return {
    destroy() {
      window.removeEventListener("keydown", handleKeyDown);
      gridEl.removeEventListener("touchstart", onTouchStart);
      gridEl.removeEventListener("touchmove", onTouchMove);
      gridEl.removeEventListener("touchend", onTouchEnd);
    },
  };
}
