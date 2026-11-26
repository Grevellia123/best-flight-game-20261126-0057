// Volcano Sky Courier — flight model and mission rules.
// The plane flies a corridor over the archipelago: rings lead the way, cargo
// is picked up mid-route, and the run ends with a low pass over the island
// strip. Fuel, hull and wind turn each sortie into decisions.

import { FLIGHT, MISSIONS, SCORES, ISLANDS, HORIZON_Y, VIEW } from './config.js';
import { makeRng, range } from './random.js';

export const EVENT_NONE = 0;
export const EVENT_RING = 1;
export const EVENT_CARGO = 2;
export const EVENT_DELIVERED = 4;
export const EVENT_DAMAGE = 8;
export const EVENT_OVER = 16;
export const EVENT_FUEL = 32;

const RING_SPACING = 0.7; // z-distance between rings (z runs 1 far -> 0 here)
const STRIP_LENGTH = 0.5;
const ADVANCE_RATE = 0.12; // z-units per second at 140 kt: a mission lasts ~40 s
const RESPAWN_Z = 0.55; // a missed ring comes back around this far ahead

// Scenery stays out of the centre corridor (|x| < 0.55), and volcanoes
// stay much further out (|x| >= 1.35): a volcano cone is 150*s wide at
// its base (314 px half-wide at the camera, size 1.15) and its screen
// position slides toward the plane as the plane steers, so the old 0.85
// still let a cone swallow the plane when the plane steered toward it.
// At 1.35 the cone clears the plane even at full steering lock, with
// margin — and volcanoGuard() below is the net for anything unexpected.
function sceneryX(rng, kind) {
  const min = kind === 'volcano' ? 1.35 : 0.55;
  const max = kind === 'volcano' ? 1.75 : 1.6;
  const sign = rng() < 0.5 ? -1 : 1;
  return sign * range(rng, min, max);
}

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
    plane: { x: 0, alt: 2400, heading: 0, throttle: 0.55, bank: 0, pitch: 0, speed: FLIGHT.cruiseSpeed, vs: 0 },
    fuel: FLIGHT.startFuel,
    hull: FLIGHT.startHull,
    maxHull: FLIGHT.maxHull,
    invuln: 0, // seconds of post-hit protection (wave strikes, ash)
    lift: 1, // takeoff lift 0 (on the water) -> 1 (airborne)
    landed: false, // sitting on the water after a touchdown
    homeStripZ: null, // the departure runway, drawn under the plane on takeoff
    approachWarned: false,
    lowWarned: false,
    ditched: false,
    landing: null, // { speed, alt, sink, grade, pts } of the last touchdown
    pausedFrom: null, // screen to return to when unpausing
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
      this.invuln = 0;
      this.lift = 1;
      this.landed = false;
      this.homeStripZ = null;
      this.approachWarned = false;
      this.lowWarned = false;
      this.ditched = false;
      this.landing = null;
      this.pausedFrom = null;
      this.time = 0;
      this.distance = 0;
      this.shake = 0;
      this.flash = 0;
      this.messages = [];
      this.particles = [];
      this.plane = { x: 0, alt: 2400, heading: 0, throttle: 0.55, bank: 0, pitch: 0, speed: FLIGHT.cruiseSpeed, vs: 0 };
      this.wind = this.mission().wind;
      this.buildRoute();
      this.buildScenery();
    },

    // Line up on the water for a takeoff roll: the plane starts at rest on
    // the lagoon by the home strip, lifts off at rotation speed, and only
    // then does the route start moving. Called for every mission, so each
    // delivery begins with a takeoff and ends with a landing.
    startTakeoff() {
      this.plane = { x: 0, alt: 380, heading: 0, throttle: 0.35, bank: 0, pitch: 0, speed: 0, vs: 0 };
      this.lift = 0;
      this.landed = false;
      this.homeStripZ = 0.14;
      this.screen = 'takeoff';
    },

    buildRoute() {
      const rng = makeRng(this.seed * 1000 + this.missionIndex * 77 + 13);
      const mission = this.mission();
      this.rings = [];
      let rx = 0;
      let ra = 3200;
      for (let i = 0; i < mission.rings; i += 1) {
        rx = clamp(rx + range(rng, -0.55, 0.55), -0.85, 0.85);
        // Consecutive rings stay at least 0.4 apart sideways: far rings
        // collapse toward the horizon in the projection, so rings with
        // nearly the same x and altitude would draw on top of each other.
        if (i > 0) {
          const prev = this.rings[i - 1].x;
          if (Math.abs(rx - prev) < 0.4) {
            rx = clamp(prev + (rx >= prev ? 0.4 : -0.4), -0.85, 0.85);
            if (Math.abs(rx - prev) < 0.4) rx = clamp(prev - Math.sign(rx - prev || 1) * 0.4, -0.85, 0.85);
          }
        }
        // Gentle altitude walk (±400 ft max between neighbours): the route
        // climbs and dives in smooth steps instead of porpoising ±1600 ft.
        ra = clamp(ra + range(rng, -400, 400), 1200, 6800);
        this.rings.push({ x: rx, alt: ra, z: 0.55 + i * RING_SPACING, hit: false, missed: false, id: i });
      }
      // Fuel rings and hazards sit MIDWAY between mission rings in depth
      // (never on top of one) and clear of their neighbours sideways and
      // in altitude, so a green ring or an ash cloud never draws on top of
      // a gold ring. Without this they spawned at nearly the same z as a
      // mission ring (fuel 1.17 vs mission 1.25) and stacked into one blob.
      const separated = (z, tries) => {
        let x = 0, alt = 3200;
        for (let t = 0; t < tries; t += 1) {
          x = range(rng, -0.7, 0.7);
          alt = range(rng, 1800, 5200);
          let ok = true;
          for (const r of this.rings) {
            if (Math.abs(r.z - z) < 0.45 && Math.abs(r.x - x) < 0.5 && Math.abs(r.alt - alt) < 1000) { ok = false; break; }
          }
          if (ok) {
            for (const f of this.fuelRings) {
              if (Math.abs(f.z - z) < 0.45 && Math.abs(f.x - x) < 0.5 && Math.abs(f.alt - alt) < 1000) { ok = false; break; }
            }
          }
          if (ok) {
            for (const h of this.hazards) {
              if (Math.abs(h.z - z) < 0.45 && Math.abs(h.x - x) < 0.5 && Math.abs(h.alt - alt) < 1000) { ok = false; break; }
            }
          }
          if (ok) return { x, alt };
        }
        return { x, alt };
      };
      this.fuelRings = [];
      for (let i = 0; i < 3; i += 1) {
        const z = 0.55 + (i + 0.5) * RING_SPACING + range(rng, 0, 0.08);
        const p = separated(z, 10);
        this.fuelRings.push({ x: p.x, alt: p.alt, z, taken: false });
      }
      this.hazards = [];
      for (let i = 0; i < 3; i += 1) {
        const z = 0.55 + (i + 0.5) * RING_SPACING + 0.18 + range(rng, 0, 0.08);
        const p = separated(z, 10);
        this.hazards.push({
          x: p.x, alt: p.alt, z, r: range(rng, 0.12, 0.18), hit: false,
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
          x: sceneryX(rng, kind.kind), z: 0.12 + i * 0.075, size: range(rng, 0.5, 1.15),
          seed: Math.floor(rng() * 10000),
        });
      }
    },

    nextRing() {
      // A missed ring stays in play (it circles back around), so the next
      // ring is simply the first one not yet hit.
      for (const r of this.rings) if (!r.hit) return r;
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

    // Messages queue up and show one at a time (see step: only the head of
    // the queue ages), so they can never pile up over the HUD.
    addMessage(text, color) {
      this.messages.push({ text, color: color || '#fff6dd', t: 0 });
      if (this.messages.length > 3) this.messages.shift();
    },
    burst(x, y, color, n) {
      for (let i = 0; i < n; i += 1) {
        if (this.particles.length > 220) return;
        const a = this.rng() * Math.PI * 2;
        const s = 40 + this.rng() * 160;
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.7 + this.rng() * 0.5, t: 0, color, size: 2 + this.rng() * 4 });
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

    // Volcano keep-out: the plane must NEVER overlap a volcano cone or
    // fly through one. This mirrors the renderer's projection (laneX,
    // groundY, scaleAt) in world units: for each near volcano it checks
    // whether the cone would cover the plane's screen box, and if so
    // pushes the plane sideways to the nearest clear position. No damage,
    // no bounce, no message — contact is simply impossible. With the
    // 1.35 spawn margin this never fires in normal play; it is the net
    // for anything unexpected (extreme sizes, recycled islands).
    volcanoGuard() {
      const p = this.plane;
      const boxX0 = VIEW.width / 2 - 244, boxX1 = VIEW.width / 2 + 244; // plane 204 half-wide + 40 margin
      const boxY0 = 372, boxY1 = 625; // flight band 378..526 and water band 471..619, with margin
      for (const isl of this.islands) {
        if (isl.kind !== 'volcano') continue;
        const d = clamp(1 - isl.z, 0, 1);
        if (d <= 0.45) continue; // too far: the cone base is still below the plane's band
        const s = (0.12 + Math.pow(d, 1.6) * 1.7) * isl.size;
        const gy = HORIZON_Y + d * d * 428;
        if (gy - 210 * s > boxY1 || gy < boxY0) continue; // cone does not reach the plane's height
        const f = 0.3 + 0.7 * d;
        const half = 150 * s + 244; // cone base half-width + plane half-width + margin
        const cx = VIEW.width / 2 + (isl.x - p.x * 0.35) * 620 * f;
        if (Math.abs(cx - VIEW.width / 2) >= half) continue;
        // Deflect: |isl.x - p.x * 0.35| must exceed half / (620 * f).
        const need = half / (620 * f);
        if (isl.x > 0) p.x = Math.min(p.x, (isl.x - need) / 0.35);
        else p.x = Math.max(p.x, (isl.x + need) / 0.35);
      }
      p.x = clamp(p.x, -1.12, 1.12);
      return { boxX0, boxX1, boxY0, boxY1 };
    },

    step(dt, input, audio) {
      // --- Takeoff roll: the plane sits on the lagoon, throttles up, and
      // lifts off at rotation speed. The route waits ahead until airborne.
      if (this.screen === 'takeoff') {
        this.time += dt;
        const p = this.plane;
        let events = EVENT_NONE;
        // Auto-throttle toward takeoff power; the player can still pull back.
        p.throttle = clamp(p.throttle + input.throttleDelta() * dt * 0.45, 0, 1);
        p.throttle += (0.9 - p.throttle) * Math.min(1, dt * 0.8);
        const targetSpeed = FLIGHT.minSpeed + (FLIGHT.maxSpeed - FLIGHT.minSpeed) * p.throttle;
        p.speed += (targetSpeed - p.speed) * Math.min(1, dt * 0.8);
        // Water run: the home strip scrolls past under the plane.
        const advance = (p.speed / 140) * dt * ADVANCE_RATE;
        this.distance += p.speed * dt;
        if (this.homeStripZ != null) this.homeStripZ -= advance;
        for (const isl of this.islands) {
          isl.z -= advance * 0.55;
          if (isl.z < 0.02) { isl.z = 1.05; isl.x = sceneryX(this.rng, isl.kind); }
        }
        // The plane never overlaps a volcano cone, even on the water.
        this.volcanoGuard();
        // Spray off the pontoons while still on the water.
        if (p.speed > 25 && this.lift < 0.6 && this.rng() < dt * 22) {
          this.particles.push({
            x: 540 + this.rng() * 90, y: 600,
            vx: -60 - this.rng() * 90, vy: -40 - this.rng() * 70,
            life: 0.5, t: 0, color: '#cfe8ff', size: 2 + this.rng() * 3,
          });
        }
        // Rotation speed: lift off and climb away.
        if (p.speed >= 95) {
          this.lift = Math.min(1, this.lift + dt / 1.4);
          p.alt = 380 + this.lift * 820;
          p.pitch = this.lift * 0.14;
          if (this.lift >= 1 && p.speed >= 125) {
            this.screen = 'play';
            this.homeStripZ = null;
            this.addMessage('AIRBORNE — fly the golden rings!', '#7dff9a');
          }
        }
        for (const pt of this.particles) { pt.t += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 120 * dt; }
        this.particles = this.particles.filter((pt) => pt.t < pt.life);
        if (audio) audio.setThrottle(p.throttle, (p.speed - FLIGHT.minSpeed) / (FLIGHT.maxSpeed - FLIGHT.minSpeed));
        return events;
      }
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

      // Climb and descend. Vertical speed is tracked for landing quality.
      const climb = input.climb();
      p.vs = climb * 1900;
      p.pitch += (climb * 0.22 - p.pitch) * Math.min(1, dt * 5);
      p.alt += climb * dt * 1900 - (p.throttle < 0.25 ? dt * 260 : 0);
      p.alt = clamp(p.alt, 120, FLIGHT.maxAltitude);

      // The plane never overlaps a volcano cone: deflect around any cone
      // that would cover it (no damage — contact is impossible, see
      // volcanoGuard()).
      this.volcanoGuard();

      // Fuel burn: faster and thirstier at full throttle.
      const burn = (FLIGHT.fuelBurn + (p.throttle > 0.8 ? FLIGHT.fuelBurnBoost : 0)) * dt;
      this.fuel = Math.max(0, this.fuel - burn);
      if (this.fuel <= 0) {
        p.throttle = Math.max(0, p.throttle - dt * 0.4);
        // Out of fuel over the sea: one ditch, not a damage tick per frame.
        if (p.alt <= 520 && !this.ditched) {
          this.ditched = true;
          this.damage(6, 'OUT OF FUEL — ditched in the sea!');
          return EVENT_OVER | EVENT_DAMAGE;
        }
      }

      // Forward motion: everything ahead comes closer.
      const advance = (p.speed / 140) * dt * ADVANCE_RATE;
      this.distance += p.speed * dt;
      for (const isl of this.islands) {
        isl.z -= advance * 0.55;
        if (isl.z < 0.02) { isl.z = 1.05; isl.x = sceneryX(this.rng, isl.kind); }
      }
      const moveSet = (list) => { for (const o of list) o.z -= advance; };

      // Rings: pass through the centre for points and combo. A missed ring
      // is NOT lost forever — it circles back around ahead of the plane, so
      // a mission can never soft-lock. Missing still costs the combo and
      // the perfect-run bonus.
      for (const ring of this.rings) {
        if (ring.hit) continue;
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
            this.addMessage('RING MISSED — it circles back around!', '#b9c4d6');
            // Back of the queue: behind every ring still ahead of the plane.
            let z = RESPAWN_Z;
            for (const r of this.rings) {
              if (r !== ring && !r.hit) z = Math.max(z, r.z + 0.3);
            }
            ring.z = z;
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
          if (Math.abs(hz.x - p.x) < hz.r && Math.abs(hz.alt - p.alt) < 1000) {
            hz.hit = true;
            if (this.invuln <= 0) {
              this.damage(1, 'ASH CLOUD! Hull -1');
              this.invuln = 1.5; // brief protection so one cloud can't chain hits
            }
            if (audio) audio.crash();
            events |= EVENT_DAMAGE;
          }
        }
        if (hz.z < -0.06) hz.hit = true;
      }

      // Sea-skimming: a warning first, then a wave strike only when truly
      // on the water (below 200 ft). A strike costs a hull and bounces the
      // plane back up — with 6 hull and 1.5 s of protection it stings,
      // it no longer ends the run.
      if (p.alt <= 450 && !this.lowWarned) {
        this.lowWarned = true;
        this.addMessage('PULL UP — WAVES!', '#ffb347');
      }
      if (p.alt > 700) this.lowWarned = false;
      if (p.alt <= 200) {
        if (this.invuln <= 0) {
          this.damage(1, 'WAVE STRIKE! Pull up!');
          this.invuln = 1.5;
        }
        p.alt = 900;
        if (audio) audio.crash();
        events |= EVENT_DAMAGE;
        if (this.screen !== 'play') return events;
      }

      // The island strip: land the cargo with a real touchdown, judged on
      // speed, height, centreline and sink. Too high, too fast or off
      // centre and the strip loops round for another attempt.
      if (this.strip && !this.strip.landed) {
        this.strip.z -= advance;
        const allRingsHit = this.ringsHit === this.rings.length;
        if (this.cargo && allRingsHit && this.strip.z < 1.2 && !this.approachWarned) {
          this.approachWarned = true;
          this.addMessage('FINAL APPROACH — slow down, line up with the strip', '#ffd23d');
        }
        if (this.strip.z <= 0.02 && this.strip.z > -0.12) {
          if (this.cargo && allRingsHit && p.alt < 900 && p.speed < 170 && Math.abs(p.x) < 0.3) {
            this.strip.landed = true;
            this.deliveries += 1;
            const sink = Math.max(0, -p.vs);
            let lpts = 300;
            lpts -= Math.max(0, p.speed - 140) * 2;
            lpts -= Math.max(0, p.alt - 600) * 0.15;
            lpts -= Math.abs(p.x) * 250;
            lpts -= Math.max(0, sink - 300) * 0.1;
            lpts = clamp(Math.round(lpts), 0, 300);
            const grade = lpts >= 240 ? 'CLEAN' : lpts >= 140 ? 'FIRM' : 'HARD';
            this.landing = { speed: Math.round(p.speed), alt: Math.round(p.alt), sink: Math.round(sink), grade, pts: lpts };
            let pts = SCORES.delivery + lpts;
            if (this.ringsMissed === 0) { pts += SCORES.perfectRunBonus; this.perfectRuns += 1; this.addMessage(`PERFECT RUN +${SCORES.perfectRunBonus}`, '#ffd23d'); }
            this.score += pts;
            this.addMessage(`TOUCHDOWN ${grade} +${lpts} — DELIVERED TO ${this.mission().to.toUpperCase()} +${pts}`, '#7dff9a');
            this.burst(640, 420, '#7dff9a', 40);
            if (audio) audio.delivery();
            // On the ground: fuel topped up, hull patched, plane sits on
            // the water until the next takeoff.
            this.fuel = 100;
            this.hull = this.maxHull;
            this.landed = true;
            this.lift = 0;
            p.alt = 380;
            p.speed = 55;
            p.throttle = 0.3;
            this.screen = 'delivered';
            events |= EVENT_DELIVERED;
          } else if (this.strip.z <= -0.1) {
            this.strip.z = 0.9; // loop the strip round for another attempt
            if (!this.cargo) this.addMessage('FLY THE RINGS FIRST — cargo is on the route', '#ffb347');
            else if (!allRingsHit) this.addMessage('RINGS REMAIN — finish the route first', '#ffb347');
            else if (p.alt >= 900) this.addMessage('TOO HIGH — descend below 900 ft for the strip', '#ffb347');
            else if (p.speed >= 170) this.addMessage('TOO FAST — slow below 170 kt to land', '#ffb347');
            else this.addMessage('OFF CENTRE — line up with the strip', '#ffb347');
          }
        }
        if (this.strip.z < -0.12) this.strip.z = 0.95;
      }

      // One message at a time: only the head of the queue ages, the next
      // shows when the current one expires.
      if (this.messages.length > 0) {
        this.messages[0].t += dt;
        if (this.messages[0].t > 2.2) this.messages.shift();
      }
      for (const pt of this.particles) { pt.t += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 120 * dt; }
      this.particles = this.particles.filter((pt) => pt.t < pt.life);
      this.shake = Math.max(0, this.shake - dt * 1.4);
      this.flash = Math.max(0, this.flash - dt * 1.2);
      this.invuln = Math.max(0, this.invuln - dt);
      this.speedLines = speed01;
      if (audio) audio.setThrottle(p.throttle, speed01);
      return events;
    },

    nextMission() {
      const next = this.missionIndex + 1;
      if (next >= MISSIONS.length) { this.screen = 'complete'; return; }
      this.reset(next, true);
      this.startTakeoff();
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
    // Final approach: line up on the centreline and settle at ~650 ft so
    // the landing window (below 900 ft, below 170 kt) is met.
    steer = Math.max(-1, Math.min(1, (0 - p.x) * 2.2));
    climb = p.alt > 750 ? -1 : p.alt < 550 ? 1 : 0;
  }
  return {
    steer: () => steer,
    climb: () => climb,
    throttleDelta: () => (p.throttle < 0.62 ? 1 : 0),
  };
}
