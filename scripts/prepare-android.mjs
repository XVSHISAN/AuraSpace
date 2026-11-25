import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST_WEB = path.join(ROOT, 'dist-web');
const ANDROID_DIR = path.join(ROOT, 'android');
const ICON_SRC = path.join(ROOT, 'release', 'icon.png');

function run(cmd, cwd = ROOT) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

if (!fs.existsSync(path.join(DIST_WEB, 'index.html'))) {
  run('node scripts/build.mjs --standalone');
}

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
if (!fs.existsSync(ANDROID_DIR)) {
  execFileSync(npxCmd, ['cap', 'add', 'android'], { cwd: ROOT, stdio: 'inherit' });
} else {
  execFileSync(npxCmd, ['cap', 'sync', 'android'], { cwd: ROOT, stdio: 'inherit' });
}

// 1. 允许 WebView 离线无需二次手势静音限制、启用 DOM Storage 与暗色系统栏
const mainActivityPath = path.join(
  ANDROID_DIR,
  'app',
  'src',
  'main',
  'java',
  'io',
  'github',
  'xvshisan',
  'auraspace',
  'MainActivity.java'
);

const patchedMainActivity = `package io.github.xvshisan.auraspace;

import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#070b18"));
        getWindow().setNavigationBarColor(Color.parseColor("#070b18"));
        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView wv = this.bridge.getWebView();
            wv.setBackgroundColor(Color.parseColor("#070b18"));
            WebSettings settings = wv.getSettings();
            settings.setDomStorageEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
        }
    }
}
`;

fs.mkdirSync(path.dirname(mainActivityPath), { recursive: true });
fs.writeFileSync(mainActivityPath, patchedMainActivity, 'utf8');
console.log('Patched MainActivity.java for offline WebAudio & dark status/nav bar.');

// 2. 配置深色启动窗底色防止白屏闪烁
const stylesPath = path.join(ANDROID_DIR, 'app', 'src', 'main', 'res', 'values', 'styles.xml');
if (fs.existsSync(stylesPath)) {
  let styles = fs.readFileSync(stylesPath, 'utf8');
  if (!styles.includes('android:windowBackground')) {
    styles = styles.replace(
      '</style>',
      '        <item name="android:windowBackground">#070b18</item>\n    </style>'
    );
    fs.writeFileSync(stylesPath, styles, 'utf8');
    console.log('Patched Android styles.xml dark background.');
  }
}

// 3. 使用 Pillow 从 release/icon.png 生成全套自适应桌面图标
if (fs.existsSync(ICON_SRC)) {
  const pyScript = `
import os
from PIL import Image

src = r"${ICON_SRC.replace(/\\/g, '\\\\')}"
res_dir = r"${path.join(ANDROID_DIR, 'app', 'src', 'main', 'res').replace(/\\/g, '\\\\')}"
img = Image.open(src).convert("RGBA")

sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

for folder, px in sizes.items():
    out_dir = os.path.join(res_dir, folder)
    os.makedirs(out_dir, exist_ok=True)
    resized = img.resize((px, px), Image.Resampling.LANCZOS)
    resized.save(os.path.join(out_dir, "ic_launcher.png"))
    resized.save(os.path.join(out_dir, "ic_launcher_round.png"))
    resized.save(os.path.join(out_dir, "ic_launcher_foreground.png"))

print("Generated Android launcher icons across mipmap-* directories.")
`;
  try {
    execFileSync('python3', ['-c', pyScript], { stdio: 'inherit' });
  } catch {
    try {
      execFileSync('python', ['-c', pyScript], { stdio: 'inherit' });
    } catch {
      console.warn('Pillow not available; keeping default Capacitor Android launcher icons.');
    }
  }
}
