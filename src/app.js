import { CONFIG } from './config.js';
import {
  BRAINWAVES,
  BRAINWAVE_MAP,
  BREATH_MAP,
  BREATH_MODES,
  PRESETS,
  PRESET_MAP,
  RECIPE_NAME_TAGS,
  SCENES,
  SCENE_MAP,
  TRACKS,
  TRACK_MAP,
  createEmptyTracks,
  decodeMix,
  encodeMix,
  generateHarmoniousMix,
  mixUsesPro,
  normalizeMixState,
} from './presets.js';
import { AuraAudioEngine } from './audio-engine.js';
import { SceneCanvasRenderer } from './scene-canvas.js';
import { ToyBridge } from './toy-bridge.js';
import { renderRecipeCard } from './card-export.js';

const dom = {
  shell: document.getElementById('appShell'),
  canvas: document.getElementById('sceneCanvas'),
  brandSub: document.getElementById('brandSub'),
  proBtn: document.getElementById('proBtn'),
  proBtnLabel: document.getElementById('proBtnLabel'),
  breathBtn: document.getElementById('breathBtn'),
  breathBtnLabel: document.getElementById('breathBtnLabel'),
  shareBtn: document.getElementById('shareBtn'),
  immersiveBtn: document.getElementById('immersiveBtn'),
  trialBanner: document.getElementById('trialBanner'),
  trialText: document.getElementById('trialText'),
  trialUnlockBtn: document.getElementById('trialUnlockBtn'),
  statusChip: document.getElementById('statusChip'),
  breathCue: document.getElementById('breathCue'),
  playOrbit: document.getElementById('playOrbit'),
  timerRingArc: document.getElementById('timerRingArc'),
  playBtn: document.getElementById('playBtn'),
  playIcon: document.getElementById('playIcon'),
  playLabel: document.getElementById('playLabel'),
  timerReadout: document.getElementById('timerReadout'),
  quickMeta: document.getElementById('quickMeta'),
  immersiveClock: document.getElementById('immersiveClock'),
  immersiveBreath: document.getElementById('immersiveBreath'),
  immersiveBreathPhase: document.getElementById('immersiveBreathPhase'),
  immersiveBreathSec: document.getElementById('immersiveBreathSec'),
  immersiveBreathMode: document.getElementById('immersiveBreathMode'),
  immersiveClockTime: document.getElementById('immersiveClockTime'),
  immersiveClockSub: document.getElementById('immersiveClockSub'),
  presetStrip: document.getElementById('presetStrip'),
  dockBar: document.getElementById('dockBar'),
  sheetBackdrop: document.getElementById('sheetBackdrop'),
  sheetTitle: document.getElementById('sheetTitle'),
  sheetBody: document.getElementById('sheetBody'),
  sheetCloseBtn: document.getElementById('sheetCloseBtn'),
  toast: document.getElementById('toast'),
  devPill: document.getElementById('devPreviewPill'),
};

const appState = {
  playing: false,
  immersive: false,
  activeSheet: null, // 'mixer' | 'scenes' | 'brainwave' | 'timer' | 'recipes' | 'paywall' | 'card'
  activePresetId: CONFIG.DEFAULT_PRESET_ID,
  mix: normalizeMixState(PRESET_MAP[CONFIG.DEFAULT_PRESET_ID]),
  masterVolume: 0.82,
  savedMixes: [],
  selectedNameTag: RECIPE_NAME_TAGS[0],
  totalFocusMinutes: 0,
  timer: {
    mode: 'focus', // 'focus' | 'sleep'
    running: false,
    focusMinutes: 25,
    sleepMinutes: 30,
    totalSeconds: 25 * 60,
    remainingSeconds: 25 * 60,
    endAt: 0,
    intervalId: null,
  },
  idleTimerId: null,
  lastCanvasTapAt: 0,
  sessionSaveTimer: null,
  breathMode: 'off',
  breathStartedAt: 0,
  breathCueTimer: null,
  clockTimerId: null,
  immersiveEnteredAt: 0,
  orbitAnchor: { x: 0, y: 0, ready: false },
  trial: {
    active: false,
    remaining: 0,
    timerId: null,
    snapshotMix: null,
    snapshotPresetId: null,
  },
  lastCardDataUrl: null,
  toastTimer: null,
};

const audio = new AuraAudioEngine({
  onThunderFlash: (intensity) => renderer.triggerFlash(intensity),
});

const renderer = new SceneCanvasRenderer(dom.canvas, () => {
  const bw = BRAINWAVE_MAP[appState.mix.brainwave] || BRAINWAVE_MAP.off;
  const hz = bw.id === 'off' ? 0 : appState.mix.customHz || bw.hz;
  return {
    sceneId: appState.mix.scene,
    tracks: appState.mix.tracks,
    hz,
    energy: audio.getEnergy(),
    spectrum: audio.getSpectrum(36),
    breath: getBreathVisualState(),
    anchorX: appState.orbitAnchor.ready ? appState.orbitAnchor.x : window.innerWidth * 0.5,
    anchorY: appState.orbitAnchor.ready ? appState.orbitAnchor.y : window.innerHeight * 0.45,
  };
});

const bridge = new ToyBridge({
  checkCharge: CONFIG.PAYWALL_ENABLED,
  onUnlockChange: () => {
    if (bridge.getEffectivePro() && appState.trial.active) {
      stopTrialPreview(false);
    }
    syncUI();
    if (appState.activeSheet) renderSheetContent();
  },
  onToast: (msg) => showToast(msg),
});

function showToast(msg, duration = 2600) {
  if (!dom.toast) return;
  dom.toast.textContent = msg;
  dom.toast.hidden = false;
  if (appState.toastTimer) window.clearTimeout(appState.toastTimer);
  appState.toastTimer = window.setTimeout(() => {
    dom.toast.hidden = true;
  }, duration);
}

function isProUnlocked() {
  if (!CONFIG.PAYWALL_ENABLED) return true;
  return bridge.getEffectivePro();
}

function applySceneTheme() {
  const scene = SCENE_MAP[appState.mix.scene] || SCENE_MAP['rainy-window'];
  const root = document.documentElement.style;
  root.setProperty('--accent', scene.accent);
  root.setProperty('--accent-soft', scene.accentSoft);
}

