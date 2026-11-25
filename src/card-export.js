import { BRAINWAVE_MAP, SCENE_MAP, TRACKS, TRACK_MAP } from './presets.js';

/**
 * 在离屏 Canvas 生成 1080×1440 (3:4) 高颜值「空间配方海报卡」PNG (Data URL)
 * 严格控制体积远低于 B站 Toy saveImageToAlbum 5MB 上限。
 */
export async function renderRecipeCard({
  title,
  mix,
  totalFocusMinutes = 0,
  qrDataUrl = null,
}) {
  const width = 1080;
  const height = 1440;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const scene = SCENE_MAP[mix.scene] || SCENE_MAP['rainy-window'];
  const bw = BRAINWAVE_MAP[mix.brainwave] || BRAINWAVE_MAP.off;
  const displayHz = bw.id === 'off' ? 'PURE' : `${mix.customHz || bw.hz} Hz`;

  // 1. 背景渐层
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, scene.bgTop);
  bg.addColorStop(0.65, scene.bgBottom);
  bg.addColorStop(1, '#05070e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // 2. 氛围光晕
  const orb1 = ctx.createRadialGradient(width * 0.25, height * 0.24, 20, width * 0.25, height * 0.24, 540);
  orb1.addColorStop(0, scene.accentSoft);
  orb1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = orb1;
  ctx.fillRect(0, 0, width, height);

  const orb2 = ctx.createRadialGradient(width * 0.82, height * 0.72, 20, width * 0.82, height * 0.72, 480);
  orb2.addColorStop(0, scene.accentSoft);
  orb2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = orb2;
  ctx.fillRect(0, 0, width, height);

  // 3. 几何声波共振环与场景主题纹样装饰
  drawSceneMotif(ctx, width, height, scene);
  ctx.save();
  ctx.strokeStyle = scene.accent;
  for (let i = 0; i < 4; i++) {
    ctx.globalAlpha = 0.22 - i * 0.04;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(width * 0.5, 420, 150 + i * 48, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // 星点微粒
  ctx.save();
  for (let i = 0; i < 60; i++) {
    const sx = ((i * 197 + 43) % 980) + 50;
    const sy = ((i * 313 + 71) % 620) + 40;
    ctx.fillStyle = `rgba(255,255,255,${0.12 + (i % 5) * 0.07})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 1.5 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 4. 顶部品牌标识
  ctx.fillStyle = 'rgba(255,255,255,0.68)';
  ctx.font = '600 26px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('静界 · AURASPACE', 78, 92);

  ctx.textAlign = 'right';
  ctx.fillStyle = scene.accent;
  ctx.font = '600 24px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(displayHz, width - 78, 92);

  // 5. 主玻璃卡片容器
  const cardX = 68;
  const cardY = 230;
  const cardW = width - 136;
  const cardH = qrDataUrl ? 980 : 880;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 36);
  ctx.fillStyle = 'rgba(12, 16, 28, 0.72)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.stroke();

  // 6. 场景标签与配方大标题
  ctx.textAlign = 'left';
  ctx.fillStyle = scene.accent;
  ctx.font = '600 26px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.fillText(`# ${scene.name} · ${scene.tag}`, cardX + 56, cardY + 86);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 58px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.fillText(title || '此刻静界配方', cardX + 56, cardY + 168);

  // 脑波与专注时长胶囊
  const badgeText = bw.id === 'off' ? '纯净自然声场' : `${bw.name} · ${displayHz}`;
  drawRoundedRect(ctx, cardX + 56, cardY + 206, 360, 52, 26);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fill();
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '500 24px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.fillText(badgeText, cardX + 82, cardY + 240);

  if (totalFocusMinutes > 0) {
    const minsText = `已累计静心 ${totalFocusMinutes} 分钟`;
    drawRoundedRect(ctx, cardX + 436, cardY + 206, 320, 52, 26);
    ctx.fillStyle = scene.accentSoft;
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(minsText, cardX + 462, cardY + 240);
  }

  // 分隔线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cardX + 56, cardY + 292);
  ctx.lineTo(cardX + cardW - 56, cardY + 292);
  ctx.stroke();

  // 7. 声轨配比条
  const activeTracks = TRACKS.filter((t) => (mix.tracks?.[t.id] || 0) > 0.01)
    .sort((a, b) => (mix.tracks[b.id] || 0) - (mix.tracks[a.id] || 0))
    .slice(0, 6);

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '500 24px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.fillText('声景混音配方', cardX + 56, cardY + 346);

  if (activeTracks.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '400 28px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillText('仅开启脑波频率引导，无外部环境声轨', cardX + 56, cardY + 420);
  } else {
    const startY = cardY + 402;
    const rowGap = 78;
    const barW = cardW - 320;
    activeTracks.forEach((t, idx) => {
      const y = startY + idx * rowGap;
      const vol = mix.tracks[t.id] || 0;
      const pct = Math.round(vol * 100);
      const trackInfo = TRACK_MAP[t.id];

      ctx.textAlign = 'left';
      ctx.fillStyle = '#f1f5f9';
      ctx.font = '600 28px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillText(trackInfo.name, cardX + 56, y);

      // 背景轨道槽
      drawRoundedRect(ctx, cardX + 220, y - 22, barW, 20, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();

      // 填充进度条
      const fillW = Math.max(20, barW * vol);
      drawRoundedRect(ctx, cardX + 220, y - 22, fillW, 20, 10);
      ctx.fillStyle = trackInfo.color || scene.accent;
      ctx.fill();

      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.font = '600 24px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(`${pct}%`, cardX + cardW - 56, y - 2);
    });
  }

  // 8. 底部二维码区（仅在传入站内二维码时绘制）
  if (qrDataUrl) {
    try {
      const footerY = cardY + cardH - 180;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
      ctx.beginPath();
      ctx.moveTo(cardX + 56, footerY);
      ctx.lineTo(cardX + cardW - 56, footerY);
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '600 26px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillText('扫码复原此声景配方', cardX + 56, footerY + 98);

      const img = await loadImage(qrDataUrl);
      const qSize = 128;
      const qx = cardX + cardW - 56 - qSize;
      const qy = footerY + 28;
      drawRoundedRect(ctx, qx - 8, qy - 8, qSize + 16, qSize + 16, 14);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.drawImage(img, qx, qy, qSize, qSize);
    } catch (_) {
      // 忽略二维码绘制异常
    }
  }

  // 页脚签名
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.font = '500 22px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.fillText('PURE WEBAUDIO SYNTHESIS · ZERO TRACKING · AURASPACE', width * 0.5, height - 88);

  return canvas.toDataURL('image/png');
}

function drawSceneMotif(ctx, width, height, scene) {
  ctx.save();
  const id = scene.id;
  if (id === 'rainy-window') {
    ctx.strokeStyle = 'rgba(186, 220, 255, 0.24)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 42; i++) {
      const rx = ((i * 173 + 31) % (width - 80)) + 40;
      const ry = ((i * 257 + 19) % (height - 160)) + 40;
      const len = 45 + (i % 4) * 24;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - len * 0.12, ry + len);
      ctx.stroke();
    }
  } else if (id === 'fireside') {
    const glow = ctx.createRadialGradient(width * 0.5, height * 0.96, 20, width * 0.5, height * 0.96, 640);
    glow.addColorStop(0, 'rgba(251, 146, 60, 0.35)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 36; i++) {
      const ex = 180 + ((i * 199) % 720);
      const ey = height - 80 - ((i * 137) % 620);
      ctx.fillStyle = 'rgba(253, 186, 116, 0.48)';
      ctx.beginPath();
      ctx.arc(ex, ey, 2 + (i % 4), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (id === 'study') {
    const cone = ctx.createLinearGradient(width * 0.5, 40, width * 0.5, height * 0.9);
    cone.addColorStop(0, 'rgba(255, 214, 130, 0.26)');
    cone.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(width * 0.44, 0);
    ctx.lineTo(width * 0.56, 0);
    ctx.lineTo(width * 0.95, height);
    ctx.lineTo(width * 0.05, height);
    ctx.closePath();
    ctx.fill();
  } else if (id === 'orbital') {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(width * 0.5, height + 720, 960, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  } else if (id === 'night-train') {
    for (let i = 0; i < 18; i++) {
      const sx = ((i * 139) % 700) + 40;
      const sy = 140 + ((i * 193) % 1080);
      const slen = 180 + (i % 4) * 90;
      const g = ctx.createLinearGradient(sx, sy, sx + slen, sy);
      g.addColorStop(0, 'rgba(244, 114, 182, 0)');
      g.addColorStop(0.5, 'rgba(244, 114, 182, 0.34)');
      g.addColorStop(1, 'rgba(244, 114, 182, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx, sy, slen, 6);
    }
  } else if (id === 'snowy-pines') {
    ctx.fillStyle = 'rgba(15, 41, 52, 0.72)';
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, height * 0.78);
    ctx.lineTo(width * 0.32, height * 0.66);
    ctx.lineTo(width * 0.68, height * 0.75);
    ctx.lineTo(width, height * 0.64);
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  } else if (id === 'abyss') {
    for (let i = 0; i < 4; i++) {
      const rx = 180 + i * 220;
      const ray = ctx.createLinearGradient(rx, 0, rx + 90, height * 0.78);
      ray.addColorStop(0, 'rgba(34, 211, 238, 0.16)');
      ray.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(rx - 30, 0);
      ctx.lineTo(rx + 30, 0);
      ctx.lineTo(rx + 180, height * 0.85);
      ctx.lineTo(rx - 70, height * 0.85);
      ctx.closePath();
      ctx.fill();
    }
  } else if (id === 'aurora-zen') {
    const g = ctx.createLinearGradient(0, 120, width, 540);
    g.addColorStop(0, 'rgba(192, 132, 252, 0.22)');
    g.addColorStop(0.5, 'rgba(45, 212, 191, 0.18)');
    g.addColorStop(1, 'rgba(232, 121, 249, 0.14)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 260);
    ctx.bezierCurveTo(width * 0.33, 140, width * 0.66, 420, width, 240);
    ctx.lineTo(width, 480);
    ctx.bezierCurveTo(width * 0.66, 620, width * 0.33, 320, 0, 440);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
