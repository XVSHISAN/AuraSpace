/**
 * 「静界 AuraSpace」声景、脑波、视觉场景、一键配方与 URL Hash 编解码器
 * 严格遵循 B 站 Toy 内容安全规范：全站零自由文本输入框，配方命名使用精选诗意标签组合。
 */

export const TRACKS = Object.freeze([
  {
    id: 'rain',
    name: '夜窗细雨',
    en: 'Night Rain',
    desc: '玻璃雨滴与远檐微雨',
    category: '自然',
    pro: false,
    icon: 'rain',
    defaultVol: 0.65,
    color: '#60a5fa',
  },
  {
    id: 'thunder',
    name: '远空闷雷',
    en: 'Distant Thunder',
    desc: '低频滚雷与窗光微闪',
    category: '自然',
    pro: false,
    icon: 'thunder',
    defaultVol: 0.28,
    color: '#818cf8',
  },
  {
    id: 'fire',
    name: '壁炉炭火',
    en: 'Hearth Fire',
    desc: '暖意木柴劈啪轻响',
    category: '室内',
    pro: false,
    icon: 'fire',
    defaultVol: 0.55,
    color: '#fb923c',
  },
  {
    id: 'library',
    name: '深夜书房',
    en: 'Quiet Study',
    desc: '暖灯空间底噪与偶发翻页',
    category: '室内',
    pro: false,
    icon: 'library',
    defaultVol: 0.35,
    color: '#fbbf24',
  },
  {
    id: 'train',
    name: '夜行列车',
    en: 'Midnight Rail',
    desc: '铁轨接缝节拍与车厢低鸣',
    category: '旅途',
    pro: true,
    icon: 'train',
    defaultVol: 0.52,
    color: '#f472b6',
  },
  {
    id: 'wind',
    name: '松林山风',
    en: 'Alpine Wind',
    desc: '山谷穿林风声呼啸起伏',
    category: '自然',
    pro: true,
    icon: 'wind',
    defaultVol: 0.48,
    color: '#34d399',
  },
  {
    id: 'ocean',
    name: '深海潮汐',
    en: 'Abyssal Tide',
    desc: '慢呼吸海浪涌动与潜流',
    category: '自然',
    pro: true,
    icon: 'ocean',
    defaultVol: 0.56,
    color: '#22d3ee',
  },
  {
    id: 'lofi',
    name: '星云和弦',
    en: 'Nebula Pad',
    desc: '温润 Lo-Fi 五声音阶氛围铺底',
    category: '氛围',
    pro: true,
    icon: 'lofi',
    defaultVol: 0.42,
    color: '#c084fc',
  },
]);

export const TRACK_MAP = Object.freeze(
  Object.fromEntries(TRACKS.map((t) => [t.id, t]))
);

export const BRAINWAVES = Object.freeze([
  {
    id: 'off',
    name: '纯净自然声',
    hz: 0,
    band: 'OFF',
    desc: '不叠加双耳节拍，纯享环境声场',
    baseFreq: 0,
    pro: false,
  },
  {
    id: 'alpha',
    name: 'α 放松心流',
    hz: 10,
    band: '10 Hz Alpha',
    desc: '阅读 / 创意发想 / 轻度放松（建议佩戴耳机）',
    baseFreq: 196,
    pro: false,
  },
  {
    id: 'gamma',
    name: 'γ 深度专注',
    hz: 40,
    band: '40 Hz Gamma',
    desc: '高强度解题 / 编程冲刺 / 记忆巩固',
    baseFreq: 210,
    pro: true,
  },
  {
    id: 'theta',
    name: 'θ 冥想灵感',
    hz: 6,
    band: '6 Hz Theta',
    desc: '正念冥想 / 午间小憩 / 潜意识漫游',
    baseFreq: 164,
    pro: true,
  },
  {
    id: 'delta',
    name: 'δ 深睡舒缓',
    hz: 2.5,
    band: '2.5 Hz Delta',
    desc: '睡前入眠 / 卸下焦虑 / 夜间稳态',
    baseFreq: 136.1,
    pro: true,
  },
]);

export const BRAINWAVE_MAP = Object.freeze(
  Object.fromEntries(BRAINWAVES.map((b) => [b.id, b]))
);