function getActiveTrackCount() {
  return TRACKS.filter((t) => (appState.mix.tracks[t.id] || 0) > 0.01).length;
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function getBrainwaveBandSymbol(hz) {
  if (hz < 4) return 'δ';
  if (hz < 8) return 'θ';
  if (hz < 14) return 'α';
  if (hz < 30) return 'β';
  return 'γ';
}

function formatBrainwaveLabel(mix) {
  const bw = BRAINWAVE_MAP[mix.brainwave] || BRAINWAVE_MAP.off;
  if (bw.id === 'off') return '纯净自然声';
  const hz = mix.customHz || bw.hz;
  const sym = Math.abs(hz - bw.hz) <= 0.01 ? bw.name.split(' ')[0] : getBrainwaveBandSymbol(hz);
  return `${hz} Hz ${sym}`;
}

function startTrialPreview(proMix, proPresetId, label) {
  if (isProUnlocked()) return;
  const wasActive = appState.trial.active;
  if (!wasActive) {
    appState.trial.snapshotMix = JSON.parse(JSON.stringify(appState.mix));
    appState.trial.snapshotPresetId = appState.activePresetId;
    if (appState.trial.timerId) {
      window.clearInterval(appState.trial.timerId);
      appState.trial.timerId = null;
    }
    appState.trial.remaining = CONFIG.PRO_PREVIEW_SECONDS;
  }
  appState.trial.active = true;
  appState.mix = normalizeMixState(proMix);
  appState.activePresetId = proPresetId || null;

  audio.setPlaying(true);
  appState.playing = true;
  audio.applyMix(appState.mix);
  applySceneTheme();
  syncUI();
  showToast(`正在试听 Pro 空间「${label}」（${appState.trial.remaining} 秒）`);

  if (!wasActive) {
    appState.trial.timerId = window.setInterval(() => {
      appState.trial.remaining -= 1;
      if (appState.trial.remaining <= 0) {
        stopTrialPreview(true);
      } else {
        syncTrialBanner();
      }
    }, 1000);
  }
}

function stopTrialPreview(openPaywall = false) {
  if (appState.trial.timerId) {
    window.clearInterval(appState.trial.timerId);
    appState.trial.timerId = null;
  }
  const restoreMix = appState.trial.snapshotMix;
  const restorePreset = appState.trial.snapshotPresetId;
  appState.trial.active = false;
  appState.trial.remaining = 0;
  appState.trial.snapshotMix = null;
  appState.trial.snapshotPresetId = null;

  if (openPaywall && !isProUnlocked()) {
    if (restoreMix && !mixUsesPro(restoreMix)) {
      appState.mix = normalizeMixState(restoreMix);
      appState.activePresetId = restorePreset;
    } else {
      appState.mix = normalizeMixState(PRESET_MAP[CONFIG.DEFAULT_PRESET_ID]);
      appState.activePresetId = CONFIG.DEFAULT_PRESET_ID;
    }
    audio.applyMix(appState.mix);
    applySceneTheme();
    openSheet('paywall');
  }
  syncUI();
  if (appState.activeSheet && appState.activeSheet !== 'paywall') renderSheetContent();
}

function selectPreset(presetId) {
  const preset = PRESET_MAP[presetId];
  if (!preset) return;
  audio.ensureContext();

  const nextTracks = createEmptyTracks();
  for (const [k, v] of Object.entries(preset.tracks)) {
    nextTracks[k] = v;
  }
  const nextMix = normalizeMixState({
    scene: preset.scene,
    brainwave: preset.brainwave,
    customHz: preset.customHz,
    tracks: nextTracks,
  });

  if (preset.pro && !isProUnlocked()) {
    startTrialPreview(nextMix, preset.id, preset.name);
    return;
  }

  if (appState.trial.active) stopTrialPreview(false);
  appState.activePresetId = preset.id;
  appState.mix = nextMix;
  audio.applyMix(appState.mix);
  if (!appState.playing) {
    appState.playing = true;
    audio.setPlaying(true);
  }
  applySceneTheme();
  syncUI();
  scheduleSessionSave();
  resetIdleTimer();
  if (appState.activeSheet) renderSheetContent();
}

function togglePlay() {
  audio.ensureContext();
  if (!appState.playing) {
    // 分享链接 / 本地缓存里的 Pro 混音在未解锁时先走试听，避免绕过包月充电
    if (mixUsesPro(appState.mix) && !isProUnlocked() && !appState.trial.active) {
      startTrialPreview(appState.mix, appState.activePresetId, '分享的空间配方');
      return;
    }
    appState.playing = true;
    audio.setPlaying(true);
    audio.applyMix(appState.mix);
    if (appState.timer.running && appState.timer.mode === 'sleep') {
      audio.scheduleSleepFade(computeRemaining(), CONFIG.SLEEP_FADE_SECONDS);
    }
  } else {
    appState.playing = false;
    audio.setPlaying(false);
    if (appState.timer.running && appState.timer.mode === 'sleep') {
      audio.cancelSleepFade();
    }
  }
  syncUI();
  resetIdleTimer();
}

function setImmersive(next) {
  appState.immersive = Boolean(next);
  dom.shell.classList.toggle('is-immersive', appState.immersive);
  if (appState.clockTimerId) {
    window.clearInterval(appState.clockTimerId);
    appState.clockTimerId = null;
  }
  if (appState.immersive) {
    appState.immersiveEnteredAt = Date.now();
    clearIdleTimer();
    syncImmersiveClock();
    syncBreathCue();
    appState.clockTimerId = window.setInterval(syncImmersiveClock, 10000);
  } else {
    appState.immersiveEnteredAt = 0;
    resetIdleTimer();
  }
}

function getBreathVisualState() {
  const mode = BREATH_MAP[appState.breathMode];
  if (!mode || !mode.phases.length) {
    return { active: false, scale: 0, phase: 'off', label: '', remSec: 0 };
  }
  const totalSec = mode.phases.reduce((sum, p) => sum + p.sec, 0);
  const elapsed = ((Date.now() - appState.breathStartedAt) / 1000) % totalSec;
  let acc = 0;
  for (let i = 0; i < mode.phases.length; i++) {
    const p = mode.phases[i];
    if (elapsed < acc + p.sec) {
      const inPhase = elapsed - acc;
      const progress = inPhase / p.sec;
      let scale = 0;
      if (p.key === 'inhale') {
        scale = 0.5 - 0.5 * Math.cos(progress * Math.PI);
      } else if (p.key === 'exhale') {
        scale = 0.5 + 0.5 * Math.cos(progress * Math.PI);
      } else {
        const prev = i > 0 ? mode.phases[i - 1].key : 'inhale';
        scale = prev === 'inhale' ? 1 : 0;
      }
      return {
        active: true,
        scale,
        phase: p.key,
        label: p.label,
        remSec: Math.max(1, Math.ceil(p.sec - inPhase)),
      };
    }
    acc += p.sec;
  }
  return { active: false, scale: 0, phase: 'off', label: '', remSec: 0 };
}

function syncBreathCue() {
  const st = getBreathVisualState();
  const mode = BREATH_MAP[appState.breathMode] || BREATH_MODES[0];
  if (!st.active) {
    dom.breathCue.hidden = true;
    if (dom.immersiveClock) dom.immersiveClock.classList.remove('is-breathing');
    if (dom.immersiveBreath) dom.immersiveBreath.hidden = true;
    return;
  }
  dom.breathCue.hidden = false;
  dom.breathCue.textContent = `${st.label} · ${st.remSec}s`;

  if (dom.immersiveClock) dom.immersiveClock.classList.add('is-breathing');
  if (dom.immersiveBreath) {
    dom.immersiveBreath.hidden = false;
    dom.immersiveBreath.dataset.phase = st.phase;
  }
  if (dom.immersiveBreathPhase) dom.immersiveBreathPhase.textContent = st.label;
  if (dom.immersiveBreathSec) dom.immersiveBreathSec.textContent = `${st.remSec}s`;
  if (dom.immersiveBreathMode) dom.immersiveBreathMode.textContent = mode.name;
}

function cycleBreathMode() {
  const idx = BREATH_MODES.findIndex((b) => b.id === appState.breathMode);
  const next = BREATH_MODES[(idx + 1) % BREATH_MODES.length];
  appState.breathMode = next.id;
  appState.breathStartedAt = Date.now();
  if (appState.breathCueTimer) {
    window.clearInterval(appState.breathCueTimer);
    appState.breathCueTimer = null;
  }
  if (next.id !== 'off') {
    appState.breathCueTimer = window.setInterval(syncBreathCue, 250);
    showToast(`已开启${next.name}`);
  } else {
    showToast('已关闭呼吸引导');
  }
  syncBreathCue();
  syncUI();
}

function syncImmersiveClock() {
  if (!dom.immersiveClockTime || !dom.immersiveClockSub) return;
  const scene = SCENE_MAP[appState.mix.scene] || SCENE_MAP['rainy-window'];
  if (appState.timer.running) {
    dom.immersiveClockTime.textContent = formatTime(appState.timer.remainingSeconds);
    const modeLabel = appState.timer.mode === 'focus' ? '专注中' : '睡眠渐弱';
    dom.immersiveClockSub.textContent = `${scene.name} · ${modeLabel}`;
  } else {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    dom.immersiveClockTime.textContent = `${hh}:${mm}`;
    dom.immersiveClockSub.textContent = scene.name;
  }
}

function syncMediaSession() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    const scene = SCENE_MAP[appState.mix.scene] || SCENE_MAP['rainy-window'];
    const bw = BRAINWAVE_MAP[appState.mix.brainwave] || BRAINWAVE_MAP.off;
    const waveText = bw.id === 'off' ? '纯净自然声' : `${appState.mix.customHz || bw.hz} Hz`;
    if (typeof window.MediaMetadata === 'function') {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: `${scene.name} · ${waveText}`,
        artist: '静界 AuraSpace',
        album: 'B站 Toy 空间白噪音',
      });
    }
    navigator.mediaSession.playbackState = appState.playing ? 'playing' : 'paused';
  } catch (_) {
    // 个别宿主 MediaSession 实现不完整，忽略以保护主 UI 刷新
  }
}

