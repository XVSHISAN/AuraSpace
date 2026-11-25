import { SCENE_MAP } from './presets.js';

/**
 * 「静界 AuraSpace」全屏 HiDPI 60fps 动态场景渲染器
 * 8 套沉浸式实时生成视觉氛围，支持场景切换过渡、环形音频频谱与呼吸引导环。
 */
export class SceneCanvasRenderer {
  constructor(canvas, getVisualParams) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.getVisualParams = getVisualParams;

    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.rafId = null;
    this.lastTime = 0;
    this.elapsed = 0;

    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.ripples = [];
    this.lightningAlpha = 0;
    this.activeSceneId = null;
    this.transitionAlpha = 0;

    this.particles = this._createPools();
    this._onResize = this.resize.bind(this);
    this._onVisibility = () => {
      if (!document.hidden && !this.rafId) {
        this.lastTime = performance.now();
        this._loop(this.lastTime);
      }
    };

    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);
    this.resize();
  }

  _createPools() {
    const rainDrops = Array.from({ length: 120 }, () => ({
      x: Math.random(),
      y: Math.random(),
      len: 0.018 + Math.random() * 0.045,
      speed: 0.45 + Math.random() * 0.85,
      w: 0.8 + Math.random() * 1.4,
      alpha: 0.18 + Math.random() * 0.42,
    }));

    const windowBeads = Array.from({ length: 24 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 1.8 + Math.random() * 2.4,
      speed: 0.012 + Math.random() * 0.024,
      wobble: Math.random() * Math.PI * 2,
    }));

    const skyline = Array.from({ length: 18 }, (_, i) => ({
      x: i / 18,
      w: 1 / 18 + 0.008,
      h: 0.08 + ((i * 37) % 13) * 0.011,
      lit: i % 3 === 0,
      winY: 0.25 + ((i * 19) % 5) * 0.12,
    }));

    const bokeh = Array.from({ length: 24 }, () => ({
      x: Math.random(),
      y: 0.15 + Math.random() * 0.72,
      r: 18 + Math.random() * 58,
      hue: Math.random() < 0.55 ? 36 + Math.random() * 18 : 205 + Math.random() * 25,
      alpha: 0.06 + Math.random() * 0.11,
      phase: Math.random() * Math.PI * 2,
    }));

    const embers = Array.from({ length: 65 }, () => ({
      x: 0.2 + Math.random() * 0.6,
      y: 0.45 + Math.random() * 0.55,
      vy: 0.07 + Math.random() * 0.16,
      vx: (Math.random() - 0.5) * 0.03,
      r: 1.2 + Math.random() * 2.8,
      life: Math.random(),
      hue: 16 + Math.random() * 28,
    }));

    const dust = Array.from({ length: 58 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.012,
      vy: -0.008 - Math.random() * 0.012,
      r: 0.8 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
    }));

    const stars = Array.from({ length: 150 }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: 0.2 + Math.random() * 0.8,
      r: 0.6 + Math.random() * 1.7,
      phase: Math.random() * Math.PI * 2,
    }));

    const shootingStar = {
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      cooldown: 4 + Math.random() * 6,
    };

    const snow = Array.from({ length: 110 }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: 0.3 + Math.random() * 0.7,
      r: 1.0 + Math.random() * 2.5,
      phase: Math.random() * Math.PI * 2,
    }));

    const pines = Array.from({ length: 26 }, (_, i) => ({
      x: i / 25,
      h: 0.06 + ((i * 53) % 9) * 0.009,
      w: 0.025 + ((i * 17) % 4) * 0.006,
    }));

    const streaks = Array.from({ length: 26 }, () => ({
      x: Math.random(),
      y: 0.18 + Math.random() * 0.56,
      len: 0.08 + Math.random() * 0.26,
      speed: 0.7 + Math.random() * 1.6,
      hue: [325, 195, 42, 265][Math.floor(Math.random() * 4)],
      h: 2 + Math.random() * 4,
      alpha: 0.18 + Math.random() * 0.45,
    }));

    const trainPoles = Array.from({ length: 3 }, (_, i) => ({
      x: 0.3 + i * 0.55,
    }));

    const bubbles = Array.from({ length: 55 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 1.5 + Math.random() * 4.5,
      speed: 0.025 + Math.random() * 0.055,
      phase: Math.random() * Math.PI * 2,
    }));

    const jellies = Array.from({ length: 3 }, (_, i) => ({
      x: 0.2 + i * 0.3,
      y: 0.35 + i * 0.18,
      scale: 0.75 + i * 0.22,
      phase: i * 2.1,
      speed: 0.012 + i * 0.004,
    }));

    return {
      rainDrops,
      windowBeads,
      skyline,
      bokeh,
      embers,
      dust,
      stars,
      shootingStar,
      snow,
      pines,
      streaks,
      trainPoles,
      bubbles,
      jellies,
    };
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(320, window.innerWidth);
    this.height = Math.max(400, window.innerHeight);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setPointerNormalized(nx, ny) {
    this.pointer.tx = Math.max(-1, Math.min(1, nx));
    this.pointer.ty = Math.max(-1, Math.min(1, ny));
  }

  addRipple(x, y) {
    this.ripples.push({ x, y, r: 8, alpha: 0.5 });
    if (this.ripples.length > 8) this.ripples.shift();
  }

  triggerFlash(intensity = 0.65) {
    this.lightningAlpha = Math.max(this.lightningAlpha, Math.min(0.85, intensity));
  }

  start() {
    if (this.rafId) return;
    this.lastTime = performance.now();
    this._loop(this.lastTime);
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
  }

  _loop(now) {
    if (document.hidden) {
      this.rafId = null;
      return;
    }
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.elapsed += dt;

    this.pointer.x += (this.pointer.tx - this.pointer.x) * 0.08;
    this.pointer.y += (this.pointer.ty - this.pointer.y) * 0.08;
    this.lightningAlpha *= Math.pow(0.06, dt);

    const params = this.getVisualParams();
    if (this.activeSceneId !== null && params.sceneId !== this.activeSceneId) {
      this.transitionAlpha = 0.72;
    }
    this.activeSceneId = params.sceneId;
    if (this.transitionAlpha > 0) {
      this.transitionAlpha = Math.max(0, this.transitionAlpha - dt * 1.15);
    }

    this._render(dt, params);

    this.rafId = requestAnimationFrame((t) => this._loop(t));
  }

  _drawBackdrop(scene, energy) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, scene.bgTop);
    grad.addColorStop(1, scene.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 中央呼吸光晕（随音频能量与脑波节律微微起伏）
    const glowR = Math.max(w, h) * (0.42 + energy * 0.14);
    const radial = ctx.createRadialGradient(
      w * 0.5 + this.pointer.x * 24,
      h * 0.42 + this.pointer.y * 18,
      8,
      w * 0.5,
      h * 0.42,
      glowR
    );
    radial.addColorStop(0, scene.accentSoft);
    radial.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, w, h);
  }

  _render(dt, params) {
    const scene = SCENE_MAP[params.sceneId] || SCENE_MAP['rainy-window'];
    const energy = params.energy || 0;
    const tracks = params.tracks || {};
    const hz = params.hz || 0;

    this._drawBackdrop(scene, energy);

    switch (scene.id) {
      case 'rainy-window':
        this._drawRainyWindow(dt, tracks.rain ?? 0, energy);
        break;
      case 'fireside':
        this._drawFireside(dt, tracks.fire ?? 0, energy);
        break;
      case 'study':
        this._drawStudy(dt, energy);
        break;
      case 'orbital':
        this._drawOrbital(dt, hz, energy);
        break;
      case 'night-train':
        this._drawNightTrain(dt, tracks.train ?? 0, energy);
        break;
      case 'snowy-pines':
        this._drawSnowyPines(dt, tracks.wind ?? 0, energy);
        break;
      case 'abyss':
        this._drawAbyss(dt, tracks.ocean ?? 0, energy);
        break;
      case 'aurora-zen':
      default:
        this._drawAuroraZen(dt, hz, energy);
        break;
    }

    const cx = Number.isFinite(params.anchorX) ? params.anchorX : this.width * 0.5;
    const cy = Number.isFinite(params.anchorY) ? params.anchorY : this.height * 0.45;
    this._drawBrainwaveRing(hz, energy, scene.accent, cx, cy);
    if (params.spectrum) {
      this._drawSpectrumHalo(params.spectrum, energy, scene.accent, cx, cy);
    }
    if (params.breath && params.breath.active) {
      this._drawBreathGuide(params.breath, scene.accent, cx, cy);
    }
    this._drawRipples(dt, scene.accent);

    if (this.transitionAlpha > 0.005) {
      this.ctx.fillStyle = `rgba(6, 9, 19, ${this.transitionAlpha})`;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  _drawRainyWindow(dt, rainVol, energy) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const px = this.pointer.x * 18;
    const py = this.pointer.y * 12;

    // 远景城市虚化光斑
    for (const b of this.particles.bokeh) {
      const pulse = 0.78 + 0.22 * Math.sin(this.elapsed * 0.7 + b.phase);
      const bx = b.x * w + px * 0.6;
      const by = b.y * h + py * 0.6;
      const g = ctx.createRadialGradient(bx, by, 1, bx, by, b.r);
      g.addColorStop(0, `hsla(${b.hue}, 82%, 70%, ${b.alpha * pulse})`);
      g.addColorStop(1, `hsla(${b.hue}, 82%, 60%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, b.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 远景夜城模糊天际线剪影（柔和融入底部薄雾）
    ctx.fillStyle = 'rgba(5, 8, 18, 0.34)';
    for (const blk of this.particles.skyline) {
      const bx = blk.x * w + px * 0.25;
      const bw = blk.w * w;
      const bh = blk.h * h;
      ctx.fillRect(bx, h - bh, bw, bh);
      if (blk.lit) {
        ctx.fillStyle = 'rgba(251, 191, 36, 0.14)';
        ctx.fillRect(bx + bw * 0.35, h - bh * blk.winY, 4, 5);
        ctx.fillStyle = 'rgba(5, 8, 18, 0.34)';
      }
    }

    // 闪电远景微光
    if (this.lightningAlpha > 0.01) {
      ctx.fillStyle = `rgba(186, 214, 255, ${this.lightningAlpha * 0.26})`;
      ctx.fillRect(0, 0, w, h);
    }

    // 玻璃雨痕斜落
    const activeCount = Math.floor(10 + rainVol * 110);
    const speedScale = 0.4 + rainVol * 1.25 + energy * 0.35;
    ctx.lineCap = 'round';
    for (let i = 0; i < activeCount; i++) {
      const d = this.particles.rainDrops[i];
      d.y += d.speed * speedScale * dt;
      d.x -= 0.045 * d.speed * dt;
      if (d.y > 1.06) {
        d.y = -0.06;
        d.x = Math.random() * 1.1;
      }
      if (d.x < -0.06) d.x = 1.04;

      const x1 = d.x * w;
      const y1 = d.y * h;
      const len = d.len * h;
      ctx.strokeStyle = `rgba(186, 220, 255, ${d.alpha})`;
      ctx.lineWidth = d.w;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - len * 0.08, y1 + len);
      ctx.stroke();
    }

    // 附着在玻璃窗上的折射慢滑水珠
    const beadCount = Math.floor(3 + rainVol * 21);
    for (let i = 0; i < beadCount; i++) {
      const bd = this.particles.windowBeads[i];
      bd.y += bd.speed * (0.5 + rainVol) * dt;
      bd.x += Math.sin(this.elapsed * 0.9 + bd.wobble) * 0.003 * dt;
      if (bd.y > 1.04) {
        bd.y = -0.03;
        bd.x = Math.random();
      }
      const bx = bd.x * w;
      const by = bd.y * h;
      ctx.strokeStyle = 'rgba(186, 220, 255, 0.14)';
      ctx.lineWidth = bd.r * 0.7;
      ctx.beginPath();
      ctx.moveTo(bx, by - bd.r * 5);
      ctx.lineTo(bx, by);
      ctx.stroke();

      ctx.fillStyle = 'rgba(224, 242, 254, 0.42)';
      ctx.beginPath();
      ctx.arc(bx, by, bd.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawFireside(dt, fireVol, energy) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // 底部炉火暖光与炭床余辉
    const flicker = 0.86 + 0.14 * Math.sin(this.elapsed * 4.8) + energy * 0.22;
    const glow = 0.28 + 0.72 * fireVol;
    const g = ctx.createRadialGradient(w * 0.5, h * 0.98, 12, w * 0.5, h * 0.96, h * 0.72);
    g.addColorStop(0, `rgba(255, 146, 52, ${0.42 * flicker * glow})`);
    g.addColorStop(0.4, `rgba(217, 72, 15, ${0.18 * flicker * glow})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 柔和多层流动火光团（替代生硬多边形）
    const lobes = [
      { ox: -0.07, freq: 2.6, r: 0.24, c0: 'rgba(234, 88, 12, 0.26)', c1: 'rgba(234, 88, 12, 0)' },
      { ox: 0.06, freq: 3.1, r: 0.22, c0: 'rgba(251, 146, 60, 0.28)', c1: 'rgba(251, 146, 60, 0)' },
      { ox: 0, freq: 4.1, r: 0.16, c0: 'rgba(253, 210, 96, 0.22)', c1: 'rgba(253, 210, 96, 0)' },
    ];
    for (let f = 0; f < lobes.length; f++) {
      const lb = lobes[f];
      const swayX = Math.sin(this.elapsed * lb.freq + f * 1.3) * 26;
      const swayY = Math.cos(this.elapsed * (lb.freq * 0.8) + f) * 14;
      const lx = w * (0.5 + lb.ox) + swayX;
      const ly = h * 0.95 + swayY;
      const lr = Math.min(w, h) * lb.r * (0.5 + fireVol * 0.55 + energy * 0.2);
      const fg = ctx.createRadialGradient(lx, ly, 4, lx, ly, lr);
      fg.addColorStop(0, lb.c0);
      fg.addColorStop(1, lb.c1);
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(lx, ly, lr, 0, Math.PI * 2);
      ctx.fill();
    }

    // 上升火星余烬（带柔和微光晕）
    const count = Math.floor(10 + fireVol * 55);
    for (let i = 0; i < count; i++) {
      const e = this.particles.embers[i];
      e.y -= e.vy * (0.7 + fireVol * 0.7) * dt;
      e.x += (e.vx + Math.sin(this.elapsed * 2.5 + i) * 0.018) * dt;
      e.life += dt * 0.35;
      if (e.y < 0.08 || e.life > 1) {
        e.x = 0.22 + Math.random() * 0.56;
        e.y = 0.96 + Math.random() * 0.06;
        e.life = 0;
      }
      const alpha = Math.sin(e.life * Math.PI) * 0.82;
      const ex = e.x * w;
      const ey = e.y * h;
      ctx.fillStyle = `hsla(${e.hue}, 96%, 64%, ${alpha * 0.24})`;
      ctx.beginPath();
      ctx.arc(ex, ey, e.r * 2.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `hsla(${e.hue}, 96%, 72%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(ex, ey, e.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawStudy(dt, energy) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const apexX = w * 0.5 + this.pointer.x * 20;
    const apexY = 0;

    // 暖黄台灯光锥与顶部柔光晕（无遮挡实心黑块）
    const topHalo = ctx.createRadialGradient(apexX, 24, 6, apexX, 24, 180);
    topHalo.addColorStop(0, `rgba(255, 226, 150, ${0.32 + energy * 0.12})`);
    topHalo.addColorStop(0.45, 'rgba(245, 185, 66, 0.10)');
    topHalo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topHalo;
    ctx.beginPath();
    ctx.arc(apexX, 24, 180, 0, Math.PI * 2);
    ctx.fill();

    const cone = ctx.createLinearGradient(apexX, apexY, w * 0.5, h * 0.95);
    cone.addColorStop(0, `rgba(255, 214, 130, ${0.22 + energy * 0.08})`);
    cone.addColorStop(0.55, 'rgba(245, 185, 66, 0.07)');
    cone.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(apexX - 42, apexY);
    ctx.lineTo(apexX + 42, apexY);
    ctx.lineTo(w * 0.92, h);
    ctx.lineTo(w * 0.08, h);
    ctx.closePath();
    ctx.fill();

    // 浮尘粒子
    for (const d of this.particles.dust) {
      d.x += (d.vx + Math.sin(this.elapsed * 0.7 + d.phase) * 0.006) * dt;
      d.y += d.vy * dt;
      if (d.y < 0) d.y = 1;
      if (d.x < 0) d.x = 1;
      if (d.x > 1) d.x = 0;
      const alpha = 0.18 + 0.28 * Math.abs(Math.sin(this.elapsed + d.phase));
      ctx.fillStyle = `rgba(255, 224, 150, ${alpha})`;
      ctx.beginPath();
      ctx.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawShootingStar(dt) {
    const ss = this.particles.shootingStar;
    if (!ss.active) {
      ss.cooldown -= dt;
      if (ss.cooldown <= 0) {
        ss.active = true;
        ss.x = 0.2 + Math.random() * 0.6;
        ss.y = 0.06 + Math.random() * 0.22;
        ss.vx = 0.42 + Math.random() * 0.25;
        ss.vy = 0.16 + Math.random() * 0.12;
        ss.life = 1;
      }
      return;
    }
    ss.x += ss.vx * dt;
    ss.y += ss.vy * dt;
    ss.life -= dt * 1.15;
    if (ss.life <= 0) {
      ss.active = false;
      ss.cooldown = 6 + Math.random() * 9;
      return;
    }
    const ctx = this.ctx;
    const x1 = ss.x * this.width;
    const y1 = ss.y * this.height;
    const x0 = x1 - ss.vx * 110;
    const y0 = y1 - ss.vy * 110;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(255, 255, 255, 0)');
    g.addColorStop(1, `rgba(224, 242, 254, ${Math.min(0.85, ss.life)})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  _drawOrbital(dt, hz, energy) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    for (const s of this.particles.stars) {
      s.x -= 0.005 * s.z * dt;
      if (s.x < 0) s.x = 1;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(this.elapsed * 1.4 + s.phase));
      ctx.fillStyle = `rgba(210, 236, 255, ${tw * 0.8})`;
      ctx.beginPath();
      ctx.arc(s.x * w + this.pointer.x * 16 * s.z, s.y * h + this.pointer.y * 12 * s.z, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    this._drawShootingStar(dt);

    // 行星弧线地平线
    const planetR = Math.max(w, h) * 1.18;
    const py = h * 0.78 + planetR;
    const px = w * 0.5;
    const rim = ctx.createRadialGradient(px, py, planetR - 26, px, py, planetR + 36);
    rim.addColorStop(0, 'rgba(14, 165, 233, 0)');
    rim.addColorStop(0.45, `rgba(56, 189, 248, ${0.42 + energy * 0.25})`);
    rim.addColorStop(1, 'rgba(3, 6, 20, 0.96)');
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(px, py, planetR + 36, Math.PI * 1.1, Math.PI * 1.9);
    ctx.fill();

    // 行星暗面
    ctx.fillStyle = '#030712';
    ctx.beginPath();
    ctx.arc(px, py, planetR - 2, Math.PI * 1.08, Math.PI * 1.92);
    ctx.fill();

    if (hz > 0) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.42, w * 0.34, h * 0.08, -0.14, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _drawNightTrain(dt, trainVol, energy) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const speed = 0.3 + trainVol * 1.6 + energy * 0.3;

    // 站台与都市霓虹流光条
    for (const st of this.particles.streaks) {
      st.x -= st.speed * speed * dt;
      if (st.x < -0.35) {
        st.x = 1.15;
        st.y = 0.15 + Math.random() * 0.65;
      }
      const x = st.x * w;
      const y = st.y * h;
      const len = st.len * w;
      const g = ctx.createLinearGradient(x, y, x + len, y);
      const stAlpha = st.alpha * (0.3 + 0.7 * trainVol);
      g.addColorStop(0, `hsla(${st.hue}, 90%, 66%, 0)`);
      g.addColorStop(0.5, `hsla(${st.hue}, 90%, 66%, ${stAlpha})`);
      g.addColorStop(1, `hsla(${st.hue}, 90%, 66%, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, len, st.h);
    }

    // 掠过远景的柔和电线杆虚影（无全屏硬边框）
    for (const p of this.particles.trainPoles) {
      p.x -= speed * 1.35 * dt;
      if (p.x < -0.1) p.x = 1.2 + Math.random() * 0.5;
      const px = p.x * w;
      const pg = ctx.createLinearGradient(px - 6, 0, px + 14, 0);
      pg.addColorStop(0, 'rgba(5, 4, 12, 0)');
      pg.addColorStop(0.5, 'rgba(5, 4, 12, 0.22)');
      pg.addColorStop(1, 'rgba(5, 4, 12, 0)');
      ctx.fillStyle = pg;
      ctx.fillRect(px - 6, 0, 20, h);
    }
  }

  _drawSnowyPines(dt, windVol, energy) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // 顶部柔和北极光微幕
    const topGlow = ctx.createLinearGradient(0, 0, 0, h * 0.48);
    topGlow.addColorStop(0, `rgba(45, 212, 191, ${0.14 + energy * 0.08})`);
    topGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topGlow;
    ctx.fillRect(0, 0, w, h * 0.48);

    // 三重雾气远山层次
    const ridges = [
      { y: 0.62, amp: 0.10, color: 'rgba(15, 41, 52, 0.62)', shift: 0.2 },
      { y: 0.70, amp: 0.08, color: 'rgba(10, 30, 38, 0.78)', shift: 0.4 },
      { y: 0.79, amp: 0.05, color: 'rgba(6, 20, 26, 0.94)', shift: 0.65 },
    ];
    for (const r of ridges) {
      const px = this.pointer.x * 14 * r.shift;
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, h * r.y);
      ctx.lineTo(w * 0.22 + px, h * (r.y - r.amp));
      ctx.lineTo(w * 0.50 + px, h * (r.y + 0.03));
      ctx.lineTo(w * 0.78 + px, h * (r.y - r.amp * 1.1));
      ctx.lineTo(w, h * (r.y - 0.02));
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }

    // 近景松林树梢剪影
    ctx.fillStyle = 'rgba(4, 14, 18, 0.96)';
    for (const p of this.particles.pines) {
      const px = p.x * w + this.pointer.x * 12;
      const baseY = h * 0.95;
      const topY = baseY - p.h * h;
      const pw = p.w * w;
      ctx.beginPath();
      ctx.moveTo(px, topY);
      ctx.lineTo(px - pw, baseY);
      ctx.lineTo(px + pw, baseY);
      ctx.closePath();
      ctx.fill();
    }

    // 飘雪
    const windShift = 0.02 + windVol * 0.3;
    for (const s of this.particles.snow) {
      s.y += (0.045 + s.z * 0.08) * dt;
      s.x += (windShift * s.z + Math.sin(this.elapsed + s.phase) * 0.015) * dt;
      if (s.y > 1.04) s.y = -0.04;
      if (s.x > 1.04) s.x = -0.04;
      ctx.fillStyle = `rgba(224, 247, 250, ${0.28 + s.z * 0.48})`;
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawAbyss(dt, oceanVol, energy) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // 水下丁达尔光束
    for (let i = 0; i < 4; i++) {
      const sway = Math.sin(this.elapsed * 0.35 + i * 1.4) * 38;
      const sx = w * (0.2 + i * 0.2) + sway;
      const ray = ctx.createLinearGradient(sx, 0, sx + 90, h * 0.86);
      ray.addColorStop(0, `rgba(34, 211, 238, ${0.12 + energy * 0.06})`);
      ray.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(sx - 28, 0);
      ctx.lineTo(sx + 28, 0);
      ctx.lineTo(sx + 150, h * 0.88);
      ctx.lineTo(sx - 60, h * 0.88);
      ctx.closePath();
      ctx.fill();
    }

    // 半透明发光水母剪影
    for (const j of this.particles.jellies) {
      j.y -= j.speed * (0.7 + oceanVol * 0.5) * dt;
      if (j.y < -0.15) j.y = 1.12;
      const pulse = Math.sin(this.elapsed * 1.8 + j.phase);
      const jx = j.x * w + Math.sin(this.elapsed * 0.45 + j.phase) * 24;
      const jy = j.y * h;
      const r = 18 * j.scale * (0.55 + 0.45 * Math.min(1, oceanVol * 2)) * (1 + pulse * 0.08);

      ctx.save();
      ctx.fillStyle = 'rgba(103, 232, 249, 0.14)';
      ctx.strokeStyle = 'rgba(165, 243, 252, 0.28)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(jx, jy, r, Math.PI, 0);
      ctx.quadraticCurveTo(jx, jy + 5, jx - r, jy);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = 'rgba(103, 232, 249, 0.18)';
      for (let t = -2; t <= 2; t++) {
        ctx.beginPath();
        const tx0 = jx + t * r * 0.34;
        ctx.moveTo(tx0, jy + 2);
        ctx.quadraticCurveTo(
          tx0 + Math.sin(this.elapsed * 2 + t) * 7,
          jy + 20 * j.scale,
          tx0 + Math.cos(this.elapsed * 1.5 + t) * 5,
          jy + 40 * j.scale
        );
        ctx.stroke();
      }
      ctx.restore();
    }

    // 浮游微光气泡
    const swell = 1 + oceanVol * 0.8;
    for (const b of this.particles.bubbles) {
      b.y -= b.speed * swell * dt;
      b.x += Math.sin(this.elapsed * 0.9 + b.phase) * 0.01 * dt;
      if (b.y < -0.05) {
        b.y = 1.05;
        b.x = Math.random();
      }
      const alpha = 0.2 + 0.35 * Math.abs(Math.sin(this.elapsed * 1.5 + b.phase));
      ctx.fillStyle = `rgba(103, 232, 249, ${alpha})`;
      ctx.beginPath();
      ctx.arc(b.x * w, b.y * h, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawAuroraZen(dt, hz, energy) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    this._drawShootingStar(dt);

    // 多层流动丝绸极光带
    const bands = [
      { yBase: 0.30, hue: 268, amp: 36, speed: 0.42 },
      { yBase: 0.42, hue: 185, amp: 44, speed: 0.31 },
      { yBase: 0.54, hue: 305, amp: 28, speed: 0.52 },
    ];
    for (const b of bands) {
      ctx.save();
      ctx.beginPath();
      const base = h * b.yBase;
      ctx.moveTo(0, base);
      for (let x = 0; x <= w; x += 28) {
        const y =
          base +
          Math.sin(x * 0.005 + this.elapsed * b.speed) * (b.amp + energy * 24) +
          Math.cos(x * 0.011 - this.elapsed * 0.25) * 18;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, base - 45, 0, base + 170);
      g.addColorStop(0, `hsla(${b.hue}, 82%, 68%, ${0.14 + energy * 0.08})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    }
  }

  _drawBrainwaveRing(hz, energy, accent, anchorX, anchorY) {
    const ctx = this.ctx;
    const cx = anchorX + this.pointer.x * 8;
    const cy = anchorY + this.pointer.y * 6;
    const baseR = Math.max(78, Math.min(this.width, this.height) * 0.14);

    // 将高频脑波映射到舒适的视觉呼吸脉冲（最高约 2.2Hz，不刺眼）
    const pulseRate = hz > 0 ? Math.min(2.4, Math.max(0.45, hz * 0.06)) : 0.32;
    const breathe = Math.sin(this.elapsed * pulseRate * Math.PI * 2) * 0.5 + 0.5;
    const r = baseR + breathe * 10 + energy * 16;

    ctx.save();
    ctx.strokeStyle = accent;
    ctx.globalAlpha = hz > 0 ? 0.26 + breathe * 0.16 : 0.12;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = hz > 0 ? 0.12 + energy * 0.14 : 0.06;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _drawSpectrumHalo(spectrum, energy, accent, anchorX, anchorY) {
    const ctx = this.ctx;
    const cx = anchorX + this.pointer.x * 8;
    const cy = anchorY + this.pointer.y * 6;
    const innerR = Math.max(76, Math.min(this.width, this.height) * 0.16);
    const count = spectrum.length;
    if (!count) return;

    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < count; i++) {
      const mag = spectrum[i];
      if (mag < 0.02) continue;
      const angle = (i / count) * Math.PI * 2 - Math.PI * 0.5;
      const len = 3 + mag * (24 + energy * 12);
      ctx.globalAlpha = 0.16 + mag * 0.22;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
      ctx.lineTo(cx + Math.cos(angle) * (innerR + len), cy + Math.sin(angle) * (innerR + len));
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawBreathGuide(breath, accent, anchorX, anchorY) {
    const ctx = this.ctx;
    const cx = anchorX + this.pointer.x * 8;
    const cy = anchorY + this.pointer.y * 6;
    const minDim = Math.min(this.width, this.height);
    const scale = Math.max(0, Math.min(1, breath.scale || 0));
    const radius = Math.max(74, minDim * 0.13) + scale * Math.min(90, minDim * 0.14);

    ctx.save();
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.7, cx, cy, radius * 1.15);
    glow.addColorStop(0, 'rgba(0,0,0,0)');
    glow.addColorStop(0.6, breath.phase === 'hold' ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.09)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = accent;
    ctx.globalAlpha = breath.phase === 'hold' ? 0.72 : 0.48;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _drawRipples(dt, accent) {
    const ctx = this.ctx;
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.r += 155 * dt;
      rp.alpha -= 0.72 * dt;
      if (rp.alpha <= 0) {
        this.ripples.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = rp.alpha;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
