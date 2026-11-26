// WebAudio synth for Volcano Sky Courier: engine hum, ring chimes, pickup
// blips, delivery fanfare and crash thud — plus the game's own background
// music, an original golden-hour flight theme (airy, flowing, A major
// pentatonic) that adapts to title / play / danger / final approach / win /
// game over. No audio files, no network. Everything is guarded so the game
// never throws when audio is unavailable, and nothing starts before the
// player's first gesture (tap, click or key) — iOS and Android block
// autoplay, so music starts in resume().

function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// Chords per mood, as MIDI note numbers. Original progressions.
// title: Amaj7 – F#m7 – Dmaj7 – E7 (slow, warm) · play: A – E – F#m – D
// danger: Am – F – C – G (minor, urgent) · approach: D – A – E – A
const MUSIC_CHORDS = {
  title: [[57, 61, 64, 68], [54, 57, 61, 64], [50, 54, 57, 62], [52, 56, 59, 64]],
  play: [[57, 61, 64], [52, 56, 59], [54, 57, 61], [50, 54, 57]],
  danger: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
  approach: [[50, 54, 57], [57, 61, 64], [52, 56, 59], [57, 61, 64]],
  win: [[57, 61, 64], [50, 54, 57], [52, 56, 59], [57, 61, 64]],
  over: [[57, 60, 64], [53, 57, 60], [57, 60, 64], [52, 56, 59]],
  paused: [[57, 61, 64], [50, 54, 57]],
};
const MUSIC_TEMPO = { title: 66, play: 100, danger: 132, approach: 112, win: 100, over: 58, paused: 72 };
// 16-step melody patterns: scale degrees (1-based) into the pentatonic
// lists below, 0 = rest. Fixed patterns, so the theme is the same every run.
const PENTA_MAJOR = [69, 71, 73, 76, 78, 81]; // A4 B4 C#5 E5 F#5 A5
const PENTA_MINOR = [69, 72, 74, 76, 79, 81]; // A4 C5 D5 E5 G5 A5
const MUSIC_MELODY = {
  title: [1, 0, 0, 3, 0, 0, 2, 0, 0, 4, 0, 0, 3, 0, 5, 0],
  play: [1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 4, 3, 2, 0, 1, 0],
  danger: [1, 2, 0, 1, 0, 3, 0, 2, 1, 0, 2, 0, 3, 0, 0, 0],
  approach: [5, 0, 4, 0, 3, 0, 4, 0, 5, 6, 0, 5, 4, 0, 3, 0],
  win: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  over: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  paused: [1, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export function createAudio() {
  const api = {
    muted: false,
    musicEnabled: true, // settings: background music on/off
    sfxEnabled: true, // settings: sound-effect cues on/off
    ctx: null,
    engineOsc: null,
    engineGain: null,
    master: null,
    // --- music state ---
    musicGain: null,
    musicOn: false,
    mood: 'title',
    musicStep: 0,
    musicBar: 0,
    nextNoteTime: 0,
    duckUntil: 0,

    ensure() {
      if (this.ctx || typeof window === 'undefined') return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
        // Music rides its own quiet bus under the master, so it stays
        // under the sound effects and can duck under important cues.
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.15;
        this.musicGain.connect(this.master);
      } catch (e) { this.ctx = null; }
    },
    resume() {
      this.ensure();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      this.startMusic(); // first gesture only: music never autoplays on load
    },
    setMuted(muted) {
      this.muted = muted;
      if (this.master) this.master.gain.value = muted ? 0 : 0.5;
    },
    tone(freq, dur, type, vol, when = 0, slideTo = 0) {
      if (!this.ctx || this.muted || !this.sfxEnabled) return;
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
    // Briefly dip the music so a ring, pickup or fanfare cuts through.
    duck() {
      if (this.ctx) this.duckUntil = this.ctx.currentTime + 0.5;
    },
    ring() { this.duck(); this.tone(880, 0.28, 'sine', 0.22); this.tone(1318, 0.4, 'sine', 0.14, 0.06); },
    pickup() { this.duck(); this.tone(523, 0.16, 'triangle', 0.2); this.tone(784, 0.22, 'triangle', 0.18, 0.07); },
    delivery() {
      this.duck();
      [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.2, i * 0.09));
    },
    crash() { this.tone(140, 0.5, 'sawtooth', 0.28, 0, 45); this.tone(70, 0.6, 'square', 0.16, 0.02, 30); },
    click() { this.tone(660, 0.07, 'square', 0.08); },

    // --- background music ---
    startMusic() {
      if (!this.ctx || this.musicOn) return;
      this.musicOn = true;
      this.musicStep = 0;
      this.musicBar = 0;
      this.nextNoteTime = this.ctx.currentTime + 0.1;
    },
    setMood(mood) {
      if (mood === this.mood) return;
      this.mood = mood;
      this.musicStep = 0;
      this.musicBar = 0;
      if (this.ctx) this.nextNoteTime = this.ctx.currentTime + 0.05;
    },
    // One synth voice on the music bus.
    musicNote(midi, t, dur, type, vol, attack = 0.02) {
      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = midiFreq(midi);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(vol, t + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain);
        gain.connect(this.musicGain);
        osc.start(t);
        osc.stop(t + dur + 0.05);
      } catch (e) { /* audio is best-effort */ }
    },
    scheduleStep(step, t, stepDur, barDur) {
      const chords = MUSIC_CHORDS[this.mood] || MUSIC_CHORDS.play;
      const chord = chords[this.musicBar % chords.length];
      // Warm pad on the chord, one per bar.
      if (step === 0) {
        for (const midi of chord) this.musicNote(midi, t, barDur, 'triangle', 0.032, 0.4);
        this.musicNote(chord[0] - 12, t, barDur, 'sine', 0.055, 0.05);
      }
      // Soft bass pulse halfway through the bar.
      if (step === 8) this.musicNote(chord[0] - 12, t, stepDur * 3, 'sine', 0.05, 0.03);
      // Flowing melody line.
      const pattern = MUSIC_MELODY[this.mood] || MUSIC_MELODY.play;
      const deg = pattern[step] || 0;
      if (deg > 0) {
        const scale = this.mood === 'danger' || this.mood === 'over' ? PENTA_MINOR : PENTA_MAJOR;
        this.musicNote(scale[(deg - 1) % scale.length], t, stepDur * 1.8, 'triangle', 0.085, 0.02);
      }
      // Final approach: a shimmering high arpeggio over the top.
      if (this.mood === 'approach' && (step === 2 || step === 6 || step === 10 || step === 14)) {
        const top = chord[(step / 2) % chord.length] + 12;
        this.musicNote(top, t, stepDur * 1.4, 'sine', 0.045, 0.01);
      }
    },
    // Called every animation frame from the game loop. Schedules notes a
    // little ahead of the clock; while muted or suspended it schedules
    // nothing, so unmuting never dumps a backlog of notes at once.
    update() {
      if (!this.ctx || !this.musicOn || !this.musicGain) return;
      if (!this.musicEnabled) {
        // Music off: silence the music bus, keep the clock fresh.
        this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        this.nextNoteTime = this.ctx.currentTime + 0.1;
        return;
      }
      if (this.muted || this.ctx.state !== 'running') {
        this.nextNoteTime = this.ctx.currentTime + 0.1;
        return;
      }
      const ducked = this.duckUntil > this.ctx.currentTime;
      const target = ducked ? 0.05 : (this.mood === 'paused' ? 0.06 : 0.15);
      this.musicGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2);
      const bpm = MUSIC_TEMPO[this.mood] || 100;
      const stepDur = 60 / bpm / 4; // 16th notes
      const barDur = stepDur * 16;
      while (this.nextNoteTime < this.ctx.currentTime + 0.3) {
        this.scheduleStep(this.musicStep, this.nextNoteTime, stepDur, barDur);
        this.nextNoteTime += stepDur;
        this.musicStep = (this.musicStep + 1) % 16;
        if (this.musicStep === 0) this.musicBar += 1;
      }
    },
    // Short celebratory phrase on a delivery / tour complete.
    winPhrase() {
      if (!this.ctx) return;
      this.duck();
      [81, 85, 88, 93].forEach((m, i) => this.tone(midiFreq(m), 0.5, 'triangle', 0.18, i * 0.11));
      this.tone(midiFreq(69), 1.2, 'sine', 0.1, 0.4);
    },
    // Somber phrase on a lost sortie.
    somberPhrase() {
      if (!this.ctx) return;
      [69, 65, 64, 62].forEach((m, i) => this.tone(midiFreq(m), 0.55, 'sine', 0.15, i * 0.24));
    },

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