function applySmartRandomMix() {
  audio.ensureContext();
  const next = generateHarmoniousMix();
  const sceneName = SCENE_MAP[next.scene]?.name || '静界';
  if (!isProUnlocked() && mixUsesPro(next)) {
    startTrialPreview(next, null, sceneName);
    return;
  }
  if (appState.trial.active) stopTrialPreview(false);
  appState.mix = next;
  appState.activePresetId = null;
  audio.applyMix(appState.mix);
  if (!appState.playing) {
    appState.playing = true;
    audio.setPlaying(true);
  }
  applySceneTheme();
  syncUI();
  scheduleSessionSave();
  resetIdleTimer();
  if (appState.activeSheet) renderSheetContent();
  showToast(`已调配「${sceneName}」随缘声景`);
}

function clearAllTracks() {
  appState.mix.tracks = createEmptyTracks();
  appState.activePresetId = null;
  audio.applyMix(appState.mix);
  syncUI();
  scheduleSessionSave();
  if (appState.activeSheet === 'mixer') renderMixerSheet();
  showToast('已清空所有环境声轨');
}

function clearIdleTimer() {
  if (appState.idleTimerId) {
    window.clearTimeout(appState.idleTimerId);
    appState.idleTimerId = null;
  }
}

function resetIdleTimer() {
  clearIdleTimer();
  if (!appState.playing || appState.immersive || appState.activeSheet) return;
  appState.idleTimerId = window.setTimeout(() => {
    if (appState.playing && !appState.immersive && !appState.activeSheet) {
      setImmersive(true);
    }
  }, CONFIG.AUTO_IMMERSIVE_SECONDS * 1000);
}

function scheduleSessionSave() {
  if (appState.sessionSaveTimer) {
    window.clearTimeout(appState.sessionSaveTimer);
  }
  appState.sessionSaveTimer = window.setTimeout(() => {
    try {
      window.localStorage.setItem(
        CONFIG.SESSION_KEY,
        JSON.stringify({
          v: 1,
          mix: normalizeMixState(appState.mix),
          activePresetId: appState.activePresetId,
          masterVolume: appState.masterVolume,
          focusMinutes: appState.timer.focusMinutes,
          sleepMinutes: appState.timer.sleepMinutes,
        })
      );
    } catch (_) {
      // 忽略隐私模式存储异常
    }
  }, 250);
}

function restoreLocalSession() {
  try {
    const raw = window.localStorage.getItem(CONFIG.SESSION_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return;
    if (data.mix) {
      appState.mix = normalizeMixState(data.mix);
    }
    if (typeof data.activePresetId === 'string' && PRESET_MAP[data.activePresetId]) {
      appState.activePresetId = data.activePresetId;
    } else if (data.activePresetId === null) {
      appState.activePresetId = null;
    }
    const mv = Number(data.masterVolume);
    if (Number.isFinite(mv) && mv >= 0 && mv <= 1) {
      appState.masterVolume = mv;
      audio.setMasterVolume(mv);
    }
    const minT = CONFIG.MIN_TIMER_MINUTES;
    const maxT = CONFIG.MAX_TIMER_MINUTES;
    const fm = Math.round(Number(data.focusMinutes));
    if (Number.isFinite(fm) && fm >= minT && fm <= maxT) {
      appState.timer.focusMinutes = fm;
    }
    const sm = Math.round(Number(data.sleepMinutes));
    if (Number.isFinite(sm) && sm >= minT && sm <= maxT) {
      appState.timer.sleepMinutes = sm;
    }
    const activeMins = appState.timer.mode === 'sleep' ? appState.timer.sleepMinutes : appState.timer.focusMinutes;
    appState.timer.totalSeconds = activeMins * 60;
    appState.timer.remainingSeconds = activeMins * 60;
  } catch (_) {
    // 忽略损坏的本地会话缓存
  }
}

function syncTrialBanner() {
  if (!appState.trial.active || isProUnlocked()) {
    dom.trialBanner.hidden = true;
    return;
  }
  dom.trialBanner.hidden = false;
  dom.trialText.textContent = `Pro 空间试听中（剩余 ${appState.trial.remaining}s）· 充电即可无限畅听`;
}

function syncUI() {
  const scene = SCENE_MAP[appState.mix.scene] || SCENE_MAP['rainy-window'];
  const bw = BRAINWAVE_MAP[appState.mix.brainwave] || BRAINWAVE_MAP.off;
  const hzLabel = formatBrainwaveLabel(appState.mix);
  const pro = isProUnlocked();

  dom.brandSub.textContent = `${scene.name} · ${hzLabel}`;
  dom.statusChip.innerHTML = `<strong>${scene.name}</strong><span>·</span><span>${hzLabel}</span>`;

  dom.playOrbit.classList.toggle('is-playing', appState.playing);
  dom.playLabel.textContent = appState.playing ? '轻触暂停' : '开启声景';
  dom.playIcon.innerHTML = appState.playing
    ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>'
    : '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5-11-6.5z"/></svg>';

  if (appState.timer.running) {
    dom.timerReadout.classList.remove('is-idle');
    const prefix = appState.timer.mode === 'focus' ? '专注倒计时 ' : '睡眠渐弱 ';
    dom.timerReadout.textContent = `${prefix}${formatTime(appState.timer.remainingSeconds)}`;
    const progress = appState.timer.totalSeconds > 0
      ? Math.max(0, Math.min(1, 1 - appState.timer.remainingSeconds / appState.timer.totalSeconds))
      : 0;
    dom.playOrbit.classList.add('has-timer');
    if (dom.timerRingArc) {
      dom.timerRingArc.style.strokeDashoffset = String((395.84 * (1 - progress)).toFixed(2));
    }
  } else {
    dom.timerReadout.classList.add('is-idle');
    dom.timerReadout.textContent = '点按此处或「定时」开启专注 / 睡眠渐弱';
    dom.playOrbit.classList.remove('has-timer');
    if (dom.timerRingArc) {
      dom.timerRingArc.style.strokeDashoffset = '395.84';
    }
  }

  const breathInfo = BREATH_MAP[appState.breathMode] || BREATH_MODES[0];
  if (dom.breathBtn && dom.breathBtnLabel) {
    dom.breathBtn.classList.toggle('is-active-pill', breathInfo.id !== 'off');
    dom.breathBtnLabel.textContent = breathInfo.short;
  }

  const activeTracks = getActiveTrackCount();
  const activePreset = appState.activePresetId ? PRESET_MAP[appState.activePresetId] : null;
  const mixTag = activePreset ? `${activePreset.name} · ${activeTracks} 轨` : `自定义混音 · ${activeTracks} 轨`;
  const focusBadge = appState.totalFocusMinutes > 0 ? `已静心 ${appState.totalFocusMinutes}m` : '双击画布进入沉浸';
  const headphoneNote = bw.id === 'off' ? '无额外下载 · 纯本地实时合成' : '建议佩戴耳机触发双耳节拍';
  dom.quickMeta.innerHTML = `
    <span class="meta-tag">${mixTag}</span>
    <span class="meta-tag">${headphoneNote}</span>
    <span class="meta-tag">${focusBadge}</span>
  `;

  dom.proBtn.classList.toggle('is-unlocked', pro);
  dom.proBtn.classList.toggle('pro-cta', !pro);
  dom.proBtnLabel.textContent = pro ? 'Pro 已解锁' : `解锁 Pro ${CONFIG.CHARGE_PRICE_LABEL}`;

  syncTrialBanner();
  syncBreathCue();
  syncImmersiveClock();
  syncMediaSession();
  renderPresetStrip();
  syncDockActive();

  dom.proBtn.hidden = !CONFIG.PAYWALL_ENABLED;

  if (CONFIG.PAYWALL_ENABLED && bridge.canShowDevToggle()) {
    dom.devPill.hidden = false;
    dom.devPill.textContent = bridge.devPreviewPro ? '本地预览：Pro 已解锁（点此切回免费）' : '本地预览：免费版（点此体验 Pro）';
  } else {
    dom.devPill.hidden = true;
  }

  updateOrbitAnchor();
}

function updateOrbitAnchor() {
  if (!dom.playOrbit || appState.immersive) return;
  const rect = dom.playOrbit.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    appState.orbitAnchor.x = rect.left + rect.width * 0.5;
    appState.orbitAnchor.y = rect.top + rect.height * 0.5;
    appState.orbitAnchor.ready = true;
    document.documentElement.style.setProperty('--orbit-y', `${Math.round(appState.orbitAnchor.y)}px`);
  }
}

