import { CONFIG } from './config.js';

const LOCAL_STORAGE_KEY = CONFIG.CLOUD_KEY;
const LOCAL_DEV_PRO_KEY = 'auraspace_dev_preview_pro';

function isBiliHost() {
  const host = (window.location && window.location.hostname) || '';
  return (
    /(^|\.)bilibili\.com$/i.test(host) ||
    /(^|\.)bilibilitoy\.com$/i.test(host) ||
    /(^|\.)bebox\.net$/i.test(host) ||
    Boolean(window.__TOY_META__)
  );
}

function readLocalState() {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeLocalState(state) {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
  } catch (_) {
    // 忽略隐私模式存储异常
  }
}

function isRateLimitError(err) {
  if (!err || typeof err !== 'object') return false;
  const codeStr = String(err.code ?? '');
  const msgStr = String(err.message ?? '');
  return (
    (err.type === 'http_error' && codeStr === '307044') ||
    codeStr === '307044' ||
    msgStr.includes('307044')
  );
}

export class ToyBridge {
  constructor({ onUnlockChange, onSafeAreaChange, onToast, checkCharge = true } = {}) {
    this.onUnlockChange = onUnlockChange;
    this.onSafeAreaChange = onSafeAreaChange;
    this.onToast = onToast;
    this.checkCharge = Boolean(checkCharge);

    this.inBiliHost = isBiliHost();
    this.inToyContainer = false;
    this.isPro = false;
    this.devPreviewPro = false;
    this._unlockUnsub = null;
    this._containerUnsub = null;
  }

  hasSdk() {
    return typeof window !== 'undefined' && Boolean(window.toy);
  }

  canShowDevToggle() {
    return !this.inBiliHost && !this.inToyContainer;
  }

  getEffectivePro() {
    return this.isPro || (this.canShowDevToggle() && this.devPreviewPro);
  }

  setDevPreviewPro(next) {
    if (!this.canShowDevToggle()) return;
    this.devPreviewPro = Boolean(next);
    try {
      window.localStorage.setItem(LOCAL_DEV_PRO_KEY, this.devPreviewPro ? '1' : '0');
    } catch (_) {
      // ignore
    }
    this.onUnlockChange?.(this.getEffectivePro());
  }

  async init() {
    if (this.canShowDevToggle()) {
      try {
        this.devPreviewPro = window.localStorage.getItem(LOCAL_DEV_PRO_KEY) === '1';
      } catch (_) {
        this.devPreviewPro = false;
      }
    }

    if (!this.hasSdk()) {
      return {
        isPro: this.getEffectivePro(),
        cloudState: readLocalState(),
      };
    }

    const toy = window.toy;

    // 1. 容器状态与安全区适配
    try {
      if (typeof toy.getContainerState === 'function') {
        const state = await toy.getContainerState();
        if (state && state.deviceType && state.deviceType !== 'unknown') {
          this.inToyContainer = true;
        }
        this._applyContainerState(state);
      }
      if (typeof toy.onContainerChange === 'function') {
        this._containerUnsub = toy.onContainerChange((st) => this._applyContainerState(st));
      }
    } catch (_) {
      // 非 B站容器环境忽略
    }

    // 2. 检测包月充电解锁状态（付费墙关闭时跳过）
    if (this.checkCharge) {
      await this.refreshChargeUnlock();
    }
    try {
      if (this.checkCharge && typeof toy.onChargeUnlockChange === 'function') {
        this._unlockUnsub = toy.onChargeUnlockChange((ev) => {
          const unlocked =
            ev === true ||
            ev?.unlocked === true ||
            ev?.data?.unlocked === true;
          if (unlocked) {
            this.isPro = true;
            this.onUnlockChange?.(this.getEffectivePro());
          } else {
            this.refreshChargeUnlock();
          }
        });
      }
    } catch (_) {
      // ignore
    }

    // 3. 启动时读取一次云存档，失败回落本地存储
    const cloudState = await this.loadState();
    return {
      isPro: this.getEffectivePro(),
      cloudState,
    };
  }

  _applyContainerState(state) {
    if (!state || typeof state !== 'object') return;
    const sa = state.safeArea || {};
    const top = Number(sa.top) || 0;
    const right = Number(sa.right) || 0;
    const bottom = Number(sa.bottom) || 0;
    const left = Number(sa.left) || 0;
    const root = document.documentElement.style;
    if (top > 0) root.setProperty('--safe-top', `${top}px`);
    if (right > 0) root.setProperty('--safe-right', `${right}px`);
    if (bottom > 0) root.setProperty('--safe-bottom', `${bottom}px`);
    if (left > 0) root.setProperty('--safe-left', `${left}px`);
    this.onSafeAreaChange?.(state);
  }

  async refreshChargeUnlock() {
    if (!this.hasSdk() || typeof window.toy.getChargeUnlock !== 'function') {
      return this.getEffectivePro();
    }
    try {
      const res = await window.toy.getChargeUnlock({
        minPrice: CONFIG.CHARGE_MIN_PRICE_FEN,
      });
      if (res && res.status && res.status !== 'unsupported') {
        this.inToyContainer = true;
      }
      if (res?.status === 'ok' && res?.data?.unlocked === true) {
        this.isPro = true;
      }
    } catch (_) {
      // 非站内环境保持默认
    }
    this.onUnlockChange?.(this.getEffectivePro());
    return this.getEffectivePro();
  }

