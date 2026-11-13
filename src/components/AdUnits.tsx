import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import {
  db,
  ref,
  onValue,
  get,
  set,
  update,
  NATIVE_BANNER_SCRIPT_SRC,
  NATIVE_BANNER_CONTAINER_ID,
  BANNER_320x50_KEY,
  BANNER_320x50_SCRIPT_SRC,
  SOCIAL_BAR_SCRIPT_SRC,
  POPUNDER_SCRIPT_SRC,
  SMARTLINK_URL,
  RedeemCodeItem,
} from '../firebase';

// ============================================================================
// UN-BYPASSABLE SERVER-TIME-SYNCED REDEEM CODE & AD-FREE VIP ENGINE
// ============================================================================
const REDEEM_STORAGE_KEY = 'xtube_active_redeem_code_v1';
const DEVICE_FP_STORAGE_KEY = 'xtube_device_fp_v1';
const VIP_STATE_CHANGE_EVENT = 'xtube_vip_state_changed';

let serverTimeOffsetMs = 0;
let serverOffsetInitialized = false;

interface VipRuntimeState {
  isAdFree: boolean;
  activeCode: string;
  expiresAt: number;
  durationLabel: string;
  dailyVideoLimit: number;
}

let currentVipState: VipRuntimeState = {
  isAdFree: false,
  activeCode: '',
  expiresAt: 0,
  durationLabel: '',
  dailyVideoLimit: 0,
};

let codeSnapshotState: {
  valid: boolean;
  active: boolean;
  code: string;
  expiresAt: number;
  durationLabel: string;
  dailyVideoLimit: number;
} = {
  valid: false,
  active: false,
  code: '',
  expiresAt: 0,
  durationLabel: '',
  dailyVideoLimit: 0,
};

let userControlSnapshotState: {
  exists: boolean;
  vipActive?: boolean;
  expiresAt?: number;
  dailyVideoLimit?: number;
  activeCode?: string;
  durationLabel?: string;
} = {
  exists: false,
};

let activeFirebaseUnsub: (() => void) | null = null;
let activeUserControlUnsub: (() => void) | null = null;
let boundCrmUserKey = '';
let expiryTickerId: number | null = null;

function broadcastVipStateChange() {
  try {
    window.dispatchEvent(new CustomEvent(VIP_STATE_CHANGE_EVENT, { detail: currentVipState }));
  } catch {}
}

/**
 * Returns a persistent, unique device fingerprint ID for this browser so a single-device
 * redeem code cannot be shared infinitely across different browsers/devices.
 */
export function getOrCreateBrowserDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    let existing = localStorage.getItem(DEVICE_FP_STORAGE_KEY) || '';
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) {
      return existing;
    }
    const nav = window.navigator;
    const rawTraits = [
      nav.userAgent || '',
      nav.language || '',
      screen?.width || 0,
      screen?.height || 0,
      screen?.colorDepth || 0,
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    ].join('|');
    let hash = 0;
    for (let i = 0; i < rawTraits.length; i++) {
      hash = (hash << 5) - hash + rawTraits.charCodeAt(i);
      hash |= 0;
    }
    const rand = Math.random().toString(36).slice(2, 10);
    existing = `dev_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}_${rand}`;
    localStorage.setItem(DEVICE_FP_STORAGE_KEY, existing);
    return existing;
  } catch {
    return `dev_fallback_${Date.now().toString(36)}`;
  }
}

/**
 * Returns authoritative UTC timestamp in milliseconds using Firebase serverTimeOffset + HTTP Date header
 * so changing the phone/PC clock backwards CANNOT extend or bypass redeem code expiration.
 */
export function getAuthoritativeNow(): number {
  return Date.now() + serverTimeOffsetMs;
}

