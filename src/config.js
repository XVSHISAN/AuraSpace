export const CONFIG = Object.freeze({
  APP_NAME: '静界 AuraSpace',
  APP_SUBTITLE: '空间白噪音 & 脑波混音工坊',
  TOY_SLUG: 'auraspace',

  // 付费墙总开关：false = 全部功能免费开放（隐藏 Pro 按钮/角标/试听/充电入口）
  // 以后要开启包月充电解锁，改成 true 并重新构建即可
  PAYWALL_ENABLED: false,

  // 无操作多少秒后自动进入沉浸模式（仅在播放中且没有打开面板时生效）
  AUTO_IMMERSIVE_SECONDS: 25,

  // 本地记忆上次使用状态的 key（只存 localStorage，不占云存档额度）
  SESSION_KEY: 'auraspace_session_v1',

  // B站包月充电最低档位（单位：分，必须为正整数。常见档位：600=￥6/月, 1800=￥18/月, 3000=￥30/月）
  CHARGE_MIN_PRICE_FEN: 600,
  CHARGE_PRICE_LABEL: '￥6/月',

  // 点击未解锁的 Pro 场景/音轨/脑波时，提供的实时声画试听时长（秒）
  PRO_PREVIEW_SECONDS: 15,

  // B站 Toy 云存档 key（与 localStorage 兜底共用）
  CLOUD_KEY: 'auraspace_state_v1',

  // 配方保存上限
  MAX_SAVED_MIXES_FREE: 2,
  MAX_SAVED_MIXES_PRO: 8,

  // 定时选项（分钟）
  MIN_TIMER_MINUTES: 1,
  MAX_TIMER_MINUTES: 180,
  FOCUS_MINUTES: Object.freeze([15, 25, 45, 60]),
  SLEEP_MINUTES: Object.freeze([15, 30, 45, 60, 90]),
  SLEEP_FADE_SECONDS: 60,

  // 默认混音配方
  DEFAULT_PRESET_ID: 'rainy-study',
});
