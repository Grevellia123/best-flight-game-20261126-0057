// Volcano Sky Courier — game loop, screens and wiring.
// requestAnimationFrame with dt clamped at 0.05s; the world only advances
// while the screen is 'play'. ?shot=start|play|deliver|end stages a fixed
// scene for screenshots and freezes it.

import { VIEW } from './config.js';
import { createWorld } from './world.js';
import { render } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const ctx = canvas.getContext('2d');
const audio = createAudio();
const input = createInput(canvas);
const world = createWorld(20261126);

// On-screen touch buttons (also clickable with a mouse): hold buttons for
// throttle and climb, tap buttons for pause and mute.
document.querySelectorAll('#touch-ui [data-hold]').forEach((el) => {
  input.bindHold(el, el.dataset.hold);
});
const pauseBtn = document.getElementById('btn-pause');
const muteBtn = document.getElementById('btn-mute');
function updateMuteBtn() {
  if (!muteBtn) return;
  muteBtn.textContent = audio.muted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound');
}
if (pauseBtn) {
  pauseBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (shotMode) return;
    audio.resume();
    togglePause();
  });
}
if (muteBtn) {
  muteBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audio.resume();
    audio.setMuted(!audio.muted);
    updateMuteBtn();
  });
}

let lastTime = 0;
let shotMode = null;
let announced = '';

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  const scale = Math.min(canvas.width / VIEW.width, canvas.height / VIEW.height);
  const ox = (canvas.width - VIEW.width * scale) / 2;
  const oy = (canvas.height - VIEW.height * scale) / 2;
  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  // Letterbox bars.
  ctx.fillStyle = '#0a0e1e';
  ctx.fillRect(-ox / scale - 2, -oy / scale - 2, VIEW.width + ox / scale * 2 + 4, oy / scale + 2);
  ctx.fillRect(-ox / scale - 2, VIEW.height, VIEW.width + ox / scale * 2 + 4, oy / scale + 4);
}
window.addEventListener('resize', resize);
resize();

function announce(text) {
  if (text === announced) return;
  announced = text;
  if (statusEl) statusEl.textContent = text;
}

function startRun() {
  audio.resume();
  audio.click();
  world.reset(0, false);
  world.screen = 'play';
  audio.startEngine();
  announce('Flying! Fly through the golden rings, pick up cargo, land on the island strip.');
}

function nextStep() {
  audio.click();
  if (world.screen === 'delivered') {
    world.nextMission();
    if (world.screen === 'play') audio.startEngine();
  } else if (world.screen === 'over' || world.screen === 'complete') {
    startRun();
  }
}

function togglePause() {
  if (world.screen === 'play') { world.screen = 'paused'; audio.setThrottle(0, 0); }
  else if (world.screen === 'paused') { world.screen = 'play'; }
}

input.onKey = (code) => {
  if (shotMode) return;
  audio.resume();
  if (code === 'Enter' || code === 'Space') {
    if (world.screen === 'title') startRun();
    else if (world.screen === 'delivered' || world.screen === 'over' || world.screen === 'complete') nextStep();
    else if (world.screen === 'paused') togglePause();
  } else if (code === 'KeyP' || code === 'Escape') {
    togglePause();
  } else if (code === 'KeyM') {
    audio.setMuted(!audio.muted);
    updateMuteBtn();
  } else if (code === 'KeyR') {
    if (world.screen === 'play' || world.screen === 'paused' || world.screen === 'over') startRun();
  }
};

input.onClick = () => {
  if (shotMode) return;
  audio.resume();
  if (world.screen === 'title') startRun();
  else if (world.screen === 'delivered' || world.screen === 'over' || world.screen === 'complete') nextStep();
  else if (world.screen === 'paused') togglePause();
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden && world.screen === 'play' && !shotMode) world.screen = 'paused';
});

// Screenshot mode: stage one fixed scene and hold it still.
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
if (shot) {
  shotMode = shot;
  // Screenshots render the bare game: hide the DOM touch controls.
  document.body.classList.add('shot-mode');
  const screen = stageShot(shot, world, null);
  world.screen = screen === 'title' ? 'title' : screen;
  render(ctx, world, audio, input);
  announce('Screenshot scene: ' + shot);
} else {
  world.screen = 'title';
}

// Background music follows the game: calm on the title, the main loop in
// flight, tenser when fuel is low or the hull is nearly gone, shimmering on
// the final approach, quiet while paused.
function moodFor() {
  switch (world.screen) {
    case 'title': return 'title';
    case 'delivered':
    case 'complete': return 'win';
    case 'over': return 'over';
    case 'paused': return 'paused';
    default: {
      if (world.fuel < 25 || world.hull <= 1) return 'danger';
      if (world.cargo && world.strip && world.strip.z < 0.55) return 'approach';
      return 'play';
    }
  }
}

let prevScreen = world.screen;

function frame(now) {
  requestAnimationFrame(frame);
  if (shotMode) { render(ctx, world, audio, input); return; }
  if (!lastTime) lastTime = now;
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.05) dt = 0.05; // clamp: tab switches never fast-forward the flight
  if (dt < 0) dt = 0;
  if (world.screen === 'play') {
    world.step(dt, input, audio);
    if (world.screen === 'over') audio.stopEngine();
    if (world.screen === 'delivered') audio.stopEngine();
  } else if (world.screen === 'title') {
    world.time += dt; // let the lagoon shimmer behind the title
  }
  // Screen changes get their own musical phrase, once.
  if (world.screen !== prevScreen) {
    if (world.screen === 'delivered' || world.screen === 'complete') audio.winPhrase();
    else if (world.screen === 'over') audio.somberPhrase();
    prevScreen = world.screen;
  }
  audio.setMood(moodFor());
  audio.update();
  // The flight buttons stay hidden on the title screen (see index.html).
  document.body.classList.toggle('on-title', world.screen === 'title');
  // The pause button shows ▶ while paused, ⏸ while flying.
  if (pauseBtn) {
    const label = world.screen === 'paused' ? '▶' : '⏸';
    if (pauseBtn.textContent !== label) pauseBtn.textContent = label;
  }
  render(ctx, world, audio, input);
  if (world.screen === 'play') {
    const m = world.mission();
    announce(`Day ${m.day}, delivery ${m.id} of 6 to ${m.to}. Score ${world.score}. Fuel ${Math.round(world.fuel)} percent.`);
  }
}
requestAnimationFrame(frame);