export const SCENES = Object.freeze([
  {
    id: 'rainy-window',
    name: '雨夜归窗',
    tag: '城市微光 · 玻璃雨痕',
    pro: false,
    accent: '#6ea8fe',
    accentSoft: 'rgba(110, 168, 254, 0.22)',
    bgTop: '#070b18',
    bgBottom: '#131d36',
  },
  {
    id: 'fireside',
    name: '冬夜壁炉',
    tag: '炉火余烬 · 窗外飘雪',
    pro: false,
    accent: '#fb923c',
    accentSoft: 'rgba(251, 146, 60, 0.22)',
    bgTop: '#160b07',
    bgBottom: '#2d150c',
  },
  {
    id: 'study',
    name: '凌晨书桌',
    tag: '暖黄台灯 · 浮尘光锥',
    pro: false,
    accent: '#f5b942',
    accentSoft: 'rgba(245, 185, 66, 0.20)',
    bgTop: '#100d09',
    bgBottom: '#241b11',
  },
  {
    id: 'orbital',
    name: '近地轨道',
    tag: '行星极光 · 轨道星尘',
    pro: true,
    accent: '#38bdf8',
    accentSoft: 'rgba(56, 189, 248, 0.22)',
    bgTop: '#030614',
    bgBottom: '#0b1834',
  },
  {
    id: 'night-train',
    name: '午夜新干线',
    tag: '站台流光 · 车窗剪影',
    pro: true,
    accent: '#f472b6',
    accentSoft: 'rgba(244, 114, 182, 0.20)',
    bgTop: '#0b0816',
    bgBottom: '#1e1233',
  },
  {
    id: 'snowy-pines',
    name: '雪夜松林',
    tag: '远山雪幕 · 林间微风',
    pro: true,
    accent: '#5eead4',
    accentSoft: 'rgba(94, 234, 212, 0.20)',
    bgTop: '#051118',
    bgBottom: '#0f2730',
  },
  {
    id: 'abyss',
    name: '深海穹顶',
    tag: '丁达尔光束 · 浮游微光',
    pro: true,
    accent: '#22d3ee',
    accentSoft: 'rgba(34, 211, 238, 0.20)',
    bgTop: '#020c18',
    bgBottom: '#06263d',
  },
  {
    id: 'aurora-zen',
    name: '极光禅境',
    tag: '丝绸极光 · 谐波共振',
    pro: true,
    accent: '#c084fc',
    accentSoft: 'rgba(192, 132, 252, 0.22)',
    bgTop: '#070616',
    bgBottom: '#171033',
  },
]);

export const SCENE_MAP = Object.freeze(
  Object.fromEntries(SCENES.map((s) => [s.id, s]))
);

export const PRESETS = Object.freeze([
  {
    id: 'rainy-study',
    name: '雨夜研读',
    badge: '心流推荐',
    pro: false,
    scene: 'rainy-window',
    brainwave: 'alpha',
    customHz: 10,
    tracks: { rain: 0.68, thunder: 0.22, library: 0.30 },
  },
  {
    id: 'hearth-warmth',
    name: '炉边夜话',
    badge: '暖愈放松',
    pro: false,
    scene: 'fireside',
    brainwave: 'off',
    customHz: 10,
    tracks: { fire: 0.72, rain: 0.26 },
  },
  {
    id: 'midnight-desk',
    name: '独灯夜稿',
    badge: '文字工作',
    pro: false,
    scene: 'study',
    brainwave: 'alpha',
    customHz: 10,
    tracks: { library: 0.56, rain: 0.28 },
  },
  {
    id: 'storm-shelter',
    name: '避风港湾',
    badge: '沉浸白噪',
    pro: false,
    scene: 'rainy-window',
    brainwave: 'off',
    customHz: 10,
    tracks: { rain: 0.78, thunder: 0.44, fire: 0.36 },
  },
  {
    id: 'gamma-sprint',
    name: '40Hz 极客冲刺',
    badge: '40Hz γ波',
    pro: true,
    scene: 'orbital',
    brainwave: 'gamma',
    customHz: 40,
    tracks: { lofi: 0.44, rain: 0.32, library: 0.22 },
  },
  {
    id: 'midnight-express',
    name: '穿越霓虹夜行',
    badge: '旅途放空',
    pro: true,
    scene: 'night-train',
    brainwave: 'theta',
    customHz: 6,
    tracks: { train: 0.66, rain: 0.34, lofi: 0.28 },
  },
  {
    id: 'alpine-cabin',
    name: '雪山木屋壁炉',
    badge: '冬日限定',
    pro: true,
    scene: 'snowy-pines',
    brainwave: 'off',
    customHz: 10,
    tracks: { wind: 0.52, fire: 0.64 },
  },
  {
    id: 'abyss-sleep',
    name: '深海零重力眠',
    badge: '2.5Hz δ波',
    pro: true,
    scene: 'abyss',
    brainwave: 'delta',
    customHz: 2.5,
    tracks: { ocean: 0.70, wind: 0.18 },
  },
  {
    id: 'aurora-meditation',
    name: '极光 θ 冥想',
    badge: '6Hz θ波',
    pro: true,
    scene: 'aurora-zen',
    brainwave: 'theta',
    customHz: 6,
    tracks: { lofi: 0.55, wind: 0.35, ocean: 0.25 },
  },
  {
    id: 'deep-library-pro',
    name: '雨落天文台',
    badge: '多轨精调',
    pro: true,
    scene: 'orbital',
    brainwave: 'gamma',
    customHz: 40,
    tracks: { rain: 0.45, lofi: 0.42, library: 0.35, wind: 0.20 },
  },
]);