function initServerTimeSync() {
  if (serverOffsetInitialized || typeof window === 'undefined') return;
  serverOffsetInitialized = true;

  // 1. Live Firebase Realtime Database `.info/serverTimeOffset`
  try {
    const offsetRef = ref(db, '.info/serverTimeOffset');
    onValue(offsetRef, (snap) => {
      const val = Number(snap.val());
      if (!isNaN(val) && isFinite(val)) {
        serverTimeOffsetMs = val;
      }
    });
  } catch {}

  // 2. HTTP Server Date / visitor-ping fallback
  fetch('/api/visitor-ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeSyncOnly: true }),
  })
    .then(async (res) => {
      const dateHeader = res.headers.get('Date');
      if (dateHeader) {
        const parsed = Date.parse(dateHeader);
        if (!isNaN(parsed)) {
          serverTimeOffsetMs = parsed - Date.now();
        }
      }
      const data = await res.json().catch(() => null);
      if (data && typeof data.serverTime === 'number') {
        serverTimeOffsetMs = data.serverTime - Date.now();
      }
    })
    .catch(() => {});
}

function cleanupInjectedAdDomElements() {
  if (typeof document === 'undefined') return;
  try {
    const socialScript = document.getElementById('social-bar-ad-script');
    if (socialScript) socialScript.remove();
    const popScript = document.getElementById('dynamic-popunder-script');
    if (popScript) popScript.remove();
  } catch {}
}

function recomputeEffectiveVipState() {
  const now = getAuthoritativeNow();
  const uc = userControlSnapshotState;
  const cs = codeSnapshotState;

  // Determine dailyVideoLimit: Admin user control takes priority if set (>= 0), else redeem code limit
  let effectiveDailyLimit = 0;
  if (uc.exists && typeof uc.dailyVideoLimit === 'number' && uc.dailyVideoLimit >= 0) {
    effectiveDailyLimit = Math.floor(uc.dailyVideoLimit);
  } else if (cs.valid && cs.dailyVideoLimit > 0) {
    effectiveDailyLimit = Math.floor(cs.dailyVideoLimit);
  }

  // Determine if Admin explicitly turned VIP OFF or ON for this user in vipUsersControl
  let isAdFree = false;
  let activeCode = '';
  let expiresAt = 0;
  let durationLabel = '';

  if (uc.exists && uc.vipActive === false) {
    // Admin explicitly forced VIP OFF for this user
    isAdFree = false;
    activeCode = '';
    expiresAt = 0;
    durationLabel = '';
  } else if (uc.exists && uc.vipActive === true && Number(uc.expiresAt) > now) {
    // Admin explicitly enabled/adjusted VIP for this user
    isAdFree = true;
    expiresAt = Number(uc.expiresAt);
    activeCode = uc.activeCode || cs.code || 'ADMIN-VIP';
    durationLabel = uc.durationLabel || cs.durationLabel || 'VIP Ad-Free';
  } else if (cs.valid && cs.active && cs.expiresAt > now) {
    isAdFree = true;
    expiresAt = cs.expiresAt;
    activeCode = cs.code;
    durationLabel = cs.durationLabel || 'VIP Ad-Free';
  }

  const wasAdFree = currentVipState.isAdFree;
  currentVipState = {
    isAdFree,
    activeCode,
    expiresAt,
    durationLabel,
    dailyVideoLimit: effectiveDailyLimit,
  };

  if (isAdFree && !wasAdFree) {
    cleanupInjectedAdDomElements();
  }

  ensureExpiryTicker();
  broadcastVipStateChange();
}

function ensureExpiryTicker() {
  if (typeof window === 'undefined') return;
  if (currentVipState.isAdFree && expiryTickerId === null) {
    expiryTickerId = window.setInterval(() => {
      if (!currentVipState.isAdFree) return;
      if (getAuthoritativeNow() >= currentVipState.expiresAt) {
        recomputeEffectiveVipState();
      } else {
        broadcastVipStateChange();
      }
    }, 1000);
  } else if (!currentVipState.isAdFree && expiryTickerId !== null) {
    window.clearInterval(expiryTickerId);
    expiryTickerId = null;
  }
}