let presetStripSig = '';

function renderPresetStrip() {
  const pro = isProUnlocked();
  const sig = `${pro ? 1 : 0}|${appState.activePresetId || ''}`;
  if (sig === presetStripSig && dom.presetStrip.childElementCount > 0) return;
  presetStripSig = sig;
  const keepScroll = dom.presetStrip.scrollLeft;
  const randomBtn = `<button type="button" class="preset-pill" data-random-mix="1"><span>🎲 随缘</span></button>`;
  dom.presetStrip.innerHTML = randomBtn + PRESETS.map((p) => {
    const active = appState.activePresetId === p.id ? 'is-active' : '';
    const badge = p.pro && !pro ? '<span class="pro-badge">PRO</span>' : '';
    const sceneName = SCENE_MAP[p.scene]?.name || '空间';
    const trackCount = Object.keys(p.tracks || {}).length;
    return `<button type="button" class="preset-pill ${active}" data-preset="${p.id}" title="${p.badge} · 场景 ${sceneName} · ${trackCount} 轨">
      <span>${p.name}</span>${badge}
    </button>`;
  }).join('');
  dom.presetStrip.scrollLeft = keepScroll;
}

function syncDockActive() {
  const items = dom.dockBar.querySelectorAll('[data-sheet]');
  items.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.sheet === appState.activeSheet);
  });
}

function openSheet(name) {
  appState.activeSheet = name;
  dom.sheetBackdrop.hidden = false;
  clearIdleTimer();
  renderSheetContent();
  syncDockActive();
}

function closeSheet() {
  appState.activeSheet = null;
  dom.sheetBackdrop.hidden = true;
  syncDockActive();
  resetIdleTimer();
}

function renderSheetContent() {
  const sheet = appState.activeSheet;
  if (!sheet) return;
  const titles = {
    mixer: '多轨空间混音台',
    scenes: '切换视觉氛围场景',
    brainwave: '双耳节拍脑波频率',
    timer: '专注番茄钟 & 睡眠渐弱',
    recipes: '我的空间配方库',
    paywall: '解锁完整版 · 静界 Pro',
    card: '生成我的空间配方海报',
  };
  dom.sheetTitle.textContent = titles[sheet] || '静界控制台';

  if (sheet === 'mixer') renderMixerSheet();
  else if (sheet === 'scenes') renderScenesSheet();
  else if (sheet === 'brainwave') renderBrainwaveSheet();
  else if (sheet === 'timer') renderTimerSheet();
  else if (sheet === 'recipes') renderRecipesSheet();
  else if (sheet === 'paywall') renderPaywallSheet();
  else if (sheet === 'card') renderCardSheet();
}

function renderMixerSheet() {
  const pro = isProUnlocked();
  const masterPct = Math.round(appState.masterVolume * 100);
  const trackRows = TRACKS.map((t) => {
    const vol = appState.mix.tracks[t.id] || 0;
    const pct = Math.round(vol * 100);
    const active = pct > 0 ? 'is-active' : '';
    const lockTag = t.pro && !pro ? '<span class="pro-badge">PRO · 可试听15s</span>' : '';
    return `
      <div class="track-row ${active}" data-track-row="${t.id}">
        <div class="track-head">
          <button type="button" class="track-toggle" data-track-toggle="${t.id}" title="轻触快速开关音轨">
            <span class="track-dot" style="background:${t.color}"></span>
            <div>
              <div class="track-name">${t.name} ${lockTag}</div>
              <div class="track-desc">${t.desc}</div>
            </div>
          </button>
          <span class="track-pct" data-track-pct="${t.id}">${pct}%</span>
        </div>
        <input class="studio-slider" type="range" min="0" max="100" value="${pct}" style="--pct:${pct}%;--slider-color:${t.color}" data-track-slider="${t.id}" aria-label="${t.name}音量" />
      </div>
    `;
  }).join('');

  dom.sheetBody.innerHTML = `
    <div class="mixer-toolbar">
      <span class="muted-note">轻触轨道名称可快速静音或恢复</span>
      <div class="saved-actions">
        <button type="button" class="mini-btn" id="mixerRandomBtn">🎲 随缘混音</button>
        <button type="button" class="mini-btn" id="mixerClearTracksBtn">清空声轨</button>
      </div>
    </div>
    <div class="track-row is-active">
      <div class="track-head">
        <div class="track-info">
          <span class="track-dot" style="background:var(--accent)"></span>
          <div>
            <div class="track-name">主输出总音量</div>
            <div class="track-desc">内置动态限幅器防爆音</div>
          </div>
        </div>
        <span class="track-pct" id="masterPctLabel">${masterPct}%</span>
      </div>
      <input class="studio-slider" type="range" min="0" max="100" value="${masterPct}" style="--pct:${masterPct}%;--slider-color:var(--accent)" id="masterVolSlider" aria-label="主总音量" />
    </div>
    ${trackRows}
  `;
}

