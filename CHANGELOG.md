# Volcano Sky Courier — Changelog

## 2026-11-27 — Off-screen culling
- Islands, rings, ash clouds, the runway and spray particles that sit fully outside the frame are no longer drawn — they used to be painted in full even when the projection pushed them far past the left or right edge.
- An off-screen island no longer leaves its name clamped to the frame edge, and off-screen rings and hazards no longer block a label from its place.
- Nothing visible changed: every object that can peek into frame still draws, glow and smoke plume included.
