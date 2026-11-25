import { BRAINWAVE_MAP, TRACKS } from './presets.js';

/**
 * 「静界 AuraSpace」纯 WebAudio 程序化声景与双耳脑波合成引擎
 * 零外部音频文件依赖，内置立体声空间混响总线、动态防爆音限幅与实时频谱分析。
 */
export class AuraAudioEngine {
  constructor({ onThunderFlash } = {}) {
    this.ctx = null;
    this.masterGain = null;
    this.fadeGain = null;
    this.compressor = null;
    this.analyser = null;
    this.freqData = null;

    this.reverbSend = null;
    this.reverbNode = null;
    this.reverbWetGain = null;

    this.pinkBuffer = null;
    this.brownBuffer = null;

    this.trackNodes = new Map();
    this.trackVolumes = Object.fromEntries(TRACKS.map((t) => [t.id, 0]));

    this.binaural = null;
    this.brainwaveId = 'off';
    this.customHz = 10;

    this.playing = false;
    this.masterVolume = 0.82;
    this.fadeMultiplier = 1;
    this.smoothedEnergy = 0;
    this._spectrumOut = new Float32Array(36);

    this.onThunderFlash = typeof onThunderFlash === 'function' ? onThunderFlash : null;

    this._schedulers = new Set();
    this._lofiTimer = null;
    this._lofiChordIdx = 0;
  }