function renderScenesSheet() {
  const pro = isProUnlocked();
  const activeSummary = TRACKS
    .filter((t) => (appState.mix.tracks[t.id] || 0) > 0.01)
    .map((t) => `${t.name} ${Math.round(appState.mix.tracks[t.id] * 100)}%`)
    .join(' · ');
  dom.sheetBody.innerHTML = `
    <div class="muted-note">此处仅切换背景画面，保留当前声音混音；若想一键切换整套「声景 + 画面」，请点底部快捷配方。</div>
    <div class="muted-note">当前保留声轨：${activeSummary || '暂无环境声轨（可在「混音」中开启）'}</div>
    <div class="card-grid">
      ${SCENES.map((s) => {
        const selected = appState.mix.scene === s.id ? 'is-selected' : '';
        const lock = s.pro && !pro ? '<span class="pro-badge">PRO</span>' : '';
        return `
          <button type="button" class="choice-card ${selected}" data-scene-pick="${s.id}">
            <div class="swatch-bar" style="background:linear-gradient(90deg, ${s.bgBottom}, ${s.accent})"></div>
            <div class="choice-card-top">
              <span class="choice-name">${s.name}</span>${lock}
            </div>
            <div class="choice-sub">${s.tag}</div>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderBrainwaveSheet() {
  const pro = isProUnlocked();
  const activeBw = appState.mix.brainwave;
  const hz = appState.mix.customHz || 10;
  dom.sheetBody.innerHTML = `
    <div class="muted-note">通过左右耳微小频率差生成双耳节拍（Binaural Beats），建议佩戴耳机获取最佳专注或助眠效果。</div>
    <div class="card-grid">
      ${BRAINWAVES.map((b) => {
        const isExact = activeBw === b.id && (b.id === 'off' || Math.abs(hz - b.hz) <= 0.01);
        const selected = isExact ? 'is-selected' : '';
        const lock = b.pro && !pro ? '<span class="pro-badge">PRO</span>' : '';
        return `
          <button type="button" class="choice-card ${selected}" data-wave-pick="${b.id}">
            <div class="choice-card-top">
              <span class="choice-name">${b.name}</span>${lock}
            </div>
            <div class="choice-sub">${b.band} · ${b.desc}</div>
          </button>
        `;
      }).join('')}
    </div>
    <div class="track-row ${activeBw !== 'off' ? 'is-active' : ''}">
      <div class="track-head">
        <div>
          <div class="track-name">自定义双耳节拍微调 ${!pro ? '<span class="pro-badge">PRO</span>' : ''}</div>
          <div class="track-desc">1.0 – 45.0 Hz 精细调节（δ 深睡 / θ 冥想 / α 放松 / γ 冲刺）</div>
        </div>
        <span class="track-pct" id="customHzLabel">${hz} Hz</span>
      </div>
      <input class="studio-slider" type="range" min="1" max="45" step="0.5" value="${hz}" style="--pct:${Math.round(((hz - 1) / 44) * 100)}%;--slider-color:var(--accent)" id="customHzSlider" aria-label="自定义脑波频率" />
    </div>
  `;
}

function setTimerMinutes(mins, { rerender = true } = {}) {
  const minT = CONFIG.MIN_TIMER_MINUTES;
  const maxT = CONFIG.MAX_TIMER_MINUTES;
  const clamped = Math.max(minT, Math.min(maxT, Math.round(Number(mins) || minT)));
  if (appState.timer.running) stopTimer(true);
  if (appState.timer.mode === 'sleep') {
    appState.timer.sleepMinutes = clamped;
  } else {
    appState.timer.focusMinutes = clamped;
  }
  appState.timer.totalSeconds = clamped * 60;
  appState.timer.remainingSeconds = clamped * 60;
  scheduleSessionSave();

  if (rerender) {
    renderTimerSheet();
    return;
  }

  const lbl = document.getElementById('customTimerLabel');
  if (lbl) lbl.textContent = `${clamped} 分`;
  const countdown = document.getElementById('timerCountdown');
  if (countdown) countdown.textContent = formatTime(clamped * 60);
  const slider = document.getElementById('customTimerSlider');
  if (slider) {
    slider.value = String(clamped);
    slider.style.setProperty('--pct', `${Math.round(((clamped - minT) / (maxT - minT)) * 100)}%`);
  }
  dom.sheetBody.querySelectorAll('[data-timer-min]').forEach((btn) => {
    btn.classList.toggle('is-selected', Number(btn.dataset.timerMin) === clamped);
  });
}

function renderTimerSheet() {
  const t = appState.timer;
  const list = t.mode === 'focus' ? CONFIG.FOCUS_MINUTES : CONFIG.SLEEP_MINUTES;
  const selectedMin = Math.round(t.totalSeconds / 60);
  const minT = CONFIG.MIN_TIMER_MINUTES;
  const maxT = CONFIG.MAX_TIMER_MINUTES;
  const pct = Math.round(((selectedMin - minT) / (maxT - minT)) * 100);

  dom.sheetBody.innerHTML = `
    <div class="seg-tabs">
      <button type="button" class="seg-tab ${t.mode === 'focus' ? 'is-active' : ''}" data-timer-mode="focus">专注番茄钟（结束颂钵）</button>
      <button type="button" class="seg-tab ${t.mode === 'sleep' ? 'is-active' : ''}" data-timer-mode="sleep">睡眠渐弱（末尾60s淡出）</button>
    </div>
    <div class="chip-row">
      ${list.map((m) => `
        <button type="button" class="chip-btn ${selectedMin === m ? 'is-selected' : ''}" data-timer-min="${m}">${m} 分钟</button>
      `).join('')}
    </div>
    <div class="track-row is-active">
      <div class="track-head">
        <div>
          <div class="track-name">自定义${t.mode === 'focus' ? '专注' : '睡眠'}时长</div>
          <div class="track-desc">${minT} – ${maxT} 分钟自由调节，两种模式独立记忆</div>
        </div>
        <span class="track-pct" id="customTimerLabel">${selectedMin} 分</span>
      </div>
      <input class="studio-slider" type="range" min="${minT}" max="${maxT}" step="1" value="${selectedMin}" style="--pct:${pct}%;--slider-color:var(--accent)" id="customTimerSlider" aria-label="自定义定时分钟数" />
      <div class="saved-actions" style="justify-content:space-between;">
        <div class="saved-actions">
          <button type="button" class="mini-btn" data-timer-step="-5">-5m</button>
          <button type="button" class="mini-btn" data-timer-step="-1">-1m</button>
        </div>
        <div class="saved-actions">
          <button type="button" class="mini-btn" data-timer-step="1">+1m</button>
          <button type="button" class="mini-btn" data-timer-step="5">+5m</button>
        </div>
      </div>
    </div>
    <div class="track-row is-active" style="align-items:center;text-align:center;">
      <div id="timerCountdown" style="font-size:34px;font-weight:700;font-variant-numeric:tabular-nums;">${formatTime(t.remainingSeconds)}</div>
      <div class="muted-note">${t.mode === 'focus' ? '完成一次专注后自动计入静心时长并保存至云端' : '最后 60 秒音量平滑降至 0 后自动停止'}</div>
    </div>
    <button type="button" class="primary-btn" id="timerToggleBtn">${t.running ? '停止当前计时' : '开始计时并播放'}</button>
    ${t.mode === 'focus' ? '<button type="button" class="secondary-btn" id="testChimeBtn">试听结束颂钵音效</button>' : ''}
  `;
}

function renderRecipesSheet() {
  const pro = isProUnlocked();
  const limit = pro ? CONFIG.MAX_SAVED_MIXES_PRO : CONFIG.MAX_SAVED_MIXES_FREE;
  const saved = appState.savedMixes;

  const proNote = CONFIG.PAYWALL_ENABLED
    ? (pro ? ' · Pro 扩容' : ` · 解锁 Pro 可存 ${CONFIG.MAX_SAVED_MIXES_PRO} 组`)
    : '';

  dom.sheetBody.innerHTML = `
    <div class="muted-note">
      选一个诗意标签，将当前混音、场景与脑波状态保存为个人空间配方（最多可存 ${limit} 组${proNote}）。
    </div>
    <div class="chip-row">
      ${RECIPE_NAME_TAGS.map((tag) => `
        <button type="button" class="chip-btn ${appState.selectedNameTag === tag ? 'is-selected' : ''}" data-name-tag="${tag}">${tag}</button>
      `).join('')}
    </div>
    <button type="button" class="primary-btn" id="saveCurrentMixBtn">保存当前配方（${saved.length}/${limit}）</button>
    ${saved.length === 0
      ? '<div class="muted-note" style="text-align:center;padding:8px 0;">暂无自建配方，先调出你最舒服的声音组合保存吧。</div>'
      : saved.map((item, idx) => {
          const scene = SCENE_MAP[item.mix.scene]?.name || '空间';
          const wave = BRAINWAVE_MAP[item.mix.brainwave]?.band || '纯净';
          return `
            <div class="saved-item">
              <div class="saved-meta">
                <div class="choice-name">${item.title}</div>
                <div class="choice-sub">${scene} · ${wave}</div>
              </div>
              <div class="saved-actions">
                <button type="button" class="mini-btn" data-load-saved="${idx}">载入</button>
                <button type="button" class="mini-btn danger" data-del-saved="${idx}">删除</button>
              </div>
            </div>
          `;
        }).join('')}
    <button type="button" class="secondary-btn" id="openCardFromRecipesBtn">生成当前配方的海报卡</button>
  `;
}

function renderPaywallSheet() {
  const pro = isProUnlocked();
  if (pro) {
    dom.sheetBody.innerHTML = `
      <div class="track-row is-active">
        <div class="choice-name">已解锁「静界 Pro」全部能力</div>
        <div class="muted-note">感谢你的包月充电支持！你已解锁全部 8 大视听场景、8 路无损实时混音器、40Hz/θ/δ 全频脑波与 8 组云端配方槽位。</div>
      </div>
      <button type="button" class="primary-btn" id="closePaywallDoneBtn">返回沉浸创作</button>
    `;
    return;
  }

  dom.sheetBody.innerHTML = `
    <div class="track-row is-active" style="border-color:rgba(245,185,66,0.42);">
      <div class="choice-name" style="color:#fde68a;">「静界 · AuraSpace Pro」${CONFIG.CHARGE_PRICE_LABEL} 站内包月充电解锁</div>
      <div class="muted-note">支持 UP 主持续更新更多声景与场景，B站官方安全结算，开通后立即生效。</div>
    </div>
    <ul class="benefit-list">
      <li><strong>5 套 Pro 沉浸场景</strong>：近地轨道、午夜新干线、雪夜松林、深海穹顶、极光禅境</li>
      <li><strong>4 路高阶声轨</strong>：夜行列车、松林山风、深海潮汐、星云 Lo-Fi 和弦铺底</li>
      <li><strong>全频科学脑波</strong>：40Hz γ 极客专注、6Hz θ 冥想、2.5Hz δ 深睡与 1–45Hz 自由调频</li>
      <li><strong>8 组云端配方槽位</strong>：跨设备同步你的私人专注/助眠声景</li>
    </ul>
    <button type="button" class="primary-btn gold" id="chargeUnlockNowBtn">立即通过 B站包月充电解锁（${CONFIG.CHARGE_PRICE_LABEL}）</button>
    <button type="button" class="secondary-btn" id="recheckUnlockBtn">我已完成充电，刷新验证状态</button>
  `;
}

async function renderCardSheet() {
  dom.sheetBody.innerHTML = `<div class="muted-note" style="text-align:center;padding:24px 0;">正在渲染高清 3:4 空间配方海报...</div>`;
  const mixCode = encodeMix(appState.mix);
  const preset = appState.activePresetId ? PRESET_MAP[appState.activePresetId] : null;
  const title = preset ? preset.name : appState.selectedNameTag;
  let dataUrl = null;
  try {
    const qrUrl = await bridge.getShareQr(mixCode);
    dataUrl = await renderRecipeCard({
      title,
      mix: appState.mix,
      totalFocusMinutes: appState.totalFocusMinutes,
      qrDataUrl: qrUrl,
    });
  } catch (_) {
    // 二维码跨域或画布导出失败时，降级为无二维码海报
    try {
      dataUrl = await renderRecipeCard({
        title,
        mix: appState.mix,
        totalFocusMinutes: appState.totalFocusMinutes,
        qrDataUrl: null,
      });
    } catch (_) {
      dataUrl = null;
    }
  }
  appState.lastCardDataUrl = dataUrl;

  if (appState.activeSheet !== 'card') return;
  if (!dataUrl) {
    dom.sheetBody.innerHTML = `
      <div class="muted-note" style="text-align:center;padding:24px 0;">海报生成失败，可改用带配方的分享链接。</div>
      <button type="button" class="secondary-btn" id="shareMixLinkBtn">拉起分享 / 复制带配方链接</button>
    `;
    return;
  }
  dom.sheetBody.innerHTML = `
    <div class="card-preview-wrap">
      <img class="card-preview-img" src="${dataUrl}" alt="静界空间配方海报" />
    </div>
    <button type="button" class="primary-btn" id="savePosterBtn">保存配方海报到相册</button>
    <button type="button" class="secondary-btn" id="shareMixLinkBtn">拉起分享 / 复制带配方链接</button>
  `;
}

function computeRemaining() {
  const t = appState.timer;
  if (!t.running || !t.endAt) return t.totalSeconds;
  return Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000));
}

