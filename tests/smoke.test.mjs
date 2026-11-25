import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

import { CONFIG } from '../src/config.js';
import {
  BREATH_MODES,
  PRESET_MAP,
  SCENE_MAP,
  BRAINWAVE_MAP,
  TRACKS,
  decodeMix,
  encodeMix,
  generateHarmoniousMix,
  mixUsesPro,
  normalizeMixState,
} from '../src/presets.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ZIP_PATH = path.join(ROOT, 'release', 'auraspace-toy.zip');

test('mix codec round-trips every preset losslessly', () => {
  for (const preset of Object.values(PRESET_MAP)) {
    const normalized = normalizeMixState(preset);
    const encoded = encodeMix(normalized);
    const decoded = decodeMix(encoded);
    assert.deepEqual(decoded, normalized, `Preset ${preset.id} failed round-trip`);
  }
});

test('decodeMix safely rejects malformed and out-of-range inputs', () => {
  const fuzz = [
    '',
    'v2.0.0.100.00',
    'v1.999.0.100.0000000000000000',
    'v1.0.99.100.0000000000000000',
    'v1.0.0.999.0000000000000000',
    'v1.0.0.100.zzzz',
    null,
    undefined,
  ];
  for (const input of fuzz) {
    assert.equal(decodeMix(input), null);
  }
});

test('mixUsesPro accurately distinguishes free vs pro combinations', () => {
  assert.equal(mixUsesPro(PRESET_MAP['rainy-study']), false);
  assert.equal(mixUsesPro(PRESET_MAP['hearth-warmth']), false);
  assert.equal(mixUsesPro(PRESET_MAP['gamma-sprint']), true);
  assert.equal(mixUsesPro(PRESET_MAP['abyss-sleep']), true);
});

test('CONFIG charge price is positive integer in fen (cents) and polish flags are valid', () => {
  assert.equal(Number.isSafeInteger(CONFIG.CHARGE_MIN_PRICE_FEN), true);
  assert.ok(CONFIG.CHARGE_MIN_PRICE_FEN >= 600);
  assert.equal(CONFIG.PAYWALL_ENABLED, false);
  assert.ok(Number.isFinite(CONFIG.AUTO_IMMERSIVE_SECONDS) && CONFIG.AUTO_IMMERSIVE_SECONDS > 0);
  assert.equal(typeof CONFIG.SESSION_KEY, 'string');
  assert.ok(CONFIG.SESSION_KEY.length > 0);
});

test('app.js implements idle immersive, timestamp timer, local session restore, and no cloud polling', () => {
  const appCode = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
  assert.equal(appCode.includes('function resetIdleTimer'), true);
  assert.equal(appCode.includes('function restoreLocalSession'), true);
  assert.equal(appCode.includes('function tickTimer'), true);
  assert.equal(appCode.includes('setCloudStorage'), false, 'app.js must delegate cloud storage strictly to ToyBridge');
});

test('generateHarmoniousMix produces balanced 2-4 track mixes and valid breath modes', () => {
  assert.ok(Array.isArray(BREATH_MODES) && BREATH_MODES.length === 3);
  for (let i = 0; i < 20; i++) {
    const mix = generateHarmoniousMix();
    assert.ok(SCENE_MAP[mix.scene], 'Valid scene');
    assert.ok(BRAINWAVE_MAP[mix.brainwave], 'Valid brainwave');
    const activeCount = Object.values(mix.tracks).filter((v) => v > 0.01).length;
    assert.ok(activeCount >= 2 && activeCount <= 4, `Expected 2-4 active tracks, got ${activeCount}`);
  }
});

test('audio-engine exposes reverb IR builder and zero-allocation spectrum getter', () => {
  const audioCode = fs.readFileSync(path.join(ROOT, 'src', 'audio-engine.js'), 'utf8');
  assert.equal(audioCode.includes('_buildReverbIR()'), true);
  assert.equal(audioCode.includes('getSpectrum('), true);
  assert.equal(audioCode.includes('createConvolver()'), true);
  assert.equal(audioCode.includes("ctx.state === 'running'"), true);
  assert.equal(audioCode.includes("ctx.state !== 'running'"), true);
  assert.equal(audioCode.includes('stopAfterSleepFade('), true);
});