export const PRESET_MAP = Object.freeze(
  Object.fromEntries(PRESETS.map((p) => [p.id, p]))
);

// 精选诗意配方名（替代自由文本输入，确保 100% 符合 B 站 Toy 非 UGC 规范）
export const RECIPE_NAME_TAGS = Object.freeze([
  '凌晨三点的雨',
  '静谧心流时刻',
  '深海零压舱',
  '雪夜暖炉旁',
  '星际漫游频道',
  '考研自习室',
  '代码编译之夜',
  '末班夜行列车',
  '极光下的呼吸',
  '周末午后小憩',
  '灵感捕获电台',
  '雨停前的寂静',
]);

export function createEmptyTracks() {
  const out = {};
  for (const t of TRACKS) out[t.id] = 0;
  return out;
}

export function normalizeMixState(raw) {
  const fallback = PRESET_MAP[PRESETS[0].id];
  const src = raw && typeof raw === 'object' ? raw : fallback;
  const scene = SCENE_MAP[src.scene] ? src.scene : fallback.scene;
  const brainwave = BRAINWAVE_MAP[src.brainwave] ? src.brainwave : 'off';

  let customHz = Number(src.customHz);
  if (!Number.isFinite(customHz) || customHz < 1 || customHz > 45) {
    customHz = BRAINWAVE_MAP[brainwave]?.hz || 10;
  }
  customHz = Math.round(customHz * 2) / 2;

  const tracks = createEmptyTracks();
  if (src.tracks && typeof src.tracks === 'object') {
    for (const t of TRACKS) {
      const v = Number(src.tracks[t.id]);
      if (Number.isFinite(v)) {
        tracks[t.id] = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
      }
    }
  }
  return {
    scene,
    brainwave,
    customHz,
    tracks,
  };
}

/**
 * 将混音配方编码为紧凑、确定性的 URL 安全串，用于二维码与分享链接复原配方。
 * 格式：v1.<sceneIdx>.<waveIdx>.<hzX10>.<8个2位十六进制音量>
 */
export function encodeMix(mix) {
  const norm = normalizeMixState(mix);
  const sceneIdx = Math.max(0, SCENES.findIndex((s) => s.id === norm.scene));
  const waveIdx = Math.max(0, BRAINWAVES.findIndex((b) => b.id === norm.brainwave));
  const hzX10 = Math.round(norm.customHz * 10);
  const vols = TRACKS.map((t) => {
    const pct = Math.round((norm.tracks[t.id] || 0) * 100);
    return pct.toString(16).padStart(2, '0');
  }).join('');
  return `v1.${sceneIdx}.${waveIdx}.${hzX10}.${vols}`;
}

export function decodeMix(code) {
  if (typeof code !== 'string' || !code.startsWith('v1.')) return null;
  const parts = code.trim().split('.');
  if (parts.length !== 5) return null;
  const sceneIdx = Number.parseInt(parts[1], 10);
  const waveIdx = Number.parseInt(parts[2], 10);
  const hzX10 = Number.parseInt(parts[3], 10);
  const hex = parts[4];

  if (
    !Number.isInteger(sceneIdx) ||
    sceneIdx < 0 ||
    sceneIdx >= SCENES.length ||
    !Number.isInteger(waveIdx) ||
    waveIdx < 0 ||
    waveIdx >= BRAINWAVES.length ||
    !Number.isInteger(hzX10) ||
    hzX10 < 0 ||
    hzX10 > 450 ||
    !/^[0-9a-fA-F]+$/.test(hex) ||
    hex.length !== TRACKS.length * 2
  ) {
    return null;
  }

  const tracks = createEmptyTracks();
  for (let i = 0; i < TRACKS.length; i++) {
    const pct = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
    tracks[TRACKS[i].id] = Math.round(pct) / 100;
  }

  const bw = BRAINWAVES[waveIdx];
  const customHz = hzX10 >= 10 && hzX10 <= 450 ? hzX10 / 10 : bw.hz || 10;

  return normalizeMixState({
    scene: SCENES[sceneIdx].id,
    brainwave: bw.id,
    customHz,
    tracks,
  });
}

