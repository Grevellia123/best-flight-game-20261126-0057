// Volcano Sky Courier — all drawing: golden-hour sky, archipelago sea,
// volcano islands, glowing rings, the seaplane, and the HUD.
// Everything is canvas 2D, no images, no network.

import { VIEW, HORIZON_Y, PALETTE, MISSIONS } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_DELIVERED = 'delivered';
export const SCREEN_OVER = 'over';
export const SCREEN_COMPLETE = 'complete';

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Viewport culling: skip drawing anything whose bounding circle sits fully
// outside the visible frame (including the letterbox side bars, ox/oy).
// The projection can push islands, rings and hazards far past the left or
// right edge, and drawing them still costs fill / stroke / shadow work
// even though no pixel lands on screen. The margin is generous on purpose:
// a culled object must be one that cannot peek in, smoke plume and glow
// included. Anything culled here also drops its deferred world label, so
// an off-screen island no longer leaves its name clamped to the frame edge.
function offscreen(x, y, r) {
  const ox = VIEW.ox || 0;
  const oy = VIEW.oy || 0;
  return x + r < -ox - 8 || x - r > VIEW.width + ox + 8
    || y + r < -oy - 8 || y - r > VIEW.height + oy + 8;
}

// Title panel bounds (1280x720 view space): the start screen's left-side
// menu card. World labels, rings and hazards that fall behind it are hidden
// while the title overlay is up, so nothing bleeds through or gets clipped.
// Tall warm-brown card (reference look): header, big title, one short line,
// a glass showcase with the seaplane, and one pill button.
const TITLE_PANEL = { x: 56, y: 120, w: 520, h: 470 };

// Graphics quality for this frame ('high' | 'low'), set by render() from
// the settings. Low drops glow (shadowBlur), particles and speed lines.
let QUALITY = 'high';

// Title-screen UI hit regions (VIEW coords). The SETTINGS text button opens
// settings; the settings panel floats right of the title card, clear of the
// gauges (which end at y 108) and of the throttle bar (top y 636).
const GEAR_RECT = { x: 261, y: 540, w: 110, h: 36 };
const SETTINGS_PANEL = { x: 600, y: 120, w: 340, h: 296 };
const SETTINGS_CLOSE = { x: 892, y: 136, w: 32, h: 32 };
const MUSIC_TOGGLE = { x: 800, y: 188, w: 92, h: 36 };
const SFX_TOGGLE = { x: 800, y: 238, w: 92, h: 36 };
const QUALITY_LOW = { x: 782, y: 288, w: 60, h: 36 };
const QUALITY_HIGH = { x: 850, y: 288, w: 62, h: 36 };
// The call-to-action pill rect, recorded each time drawTitle runs.
let CTA_RECT = null;

function inRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

// Hit-test a title-screen tap/click in VIEW coords. Returns 'gear',
// 'settings-close', 'music', 'sfx', 'quality-low', 'quality-high',
// 'cta', 'settings-panel', 'outside-settings', or null (plain canvas).
export function titleHit(x, y, settingsOpen) {
  if (settingsOpen) {
    if (inRect(x, y, SETTINGS_CLOSE)) return 'settings-close';
    if (inRect(x, y, MUSIC_TOGGLE)) return 'music';
    if (inRect(x, y, SFX_TOGGLE)) return 'sfx';
    if (inRect(x, y, QUALITY_LOW)) return 'quality-low';
    if (inRect(x, y, QUALITY_HIGH)) return 'quality-high';
    if (inRect(x, y, SETTINGS_PANEL)) return 'settings-panel';
    if (inRect(x, y, GEAR_RECT)) return 'gear';
    // The fly pill still works while settings are open: tapping it closes
    // settings and starts the game (handled by the caller).
    if (CTA_RECT && inRect(x, y, CTA_RECT)) return 'cta';
    return 'outside-settings';
  }
  if (inRect(x, y, GEAR_RECT)) return 'gear';
  if (CTA_RECT && inRect(x, y, CTA_RECT)) return 'cta';
  return null;
}

// True when the point (with a margin for label width) sits behind the panel.
function inTitlePanel(x, y, pad) {
  return x >= TITLE_PANEL.x - pad && x <= TITLE_PANEL.x + TITLE_PANEL.w + pad
    && y >= TITLE_PANEL.y - pad && y <= TITLE_PANEL.y + TITLE_PANEL.h + pad;
}

// True when a circle (ring, hazard) overlaps the panel, margin included.
function circleHitsTitlePanel(x, y, r) {
  const nx = clamp(x, TITLE_PANEL.x, TITLE_PANEL.x + TITLE_PANEL.w);
  const ny = clamp(y, TITLE_PANEL.y, TITLE_PANEL.y + TITLE_PANEL.h);
  const dx = x - nx, dy = y - ny;
  return dx * dx + dy * dy < (r + 6) * (r + 6);
}

// Depth: z 1 = far at the horizon, 0 = at the camera.
function depthOf(z) { return clamp(1 - z, 0, 1); }
function groundY(z) { const d = depthOf(z); return HORIZON_Y + d * d * 428; }
function airY(world, alt, z) {
  const d = depthOf(z);
  const rel = (alt - world.plane.alt) / 4200;
  // At the camera (d = 1) a ring at the plane's altitude sits exactly on the
  // plane's screen height, so flying through the hole looks like flying
  // through it; far away it still sits near the horizon, as it should.
  return (HORIZON_Y + d * 184) - rel * (120 + d * 260);
}
function laneX(world, x, z) {
  const d = depthOf(z);
  return VIEW.width / 2 + (x - world.plane.x * 0.35) * 620 * (0.3 + 0.7 * d);
}
function scaleAt(z) { const d = depthOf(z); return 0.12 + Math.pow(d, 1.6) * 1.7; }

// Rings and hazards use a gentler depth falloff than the scenery: with the
// plain depthOf() every ring beyond z = 1 collapses to the same horizon
// spot (d = 0), so three rings in a row drew on top of each other. With
// ringDepth() they fan out with distance instead — far rings read as the
// route ahead, near rings stay big. Hit detection still uses world x/alt/z,
// so this only changes where rings are drawn, never whether they count.
function ringDepth(z) { return clamp(1 - z / 2.5, 0, 1); }
function laneXAt(world, x, d) {
  return VIEW.width / 2 + (x - world.plane.x * 0.35) * 620 * (0.3 + 0.7 * d);
}
function airYAt(world, alt, d) {
  const rel = (alt - world.plane.alt) / 4200;
  return (HORIZON_Y + d * 184) - rel * (120 + d * 260);
}
// Screen circle of a ring or hazard under the ring projection, for the
// label layer's collision checks.
function ringCircle(world, o, fuel) {
  const d = ringDepth(o.z);
  return {
    x: laneXAt(world, o.x, d), y: airYAt(world, o.alt, d),
    r: (30 + d * 150) * (fuel ? 0.8 : 1),
  };
}

// The plane's screen box (VIEW coords), mirroring drawPlane: labels are
// never drawn on top of the plane itself.
function planeBox(world) {
  const cx = VIEW.width / 2 + (world.screen === 'title' ? 180 : 0);
  const onWater = world.screen === 'takeoff' || world.landed;
  const cy = (onWater ? 545 - (world.lift || 0) * 93 : 452) + world.plane.pitch * 26;
  return { x: cx - 204, y: cy - 74, w: 408, h: 148 };
}

