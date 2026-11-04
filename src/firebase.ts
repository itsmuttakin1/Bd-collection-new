import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getDatabase,
  ref,
  onValue,
  push,
  set,
  remove,
  get,
  update,
  runTransaction,
  onDisconnect,
  serverTimestamp,
} from 'firebase/database';

export const firebaseConfig = {
  apiKey: "AIzaSyBPrgfeMTuy3GI1nb2jgw-qqQn6wPvH-0w",
  authDomain: "video-platform-7c031.firebaseapp.com",
  databaseURL: "https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "video-platform-7c031",
  storageBucket: "video-platform-7c031.firebasestorage.app",
  messagingSenderId: "1095431449628",
  appId: "1:1095431449628:web:4527ae65c83fd9966403d9"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

export interface VideoItem {
  id: string;
  rawId?: string;
  title: string;
  description: string;
  category: string;
  keywords?: string;
  hashtags?: string;
  videoUrl: string;
  url?: string;
  r2Key?: string;
  thumbnailUrl?: string;
  thumbnail?: string;
  duration: string;
  views: number;
  likes?: number;
  createdAt: number;
  addedAt?: number;
  author: string;
  isShort?: boolean;
}

export interface ShortItem {
  id: string;
  title: string;
  hashtags: string;
  keywords?: string;
  videoUrl: string;
  url: string;
  r2Key?: string;
  thumbnail: string;
  thumbnailUrl?: string;
  duration: string;
  views: number;
  likes: number;
  createdAt: number;
  addedAt: number;
  author: string;
  isLongVideo?: boolean;
}

export interface NoticeItem {
  id: string;
  text: string;
  badge?: string;
  videoId?: string;
  shortId?: string;
  linkText?: string;
  active: boolean;
  createdAt: number;
}

/**
 * Generates the canonical Watch Share Link (`https://<origin>/?v=<videoId>`)
 * identical across Index cards, Watch page, and Admin Panel (`/ad.html`).
 */
export const buildVideoShareLink = (videoId: string): string => {
  const cleanId = String(videoId || '').trim();
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://xtubeofficial.pages.dev';
  return `${origin}/?v=${encodeURIComponent(cleanId)}`;
};

/**
 * Generates the canonical Short Share Link (`https://<origin>/?short=<shortId>`)
 */
export const buildShortShareLink = (shortId: string): string => {
  const cleanId = String(shortId || '').trim();
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://xtubeofficial.pages.dev';
  return `${origin}/?short=${encodeURIComponent(cleanId)}`;
};

/**
 * Reliable clipboard copy helper with offscreen textarea fallback for iframes and all browsers.
 */
export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback to textarea copy below
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.opacity = '0';
    textArea.style.pointerEvents = 'none';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, textArea.value.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(textArea);
    return copied;
  } catch {
    return false;
  }
};

export const SMARTLINK_URL = "https://asiaso.org/4/19da97c151732fac7f15885cffc09675";
export const POPUNDER_SCRIPT_SRC = "https://ahuramazda.org/1/f8789aea5ef961063dfc6ebf1cf99900";
export const NATIVE_BANNER_SCRIPT_SRC = "https://brijmohan.org/21/a7d1393a2e85dd67ac13b3e060394934";
export const NATIVE_BANNER_CONTAINER_ID = "container-a7d1393a2e85dd67ac13b3e060394934";
export const BANNER_320x50_KEY = "3b1a924db6016b5bf4ddfe098d957940";
export const BANNER_320x50_SCRIPT_SRC = "https://brijmohan.org/22/3b1a924db6016b5bf4ddfe098d957940";
export const SOCIAL_BAR_SCRIPT_SRC = "https://brijmohan.org/14/4c4a8e781dbd7fa6718915694148d8d9";

export const KNOWN_R2_PUBLIC_DOMAINS = [
  'https://pub-56ae26091320480ca8946ab4e42a051d.r2.dev',
  'https://pub-a89cc17745e446439972f8e3a1b3c661.r2.dev',
  'https://pub-b89fbff1088544e2a25d432417afc3b1.r2.dev',
  'https://pub-f58d47fa71fd4d4e98985fc906988f57.r2.dev',
];

/**
 * All videos and shorts automatically render live frames directly from the video stream (#t=2.5),
 * so no separate thumbnail image URL is needed.
 */
export const isR2ServerThumbnail = (_rawThumb?: string): boolean => {
  return false;
};

export const sanitizeServerThumbnail = (_rawThumb?: string): string => {
  return '';
};

/**
 * Builds an ordered list of candidate video stream URLs (across R2 public domains + /api/stream proxy)
 * so live video frame previews on cards and players work 100% reliably.
 */
export const buildVideoStreamCandidates = (rawUrl?: string, r2Key?: string): string[] => {
  let clean = String(rawUrl || '').trim();
  if (!clean && r2Key) {
    clean = `https://pub-56ae26091320480ca8946ab4e42a051d.r2.dev/${String(r2Key).replace(/^\/+/, '')}`;
  }
  if (!clean) return [];
  if (!/^https?:\/\//i.test(clean) && !clean.startsWith('/')) {
    clean = `https://${clean}`;
  }
  if (clean.includes('pub-a89cc17745e446439972f8e3a1b3c661.r2.dev/shorts/')) {
    clean = clean.replace(
      'pub-a89cc17745e446439972f8e3a1b3c661.r2.dev/shorts/',
      'pub-56ae26091320480ca8946ab4e42a051d.r2.dev/shorts/'
    );
  }

  const list: string[] = [clean];
  try {
    const parsed = new URL(clean);
    if (parsed.hostname.endsWith('.r2.dev')) {
      const pathPart = parsed.pathname + parsed.search;
      for (const dom of KNOWN_R2_PUBLIC_DOMAINS) {
        const alt = `${dom}${pathPart}`;
        if (!list.includes(alt)) list.push(alt);
      }
      if (parsed.pathname.startsWith('/shorts/')) {
        const rootPath = parsed.pathname.replace(/^\/shorts\//, '/');
        for (const dom of KNOWN_R2_PUBLIC_DOMAINS) {
          const rootAlt = `${dom}${rootPath}${parsed.search}`;
          if (!list.includes(rootAlt)) list.push(rootAlt);
        }
      }
    }
  } catch {}

  const streamProxy = `/api/stream?url=${encodeURIComponent(clean)}`;
  if (!list.includes(streamProxy)) list.push(streamProxy);

  return list;
};

export { ref, onValue, push, set, remove, get, update, runTransaction, onDisconnect, serverTimestamp };