export function bindVipUserCrmKey(crmKey: string) {
  const cleanKey = String(crmKey || '').trim().replace(/[.#$[\]/]/g, '_');
  if (!cleanKey || cleanKey === boundCrmUserKey) return;
  boundCrmUserKey = cleanKey;
  initServerTimeSync();

  if (activeUserControlUnsub) {
    try {
      activeUserControlUnsub();
    } catch {}
    activeUserControlUnsub = null;
  }

  const ucRef = ref(db, `vipUsersControl/${cleanKey}`);
  activeUserControlUnsub = onValue(
    ucRef,
    (snap) => {
      if (snap.exists() && snap.val() && typeof snap.val() === 'object') {
        const val = snap.val();
        userControlSnapshotState = {
          exists: true,
          vipActive: typeof val.vipActive === 'boolean' ? val.vipActive : undefined,
          expiresAt: typeof val.expiresAt === 'number' ? val.expiresAt : Number(val.expiresAt) || 0,
          dailyVideoLimit:
            typeof val.dailyVideoLimit === 'number'
              ? val.dailyVideoLimit
              : val.dailyVideoLimit !== undefined
              ? Number(val.dailyVideoLimit) || 0
              : undefined,
          activeCode: val.activeCode || '',
          durationLabel: val.durationLabel || '',
        };
        // If Admin assigned a specific redeem code to this user and browser has none or different, watch it too
        if (val.activeCode && val.activeCode !== 'ADMIN-VIP' && val.vipActive !== false) {
          const cleanAssigned = String(val.activeCode)
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9_-]/g, '');
          if (cleanAssigned && cleanAssigned !== codeSnapshotState.code) {
            try {
              localStorage.setItem(REDEEM_STORAGE_KEY, cleanAssigned);
            } catch {}
            startLiveFirebaseCodeWatch(cleanAssigned);
          }
        }
      } else {
        userControlSnapshotState = { exists: false };
      }
      recomputeEffectiveVipState();
    },
    () => {
      userControlSnapshotState = { exists: false };
      recomputeEffectiveVipState();
    }
  );
}

function stopActiveCodeMonitoring(clearStorage = false) {
  if (activeFirebaseUnsub) {
    try {
      activeFirebaseUnsub();
    } catch {}
    activeFirebaseUnsub = null;
  }
  if (clearStorage) {
    try {
      localStorage.removeItem(REDEEM_STORAGE_KEY);
    } catch {}
  }
  codeSnapshotState = {
    valid: false,
    active: false,
    code: '',
    expiresAt: 0,
    durationLabel: '',
    dailyVideoLimit: 0,
  };
  recomputeEffectiveVipState();
}

function startLiveFirebaseCodeWatch(cleanCode: string) {
  initServerTimeSync();
  const deviceId = getOrCreateBrowserDeviceId();

  if (activeFirebaseUnsub) {
    try {
      activeFirebaseUnsub();
    } catch {}
    activeFirebaseUnsub = null;
  }

  const codeRef = ref(db, `redeemCodes/${cleanCode}`);
  const fallbackCodeRef = ref(db, `telegramBotSessions/_codes/${cleanCode}`);

  const evaluateCodeSnapshot = (val: RedeemCodeItem | null, usedFallback = false) => {
    if (!val || typeof val !== 'object') {
      stopActiveCodeMonitoring(true);
      return;
    }

    const expiresAt = Number(val.expiresAt) || 0;
    const isActiveFlag = val.active !== false;
    const now = getAuthoritativeNow();
    const maxDevices = Number(val.maxDevices) || 1;
    const dailyVideoLimit = Math.max(0, Number(val.dailyVideoLimit) || 0);

    // Check single-browser lock (unless Admin explicitly set maxDevices > 1)
    if (maxDevices <= 1 && val.boundDeviceId && val.boundDeviceId !== deviceId) {
      stopActiveCodeMonitoring(true);
      return;
    }

    // Check if expired or turned OFF by Admin
    if (!isActiveFlag || expiresAt <= now) {
      codeSnapshotState = {
        valid: true,
        active: false,
        code: cleanCode,
        expiresAt,
        durationLabel: val.durationLabel || (val as any).packageName || 'VIP Ad-Free',
        dailyVideoLimit,
      };
      recomputeEffectiveVipState();
      return;
    }

    // If not yet bound to a device, bind it to this browser
    if (!val.boundDeviceId) {
      update(usedFallback ? fallbackCodeRef : codeRef, {
        boundDeviceId: deviceId,
        activatedAt: now,
        botAuthToken: 'xtube_tg_bot_2026',
      }).catch(() => {});
      if (!usedFallback) {
        update(fallbackCodeRef, {
          boundDeviceId: deviceId,
          activatedAt: now,
          botAuthToken: 'xtube_tg_bot_2026',
        }).catch(() => {});
      }
    }

    codeSnapshotState = {
      valid: true,
      active: true,
      code: cleanCode,
      expiresAt,
      durationLabel: val.durationLabel || (val as any).packageName || 'VIP Ad-Free',
      dailyVideoLimit,
    };
    recomputeEffectiveVipState();
  };

  activeFirebaseUnsub = onValue(
    codeRef,
    (snapshot) => {
      if (snapshot.exists()) {
        evaluateCodeSnapshot(snapshot.val(), false);
      } else {
        get(fallbackCodeRef)
          .then((fbSnap) => {
            evaluateCodeSnapshot(fbSnap.exists() ? fbSnap.val() : null, true);
          })
          .catch(() => evaluateCodeSnapshot(null, true));
      }
    },
    () => {
      // Fallback check via telegramBotSessions/_codes if redeemCodes rule isn't published yet
      onValue(
        fallbackCodeRef,
        (fbSnap) => {
          evaluateCodeSnapshot(fbSnap.exists() ? fbSnap.val() : null, true);
        },
        () => {}
      );
    }
  );
}