test('visual bugfix regressions remain fixed in styles and scene canvas', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);

  const canvasCode = fs.readFileSync(path.join(ROOT, 'src', 'scene-canvas.js'), 'utf8');
  const firesideStart = canvasCode.indexOf('_drawFireside(');
  const firesideEnd = canvasCode.indexOf('_drawStudy(', firesideStart);
  const firesideBody = canvasCode.slice(firesideStart, firesideEnd);
  assert.equal(firesideBody.includes('strokeRect'), false, 'fireside must not draw black window strokeRect');

  assert.match(css, /\.app-shell\s*\{[\s\S]*pointer-events:\s*none;/);
  const appCode = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
  assert.equal(appCode.includes("dom.canvas.addEventListener('pointerdown'"), false);
  assert.equal(appCode.includes("window.addEventListener('pointerdown'"), true);

  const srcHtml = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
  assert.equal(srcHtml.includes('id="immersiveBreath"'), true);
  assert.equal(srcHtml.includes('id="immersiveBreathPhase"'), true);
  assert.equal(appCode.includes('immersiveBreathPhase'), true);
  assert.equal(appCode.includes('is-breathing'), true);
  assert.equal(appCode.includes('getBrainwaveBandSymbol'), true);
  assert.equal(appCode.includes('GPU Canvas'), false);

  const updateStart = appCode.indexOf('function updateTimerVisuals(');
  const updateEnd = appCode.indexOf('function tickTimer(', updateStart);
  assert.equal(appCode.slice(updateStart, updateEnd).includes('syncImmersiveClock()'), true);

  const doneStart = appCode.indexOf('function onTimerCompleted(');
  const doneEnd = appCode.indexOf('function persistUserState(', doneStart);
  assert.equal(appCode.slice(doneStart, doneEnd).includes('stopAfterSleepFade()'), true);

  const cardCode = fs.readFileSync(path.join(ROOT, 'src', 'card-export.js'), 'utf8');
  assert.equal(cardCode.includes('打开 B站 搜'), false);
  assert.equal(cardCode.includes('在 B站 Toy 即点即听'), false);
});

test('dist output meets Bilibili Toy static constraints', () => {
  const indexPath = path.join(DIST, 'index.html');
  assert.equal(fs.existsSync(indexPath), true);

  const html = fs.readFileSync(indexPath, 'utf8');
  assert.ok(Buffer.byteLength(html, 'utf8') < 1024 * 1024, 'index.html must be < 1MB');
  assert.equal(html.includes('./assets/'), true, 'HTML must use relative ./assets/ paths');
  assert.equal(/["']\/assets\//.test(html), false, 'HTML must not contain root-relative /assets/ paths');

  // 合规校验：零自由文本输入与文件上传（防止触发 UGC 审核红线）
  assert.equal(/<textarea/i.test(html), false);
  assert.equal(/type\s*=\s*["']text["']/i.test(html), false);
  assert.equal(/type\s*=\s*["']file["']/i.test(html), false);

  // 所有引用的本地资源文件必须真实存在且带有 contenthash
  const assetsDir = path.join(DIST, 'assets');
  const assetFiles = fs.readdirSync(assetsDir);
  assert.ok(assetFiles.length >= 8);
  for (const file of assetFiles) {
    assert.match(file, /\.[0-9a-f]{8}\.(js|css)$/);
    if (file.endsWith('.js')) {
      execFileSync(process.execPath, ['--check', path.join(assetsDir, file)]);
    }
  }
});

test('toy-bridge obeys rate-limit and no-polling rules', () => {
  const bridgeCode = fs.readFileSync(path.join(ROOT, 'src', 'toy-bridge.js'), 'utf8');
  assert.equal(bridgeCode.includes('307044'), true, 'Must explicitly handle 307044 rate-limit error');
  assert.equal(bridgeCode.includes('setInterval'), false, 'Must never poll cloud storage with setInterval');
  const qrStart = bridgeCode.indexOf('async getShareQr(');
  const qrEnd = bridgeCode.indexOf('async savePosterImage(', qrStart);
  const qrBody = bridgeCode.slice(qrStart, qrEnd);
  assert.equal(qrBody.includes('inToyContainer'), true, 'getShareQr must guard on inToyContainer');
  assert.equal(qrBody.includes('inBiliHost'), true, 'getShareQr must guard on inBiliHost');
  assert.equal(TRACKS.length, 8);
});

test('release zip archive exists and contains POSIX entries', () => {
  assert.equal(fs.existsSync(ZIP_PATH), true);
  const zipBuf = fs.readFileSync(ZIP_PATH);
  assert.ok(zipBuf.length > 5000);
  // 校验 zip 内文件名包含 index.html 且不含反斜杠
  assert.equal(zipBuf.includes(Buffer.from('index.html')), true);
  assert.equal(zipBuf.includes(Buffer.from('assets/')), true);
  assert.equal(zipBuf.includes(Buffer.from('assets\\')), false);
});
