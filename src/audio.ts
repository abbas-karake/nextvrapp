export type EffectKind = 'step' | 'jump' | 'land';

function seededNoise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

export function synthesizeEffect(kind: EffectKind, sampleRate = 22050): Float32Array {
  const duration = kind === 'step' ? 0.14 : kind === 'jump' ? 0.26 : 0.22;
  const samples = new Float32Array(Math.max(1, Math.floor(sampleRate * duration)));
  const noise = seededNoise(kind === 'step' ? 7 : kind === 'jump' ? 19 : 31);
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    const progress = index / samples.length;
    const envelope = (1 - progress) ** (kind === 'step' ? 3.2 : 2.2);
    let value: number;
    if (kind === 'jump') {
      const frequency = 150 + progress * 250;
      value = Math.sin(Math.PI * 2 * frequency * time) * 0.38 + noise() * 0.06;
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
    const samples = synthesizeEffect(kind, context.sampleRate);
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = kind === 'step' ? 0.2 : kind === 'jump' ? 0.28 : 0.34;
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

    const engine = context.createOscillator();
    const engineGain = context.createGain();
    engine.type = 'triangle';
    engine.frequency.value = 54;
    engineGain.gain.value = 0.018;
    engine.connect(engineGain).connect(master);
    engine.start();
  }
}
