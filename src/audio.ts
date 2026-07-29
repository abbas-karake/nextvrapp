export type EffectKind = 'step' | 'jump' | 'land' | 'shoot' | 'attach' | 'release';

export function windGainForSpeed(speed: number): number {
  const normalized = Math.max(0, Math.min((speed - 3) / 22, 1));
  return normalized * normalized * 0.22;
}

function seededNoise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

export function synthesizeEffect(kind: EffectKind, sampleRate = 22050): Float32Array {
  const duration = kind === 'step' ? 0.14
    : kind === 'jump' ? 0.26
      : kind === 'shoot' ? 0.16
        : kind === 'attach' ? 0.2
          : kind === 'release' ? 0.12
            : 0.22;
  const samples = new Float32Array(Math.max(1, Math.floor(sampleRate * duration)));
  const seed = { step: 7, jump: 19, land: 31, shoot: 43, attach: 59, release: 71 }[kind];
  const noise = seededNoise(seed);
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    const progress = index / samples.length;
    const envelope = (1 - progress) ** (kind === 'step' ? 3.2 : 2.2);
    let value: number;
    if (kind === 'jump') {
      const frequency = 150 + progress * 250;
      value = Math.sin(Math.PI * 2 * frequency * time) * 0.38 + noise() * 0.06;
    } else if (kind === 'shoot') {
      const frequency = 520 - progress * 260;
      value = Math.sin(Math.PI * 2 * frequency * time) * 0.34 + noise() * 0.12;
    } else if (kind === 'attach') {
      value = Math.sin(Math.PI * 2 * 92 * time) * 0.48 + Math.sin(Math.PI * 2 * 310 * time) * 0.14;
    } else if (kind === 'release') {
      value = Math.sin(Math.PI * 2 * (340 + progress * 180) * time) * 0.3 + noise() * 0.16;
    } else if (kind === 'land') {
      value = Math.sin(Math.PI * 2 * 48 * time) * 0.5 + noise() * 0.2;
    } else {
      value = Math.sin(Math.PI * 2 * 82 * time) * 0.28 + noise() * 0.32;
    }
    samples[index] = Math.max(-1, Math.min(1, value * envelope));
  }
  return samples;
}

function createNoiseBuffer(context: AudioContext, duration: number, seed: number): AudioBuffer {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
  const data = buffer.getChannelData(0);
  const noise = seededNoise(seed);
  let smoothed = 0;
  for (let index = 0; index < data.length; index += 1) {
    smoothed = smoothed * 0.93 + noise() * 0.07;
    data[index] = smoothed;
  }
  return buffer;
}

export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private ambientStarted = false;
  private stepTimer = 0;
  private readonly effectBuffers = new Map<EffectKind, AudioBuffer>();
  private windGain?: GainNode;
  private windFilter?: BiquadFilterNode;

  async unlock(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!this.context) {
      const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.48;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
    if (!this.ambientStarted) this.startAmbience();
  }

  play(kind: EffectKind): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || context.state !== 'running') return;
    let buffer = this.effectBuffers.get(kind);
    if (!buffer) {
      const samples = synthesizeEffect(kind, context.sampleRate);
      buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.effectBuffers.set(kind, buffer);
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = {
      step: 0.2,
      jump: 0.28,
      land: 0.34,
      shoot: 0.3,
      attach: 0.38,
      release: 0.24,
    }[kind];
    source.buffer = buffer;
    source.connect(gain).connect(master);
    source.start();
  }

  update(moving: boolean, grounded: boolean, deltaSeconds: number): void {
    if (!moving || !grounded) {
      this.stepTimer = Math.min(this.stepTimer, 0.08);
      return;
    }
    this.stepTimer -= deltaSeconds;
    if (this.stepTimer <= 0) {
      this.play('step');
      this.stepTimer = 0.42;
    }
  }

  setSwingSpeed(speed: number): void {
    const context = this.context;
    if (!context || !this.windGain || !this.windFilter) return;
    const now = context.currentTime;
    this.windGain.gain.setTargetAtTime(windGainForSpeed(speed), now, 0.12);
    this.windFilter.frequency.setTargetAtTime(420 + Math.min(Math.max(speed, 0), 28) * 38, now, 0.15);
  }

  private startAmbience(): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    this.ambientStarted = true;

    const addNoiseLayer = (frequency: number, gainValue: number, seed: number): void => {
      const source = context.createBufferSource();
      source.buffer = createNoiseBuffer(context, 5, seed);
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = 0.55;
      const gain = context.createGain();
      gain.gain.value = gainValue;
      source.connect(filter).connect(gain).connect(master);
      source.start();
    };

    addNoiseLayer(180, 0.09, 101); // distant traffic and engines
    addNoiseLayer(760, 0.045, 211); // city air and footsteps
    addNoiseLayer(1250, 0.025, 307); // soft pedestrian crowd texture

    const wind = context.createBufferSource();
    wind.buffer = createNoiseBuffer(context, 4, 401);
    wind.loop = true;
    this.windFilter = context.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.35;
    this.windGain = context.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(master);
    wind.start();

    const engine = context.createOscillator();
    const engineGain = context.createGain();
    engine.type = 'triangle';
    engine.frequency.value = 54;
    engineGain.gain.value = 0.018;
    engine.connect(engineGain).connect(master);
    engine.start();
  }
}
