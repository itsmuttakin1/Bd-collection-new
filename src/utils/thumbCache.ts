// High-Speed Video Frame Cache (In-Memory + IndexedDB + Synchronous 0ms Micro-LQIP) & Viewport Priority Queue
// Provides Blur-Up LQIP (Low-Quality Image Placeholder) + instant cached HD frames across the entire website.

const DB_NAME = 'xtube_fast_thumb_cache_v1';
const STORE_NAME = 'frames';
const LQIP_STORAGE_PREFIX = 'xtube_lqip_v1_';
const memoryCache = new Map<string, string>();
const lqipMemoryCache = new Map<string, string>();

const LQIP_PALETTES: Array<[string, string, string]> = [
  ['#450a0a', '#991b1b', '#18181b'],
  ['#3b0764', '#be185d', '#09090b'],
  ['#431407', '#b45309', '#18181b'],
  ['#0f172a', '#1d4ed8', '#09090b'],
  ['#064e3b', '#047857', '#18181b'],
  ['#4c0519', '#e11d48', '#09090b'],
  ['#1e1b4b', '#6d28d9', '#18181b'],
  ['#27272a', '#dc2626', '#09090b'],
];

/**
 * Generates an instant 0ms deterministic Blur-Up LQIP SVG DataURL
 * so every image/video card has a rich blurred color-mesh LQIP before network bytes arrive.
 */