function updateTimerVisuals() {
  const t = appState.timer;
  if (!t.running) return;
  const prefix = t.mode === 'focus' ? '专注倒计时 ' : '睡眠渐弱 ';
  dom.timerReadout.classList.remove('is-idle');
  dom.timerReadout.textContent = `${prefix}${formatTime(t.remainingSeconds)}`;
  const progress = t.totalSeconds > 0
    ? Math.max(0, Math.min(1, 1 - t.remainingSeconds / t.totalSeconds))
    : 0;
  dom.playOrbit.classList.add('has-timer');
  if (dom.timerRingArc) {
    dom.timerRingArc.style.strokeDashoffset = String((395.84 * (1 - progress)).toFixed(2));
  }
  const countdown = document.getElementById('timerCountdown');
  if (countdown) countdown.textContent = formatTime(t.remainingSeconds);
  if (appState.immersive) syncImmersiveClock();
}

function tickTimer() {
  const t = appState.timer;
  if (!t.running) return;
  t.remainingSeconds = computeRemaining();
  if (t.remainingSeconds <= 0) {
    onTimerCompleted();
    return;
  }
  updateTimerVisuals();
}

function startTimer() {
  stopTimer(false);
  audio.ensureContext();
  if (!appState.playing) {
    appState.playing = true;
    audio.setPlaying(true);
    audio.applyMix(appState.mix);
  }
  const t = appState.timer;
  t.running = true;
  t.endAt = Date.now() + t.totalSeconds * 1000;
  t.remainingSeconds = t.totalSeconds;

  if (t.mode === 'sleep') {
    audio.scheduleSleepFade(t.totalSeconds, CONFIG.SLEEP_FADE_SECONDS);
  } else {
    audio.cancelSleepFade();
  }

  // 以结束时间戳为准计算剩余时间，切后台被节流后回来也不会走慢
  t.intervalId = window.setInterval(tickTimer, 1000);

  syncUI();
  if (appState.activeSheet === 'timer') renderTimerSheet();
  resetIdleTimer();
}

function stopTimer(resetVolume = true) {
  if (appState.timer.intervalId) {
    window.clearInterval(appState.timer.intervalId);
    appState.timer.intervalId = null;
  }
  appState.timer.running = false;
  appState.timer.endAt = 0;
  appState.timer.remainingSeconds = appState.timer.totalSeconds;
  if (resetVolume) audio.cancelSleepFade();
  syncUI();
  if (appState.activeSheet === 'timer') renderTimerSheet();
}

function onTimerCompleted() {
  const mode = appState.timer.mode;
  const mins = Math.round(appState.timer.totalSeconds / 60);
  stopTimer(false);

  if (mode === 'focus') {
    appState.totalFocusMinutes += mins;
    audio.playBowlChime();
    showToast(`专注完成 +${mins} 分钟！已存入静心记录`);
    persistUserState();
  } else {
    appState.playing = false;
    audio.stopAfterSleepFade();
    showToast('晚安，音频已渐弱停止');
  }
  syncUI();
}

function persistUserState() {
  return bridge.saveState({
    v: 1,
    totalFocusMinutes: appState.totalFocusMinutes,
    savedMixes: appState.savedMixes,
  });
}

function handleSaveCurrentMix() {
  const pro = isProUnlocked();
  const limit = pro ? CONFIG.MAX_SAVED_MIXES_PRO : CONFIG.MAX_SAVED_MIXES_FREE;
  if (appState.savedMixes.length >= limit) {
    if (!pro) {
      showToast(`免费版最多存 ${limit} 组配方，可升级 Pro 扩至 ${CONFIG.MAX_SAVED_MIXES_PRO} 组`);
      openSheet('paywall');
    } else {
      showToast(`已达 ${limit} 组上限，请先删除旧配方`);
    }
    return;
  }
  if (mixUsesPro(appState.mix) && !pro) {
    showToast('当前包含 Pro 声轨/场景，请先解锁或切回免费轨道后再保存');
    openSheet('paywall');
    return;
  }

  appState.savedMixes.unshift({
    id: `mix_${Date.now()}`,
    title: appState.selectedNameTag,
    mix: normalizeMixState(appState.mix),
    createdAt: Date.now(),
  });
  persistUserState();
  showToast(`已保存配方「${appState.selectedNameTag}」`);
  renderRecipesSheet();
}