// Automatically resume & verify saved Redeem Code on browser boot
if (typeof window !== 'undefined') {
  initServerTimeSync();
  try {
    const savedCode = (localStorage.getItem(REDEEM_STORAGE_KEY) || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '');
    if (savedCode) {
      startLiveFirebaseCodeWatch(savedCode);
    }
  } catch {}
}

export function isAdFreeVipActive(): boolean {
  if (!currentVipState.isAdFree) return false;
  if (getAuthoritativeNow() >= currentVipState.expiresAt) {
    stopActiveCodeMonitoring(true);
    return false;
  }
  return true;
}

export async function activateRedeemCodeOnBrowser(
  rawCodeInput: string
): Promise<{ ok: boolean; message: string; expiresAt?: number }> {
  initServerTimeSync();
  const cleanCode = String(rawCodeInput || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');

  if (!cleanCode || cleanCode.length < 4) {
    return {
      ok: false,
      message: '❌ অনুগ্রহ করে একটি সঠিক Redeem Code লিখুন!',
    };
  }

  try {
    let data: RedeemCodeItem | null = null;
    try {
      const snap = await get(ref(db, `redeemCodes/${cleanCode}`));
      if (snap.exists()) {
        data = snap.val();
      }
    } catch {}

    if (!data) {
      try {
        const fbSnap = await get(ref(db, `telegramBotSessions/_codes/${cleanCode}`));
        if (fbSnap.exists()) {
          data = fbSnap.val();
        }
      } catch {}
    }

    if (!data) {
      const [r1, r2] = await Promise.all([
        fetch(
          `https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/redeemCodes/${encodeURIComponent(
            cleanCode
          )}.json`,
          { cache: 'no-store' }
        ).catch(() => null),
        fetch(
          `https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/telegramBotSessions/_codes/${encodeURIComponent(
            cleanCode
          )}.json`,
          { cache: 'no-store' }
        ).catch(() => null),
      ]);
      if (r1 && r1.ok) data = await r1.json().catch(() => null);
      if (!data && r2 && r2.ok) data = await r2.json().catch(() => null);
    }

    if (!data || typeof data !== 'object' || !data.expiresAt) {
      return {
        ok: false,
        message: '❌ এই Redeem Code-টি সঠিক নয় অথবা ডিলিট করা হয়েছে!',
      };
    }

    const now = getAuthoritativeNow();
    const expiresAt = Number(data.expiresAt) || 0;

    if (data.active === false || expiresAt <= now) {
      return {
        ok: false,
        message: '⏰ এই Redeem Code-টির মেয়াদ শেষ হয়ে গেছে (Expired)! নতুন কোড নিন।',
      };
    }

    const deviceId = getOrCreateBrowserDeviceId();
    const maxDevices = Number(data.maxDevices) || 1;

    if (maxDevices <= 1 && data.boundDeviceId && data.boundDeviceId !== deviceId) {
      return {
        ok: false,
        message:
          '🔒 এই Redeem Code-টি ইতিমধ্যে অন্য একটি ব্রাউজার বা ফোনে ব্যবহার করা হয়েছে! (১টি কোড ১টি ব্রাউজারেই কার্যকর)',
      };
    }

    if (!data.boundDeviceId) {
      const bindPayload = {
        ...data,
        boundDeviceId: deviceId,
        activatedAt: now,
        botAuthToken: 'xtube_tg_bot_2026',
      };
      await Promise.all([
        update(ref(db, `redeemCodes/${cleanCode}`), {
          boundDeviceId: deviceId,
          activatedAt: now,
        }).catch(() => {}),
        set(ref(db, `telegramBotSessions/_codes/${cleanCode}`), bindPayload).catch(() => {}),
      ]);
    }

    try {
      localStorage.setItem(REDEEM_STORAGE_KEY, cleanCode);
    } catch {}

    startLiveFirebaseCodeWatch(cleanCode);

    return {
      ok: true,
      expiresAt,
      message: '🎉 অভিনন্দন! আপনার ব্রাউজারে VIP Ad-Free মোড সফলভাবে চালু হয়েছে! এখন কোনো Ads আসবে না।',
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `❌ যাচাই করা যায়নি: ${err?.message || 'Network error'}`,
    };
  }
}

export function deactivateRedeemCodeOnBrowser() {
  stopActiveCodeMonitoring(true);
}

export function formatVipCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return 'Expired';
  const totalSec = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');

  if (days > 0) {
    return `${days}d ${hh}h ${mm}m ${ss}s`;
  }
  return `${hh}:${mm}:${ss}`;
}

