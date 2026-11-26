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
    // Nudge the next ring into the centre of the frame for the shot, and
    // push the rings after it further out so they trail instead of piling up.
    const ring = world.nextRing();
    if (ring) { ring.z = 0.42; ring.x = world.plane.x + 0.05; ring.alt = world.plane.alt + 350; }
    let follow = 0;
    for (const r of world.rings) {
      if (r.hit || r.missed || r === ring) continue;
      r.z = Math.max(r.z, 0.68 + follow * 0.16);
      follow += 1;
    }
    const fuel = world.fuelRings.find((f) => !f.taken);
    if (fuel) { fuel.z = 0.62; fuel.x = world.plane.x - 0.45; fuel.alt = world.plane.alt + 900; }
    return 'play';
  }
  if (shot === 'deliver') {
    // Fly until the last ring is ahead, then set up the final approach:
    // low over the water, last ring then the lit strip big in frame.
    flyFor(world, 4, audio);
    world.messages = [];
    const ring = world.nextRing();
    if (ring) { ring.z = 0.42; ring.x = 0.02; ring.alt = 1150; }
    world.plane.alt = 1050;
    world.plane.x = 0;
    world.cargo = true;
    if (world.strip) world.strip.z = 0.30;
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
