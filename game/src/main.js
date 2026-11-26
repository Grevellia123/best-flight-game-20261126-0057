// Volcano Sky Courier — game loop, screens and wiring.
// requestAnimationFrame with dt clamped at 0.05s; the world only advances
// while the screen is 'play'. ?shot=start|play|deliver|end stages a fixed
// scene for screenshots and freezes it.

import { VIEW, PALETTE, HORIZON_Y } from './config.js';
import { createWorld } from './world.js';
import { render, titleHit } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const ctx = canvas.getContext('2d');
const audio = createAudio();
const input = createInput(canvas);
const world = createWorld(20261126);
// Debug / verification handle (same pattern as v4): lets a test drive the
// real game and read its state without touching the DOM.
window.__vsc1World = world;
window.__vsc1Input = input;

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

// --- Settings (gear on the title card) ---
// Music on/off, Sound FX on/off, Quality Low/High. Persisted in safe
// localStorage (try/catch, in-memory values if storage is unavailable).
const SETTINGS_KEY = 'vsc-settings-v1';
const settings = { music: true, sfx: true, quality: 'high' };
let settingsOpen = false;
function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (typeof s.music === 'boolean') settings.music = s.music;
    if (typeof s.sfx === 'boolean') settings.sfx = s.sfx;
    if (s.quality === 'low' || s.quality === 'high') settings.quality = s.quality;
  } catch (e) { /* storage unavailable: keep defaults */ }
}
function saveSettings() {
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}
function applySettings() {
  audio.musicEnabled = settings.music;
  audio.sfxEnabled = settings.sfx;
  resize(); // Low quality also lowers the canvas resolution scale
}

let lastTime = 0;
let shotMode = null;
let announced = '';

function resize() {
  // Low quality renders at 0.75x resolution (visible softening, faster on
  // low-end phones); High uses the native DPR, capped at 2.
  const baseDpr = Math.min(2, window.devicePixelRatio || 1);
  const dpr = settings.quality === 'low' ? baseDpr * 0.75 : baseDpr;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  const scale = Math.min(canvas.width / VIEW.width, canvas.height / VIEW.height);
  const ox = (canvas.width - VIEW.width * scale) / 2;
  const oy = (canvas.height - VIEW.height * scale) / 2;
  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  // The letterbox offset in VIEW units, so the renderer can paint the sky
  // and sea across the full canvas (side bars on wide screens, top/bottom
  // bars on portrait phones) instead of leaving dead strips.
  VIEW.ox = ox / scale;
  VIEW.oy = oy / scale;
  // The same geometry in CSS pixels, for the DOM touch buttons: they sit
  // just above the canvas throttle panel instead of on top of it.
  const root = document.documentElement;
  const scaleCss = scale / dpr;
  root.style.setProperty('--band-ox', (ox / dpr) + 'px');
  root.style.setProperty('--band-oy', (oy / dpr) + 'px');
  root.style.setProperty('--band-scale', String(scaleCss));
  // Letterbox bars continue the scene instead of black: the sky gradient's
  // top colour above the frame, the sea's deep colour below it — so on a
  // portrait phone the whole screen reads as sky and sea, not black bars.
  // On a wide screen the side bars get the same treatment, split at the
  // horizon, until the first frame repaints them properly.
  const oxU = ox / scale, oyU = oy / scale;
  ctx.fillStyle = PALETTE.skyTop;
  ctx.fillRect(-oxU - 2, -oyU - 2, VIEW.width + oxU * 2 + 4, oyU + 2);
  ctx.fillStyle = PALETTE.seaDeep;
  ctx.fillRect(-oxU - 2, VIEW.height, VIEW.width + oxU * 2 + 4, oyU + 4);
  ctx.fillStyle = PALETTE.skyTop;
  ctx.fillRect(-oxU - 2, -oyU - 2, oxU + 2, VIEW.height + oyU * 2 + 4);
  ctx.fillRect(VIEW.width, -oyU - 2, oxU + 2, VIEW.height + oyU * 2 + 4);
  ctx.fillStyle = PALETTE.seaDeep;
  ctx.fillRect(-oxU - 2, HORIZON_Y, oxU + 2, VIEW.height - HORIZON_Y + oyU + 2);
  ctx.fillRect(VIEW.width, HORIZON_Y, oxU + 2, VIEW.height - HORIZON_Y + oyU + 2);
}
window.addEventListener('resize', resize);
resize();
loadSettings();
applySettings();

