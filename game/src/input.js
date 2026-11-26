// Keyboard, mouse and touch input for Volcano Sky Courier.
// Steer with A/D or arrow keys, throttle with W/S, climb with Up/Down.
// The mouse steers too: hold and drag sideways, or just move it — the plane
// banks toward the pointer. Touch drag steers the same way.

export function createInput(canvas) {
  const input = {
    left: false,
    right: false,
    up: false,
    down: false,
    throttleUp: false,
    throttleDown: false,
    mouseX: 0.5, // 0..1 across the canvas
    mouseActive: false,
    mouseDown: false,
    pressedKeys: new Set(),
    onKey: null, // (code) => void, set by main.js for pause/mute/start
    onClick: null, // (x, y) => void, set by main.js for buttons

    steer() {
      let s = 0;
      if (this.left) s -= 1;
      if (this.right) s += 1;
      if (this.mouseActive) {
        const target = (this.mouseX - 0.5) * 2;
        s += Math.max(-1, Math.min(1, target * 1.4));
      }
      return Math.max(-1, Math.min(1, s));
    },
    climb() {
      let c = 0;
      if (this.up) c += 1;
      if (this.down) c -= 1;
      return c;
    },
    throttleDelta() {
      let d = 0;
      if (this.throttleUp) d += 1;
      if (this.throttleDown) d -= 1;
      return d;
    },
  };

  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'throttleUp',
    ArrowDown: 'down', KeyS: 'throttleDown',
  };

  function down(e) {
    const mapped = KEYMAP[e.code];
    if (mapped) { input[mapped] = true; e.preventDefault(); }
    if (!input.pressedKeys.has(e.code)) {
      input.pressedKeys.add(e.code);
      if (input.onKey) input.onKey(e.code);
    }
  }
  function up(e) {
    const mapped = KEYMAP[e.code];
    if (mapped) { input[mapped] = false; e.preventDefault(); }
    input.pressedKeys.delete(e.code);
  }

  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', () => {
    input.left = input.right = input.up = input.down = false;
    input.throttleUp = input.throttleDown = false;
    input.pressedKeys.clear();
    input.mouseActive = false;
  });

  function pointerMove(e) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    input.mouseX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    input.mouseActive = true;
  }
  canvas.addEventListener('mousemove', pointerMove);
  canvas.addEventListener('mousedown', (e) => {
    input.mouseDown = true;
    pointerMove(e);
    if (input.onClick) input.onClick(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', () => { input.mouseDown = false; });
  canvas.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t) { input.mouseX = t.clientX / window.innerWidth; input.mouseActive = true; }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (t) input.mouseX = t.clientX / window.innerWidth;
    e.preventDefault();
  }, { passive: false });

  return input;
}
