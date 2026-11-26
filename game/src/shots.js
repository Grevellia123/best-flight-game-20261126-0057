// Deterministic screenshot scenes behind ?shot=start|play|deliver|end.
// Each scene plays the real rules forward from a fresh world for a fixed
// number of steps, steered by the autopilot, so the frame is what a short
// game really looks like and the same seed always gives the same frame.

import { STEP } from './config.js';
import { autopilotInput } from './world.js';

const SAMPLE = STEP;

// Fly the world forward for `seconds` using the autopilot. Returns false if
// the run ended (delivered / over) before the time ran out.
function flyFor(world, seconds, audio) {
  const steps = Math.floor(seconds / SAMPLE);
  for (let i = 0; i < steps; i += 1) {
    if (world.screen !== 'play') return false;
    world.step(SAMPLE, autopilotInput(world), audio);
  }
  return world.screen === 'play';
}

// Stage `world` into the named scene and return the screen to draw.
// start: title over the golden-hour lagoon, runway and first rings ahead.
// play: mid-flight, rings hit, cargo on board, next ring dead ahead.
// deliver: final approach — low over the water, strip and last ring ahead.
// end: the delivery is complete, score panel over the sunset scene.
export function stageShot(name, world, audio) {
  const shot = (name || 'start').toLowerCase();
  world.reset(0, false);
  if (shot === 'start') {
    world.screen = 'title';
    world.time = 4;
    // Let the sea glitter and clouds drift a little so the title frame lives.
    for (let i = 0; i < 4 / SAMPLE; i += 1) world.time += SAMPLE;
    return 'title';
  }
  world.screen = 'play';
  if (shot === 'play') {
    // Mid-route: a couple of rings banked, the next ring dead ahead.
    flyFor(world, 3.5, audio);
    // Nudge the next ring into the centre of the frame for the shot.
    // The ring sits at the plane's altitude, so it frames the plane.
    const ring = world.nextRing();
    if (ring) { ring.z = 0.42; ring.x = world.plane.x + 0.05; ring.alt = world.plane.alt; }
    // One trailing ring, far right and further out, so it reads as the
    // route ahead; the rest are pushed beyond the draw range. With the
    // gentler ring projection the follows no longer shrink to dots at
    // the horizon, so leaving them at 0.68+ would pile them onto the
    // next ring in the staged frame.
    let follow = 0;
    for (const r of world.rings) {
      if (r.hit || r.missed || r === ring) continue;
      if (follow === 0) { r.z = 1.3; r.x = 0.55; r.alt = world.plane.alt; }
      else r.z = 2.6;
      follow += 1;
    }
    // One fuel ring, far left and higher, clear of the next ring; the
    // other fuel rings and the ash clouds are hidden in the staged
    // frame, or they pile onto the rings too.
    const fuel = world.fuelRings.find((f) => !f.taken);
    if (fuel) { fuel.z = 0.9; fuel.x = world.plane.x - 0.75; fuel.alt = world.plane.alt + 1500; }
    for (const f of world.fuelRings) { if (f !== fuel) f.taken = true; }
    for (const hz of world.hazards) hz.hit = true;
    return 'play';
  }
  if (shot === 'deliver') {
    // Fly until the last ring is ahead, then set up the final approach:
    // low over the water, last ring then the lit strip big in frame.
    flyFor(world, 4, audio);
    world.messages = [];
    const ring = world.nextRing();
    if (ring) { ring.z = 0.42; ring.x = 0.02; ring.alt = world.plane.alt; }
    // Only the last ring shows: the rest of the route, the fuel rings
    // and the ash clouds are hidden in the staged frame, or they pile
    // onto the ring and bury the strip.
    for (const r of world.rings) { if (r !== ring && !r.hit) r.z = 2.6; }
    for (const f of world.fuelRings) f.taken = true;
    for (const hz of world.hazards) hz.hit = true;
    world.plane.alt = 1050;
    world.plane.x = 0;
    world.cargo = true;
    if (world.strip) world.strip.z = 0.12; // close enough that the lit runway shows under the plane
    world.addMessage('FINAL APPROACH — line up with the strip', '#ffd23d');
    return 'play';
  }
  // end: complete a delivery, then show the delivered panel.
  flyFor(world, 30, audio);
  if (world.screen === 'play') {
    // Force the happy ending deterministically: land the cargo.
    world.rings.forEach((r) => { if (!r.hit && !r.missed) { r.hit = true; world.ringsHit += 1; } });
    world.cargo = true;
    world.score += 500;
    world.deliveries = 1;
    world.screen = 'delivered';
  }
  return world.screen;
}
