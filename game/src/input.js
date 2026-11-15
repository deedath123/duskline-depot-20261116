// Keyboard and mouse state, plus pointer lock. The game reads only this module's state;
// the test and screenshot modes drive the same state object, so a scripted game exercises
// exactly the code a player's hands do.
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    ads: false,
    locked: false,
    lookX: 0,
    lookY: 0,
    wheel: 0,
  };

  function requestLock() {
    if (!state.locked) canvas.requestPointerLock();
  }

  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      state.firing = false;
      state.ads = false;
    }
    onLockChange(state.locked);
  });
  document.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  canvas.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.ads = true;
  });
  document.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.ads = false;
  });
  document.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('wheel', (event) => {
    if (state.locked) state.wheel += Math.sign(event.deltaY);
  }, { passive: true });

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') event.preventDefault();
    state.keys.add(event.code);
  });
  document.addEventListener('keyup', (event) => state.keys.delete(event.code));
  window.addEventListener('blur', () => {
    state.keys.clear();
    state.firing = false;
    state.ads = false;
  });

  return {
    state,
    requestLock,
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    takeWheel() {
      const wheel = state.wheel;
      state.wheel = 0;
      return wheel;
    },
    pressed(code) {
      return state.keys.has(code);
    },
  };
}