export function useAdFreeVip() {
  const [vipState, setVipState] = useState<VipRuntimeState>(() => ({ ...currentVipState }));
  const [remainingMs, setRemainingMs] = useState<number>(() =>
    currentVipState.isAdFree ? Math.max(0, currentVipState.expiresAt - getAuthoritativeNow()) : 0
  );

  useEffect(() => {
    const handleUpdate = () => {
      setVipState({ ...currentVipState });
      setRemainingMs(
        currentVipState.isAdFree
          ? Math.max(0, currentVipState.expiresAt - getAuthoritativeNow())
          : 0
      );
    };
    window.addEventListener(VIP_STATE_CHANGE_EVENT, handleUpdate);
    handleUpdate();
    return () => window.removeEventListener(VIP_STATE_CHANGE_EVENT, handleUpdate);
  }, []);

  return {
    isAdFree: vipState.isAdFree && remainingMs > 0,
    activeCode: vipState.activeCode,
    expiresAt: vipState.expiresAt,
    durationLabel: vipState.durationLabel,
    dailyVideoLimit: vipState.dailyVideoLimit,
    remainingMs,
    activateCode: activateRedeemCodeOnBrowser,
    clearCode: deactivateRedeemCodeOnBrowser,
  };
}

// Global event bus so any blocked ad script immediately triggers the Anti-AdBlock lock screen
const AD_BLOCK_EVENT = 'bd_collection_adblock_detected';

export function notifyAdBlocked() {
  if (isAdFreeVipActive()) return;
  try {
    window.dispatchEvent(new CustomEvent(AD_BLOCK_EVENT));
  } catch {}
}

/**
 * Checks if visitor is a search engine crawler (Googlebot, Googlebot-Video, Bingbot, etc.)
 * so SEO & Google Video Indexing are never blocked.
 */
function isSearchEngineBot(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator.userAgent || '').toLowerCase();
  return /googlebot|google-inspectiontool|adsbot-google|mediapartners-google|bingbot|slurp|duckduckbot|baiduspider|yandexbot|facebookexternalhit|twitterbot/i.test(
    ua
  );
}

/**
 * Runs multi-layer AdBlocker + AdGuard DNS / Private DNS / Pi-hole detection
 */
