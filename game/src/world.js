// Volcano Sky Courier — flight model and mission rules.
// The plane flies a corridor over the archipelago: rings lead the way, cargo
// is picked up mid-route, and the run ends with a low pass over the island
// strip. Fuel, hull and wind turn each sortie into decisions.

import { FLIGHT, MISSIONS, SCORES, ISLANDS } from './config.js';
import { makeRng, range } from './random.js';

export const EVENT_NONE = 0;
export const EVENT_RING = 1;
export const EVENT_CARGO = 2;
export const EVENT_DELIVERED = 4;
export const EVENT_DAMAGE = 8;
export const EVENT_OVER = 16;
export const EVENT_FUEL = 32;

const RING_SPACING = 0.16; // z-distance between rings (z runs 1 far -> 0 here)
const STRIP_LENGTH = 0.5;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function createWorld(seed = 1) {
  const world = {
    seed,
    rng: makeRng(seed),
    time: 0,
    screen: 'title',
    missionIndex: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    deliveries: 0,
    perfectRuns: 0,
    plane: { x: 0, alt: 2400, heading: 0, throttle: 0.55, bank: 0, pitch: 0, speed: FLIGHT.cruiseSpeed },
    fuel: FLIGHT.startFuel,
    hull: FLIGHT.startHull,
    rings: [],
    fuelRings: [],
    hazards: [],
    islands: [],
    strip: null,
    cargo: false,
    ringsHit: 0,
    ringsMissed: 0,
    shake: 0,
    messages: [],
    particles: [],
    distance: 0,
    speedLines: 0,
    wind: 0.1,
    flash: 0,

    mission() { return MISSIONS[this.missionIndex % MISSIONS.length]; },

    reset(missionIndex = 0, keepScore = false) {
      this.missionIndex = missionIndex;
      if (!keepScore) { this.score = 0; this.deliveries = 0; this.perfectRuns = 0; }
      this.combo = 0;
      this.bestCombo = 0;
      this.ringsHit = 0;
      this.ringsMissed = 0;
      this.cargo = false;
      this.fuel = FLIGHT.startFuel;
      this.hull = FLIGHT.startHull;
      this.time = 0;
      this.distance = 0;
      this.shake = 0;
      this.flash = 0;
      this.messages = [];
      this.particles = [];
      this.plane = { x: 0, alt: 2400, heading: 0, throttle: 0.55, bank: 0, pitch: 0, speed: FLIGHT.cruiseSpeed };
      this.wind = this.mission().wind;
      this.buildRoute();
      this.buildScenery();
    },

    buildRoute() {
      const rng = makeRng(this.seed * 1000 + this.missionIndex * 77 + 13);
      const mission = this.mission();
      this.rings = [];
      let rx = 0;
      let ra = 3200;
      for (let i = 0; i < mission.rings; i += 1) {
        rx = clamp(rx + range(rng, -0.55, 0.55), -0.85, 0.85);
        ra = clamp(ra + range(rng, -1600, 1600), 1200, 6800);
        this.rings.push({ x: rx, alt: ra, z: 0.55 + i * RING_SPACING, hit: false, missed: false, id: i });
      }
      this.fuelRings = [];
      for (let i = 0; i < 3; i += 1) {
        this.fuelRings.push({
          x: range(rng, -0.7, 0.7), alt: range(rng, 1800, 5200),
          z: 0.75 + i * 0.42 + range(rng, 0, 0.1), taken: false,
        });
      }
      this.hazards = [];
      for (let i = 0; i < 5; i += 1) {
        this.hazards.push({
          x: range(rng, -0.9, 0.9), alt: range(rng, 1500, 6000),
          z: 0.7 + i * 0.3 + range(rng, 0, 0.15), r: range(rng, 0.16, 0.24), hit: false,
        });
      }
      this.strip = { z: 0.55 + mission.rings * RING_SPACING + STRIP_LENGTH, landed: false };
    },

    buildScenery() {
      const rng = makeRng(this.seed * 31 + this.missionIndex * 7 + 5);
      // Shuffle the island table so names never repeat side by side.
      const table = [...ISLANDS];
      for (let i = table.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [table[i], table[j]] = [table[j], table[i]];
      }
      this.islands = [];
      for (let i = 0; i < 14; i += 1) {
        const kind = table[i % table.length];
        this.islands.push({
          kind: kind.kind, name: kind.name, hue: kind.hue,
          x: range(rng, -1.6, 1.6), z: 0.12 + i * 0.075, size: range(rng, 0.5, 1.15),
          seed: Math.floor(rng() * 10000),
        });
      }
    },

    nextRing() {
      for (const r of this.rings) if (!r.hit && !r.missed) return r;
      return null;
    },
    speedKt() { return Math.round(this.plane.speed); },
    altitudeFt() { return Math.round(this.plane.alt); },
    headingDeg() {
      let h = ((this.plane.heading * 180 / Math.PI) % 360 + 360) % 360;
      return Math.round(h);
    },
    progress01() {
      const total = this.rings.length;
      if (total === 0) return 0;
      return this.ringsHit / total;
    },

    addMessage(text, color) {
      this.messages.push({ text, color: color || '#fff6dd', t: 0 });
      if (this.messages.length > 4) this.messages.shift();
    },
    burst(x, y, color, n) {
      for (let i = 0; i < n; i += 1) {
        if (this.particles.length > 220) return;
        const a = Math.random() * Math.PI * 2;
        const s = 40 + Math.random() * 160;
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.7 + Math.random() * 0.5, t: 0, color, size: 2 + Math.random() * 4 });
      }
    },
    damage(amount, why) {
      this.hull -= amount;
      this.shake = 0.55;
      this.flash = 0.5;
      this.combo = 0;
      this.addMessage(why, '#ff5a4a');
      if (this.hull <= 0) { this.hull = 0; this.screen = 'over'; }
    },

    step(dt, input, audio) {
      if (this.screen !== 'play') return EVENT_NONE;
      this.time += dt;
      const p = this.plane;
      let events = EVENT_NONE;

      // Throttle and speed.
      p.throttle = clamp(p.throttle + input.throttleDelta() * dt * 0.45, 0, 1);
      const targetSpeed = FLIGHT.minSpeed + (FLIGHT.maxSpeed - FLIGHT.minSpeed) * p.throttle;
      p.speed += (targetSpeed - p.speed) * Math.min(1, dt * 0.8);
      const speed01 = (p.speed - FLIGHT.minSpeed) / (FLIGHT.maxSpeed - FLIGHT.minSpeed);

      // Steering, bank, heading and lateral drift. Wind shoves the plane.
      const steer = input.steer();
      p.bank += (steer * 0.6 - p.bank) * Math.min(1, dt * 6);
      p.heading += steer * FLIGHT.turnRate * dt * (0.55 + 0.45 * speed01);
      p.x += steer * dt * (0.55 + speed01 * 0.75) + this.wind * dt * 0.06 * Math.sin(this.time * 0.7);
      p.x = clamp(p.x, -1.12, 1.12);
      if ((p.x <= -1.11 || p.x >= 1.11) && Math.abs(steer) > 0.2) {
        this.addMessage('EDGE OF THE CORRIDOR — steer back!', '#ffb347');
      }

      // Climb and descend.
      const climb = input.climb();
      p.pitch += (climb * 0.22 - p.pitch) * Math.min(1, dt * 5);
      p.alt += climb * dt * 1900 - (p.throttle < 0.25 ? dt * 260 : 0);
      p.alt = clamp(p.alt, 380, FLIGHT.maxAltitude);

      // Fuel burn: faster and thirstier at full throttle.
      const burn = (FLIGHT.fuelBurn + (p.throttle > 0.8 ? FLIGHT.fuelBurnBoost : 0)) * dt;
      this.fuel = Math.max(0, this.fuel - burn);
      if (this.fuel <= 0) {
        p.throttle = Math.max(0, p.throttle - dt * 0.4);
        if (p.alt <= 520) { this.damage(3, 'OUT OF FUEL — ditched in the sea!'); return EVENT_OVER | EVENT_DAMAGE; }
      }

      // Forward motion: everything ahead comes closer.
      const advance = (p.speed / 140) * dt * 0.24;
      this.distance += p.speed * dt;
      for (const isl of this.islands) {
        isl.z -= advance * 0.55;
        if (isl.z < 0.02) { isl.z = 1.05; isl.x = (this.rng() * 3.2 - 1.6); }
      }
      const moveSet = (list) => { for (const o of list) o.z -= advance; };

      // Rings: pass through the centre for points and combo.
      for (const ring of this.rings) {
        if (ring.hit || ring.missed) continue;
        ring.z -= advance;
        if (ring.z <= 0) {
          const dx = Math.abs(ring.x - p.x);
          const da = Math.abs(ring.alt - p.alt);
          if (dx < 0.30 && da < 1500) {
            ring.hit = true;
            this.ringsHit += 1;
            this.combo += 1;
            this.bestCombo = Math.max(this.bestCombo, this.combo);
            const pts = SCORES.ring + (this.combo - 1) * SCORES.ringComboStep;
            this.score += pts;
            this.fuel = Math.min(100, this.fuel + 2);
            this.addMessage(`RING +${pts}${this.combo > 1 ? '  ×' + this.combo + ' COMBO' : ''}`, '#ffd23d');
            this.burst(640, 330, '#ffd23d', 26);
            if (audio) audio.ring();
            events |= EVENT_RING;
            if (this.ringsHit === 3 && !this.cargo) {
              this.cargo = true;
              this.score += SCORES.cargoPickup;
              this.addMessage(`CARGO ON BOARD — ${this.mission().cargo.toUpperCase()} +${SCORES.cargoPickup}`, '#7dff9a');
              if (audio) audio.pickup();
              events |= EVENT_CARGO;
            }
          } else {
            ring.missed = true;
            this.ringsMissed += 1;
            this.combo = 0;
            this.addMessage('RING MISSED — combo lost', '#b9c4d6');
          }
        }
      }
      moveSet(this.fuelRings);
      for (const fr of this.fuelRings) {
        if (fr.taken) continue;
        if (fr.z <= 0) {
          if (Math.abs(fr.x - p.x) < 0.3 && Math.abs(fr.alt - p.alt) < 1500) {
            fr.taken = true;
            this.fuel = Math.min(100, this.fuel + SCORES.ringFuelBonus);
            this.score += SCORES.fuelRing;
            this.addMessage(`FUEL +${SCORES.ringFuelBonus}%  +${SCORES.fuelRing}`, '#7dff9a');
            if (audio) audio.pickup();
            events |= EVENT_FUEL;
          } else fr.taken = true;
        }
      }
      moveSet(this.hazards);
      for (const hz of this.hazards) {
        if (hz.hit) continue;
        if (hz.z <= 0.02 && hz.z > -0.05) {
          if (Math.abs(hz.x - p.x) < hz.r && Math.abs(hz.alt - p.alt) < 1400) {
            hz.hit = true;
            this.damage(1, 'ASH CLOUD! Hull -1');
            if (audio) audio.crash();
            events |= EVENT_DAMAGE;
          }
        }
        if (hz.z < -0.06) hz.hit = true;
      }

      // Sea-skimming too low is a wave strike.
      if (p.alt <= 400) {
        this.damage(1, 'WAVE STRIKE! Pull up!');
        p.alt = 900;
        if (audio) audio.crash();
        events |= EVENT_DAMAGE;
        if (this.screen !== 'play') return events;
      }

      // The island strip: land the cargo with a low pass.
      if (this.strip && !this.strip.landed) {
        this.strip.z -= advance;
        if (this.strip.z <= 0.02 && this.strip.z > -0.12) {
          if (this.cargo && this.ringsHit === this.rings.length && p.alt < 1600 && Math.abs(p.x) < 0.3) {
            this.strip.landed = true;
            this.deliveries += 1;
            let pts = SCORES.delivery;
            if (this.ringsMissed === 0) { pts += SCORES.perfectRunBonus; this.perfectRuns += 1; this.addMessage(`PERFECT RUN +${SCORES.perfectRunBonus}`, '#ffd23d'); }
            this.score += pts;
            this.addMessage(`DELIVERED TO ${this.mission().to.toUpperCase()} +${pts}`, '#7dff9a');
            this.burst(640, 420, '#7dff9a', 40);
            if (audio) audio.delivery();
            this.screen = 'delivered';
            events |= EVENT_DELIVERED;
          } else if (this.strip.z <= -0.1) {
            this.strip.z = 0.9; // loop the strip round for another attempt
            if (!this.cargo) this.addMessage('FLY THE RINGS FIRST — cargo is on the route', '#ffb347');
            else this.addMessage('TOO HIGH / OFF CENTRE — circle back for the strip', '#ffb347');
          }
        }
        if (this.strip.z < -0.12) this.strip.z = 0.95;
      }

      // Messages and particles age out.
      for (const m of this.messages) m.t += dt;
      this.messages = this.messages.filter((m) => m.t < 2.6);
      for (const pt of this.particles) { pt.t += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 120 * dt; }
      this.particles = this.particles.filter((pt) => pt.t < pt.life);
      this.shake = Math.max(0, this.shake - dt * 1.4);
      this.flash = Math.max(0, this.flash - dt * 1.2);
      this.speedLines = speed01;
      if (audio) audio.setThrottle(p.throttle, speed01);
      return events;
    },

    nextMission() {
      const next = this.missionIndex + 1;
      if (next >= MISSIONS.length) { this.screen = 'complete'; return; }
      this.reset(next, true);
      this.screen = 'play';
    },
  };
  return world;
}

// Autopilot used by the deterministic screenshot scenes: steer toward the
// next ring, climb toward its altitude, keep a healthy throttle.
export function autopilotInput(world) {
  const ring = world.nextRing();
  const p = world.plane;
  let steer = 0;
  let climb = 0;
  if (ring) {
    const dx = ring.x - p.x;
    steer = Math.max(-1, Math.min(1, dx * 2.2));
    const da = ring.alt - p.alt;
    climb = da > 250 ? 1 : da < -250 ? -1 : 0;
  } else if (world.strip) {
    steer = Math.max(-1, Math.min(1, (0 - p.x) * 2.2));
    climb = p.alt > 1100 ? -1 : p.alt < 700 ? 1 : 0;
  }
  return {
    steer: () => steer,
    climb: () => climb,
    throttleDelta: () => (p.throttle < 0.62 ? 1 : 0),
  };
}
