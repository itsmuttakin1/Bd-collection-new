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
  videoUrl: string;
  url?: string;
  r2Key?: string;
  thumbnailUrl?: string;
  thumbnail?: string;
  duration: string;
  views: number;
  createdAt: number;
  addedAt?: number;
  author: string;
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

export const SMARTLINK_URL = "https://asiaso.org/4/83d7ffcba5e9ff163422eb60b234e632";
export const POPUNDER_SCRIPT_SRC = "https://ahuramazda.org/1/eab46957ba8ada08fe799687dd63716f";
export const NATIVE_BANNER_SCRIPT_SRC = "https://brijmohan.org/21/9e05788a1e91471d1f2353aad323fd56";
export const NATIVE_BANNER_CONTAINER_ID = "container-9e05788a1e91471d1f2353aad323fd56";
export const BANNER_320x50_KEY = "f9d96eee7a61e1baf855ad37f42838ae";
export const BANNER_320x50_SCRIPT_SRC = "https://brijmohan.org/22/f9d96eee7a61e1baf855ad37f42838ae";
export const SOCIAL_BAR_SCRIPT_SRC = "https://brijmohan.org/14/9685e94c6cd837de7f2e6be4199a8040";

export { ref, onValue, push, set, remove, get, update, runTransaction, onDisconnect, serverTimestamp };