export async function detectAdBlockerOrDns(): Promise<boolean> {
  if (typeof window === 'undefined' || isSearchEngineBot() || isAdFreeVipActive()) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

  // Layer 1: DOM Cosmetic Filter Bait Check
  const domBlocked = await new Promise<boolean>((resolve) => {
    try {
      const bait = document.createElement('div');
      bait.className =
        'pub_300x250 pub_300x250m pub_728x90 text-ad textAd text_ad text_ads text-ads text-ad-links ad-banner adsbox ad-placement doubleclick ad-placeholder';
      bait.setAttribute('aria-hidden', 'true');
      bait.style.position = 'absolute';
      bait.style.top = '-9999px';
      bait.style.left = '-9999px';
      bait.style.width = '300px';
      bait.style.height = '250px';
      bait.style.pointerEvents = 'none';
      document.body.appendChild(bait);

      window.setTimeout(() => {
        let isHidden = false;
        try {
          const style = window.getComputedStyle(bait);
          if (
            !bait.offsetParent ||
            bait.offsetHeight === 0 ||
            bait.offsetWidth === 0 ||
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0'
          ) {
            isHidden = true;
          }
        } catch {}
        try {
          bait.remove();
        } catch {}
        resolve(isHidden);
      }, 180);
    } catch {
      resolve(false);
    }
  });

  if (domBlocked) return true;

  // Layer 2: AdGuard DNS / Private DNS / Network Filter Probe
  const probeUrl = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?_cb=${Date.now()}`;
  const dnsOrNetBlocked = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (blocked: boolean) => {
      if (!settled) {
        settled = true;
        resolve(blocked);
      }
    };

    const timer = window.setTimeout(() => finish(false), 3500);

    fetch(probeUrl, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
    })
      .then(() => {
        window.clearTimeout(timer);
        finish(false);
      })
      .catch(() => {
        window.clearTimeout(timer);
        finish(true);
      });
  });

  if (dnsOrNetBlocked) return true;

  // Layer 3: Script tag load test for AdGuard DNS / Brave Shields
  const scriptBlocked = await new Promise<boolean>((resolve) => {
    try {
      const s = document.createElement('script');
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?check=${Date.now()}`;
      s.async = true;
      const cleanup = () => {
        try {
          s.remove();
        } catch {}
      };
      const t = window.setTimeout(() => {
        cleanup();
        resolve(false);
      }, 3000);
      s.onload = () => {
        window.clearTimeout(t);
        cleanup();
        resolve(false);
      };
      s.onerror = () => {
        window.clearTimeout(t);
        cleanup();
        resolve(true);
      };
      document.head.appendChild(s);
    } catch {
      resolve(false);
    }
  });

  return scriptBlocked;
}

/**
 * Full-Screen Un-bypassable Anti-AdBlock & Anti-AdGuard DNS Wall
 * Automatically bypassed when a valid Redeem Code is active!
 */