// --- Deferred world labels -----------------------------------------------
// Island / strip / hazard labels are collected while the world is drawn and
// placed afterwards, in one pass, so a label can never sit under a ring or
// a hazard, collide with another label, repeat a name, or run off the
// frame. Labels live in the full viewport width (-ox .. 1280+ox), not just
// the 1280 band, because on wide screens the scenery continues past it.
function makeLabelLayer(ctx, circles, extraBlocked) {
  const layer = {
    ctx, circles: circles || [], placed: [], names: new Set(),
    // HUD panels the labels must also stay clear of (VIEW coords).
    blocked: [
      { x: 36, y: 8, w: 200, h: 104 }, // gauges
      { x: 14, y: 118, w: 380, h: 62 }, // mission banner (top-left column)
      { x: 14, y: 190, w: 380, h: 34 }, // floating message pill (top-left column)
      { x: 380, y: 8, w: 520, h: 60 }, // compass
      { x: 1010, y: 14, w: 256, h: 110 }, // fuel / hull panel
      { x: 14, y: 636, w: 240, h: 58 }, // throttle bar
      { x: 880, y: 664, w: 386, h: 30 }, // hints pill
      // Central forward corridor: the plane's path and the next ring.
      // No world label may sit here — the centre belongs to flying.
      { x: 400, y: 150, w: 480, h: 410 },
      ...(extraBlocked || []),
    ],
    defer(text, x, y, fontPx, opts) {
      this.list.push({ text, x, y, fontPx, ...(opts || {}) });
    },
    list: [],
    placeAll() {
      // Priority first (strip, then hazards, then islands), nearest first
      // inside each group, so the closest label wins any contested spot.
      const order = { strip: 0, hazard: 1, island: 2 };
      this.list.sort((a, b) => (order[a.kind] - order[b.kind]) || (b.d - a.d));
      for (const item of this.list) this.place(item);
    },
    place(item) {
      const ctx = this.ctx;
      const ox = VIEW.ox || 0;
      const x0 = -ox, x1 = VIEW.width + ox;
      if (item.name) {
        if (this.names.has(item.name)) return false;
      }
      ctx.font = `bold ${item.fontPx}px sans-serif`;
      const w = ctx.measureText(item.text).width;
      const half = w / 2 + 8;
      const x = clamp(item.x, x0 + half, x1 - half);
      const y = clamp(item.y, 150, 648);
      const rect = { x: x - half, y: y - item.fontPx, w: w + 16, h: item.fontPx + 10 };
      for (const b of this.blocked) {
        if (rect.x < b.x + b.w && rect.x + rect.w > b.x && rect.y < b.y + b.h && rect.y + rect.h > b.y) return false;
      }
      for (const p of this.placed) {
        if (rect.x < p.x + p.w && rect.x + rect.w > p.x && rect.y < p.y + p.h && rect.y + rect.h > p.y) return false;
      }
      for (const c of this.circles) {
        const nx = clamp(x, c.x - c.r, c.x + c.r);
        const ny = clamp(y - item.fontPx / 2, c.y - c.r, c.y + c.r);
        const dx = x - nx, dy = (y - item.fontPx / 2) - ny;
        if (dx * dx + dy * dy < (c.r + 6) * (c.r + 6)) return false;
      }
      if (item.name) this.names.add(item.name);
      this.placed.push(rect);
      ctx.save();
      if (item.pill) {
        ctx.fillStyle = 'rgba(10, 14, 30, 0.82)';
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 8);
        ctx.fill();
      }
      ctx.fillStyle = item.color || PALETTE.hudText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.text, x, y - item.fontPx / 2 + 1);
      ctx.restore();
      return true;
    },
  };
  return layer;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSky(ctx, world) {
  const ox = VIEW.ox || 0;
  const oy = VIEW.oy || 0;
  const g = ctx.createLinearGradient(0, 0, 0, HORIZON_Y + 40);
  g.addColorStop(0, PALETTE.skyTop);
  g.addColorStop(0.55, PALETTE.skyMid);
  g.addColorStop(0.85, PALETTE.skyLow);
  g.addColorStop(1, PALETTE.horizonGlow);
  ctx.fillStyle = g;
  // Full canvas width, not just the 1280 band: on a viewport wider than
  // 16:9 the sky must continue into the side bars, or the frame reads as
  // a band with dead strips. Extended past the top too so the shake
  // translate never uncovers a raw edge.
  ctx.fillRect(-ox - 8, -oy - 8, VIEW.width + 2 * ox + 16, HORIZON_Y + 48 + oy);
  // Low golden sun with halo — pinned to the sky, it never slides with
  // steering (a distant sun does not move when the plane banks).
  const sunX = 930;
  const sunY = 218;
  const halo = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, 150);
  halo.addColorStop(0, 'rgba(255, 214, 120, 0.9)');
  halo.addColorStop(0.35, 'rgba(255, 154, 61, 0.45)');
  halo.addColorStop(1, 'rgba(255, 154, 61, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(sunX - 160, sunY - 160, 320, 320);
  ctx.fillStyle = PALETTE.sunCore;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 34, 0, Math.PI * 2);
  ctx.fill();
  // Slow clouds, tinted by the sunset. They drift LEFT as the plane flies
  // forward — the same direction as the world below them. They span the
  // full canvas width so a wide screen has sky all the way across.
  ctx.fillStyle = 'rgba(255, 190, 150, 0.55)';
  const t = world.time * 6;
  const span = VIEW.width + 2 * ox + 170;
  for (let i = 0; i < 7; i += 1) {
    const cx = ((i * 211 - t * (4 + i)) % span + span) % span - 85 - ox;
    const cy = 52 + (i % 3) * 46;
    const cw = 120 + (i % 3) * 60;
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw, 15 + (i % 2) * 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSea(ctx, world) {
  const ox = VIEW.ox || 0;
  const g = ctx.createLinearGradient(0, HORIZON_Y, 0, VIEW.height);
  g.addColorStop(0, PALETTE.seaMid);
  g.addColorStop(0.5, '#0f4a68');
  g.addColorStop(1, PALETTE.seaDeep);
  ctx.fillStyle = g;
  // Full canvas width, like the sky: the sea must reach the side bars too.
  ctx.fillRect(-ox - 8, HORIZON_Y, VIEW.width + 2 * ox + 16, VIEW.height - HORIZON_Y + 8);
  // Sun glitter path on the water, kept tight under the pinned sun.
  ctx.fillStyle = 'rgba(255, 217, 138, 0.5)';
  for (let i = 0; i < 18; i += 1) {
    const y = HORIZON_Y + 12 + i * 20;
    const w = 18 + i * 5;
    const x = 930 + Math.sin(world.time * 2 + i * 1.7) * (6 + i * 0.5);
    ctx.fillRect(x - w / 2, y, w, 3);
  }
  // Wave strokes.
  ctx.strokeStyle = 'rgba(180, 225, 255, 0.16)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i += 1) {
    const y = HORIZON_Y + 30 + i * 36;
    ctx.beginPath();
    for (let x = -ox; x <= VIEW.width + ox; x += 40) {
      const yy = y + Math.sin(x * 0.02 + world.time * 1.4 + i) * 3;
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  // Streaming sea streaks: short dashes that rush backward past the
  // plane, so the sea itself reads as forward motion. Their speed
  // follows world.distance, which grows with airspeed. Off on the
  // title screen, where the sea is a backdrop, not a runway.
  if (world.screen !== 'title') {
    ctx.strokeStyle = 'rgba(180, 225, 255, 0.14)';
    ctx.lineWidth = 2;
    const span = VIEW.width + 2 * ox + 120;
    for (let i = 0; i < 13; i += 1) {
      const y = HORIZON_Y + 44 + i * 32;
      const x = (((-world.distance * 2.2 + i * 173) % span) + span) % span - ox - 60;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 26, y);
      ctx.stroke();
    }
  }
}

function drawIsland(ctx, world, isl, onTitle, labels) {
  const d = depthOf(isl.z);
  if (d <= 0.02) return;
  const x = laneX(world, isl.x, isl.z);
  const y = groundY(isl.z);
  const s = scaleAt(isl.z) * isl.size;
  // Viewport culling: cone + smoke plume span ~260*s from (x, y - 100*s).
  if (offscreen(x, y - 100 * s, 260 * s)) return;
  ctx.save();
  ctx.globalAlpha = 0.55 + d * 0.45;
  if (isl.kind === 'volcano') {
    // Cone with a glowing crater and a drifting smoke plume.
    ctx.fillStyle = PALETTE.volcanoRock;
    ctx.beginPath();
    ctx.moveTo(x - 150 * s, y);
    ctx.lineTo(x - 34 * s, y - 210 * s);
    ctx.lineTo(x + 34 * s, y - 210 * s);
    ctx.lineTo(x + 150 * s, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = PALETTE.lava;
    ctx.beginPath();
    ctx.ellipse(x, y - 208 * s, 30 * s, 9 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.lavaBright;
    ctx.beginPath();
    ctx.ellipse(x, y - 210 * s, 16 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // Lava trickle down the cone.
    ctx.strokeStyle = PALETTE.lava;
    ctx.lineWidth = 5 * s;
    ctx.beginPath();
    ctx.moveTo(x + 6 * s, y - 200 * s);
    ctx.lineTo(x + 26 * s, y - 120 * s);
    ctx.lineTo(x + 12 * s, y - 60 * s);
    ctx.stroke();
    // Smoke plume.
    ctx.fillStyle = 'rgba(90, 70, 90, 0.5)';
    for (let i = 0; i < 4; i += 1) {
      const px = x + 10 * s + i * 16 * s + Math.sin(world.time + i * 2) * 8 * s;
      const py = y - 225 * s - i * 26 * s;
      ctx.beginPath();
      ctx.arc(px, py, (16 + i * 9) * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // The name goes through the deferred label layer: it is clamped
    // inside the frame, kept off rings and hazards, and drawn once per
    // name, so "PULAU API" can never run off the right edge or sit under
    // an ash cloud. On the title screen, never draw a label behind the
    // menu panel.
    if (labels && d > 0.25 && d < 0.85 && !(onTitle && inTitlePanel(x, y - 250 * s, 80))) {
      labels.defer(isl.name.toUpperCase(), x, y - 250 * s, Math.max(11, Math.min(20, 15 * s)), { kind: 'island', d, name: isl.name });
    }
  } else {
    // Green island hump, sand rim, palms and village roofs.
    ctx.fillStyle = isl.hue === 'gold' ? '#6b7a2e' : isl.hue === 'teal' ? '#2e6b5d' : '#2e6b3a';
    ctx.beginPath();
    ctx.ellipse(x, y, 150 * s, 46 * s, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = PALETTE.sand;
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 158 * s, 12 * s, 0, 0, Math.PI);
    ctx.fill();
    if (isl.kind === 'terraces') {
      ctx.strokeStyle = '#8fae4a';
      ctx.lineWidth = 3 * s;
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        ctx.ellipse(x, y - 8 * s - i * 10 * s, (120 - i * 26) * s, 12 * s, 0, Math.PI, 0);
        ctx.stroke();
      }
    }
    if (isl.kind === 'village') {
      for (let i = -2; i <= 2; i += 1) {
        const hx = x + i * 42 * s;
        const hy = y - 18 * s - Math.abs(i) * -2 * s;
        ctx.fillStyle = '#f2e6c8';
        ctx.fillRect(hx - 11 * s, hy - 12 * s, 22 * s, 12 * s);
        ctx.fillStyle = PALETTE.villageRoof;
        ctx.beginPath();
        ctx.moveTo(hx - 13 * s, hy - 12 * s);
        ctx.lineTo(hx, hy - 24 * s);
        ctx.lineTo(hx + 13 * s, hy - 12 * s);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Palms.
    ctx.strokeStyle = '#1e4d2a';
    ctx.lineWidth = 3 * s;
    for (let i = -1; i <= 1; i += 1) {
      const px = x + i * 70 * s;
      ctx.beginPath();
      ctx.moveTo(px, y - 4 * s);
      ctx.lineTo(px + 4 * s, y - 30 * s);
      ctx.stroke();
      ctx.fillStyle = '#2f8a44';
      ctx.beginPath();
      ctx.arc(px + 4 * s, y - 32 * s, 10 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // Name through the deferred label layer (see the volcano branch).
    if (labels && d > 0.3 && d < 0.85 && !(onTitle && inTitlePanel(x, y - 56 * s, 80))) {
      labels.defer(isl.name.toUpperCase(), x, y - 56 * s, Math.max(11, Math.min(20, 15 * s)), { kind: 'island', d, name: isl.name });
    }
  }
  ctx.restore();
}

function drawStrip(ctx, world, onTitle, stripOverride, labelOverride, labels) {
  const strip = stripOverride || world.strip;
  if (!strip) return;
  const d = depthOf(strip.z);
  if (d <= 0.02) return;
  const cx = laneX(world, 0, strip.z);
  const y = groundY(strip.z);
  const s = scaleAt(strip.z);
  // Viewport culling: strip + its label span ~120*s from (cx, y - 45*s).
  if (offscreen(cx, y - 45 * s, 120 * s)) return;
  // Water runway: pale strip with centre dashes and edge lights, narrowing
  // toward the horizon like a real perspective runway.
  ctx.save();
  ctx.globalAlpha = 0.6 + d * 0.4;
  ctx.fillStyle = '#e8d9a8';
  ctx.beginPath();
  ctx.moveTo(cx - 34 * s, y);
  ctx.lineTo(cx - 12 * s, y - 90 * s);
  ctx.lineTo(cx + 12 * s, y - 90 * s);
  ctx.lineTo(cx + 34 * s, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fff6dd';
  ctx.lineWidth = 3 * s;
  ctx.setLineDash([14 * s, 12 * s]);
  ctx.beginPath();
  ctx.moveTo(cx, y - 4);
  ctx.lineTo(cx, y - 88 * s);
  ctx.stroke();
  ctx.setLineDash([]);
  // Edge lights, lit amber.
  ctx.fillStyle = '#ffd23d';
  for (let i = 0; i <= 4; i += 1) {
    const t = i / 4;
    const ly = y - t * 88 * s;
    const lw = 34 * s - t * 22 * s;
    ctx.beginPath(); ctx.arc(cx - lw, ly, 4 * s + 1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + lw, ly, 4 * s + 1, 0, Math.PI * 2); ctx.fill();
  }
  // The runway name goes through the deferred label layer, on a dark
  // pill: the old dark-on-pale text was unreadable once the strip shrank
  // toward the horizon. On the title screen, never draw it behind the
  // menu panel.
  const label = labelOverride || ('▸ RUNWAY — ' + world.mission().to.toUpperCase());
  if (labels && d > 0.2 && !(onTitle && inTitlePanel(cx, y - 108 * s, 130))) {
    labels.defer(label, cx, y - 108 * s, Math.max(12, 18 * s), { kind: 'strip', d, pill: true });
  }
  ctx.restore();
}

function drawRing(ctx, world, ring, fuel, onTitle) {
  const d = ringDepth(ring.z);
  // A missed ring stays visible: it circles back around and can be hit.
  if (d <= 0.02 || ring.hit || ring.taken) return;
  const x = laneXAt(world, ring.x, d);
  const y = airYAt(world, ring.alt, d);
  // Wide enough at the camera that the plane (296 px long) fits through
  // the hole: a hit now looks like flying through the ring.
  const r = (30 + d * 150) * (fuel ? 0.8 : 1);
  // Viewport culling: ring + stroke + shadow glow span r + 28.
  if (offscreen(x, y, r + 28)) return;
  // On the title screen, rings behind the menu panel are hidden outright —
  // a glowing arc bleeding through the panel edge reads as a defect.
  if (onTitle && circleHitsTitlePanel(x, y, r)) return;
  const pulse = 0.75 + Math.sin(world.time * 4 + ring.z * 20) * 0.25;
  ctx.save();
  ctx.globalAlpha = 0.30 + d * 0.70;
  ctx.strokeStyle = fuel ? PALETTE.ringGreen : PALETTE.ringGold;
  ctx.lineWidth = (fuel ? 6 : 9) + d * 5;
  ctx.shadowColor = fuel ? PALETTE.ringGreen : PALETTE.ringGold;
  ctx.shadowBlur = QUALITY === 'low' ? 0 : 18 * pulse;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  // The inner mark rides above the centre, not in it: the plane flies
  // through the hole, so a centred "FUEL"/"◉" would sit on the fuselage.
  ctx.fillStyle = fuel ? PALETTE.ringGreen : PALETTE.ringGold;
  ctx.font = `bold ${Math.max(13, Math.round(r * 0.42))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fuel ? 'FUEL' : '◉', x, y - r * 0.5);
  ctx.restore();
}

function drawHazard(ctx, world, hz, onTitle, labels) {
  const d = ringDepth(hz.z);
  if (d <= 0.02 || hz.hit) return;
  const x = laneXAt(world, hz.x, d);
  const y = airYAt(world, hz.alt, d);
  const r = (30 + d * 130) * hz.r * 4;
  // Viewport culling: the ash puffs reach ~1.31*r from the centre.
  if (offscreen(x, y, r * 1.35 + 8)) return;
  // Same as rings: hidden behind the title panel, label included.
  if (onTitle && circleHitsTitlePanel(x, y, r)) return;
  ctx.save();
  ctx.globalAlpha = 0.4 + d * 0.55;
  ctx.fillStyle = '#4a3a4a';
  for (let i = 0; i < 5; i += 1) {
    const ox = Math.sin(hz.z * 40 + i * 2.1) * r * 0.5;
    const oy = Math.cos(hz.z * 30 + i * 1.3) * r * 0.3;
    ctx.beginPath();
    ctx.arc(x + ox, y + oy, r * (0.45 + (i % 3) * 0.14), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // The warning goes through the deferred label layer, so it can never sit
  // on top of a ring or run off the top of the frame.
  if (labels) {
    labels.defer('⚠ ASH', x, Math.max(y - r * 0.9, 196), Math.max(12, Math.round(r * 0.28)), { kind: 'hazard', d, color: '#ff5a4a' });
  }
}

function drawGuideLine(ctx, world) {
  // Dashed guide line from just ahead of the plane's nose to the next
  // ring: the flight path made visible, so the plane reads as travelling
  // forward toward something, not parked in the middle. In play only,
  // drawn under the rings and the plane; it stops at the ring's rim,
  // never through its centre.
  if (world.screen !== 'play') return;
  const next = world.nextRing();
  if (!next) return;
  const c = ringCircle(world, next, false);
  const sx = VIEW.width / 2 + 60;
  const sy = 452 + world.plane.pitch * 26;
  const dx = c.x - sx, dy = c.y - sy;
  const len = Math.hypot(dx, dy);
  if (len < 10) return;
  const ex = c.x - (dx / len) * c.r, ey = c.y - (dy / len) * c.r;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 210, 61, 0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 10]);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.restore();
}

function drawPlane(ctx, world) {
  const p = world.plane;
  // On the title screen the plane sits right of the title panel, fully in
  // frame; in flight it stays centred in the chase view. On the water
  // (takeoff roll, or sitting after a landing) it rides low in the frame
  // and climbs to cruise height as it lifts off.
  const cx = VIEW.width / 2 + (world.screen === 'title' ? 180 : 0);
  const onWater = world.screen === 'takeoff' || world.landed;
  const cy = (onWater ? 545 - (world.lift || 0) * 93 : 452) + p.pitch * 26;
  const bank = p.bank;
  const propSpin = world.time * 42;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(bank * 0.9);
  // Soft shadow on the sea below: close under the plane on the water,
  // further below and smaller the higher the plane climbs.
  const alt01 = clamp(p.alt / 9200, 0, 1);
  ctx.fillStyle = `rgba(6, 20, 40, ${(0.35 * (1 - alt01 * 0.5)).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(10, 60 + alt01 * 140, 150 * (1 - alt01 * 0.45), 14, 0, 0, Math.PI * 2);
  ctx.fill();
  // Brief post-hit protection blinks the plane so the player can see it.
  if (world.invuln > 0 && Math.floor(world.time * 12) % 2 === 0) ctx.globalAlpha = 0.45;
  // Pontoons.
  ctx.fillStyle = PALETTE.planeTeal;
  roundRect(ctx, -118, 58, 96, 16, 7); ctx.fill();
  roundRect(ctx, 22, 58, 96, 16, 7); ctx.fill();
  ctx.fillStyle = PALETTE.planeDark;
  ctx.fillRect(-86, 34, 8, 26); ctx.fillRect(78, 34, 8, 26);
  // Tail.
  ctx.fillStyle = PALETTE.planeRed;
  ctx.beginPath();
  ctx.moveTo(-138, -6); ctx.lineTo(-172, -52); ctx.lineTo(-146, -56); ctx.lineTo(-118, -10);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = PALETTE.planeCream;
  ctx.beginPath();
  ctx.moveTo(-138, 6); ctx.lineTo(-168, 30); ctx.lineTo(-142, 34); ctx.lineTo(-118, 10);
  ctx.closePath(); ctx.fill();
  // Fuselage.
  ctx.fillStyle = PALETTE.planeCream;
  ctx.beginPath();
  ctx.ellipse(0, 0, 148, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  // Red cheatline.
  ctx.fillStyle = PALETTE.planeRed;
  ctx.beginPath();
  ctx.ellipse(0, 8, 146, 9, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillRect(-146, 4, 292, 7);
  // Lit cockpit windows.
  ctx.fillStyle = '#ffd98a';
  ctx.beginPath(); ctx.ellipse(96, -12, 22, 11, -0.12, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(66, -15, 18, 10, -0.08, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b2b33';
  ctx.beginPath(); ctx.ellipse(96, -12, 22, 11, -0.12, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(66, -15, 18, 10, -0.08, 0, Math.PI * 2); ctx.stroke();
  // Registration.
  ctx.fillStyle = '#2b2b33';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PK-VSC', -30, -6);
  // Upper wing.
  ctx.fillStyle = PALETTE.planeRed;
  ctx.beginPath();
  ctx.moveTo(-52, -26); ctx.lineTo(52, -26); ctx.lineTo(30, -58); ctx.lineTo(-30, -58);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(-30, -58, 60, 6);
  // Propeller: blurred disc + two blades, spinning.
  ctx.save();
  ctx.translate(152, 0);
  ctx.fillStyle = 'rgba(43, 43, 51, 0.18)';
  ctx.beginPath(); ctx.arc(0, 0, 52, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(propSpin);
  ctx.fillStyle = 'rgba(43, 43, 51, 0.85)';
  roundRect(ctx, -4, -52, 8, 104, 4); ctx.fill();
  ctx.rotate(Math.PI / 2);
  roundRect(ctx, -4, -52, 8, 104, 4); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#2b2b33';
  ctx.beginPath(); ctx.arc(152, 0, 9, 0, Math.PI * 2); ctx.fill();
  // Navigation lights, lit.
  ctx.fillStyle = '#ff5a4a';
  ctx.beginPath(); ctx.arc(-148, 0, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7dff9a';
  ctx.beginPath(); ctx.arc(148, -4, 5, 0, Math.PI * 2); ctx.fill();
  // Exhaust trail: faint puffs streaming back from the tail, so the
  // plane reads as travelling forward, not parked. In flight only.
  if (world.screen === 'play' || world.screen === 'takeoff') {
    for (let i = 0; i < 4; i += 1) {
      const px = -185 - i * 34 - ((world.time * 140 * (0.5 + world.speedLines)) % 34);
      const py = 8 + Math.sin(world.time * 3 + i * 1.7) * 5;
      ctx.fillStyle = `rgba(200, 220, 235, ${(0.14 - i * 0.025).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(px, py, 6 + i * 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
  // Speed streaks at high speed (off on Low quality): short lines
  // radiating outward from the horizon centre, rushing away from the
  // direction of travel — the world streaming past the plane. The old
  // horizontal streaks drifted downward and read as rain. In flight
  // only; they start clear of the plane and never cross it.
  if (QUALITY !== 'low' && world.speedLines > 0.55
    && (world.screen === 'play' || world.screen === 'takeoff')) {
    const s01 = world.speedLines;
    const ox = VIEW.ox || 0, oy = VIEW.oy || 0;
    ctx.strokeStyle = `rgba(255,255,255,${(0.10 + 0.16 * s01).toFixed(3)})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2 + 0.26;
      const r = 260 + ((i * 149 + world.time * 620 * (0.4 + s01)) % 620);
      const x0 = 640 + Math.cos(a) * r, y0 = 268 + Math.sin(a) * r;
      const len = 50 + 70 * s01;
      const x1 = 640 + Math.cos(a) * (r + len), y1 = 268 + Math.sin(a) * (r + len);
      if (x0 < -ox - 20 || x0 > VIEW.width + ox + 20 || y0 < -oy - 20 || y0 > VIEW.height + oy + 20) continue;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }
}

function gauge(ctx, x, y, r, label, value, max, unit, color) {
  ctx.save();
  ctx.fillStyle = PALETTE.hudPanel;
  ctx.strokeStyle = PALETTE.hudEdge;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Tick ring.
  ctx.strokeStyle = 'rgba(255,246,221,0.5)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 10; i += 1) {
    const a = -Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4));
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    ctx.stroke();
  }
  // Needle, lit.
  const frac = clamp(value / max, 0, 1);
  const a = -Math.PI * 0.75 + frac * Math.PI * 1.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = QUALITY === 'low' ? 0 : 8;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(a) * (r - 8), y + Math.sin(a) * (r - 8));
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
  // Digital readout.
  ctx.fillStyle = PALETTE.hudText;
  ctx.font = 'bold 19px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(value)), x, y + r - 2);
  ctx.fillStyle = PALETTE.hudDim;
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText(label + ' ' + unit, x, y + r + 13);
  ctx.restore();
}

function compassStrip(ctx, world) {
  const cx = VIEW.width / 2;
  const y = 26;
  const heading = world.headingDeg();
  ctx.save();
  ctx.fillStyle = PALETTE.hudPanel;
  roundRect(ctx, cx - 260, 8, 520, 44, 10); ctx.fill();
  ctx.strokeStyle = PALETTE.hudEdge;
  ctx.lineWidth = 1.5;
  roundRect(ctx, cx - 260, 8, 520, 44, 10); ctx.stroke();
  // Tape: headings every 15 degrees across the window.
  ctx.save();
  ctx.beginPath(); ctx.rect(cx - 250, 12, 500, 36); ctx.clip();
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  for (let dh = -60; dh <= 60; dh += 15) {
    const h = ((heading + dh) % 360 + 360) % 360;
    const x = cx + dh * 4.1;
    const major = h % 45 === 0;
    ctx.strokeStyle = major ? PALETTE.hudText : 'rgba(185,196,214,0.6)';
    ctx.lineWidth = major ? 2.5 : 1.5;
    ctx.beginPath(); ctx.moveTo(x, 18); ctx.lineTo(x, major ? 30 : 26); ctx.stroke();
    if (major) {
      ctx.fillStyle = PALETTE.hudText;
      ctx.fillText(names[h] || String(h), x, 44);
    }
  }
  ctx.restore();
  // Centre caret + digital heading.
  ctx.fillStyle = PALETTE.ringGold;
  ctx.beginPath();
  ctx.moveTo(cx - 8, 8); ctx.lineTo(cx + 8, 8); ctx.lineTo(cx, 20); ctx.closePath(); ctx.fill();
  ctx.fillStyle = PALETTE.hudText;
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(String(heading).padStart(3, '0') + '°', cx, 66);
  ctx.restore();
}

// Call-to-action verb for a panel: touch players tap, desktop players press
// Enter. Screenshots (desktop) always show the Enter wording.
function cta(input) { return input && input.isTouch ? 'TAP' : 'PRESS ENTER'; }

function drawHud(ctx, world, audio, input) {
  const p = world.plane;
  // Compass.
  compassStrip(ctx, world);
  // Gauges, up in the top HUD band: their dials and labels end at y 108,
  // clear of the title panel's top edge (y 120) and of the mission banner.
  gauge(ctx, 78, 56, 36, 'ALT', p.alt, 9200, 'FT', '#ffd23d');
  gauge(ctx, 190, 56, 36, 'SPD', p.speed, 200, 'KT', '#7dd8ff');
  // Mission banner, top-left column under the gauges (skipped on the
  // title screen — the title panel says it). It used to sit top-centre,
  // in the middle of the forward view, on top of the rings.
  const mission = world.mission();
  if (world.screen !== 'title') {
    ctx.save();
    ctx.fillStyle = PALETTE.hudPanel;
    roundRect(ctx, 14, 118, 380, 62, 10); ctx.fill();
    ctx.strokeStyle = PALETTE.hudEdge;
    ctx.lineWidth = 1.5;
    roundRect(ctx, 14, 118, 380, 62, 10); ctx.stroke();
    ctx.fillStyle = PALETTE.ringGold;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`DAY ${mission.day}  ·  DELIVERY ${mission.id} / 6`, 28, 140);
    ctx.fillStyle = PALETTE.hudText;
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText(`${mission.from}  →  ${mission.to}`, 28, 162);
    ctx.fillStyle = PALETTE.hudDim;
    ctx.font = '12px sans-serif';
    ctx.fillText(`Cargo: ${mission.cargo}   ·   Wind ${Math.round(mission.wind * 100)}%`, 28, 176);
    // Ring progress dots, top-right inside the banner.
    for (let i = 0; i < world.rings.length; i += 1) {
      const r = world.rings[i];
      ctx.fillStyle = r.hit ? PALETTE.ringGold : r.missed ? '#5a6478' : 'rgba(255,246,221,0.4)';
      ctx.beginPath(); ctx.arc(384 - (world.rings.length - 1 - i) * 18, 140, 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // Fuel + hull + score, top right.
  ctx.save();
  ctx.fillStyle = PALETTE.hudPanel;
  roundRect(ctx, 1010, 14, 256, 110, 10); ctx.fill();
  ctx.strokeStyle = PALETTE.hudEdge;
  ctx.lineWidth = 1.5;
  roundRect(ctx, 1010, 14, 256, 110, 10); ctx.stroke();
  const lowFuel = world.fuel < 25;
  ctx.fillStyle = lowFuel && Math.sin(world.time * 8) > 0 ? PALETTE.danger : PALETTE.hudText;
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(lowFuel ? '⚠ FUEL LOW' : 'FUEL', 1024, 36);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  roundRect(ctx, 1024, 44, 228, 14, 7); ctx.fill();
  ctx.fillStyle = world.fuel > 50 ? PALETTE.ok : world.fuel > 25 ? PALETTE.ringGold : PALETTE.danger;
  roundRect(ctx, 1024, 44, 228 * clamp(world.fuel / 100, 0, 1), 14, 7); ctx.fill();
  ctx.fillStyle = PALETTE.hudText;
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(Math.round(world.fuel) + '%', 1180, 36);
  // Hull hearts — one per hull point (six now, not three).
  ctx.font = '20px sans-serif';
  ctx.fillText('HULL', 1024, 84);
  const maxHull = world.maxHull || 6;
  for (let i = 0; i < maxHull; i += 1) {
    ctx.fillStyle = i < world.hull ? '#ff5a6e' : 'rgba(255,255,255,0.22)';
    ctx.fillText('♥', 1080 + i * 22, 86);
  }
  ctx.fillStyle = world.cargo ? PALETTE.ok : PALETTE.hudDim;
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(world.cargo ? '▣ CARGO ON BOARD' : '○ CARGO: FLY 3 RINGS', 1024, 108);
  // Score block.
  ctx.fillStyle = PALETTE.hudText;
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('SCORE ' + world.score.toLocaleString(), 1252, 148);
  if (world.combo > 1) {
    ctx.fillStyle = PALETTE.ringGold;
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('COMBO ×' + world.combo, 1252, 170);
  }
  ctx.restore();
  // Throttle bar, bottom left, and controls hint, bottom right: both end
  // at y 694, a clean 26px above the frame edge, and clear of the title
  // panel (bottom 590) and of the DOM touch buttons above them.
  ctx.save();
  ctx.fillStyle = PALETTE.hudPanel;
  roundRect(ctx, 14, 636, 240, 58, 10); ctx.fill();
  ctx.strokeStyle = PALETTE.hudEdge;
  ctx.lineWidth = 1.5;
  roundRect(ctx, 14, 636, 240, 58, 10); ctx.stroke();
  ctx.fillStyle = PALETTE.hudText;
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('THROTTLE  ' + Math.round(p.throttle * 100) + '%', 28, 658);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  roundRect(ctx, 28, 666, 212, 12, 6); ctx.fill();
  ctx.fillStyle = '#7dd8ff';
  roundRect(ctx, 28, 666, 212 * p.throttle, 12, 6); ctx.fill();
  ctx.restore();
  // Controls hint, bottom right: touch hints on touch devices, never
  // keyboard-only instructions on a phone.
  ctx.save();
  ctx.fillStyle = 'rgba(12, 18, 38, 0.55)';
  roundRect(ctx, 880, 664, 386, 30, 8); ctx.fill();
  ctx.fillStyle = PALETTE.hudDim;
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    input && input.isTouch
      ? 'Drag to steer · hold THR / CLIMB buttons · ⏸ pause · 🔊 mute'
      : 'A/D steer · W/S throttle · ↑/↓ climb · P pause · M ' + (audio && audio.muted ? 'unmute' : 'mute'),
    1073, 683);
  ctx.restore();
  // Floating message — one line at a time, on a dark pill in the
  // top-left column under the mission banner, so it reads over the sky
  // at the edge instead of the rings. It used to sit centred at y 190,
  // in the middle of the forward view. The font shrinks for long
  // messages so the pill never reaches past the banner's right edge
  // (x 394) into the forward corridor. Only the head of the queue is
  // drawn, and only while flying: on the delivered / over / complete
  // panels the message would sit half-hidden behind the panel (it
  // freezes when play stops).
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  if ((world.screen === 'play' || world.screen === 'takeoff') && world.messages.length > 0) {
    const m = world.messages[0];
    const alpha = clamp(1 - m.t / 2.2, 0, 1);
    let fontPx = 21;
    ctx.font = `bold ${fontPx}px sans-serif`;
    let w = ctx.measureText(m.text).width + 28;
    while (w > 380 && fontPx > 15) {
      fontPx -= 1;
      ctx.font = `bold ${fontPx}px sans-serif`;
      w = ctx.measureText(m.text).width + 28;
    }
    ctx.globalAlpha = alpha * 0.78;
    ctx.fillStyle = 'rgba(10, 14, 30, 0.85)';
    roundRect(ctx, 14, 192, w, 32, 9);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = m.color;
    ctx.fillText(m.text, 28, 209);
  }
  ctx.restore();
  // Damage flash.
  if (world.flash > 0) {
    ctx.fillStyle = `rgba(255, 60, 40, ${world.flash * 0.28})`;
    ctx.fillRect(-(VIEW.ox || 0) - 8, -(VIEW.oy || 0) - 8, VIEW.width + 2 * (VIEW.ox || 0) + 16, VIEW.height + 2 * (VIEW.oy || 0) + 16);
  }
}

function panel(ctx, x, y, w, h, alpha) {
  ctx.fillStyle = `rgba(10, 14, 30, ${alpha ?? 0.82})`;
  roundRect(ctx, x, y, w, h, 16); ctx.fill();
  ctx.strokeStyle = PALETTE.hudEdge;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 16); ctx.stroke();
}

// The game's own seaplane, side-on, small, for the glass showcase on the
// title card. Same cream/red/teal plane as in flight, drawn from scratch
// here at showcase scale — no copied art, no images.
function drawShowcasePlane(ctx, cx, cy, time) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(0.62, 0.62);
  // Pontoons + struts.
  ctx.fillStyle = PALETTE.planeTeal;
  roundRect(ctx, -118, 58, 96, 16, 7); ctx.fill();
  roundRect(ctx, 22, 58, 96, 16, 7); ctx.fill();
  ctx.fillStyle = PALETTE.planeDark;
  ctx.fillRect(-86, 34, 8, 26); ctx.fillRect(78, 34, 8, 26);
  // Tail.
  ctx.fillStyle = PALETTE.planeRed;
  ctx.beginPath();
  ctx.moveTo(-138, -6); ctx.lineTo(-172, -52); ctx.lineTo(-146, -56); ctx.lineTo(-118, -10);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = PALETTE.planeCream;
  ctx.beginPath();
  ctx.moveTo(-138, 6); ctx.lineTo(-168, 30); ctx.lineTo(-142, 34); ctx.lineTo(-118, 10);
  ctx.closePath(); ctx.fill();
  // Fuselage + red cheatline.
  ctx.fillStyle = PALETTE.planeCream;
  ctx.beginPath(); ctx.ellipse(0, 0, 148, 30, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PALETTE.planeRed;
  ctx.beginPath(); ctx.ellipse(0, 8, 146, 9, 0, 0, Math.PI); ctx.fill();
  ctx.fillRect(-146, 4, 292, 7);
  // Lit cockpit windows + registration.
  ctx.fillStyle = '#ffd98a';
  ctx.beginPath(); ctx.ellipse(96, -12, 22, 11, -0.12, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(66, -15, 18, 10, -0.08, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b2b33';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PK-VSC', -30, -6);
  // Upper wing.
  ctx.fillStyle = PALETTE.planeRed;
  ctx.beginPath();
  ctx.moveTo(-52, -26); ctx.lineTo(52, -26); ctx.lineTo(30, -58); ctx.lineTo(-30, -58);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(-30, -58, 60, 6);
  // Propeller: faint disc + two spinning blades.
  ctx.save();
  ctx.translate(152, 0);
  ctx.fillStyle = 'rgba(43, 43, 51, 0.18)';
  ctx.beginPath(); ctx.arc(0, 0, 52, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(time * 42);
  ctx.fillStyle = 'rgba(43, 43, 51, 0.85)';
  roundRect(ctx, -4, -52, 8, 104, 4); ctx.fill();
  ctx.rotate(Math.PI / 2);
  roundRect(ctx, -4, -52, 8, 104, 4); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#2b2b33';
  ctx.beginPath(); ctx.arc(152, 0, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff5a4a';
  ctx.beginPath(); ctx.arc(-148, 0, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7dff9a';
  ctx.beginPath(); ctx.arc(148, -4, 5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawSettingsButton(ctx, r) {
  ctx.save();
  ctx.fillStyle = '#d9a06b';
  roundRect(ctx, r.x, r.y, r.w, r.h, 18); ctx.fill();
  ctx.fillStyle = '#4b2e23';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SETTINGS', r.x + r.w / 2, r.y + 23);
  ctx.restore();
}

function drawTitle(ctx, world, input, ui) {
  // Warm dark-brown card (reference look), fully opaque: a faint scrim
  // keeps the map readable behind it, but nothing shows through the card.
  // No info rows at all — no Pilot, Aircraft, Status, Last Flight, Cargo.
  ctx.fillStyle = 'rgba(10, 14, 30, 0.10)';
  ctx.fillRect(-(VIEW.ox || 0) - 8, -(VIEW.oy || 0) - 8, VIEW.width + 2 * (VIEW.ox || 0) + 16, VIEW.height + 2 * (VIEW.oy || 0) + 16);
  ctx.fillStyle = 'rgba(30, 16, 10, 0.35)';
  roundRect(ctx, TITLE_PANEL.x + 3, TITLE_PANEL.y + 8, TITLE_PANEL.w, TITLE_PANEL.h, 24); ctx.fill();
  ctx.fillStyle = '#4b2e23';
  roundRect(ctx, TITLE_PANEL.x, TITLE_PANEL.y, TITLE_PANEL.w, TITLE_PANEL.h, 24); ctx.fill();
  ctx.strokeStyle = '#7a4a34';
  ctx.lineWidth = 3;
  roundRect(ctx, TITLE_PANEL.x, TITLE_PANEL.y, TITLE_PANEL.w, TITLE_PANEL.h, 24); ctx.stroke();
  drawSettingsButton(ctx, GEAR_RECT);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8cfae';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('MAKE.FUN  ·  BEST FLIGHT GAME', 84, 158);
  ctx.fillStyle = '#f7dcb0';
  ctx.font = 'bold 46px sans-serif';
  ctx.fillText('VOLCANO', 82, 206);
  ctx.fillText('SKY COURIER', 82, 252);
  ctx.fillStyle = '#d9b48f';
  ctx.font = '17px sans-serif';
  ctx.fillText('6 deliveries  ·  3 days', 84, 286);
  // Glass showcase: dark case, shelf, the seaplane, glass shine.
  const caseX = 84, caseY = 304, caseW = 464, caseH = 148;
  ctx.fillStyle = '#33383f';
  roundRect(ctx, caseX, caseY, caseW, caseH, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 2;
  roundRect(ctx, caseX, caseY, caseW, caseH, 12); ctx.stroke();
  // Little crate stack on the shelf, bottom-left of the case.
  ctx.fillStyle = '#6b4a2e';
  ctx.fillRect(108, 420, 44, 18);
  ctx.fillStyle = '#7d5a38';
  ctx.fillRect(112, 404, 36, 16);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fillRect(108, 436, 44, 3);
  drawShowcasePlane(ctx, 316, 378, world.time);
  // Glass shine, clipped to the case.
  ctx.save();
  roundRect(ctx, caseX, caseY, caseW, caseH, 12);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.beginPath();
  ctx.moveTo(caseX + 120, caseY); ctx.lineTo(caseX + 220, caseY);
  ctx.lineTo(caseX + 120, caseY + caseH); ctx.lineTo(caseX + 40, caseY + caseH);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  // One tan pill for the call to action.
  const ctaText = input && input.isTouch ? '▶  TAP TO FLY' : '▶  PRESS ENTER OR CLICK TO FLY';
  ctx.font = 'bold 18px sans-serif';
  const pillW = Math.min(ctx.measureText(ctaText).width + 48, 464);
  const pillX = TITLE_PANEL.x + (TITLE_PANEL.w - pillW) / 2;
  CTA_RECT = { x: pillX, y: 474, w: pillW, h: 50 };
  ctx.fillStyle = '#d9a06b';
  roundRect(ctx, pillX, 474, pillW, 50, 25); ctx.fill();
  ctx.fillStyle = '#4b2e23';
  ctx.fillText(ctaText, pillX + (pillW - ctx.measureText(ctaText).width) / 2, 505);
  ctx.restore();
  if (ui && ui.settingsOpen) drawSettingsPanel(ctx, ui.settings);
}

function drawToggle(ctx, r, on, label) {
  ctx.fillStyle = on ? '#7fa36b' : '#6b5a4e';
  roundRect(ctx, r.x, r.y, r.w, r.h, 18); ctx.fill();
  ctx.strokeStyle = 'rgba(247, 220, 176, 0.6)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, r.x, r.y, r.w, r.h, 18); ctx.stroke();
  const knobX = on ? r.x + r.w - 20 : r.x + 20;
  ctx.fillStyle = '#fff9e8';
  ctx.beginPath(); ctx.arc(knobX, r.y + r.h / 2, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f7dcb0';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(on ? 'ON' : 'OFF', on ? r.x + 26 : r.x + r.w - 26, r.y + r.h / 2 + 4);
  ctx.textAlign = 'left';
}

function drawSettingsPanel(ctx, settings) {
  const p = SETTINGS_PANEL;
  ctx.save();
  ctx.fillStyle = 'rgba(30, 16, 10, 0.35)';
  roundRect(ctx, p.x + 3, p.y + 6, p.w, p.h, 18); ctx.fill();
  ctx.fillStyle = '#4b2e23';
  roundRect(ctx, p.x, p.y, p.w, p.h, 18); ctx.fill();
  ctx.strokeStyle = '#7a4a34';
  ctx.lineWidth = 2.5;
  roundRect(ctx, p.x, p.y, p.w, p.h, 18); ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f7dcb0';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('SETTINGS', p.x + 24, p.y + 38);
  // X close button.
  ctx.fillStyle = '#6b4232';
  ctx.beginPath(); ctx.arc(SETTINGS_CLOSE.x + 16, SETTINGS_CLOSE.y + 16, 15, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#e8cfae';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(SETTINGS_CLOSE.x + 16, SETTINGS_CLOSE.y + 16, 15, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#e8cfae';
  ctx.beginPath();
  ctx.moveTo(SETTINGS_CLOSE.x + 10, SETTINGS_CLOSE.y + 10);
  ctx.lineTo(SETTINGS_CLOSE.x + 22, SETTINGS_CLOSE.y + 22);
  ctx.moveTo(SETTINGS_CLOSE.x + 22, SETTINGS_CLOSE.y + 10);
  ctx.lineTo(SETTINGS_CLOSE.x + 10, SETTINGS_CLOSE.y + 22);
  ctx.stroke();
  // Rows.
  ctx.fillStyle = '#e8cfae';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('Music', p.x + 24, MUSIC_TOGGLE.y + 24);
  drawToggle(ctx, MUSIC_TOGGLE, !!settings.music);
  ctx.fillText('Sound FX', p.x + 24, SFX_TOGGLE.y + 24);
  drawToggle(ctx, SFX_TOGGLE, !!settings.sfx);
  ctx.fillText('Quality', p.x + 24, QUALITY_LOW.y + 24);
  const q = settings.quality || 'high';
  const btn = (r, text, active) => {
    ctx.fillStyle = active ? '#d9a06b' : 'rgba(255, 255, 255, 0.12)';
    roundRect(ctx, r.x, r.y, r.w, r.h, 10); ctx.fill();
    ctx.strokeStyle = active ? '#d9a06b' : 'rgba(247, 220, 176, 0.5)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, r.x, r.y, r.w, r.h, 10); ctx.stroke();
    ctx.fillStyle = active ? '#4b2e23' : '#f7dcb0';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, r.x + r.w / 2, r.y + 23);
    ctx.textAlign = 'left';
  };
  btn(QUALITY_LOW, 'LOW', q === 'low');
  btn(QUALITY_HIGH, 'HIGH', q === 'high');
  ctx.fillStyle = '#b99a7a';
  ctx.font = '12px sans-serif';
  ctx.fillText('Applies instantly · saved on this device', p.x + 24, p.y + 268);
  ctx.restore();
}

function drawPaused(ctx, input) {
  ctx.fillStyle = 'rgba(10, 14, 30, 0.6)';
  ctx.fillRect(-(VIEW.ox || 0) - 8, -(VIEW.oy || 0) - 8, VIEW.width + 2 * (VIEW.ox || 0) + 16, VIEW.height + 2 * (VIEW.oy || 0) + 16);
  panel(ctx, 440, 250, 400, 200);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.hudText;
  ctx.font = 'bold 38px sans-serif';
  ctx.fillText('PAUSED', 640, 322);
  ctx.fillStyle = PALETTE.hudDim;
  ctx.font = '16px sans-serif';
  ctx.fillText(input && input.isTouch ? 'Tap ▶ or tap anywhere to keep flying' : 'Press P or click to keep flying', 640, 360);
  ctx.fillText('M mute  ·  R restart run', 640, 390);
  ctx.restore();
}

function drawDelivered(ctx, world, input) {
  ctx.fillStyle = 'rgba(10, 14, 30, 0.45)';
  ctx.fillRect(-(VIEW.ox || 0) - 8, -(VIEW.oy || 0) - 8, VIEW.width + 2 * (VIEW.ox || 0) + 16, VIEW.height + 2 * (VIEW.oy || 0) + 16);
  panel(ctx, 360, 190, 560, 330);
  const m = world.mission();
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.ok;
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText('✓ DELIVERED!', 640, 252);
  ctx.fillStyle = PALETTE.hudText;
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`${m.cargo} → ${m.to}`, 640, 292);
  if (world.landing) {
    ctx.font = 'bold 19px sans-serif';
    ctx.fillStyle = world.landing.grade === 'CLEAN' ? PALETTE.ok : world.landing.grade === 'FIRM' ? PALETTE.ringGold : PALETTE.danger;
    ctx.fillText(`Touchdown ${world.landing.speed} kt · ${world.landing.grade} · +${world.landing.pts}`, 640, 324);
  }
  ctx.font = '17px sans-serif';
  ctx.fillStyle = PALETTE.hudDim;
  ctx.fillText(`Rings ${world.ringsHit}/${world.rings.length}  ·  Best combo ×${world.bestCombo}`, 640, 354);
  ctx.fillText(`Deliveries ${world.deliveries}/6  ·  Score ${world.score.toLocaleString()}`, 640, 382);
  ctx.fillStyle = PALETTE.ringGold;
  ctx.font = 'bold 19px sans-serif';
  ctx.fillText(world.missionIndex + 1 >= MISSIONS.length ? `▶  ${cta(input)} — FINISH THE TOUR` : `▶  ${cta(input)} — NEXT DELIVERY`, 640, 412);
  ctx.fillStyle = PALETTE.hudDim;
  ctx.font = '14px sans-serif';
  ctx.fillText('Fuel topped up · hull patched · the next island is waiting', 640, 448);
  ctx.restore();
}

function drawOver(ctx, world, input) {
  ctx.fillStyle = 'rgba(30, 8, 10, 0.55)';
  ctx.fillRect(-(VIEW.ox || 0) - 8, -(VIEW.oy || 0) - 8, VIEW.width + 2 * (VIEW.ox || 0) + 16, VIEW.height + 2 * (VIEW.oy || 0) + 16);
  panel(ctx, 360, 200, 560, 320);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.danger;
  ctx.font = 'bold 38px sans-serif';
  ctx.fillText('✕ SORTIE LOST', 640, 268);
  ctx.fillStyle = PALETTE.hudText;
  ctx.font = '18px sans-serif';
  ctx.fillText(world.deathCause || 'The courier is down — but the mail must go through.', 640, 308);
  ctx.font = '17px sans-serif';
  ctx.fillStyle = PALETTE.hudDim;
  ctx.fillText(`Score ${world.score.toLocaleString()}  ·  Deliveries ${world.deliveries}/6  ·  Rings ${world.ringsHit}`, 640, 342);
  ctx.fillStyle = PALETTE.ringGold;
  ctx.font = 'bold 19px sans-serif';
  ctx.fillText(`▶  ${cta(input)} — FLY AGAIN`, 640, 404);
  ctx.fillStyle = PALETTE.hudDim;
  ctx.font = '14px sans-serif';
  ctx.fillText('Tip: green rings are fuel. Ash clouds cost a hull. Volcanoes are lethal — steer clear.', 640, 440);
  ctx.restore();
}

function drawComplete(ctx, world, input) {
  ctx.fillStyle = 'rgba(10, 14, 30, 0.5)';
  ctx.fillRect(-(VIEW.ox || 0) - 8, -(VIEW.oy || 0) - 8, VIEW.width + 2 * (VIEW.ox || 0) + 16, VIEW.height + 2 * (VIEW.oy || 0) + 16);
  panel(ctx, 330, 170, 620, 360);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.ringGold;
  ctx.font = 'bold 38px sans-serif';
  ctx.fillText('★ TOUR COMPLETE ★', 640, 238);
  ctx.fillStyle = PALETTE.hudText;
  ctx.font = '19px sans-serif';
  ctx.fillText('All six deliveries flown across the archipelago.', 640, 282);
  ctx.fillText(`Perfect runs: ${world.perfectRuns}  ·  Best combo ×${world.bestCombo}`, 640, 314);
  ctx.fillStyle = PALETTE.ringGold;
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('FINAL SCORE  ' + world.score.toLocaleString(), 640, 368);
  ctx.fillStyle = PALETTE.hudText;
  ctx.font = 'bold 19px sans-serif';
  ctx.fillText(`▶  ${cta(input)} — FLY THE TOUR AGAIN`, 640, 428);
  ctx.fillStyle = PALETTE.hudDim;
  ctx.font = '14px sans-serif';
  ctx.fillText('Volcano Sky Courier — thank you for flying with us.', 640, 464);
  ctx.restore();
}

export function render(ctx, world, audio, input, ui) {
  QUALITY = (ui && ui.settings && ui.settings.quality) || 'high';
  ctx.save();
  if (world.shake > 0) {
    ctx.translate((Math.random() - 0.5) * world.shake * 14, (Math.random() - 0.5) * world.shake * 14);
  }
  // On the title screen, world labels, rings and hazards that would sit
  // behind the menu panel are hidden (see TITLE_PANEL above).
  const onTitle = world.screen === 'title';
  drawSky(ctx, world);
  drawSea(ctx, world);
  // Ring/hazard screen circles for the label layer: labels must stay off
  // them, so they are computed before anything is drawn.
  const circles = [];
  // Off-screen rings / hazards are left out here too: they are not drawn,
  // so they must not block a label from its place either.
  for (const o of world.rings) {
    if (o.hit || ringDepth(o.z) <= 0.02) continue;
    const c = ringCircle(world, o, false);
    if (!offscreen(c.x, c.y, c.r + 28)) circles.push(c);
  }
  for (const o of world.fuelRings) {
    if (o.taken || ringDepth(o.z) <= 0.02) continue;
    const c = ringCircle(world, o, true);
    if (!offscreen(c.x, c.y, c.r + 28)) circles.push(c);
  }
  for (const hz of world.hazards) {
    if (hz.hit || ringDepth(hz.z) <= 0.02) continue;
    const d = ringDepth(hz.z);
    const c = { x: laneXAt(world, hz.x, d), y: airYAt(world, hz.alt, d), r: (30 + d * 130) * hz.r * 4 };
    if (!offscreen(c.x, c.y, c.r * 1.35 + 8)) circles.push(c);
  }
  const labels = makeLabelLayer(ctx, circles, [planeBox(world)]);
  // Islands far to near so near ones overlap far ones.
  const sorted = [...world.islands].sort((a, b) => b.z - a.z);
  for (const isl of sorted) drawIsland(ctx, world, isl, onTitle, labels);
  drawStrip(ctx, world, onTitle, null, null, labels);
  // On takeoff the plane is still on the home runway: draw the departure
  // strip under it (it scrolls past as the plane accelerates).
  if (world.screen === 'takeoff' && world.homeStripZ != null && world.homeStripZ > 0.02) {
    drawStrip(ctx, world, onTitle, { z: world.homeStripZ }, '▸ ' + world.mission().from.toUpperCase(), labels);
  }
  // Rings, fuel rings and hazards together, far to near: a near ring now
  // always draws over a far one instead of the two piling into one blob.
  const course = [
    ...world.hazards.map((o) => ({ o, hz: true })),
    ...world.fuelRings.map((o) => ({ o, fuel: true })),
    ...world.rings.map((o) => ({ o })),
  ].sort((a, b) => b.o.z - a.o.z);
  for (const item of course) {
    if (item.hz) drawHazard(ctx, world, item.o, onTitle, labels);
    else drawRing(ctx, world, item.o, !!item.fuel, onTitle);
  }
  // Guide line to the next ring, under the rings and the plane.
  drawGuideLine(ctx, world);
  // Particles behind the plane (off on Low quality).
  for (const pt of world.particles) {
    if (QUALITY === 'low') break;
    // Viewport culling: spray that has drifted off frame is not drawn.
    if (offscreen(pt.x, pt.y, pt.size + 2)) continue;
    ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  drawPlane(ctx, world);
  // World labels last, above the scenery and the rings but below the HUD,
  // placed in one pass so they never overlap each other, a ring, a hazard,
  // a HUD panel, or the frame edge.
  labels.placeAll();
  drawHud(ctx, world, audio, input);
  if (world.screen === 'title') drawTitle(ctx, world, input, ui);
  else if (world.screen === 'paused') drawPaused(ctx, input);
  else if (world.screen === 'delivered') drawDelivered(ctx, world, input);
  else if (world.screen === 'over') drawOver(ctx, world, input);
  else if (world.screen === 'complete') drawComplete(ctx, world, input);
  ctx.restore();
}
