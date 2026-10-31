import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase, ref, onValue, push, set, remove, get, update, runTransaction } from 'firebase/database';

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

export const SMARTLINK_URL = "https://asiaso.org/4/83d7ffcba5e9ff163422eb60b234e632";
export const POPUNDER_SCRIPT_SRC = "https://ahuramazda.org/1/eab46957ba8ada08fe799687dd63716f";
export const NATIVE_BANNER_SCRIPT_SRC = "https://brijmohan.org/21/9e05788a1e91471d1f2353aad323fd56";
export const NATIVE_BANNER_CONTAINER_ID = "container-9e05788a1e91471d1f2353aad323fd56";
export const BANNER_320x50_KEY = "f9d96eee7a61e1baf855ad37f42838ae";
export const BANNER_320x50_SCRIPT_SRC = "https://brijmohan.org/22/f9d96eee7a61e1baf855ad37f42838ae";
export const SOCIAL_BAR_SCRIPT_SRC = "https://brijmohan.org/14/9685e94c6cd837de7f2e6be4199a8040";

export { ref, onValue, push, set, remove, get, update, runTransaction };