export const AntiAdBlockGuard: React.FC<{
  onBlockStateChange?: (blocked: boolean) => void;
}> = ({ onBlockStateChange }) => {
  const { isAdFree } = useAdFreeVip();
  const [isBlocked, setIsBlocked] = useState<boolean>(false);
  const [isRechecking, setIsRechecking] = useState<boolean>(false);

  const runCheck = useCallback(async () => {
    if (isAdFreeVipActive()) {
      setIsBlocked(false);
      if (onBlockStateChange) onBlockStateChange(false);
      return;
    }
    const detected = await detectAdBlockerOrDns();
    setIsBlocked((prev) => {
      const next = prev || detected;
      if (onBlockStateChange) onBlockStateChange(next);
      return next;
    });
    if (detected) {
      try {
        document.querySelectorAll('video').forEach((v) => {
          v.pause();
        });
      } catch {}
    }
  }, [onBlockStateChange]);

  useEffect(() => {
    if (isAdFree) {
      setIsBlocked(false);
      if (onBlockStateChange) onBlockStateChange(false);
      return;
    }

    runCheck();

    const handleAdBlockEvent = () => {
      if (isSearchEngineBot() || isAdFreeVipActive()) return;
      setIsBlocked(true);
      if (onBlockStateChange) onBlockStateChange(true);
      try {
        document.querySelectorAll('video').forEach((v) => v.pause());
      } catch {}
    };

    window.addEventListener(AD_BLOCK_EVENT, handleAdBlockEvent);
    const interval = window.setInterval(runCheck, 7000);

    return () => {
      window.removeEventListener(AD_BLOCK_EVENT, handleAdBlockEvent);
      window.clearInterval(interval);
    };
  }, [runCheck, onBlockStateChange, isAdFree]);

  const handleRefreshClick = () => {
    setIsRechecking(true);
    window.location.reload();
  };

  if (isAdFree || !isBlocked) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="w-full max-w-md rounded-2xl border border-red-900/70 bg-zinc-950 p-6 sm:p-8 shadow-2xl text-center space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-red-600/15 border border-red-500/30 text-red-500 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-9 h-9" />
        </div>

        <div className="space-y-2">
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Ad Blocker / AdGuard DNS Detected!
          </h2>
          <p className="text-sm text-zinc-300 leading-relaxed">
            আপনি <strong>Ad Blocker</strong> অথবা <strong>AdGuard DNS (Private DNS)</strong> ব্যবহার করছেন। আমাদের ওয়েবসাইটটি ব্যবহার করতে এবং ভিডিও প্লে করতে অনুগ্রহ করে Ad Blocker / AdGuard DNS বন্ধ করে নিচের <strong>Refresh</strong> বাটনে ক্লিক করুন।
          </p>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 text-left space-y-2 text-xs text-zinc-300 leading-relaxed">
          <p className="font-semibold text-zinc-100">কীভাবে বন্ধ করবেন (How to disable):</p>
          <p>
            ১. <strong>Browser Ad Blocker:</strong> আপনার ব্রাউজারের AdBlock / uBlock / Brave Shields এই সাইটের জন্য <strong>Off / Pause</strong> করুন।
          </p>
          <p>
            ২. <strong>AdGuard / Private DNS (Mobile):</strong> ফোনের <strong>Settings → Connection &amp; Sharing → Private DNS</strong> অপশনে গিয়ে <strong>Off</strong> অথবা <strong>Automatic</strong> করে দিন।
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefreshClick}
          disabled={isRechecking}
          className="w-full py-3 px-5 rounded-xl bg-red-600 hover:bg-red-500 active:scale-[0.99] text-white text-sm font-semibold flex items-center justify-center gap-2.5 shadow-lg transition-all cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${isRechecking ? 'animate-spin' : ''}`} />
          <span>{isRechecking ? 'Reloading Website...' : 'Refresh Website (রিলোড করুন)'}</span>
        </button>
      </div>
    </div>
  );
};

/**
 * Native Banner Ad (Hidden when Redeem Code VIP is active)
 */
export const NativeBannerAd: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { isAdFree } = useAdFreeVip();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAdFree) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const containerEl = wrapper.querySelector(`#${NATIVE_BANNER_CONTAINER_ID}`);
    const existingScript = document.querySelector(`script[src="${NATIVE_BANNER_SCRIPT_SRC}"]`);
    if (existingScript && containerEl && containerEl.children.length === 0) {
      try {
        existingScript.remove();
      } catch {}
    }

    if (!document.querySelector(`script[src="${NATIVE_BANNER_SCRIPT_SRC}"]`)) {
      const script = document.createElement('script');
      script.async = true;
      script.setAttribute('async', 'async');
      script.setAttribute('data-cfasync', 'false');
      script.src = NATIVE_BANNER_SCRIPT_SRC;
      script.onerror = () => {
        if (navigator.onLine !== false) notifyAdBlocked();
      };
      wrapper.appendChild(script);
    }
  }, [isAdFree]);

  if (isAdFree) return null;

  return (
    <div
      ref={wrapperRef}
      className={`ad-safe-container w-full max-w-full overflow-hidden my-3 px-0 ${className}`}
    >
      <div
        id={NATIVE_BANNER_CONTAINER_ID}
        className="w-full max-w-full overflow-hidden flex items-center justify-center"
      />
    </div>
  );
};

/**
 * 320x50 Iframe Banner Ad (Hidden when Redeem Code VIP is active)
 */