function bindEvents() {
  // 统一在 window 监听指针按下：沉浸态下点击任意处立即唤醒；非沉浸态双击空白背景进入沉浸
  window.addEventListener('pointerdown', (e) => {
    if (appState.immersive) {
      if (Date.now() - appState.immersiveEnteredAt < 250) return;
      renderer.addRipple(e.clientX, e.clientY);
      appState.lastCanvasTapAt = 0;
      setImmersive(false);
      return;
    }

    resetIdleTimer();
    if (appState.activeSheet) return;
    if (e.target && typeof e.target.closest === 'function') {
      if (e.target.closest('button, input, a, .dock-bar, .preset-strip, .sheet-panel, .top-bar, .trial-banner')) {
        return;
      }
    }

    renderer.addRipple(e.clientX, e.clientY);
    const now = Date.now();
    if (now - appState.lastCanvasTapAt < 340) {
      appState.lastCanvasTapAt = 0;
      setImmersive(true);
    } else {
      appState.lastCanvasTapAt = now;
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (appState.timer.running) tickTimer();
      if (appState.immersive) syncImmersiveClock();
      if (appState.breathMode !== 'off') syncBreathCue();
    }
  });

  window.addEventListener('pointermove', (e) => {
    const nx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    const ny = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    renderer.setPointerNormalized(nx, ny);
  });

  dom.playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlay();
  });

  dom.breathBtn.addEventListener('click', () => cycleBreathMode());
  dom.timerReadout.addEventListener('click', () => openSheet('timer'));
  dom.immersiveBtn.addEventListener('click', () => setImmersive(!appState.immersive));
  dom.shareBtn.addEventListener('click', () => openSheet('card'));
  dom.proBtn.addEventListener('click', () => openSheet('paywall'));
  dom.trialUnlockBtn.addEventListener('click', () => {
    // 直接在同步点击栈内调起包月充电，确保 userActivation 有效
    bridge.openChargePanelSync();
  });

  dom.devPill.addEventListener('click', () => {
    bridge.setDevPreviewPro(!bridge.devPreviewPro);
  });

  window.addEventListener('resize', () => {
    window.requestAnimationFrame(updateOrbitAnchor);
  });

  dom.presetStrip.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      dom.presetStrip.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  dom.presetStrip.addEventListener('click', (e) => {
    if (e.target.closest('[data-random-mix]')) {
      applySmartRandomMix();
      return;
    }
    const btn = e.target.closest('[data-preset]');
    if (btn) selectPreset(btn.dataset.preset);
  });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'KeyI') {
      setImmersive(!appState.immersive);
    } else if (e.code === 'Escape') {
      if (appState.activeSheet) closeSheet();
      else if (appState.immersive) setImmersive(false);
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const curIdx = PRESETS.findIndex((p) => p.id === appState.activePresetId);
      const dir = e.code === 'ArrowRight' ? 1 : -1;
      const nextIdx = curIdx < 0 ? 0 : (curIdx + dir + PRESETS.length) % PRESETS.length;
      selectPreset(PRESETS[nextIdx].id);
    } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      const delta = e.code === 'ArrowUp' ? 0.05 : -0.05;
      const nextVol = Math.max(0, Math.min(1, Math.round((appState.masterVolume + delta) * 100) / 100));
      appState.masterVolume = nextVol;
      audio.ensureContext();
      audio.setMasterVolume(nextVol);
      const pct = Math.round(nextVol * 100);
      const slider = document.getElementById('masterVolSlider');
      if (slider) {
        slider.value = String(pct);
        slider.style.setProperty('--pct', `${pct}%`);
      }
      const label = document.getElementById('masterPctLabel');
      if (label) label.textContent = `${pct}%`;
      resetIdleTimer();
      scheduleSessionSave();
      showToast(`总音量 ${pct}%`, 1200);
    }
  });

  dom.dockBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sheet]');
    if (!btn) return;
    const target = btn.dataset.sheet;
    if (appState.activeSheet === target) closeSheet();
    else openSheet(target);
  });

  dom.sheetCloseBtn.addEventListener('click', closeSheet);
  dom.sheetBackdrop.addEventListener('click', (e) => {
    if (e.target === dom.sheetBackdrop) closeSheet();
  });

  // 抽屉内动态控件事件委托
  dom.sheetBody.addEventListener('input', (e) => {
    const target = e.target;
    if (target.id === 'masterVolSlider') {
      const vol = Number(target.value) / 100;
      const pct = Math.round(vol * 100);
      appState.masterVolume = vol;
      audio.ensureContext();
      audio.setMasterVolume(vol);
      target.style.setProperty('--pct', `${pct}%`);
      const label = document.getElementById('masterPctLabel');
      if (label) label.textContent = `${pct}%`;
      scheduleSessionSave();
      return;
    }

    if (target.dataset.trackSlider) {
      const id = target.dataset.trackSlider;
      const track = TRACK_MAP[id];
      const vol = Number(target.value) / 100;
      const pct = Math.round(vol * 100);
      audio.ensureContext();

      if (track?.pro && vol > 0.01 && !isProUnlocked() && !appState.trial.active) {
        const previewMix = normalizeMixState({
          ...appState.mix,
          tracks: { ...appState.mix.tracks, [id]: vol },
        });
        startTrialPreview(previewMix, null, track.name);
        return;
      }

      appState.mix.tracks[id] = vol;
      appState.activePresetId = null;
      if (!appState.playing && vol > 0.01) {
        appState.playing = true;
        audio.setPlaying(true);
        audio.applyMix(appState.mix);
      } else {
        audio.setTrackVolume(id, vol);
      }
      target.style.setProperty('--pct', `${pct}%`);
      const pctEl = dom.sheetBody.querySelector(`[data-track-pct="${id}"]`);
      if (pctEl) pctEl.textContent = `${pct}%`;
      const row = dom.sheetBody.querySelector(`[data-track-row="${id}"]`);
      if (row) row.classList.toggle('is-active', vol > 0.01);
      syncUI();
      scheduleSessionSave();
      return;
    }

    if (target.id === 'customHzSlider') {
      const hz = Number(target.value);
      audio.ensureContext();
      const nextWave = appState.mix.brainwave === 'off' ? 'alpha' : appState.mix.brainwave;
      const previewMix = normalizeMixState({ ...appState.mix, brainwave: nextWave, customHz: hz });
      if (!isProUnlocked() && !appState.trial.active) {
        startTrialPreview(previewMix, null, `${hz} Hz 自定义脑波`);
        return;
      }
      appState.mix = previewMix;
      appState.activePresetId = null;
      if (!appState.playing) {
        appState.playing = true;
        audio.setPlaying(true);
        audio.applyMix(appState.mix);
      } else {
        audio.setBrainwave(appState.mix.brainwave, hz);
      }
      target.style.setProperty('--pct', `${Math.round(((hz - 1) / 44) * 100)}%`);
      const lbl = document.getElementById('customHzLabel');
      if (lbl) lbl.textContent = `${appState.mix.customHz} Hz`;
      // 就地更新脑波卡片与滑块行选中态，避免整块重渲染打断拖拽
      dom.sheetBody.querySelectorAll('[data-wave-pick]').forEach((card) => {
        const cardBw = BRAINWAVE_MAP[card.dataset.wavePick];
        const isExact =
          card.dataset.wavePick === appState.mix.brainwave &&
          Math.abs(appState.mix.customHz - (cardBw?.hz || 0)) <= 0.01;
        card.classList.toggle('is-selected', isExact);
      });
      const hzRow = target.closest('.track-row');
      if (hzRow) hzRow.classList.add('is-active');
      syncUI();
      scheduleSessionSave();
      return;
    }

    if (target.id === 'customTimerSlider') {
      setTimerMinutes(Number(target.value), { rerender: false });
    }
  });

  dom.sheetBody.addEventListener('click', (e) => {
    if (e.target.closest('#mixerRandomBtn')) {
      applySmartRandomMix();
      return;
    }

    if (e.target.closest('#mixerClearTracksBtn')) {
      clearAllTracks();
      return;
    }

    const toggleTrackBtn = e.target.closest('[data-track-toggle]');
    if (toggleTrackBtn) {
      const id = toggleTrackBtn.dataset.trackToggle;
      const track = TRACK_MAP[id];
      if (!track) return;
      audio.ensureContext();
      const cur = appState.mix.tracks[id] || 0;
      const nextVol = cur > 0.01 ? 0 : track.defaultVol;
      if (track.pro && nextVol > 0.01 && !isProUnlocked() && !appState.trial.active) {
        startTrialPreview({ ...appState.mix, tracks: { ...appState.mix.tracks, [id]: nextVol } }, null, track.name);
        return;
      }
      appState.mix.tracks[id] = nextVol;
      appState.activePresetId = null;
      if (!appState.playing && nextVol > 0.01) {
        appState.playing = true;
        audio.setPlaying(true);
        audio.applyMix(appState.mix);
      } else {
        audio.setTrackVolume(id, nextVol);
      }
      syncUI();
      scheduleSessionSave();
      renderMixerSheet();
      return;
    }

    const sceneBtn = e.target.closest('[data-scene-pick]');
    if (sceneBtn) {
      const id = sceneBtn.dataset.scenePick;
      const sc = SCENE_MAP[id];
      if (!sc) return;
      audio.ensureContext();
      if (sc.pro && !isProUnlocked()) {
        startTrialPreview({ ...appState.mix, scene: id }, null, sc.name);
        renderScenesSheet();
        return;
      }
      appState.mix.scene = id;
      appState.activePresetId = null;
      applySceneTheme();
      syncUI();
      scheduleSessionSave();
      renderScenesSheet();
      return;
    }

    const waveBtn = e.target.closest('[data-wave-pick]');
    if (waveBtn) {
      const id = waveBtn.dataset.wavePick;
      const bw = BRAINWAVE_MAP[id];
      if (!bw) return;
      audio.ensureContext();
      if (bw.pro && !isProUnlocked()) {
        startTrialPreview({ ...appState.mix, brainwave: id, customHz: bw.hz }, null, bw.name);
        renderBrainwaveSheet();
        return;
      }
      appState.mix.brainwave = id;
      if (bw.hz > 0) appState.mix.customHz = bw.hz;
      appState.activePresetId = null;
      if (!appState.playing && id !== 'off') {
        appState.playing = true;
        audio.setPlaying(true);
        audio.applyMix(appState.mix);
      } else {
        audio.setBrainwave(id, appState.mix.customHz);
      }
      syncUI();
      scheduleSessionSave();
      renderBrainwaveSheet();
      return;
    }

    const modeBtn = e.target.closest('[data-timer-mode]');
    if (modeBtn) {
      stopTimer(true);
      appState.timer.mode = modeBtn.dataset.timerMode;
      const defMin = appState.timer.mode === 'focus'
        ? appState.timer.focusMinutes
        : appState.timer.sleepMinutes;
      appState.timer.totalSeconds = defMin * 60;
      appState.timer.remainingSeconds = defMin * 60;
      renderTimerSheet();
      return;
    }

    const minBtn = e.target.closest('[data-timer-min]');
    if (minBtn) {
      setTimerMinutes(Number(minBtn.dataset.timerMin), { rerender: true });
      return;
    }

    const stepBtn = e.target.closest('[data-timer-step]');
    if (stepBtn) {
      const curMin = Math.round(appState.timer.totalSeconds / 60);
      setTimerMinutes(curMin + Number(stepBtn.dataset.timerStep), { rerender: true });
      return;
    }

    if (e.target.closest('#timerToggleBtn')) {
      if (appState.timer.running) stopTimer(true);
      else startTimer();
      return;
    }

    if (e.target.closest('#testChimeBtn')) {
      audio.playBowlChime();
      return;
    }

    const tagBtn = e.target.closest('[data-name-tag]');
    if (tagBtn) {
      appState.selectedNameTag = tagBtn.dataset.nameTag;
      renderRecipesSheet();
      return;
    }

    if (e.target.closest('#saveCurrentMixBtn')) {
      handleSaveCurrentMix();
      return;
    }

    const loadBtn = e.target.closest('[data-load-saved]');
    if (loadBtn) {
      const idx = Number(loadBtn.dataset.loadSaved);
      const item = appState.savedMixes[idx];
      if (item) {
        audio.ensureContext();
        const nextMix = normalizeMixState(item.mix);
        if (mixUsesPro(nextMix) && !isProUnlocked()) {
          startTrialPreview(nextMix, null, item.title);
          return;
        }
        if (appState.trial.active) stopTrialPreview(false);
        appState.mix = nextMix;
        appState.activePresetId = null;
        audio.applyMix(appState.mix);
        appState.playing = true;
        audio.setPlaying(true);
        applySceneTheme();
        syncUI();
        scheduleSessionSave();
        showToast(`已载入配方「${item.title}」`);
      }
      return;
    }

    const delBtn = e.target.closest('[data-del-saved]');
    if (delBtn) {
      const idx = Number(delBtn.dataset.delSaved);
      appState.savedMixes.splice(idx, 1);
      persistUserState();
      renderRecipesSheet();
      return;
    }

    if (e.target.closest('#openCardFromRecipesBtn')) {
      openSheet('card');
      return;
    }

    if (e.target.closest('#chargeUnlockNowBtn')) {
      // 同步调用 openChargePanel 以满足 SDK userActivation 校验
      bridge.openChargePanelSync();
      return;
    }

    if (e.target.closest('#recheckUnlockBtn')) {
      bridge.refreshChargeUnlock().then((unlocked) => {
        showToast(unlocked ? '验证成功！已开启静界 Pro' : '暂未检测到包月充电状态，请确认已充电当前 UP 主');
      });
      return;
    }

    if (e.target.closest('#closePaywallDoneBtn')) {
      closeSheet();
      return;
    }

    if (e.target.closest('#savePosterBtn')) {
      if (appState.lastCardDataUrl) {
        bridge.savePosterImage(appState.lastCardDataUrl);
      }
      return;
    }

    if (e.target.closest('#shareMixLinkBtn')) {
      bridge.shareMix(encodeMix(appState.mix));
    }
  });
}

