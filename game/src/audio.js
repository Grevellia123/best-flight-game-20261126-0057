// WebAudio synth for Volcano Sky Courier: engine hum, ring chimes, pickup
// blips, delivery fanfare and crash thud. No audio files, no network.
// Everything is guarded so the game never throws when audio is unavailable.

export function createAudio() {
  const api = {
    muted: false,
    ctx: null,
    engineOsc: null,
    engineGain: null,
    master: null,
    ensure() {
      if (this.ctx || typeof window === 'undefined') return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.ctx = null; }
    },
    resume() {
      this.ensure();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    },
    setMuted(muted) {
      this.muted = muted;
      if (this.master) this.master.gain.value = muted ? 0 : 0.5;
    },
    tone(freq, dur, type, vol, when = 0, slideTo = 0) {
      if (!this.ctx || this.muted) return;
      try {
        const t0 = this.ctx.currentTime + when;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(vol || 0.18, t0 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
      } catch (e) { /* audio is best-effort */ }
    },
    ring() { this.tone(880, 0.28, 'sine', 0.22); this.tone(1318, 0.4, 'sine', 0.14, 0.06); },
    pickup() { this.tone(523, 0.16, 'triangle', 0.2); this.tone(784, 0.22, 'triangle', 0.18, 0.07); },
    delivery() {
      [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.2, i * 0.09));
    },
    crash() { this.tone(140, 0.5, 'sawtooth', 0.28, 0, 45); this.tone(70, 0.6, 'square', 0.16, 0.02, 30); },
    click() { this.tone(660, 0.07, 'square', 0.08); },
    startEngine() {
      if (!this.ctx || this.engineOsc) return;
      try {
        this.engineOsc = this.ctx.createOscillator();
        this.engineGain = this.ctx.createGain();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 52;
        this.engineGain.gain.value = 0.045;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 320;
        this.engineOsc.connect(filter);
        filter.connect(this.engineGain);
        this.engineGain.connect(this.master);
        this.engineOsc.start();
      } catch (e) { this.engineOsc = null; }
    },
    setThrottle(throttle, speed01) {
      if (this.engineOsc && this.ctx) {
        const f = 46 + throttle * 42 + speed01 * 18;
        this.engineOsc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.1);
        if (this.engineGain) this.engineGain.gain.setTargetAtTime(0.03 + throttle * 0.05, this.ctx.currentTime, 0.1);
      }
    },
    stopEngine() {
      if (this.engineOsc) { try { this.engineOsc.stop(); } catch (e) {} this.engineOsc = null; }
    },
  };
  return api;
}
