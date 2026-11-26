// Keyboard, mouse and touch input for Volcano Sky Courier.
// Steer with A/D or arrow keys, throttle with W/S, climb with Up/Down.
// The mouse steers too: hold and drag sideways, or just move it — the plane
// banks toward the pointer. Touch drag steers the same way, and a short tap
// anywhere starts / continues the game. On-screen buttons (wired with
// bindHold) give touch players throttle, climb, pause and mute — each button
// tracks its own pointer, so one finger can steer while another holds a
// button. All input runs through Pointer Events, one path for mouse + touch.

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
    // True from the start on touch-first devices (coarse pointer), so the
    // title screen already shows tap wording before the first touch; set on
    // the first touch anywhere else. Render switches hints to touch when true.
    isTouch: typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(pointer: coarse)').matches : false,
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

    // Wire an on-screen hold button: while it is held (pointer down) the
    // named flag stays true. Each button tracks its own pointer, so several
    // fingers can hold different buttons at once, and a held button never
    // steals the steering finger (buttons are DOM elements above the canvas).
    bindHold(el, prop) {
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (e.pointerType === 'touch') input.isTouch = true;
        input[prop] = true;
        el.classList.add('pressed');
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* no capture */ }
      });
      const release = () => {
        input[prop] = false;
        el.classList.remove('pressed');
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
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
    steerPointer = null;
    tap = null;
  });

  // --- Pointer input on the canvas (mouse + touch, one path) ---
  let steerPointer = null; // pointerId currently steering by touch
  let tap = null; // { id, x, y, t } — a short, still press counts as a tap

  function canvasX(e) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return null;
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  canvas.addEventListener('pointerdown', (e) => {
    // Never let the browser take the touch for scroll / zoom / menus:
    // the canvas owns every pointer that lands on it.
    e.preventDefault();
    if (e.pointerType === 'touch') input.isTouch = true;
    const x = canvasX(e);
    if (x === null) return;
    if (e.pointerType === 'mouse') {
      input.mouseDown = true;
      input.mouseX = x;
      input.mouseActive = true;
    } else if (steerPointer === null) {
      steerPointer = e.pointerId;
      input.mouseX = x;
      input.mouseActive = true;
    }
    tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  });
  canvas.addEventListener('pointermove', (e) => {
    const x = canvasX(e);
    if (x === null) return;
    if (e.pointerType === 'mouse') {
      input.mouseX = x;
      input.mouseActive = true;
    } else if (e.pointerId === steerPointer) {
      input.mouseX = x;
    }
  });
  function pointerEnd(e) {
    if (tap && tap.id === e.pointerId) {
      const held = performance.now() - tap.t;
      const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
      // A short, nearly still press is a tap: start / continue / resume.
      // A drag is steering, never a tap — so dragging never starts the game
      // by accident and never skips a panel.
      if (held < 500 && moved < 16 && input.onClick) input.onClick(e.clientX, e.clientY);
      tap = null;
    }
    if (e.pointerId === steerPointer) steerPointer = null;
    if (e.pointerType === 'mouse') input.mouseDown = false;
  }
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', (e) => {
    tap = null;
    if (e.pointerId === steerPointer) steerPointer = null;
    if (e.pointerType === 'mouse') input.mouseDown = false;
  });
  // Long-press context menus must never pop up over the game.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return input;
}
