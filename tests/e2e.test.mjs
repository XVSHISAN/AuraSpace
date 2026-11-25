import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const RELEASE_DIR = path.join(ROOT, 'release');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const rawUrl = (req.url || '/').split('?')[0].split('#')[0];
      const relPath = rawUrl === '/' ? 'index.html' : rawUrl.replace(/^\/+/, '');
      const fullPath = path.resolve(DIST_DIR, relPath);
      if (!fullPath.startsWith(path.resolve(DIST_DIR))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(fullPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(fullPath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function findBrowserExe() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No Chromium-based browser (Chrome/Edge) found');
}

async function waitForTargetWs(debugPort, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      // retry
    }
    await sleep(200);
  }
  throw new Error('Timed out waiting for CDP target');
}

function createCdpClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const listeners = new Set();

    ws.addEventListener('open', () => {
      const send = (method, params = {}) =>
        new Promise((res, rej) => {
          const id = nextId++;
          pending.set(id, { res, rej, method });
          ws.send(JSON.stringify({ id, method, params }));
        });
      const onEvent = (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      };
      resolve({ ws, send, onEvent });
    });

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej, method } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) {
          rej(new Error(`CDP ${method} failed: ${msg.error.message}`));
        } else {
          res(msg.result);
        }
      } else if (msg.method) {
        for (const fn of listeners) fn(msg.method, msg.params);
      }
    });

    ws.addEventListener('error', (err) => reject(err));
  });
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`Runtime exception: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result?.value;
}

async function waitUntil(send, conditionExpr, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(send, conditionExpr)) return;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for condition: ${conditionExpr}`);
}

async function runCase(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`[PASS] ${name} (${Date.now() - t0}ms)`);
    return true;
  } catch (err) {
    console.error(`[FAIL] ${name} (${Date.now() - t0}ms): ${err?.stack || err}`);
    return false;
  }
}

