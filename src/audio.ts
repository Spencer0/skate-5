/**
 * Procedural skate sounds: no audio files, everything is filtered noise and
 * short envelopes so it stays tiny and responsive.
 */
export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private rollGain!: GainNode;
  private rollFilter!: BiquadFilterNode;
  private rumbleGain!: GainNode;
  private grindGain!: GainNode;
  private grindFilter!: BiquadFilterNode;
  private grindFilter2!: BiquadFilterNode;
  private slideGain!: GainNode;
  muted = false;

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    // brown-ish noise for rolling, white sprinkled on top
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.04 * w) / 1.04;
      d[i] = last * 3 + w * 0.25;
    }

    // rolling loop
    const roll = this.loop();
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'bandpass';
    this.rollFilter.frequency.value = 300;
    this.rollFilter.Q.value = 0.7;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    roll.connect(this.rollFilter).connect(this.rollGain).connect(this.master);

    const rumble = this.loop();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(lp).connect(this.rumbleGain).connect(this.master);

    // metal grind: two resonant bands
    const gsrc = this.loop();
    this.grindFilter = ctx.createBiquadFilter();
    this.grindFilter.type = 'bandpass';
    this.grindFilter.frequency.value = 2400;
    this.grindFilter.Q.value = 6;
    this.grindFilter2 = ctx.createBiquadFilter();
    this.grindFilter2.type = 'bandpass';
    this.grindFilter2.frequency.value = 5200;
    this.grindFilter2.Q.value = 9;
    this.grindGain = ctx.createGain();
    this.grindGain.gain.value = 0;
    gsrc.connect(this.grindFilter).connect(this.grindGain);
    gsrc.connect(this.grindFilter2).connect(this.grindGain);
    this.grindGain.connect(this.master);

    // board slide: woody, lower
    const ssrc = this.loop();
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.value = 900;
    sf.Q.value = 2.5;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    ssrc.connect(sf).connect(this.slideGain).connect(this.master);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  private loop() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    src.start(0, Math.random() * 1.5);
    return src;
  }

  /** Continuous sounds, called every frame. */
  update(rollSpeed: number, grinding: 'none' | 'grind' | 'slide', grindSpeed: number, powerslide: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(1, rollSpeed / 9);
    this.rollGain.gain.setTargetAtTime(s * 0.32 + (powerslide ? 0.25 : 0), t, 0.05);
    this.rollFilter.frequency.setTargetAtTime(powerslide ? 1800 : 260 + s * 700, t, 0.05);
    this.rumbleGain.gain.setTargetAtTime(s * 0.5, t, 0.05);
    const g = Math.min(1, grindSpeed / 7);
    this.grindGain.gain.setTargetAtTime(grinding === 'grind' ? 0.2 + g * 0.25 : 0, t, 0.03);
    this.grindFilter.frequency.setTargetAtTime(1900 + g * 1400, t, 0.05);
    this.slideGain.gain.setTargetAtTime(grinding === 'slide' ? 0.35 + g * 0.3 : 0, t, 0.03);
  }

  private burst(opts: { dur: number; freq: number; q: number; gain: number; type?: BiquadFilterType; delay?: number; attack?: number }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q;
    const g = ctx.createGain();
    const atk = opts.attack ?? 0.002;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0008, t + opts.dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + opts.dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slide = 0, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  pop() {
    // tail slap: sharp crack + woody knock
    this.burst({ dur: 0.06, freq: 2600, q: 1.2, gain: 1.1 });
    this.burst({ dur: 0.12, freq: 520, q: 3, gain: 0.9 });
    this.tone(180, 0.09, 0.5, 'triangle', 0.5);
  }

  flipWhoosh(strength: number) {
    this.burst({ dur: 0.25, freq: 900, q: 0.8, gain: 0.12 * strength, attack: 0.08 });
  }

  /** Wheels rolling over an expansion joint: a soft double clack. */
  joint(speed: number) {
    if (speed < 0.8) return;
    const g = Math.min(0.5, 0.08 + speed * 0.045);
    this.burst({ dur: 0.035, freq: 900, q: 1.5, gain: g });
    // back wheels cross the joint a wheelbase later
    this.burst({ dur: 0.035, freq: 850, q: 1.5, gain: g * 0.8, delay: Math.min(0.2, 0.37 / speed) });
  }

  spinTick() {
    this.burst({ dur: 0.05, freq: 1500, q: 3, gain: 0.18 });
  }

  catchClick(perfect: boolean) {
    this.burst({ dur: 0.04, freq: 3200, q: 2, gain: 0.5 });
    if (perfect) this.tone(1320, 0.12, 0.08, 'sine', 1.0);
  }

  land(impact: number, quality: string) {
    const k = Math.min(1.4, 0.35 + impact * 0.12);
    this.burst({ dur: 0.08, freq: 1800, q: 1, gain: 0.9 * k });
    this.burst({ dur: 0.22, freq: 160, q: 1, gain: 1.6 * k, type: 'lowpass' });
    this.tone(95, 0.18, 0.5 * k, 'sine', 0.6);
    if (quality === 'sketchy') this.burst({ dur: 0.3, freq: 700, q: 4, gain: 0.25, delay: 0.05 });
  }

  touchdown(impact: number) {
    this.burst({ dur: 0.1, freq: 300, q: 1, gain: Math.min(0.8, impact * 0.25), type: 'lowpass' });
  }

  grindStart(slide: boolean) {
    if (slide) this.burst({ dur: 0.12, freq: 600, q: 2, gain: 0.9 });
    else {
      this.burst({ dur: 0.08, freq: 3800, q: 6, gain: 0.8 });
      this.tone(2100, 0.2, 0.08, 'triangle', 0.9);
    }
  }

  push() {
    this.burst({ dur: 0.16, freq: 420, q: 0.9, gain: 0.35, attack: 0.04 });
  }

  bail() {
    this.burst({ dur: 0.35, freq: 140, q: 0.8, gain: 1.8, type: 'lowpass' });
    this.burst({ dur: 0.08, freq: 1400, q: 1.5, gain: 0.8, delay: 0.12 });
    this.burst({ dur: 0.08, freq: 1100, q: 1.5, gain: 0.6, delay: 0.3 });
    this.burst({ dur: 0.06, freq: 1300, q: 1.5, gain: 0.35, delay: 0.42 });
  }

  wall(impact: number) {
    this.burst({ dur: 0.12, freq: 380, q: 1.5, gain: Math.min(1, impact * 0.3) });
  }

  /** Goal complete: a little rising arpeggio. */
  goal() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, 0.25, 0.12, 'triangle', 1, i * 0.09));
    this.tone(1568, 0.5, 0.06, 'sine', 1, 0.36);
  }

  letter() {
    this.tone(988, 0.12, 0.12, 'triangle', 1);
    this.tone(1319, 0.2, 0.1, 'triangle', 1, 0.07);
  }

  gap() {
    this.tone(660, 0.16, 0.08, 'sine', 1);
    this.tone(880, 0.22, 0.08, 'sine', 1, 0.08);
  }

  splash() {
    this.burst({ dur: 0.6, freq: 700, q: 0.6, gain: 1.4, attack: 0.01 });
    this.burst({ dur: 0.9, freq: 2600, q: 0.8, gain: 0.5, delay: 0.05, attack: 0.05 });
    this.burst({ dur: 0.3, freq: 180, q: 1, gain: 1.2, type: 'lowpass' });
  }

  /** Run start (false) / time up (true) air horn. */
  horn(end: boolean) {
    const f = end ? 233 : 349;
    for (const m of [1, 1.26, 1.5]) this.tone(f * m, end ? 0.9 : 0.45, 0.06, 'sawtooth', end ? 0.92 : 1);
  }

  tick() {
    this.tone(1760, 0.06, 0.08, 'square', 1);
  }

  /** Dialogue line appears. */
  blip() {
    this.tone(880, 0.05, 0.04, 'triangle', 1.2);
  }

  knock(bouncy: boolean) {
    if (bouncy) this.tone(320, 0.25, 0.25, 'sine', 2.2);
    else {
      this.burst({ dur: 0.15, freq: 1200, q: 5, gain: 0.7 });
      this.tone(520, 0.3, 0.08, 'triangle', 0.8);
    }
  }

  special() {
    const notes = [392, 523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, 0.18, 0.08, 'sawtooth', 1, i * 0.04));
    this.burst({ dur: 0.5, freq: 3000, q: 0.7, gain: 0.25, attack: 0.1 });
  }

  combo(mult: number) {
    const base = 520;
    this.tone(base, 0.12, 0.09, 'sine', 1);
    this.tone(base * 1.25, 0.12, 0.09, 'sine', 1, 0.07);
    this.tone(base * 1.5 * (mult > 4 ? 1.333 : 1), 0.22, 0.1, 'sine', 1, 0.14);
  }
}