// CSS pixels -> 1280x720 VIEW coords (the canvas is letterboxed inside the
// window, so the offset/scale must be undone for title-screen hit tests).
function toView(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / VIEW.width, rect.height / VIEW.height);
  const ox = (rect.width - VIEW.width * scale) / 2;
  const oy = (rect.height - VIEW.height * scale) / 2;
  return { x: (clientX - rect.left - ox) / scale, y: (clientY - rect.top - oy) / scale };
}

function announce(text) {
  if (text === announced) return;
  announced = text;
  if (statusEl) statusEl.textContent = text;
}

function startRun() {
  settingsOpen = false;
  audio.resume();
  audio.click();
  world.reset(0, false);
  world.startTakeoff();
  audio.startEngine();
  announce('Takeoff roll! Lift off at 95 knots, fly the golden rings, pick up cargo, land on the island strip.');
}

function nextStep() {
  audio.click();
  if (world.screen === 'delivered') {
    world.nextMission();
    if (world.screen === 'takeoff') audio.startEngine();
  } else if (world.screen === 'over' || world.screen === 'complete') {
    startRun();
  }
}

function togglePause() {
  if (world.screen === 'play' || world.screen === 'takeoff') {
    world.pausedFrom = world.screen;
    world.screen = 'paused';
    audio.setThrottle(0, 0);
  } else if (world.screen === 'paused') {
    world.screen = world.pausedFrom || 'play';
    world.pausedFrom = null;
  }
}

input.onKey = (code) => {
  if (shotMode) return;
  audio.resume();
  if (code === 'Enter' || code === 'Space') {
    if (world.screen === 'title') { settingsOpen = false; startRun(); }
    else if (world.screen === 'delivered' || world.screen === 'over' || world.screen === 'complete') nextStep();
    else if (world.screen === 'paused') togglePause();
  } else if (code === 'Escape') {
    if (settingsOpen) { settingsOpen = false; return; }
    togglePause();
  } else if (code === 'KeyP') {
    togglePause();
  } else if (code === 'KeyM') {
    audio.setMuted(!audio.muted);
    updateMuteBtn();
  } else if (code === 'KeyR') {
    if (world.screen === 'play' || world.screen === 'takeoff' || world.screen === 'paused' || world.screen === 'over') startRun();
  }
};

input.onClick = (clientX, clientY) => {
  if (shotMode) return;
  audio.resume();
  if (world.screen === 'title') {
    // Title-screen taps first hit the card UI: gear, settings rows, or the
    // fly pill. A tap anywhere else while settings are open just closes
    // them — it never starts the game by accident.
    const v = toView(clientX, clientY);
    const hit = titleHit(v.x, v.y, settingsOpen);
    if (hit === 'gear') { settingsOpen = !settingsOpen; audio.click(); return; }
    if (settingsOpen) {
      if (hit === 'settings-close') { settingsOpen = false; audio.click(); return; }
      if (hit === 'music') { settings.music = !settings.music; applySettings(); saveSettings(); audio.click(); return; }
      if (hit === 'sfx') { settings.sfx = !settings.sfx; applySettings(); saveSettings(); audio.click(); return; }
      if (hit === 'quality-low' || hit === 'quality-high') {
        settings.quality = hit === 'quality-low' ? 'low' : 'high';
        applySettings(); saveSettings(); audio.click(); return;
      }
      if (hit === 'cta') { settingsOpen = false; startRun(); return; }
      settingsOpen = false;
      return;
    }
    startRun();
    return;
  }
  if (world.screen === 'delivered' || world.screen === 'over' || world.screen === 'complete') nextStep();
  else if (world.screen === 'paused') togglePause();
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden && (world.screen === 'play' || world.screen === 'takeoff') && !shotMode) {
    world.pausedFrom = world.screen;
    world.screen = 'paused';
  }
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
  render(ctx, world, audio, input, { settings, settingsOpen: false });
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
  if (shotMode) { render(ctx, world, audio, input, { settings, settingsOpen: false }); return; }
  if (!lastTime) lastTime = now;
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.05) dt = 0.05; // clamp: tab switches never fast-forward the flight
  if (dt < 0) dt = 0;
  if (world.screen === 'play' || world.screen === 'takeoff') {
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
  render(ctx, world, audio, input, { settings, settingsOpen });
  if (world.screen === 'play' || world.screen === 'takeoff') {
    const m = world.mission();
    announce(world.screen === 'takeoff'
      ? `Takeoff roll from ${m.from}. Lift off at 95 knots.`
      : `Day ${m.day}, delivery ${m.id} of 6 to ${m.to}. Score ${world.score}. Fuel ${Math.round(world.fuel)} percent.`);
  }
}
requestAnimationFrame(frame);