export const BREATH_MODES = Object.freeze([
  {
    id: 'off',
    name: '关闭呼吸引导',
    short: '呼吸',
    phases: [],
  },
  {
    id: 'box',
    name: '4-4-4-4 盒式专注呼吸',
    short: '4·4·4·4',
    phases: [
      { key: 'inhale', label: '缓缓吸气', sec: 4 },
      { key: 'hold', label: '轻柔屏息', sec: 4 },
      { key: 'exhale', label: '缓慢吐气', sec: 4 },
      { key: 'hold', label: '静息停留', sec: 4 },
    ],
  },
  {
    id: '478',
    name: '4-7-8 舒缓助眠呼吸',
    short: '4·7·8',
    phases: [
      { key: 'inhale', label: '鼻腔深吸', sec: 4 },
      { key: 'hold', label: '蓄气屏息', sec: 7 },
      { key: 'exhale', label: '长舒缓呼', sec: 8 },
    ],
  },
]);

export const BREATH_MAP = Object.freeze(
  Object.fromEntries(BREATH_MODES.map((b) => [b.id, b]))
);

const HARMONIOUS_CLUSTERS = [
  {
    scenes: ['rainy-window', 'study'],
    waves: ['off', 'alpha'],
    core: ['rain'],
    extras: ['thunder', 'library', 'fire', 'lofi'],
  },
  {
    scenes: ['fireside', 'snowy-pines'],
    waves: ['off', 'theta'],
    core: ['fire'],
    extras: ['wind', 'rain', 'library', 'lofi'],
  },
  {
    scenes: ['orbital', 'aurora-zen'],
    waves: ['alpha', 'gamma', 'theta'],
    core: ['lofi'],
    extras: ['rain', 'wind', 'ocean', 'library'],
  },
  {
    scenes: ['night-train'],
    waves: ['off', 'alpha', 'theta'],
    core: ['train'],
    extras: ['rain', 'lofi', 'wind'],
  },
  {
    scenes: ['abyss', 'aurora-zen'],
    waves: ['theta', 'delta', 'off'],
    core: ['ocean'],
    extras: ['wind', 'lofi', 'rain'],
  },
];

/**
 * 从美学声景簇中随机生成一组和谐、不打架的 2-4 轨混音配方
 */
export function generateHarmoniousMix() {
  const cluster = HARMONIOUS_CLUSTERS[Math.floor(Math.random() * HARMONIOUS_CLUSTERS.length)];
  const scene = cluster.scenes[Math.floor(Math.random() * cluster.scenes.length)];
  const brainwave = cluster.waves[Math.floor(Math.random() * cluster.waves.length)];
  const bw = BRAINWAVE_MAP[brainwave] || BRAINWAVE_MAP.off;

  const tracks = createEmptyTracks();
  const coreId = cluster.core[0];
  tracks[coreId] = Math.round((0.48 + Math.random() * 0.3) * 100) / 100;

  const pool = [...cluster.extras].sort(() => Math.random() - 0.5);
  const extraCount = 1 + Math.floor(Math.random() * 3); // 1~3 个辅轨 -> 共 2~4 轨
  for (let i = 0; i < extraCount && i < pool.length; i++) {
    const id = pool[i];
    const base = TRACK_MAP[id]?.defaultVol || 0.38;
    const jitter = base * (0.65 + Math.random() * 0.55);
    tracks[id] = Math.max(0.15, Math.min(0.75, Math.round(jitter * 100) / 100));
  }

  return normalizeMixState({
    scene,
    brainwave,
    customHz: bw.hz || 10,
    tracks,
  });
}

export function mixUsesPro(mix) {
  const norm = normalizeMixState(mix);
  if (SCENE_MAP[norm.scene]?.pro) return true;
  if (BRAINWAVE_MAP[norm.brainwave]?.pro) return true;
  const bw = BRAINWAVE_MAP[norm.brainwave];
  if (norm.brainwave !== 'off' && bw && Math.abs(norm.customHz - bw.hz) > 0.01) {
    return true;
  }
  for (const t of TRACKS) {
    if (t.pro && (norm.tracks[t.id] || 0) > 0.01) return true;
  }
  return false;
}