export const Banner320x50Ad: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { isAdFree } = useAdFreeVip();

  if (isAdFree) return null;

  const srcDocContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
        <style>
          html, body { margin: 0; padding: 0; width: 100%; max-width: 100%; background: transparent; display: flex; align-items: center; justify-content: center; overflow: hidden; touch-action: pan-y; }
          iframe, img, div { max-width: 100% !important; }
        </style>
      </head>
      <body>
        <script>
          (function() {
            var startY = null;
            var startX = null;
            window.addEventListener('touchstart', function(e) {
              if (e.touches && e.touches.length === 1) {
                startY = e.touches[0].clientY;
                startX = e.touches[0].clientX;
              }
            }, { passive: true });
            window.addEventListener('touchend', function(e) {
              if (startY === null || !e.changedTouches || !e.changedTouches.length) return;
              var dy = startY - e.changedTouches[0].clientY;
              var dx = startX - e.changedTouches[0].clientX;
              startY = null;
              startX = null;
              if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) {
                try {
                  window.parent.postMessage({ type: 'XTUBE_SHORT_SWIPE', dir: dy > 0 ? 1 : -1 }, '*');
                } catch (err) {}
              }
            }, { passive: true });
          })();
          atOptions = {
            'key' : '${BANNER_320x50_KEY}',
            'format' : 'iframe',
            'height' : 50,
            'width' : 320,
            'params' : {}
          };
        </script>
        <script src="${BANNER_320x50_SCRIPT_SRC}"></script>
      </body>
    </html>
  `;

  return (
    <div className={`ad-safe-container w-full max-w-full overflow-hidden flex items-center justify-center my-2 ${className}`}>
      <div className="w-full max-w-[320px] h-[50px] overflow-hidden flex items-center justify-center mx-auto">
        <iframe
          title="Ad Banner"
          width={320}
          height={50}
          scrolling="no"
          frameBorder={0}
          srcDoc={srcDocContent}
          className="w-full max-w-[320px] h-[50px] border-0 overflow-hidden"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        />
      </div>
    </div>
  );
};

/**
 * Social Bar Ad Loader (Disabled when Redeem Code VIP is active)
 */
export const SocialBarLoader: React.FC<{ active: boolean }> = ({ active }) => {
  const { isAdFree } = useAdFreeVip();

  useEffect(() => {
    const id = 'social-bar-ad-script';
    if (isAdFree || !active) {
      const existing = document.getElementById(id);
      if (existing) {
        try {
          existing.remove();
        } catch {}
      }
      return;
    }
    if (!document.getElementById(id)) {
      const script = document.createElement('script');
      script.id = id;
      script.setAttribute('data-cfasync', 'false');
      script.src = SOCIAL_BAR_SCRIPT_SRC;
      script.async = true;
      script.onerror = () => {
        if (navigator.onLine !== false) notifyAdBlocked();
      };
      document.body.appendChild(script);
    }
  }, [active, isAdFree]);

  return null;
};

/**
 * Triggers the Popunder script dynamically on Play button click (No-op when Redeem Code VIP is active)
 */
export function triggerPopunderAd() {
  if (isAdFreeVipActive()) return;
  try {
    const existing = document.getElementById('dynamic-popunder-script');
    if (existing) {
      existing.remove();
    }
    const script = document.createElement('script');
    script.id = 'dynamic-popunder-script';
    script.setAttribute('data-cfasync', 'false');
    script.src = POPUNDER_SCRIPT_SRC;
    script.async = true;
    script.onerror = () => {
      if (navigator.onLine !== false) notifyAdBlocked();
    };
    document.body.appendChild(script);
  } catch (e) {
    console.error(e);
  }
}

/**
 * Opens the Smartlink URL (No-op when Redeem Code VIP is active)
 */
export function triggerSmartlinkAd(customUrl?: string) {
  if (isAdFreeVipActive()) return;
  const targetUrl = customUrl || SMARTLINK_URL;
  try {
    const tgWebApp = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : undefined;
    if (tgWebApp && tgWebApp.initData && typeof tgWebApp.openLink === 'function') {
      try {
        tgWebApp.openLink(targetUrl, { try_instant_view: false });
        return;
      } catch {}
    }

    const link = document.createElement('a');
    link.href = targetUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    console.error(e);
  }
}

/**
 * Triggers Popunder 1 time + opens the current Step Smartlink offer so every step transition generates high-converting ad clicks & popunder revenue.
 */
export function openStepSmartlinkWithPopunder(stepSmartlinkUrl?: string) {
  if (isAdFreeVipActive()) return;
  triggerPopunderAd();
  triggerSmartlinkAd(stepSmartlinkUrl || SMARTLINK_URL);
}

