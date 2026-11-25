import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_WEB_DIR = path.join(ROOT, 'dist-web');
const RELEASE_DIR = path.join(ROOT, 'release');
const DESKTOP_DIR = path.join(ROOT, 'desktop');
const ZIP_PATH = path.join(RELEASE_DIR, 'auraspace-toy.zip');
const WEB_BUNDLE_ZIP = path.join(DESKTOP_DIR, 'web-bundle.zip');

function shortHash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

// 简单轻量 JS/CSS 清理：移除纯行首注释与多余空行（不破坏字符串与正则）
function cleanCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

// CRC32 表，用于生成标准 POSIX 路径 ZIP 包
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  // entries: [{ name: 'index.html', data: Buffer }]
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const entry of entries) {
    const posixName = entry.name.replace(/\\/g, '/');
    const nameBuf = Buffer.from(posixName, 'utf8');
    const raw = entry.data;
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = compressed.length < raw.length;
    const payload = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x031e, 4); // Unix creator
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function build({ standalone = false } = {}) {
  const outDir = standalone ? DIST_WEB_DIR : DIST_DIR;
  const assetsDir = path.join(outDir, 'assets');
  resetDir(outDir);
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(RELEASE_DIR, { recursive: true });

  // 按依赖拓扑顺序构建 ES 模块并生成 contenthash
  const moduleOrder = [
    'config.js',
    'presets.js',
    'audio-engine.js',
    'scene-canvas.js',
    'toy-bridge.js',
    'card-export.js',
    'app.js',
  ];

  const hashedNames = new Map();
  const entries = [];

  for (const file of moduleOrder) {
    let code = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    // 将相对 ESM 导入重写为带指纹的文件名
    for (const [orig, hashed] of hashedNames.entries()) {
      code = code.replaceAll(`'./${orig}'`, `'./${hashed}'`);
      code = code.replaceAll(`"./${orig}"`, `"./${hashed}"`);
    }
    const buf = Buffer.from(code, 'utf8');
    const base = path.basename(file, '.js');
    const outName = `${base}.${shortHash(buf)}.js`;
    hashedNames.set(file, outName);

    fs.writeFileSync(path.join(assetsDir, outName), buf);
    entries.push({ name: `assets/${outName}`, data: buf });
  }

  const rawCss = fs.readFileSync(path.join(SRC_DIR, 'styles.css'), 'utf8');
  const cssBuf = Buffer.from(cleanCss(rawCss), 'utf8');
  const cssOutName = `styles.${shortHash(cssBuf)}.css`;
  fs.writeFileSync(path.join(assetsDir, cssOutName), cssBuf);
  entries.push({ name: `assets/${cssOutName}`, data: cssBuf });

  let html = fs.readFileSync(path.join(SRC_DIR, 'index.html'), 'utf8');
  html = html.replace('./styles.css', `./assets/${cssOutName}`);
  html = html.replace('./app.js', `./assets/${hashedNames.get('app.js')}`);

  if (standalone) {
    // 独立离线版本：剥离 B 站容器 SDK 外链脚本并注入 PWA 元数据
    html = html.replace(/\s*<script[^>]*toy-sdk\.js[^>]*><\/script>\s*/i, '\n  ');
    html = html.replace(
      '</head>',
      '  <meta name="theme-color" content="#070b18" />\n  <link rel="manifest" href="./manifest.webmanifest" />\n</head>'
    );

    const manifestBuf = Buffer.from(
      JSON.stringify(
        {
          name: '静界 · AuraSpace',
          short_name: '静界',
          description: '纯前端实时合成空间白噪音、双耳节拍脑波与专注呼吸引导工坊',
          start_url: './index.html',
          display: 'standalone',
          background_color: '#070b18',
          theme_color: '#070b18',
          icons: [
            {
              src: './icon.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    fs.writeFileSync(path.join(outDir, 'manifest.webmanifest'), manifestBuf);
    entries.push({ name: 'manifest.webmanifest', data: manifestBuf });

    const iconSrc = path.join(RELEASE_DIR, 'icon.png');
    if (fs.existsSync(iconSrc)) {
      const iconBuf = fs.readFileSync(iconSrc);
      fs.writeFileSync(path.join(outDir, 'icon.png'), iconBuf);
      entries.push({ name: 'icon.png', data: iconBuf });
    }
  }

  const htmlBuf = Buffer.from(html, 'utf8');
  if (!standalone && htmlBuf.length >= 1024 * 1024) {
    throw new Error(`dist/index.html exceeds 1MB hard limit: ${htmlBuf.length} bytes`);
  }

  fs.writeFileSync(path.join(outDir, 'index.html'), htmlBuf);
  entries.unshift({ name: 'index.html', data: htmlBuf });

  const zipBuf = buildZip(entries);
  if (standalone) {
    fs.mkdirSync(DESKTOP_DIR, { recursive: true });
    fs.writeFileSync(WEB_BUNDLE_ZIP, zipBuf);
    console.log(`Built dist-web/index.html: ${(htmlBuf.length / 1024).toFixed(2)} KB`);
    console.log(`Built ${entries.length} standalone files into desktop/web-bundle.zip: ${(zipBuf.length / 1024).toFixed(2)} KB`);
  } else {
    fs.writeFileSync(ZIP_PATH, zipBuf);
    console.log(`Built dist/index.html: ${(htmlBuf.length / 1024).toFixed(2)} KB`);
    console.log(`Built ${entries.length} files into release/auraspace-toy.zip: ${(zipBuf.length / 1024).toFixed(2)} KB`);
  }
}

build({ standalone: process.argv.includes('--standalone') });