function hydrateMixFromUrlHash() {
  try {
    const hash = new URL(window.location.href).hash || '';
    const match = hash.match(/mix=([a-zA-Z0-9.]+)/);
    if (!match) return;
    const decoded = decodeMix(match[1]);
    if (!decoded) return;
    appState.mix = decoded;
    appState.activePresetId = null;
    if (mixUsesPro(decoded) && !isProUnlocked()) {
      // 若通过分享链接打开了含 Pro 的配方，准备为安全试听或待点击后开启试听
      showToast('已载入好友分享的空间配方，点击播放按钮即刻体验');
    } else {
      showToast('已载入好友分享的空间配方');
    }
  } catch (_) {
    // ignore
  }
}

async function bootstrap() {
  restoreLocalSession();
  hydrateMixFromUrlHash();
  applySceneTheme();
  bindEvents();
  renderer.start();
  syncUI();

  try {
    if ('mediaSession' in navigator && typeof navigator.mediaSession.setActionHandler === 'function') {
      navigator.mediaSession.setActionHandler('play', () => {
        if (!appState.playing) togglePlay();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (appState.playing) togglePlay();
      });
    }
  } catch (_) {
    // 忽略不支持 MediaSession 的宿主环境
  }

  const { cloudState } = await bridge.init();
  if (cloudState && typeof cloudState === 'object') {
    if (Number.isFinite(Number(cloudState.totalFocusMinutes))) {
      appState.totalFocusMinutes = Math.max(0, Math.floor(Number(cloudState.totalFocusMinutes)));
    }
    if (Array.isArray(cloudState.savedMixes)) {
      appState.savedMixes = cloudState.savedMixes
        .filter((item) => item && item.mix && typeof item.mix === 'object')
        .slice(0, CONFIG.MAX_SAVED_MIXES_PRO);
    }
  }
  syncUI();
}

bootstrap();