  /**
   * 必须在点击事件同步栈内直接调用（SDK 校验 navigator.userActivation.isActive）
   */
  openChargePanelSync() {
    if (!this.hasSdk() || typeof window.toy.openChargePanel !== 'function') {
      this.onToast?.('请在 B站 App 或 B站网页版 Toy 内打开即可拉起充电面板');
      return Promise.resolve({ opened: false, reason: 'no_sdk' });
    }

    try {
      const p = window.toy.openChargePanel({
        minPrice: CONFIG.CHARGE_MIN_PRICE_FEN,
      });
      return Promise.resolve(p)
        .then(() => {
          window.setTimeout(() => this.refreshChargeUnlock(), 2500);
          return { opened: true };
        })
        .catch((err) => {
          const msg = String(err?.message || '');
          if (err?.type === 'not_logged_in') {
            this.onToast?.('请先登录 B站账号后再开启充电解锁');
          } else if (err?.type === 'unsupported' || msg.includes('unsupported')) {
            this.onToast?.('请在 B站 App 内打开此 Toy 以拉起包月充电面板');
          } else {
            this.onToast?.('暂未拉起充电面板，可前往 UP 主主页充电');
          }
          return { opened: false, error: err };
        });
    } catch (err) {
      this.onToast?.('请在 B站 App 内打开此 Toy 以支持包月充电');
      return Promise.resolve({ opened: false, error: err });
    }
  }

  async loadState() {
    const local = readLocalState();
    if (!this.hasSdk() || typeof window.toy.getCloudStorage !== 'function') {
      return local;
    }
    if (!this.inToyContainer && !this.inBiliHost) {
      return local;
    }
    try {
      const result = await window.toy.getCloudStorage([CONFIG.CLOUD_KEY]);
      const raw = result?.[CONFIG.CLOUD_KEY];
      if (typeof raw === 'string' && raw.length > 0) {
        const parsed = JSON.parse(raw);
        writeLocalState(parsed);
        return parsed;
      }
    } catch (err) {
      if (isRateLimitError(err)) {
        this.onToast?.('云存档读取较忙，已优先载入本地存档');
      }
    }
    return local;
  }

  /**
   * 仅在显式用户节点调用（保存/删除配方、完成专注时段）；
   * 使用递归退避重试避免触发循环静态检测，并显式处理 307044 限流。
   */
  saveState(state) {
    writeLocalState(state);
    if (!this.hasSdk() || typeof window.toy.setCloudStorage !== 'function') {
      return Promise.resolve(true);
    }
    if (!this.inToyContainer && !this.inBiliHost) {
      return Promise.resolve(true);
    }

    const payload = JSON.stringify(state);
    const attemptWrite = (attempt) => {
      return window.toy
        .setCloudStorage({ [CONFIG.CLOUD_KEY]: payload })
        .then(() => true)
        .catch((err) => {
          if (isRateLimitError(err) && attempt < 2) {
            const delayMs = attempt === 0 ? 1500 : 3500;
            return new Promise((resolve) => {
              window.setTimeout(() => resolve(attemptWrite(attempt + 1)), delayMs);
            });
          }
          if (isRateLimitError(err)) {
            this.onToast?.('云端保存人数较多，配方已先为你存至本地');
          }
          return false;
        });
    };

    return attemptWrite(0);
  }

  async getShareQr(mixCode) {
    if (!this.hasSdk() || typeof window.toy.getQrCode !== 'function') {
      return null;
    }
    if (!this.inToyContainer && !this.inBiliHost) {
      return null;
    }
    let timerId = null;
    try {
      const qrPromise = Promise.resolve(
        window.toy.getQrCode({
          path: `index.html#mix=${mixCode}`,
          size: 220,
        })
      );
      const timeoutPromise = new Promise((resolve) => {
        timerId = window.setTimeout(() => resolve(null), 1800);
      });
      const res = await Promise.race([qrPromise, timeoutPromise]);
      if (!res) return null;
      if (typeof res === 'string') return res;
      return res?.url || res?.base64Data || res?.qrCode || null;
    } catch (_) {
      return null;
    } finally {
      if (timerId) window.clearTimeout(timerId);
    }
  }

  async savePosterImage(dataUrl, filename = 'auraspace-recipe.png') {
    if (this.hasSdk() && typeof window.toy.saveImageToAlbum === 'function' && (this.inToyContainer || this.inBiliHost)) {
      try {
        await window.toy.saveImageToAlbum({ base64Data: dataUrl });
        this.onToast?.('配方海报已保存至手机相册');
        return true;
      } catch (_) {
        if (typeof window.toy.sharePicture === 'function') {
          try {
            await window.toy.sharePicture({ base64Data: dataUrl });
            return true;
          } catch (_) {
            // 继续降级为浏览器下载
          }
        }
      }
    }

    try {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      this.onToast?.('配方海报已导出下载');
      return true;
    } catch (_) {
      this.onToast?.('请长按上方预览图保存至相册');
      return false;
    }
  }

  async shareMix(mixCode) {
    if (this.hasSdk() && typeof window.toy.share === 'function' && (this.inToyContainer || this.inBiliHost)) {
      try {
        await window.toy.share({ path: `index.html#mix=${mixCode}` });
        return true;
      } catch (_) {
        // 降级复制链接
      }
    }

    const baseUrl = window.location.href.split('#')[0];
    const fullUrl = `${baseUrl}#mix=${mixCode}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullUrl);
        this.onToast?.('已复制带配方的分享链接');
        return true;
      }
    } catch (_) {
      // ignore
    }
    this.onToast?.('请点击「生成配方海报」分享给好友');
    return false;
  }

  destroy() {
    this._unlockUnsub?.();
    this._containerUnsub?.();
  }
}