  /**
   * 必须在用户交互回调中调用，以确保 iOS / B站 WebView 下 AudioContext 正常解锁。
   */
  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this._buildMasterGraph();
      this._buildNoiseBuffers();
      this._buildAllTracks();
      this._buildBinaural();
      this._applyAllVolumes(true);
      this._applyBrainwave(true);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * 合成 1.8 秒立体声温暖室内混响脉冲响应（带高频自然衰减），让瞬态声景融入同一声学空间。
   */
  _buildReverbIR() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 1.8);
    const ir = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, 2.8) * Math.min(1, i / (sr * 0.012));
        const white = Math.random() * 2 - 1;
        lp = lp * 0.62 + white * 0.38;
        data[i] = lp * env * 0.55;
      }
    }
    return ir;
  }

  _buildMasterGraph() {
    const ctx = this.ctx;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.015;
    this.compressor.release.value = 0.25;

    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbNode = ctx.createConvolver();
    this.reverbNode.buffer = this._buildReverbIR();
    this.reverbWetGain = ctx.createGain();
    this.reverbWetGain.gain.value = 0.18;

    this.reverbSend.connect(this.reverbNode);
    this.reverbNode.connect(this.reverbWetGain);
    this.reverbWetGain.connect(this.compressor);

    this.fadeGain = ctx.createGain();
    this.fadeGain.gain.value = this.fadeMultiplier;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.playing ? this.masterVolume : 0;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.85;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

    this.compressor.connect(this.fadeGain);
    this.fadeGain.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }

  _buildNoiseBuffers() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const length = sr * 6; // 6 秒立体声循环缓冲，消除周期感

    this.pinkBuffer = ctx.createBuffer(2, length, sr);
    this.brownBuffer = ctx.createBuffer(2, length, sr);

    const fadeSamples = Math.floor(sr * 0.25);

    for (let ch = 0; ch < 2; ch++) {
      const pink = this.pinkBuffer.getChannelData(ch);
      const brown = this.brownBuffer.getChannelData(ch);

      // Paul Kellet 粉红噪声滤波器
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      let lastBrown = 0;

      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pSample = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.048;
        b6 = white * 0.115926;
        pink[i] = Math.max(-0.95, Math.min(0.95, pSample));

        lastBrown = (lastBrown + 0.022 * white) / 1.022;
        brown[i] = Math.max(-0.95, Math.min(0.95, lastBrown * 2.8));
      }

      // 首尾平滑交叉淡变，确保循环无爆音
      for (let i = 0; i < fadeSamples; i++) {
        const t = i / fadeSamples;
        const w1 = Math.sin(t * Math.PI * 0.5);
        const w2 = Math.cos(t * Math.PI * 0.5);
        const tailIdx = length - fadeSamples + i;
        pink[i] = pink[i] * w1 + pink[tailIdx] * w2;
        brown[i] = brown[i] * w1 + brown[tailIdx] * w2;
      }
    }
  }

  _makeLoopedNoise(buffer, playbackRate = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = playbackRate;
    src.start(0, Math.random() * 3);
    return src;
  }

  _buildAllTracks() {
    this._buildRainTrack();
    this._buildThunderTrack();
    this._buildFireTrack();
    this._buildLibraryTrack();
    this._buildTrainTrack();
    this._buildWindTrack();
    this._buildOceanTrack();
    this._buildLofiTrack();
  }

  _registerTrack(id, gainNode, reverbAmount = 0) {
    gainNode.gain.value = 0;
    gainNode.connect(this.compressor);
    if (reverbAmount > 0 && this.reverbSend) {
      const send = this.ctx.createGain();
      send.gain.value = reverbAmount;
      gainNode.connect(send);
      send.connect(this.reverbSend);
    }
    this.trackNodes.set(id, gainNode);
  }

  _buildRainTrack() {
    const ctx = this.ctx;
    const bus = ctx.createGain();

    // 主体细雨层 + 慢速疏密起伏 LFO
    const src = this._makeLoopedNoise(this.pinkBuffer, 1.0);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 260;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4000;

    const rainLfo = ctx.createOscillator();
    rainLfo.frequency.value = 0.07;
    const rainLfoDepth = ctx.createGain();
    rainLfoDepth.gain.value = 800;
    rainLfo.connect(rainLfoDepth);
    rainLfoDepth.connect(lp.frequency);
    rainLfo.start();

    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 3200;
    shelf.gain.value = -3.8;

    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.58;

    src.connect(hp);
    hp.connect(lp);
    lp.connect(shelf);
    shelf.connect(bedGain);
    bedGain.connect(bus);

    // 远檐低频雨幕
    const lowSrc = this._makeLoopedNoise(this.brownBuffer, 0.95);
    const lowLp = ctx.createBiquadFilter();
    lowLp.type = 'lowpass';
    lowLp.frequency.value = 360;
    const lowGain = ctx.createGain();
    lowGain.gain.value = 0.24;
    lowSrc.connect(lowLp);
    lowLp.connect(lowGain);
    lowGain.connect(bus);

    this._registerTrack('rain', bus, 0.22);

    // 写实雨滴微冲击：高 Q 窄带噪声脉冲 + 极少数轻柔水泡共振
    this._startStochasticLoop('rain', 110, 360, () => {
      const now = ctx.currentTime;
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      pan.connect(bus);

      const drop = ctx.createBufferSource();
      drop.buffer = this.pinkBuffer;
      drop.playbackRate.value = 1.3 + Math.random() * 0.5;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400 + Math.random() * 3200;
      bp.Q.value = 4 + Math.random() * 4;

      const dur = 0.008 + Math.random() * 0.01;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.08 + Math.random() * 0.12, now + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      drop.connect(bp);
      bp.connect(g);
      g.connect(pan);
      drop.start(now, Math.random() * 4);
      drop.stop(now + dur + 0.015);

      if (Math.random() < 0.2) {
        const osc = ctx.createOscillator();
        const og = ctx.createGain();
        const base = 680 + Math.random() * 820;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(base, now);
        osc.frequency.exponentialRampToValueAtTime(base * 1.24, now + 0.028);

        og.gain.setValueAtTime(0.0001, now);
        og.gain.linearRampToValueAtTime(0.008 + Math.random() * 0.006, now + 0.004);
        og.gain.exponentialRampToValueAtTime(0.0001, now + 0.036);

        osc.connect(og);
        og.connect(pan);
        osc.start(now);
        osc.stop(now + 0.045);
      }
    });
  }

  _buildThunderTrack() {
    const ctx = this.ctx;
    const bus = ctx.createGain();

    // 极轻的暴风雨前压迫底噪
    const ambient = this._makeLoopedNoise(this.brownBuffer, 0.72);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 95;
    const ambGain = ctx.createGain();
    ambGain.gain.value = 0.16;
    ambient.connect(lp);
    lp.connect(ambGain);
    ambGain.connect(bus);

    this._registerTrack('thunder', bus, 0.28);

    this._triggerThunder = () => {
      if (!this.ctx || this.ctx.state !== 'running' || !this.playing || (this.trackVolumes.thunder || 0) <= 0.02) return;
      const now = ctx.currentTime;
      const dur = 3.6 + Math.random() * 2.8;
      const src = ctx.createBufferSource();
      src.buffer = this.brownBuffer;
      src.loop = true;
      src.playbackRate.value = 0.65 + Math.random() * 0.25;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(160, now);
      filter.frequency.exponentialRampToValueAtTime(52, now + dur);

      const env = ctx.createGain();
      const peak = 0.75 + Math.random() * 0.45;
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(peak, now + 0.18);
      env.gain.linearRampToValueAtTime(peak * 0.45, now + 0.75);
      env.gain.linearRampToValueAtTime(peak * 0.82, now + 1.15);
      env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.1 - 0.55;

      src.connect(filter);
      filter.connect(env);
      env.connect(pan);
      pan.connect(bus);

      src.start(now, Math.random() * 3);
      src.stop(now + dur + 0.1);

      if (this.onThunderFlash) {
        this.onThunderFlash(0.45 + Math.random() * 0.45);
      }
    };

    this._startStochasticLoop('thunder', 5500, 12500, () => {
      this._triggerThunder();
    });
  }

  _buildFireTrack() {
    const ctx = this.ctx;
    const bus = ctx.createGain();

    // 暖意炭火低频烘托
    const src = this._makeLoopedNoise(this.brownBuffer, 0.88);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.55;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.14;

    const baseGain = ctx.createGain();
    baseGain.gain.value = 0.62;
    lfo.connect(lfoGain);
    lfoGain.connect(baseGain.gain);
    lfo.start();

    src.connect(lp);
    lp.connect(baseGain);
    baseGain.connect(bus);

    // 中频火舌舔舐与热浪气流层
    const flameSrc = this._makeLoopedNoise(this.pinkBuffer, 0.94);
    const flameBp = ctx.createBiquadFilter();
    flameBp.type = 'bandpass';
    flameBp.frequency.value = 520;
    flameBp.Q.value = 1.4;

    const flameLfoA = ctx.createOscillator();
    flameLfoA.frequency.value = 0.37;
    const flameDepthA = ctx.createGain();
    flameDepthA.gain.value = 0.1;
    flameLfoA.connect(flameDepthA);

    const flameLfoB = ctx.createOscillator();
    flameLfoB.frequency.value = 0.83;
    const flameDepthB = ctx.createGain();
    flameDepthB.gain.value = 0.08;
    flameLfoB.connect(flameDepthB);

    const flameGain = ctx.createGain();
    flameGain.gain.value = 0.3;
    flameDepthA.connect(flameGain.gain);
    flameDepthB.connect(flameGain.gain);
    flameLfoA.start();
    flameLfoB.start();

    flameSrc.connect(flameBp);
    flameBp.connect(flameGain);
    flameGain.connect(bus);

    this._registerTrack('fire', bus, 0.22);

    // 木柴噼啪火星爆裂声
    this._startStochasticLoop('fire', 70, 330, () => {
      const now = ctx.currentTime;
      const noise = ctx.createBufferSource();
      noise.buffer = this.pinkBuffer;
      noise.playbackRate.value = 1.6;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800 + Math.random() * 2800;
      bp.Q.value = 2.8 + Math.random() * 3;

      const env = ctx.createGain();
      const dur = 0.012 + Math.random() * 0.022;
      const amp = 0.24 + Math.random() * 0.6;
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(amp, now + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.4 - 0.7;

      noise.connect(bp);
      bp.connect(env);
      env.connect(pan);
      pan.connect(bus);

      noise.start(now, Math.random() * 4);
      noise.stop(now + dur + 0.02);
    });
  }

  _buildLibraryTrack() {
    const ctx = this.ctx;
    const bus = ctx.createGain();

    // 温暖房间底噪
    const src = this._makeLoopedNoise(this.pinkBuffer, 0.9);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 110;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;

    const roomGain = ctx.createGain();
    roomGain.gain.value = 0.24;

    src.connect(hp);
    hp.connect(lp);
    lp.connect(roomGain);
    roomGain.connect(bus);

    this._registerTrack('library', bus, 0.16);

    // 柔和木质挂钟秒针、翻页声与轻微铅笔书写沙沙声
    let tickCount = 0;
    this._startStochasticLoop('library', 980, 1020, () => {
      const now = ctx.currentTime;
      tickCount++;

      // 经低通柔化的木质时钟秒针
      const osc = ctx.createOscillator();
      const clockLp = ctx.createBiquadFilter();
      clockLp.type = 'lowpass';
      clockLp.frequency.value = 1400;
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(tickCount % 2 === 0 ? 620 : 540, now);
      osc.frequency.exponentialRampToValueAtTime(190, now + 0.016);

      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.018, now + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);

      osc.connect(clockLp);
      clockLp.connect(g);
      g.connect(bus);
      osc.start(now);
      osc.stop(now + 0.028);

      // 每隔约 7~12 秒出现一次轻柔翻纸声
      if (tickCount % (7 + Math.floor(Math.random() * 6)) === 0) {
        const paper = ctx.createBufferSource();
        paper.buffer = this.pinkBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1500, now);
        bp.frequency.linearRampToValueAtTime(3200, now + 0.17);
        bp.Q.value = 1.5;

        const pg = ctx.createGain();
        pg.gain.setValueAtTime(0.0001, now);
        pg.gain.linearRampToValueAtTime(0.14, now + 0.05);
        pg.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.random() * 0.9 - 0.45;

        paper.connect(bp);
        bp.connect(pg);
        pg.connect(pan);
        pan.connect(bus);
        paper.start(now, Math.random() * 3);
        paper.stop(now + 0.28);
      } else if (tickCount % 5 === 0 && Math.random() < 0.48) {
        // 偶发细腻铅笔落纸书写声（3-4 个连贯微笔画）
        const strokes = 3 + Math.floor(Math.random() * 2);
        const panVal = Math.random() * 0.6 - 0.3;
        for (let s = 0; s < strokes; s++) {
          const st = now + 0.12 + s * (0.09 + Math.random() * 0.04);
          const pen = ctx.createBufferSource();
          pen.buffer = this.pinkBuffer;
          const pbp = ctx.createBiquadFilter();
          pbp.type = 'bandpass';
          pbp.frequency.value = 2400 + Math.random() * 1800;
          pbp.Q.value = 2.4;

          const penG = ctx.createGain();
          penG.gain.setValueAtTime(0.0001, st);
          penG.gain.linearRampToValueAtTime(0.045 + Math.random() * 0.025, st + 0.012);
          penG.gain.exponentialRampToValueAtTime(0.0001, st + 0.065);

          const ppan = ctx.createStereoPanner();
          ppan.pan.value = panVal;

          pen.connect(pbp);
          pbp.connect(penG);
          penG.connect(ppan);
          ppan.connect(bus);
          pen.start(st, Math.random() * 4);
          pen.stop(st + 0.075);
        }
      }
    });
  }

  _buildTrainTrack() {
    const ctx = this.ctx;
    const bus = ctx.createGain();

    // 车厢平稳低鸣（隧道共鸣可控滤波器）
    const src = this._makeLoopedNoise(this.brownBuffer, 1.05);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 0.8;

    const cabinGain = ctx.createGain();
    cabinGain.gain.value = 0.56;
    src.connect(lp);
    lp.connect(cabinGain);
    cabinGain.connect(bus);

    this._registerTrack('train', bus, 0.14);

    // 真实四拍转向架过轨缝节奏：0, 0.15, 0.62, 0.77s
    this._startStochasticLoop('train', 2150, 2350, () => {
      const now = ctx.currentTime;
      const beats = [
        { offset: 0, freq: 150, amp: 0.58 },
        { offset: 0.15, freq: 190, amp: 0.42 },
        { offset: 0.62, freq: 145, amp: 0.54 },
        { offset: 0.77, freq: 185, amp: 0.39 },
      ];
      for (const b of beats) {
        const t = now + b.offset;
        const hit = ctx.createBufferSource();
        hit.buffer = this.brownBuffer;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = b.freq;
        bp.Q.value = 2.4;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(b.amp, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.115);

        hit.connect(bp);
        bp.connect(g);
        g.connect(bus);
        hit.start(t, Math.random() * 3);
        hit.stop(t + 0.14);
      }
    });

    // 偶发远景过隧道低频共鸣呼啸（每 18-30 秒一次）
    this._startStochasticLoop('train', 18000, 30000, () => {
      const now = ctx.currentTime;
      lp.frequency.setValueAtTime(220, now);
      lp.frequency.linearRampToValueAtTime(360, now + 0.9);
      lp.frequency.linearRampToValueAtTime(160, now + 2.6);
      lp.frequency.linearRampToValueAtTime(220, now + 3.6);
      lp.Q.setValueAtTime(0.8, now);
      lp.Q.linearRampToValueAtTime(2.6, now + 1.2);
      lp.Q.linearRampToValueAtTime(0.8, now + 3.6);
    });
  }

  _buildWindTrack() {
    const ctx = this.ctx;
    const bus = ctx.createGain();

    const configs = [
      { freq: 310, q: 2.8, lfoHz: 0.085, span: 150, pan: -0.45, vol: 0.52 },
      { freq: 560, q: 3.2, lfoHz: 0.135, span: 230, pan: 0.45, vol: 0.36 },
    ];

    for (const cfg of configs) {
      const src = this._makeLoopedNoise(this.pinkBuffer, 0.96 + Math.random() * 0.08);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = cfg.freq;
      bp.Q.value = cfg.q;

      const lfo = ctx.createOscillator();
      lfo.frequency.value = cfg.lfoHz;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = cfg.span;
      lfo.connect(lfoDepth);
      lfoDepth.connect(bp.frequency);
      lfo.start();

      const pan = ctx.createStereoPanner();
      pan.pan.value = cfg.pan;

      const g = ctx.createGain();
      g.gain.value = cfg.vol;

      src.connect(bp);
      bp.connect(g);
      g.connect(pan);
      pan.connect(bus);
    }

    this._registerTrack('wind', bus, 0.18);
  }

  _buildOceanTrack() {
    const ctx = this.ctx;
    const bus = ctx.createGain();

    // 慢呼吸海浪涌动（约 9 秒一个潮汐周期）
    const src = this._makeLoopedNoise(this.pinkBuffer, 0.92);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 540;

    const swellGain = ctx.createGain();
    swellGain.gain.value = 0.46;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const freqMod = ctx.createGain();
    freqMod.gain.value = 420;
    const gainMod = ctx.createGain();
    gainMod.gain.value = 0.28;

    lfo.connect(freqMod);
    freqMod.connect(lp.frequency);
    lfo.connect(gainMod);
    gainMod.connect(swellGain.gain);
    lfo.start();

    src.connect(lp);
    lp.connect(swellGain);
    swellGain.connect(bus);

    // 深海潜流低频
    const deep = this._makeLoopedNoise(this.brownBuffer, 0.8);
    const deepLp = ctx.createBiquadFilter();
    deepLp.type = 'lowpass';
    deepLp.frequency.value = 140;
    const deepGain = ctx.createGain();
    deepGain.gain.value = 0.34;
    deep.connect(deepLp);
    deepLp.connect(deepGain);
    deepGain.connect(bus);

    this._registerTrack('ocean', bus, 0.2);
  }

  _buildLofiTrack() {
    const ctx = this.ctx;
    const bus = ctx.createGain();

    // 更暖更低沉的子铺底和弦 + 立体声延迟总线
    const padLp = ctx.createBiquadFilter();
    padLp.type = 'lowpass';
    padLp.frequency.value = 520;
    padLp.Q.value = 0.6;

    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.42;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.36;

    padLp.connect(bus);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wetGain);
    wetGain.connect(bus);

    // 柔和四音符和弦垫（Fmaj9 -> Em7 -> Dm9 -> Cmaj9）
    const chords = [
      [174.61, 220.0, 261.63, 329.63],
      [164.81, 196.0, 246.94, 293.66],
      [146.83, 174.61, 220.0, 329.63],
      [130.81, 196.0, 246.94, 293.66],
    ];

    const voices = chords[0].map((freq, idx) => {
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      oscA.type = 'triangle';
      oscB.type = 'sine';
      oscA.frequency.value = freq;
      oscB.frequency.value = freq * 1.003;

      const vg = ctx.createGain();
      vg.gain.value = 0.045;

      const pan = ctx.createStereoPanner();
      pan.pan.value = (idx - 1.5) * 0.28;

      oscA.connect(vg);
      oscB.connect(vg);
      vg.connect(pan);
      pan.connect(padLp);

      oscA.start();
      oscB.start();
      return { oscA, oscB };
    });

    this._lofiTimer = window.setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running' || !this.playing || (this.trackVolumes.lofi || 0) <= 0.02) return;
      this._lofiChordIdx = (this._lofiChordIdx + 1) % chords.length;
      const next = chords[this._lofiChordIdx];
      const now = ctx.currentTime;
      voices.forEach((v, i) => {
        v.oscA.frequency.setTargetAtTime(next[i], now, 0.9);
        v.oscB.frequency.setTargetAtTime(next[i] * 1.0035, now, 0.9);
      });
    }, 6800);

    // 生成式柔音 Rhodes / 风铃琶音：跟随当前和弦随机落音，赋予生命感
    const bellLp = ctx.createBiquadFilter();
    bellLp.type = 'lowpass';
    bellLp.frequency.value = 1200;
    bellLp.connect(bus);
    bellLp.connect(delay);

    this._startStochasticLoop('lofi', 2800, 4600, () => {
      const chord = chords[this._lofiChordIdx];
      const notesCount = Math.random() < 0.45 ? 2 : 1;
      const now = ctx.currentTime;
      for (let n = 0; n < notesCount; n++) {
        const t = now + n * (0.28 + Math.random() * 0.22);
        const rawFreq = chord[Math.floor(Math.random() * chord.length)];
        const freq = rawFreq * (Math.random() < 0.65 ? 2 : 1);

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(freq, t);
        osc2.frequency.setValueAtTime(freq * 2, t);

        const g1 = ctx.createGain();
        const g2 = ctx.createGain();
        g1.gain.setValueAtTime(0.0001, t);
        g1.gain.linearRampToValueAtTime(0.11, t + 0.04);
        g1.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);

        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.linearRampToValueAtTime(0.028, t + 0.025);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);

        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.random() * 1.2 - 0.6;

        osc1.connect(g1);
        osc2.connect(g2);
        g1.connect(pan);
        g2.connect(pan);
        pan.connect(bellLp);

        osc1.start(t);
        osc2.start(t);
        osc1.stop(t + 3.3);
        osc2.stop(t + 1.3);
      }
    });

    this._registerTrack('lofi', bus, 0.34);
  }

  _buildBinaural() {
    const ctx = this.ctx;
    const oscL = ctx.createOscillator();
    const oscR = ctx.createOscillator();
    oscL.type = 'sine';
    oscR.type = 'sine';

    const merger = ctx.createChannelMerger(2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 460;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    oscL.connect(merger, 0, 0);
    oscR.connect(merger, 0, 1);
    merger.connect(lp);
    lp.connect(gain);
    gain.connect(this.compressor);

    oscL.start();
    oscR.start();

    this.binaural = { oscL, oscR, gain };
  }

  _startStochasticLoop(trackId, minDelayMs, maxDelayMs, callback) {
    let alive = true;
    let currentId = null;
    const tick = () => {
      // 已触发的定时器 id 及时出队，避免长时间播放时集合无限增长
      if (currentId !== null) {
        this._schedulers.delete(currentId);
        currentId = null;
      }
      if (!alive) return;
      if (this.ctx && this.ctx.state === 'running' && this.playing && (this.trackVolumes[trackId] || 0) > 0.02) {
        try {
          callback();
        } catch (_) {
          // 忽略偶发调度异常
        }
      }
      const wait = minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
      currentId = window.setTimeout(tick, wait);
      this._schedulers.add(currentId);
    };
    currentId = window.setTimeout(tick, 350 + Math.random() * 500);
    this._schedulers.add(currentId);
    return () => {
      alive = false;
    };
  }

  setPlaying(nextPlaying) {
    this.playing = Boolean(nextPlaying);
    if (this.playing) {
      this.ensureContext();
    }
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const target = this.playing ? this.masterVolume : 0;
    this.masterGain.gain.setTargetAtTime(target, now, 0.14);
  }

  setMasterVolume(vol) {
    this.masterVolume = Math.max(0, Math.min(1, Number(vol) || 0));
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.playing ? this.masterVolume : 0, now, 0.08);
  }

  setSleepFadeMultiplier(mult) {
    this.fadeMultiplier = Math.max(0, Math.min(1, Number(mult) || 0));
    if (!this.ctx || !this.fadeGain) return;
    const now = this.ctx.currentTime;
    this.fadeGain.gain.cancelScheduledValues(now);
    this.fadeGain.gain.setTargetAtTime(this.fadeMultiplier, now, 0.12);
  }

  /**
   * 在音频时钟上预排睡眠淡出：即使页面切后台导致 JS 定时器被节流，淡出依然准时平滑。
   */
  scheduleSleepFade(totalSeconds, fadeSeconds) {
    const ctx = this.ensureContext();
    if (!ctx || !this.fadeGain) return;
    const now = ctx.currentTime;
    const safeTotal = Math.max(0.2, Number(totalSeconds) || 0.2);
    const fade = Math.max(1, Math.min(fadeSeconds, safeTotal));
    const fadeStart = now + Math.max(0, safeTotal - fade);
    const g = this.fadeGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(1, now);
    g.setValueAtTime(1, fadeStart);
    g.linearRampToValueAtTime(0.0001, now + safeTotal);
    this.fadeMultiplier = 1;
  }

  cancelSleepFade() {
    this.setSleepFadeMultiplier(1);
  }

  /**
   * 睡眠渐弱结束时立即归零主增益再复位淡出总线，避免 fadeGain 回弹造成短暂“回响”。
   */
  stopAfterSleepFade() {
    this.playing = false;
    this.fadeMultiplier = 1;
    if (!this.ctx || !this.masterGain || !this.fadeGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(0, now);
    this.fadeGain.gain.cancelScheduledValues(now);
    this.fadeGain.gain.setValueAtTime(1, now);
  }

  setTrackVolume(id, vol) {
    const clamped = Math.max(0, Math.min(1, Number(vol) || 0));
    const prev = this.trackVolumes[id] || 0;
    this.trackVolumes[id] = clamped;

    if (!this.ctx) return;
    const node = this.trackNodes.get(id);
    if (node) {
      // 平方响应让推子前段更细腻
      const curved = clamped * clamped * 0.92;
      node.gain.setTargetAtTime(curved, this.ctx.currentTime, 0.09);
    }
    if (id === 'thunder' && prev <= 0.02 && clamped > 0.05 && this.playing) {
      window.setTimeout(() => this._triggerThunder?.(), 240);
    }
  }

  applyMix(mix) {
    if (!mix) return;
    for (const t of TRACKS) {
      this.setTrackVolume(t.id, mix.tracks?.[t.id] ?? 0);
    }
    this.setBrainwave(mix.brainwave || 'off', mix.customHz);
  }

  _applyAllVolumes(immediate = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const t of TRACKS) {
      const vol = this.trackVolumes[t.id] || 0;
      const node = this.trackNodes.get(t.id);
      if (!node) continue;
      const curved = vol * vol * 0.92;
      if (immediate) {
        node.gain.setValueAtTime(curved, now);
      } else {
        node.gain.setTargetAtTime(curved, now, 0.09);
      }
    }
  }

  setBrainwave(modeId, customHz) {
    this.brainwaveId = BRAINWAVE_MAP[modeId] ? modeId : 'off';
    const bw = BRAINWAVE_MAP[this.brainwaveId];
    const parsedHz = Number(customHz);
    if (Number.isFinite(parsedHz) && parsedHz >= 1 && parsedHz <= 45) {
      this.customHz = parsedHz;
    } else if (bw && bw.hz > 0) {
      this.customHz = bw.hz;
    }
    this._applyBrainwave(false);
  }

  _applyBrainwave(immediate = false) {
    if (!this.ctx || !this.binaural) return;
    const now = this.ctx.currentTime;
    const bw = BRAINWAVE_MAP[this.brainwaveId];
    const { oscL, oscR, gain } = this.binaural;

    if (!bw || bw.id === 'off') {
      if (immediate) gain.gain.setValueAtTime(0, now);
      else gain.gain.setTargetAtTime(0, now, 0.15);
      return;
    }

    const base = bw.baseFreq || 180;
    const beat = Math.max(1, Math.min(45, this.customHz || bw.hz || 10));
    if (immediate) {
      oscL.frequency.setValueAtTime(base, now);
      oscR.frequency.setValueAtTime(base + beat, now);
      gain.gain.setValueAtTime(0.068, now);
    } else {
      oscL.frequency.setTargetAtTime(base, now, 0.15);
      oscR.frequency.setTargetAtTime(base + beat, now, 0.15);
      gain.gain.setTargetAtTime(0.068, now, 0.25);
    }
  }

  /**
   * 专注番茄钟完成时的程序化颂钵提醒声（直通输出并送入空间混响）
   */
  playBowlChime() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const chimeBus = ctx.createGain();
    chimeBus.gain.value = Math.max(0.25, this.masterVolume) * 0.9;
    chimeBus.connect(ctx.destination);
    let send = null;
    if (this.reverbSend) {
      send = ctx.createGain();
      send.gain.value = 0.45;
      chimeBus.connect(send);
      send.connect(this.reverbSend);
    }

    const partials = [
      { freq: 220, amp: 0.18, dur: 4.4 },
      { freq: 607, amp: 0.085, dur: 3.1 },
      { freq: 1188, amp: 0.032, dur: 1.9 },
    ];
    for (let i = 0; i < partials.length; i++) {
      const p = partials[i];
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.freq, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(p.amp, now + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, now + p.dur);
      osc.connect(g);
      g.connect(chimeBus);
      if (i === 0) {
        osc.onended = () => {
          try {
            chimeBus.disconnect();
            send?.disconnect();
          } catch (_) {
            // 忽略已断开的节点
          }
        };
      }
      osc.start(now);
      osc.stop(now + p.dur + 0.06);
    }
  }

  /**
   * 供 Canvas 渲染器读取的平滑音频能量 [0, 1]
   */
  getEnergy() {
    if (!this.analyser || !this.freqData || !this.playing) {
      this.smoothedEnergy *= 0.92;
      return this.smoothedEnergy;
    }
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    const count = Math.min(24, this.freqData.length);
    for (let i = 0; i < count; i++) sum += this.freqData[i];
    const raw = Math.min(1, sum / (count * 128));
    this.smoothedEnergy = this.smoothedEnergy * 0.82 + raw * 0.18;
    return this.smoothedEnergy;
  }

  /**
   * 返回零分配对称平滑归一化频谱 [0, 1]，确保 360° 环形光晕左右对称
   */
  getSpectrum(barCount = 36) {
    if (this._spectrumOut.length !== barCount) {
      this._spectrumOut = new Float32Array(barCount);
    }
    const out = this._spectrumOut;
    if (!this.analyser || !this.freqData || !this.playing) {
      for (let i = 0; i < barCount; i++) {
        out[i] *= 0.9;
      }
      return out;
    }
    this.analyser.getByteFrequencyData(this.freqData);
    const half = Math.ceil(barCount / 2);
    const activeBins = Math.min(20, this.freqData.length);
    for (let i = 0; i < half; i++) {
      const bin = Math.min(activeBins - 1, Math.floor((i * activeBins) / half));
      const raw = Math.min(1, this.freqData[bin] / 170);
      const shaped = Math.max(0.08, Math.pow(raw, 0.65));
      const smoothed = out[i] * 0.76 + shaped * 0.24;
      out[i] = smoothed;
      const mirrorIdx = barCount - 1 - i;
      if (mirrorIdx !== i) {
        out[mirrorIdx] = smoothed;
      }
    }
    return out;
  }

  destroy() {
    for (const id of this._schedulers) window.clearTimeout(id);
    this._schedulers.clear();
    if (this._lofiTimer) window.clearInterval(this._lofiTimer);
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