async function main() {
  assert.equal(fs.existsSync(path.join(DIST_DIR, 'index.html')), true, 'dist/index.html missing; run build first');
  const browserExe = findBrowserExe();
  const { server, port: httpPort } = await startStaticServer();
  const debugPort = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auraspace-e2e-'));

  let child = null;
  let client = null;
  const uncaughtErrors = [];
  const requestedUrls = [];

  try {
    child = spawn(
      browserExe,
      [
        '--headless=new',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--window-size=1280,800',
        'about:blank',
      ],
      { stdio: 'ignore' }
    );

    const wsUrl = await waitForTargetWs(debugPort);
    client = await createCdpClient(wsUrl);
    const { send, onEvent } = client;

    onEvent((method, params) => {
      if (method === 'Runtime.exceptionThrown') {
        uncaughtErrors.push(params.exceptionDetails?.text || JSON.stringify(params.exceptionDetails));
      } else if (method === 'Network.requestWillBeSent') {
        const url = params.request?.url || '';
        if (url && !url.startsWith('data:')) {
          requestedUrls.push(url);
        }
      }
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const baseUrl = `http://127.0.0.1:${httpPort}/index.html`;
    await send('Page.navigate', { url: baseUrl });
    await waitUntil(send, `Boolean(document.getElementById('playBtn') && document.querySelectorAll('.preset-pill').length === 11)`);
    await sleep(300);

    let allPassed = true;

    // F01: Boot & Initial Render
    allPassed &= await runCase('F01 Boot & Render', async () => {
      const st = await evaluate(
        send,
        `(() => ({
          presetCount: document.querySelectorAll('#presetStrip .preset-pill').length,
          dockCount: document.querySelectorAll('#dockBar .dock-item').length,
          canvasW: document.getElementById('sceneCanvas').width,
          canvasH: document.getElementById('sceneCanvas').height,
          proHidden: document.getElementById('proBtn').hidden,
        }))()`
      );
      assert.equal(st.presetCount, 11);
      assert.equal(st.dockCount, 5);
      assert.ok(st.canvasW > 0 && st.canvasH > 0);
      assert.equal(st.proHidden, true);
    });

    // F02: Play/Pause & 8-Track Mixer
    allPassed &= await runCase('F02 Play/Pause & 8-Track Mixer', async () => {
      await evaluate(send, `document.getElementById('playBtn').click()`);
      await waitUntil(send, `document.getElementById('playLabel').textContent === '轻触暂停'`);

      await evaluate(send, `document.querySelector('.dock-item[data-sheet="mixer"]').click()`);
      await waitUntil(send, `document.querySelectorAll('#sheetBody [data-track-slider]').length === 8`);
      const hasMaster = await evaluate(send, `Boolean(document.getElementById('masterVolSlider'))`);
      assert.equal(hasMaster, true);

      await evaluate(
        send,
        `(() => {
          const s = document.querySelector('[data-track-slider="fire"]');
          s.value = '65';
          s.dispatchEvent(new Event('input', { bubbles: true }));
        })()`
      );
      assert.equal(await evaluate(send, `document.querySelector('[data-track-pct="fire"]').textContent`), '65%');

      await evaluate(send, `document.querySelector('[data-track-toggle="fire"]').click()`);
      assert.equal(await evaluate(send, `document.querySelector('[data-track-pct="fire"]').textContent`), '0%');
      await evaluate(send, `document.querySelector('[data-track-toggle="fire"]').click()`);
      assert.notEqual(await evaluate(send, `document.querySelector('[data-track-pct="fire"]').textContent`), '0%');

      await evaluate(send, `document.getElementById('mixerClearTracksBtn').click()`);
      assert.equal(await evaluate(send, `document.getElementById('quickMeta').textContent.includes('0 轨')`), true);

      await evaluate(send, `document.getElementById('sheetCloseBtn').click()`);
      await evaluate(send, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))`);
      assert.equal(await evaluate(send, `document.getElementById('playLabel').textContent`), '开启声景');
      await evaluate(send, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))`);
      assert.equal(await evaluate(send, `document.getElementById('playLabel').textContent`), '轻触暂停');
    });

    // F03: Presets, Scroll Preservation & Smart Randomizer
    allPassed &= await runCase('F03 Presets & Randomizer', async () => {
      await evaluate(send, `document.getElementById('presetStrip').scrollLeft = 180`);
      for (const [id, sceneName] of [
        ['hearth-warmth', '冬夜壁炉'],
        ['gamma-sprint', '近地轨道'],
        ['aurora-meditation', '极光禅境'],
      ]) {
        await evaluate(send, `document.querySelector('[data-preset="${id}"]').click()`);
        const info = await evaluate(
          send,
          `(() => ({
            sub: document.getElementById('brandSub').textContent,
            chip: document.getElementById('statusChip').textContent,
            active: document.querySelector('.preset-pill.is-active')?.dataset.preset,
            accent: document.documentElement.style.getPropertyValue('--accent'),
            scrollLeft: document.getElementById('presetStrip').scrollLeft,
          }))()`
        );
        assert.equal(info.sub.includes(sceneName), true);
        assert.equal(info.chip.includes(sceneName), true);
        assert.equal(info.active, id);
        assert.ok(info.accent.startsWith('#'));
        assert.ok(info.scrollLeft > 80, 'presetStrip should keep scroll position');
      }

      await evaluate(send, `document.querySelector('[data-random-mix="1"]').click()`);
      const meta = await evaluate(send, `document.getElementById('quickMeta').textContent`);
      assert.equal(meta.includes('自定义混音'), true);
      const m = meta.match(/(\d+)\s*轨/);
      const trackNum = m ? Number(m[1]) : 0;
      assert.ok(trackNum >= 2 && trackNum <= 4, `Expected 2-4 tracks from randomizer, got ${trackNum}`);
    });

    // F04: 8 Scenes Decoupled From Audio Mix
    allPassed &= await runCase('F04 8 Scenes Decoupled From Audio', async () => {
      await evaluate(send, `document.querySelector('[data-preset="rainy-study"]').click()`);
      await evaluate(send, `document.querySelector('.dock-item[data-sheet="mixer"]').click()`);
      const snapshot = await evaluate(
        send,
        `Array.from(document.querySelectorAll('[data-track-pct]')).map((el) => [el.dataset.trackPct, el.textContent])`
      );
      await evaluate(send, `document.getElementById('sheetCloseBtn').click()`);

      await evaluate(send, `document.querySelector('.dock-item[data-sheet="scenes"]').click()`);
      const bodyText = await evaluate(send, `document.getElementById('sheetBody').textContent`);
      assert.equal(bodyText.includes('GPU Canvas'), false);
      assert.equal(bodyText.includes('当前保留声轨：'), true);

      const scenes = await evaluate(
        send,
        `Array.from(document.querySelectorAll('[data-scene-pick]')).map((el) => ({
          id: el.dataset.scenePick,
          name: el.querySelector('.choice-name').textContent.trim(),
        }))`
      );
      assert.equal(scenes.length, 8);
      for (const sc of scenes) {
        await evaluate(send, `document.querySelector('[data-scene-pick="${sc.id}"]').click()`);
        const sub = await evaluate(send, `document.getElementById('brandSub').textContent`);
        assert.equal(sub.includes(sc.name), true);
      }

      await evaluate(send, `document.querySelector('.dock-item[data-sheet="mixer"]').click()`);
      const after = await evaluate(
        send,
        `Array.from(document.querySelectorAll('[data-track-pct]')).map((el) => [el.dataset.trackPct, el.textContent])`
      );
      assert.deepEqual(after, snapshot);
      await evaluate(send, `document.getElementById('sheetCloseBtn').click()`);
    });

    // F05: Brainwaves & Custom Hz Slider
    allPassed &= await runCase('F05 Brainwaves & Custom Hz Accuracy', async () => {
      await evaluate(send, `document.querySelector('[data-preset="rainy-study"]').click()`);
      await evaluate(send, `document.getElementById('playBtn').click()`);
      assert.equal(await evaluate(send, `document.getElementById('playLabel').textContent`), '开启声景');

      await evaluate(send, `document.querySelector('.dock-item[data-sheet="brainwave"]').click()`);
      await evaluate(send, `document.querySelector('[data-wave-pick="gamma"]').click()`);
      assert.equal(await evaluate(send, `document.getElementById('playLabel').textContent`), '轻触暂停');
      const metaAfterGamma = await evaluate(send, `document.getElementById('quickMeta').textContent`);
      assert.equal(metaAfterGamma.includes('3 轨'), true);

      await evaluate(
        send,
        `(() => {
          const s = document.getElementById('customHzSlider');
          s.value = '32';
          s.dispatchEvent(new Event('input', { bubbles: true }));
        })()`
      );
      const st32 = await evaluate(
        send,
        `({ chip: document.getElementById('statusChip').textContent, sel: document.querySelectorAll('[data-wave-pick].is-selected').length })`
      );
      assert.equal(st32.chip.includes('32 Hz γ'), true, `Expected 32 Hz γ, got ${st32.chip}`);
      assert.equal(st32.sel, 0);

      await evaluate(
        send,
        `(() => {
          const s = document.getElementById('customHzSlider');
          s.value = '5.5';
          s.dispatchEvent(new Event('input', { bubbles: true }));
        })()`
      );
      const chip55 = await evaluate(send, `document.getElementById('statusChip').textContent`);
      assert.equal(chip55.includes('5.5 Hz θ'), true, `Expected 5.5 Hz θ, got ${chip55}`);

      await evaluate(send, `document.querySelector('[data-wave-pick="off"]').click()`);
      assert.equal(await evaluate(send, `document.getElementById('statusChip').textContent.includes('纯净自然声')`), true);
      await evaluate(send, `document.getElementById('sheetCloseBtn').click()`);
    });

    // F06: Guided Breathing (Normal + Immersive)
    allPassed &= await runCase('F06 Guided Breathing Normal & Immersive', async () => {
      await evaluate(send, `document.getElementById('breathBtn').click()`);
      assert.equal(await evaluate(send, `!document.getElementById('breathCue').hidden`), true);
      await evaluate(send, `document.getElementById('breathBtn').click()`);
      await sleep(150);

      await evaluate(send, `document.getElementById('immersiveBtn').click()`);
      const imm = await evaluate(
        send,
        `({
          isImmersive: document.getElementById('appShell').classList.contains('is-immersive'),
          isBreathing: document.getElementById('immersiveClock').classList.contains('is-breathing'),
          breathHidden: document.getElementById('immersiveBreath').hidden,
          phase: document.getElementById('immersiveBreathPhase').textContent.trim(),
          sec: document.getElementById('immersiveBreathSec').textContent.trim(),
        })`
      );
      assert.equal(imm.isImmersive, true);
      assert.equal(imm.isBreathing, true);
      assert.equal(imm.breathHidden, false);
      assert.ok(imm.phase.length > 0);
      assert.match(imm.sec, /^\d+s$/);

      await sleep(350);
      await evaluate(send, `window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 600, clientY: 360 }))`);
      assert.equal(await evaluate(send, `document.getElementById('appShell').classList.contains('is-immersive')`), false);

      await evaluate(send, `document.getElementById('breathBtn').click()`);
      assert.equal(await evaluate(send, `document.getElementById('immersiveBreath').hidden`), true);
      assert.equal(await evaluate(send, `document.getElementById('immersiveClock').classList.contains('is-breathing')`), false);
    });

    // F07: Immersive Desk Clock, Keyboard & Backdrop Escape
    allPassed &= await runCase('F07 Immersive Desk Clock & Escape Behavior', async () => {
      await evaluate(send, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true }))`);
      assert.equal(await evaluate(send, `document.getElementById('appShell').classList.contains('is-immersive')`), true);
      assert.match(await evaluate(send, `document.getElementById('immersiveClockTime').textContent.trim()`), /^\d{2}:\d{2}$/);

      await sleep(350);
      await evaluate(send, `window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 640, clientY: 400 }))`);
      assert.equal(await evaluate(send, `document.getElementById('appShell').classList.contains('is-immersive')`), false);

      await evaluate(send, `document.querySelector('.dock-item[data-sheet="scenes"]').click()`);
      await evaluate(send, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))`);
      assert.equal(await evaluate(send, `document.getElementById('sheetBackdrop').hidden`), true);

      await evaluate(send, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true }))`);
      await evaluate(send, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))`);
      assert.equal(await evaluate(send, `document.getElementById('appShell').classList.contains('is-immersive')`), false);
    });

    // F08: Pomodoro 1Hz Immersive Tick, Custom Durations, Sleep Timer & Bowl Chime
    allPassed &= await runCase('F08 Pomodoro 1Hz Immersive Tick & Sleep Timer', async () => {
      await evaluate(send, `document.querySelector('.dock-item[data-sheet="timer"]').click()`);
      await evaluate(send, `document.getElementById('testChimeBtn').click()`);

      // Test independent custom durations for Focus and Sleep modes
      await evaluate(
        send,
        `(() => {
          const s = document.getElementById('customTimerSlider');
          s.value = '37';
          s.dispatchEvent(new Event('input', { bubbles: true }));
        })()`
      );
      await evaluate(send, `document.querySelector('[data-timer-step="1"]').click()`);
      assert.equal(await evaluate(send, `document.getElementById('timerCountdown').textContent`), '38:00');
      assert.equal(await evaluate(send, `document.getElementById('customTimerLabel').textContent`), '38 分');

      await evaluate(send, `document.querySelector('[data-timer-mode="sleep"]').click()`);
      await evaluate(
        send,
        `(() => {
          const s = document.getElementById('customTimerSlider');
          s.value = '50';
          s.dispatchEvent(new Event('input', { bubbles: true }));
        })()`
      );
      assert.equal(await evaluate(send, `document.getElementById('timerCountdown').textContent`), '50:00');

      await evaluate(send, `document.querySelector('[data-timer-mode="focus"]').click()`);
      assert.equal(await evaluate(send, `document.getElementById('timerCountdown').textContent`), '38:00');

      await evaluate(send, `document.querySelector('[data-timer-min="15"]').click()`);
      await evaluate(send, `document.getElementById('timerToggleBtn').click()`);
      await evaluate(send, `document.getElementById('sheetCloseBtn').click()`);
      await evaluate(send, `document.getElementById('immersiveBtn').click()`);

      const t1 = await evaluate(send, `document.getElementById('immersiveClockTime').textContent`);
      await sleep(1600);
      const t2 = await evaluate(send, `document.getElementById('immersiveClockTime').textContent`);
      assert.notEqual(t2, t1, `Immersive countdown must tick every second (${t1} vs ${t2})`);

      await sleep(300);
      await evaluate(send, `window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 640, clientY: 400 }))`);
      await evaluate(send, `document.querySelector('.dock-item[data-sheet="timer"]').click()`);
      await evaluate(send, `document.querySelector('[data-timer-mode="sleep"]').click()`);
      assert.equal(await evaluate(send, `document.getElementById('timerCountdown').textContent`), '50:00');
      await evaluate(send, `document.getElementById('timerToggleBtn').click()`);
      assert.equal(await evaluate(send, `document.getElementById('timerReadout').textContent.includes('睡眠渐弱')`), true);
      await evaluate(send, `document.getElementById('timerToggleBtn').click()`);
      await evaluate(send, `document.getElementById('sheetCloseBtn').click()`);
    });

    // F09: Recipes Library & Session Reload Persistence
    allPassed &= await runCase('F09 Recipes & Reload Session Persistence', async () => {
      await evaluate(send, `document.querySelector('[data-preset="hearth-warmth"]').click()`);
      await sleep(350); // allow local session debounce save
      await evaluate(send, `document.querySelector('.dock-item[data-sheet="recipes"]').click()`);
      const before = await evaluate(send, `document.querySelectorAll('#sheetBody .saved-item').length`);
      await evaluate(send, `document.querySelector('[data-name-tag="静谧心流时刻"]').click()`);
      await evaluate(send, `document.getElementById('saveCurrentMixBtn').click()`);
      assert.equal(await evaluate(send, `document.querySelectorAll('#sheetBody .saved-item').length`), before + 1);

      await send('Page.reload');
      await waitUntil(send, `Boolean(document.getElementById('playBtn') && document.querySelectorAll('.preset-pill').length === 11)`);
      await sleep(250);
      assert.equal(await evaluate(send, `document.getElementById('brandSub').textContent.includes('冬夜壁炉')`), true);

      await evaluate(send, `document.querySelector('.dock-item[data-sheet="recipes"]').click()`);
      const afterReload = await evaluate(send, `document.querySelectorAll('#sheetBody .saved-item').length`);
      assert.equal(afterReload, before + 1);

      await evaluate(send, `document.querySelector('[data-load-saved="0"]').click()`);
      assert.equal(await evaluate(send, `document.getElementById('playLabel').textContent`), '轻触暂停');
      await evaluate(send, `document.querySelector('[data-del-saved="0"]').click()`);
      assert.equal(await evaluate(send, `document.querySelectorAll('#sheetBody .saved-item').length`), before);
      await evaluate(send, `document.getElementById('sheetCloseBtn').click()`);
    });

    // F10: Share Card Export & #mix= URL Hydration
    allPassed &= await runCase('F10 Share Poster Card & #mix= URL Hydration', async () => {
      await evaluate(send, `document.querySelector('[data-preset="rainy-study"]').click()`);
      await evaluate(send, `document.getElementById('shareBtn').click()`);
      await waitUntil(
        send,
        `(() => { const img = document.querySelector('.card-preview-img'); return Boolean(img && img.complete && img.naturalWidth === 1080 && img.naturalHeight === 1440 && img.src.startsWith('data:image/png;base64,')); })()`,
        4000
      );
      const dataUrl = await evaluate(send, `document.querySelector('.card-preview-img').src`);
      const outPath = path.join(RELEASE_DIR, 'preview-card.png');
      fs.writeFileSync(outPath, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));

      await send('Page.navigate', { url: 'about:blank' });
      await sleep(100);
      await send('Page.navigate', { url: `${baseUrl}#mix=v1.7.3.60.0000000000231937` });
      await waitUntil(send, `Boolean(document.getElementById('brandSub') && document.querySelectorAll('.preset-pill').length === 11)`);
      await sleep(250);
      const sub = await evaluate(send, `document.getElementById('brandSub').textContent`);
      assert.equal(sub.includes('极光禅境'), true);
      assert.equal(sub.includes('6 Hz θ'), true);
    });

    // F11: Keyboard Shortcuts & Mobile Viewport Layout (390x844)
    allPassed &= await runCase('F11 Keyboard & Mobile Viewport (390x844)', async () => {
      await evaluate(send, `document.querySelector('[data-preset="rainy-study"]').click()`);
      await evaluate(send, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }))`);
      assert.equal(await evaluate(send, `document.querySelector('.preset-pill.is-active')?.dataset.preset`), 'hearth-warmth');
      await evaluate(send, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true }))`);
      assert.equal(await evaluate(send, `document.getElementById('toast').textContent.includes('总音量')`), true);

      await send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await sleep(250);

      const layout = await evaluate(
        send,
        `(() => {
          const top = document.querySelector('.top-bar').getBoundingClientRect();
          const orbit = document.getElementById('playOrbit').getBoundingClientRect();
          const dock = document.querySelector('.bottom-dock').getBoundingClientRect();
          return {
            scrollW: document.documentElement.scrollWidth,
            innerW: window.innerWidth,
            topBottom: top.bottom,
            orbitTop: orbit.top,
            orbitBottom: orbit.bottom,
            dockTop: dock.top,
          };
        })()`
      );
      assert.ok(layout.scrollW <= layout.innerW, `Horizontal overflow: ${layout.scrollW} > ${layout.innerW}`);
      assert.ok(layout.orbitTop >= layout.topBottom - 2, 'playOrbit overlaps top-bar on mobile');
      assert.ok(layout.orbitBottom <= layout.dockTop + 2, 'playOrbit overlaps bottom-dock on mobile');

      await evaluate(send, `document.getElementById('immersiveBtn').click()`);
      await sleep(350);
      await evaluate(send, `window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 195, clientY: 422 }))`);
      assert.equal(await evaluate(send, `document.getElementById('appShell').classList.contains('is-immersive')`), false);
    });

    // Gate Checks: zero uncaught exceptions + zero external audio requests
    allPassed &= await runCase('Gate: Zero Uncaught JS Exceptions & Zero External Audio', async () => {
      assert.equal(uncaughtErrors.length, 0, `Uncaught exceptions: ${uncaughtErrors.join('; ')}`);
      const badRequests = requestedUrls.filter(
        (u) => !u.startsWith(`http://127.0.0.1:${httpPort}/`) && !u.startsWith('https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js')
      );
      assert.equal(badRequests.length, 0, `Disallowed external requests: ${badRequests.join(', ')}`);
    });

    if (!allPassed) {
      process.exitCode = 1;
    }
  } finally {
    if (client?.ws) {
      try {
        client.ws.close();
      } catch {
        // ignore
      }
    }
    await new Promise((res) => server.close(() => res()));
    if (child && !child.killed) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
    await sleep(300);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore Windows handle delay
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
