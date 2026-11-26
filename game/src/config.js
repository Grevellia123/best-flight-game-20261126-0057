// Volcano Sky Courier — tuning, palette and mission table.
// A bush seaplane mail run over a volcanic Indonesian archipelago at golden hour.

export const VIEW = { width: 1280, height: 720 };
export const HORIZON_Y = 268; // where sea meets sky on a 720-high frame
export const STEP = 1 / 60;

export const PALETTE = {
  skyTop: '#241a4d',
  skyMid: '#7a2f63',
  skyLow: '#e2603f',
  horizonGlow: '#ffb347',
  sunCore: '#ffe9a8',
  sunHalo: '#ff9a3d',
  seaDeep: '#0a2f4d',
  seaMid: '#155a75',
  seaGlitter: '#ffd98a',
  islandFar: '#4a3a6b',
  islandMid: '#2e5d43',
  islandNear: '#2a7a44',
  sand: '#e8c98a',
  villageRoof: '#c94f3d',
  volcanoRock: '#3a2530',
  volcanoSnow: '#e8d9c8',
  lava: '#ff6a2a',
  lavaBright: '#ffd23d',
  planeCream: '#f2e6c8',
  planeRed: '#c93b2e',
  planeTeal: '#1f7a6b',
  planeDark: '#2b2b33',
  ringGold: '#ffd23d',
  ringGreen: '#7dff9a',
  hudPanel: 'rgba(12, 18, 38, 0.72)',
  hudEdge: 'rgba(255, 210, 61, 0.85)',
  hudText: '#fff6dd',
  hudDim: '#b9c4d6',
  danger: '#ff5a4a',
  ok: '#7dff9a',
};

export const FLIGHT = {
  minSpeed: 62, // knots at idle
  maxSpeed: 198, // knots at full throttle
  cruiseSpeed: 128,
  climbRate: 9.5, // altitude units per second at full climb
  maxAltitude: 9200, // feet shown on the altimeter
  turnRate: 0.62, // heading radians per second at full bank
  lateralRange: 1, // plane x in -1..1 across the corridor
  fuelBurn: 0.55, // % per second at cruise throttle
  fuelBurnBoost: 1.15, // % per second at full throttle
  ringFuelBonus: 6,
  startFuel: 100,
  startHull: 3,
};

// Six courier runs, two per day across three golden-hour days. Each run is a
// chain of glowing rings that leads to one island strip; land the cargo there.
export const MISSIONS = [
  { id: 1, day: 1, from: 'Krakatoa Base', to: 'Pulau Bunga', cargo: 'Mail sacks', rings: 5, wind: 0.10 },
  { id: 2, day: 1, from: 'Pulau Bunga', to: 'Tanjung Emas', cargo: 'Medicine crates', rings: 6, wind: 0.14 },
  { id: 3, day: 2, from: 'Tanjung Emas', to: 'Pulau Karang', cargo: 'Spice boxes', rings: 6, wind: 0.20 },
  { id: 4, day: 2, from: 'Pulau Karang', to: 'Teluk Senja', cargo: 'Fishing nets', rings: 7, wind: 0.24 },
  { id: 5, day: 3, from: 'Teluk Senja', to: 'Pulau Padi', cargo: 'Rice seed', rings: 7, wind: 0.30 },
  { id: 6, day: 3, from: 'Pulau Padi', to: 'Krakatoa Base', cargo: 'Volcano samples', rings: 8, wind: 0.36 },
];

export const ISLANDS = [
  { name: 'Krakatoa', kind: 'volcano', hue: 'volcano' },
  { name: 'Pulau Bunga', kind: 'village', hue: 'green' },
  { name: 'Tanjung Emas', kind: 'village', hue: 'gold' },
  { name: 'Pulau Karang', kind: 'reef', hue: 'teal' },
  { name: 'Teluk Senja', kind: 'village', hue: 'dusk' },
  { name: 'Pulau Padi', kind: 'terraces', hue: 'green' },
  { name: 'Batu Laut', kind: 'rock', hue: 'grey' },
  { name: 'Pulau Api', kind: 'volcano', hue: 'volcano' },
];

export const SCORES = {
  ring: 100,
  ringComboStep: 25,
  cargoPickup: 150,
  delivery: 500,
  perfectRunBonus: 250,
  fuelRing: 40,
  ringFuelBonus: 6,
};

export const CONTROLS_TEXT = 'A/D or ←/→ steer · W/S throttle · ↑/↓ climb & descend · mouse steers too · P pause · M mute';
