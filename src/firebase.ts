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

/**
 * Generates the canonical Watch Share Link (`https://<origin>/?v=<videoId>`)
 * identical across Index cards, Watch page, and Admin Panel (`/ad.html`).
 */
export const buildVideoShareLink = (videoId: string): string => {
  const cleanId = String(videoId || '').trim();
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://bdcollection.pages.dev';
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
      : 'https://bdcollection.pages.dev';
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

export { ref, onValue, push, set, remove, get, update, runTransaction, onDisconnect, serverTimestamp };