export const generateBlurUpLqipSvg = (seed: string): string => {
  const cleanSeed = seed || 'xtube';
  const existing = lqipMemoryCache.get(`svg_${cleanSeed}`);
  if (existing) return existing;

  let hash = 0;
  for (let i = 0; i < cleanSeed.length; i++) {
    hash = (hash * 31 + cleanSeed.charCodeAt(i)) >>> 0;
  }
  const [c1, c2, c3] = LQIP_PALETTES[hash % LQIP_PALETTES.length];
  const cx = 25 + (hash % 50);
  const cy = 25 + ((hash >> 4) % 50);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 18" preserveAspectRatio="none"><defs><radialGradient id="g" cx="${cx}%" cy="${cy}%" r="75%"><stop offset="0%" stop-color="${c2}" stop-opacity="0.85"/><stop offset="55%" stop-color="${c1}" stop-opacity="0.9"/><stop offset="100%" stop-color="${c3}"/></radialGradient></defs><rect width="32" height="18" fill="${c3}"/><rect width="32" height="18" fill="url(#g)"/></svg>`;
  const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  lqipMemoryCache.set(`svg_${cleanSeed}`, dataUrl);
  return dataUrl;
};

/**
 * Synchronously returns a micro-LQIP (20x12 JPEG from localStorage/memory) or deterministic SVG LQIP.
 */
export const getBlurUpLqipSync = (cacheKey: string, fallbackSeed = ''): string => {
  if (cacheKey) {
    const mem = lqipMemoryCache.get(cacheKey);
    if (mem) return mem;
    try {
      const stored = localStorage.getItem(LQIP_STORAGE_PREFIX + cacheKey.slice(0, 64));
      if (stored && stored.startsWith('data:image/')) {
        lqipMemoryCache.set(cacheKey, stored);
        return stored;
      }
    } catch {}
  }
  return generateBlurUpLqipSvg(fallbackSeed || cacheKey || 'xtube');
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

const openThumbDb = (): Promise<IDBDatabase | null> => {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
};

export const getCachedVideoFrameSync = (cacheKey: string): string | null => {
  if (!cacheKey) return null;
  return memoryCache.get(cacheKey) || null;
};

export const getCachedVideoFrameAsync = async (cacheKey: string): Promise<string | null> => {
  if (!cacheKey) return null;
  const mem = memoryCache.get(cacheKey);
  if (mem) return mem;

  const db = await openThumbDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(cacheKey);
      req.onsuccess = () => {
        const val = typeof req.result === 'string' ? req.result : null;
        if (val) {
          memoryCache.set(cacheKey, val);
        }
        resolve(val);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
};

export const saveCachedVideoFrame = async (cacheKey: string, dataUrl: string): Promise<void> => {
  if (!cacheKey || !dataUrl || !dataUrl.startsWith('data:image/')) return;
  memoryCache.set(cacheKey, dataUrl);

  const db = await openThumbDb();
  if (!db) return;

  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(dataUrl, cacheKey);
  } catch {
    // Ignore quota errors
  }
};

/**
 * Captures both a tiny 20x12 micro-LQIP (for 0ms Blur-Up placeholder) and
 * a crisp 320x180 JPEG DataURL into IndexedDB + memoryCache.
 */
export const tryCaptureAndCacheVideoFrame = (
  videoEl: HTMLVideoElement | null,
  cacheKey: string
): string | null => {
  if (!videoEl || !cacheKey) return null;
  const existing = memoryCache.get(cacheKey);
  if (existing) return existing;

  try {
    const vw = videoEl.videoWidth || 0;
    const vh = videoEl.videoHeight || 0;
    if (vw < 16 || vh < 16) return null;

    const isPortrait = vh > vw;

    // 1. Capture 20x12 micro-LQIP for instant Blur-Up placeholder
    try {
      const lqipCanvas = document.createElement('canvas');
      lqipCanvas.width = isPortrait ? 14 : 24;
      lqipCanvas.height = isPortrait ? 24 : 14;
      const lqipCtx = lqipCanvas.getContext('2d');
      if (lqipCtx) {
        lqipCtx.drawImage(videoEl, 0, 0, lqipCanvas.width, lqipCanvas.height);
        const lqipDataUrl = lqipCanvas.toDataURL('image/jpeg', 0.35);
        if (lqipDataUrl && lqipDataUrl.length > 100) {
          lqipMemoryCache.set(cacheKey, lqipDataUrl);
          try {
            localStorage.setItem(LQIP_STORAGE_PREFIX + cacheKey.slice(0, 64), lqipDataUrl);
          } catch {}
        }
      }
    } catch {}

    // 2. Capture full crisp 320x180 frame
    const canvas = document.createElement('canvas');
    canvas.width = isPortrait ? 200 : 320;
    canvas.height = isPortrait ? 356 : 180;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    if (dataUrl && dataUrl.length > 800) {
      saveCachedVideoFrame(cacheKey, dataUrl);
      return dataUrl;
    }
  } catch {
    // Expected if R2 bucket does not send Access-Control-Allow-Origin: * yet
  }
  return null;
};

// ============================================================================
// VIEWPORT-PRIORITY VIDEO METADATA LOAD QUEUE
// ============================================================================
const MAX_CONCURRENT_LOADS = 5;
let activeLoads = 0;

interface QueueTask {
  id: string;
  priority: number;
  start: () => void;
}

const pendingQueue: QueueTask[] = [];
const activeTaskIds = new Set<string>();

const pumpQueue = () => {
  while (activeLoads < MAX_CONCURRENT_LOADS && pendingQueue.length > 0) {
    pendingQueue.sort((a, b) => b.priority - a.priority);
    const next = pendingQueue.shift();
    if (!next) break;
    activeLoads++;
    activeTaskIds.add(next.id);
    next.start();
  }
};

export const requestVideoPreviewSlot = (
  id: string,
  priority: number,
  onGrant: () => void
): (() => void) => {
  let granted = false;

  const task: QueueTask = {
    id,
    priority,
    start: () => {
      granted = true;
      onGrant();
    },
  };

  pendingQueue.push(task);
  pumpQueue();

  return () => {
    const idx = pendingQueue.indexOf(task);
    if (idx !== -1) {
      pendingQueue.splice(idx, 1);
    }
    if (granted && activeTaskIds.has(id)) {
      activeTaskIds.delete(id);
      activeLoads = Math.max(0, activeLoads - 1);
      pumpQueue();
    }
  };
};

export const releaseVideoPreviewSlot = (id: string) => {
  if (activeTaskIds.has(id)) {
    activeTaskIds.delete(id);
    activeLoads = Math.max(0, activeLoads - 1);
    pumpQueue();
  }
};
