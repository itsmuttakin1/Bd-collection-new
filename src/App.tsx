/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  db,
  ref,
  onValue,
  set,
  remove,
  runTransaction,
  onDisconnect,
  VideoItem,
  ShortItem,
  NoticeItem,
  RedeemPackageItem,
  RedeemStoreConfig,
  buildVideoShareLink,
  buildShortShareLink,
  copyTextToClipboard,
  sanitizeServerThumbnail,
  STEP_SMARTLINKS,
  decodeTgStartId,
  setActiveTelegramBotUsername,
} from './firebase';
import {
  NativeBannerAd,
  Banner320x50Ad,
  SocialBarLoader,
  AntiAdBlockGuard,
  useAdFreeVip,
  formatVipCountdown,
} from './components/AdUnits';
import { ProtectedVideoPlayer } from './components/ProtectedVideoPlayer';
import { VideoCard, ShortShelfPreview } from './components/VideoCard';
import { ShortsFeed } from './components/ShortsFeed';
import {
  LANGUAGES,
  detectInitialLanguage,
  detectCountryLanguageFromIP,
  getExtendedUiStrings,
} from './i18n';
import {
  Play,
  Search,
  Home,
  Flame,
  ThumbsUp,
  Share2,
  Menu,
  Globe,
  Smartphone,
  Megaphone,
  ChevronRight,
  Ticket,
  ShieldCheck,
  Clock,
  ExternalLink,
  X,
  User,
  Settings,
  Moon,
  Sun,
  Lock,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';

type ViewMode = 'home' | 'watch' | 'shorts' | 'profile';

export interface TelegramUserProfile {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  username: string;
  photoUrl: string;
  isRealTelegramUser: boolean;
}

const TG_PROFILE_STORAGE_KEY = 'xtube_tg_user_profile_v1';

const resolveTelegramUserProfile = (): TelegramUserProfile => {
  if (typeof window === 'undefined') {
    return {
      id: 'Guest',
      firstName: 'Telegram',
      lastName: 'User',
      fullName: 'Telegram User',
      username: 'telegram_user',
      photoUrl: '',
      isRealTelegramUser: false,
    };
  }

  try {
    const tg = (window as any).Telegram?.WebApp;
    let rawUser = tg?.initDataUnsafe?.user;

    // Fallback: parse raw initData query string if initDataUnsafe wasn't populated
    if (!rawUser && typeof tg?.initData === 'string' && tg.initData.includes('user=')) {
      const initParams = new URLSearchParams(tg.initData);
      const rawUserJson = initParams.get('user');
      if (rawUserJson) {
        rawUser = JSON.parse(rawUserJson);
      }
    }

    if (rawUser && rawUser.id) {
      const firstName = String(rawUser.first_name || '').trim();
      const lastName = String(rawUser.last_name || '').trim();
      const fullName = [firstName, lastName].filter(Boolean).join(' ') || 'Telegram User';
      const username = String(rawUser.username || '').trim().replace(/^@+/, '');
      const id = String(rawUser.id).trim();
      const photoUrl = String(rawUser.photo_url || '').trim();

      const profile: TelegramUserProfile = {
        id,
        firstName: firstName || fullName,
        lastName,
        fullName,
        username: username || `user_${id}`,
        photoUrl: photoUrl || `/api/tg-avatar?userId=${encodeURIComponent(id)}`,
        isRealTelegramUser: true,
      };
      try {
        localStorage.setItem(TG_PROFILE_STORAGE_KEY, JSON.stringify(profile));
      } catch {}
      return profile;
    }

    // Fallback 2: Check URL parameters injected by the Telegram Bot (`?tg_id=...&tg_name=...&tg_user=...`)
    const params = new URLSearchParams(window.location.search);
    const paramId = (params.get('tg_id') || '').trim();
    const paramName = (params.get('tg_name') || '').trim();
    const paramUser = (params.get('tg_user') || '').trim().replace(/^@+/, '');
    const paramPhoto = (params.get('tg_photo') || '').trim();

    if (paramId && /^[0-9]{4,20}$/.test(paramId)) {
      const fullName = paramName || 'Telegram User';
      const profile: TelegramUserProfile = {
        id: paramId,
        firstName: fullName.split(' ')[0] || fullName,
        lastName: fullName.split(' ').slice(1).join(' '),
        fullName,
        username: paramUser || `user_${paramId}`,
        photoUrl: paramPhoto || `/api/tg-avatar?userId=${encodeURIComponent(paramId)}`,
        isRealTelegramUser: true,
      };
      try {
        localStorage.setItem(TG_PROFILE_STORAGE_KEY, JSON.stringify(profile));
      } catch {}
      return profile;
    }

    // Fallback 3: Restore previously authenticated Telegram user from localStorage
    const savedRaw = localStorage.getItem(TG_PROFILE_STORAGE_KEY);
    if (savedRaw) {
      const parsed = JSON.parse(savedRaw);
      if (parsed && parsed.id && parsed.isRealTelegramUser) {
        return {
          ...parsed,
          photoUrl: parsed.photoUrl || `/api/tg-avatar?userId=${encodeURIComponent(parsed.id)}`,
        };
      }
    }
  } catch {}

  // Browser fallback when opened outside Telegram
  let visitorShortId = '84920145';
  try {
    const existingVid = localStorage.getItem('bd_collection_visitor_id') || '';
    const digits = existingVid.replace(/\D/g, '');
    if (digits.length >= 6) {
      visitorShortId = digits.slice(0, 10);
    }
  } catch {}

  return {
    id: visitorShortId,
    firstName: 'WebApp',
    lastName: 'User',
    fullName: 'WebApp User',
    username: `user_${visitorShortId.slice(0, 6)}`,
    photoUrl: '',
    isRealTelegramUser: false,
  };
};

let telegramStartParamConsumed = false;

const extractTelegramStartParamRaw = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery =
      params.get('tgWebAppStartParam') ||
      params.get('startapp') ||
      params.get('start_param') ||
      (window as any).Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (typeof fromQuery === 'string' && fromQuery.trim()) {
      return fromQuery.trim();
    }
    if (window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#\/?\??/, ''));
      const fromHash =
        hashParams.get('tgWebAppStartParam') ||
        hashParams.get('startapp') ||
        hashParams.get('start_param');
      if (fromHash && fromHash.trim()) return fromHash.trim();
      const tgWebAppData = hashParams.get('tgWebAppData');
      if (tgWebAppData) {
        const innerParams = new URLSearchParams(tgWebAppData);
        const innerStart = innerParams.get('start_param');
        if (innerStart && innerStart.trim()) return innerStart.trim();
      }
    }
  } catch {}
  return '';
};

const cleanIncomingVideoParam = (raw: string): string => {
  const trimmed = String(raw || '').trim();
  const stripped = trimmed.replace(/^(vid_|v_|video_)/i, '');
  return decodeTgStartId(stripped);
};

const cleanIncomingShortParam = (raw: string): string => {
  const trimmed = String(raw || '').trim();
  const stripped = trimmed.replace(/^short_/i, '');
  return decodeTgStartId(stripped);
};

const getRequestedShortIdFromUrl = (allowTelegramStartParam = false): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('short') || params.get('s');
    if (s && s.trim()) return cleanIncomingShortParam(s.trim());

    if (allowTelegramStartParam && !telegramStartParamConsumed) {
      const startParam = extractTelegramStartParamRaw();
      if (startParam && startParam.startsWith('short_')) {
        telegramStartParamConsumed = true;
        return cleanIncomingShortParam(startParam);
      }
    }
  } catch {}
  return null;
};

const getRequestedVideoIdFromUrl = (allowTelegramStartParam = false): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('v') || params.get('video') || params.get('id');
    if (v && v.trim()) return cleanIncomingVideoParam(v.trim());

    // Only read Telegram start_param ONCE on initial app launch so subsequent Firebase view updates never revert to the initial video
    if (allowTelegramStartParam && !telegramStartParamConsumed) {
      const tgParam = extractTelegramStartParamRaw();
      if (tgParam && !tgParam.startsWith('short_') && tgParam !== 'buy') {
        telegramStartParamConsumed = true;
        return cleanIncomingVideoParam(tgParam);
      }
    }

    if (window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#\/?\??/, ''));
      const hv = hashParams.get('v') || hashParams.get('video') || hashParams.get('id');
      if (hv && hv.trim()) return cleanIncomingVideoParam(hv.trim());
    }
  } catch {}
  return null;
};

const findMatchingVideo = (list: VideoItem[], rawTarget: string | null): VideoItem | undefined => {
  if (!rawTarget) return undefined;
  const target = rawTarget.trim();
  if (!target) return undefined;

  let decoded = target;
  try {
    decoded = decodeURIComponent(target).trim();
  } catch {}

  // 1. Exact or decoded Firebase key / inner rawId match
  const exact = list.find(
    (v) =>
      v.id === target ||
      v.id === decoded ||
      v.id.trim() === target ||
      v.id.trim() === decoded ||
      (v.rawId && (v.rawId === target || v.rawId === decoded))
  );
  if (exact) return exact;

  // 2. Case-insensitive or underscore-stripped ID match (fixes Telegram Markdown stripped underscores)
  const lower = decoded.toLowerCase();
  const stripped = lower.replace(/_/g, '');
  const caseMatch = list.find(
    (v) =>
      v.id.toLowerCase() === lower ||
      v.id.toLowerCase().replace(/_/g, '') === stripped ||
      (v.rawId &&
        (v.rawId.toLowerCase() === lower ||
          v.rawId.toLowerCase().replace(/_/g, '') === stripped))
  );
  if (caseMatch) return caseMatch;

  // 3. Match by r2Key or stream URL filename
  return list.find((v) => {
    if (v.r2Key && (v.r2Key === target || v.r2Key === decoded)) return true;
    const stream = (v.url || v.videoUrl || '').trim();
    if (!stream) return false;
    return (
      stream === target ||
      stream === decoded ||
      stream.endsWith(`/${target}`) ||
      stream.endsWith(`/${decoded}`) ||
      stream.endsWith(`/${encodeURIComponent(decoded)}`)
    );
  });
};

const findMatchingShort = (list: ShortItem[], rawTarget: string | null): ShortItem | undefined => {
  if (!rawTarget || rawTarget === 'feed') return undefined;
  const target = rawTarget.trim();
  if (!target) return undefined;

  let decoded = target;
  try {
    decoded = decodeURIComponent(target).trim();
  } catch {}

  const exact = list.find(
    (s) => s.id === target || s.id === decoded || s.id.trim() === target || s.id.trim() === decoded
  );
  if (exact) return exact;

  const lower = decoded.toLowerCase();
  const stripped = lower.replace(/_/g, '');
  const fuzzy = list.find(
    (s) =>
      s.id.toLowerCase() === lower || s.id.toLowerCase().replace(/_/g, '') === stripped
  );
  if (fuzzy) return fuzzy;

  return list.find((s) => {
    if (s.r2Key && (s.r2Key === target || s.r2Key === decoded)) return true;
    const stream = (s.url || s.videoUrl || '').trim();
    if (!stream) return false;
    return (
      stream === target ||
      stream === decoded ||
      stream.endsWith(`/${target}`) ||
      stream.endsWith(`/${decoded}`) ||
      stream.endsWith(`/${encodeURIComponent(decoded)}`)
    );
  });
};

// ============================================================================
// YOUTUBE-STYLE PERSONALIZED RECOMMENDATION & TRENDING ALGORITHM ENGINE
// ============================================================================
interface UserTasteProfile {
  tagScores: Record<string, number>;
  categoryScores: Record<string, number>;
  watchedHistory: Record<string, { count: number; lastAt: number }>;
  likedHistory: Record<string, number>;
}

const ALGO_STORAGE_KEY = 'bd_yt_algo_profile_v1';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'video', 'videos', 'watch', 'new', 'full', 'hd', 'bd', 'collection',
]);

const extractContentTokens = (item: {
  title?: string;
  keywords?: string;
  hashtags?: string;
  description?: string;
  category?: string;
}): string[] => {
  const rawText = [
    item.title || '',
    item.keywords || '',
    item.hashtags || '',
    item.description || '',
    item.category || '',
  ]
    .join(' ')
    .toLowerCase();

  const matches = rawText.match(/[#a-z0-9\u0980-\u09ff]{2,}/gi) || [];
  const unique = new Set<string>();
  for (const m of matches) {
    const clean = m.replace(/^#+/, '').trim();
    if (clean.length >= 2 && !STOP_WORDS.has(clean)) {
      unique.add(clean);
    }
  }
  return Array.from(unique);
};

const loadUserTasteProfile = (): UserTasteProfile => {
  try {
    const raw = localStorage.getItem(ALGO_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        tagScores: parsed.tagScores || {},
        categoryScores: parsed.categoryScores || {},
        watchedHistory: parsed.watchedHistory || {},
        likedHistory: parsed.likedHistory || {},
      };
    }
  } catch {}
  return {
    tagScores: {},
    categoryScores: {},
    watchedHistory: {},
    likedHistory: {},
  };
};

// Computes YouTube-style recommendation score based on:
// 1. Similarity to what the user is currently watching (`referenceItem`)
// 2. User's personal watch & like history (`profile.tagScores` & `categoryScores`)
// 3. Video engagement (`views` + `likes * 6`) & freshness (`createdAt`)
const computeYouTubeRecommendationScore = (
  candidate: {
    id: string;
    title?: string;
    keywords?: string;
    hashtags?: string;
    description?: string;
    category?: string;
    views?: number;
    likes?: number;
    createdAt?: number;
  },
  profile: UserTasteProfile,
  referenceItem?: {
    id: string;
    title?: string;
    keywords?: string;
    hashtags?: string;
    description?: string;
    category?: string;
  } | null
): number => {
  const tokens = extractContentTokens(candidate);
  let score = 0;

  // 1. Personal Interest Affinity (matches what types of videos the user watches/likes)
  for (const tok of tokens) {
    if (profile.tagScores[tok]) {
      score += profile.tagScores[tok] * 14;
    }
  }

  const cat = (candidate.category || '').trim().toLowerCase();
  if (cat && profile.categoryScores[cat]) {
    score += profile.categoryScores[cat] * 20;
  }

  // 2. Direct Context Similarity (when watching a video, boost videos with similar keywords/title/category)
  if (referenceItem && referenceItem.id !== candidate.id) {
    const refTokens = new Set(extractContentTokens(referenceItem));
    let sharedCount = 0;
    for (const tok of tokens) {
      if (refTokens.has(tok)) {
        sharedCount++;
      }
    }
    score += sharedCount * 45;

    const refCat = (referenceItem.category || '').trim().toLowerCase();
    if (cat && refCat && cat === refCat) {
      score += 60;
    }
  }

  // 3. Engagement & Virality Signal (Views + Weighted Likes)
  const views = Number(candidate.views) || 0;
  const likes = Number(candidate.likes) || 0;
  score += Math.log10(1 + views + likes * 6) * 28;

  // 4. Freshness Signal (Newer uploads get a discovery boost like YouTube)
  const ageHours = Math.max(
    1,
    (Date.now() - (Number(candidate.createdAt) || Date.now())) / (1000 * 60 * 60)
  );
  score += Math.max(0, 40 - Math.log2(ageHours) * 4);

  // 5. Watch History Novelty Adjustment (boost unwatched matching videos; cool down recently watched items so fresh ones appear)
  const watched = profile.watchedHistory[candidate.id];
  if (!watched) {
    score += 45; // Unwatched discovery boost
  } else {
    const minsSinceWatched = (Date.now() - watched.lastAt) / (1000 * 60);
    if (minsSinceWatched < 20) {
      score -= 65; // Recently watched cooldown so new/random suggestions rise to the top
    } else if (minsSinceWatched < 120) {
      score -= 25;
    }
  }

  return score;
};

// Fisher-Yates random shuffle helper for breaking ties and mixing random discovery
function shuffleItemsRandomly<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Computes YouTube Trending Velocity Score (Views + Likes velocity + Recency + Personal Affinity)
const computeYouTubeTrendingScore = (
  item: {
    id: string;
    title?: string;
    keywords?: string;
    hashtags?: string;
    category?: string;
    views?: number;
    likes?: number;
    createdAt?: number;
  },
  profile: UserTasteProfile
): number => {
  const views = Number(item.views) || 0;
  const likes = Number(item.likes) || 0;
  const ageDays = Math.max(
    0.25,
    (Date.now() - (Number(item.createdAt) || Date.now())) / (1000 * 60 * 60 * 24)
  );
  const engagementVelocity = (views + likes * 8) / Math.pow(ageDays + 1, 0.45);
  const personalBoost = computeYouTubeRecommendationScore(item, profile, null) * 0.35;
  return engagementVelocity * 10 + personalBoost;
};

export default function App() {
  // Read initial `?v=<videoId>`, `?short=<shortId>`, or one-time Telegram `start_param`
  const initialShortId = useMemo(() => getRequestedShortIdFromUrl(true), []);
  const initialUrlVidId = useMemo(
    () => (initialShortId ? null : getRequestedVideoIdFromUrl(true)),
    [initialShortId]
  );

  const pendingSharedIdRef = useRef<string | null>(initialUrlVidId);
  const initialSharedResolvedRef = useRef<boolean>(!initialUrlVidId);
  const activeVideoIdRef = useRef<string | null>(initialUrlVidId);
  const userNavigatedRef = useRef<boolean>(false);
  const suggestedOrderRef = useRef<{ forVideoId: string; count: number; ids: string[] }>({
    forVideoId: '',
    count: 0,
    ids: [],
  });
  const homeOrderRef = useRef<{ count: number; refreshSeed: number; ids: string[] }>({
    count: 0,
    refreshSeed: -1,
    ids: [],
  });
  const homeShortsOrderRef = useRef<{
    shortCount: number;
    videoCount: number;
    refreshSeed: number;
    forVideoId: string;
    ids: string[];
  }>({
    shortCount: 0,
    videoCount: 0,
    refreshSeed: -1,
    forVideoId: '',
    ids: [],
  });
  const shortsFeedOrderRef = useRef<{
    shortCount: number;
    videoCount: number;
    sessionSeed: number;
    ids: string[];
  }>({
    shortCount: 0,
    videoCount: 0,
    sessionSeed: -1,
    ids: [],
  });

  const [tasteProfile, setTasteProfile] = useState<UserTasteProfile>(() => loadUserTasteProfile());
  const [profileRevision, setProfileRevision] = useState<number>(0);
  const [homeRefreshSeed, setHomeRefreshSeed] = useState<number>(1);
  const [shortsSessionSeed, setShortsSessionSeed] = useState<number>(1);

  const [, setSharedVideoId] = useState<string | null>(initialUrlVidId);
  const [activeShortId, setActiveShortId] = useState<string | null>(initialShortId);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (initialShortId) return 'shorts';
    if (initialUrlVidId) return 'watch';
    return 'home';
  });
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [shorts, setShorts] = useState<ShortItem[]>([]);
  const [loadingVideos, setLoadingVideos] = useState<boolean>(true);
  const [activeVideo, setActiveVideo] = useState<VideoItem | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);

  // Real Telegram User Profile & Live Online Presence State
  const [tgProfile, setTgProfile] = useState<TelegramUserProfile>(() =>
    resolveTelegramUserProfile()
  );
  const [avatarLoadFailed, setAvatarLoadFailed] = useState<boolean>(false);
  const [isUserOnline, setIsUserOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );
  const [liveOnlineCount, setLiveOnlineCount] = useState<number>(1);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('xtube_theme_mode') !== 'light';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      const root = document.documentElement;
      if (isDarkMode) {
        root.classList.add('dark');
        localStorage.setItem('xtube_theme_mode', 'dark');
      } else {
        root.classList.remove('dark');
        localStorage.setItem('xtube_theme_mode', 'light');
      }
    } catch {}
  }, [isDarkMode]);

  // 3-Step Smartlink Verification State (Step 1 -> Step 2 -> Step 3, 20s each + Mini WebView)
  const STEP_DURATION_SECONDS = 20;
  const [stepGateVideo, setStepGateVideo] = useState<VideoItem | null>(null);
  const [stepGatePendingId, setStepGatePendingId] = useState<string | null>(initialUrlVidId);
  const stepGatePendingIdRef = useRef<string | null>(initialUrlVidId);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [stepTimer, setStepTimer] = useState<number>(STEP_DURATION_SECONDS);
  const [webviewReloadKey, setWebviewReloadKey] = useState<number>(0);
  const [unlockedVideos, setUnlockedVideos] = useState<Record<string, boolean>>({});

  // Initialize Telegram Mini App WebApp SDK if opened inside Telegram
  useEffect(() => {
    const tg = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : undefined;
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor('#0b0e14');
      if (typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor('#0b0e14');
      const freshProfile = resolveTelegramUserProfile();
      if (freshProfile.isRealTelegramUser) {
        setTgProfile(freshProfile);
        setAvatarLoadFailed(false);
      }

      // Also check if Telegram populated initDataUnsafe.start_param for Direct Mini App links (?startapp=vid_...)
      const rawStart = extractTelegramStartParamRaw();
      if (rawStart && !userNavigatedRef.current) {
        if (rawStart.startsWith('short_')) {
          const sId = cleanIncomingShortParam(rawStart);
          if (sId) {
            setActiveShortId(sId);
            setViewMode('shorts');
          }
        } else if (rawStart !== 'buy') {
          const vId = cleanIncomingVideoParam(rawStart);
          if (vId && !pendingSharedIdRef.current) {
            pendingSharedIdRef.current = vId;
            activeVideoIdRef.current = vId;
            stepGatePendingIdRef.current = vId;
            setSharedVideoId(vId);
            setStepGatePendingId(vId);
            setViewMode('watch');
          }
        }
      }
    } catch {}
  }, []);

  // Sync Telegram Mini App native BackButton with Watch/Shorts/Profile/StepGate vs Home view
  useEffect(() => {
    const tg = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : undefined;
    const backButton = tg?.BackButton;
    if (!backButton) return;

    const handleBack = () => {
      if (stepGateVideo || stepGatePendingId) {
        stepGatePendingIdRef.current = null;
        setStepGatePendingId(null);
        setStepGateVideo(null);
        setViewMode('home');
        return;
      }
      userNavigatedRef.current = true;
      pendingSharedIdRef.current = null;
      activeVideoIdRef.current = null;
      setSharedVideoId(null);
      setActiveShortId(null);
      setViewMode('home');
      setActiveVideo(null);
      try {
        window.history.pushState({}, '', '/');
      } catch {}
    };

    try {
      if (
        viewMode === 'watch' ||
        viewMode === 'shorts' ||
        viewMode === 'profile' ||
        Boolean(stepGateVideo || stepGatePendingId)
      ) {
        backButton.show();
        backButton.onClick(handleBack);
      } else {
        backButton.hide();
      }
    } catch {}

    return () => {
      try {
        backButton.offClick(handleBack);
      } catch {}
    };
  }, [viewMode, stepGateVideo, stepGatePendingId]);

  const [sortByTrending, setSortByTrending] = useState<boolean>(false);
  const [trendingSeed, setTrendingSeed] = useState<number>(0);
  const [trendingVideos, setTrendingVideos] = useState<VideoItem[]>([]);

  // Language State (34+ languages, auto-detected by Visitor Country / Timezone / Telegram)
  const [langCode, setLangCode] = useState<string>(() => detectInitialLanguage());
  const t = LANGUAGES[langCode] || LANGUAGES.bn;
  const ui = useMemo(() => getExtendedUiStrings(langCode), [langCode]);

  // Search & Like State (Supports Google SearchAction ?q= parameter)
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('q') || '';
  });
  const [likedVideos, setLikedVideos] = useState<Record<string, boolean>>({});
  const [copiedShare, setCopiedShare] = useState<boolean>(false);
  const [adBlockActive, setAdBlockActive] = useState<boolean>(false);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [activeNoticeIdx, setActiveNoticeIdx] = useState<number>(0);

  // Redeem Code & Ad-Free VIP State
  const {
    isAdFree,
    activeCode,
    expiresAt,
    durationLabel,
    remainingMs,
    activateCode,
  } = useAdFreeVip();
  const [redeemModalOpen, setRedeemModalOpen] = useState<boolean>(false);
  const [redeemInput, setRedeemInput] = useState<string>('');
  const [redeemLoading, setRedeemLoading] = useState<boolean>(false);
  const [redeemFeedback, setRedeemFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [redeemPackages, setRedeemPackages] = useState<RedeemPackageItem[]>([]);
  const [storeConfig, setStoreConfig] = useState<RedeemStoreConfig>({ serviceEnabled: true });

  const isRedeemServiceEnabled = storeConfig.serviceEnabled !== false;

  // Auto-bypass 3-Step Verification if user activates a valid VIP Ad-Free Redeem Code
  useEffect(() => {
    if (isAdFree && (stepGateVideo || stepGatePendingId)) {
      const target = stepGateVideo;
      stepGatePendingIdRef.current = null;
      setStepGatePendingId(null);
      setStepGateVideo(null);
      if (target) {
        setActiveVideo(target);
        setViewMode('watch');
      }
    }
  }, [isAdFree, stepGateVideo, stepGatePendingId]);

  // 20-Second Countdown Timer for Step 1, Step 2, Step 3
  useEffect(() => {
    const isStepModalOpen = Boolean(stepGateVideo || stepGatePendingId) && !isAdFree;
    if (!isStepModalOpen) return;

    if (stepTimer <= 0) return;

    const timerId = window.setInterval(() => {
      setStepTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [stepGateVideo, stepGatePendingId, currentStep, stepTimer, isAdFree]);

  useEffect(() => {
    let primaryPkgs: Record<string, any> = {};
    let fallbackPkgs: Record<string, any> = {};

    const syncMergedPackages = () => {
      const merged = { ...fallbackPkgs, ...primaryPkgs };
      const list: RedeemPackageItem[] = Object.entries(merged)
        .filter(([id, item]: [string, any]) => id !== 'botAuthToken' && item && typeof item === 'object' && item.active !== false)
        .map(([id, item]: [string, any]) => ({
          id,
          name: String(item?.name || 'VIP Ad-Free Package'),
          price: String(item?.price || '50 TK'),
          durationHours: Number(item?.durationHours) || 168,
          durationLabel: String(item?.durationLabel || '7 Days'),
          active: item?.active !== false,
          createdAt: Number(item?.createdAt) || 0,
        }))
        .sort((a, b) => a.durationHours - b.durationHours);
      setRedeemPackages(list);
    };

    const unsubPkg1 = onValue(
      ref(db, 'redeemPackages'),
      (snap) => {
        primaryPkgs = snap.val() && typeof snap.val() === 'object' ? snap.val() : {};
        syncMergedPackages();
      },
      () => {}
    );

    const unsubPkg2 = onValue(
      ref(db, 'telegramBotSessions/_storeConfig/packages'),
      (snap) => {
        fallbackPkgs = snap.val() && typeof snap.val() === 'object' ? snap.val() : {};
        syncMergedPackages();
      },
      () => {}
    );

    let primaryCfg: Record<string, any> = {};
    let fallbackCfg: Record<string, any> = {};

    const syncMergedConfig = () => {
      const merged: RedeemStoreConfig = {
        ...fallbackCfg,
        ...primaryCfg,
        serviceEnabled:
          primaryCfg.serviceEnabled !== undefined
            ? primaryCfg.serviceEnabled !== false
            : fallbackCfg.serviceEnabled !== undefined
            ? fallbackCfg.serviceEnabled !== false
            : true,
      };
      if (merged.botUsername) {
        setActiveTelegramBotUsername(merged.botUsername);
      }
      setStoreConfig(merged);
      if (merged.serviceEnabled === false) {
        setRedeemModalOpen(false);
      }
    };

    const unsubCfg1 = onValue(
      ref(db, 'redeemStoreConfig'),
      (snap) => {
        primaryCfg = snap.val() && typeof snap.val() === 'object' ? snap.val() : {};
        syncMergedConfig();
      },
      () => {}
    );

    const unsubCfg2 = onValue(
      ref(db, 'telegramBotSessions/_storeConfig'),
      (snap) => {
        fallbackCfg = snap.val() && typeof snap.val() === 'object' ? snap.val() : {};
        syncMergedConfig();
      },
      () => {}
    );

    return () => {
      unsubPkg1();
      unsubPkg2();
      unsubCfg1();
      unsubCfg2();
    };
  }, []);

  const handleActivateRedeemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!redeemInput.trim()) return;
    setRedeemLoading(true);
    setRedeemFeedback(null);
    const res = await activateCode(redeemInput);
    setRedeemLoading(false);
    setRedeemFeedback({ ok: res.ok, text: res.message });
    if (res.ok) {
      setRedeemInput('');
    }
  };

  // Convert "MM:SS" or "HH:MM:SS" duration string to ISO-8601 duration (e.g. "PT3M30S") for Google VideoObject
  const formatIsoDuration = (raw?: string): string => {
    if (!raw || typeof raw !== 'string') return 'PT3M30S';
    const parts = raw
      .trim()
      .split(':')
      .map((n) => parseInt(n, 10));
    if (parts.some((n) => isNaN(n) || n < 0)) return 'PT3M30S';
    if (parts.length === 3) {
      return `PT${parts[0]}H${parts[1]}M${parts[2]}S`;
    }
    if (parts.length === 2) {
      const m = parts[0] || 0;
      const s = parts[1] || 0;
      return m === 0 && s === 0 ? 'PT3M30S' : `PT${m}M${s}S`;
    }
    return 'PT3M30S';
  };

  // Dynamic Google SEO, OpenGraph, Canonical URL, Keywords & Schema.org VideoObject JSON-LD for ALL Videos & Shorts
  useEffect(() => {
    const SITE_ORIGIN = 'https://xtubeofficial.pages.dev';
    const BASE_KEYWORDS =
      'X Tube, X tube official, xxx, xtube, x tube video, x tube shorts, Bangladeshi viral video, bd viral link, বাংলা ভাইরাল ভিডিও, নতুন ভাইরাল ভিডিও, desi viral video, viral short video, 18+ viral video, room date viral, trending shorts, x tube hd';
    const defaultTitle =
      'X Tube – Official Viral Videos, Shorts & Trending HD Streams | X Tube Official';
    const defaultDesc =
      'X Tube (X Tube Official) – Watch and stream the latest Bangladeshi viral videos, trending Shorts, exclusive HD clips, and uncensored entertainment on X Tube.';
    const defaultImg = `${SITE_ORIGIN}/favicon.png`;

    const setMetaContent = (selector: string, val: string) => {
      const el = document.querySelector(selector);
      if (el) el.setAttribute('content', val);
    };

    const canonicalEl = document.getElementById('canonical-link');
    const jsonLdEl = document.getElementById('dynamic-video-jsonld');

    const buildVideoObjectNode = (v: VideoItem) => {
      const vTitle = (v.title || 'X Tube Official Viral Video').trim();
      const vDesc = (
        v.description ||
        v.keywords ||
        `Watch "${vTitle}" in HD on X Tube Official. Bangladeshi viral video stream.`
      ).trim();
      const rawVThumb = (v.thumbnail || v.thumbnailUrl || '').trim();
      const vThumb =
        rawVThumb && !rawVThumb.includes('ibb.co') && !rawVThumb.includes('imgbb.com')
          ? rawVThumb
          : defaultImg;
      const vStream = (v.url || v.videoUrl || '').trim();
      const vWatchUrl = `${SITE_ORIGIN}/?v=${encodeURIComponent(v.id)}`;
      const vUploadIso = new Date(
        Number(v.addedAt || v.createdAt) || 1761868800000
      ).toISOString();

      return {
        '@type': 'VideoObject',
        '@id': `${vWatchUrl}#video`,
        url: vWatchUrl,
        name: `${vTitle} | X Tube Official`,
        description: vDesc,
        keywords: `${v.keywords || ''}, ${BASE_KEYWORDS}`.replace(/^,\s*/, ''),
        thumbnailUrl: [vThumb],
        uploadDate: vUploadIso,
        duration: formatIsoDuration(v.duration),
        contentUrl: vStream,
        embedUrl: vWatchUrl,
        isFamilyFriendly: true,
        inLanguage: 'bn',
        potentialAction: {
          '@type': 'WatchAction',
          target: vWatchUrl,
        },
        interactionStatistic: {
          '@type': 'InteractionCounter',
          interactionType: { '@type': 'WatchAction' },
          userInteractionCount: Number(v.views) || 0,
        },
        publisher: {
          '@type': 'Organization',
          name: 'X Tube Official',
          alternateName: 'X Tube',
          url: SITE_ORIGIN,
          logo: {
            '@type': 'ImageObject',
            url: `${SITE_ORIGIN}/favicon.png`,
          },
        },
      };
    };

    const buildShortObjectNode = (s: ShortItem) => {
      const sTitle = (s.title || 'X Tube Viral Short').trim();
      const sDesc = (
        s.hashtags ||
        s.keywords ||
        `Watch "${sTitle}" viral Short video on X Tube Official (X Tube Shorts).`
      ).trim();
      const rawSThumb = (s.thumbnail || s.thumbnailUrl || '').trim();
      const sThumb =
        rawSThumb && !rawSThumb.includes('ibb.co') && !rawSThumb.includes('imgbb.com')
          ? rawSThumb
          : defaultImg;
      const sStream = (s.url || s.videoUrl || '').trim();
      const sWatchUrl = `${SITE_ORIGIN}/?short=${encodeURIComponent(s.id)}`;
      const sUploadIso = new Date(
        Number(s.addedAt || s.createdAt) || 1761868800000
      ).toISOString();

      return {
        '@type': 'VideoObject',
        '@id': `${sWatchUrl}#short`,
        url: sWatchUrl,
        name: `${sTitle} | X Tube Shorts`,
        description: `${sDesc} - Watch on X Tube Official.`,
        keywords: `${s.hashtags || ''}, ${s.keywords || ''}, ${BASE_KEYWORDS}`.replace(/^,\s*/, ''),
        thumbnailUrl: [sThumb],
        uploadDate: sUploadIso,
        duration: formatIsoDuration(s.duration || '00:35'),
        contentUrl: sStream,
        embedUrl: sWatchUrl,
        isFamilyFriendly: true,
        inLanguage: 'bn',
        potentialAction: {
          '@type': 'WatchAction',
          target: sWatchUrl,
        },
        interactionStatistic: {
          '@type': 'InteractionCounter',
          interactionType: { '@type': 'WatchAction' },
          userInteractionCount: Number(s.views) || 0,
        },
        publisher: {
          '@type': 'Organization',
          name: 'X Tube Official',
          alternateName: 'X Tube',
          url: SITE_ORIGIN,
          logo: {
            '@type': 'ImageObject',
            url: `${SITE_ORIGIN}/favicon.png`,
          },
        },
      };
    };

    if (viewMode === 'watch' && activeVideo) {
      const vidTitle = `${activeVideo.title} – X Tube Official`;
      const vidDesc =
        activeVideo.description ||
        activeVideo.keywords ||
        `Watch "${activeVideo.title}" in HD on X Tube (X Tube Official). Bangladeshi viral video stream.`;
      const vidKeywords = `${activeVideo.title}, ${activeVideo.keywords || ''}, ${BASE_KEYWORDS}`;
      const rawVidThumb = (activeVideo.thumbnail || activeVideo.thumbnailUrl || '').trim();
      const vidThumb =
        rawVidThumb && !rawVidThumb.includes('ibb.co') && !rawVidThumb.includes('imgbb.com')
          ? rawVidThumb
          : defaultImg;
      const vidStream = activeVideo.url || activeVideo.videoUrl || '';
      const vidPageUrl = `${SITE_ORIGIN}/?v=${encodeURIComponent(activeVideo.id)}`;

      document.title = vidTitle;
      setMetaContent('meta[name="description"]', vidDesc);
      setMetaContent('meta[name="keywords"]', vidKeywords);
      setMetaContent('meta[property="og:type"]', 'video.other');
      setMetaContent('#og-title', vidTitle);
      setMetaContent('#og-description', vidDesc);
      setMetaContent('#og-image', vidThumb);
      setMetaContent('#og-url', vidPageUrl);
      setMetaContent('#og-video', vidStream);
      setMetaContent('#og-video-secure', vidStream);
      setMetaContent('#twitter-title', vidTitle);
      setMetaContent('#twitter-description', vidDesc);
      setMetaContent('#twitter-image', vidThumb);
      if (canonicalEl) canonicalEl.setAttribute('href', vidPageUrl);

      if (jsonLdEl) {
        const singleVideoSchema = {
          '@context': 'https://schema.org',
          ...buildVideoObjectNode(activeVideo),
        };
        jsonLdEl.textContent = JSON.stringify(singleVideoSchema);
      }
    } else if (viewMode === 'shorts') {
      const currentShort =
        (activeShortId && shorts.find((s) => s.id === activeShortId)) || shorts[0] || null;
      const shortTitle = currentShort
        ? `${currentShort.title} – X Tube Shorts | X Tube Official`
        : 'X Tube Shorts – Watch Viral Short Videos & Reels | X Tube Official';
      const shortDesc = currentShort
        ? `${currentShort.title} ${currentShort.hashtags || ''} – Watch viral Short video in HD on X Tube Official.`
        : 'Watch trending Bangladeshi viral Shorts, vertical reels, and exclusive 18+ short clips on X Tube Official.';
      const shortKeywords = currentShort
        ? `${currentShort.title}, ${currentShort.hashtags || ''}, ${BASE_KEYWORDS}`
        : `X Tube Shorts, viral shorts, ${BASE_KEYWORDS}`;
      const rawShortThumb = (currentShort?.thumbnail || videos[0]?.thumbnail || '').trim();
      const shortThumb =
        rawShortThumb && !rawShortThumb.includes('ibb.co') && !rawShortThumb.includes('imgbb.com')
          ? rawShortThumb
          : defaultImg;
      const shortPageUrl = currentShort
        ? `${SITE_ORIGIN}/?short=${encodeURIComponent(currentShort.id)}`
        : `${SITE_ORIGIN}/?short=feed`;

      document.title = shortTitle;
      setMetaContent('meta[name="description"]', shortDesc);
      setMetaContent('meta[name="keywords"]', shortKeywords);
      setMetaContent('meta[property="og:type"]', 'video.other');
      setMetaContent('#og-title', shortTitle);
      setMetaContent('#og-description', shortDesc);
      setMetaContent('#og-image', shortThumb);
      setMetaContent('#og-url', shortPageUrl);
      if (currentShort?.url) {
        setMetaContent('#og-video', currentShort.url);
        setMetaContent('#og-video-secure', currentShort.url);
      }
      setMetaContent('#twitter-title', shortTitle);
      setMetaContent('#twitter-description', shortDesc);
      setMetaContent('#twitter-image', shortThumb);
      if (canonicalEl) canonicalEl.setAttribute('href', shortPageUrl);

      if (jsonLdEl) {
        const shortNodes = shorts
          .filter((s) => Boolean(s.url))
          .map((s) => buildShortObjectNode(s));
        const shortsGraph = {
          '@context': 'https://schema.org',
          '@graph': [
            ...(currentShort ? [buildShortObjectNode(currentShort)] : []),
            {
              '@type': 'ItemList',
              '@id': `${SITE_ORIGIN}/#shortslist`,
              name: 'X Tube Official Viral Shorts Feed',
              numberOfItems: shortNodes.length,
              itemListElement: shortNodes.map((node, idx) => ({
                '@type': 'ListItem',
                position: idx + 1,
                url: node.url,
                item: node,
              })),
            },
          ],
        };
        jsonLdEl.textContent = JSON.stringify(shortsGraph);
      }
    } else {
      const rawHomeThumb = (videos[0]?.thumbnail || '').trim();
      const homeThumb =
        rawHomeThumb && !rawHomeThumb.includes('ibb.co') && !rawHomeThumb.includes('imgbb.com')
          ? rawHomeThumb
          : defaultImg;
      document.title = defaultTitle;
      setMetaContent('meta[name="description"]', defaultDesc);
      setMetaContent('meta[name="keywords"]', BASE_KEYWORDS);
      setMetaContent('meta[property="og:type"]', 'website');
      setMetaContent('#og-title', defaultTitle);
      setMetaContent('#og-description', defaultDesc);
      setMetaContent('#og-image', homeThumb);
      setMetaContent('#og-url', `${SITE_ORIGIN}/`);
      if (videos[0]?.url) {
        setMetaContent('#og-video', videos[0].url);
        setMetaContent('#og-video-secure', videos[0].url);
      }
      setMetaContent('#twitter-title', defaultTitle);
      setMetaContent('#twitter-description', defaultDesc);
      setMetaContent('#twitter-image', homeThumb);
      if (canonicalEl) canonicalEl.setAttribute('href', `${SITE_ORIGIN}/`);

      if (jsonLdEl && (videos.length > 0 || shorts.length > 0)) {
        const NON_INDEXABLE_STREAMS = [
          '5_6230929087481782223.mp4',
          'VID_20261015_090110_156.mp4',
        ];
        const validVideos = videos.filter(
          (v) =>
            Boolean(v.url) &&
            !NON_INDEXABLE_STREAMS.some((bad) => (v.url || '').includes(bad))
        );
        const videoNodes = validVideos.map((v) => buildVideoObjectNode(v));
        const shortNodes = shorts
          .filter((s) => Boolean(s.url))
          .map((s) => buildShortObjectNode(s));
        const allMediaNodes = [...videoNodes, ...shortNodes];
        const featuredHomeVideo =
          videoNodes.length > 0
            ? [
                {
                  ...videoNodes[0],
                  '@id': `${SITE_ORIGIN}/#featured-video`,
                  url: `${SITE_ORIGIN}/`,
                  embedUrl: `${SITE_ORIGIN}/`,
                },
              ]
            : [];

        const multiVideoGraph = {
          '@context': 'https://schema.org',
          '@graph': [
            ...featuredHomeVideo,
            {
              '@type': 'ItemList',
              '@id': `${SITE_ORIGIN}/#videolist`,
              name: 'X Tube Official Trending & Viral Videos & Shorts',
              numberOfItems: allMediaNodes.length,
              itemListElement: allMediaNodes.map((node, idx) => ({
                '@type': 'ListItem',
                position: idx + 1,
                url: node.url,
                item: node,
              })),
            },
            ...allMediaNodes,
          ],
        };
        jsonLdEl.textContent = JSON.stringify(multiVideoGraph);
      }
    }
  }, [viewMode, activeVideo, activeShortId, videos, shorts]);

  // Helper to update browser URL with canonical /?v=<videoId> or return to clean root URL
  const syncUrlWithVideo = (videoId: string | null, replace = false) => {
    try {
      const url = new URL(window.location.href);
      url.pathname = '/';
      url.searchParams.delete('tgWebAppStartParam');
      url.searchParams.delete('startapp');
      url.searchParams.delete('short');
      url.searchParams.delete('s');
      if (videoId) {
        url.searchParams.set('v', videoId);
      } else {
        url.searchParams.delete('v');
        url.searchParams.delete('video');
        url.searchParams.delete('id');
      }
      if (replace) {
        window.history.replaceState({}, '', url.toString());
      } else {
        window.history.pushState({}, '', url.toString());
      }
    } catch {}
  };

  const syncUrlWithShort = (shortId: string | null, replace = false) => {
    try {
      const url = new URL(window.location.href);
      url.pathname = '/';
      url.searchParams.delete('v');
      url.searchParams.delete('video');
      url.searchParams.delete('id');
      url.searchParams.delete('tgWebAppStartParam');
      url.searchParams.delete('startapp');
      if (shortId) {
        url.searchParams.set('short', shortId);
      } else {
        url.searchParams.delete('short');
        url.searchParams.delete('s');
      }
      if (replace) {
        window.history.replaceState({}, '', url.toString());
      } else {
        window.history.pushState({}, '', url.toString());
      }
    } catch {}
  };

  const goHome = () => {
    userNavigatedRef.current = true;
    initialSharedResolvedRef.current = true;
    pendingSharedIdRef.current = null;
    activeVideoIdRef.current = null;
    setSharedVideoId(null);
    setActiveShortId(null);
    setActiveVideo(null);
    setHomeRefreshSeed((s) => s + 1);
    setViewMode('home');
    syncUrlWithVideo(null);
  };

  const openShortsTab = (shortId?: string) => {
    if (adBlockActive) return;
    userNavigatedRef.current = true;
    initialSharedResolvedRef.current = true;
    pendingSharedIdRef.current = null;
    activeVideoIdRef.current = null;
    setSharedVideoId(null);
    setShortsSessionSeed((s) => s + 1);
    const randomPool = shorts.length > 0 ? shorts : videos;
    const randomFallbackId =
      randomPool.length > 0
        ? randomPool[Math.floor(Math.random() * randomPool.length)]?.id || null
        : null;
    const targetId = shortId || randomFallbackId;
    setActiveShortId(targetId);
    setViewMode('shorts');
    syncUrlWithShort(targetId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Listen to browser Back / Forward buttons
  useEffect(() => {
    const handlePopState = () => {
      userNavigatedRef.current = true;
      const sId = getRequestedShortIdFromUrl(false);
      if (sId) {
        setActiveShortId(sId);
        setViewMode('shorts');
        return;
      }

      const vidId = getRequestedVideoIdFromUrl(false);
      if (vidId) {
        pendingSharedIdRef.current = vidId;
        activeVideoIdRef.current = vidId;
        setSharedVideoId(vidId);
        const found = findMatchingVideo(videos, vidId);
        if (found) {
          activeVideoIdRef.current = found.id;
          setActiveVideo(found);
          setViewMode('watch');
        }
      } else {
        pendingSharedIdRef.current = null;
        activeVideoIdRef.current = null;
        setSharedVideoId(null);
        setActiveShortId(null);
        setActiveVideo(null);
        setViewMode('home');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [videos]);

  // Auto-detect visitor country from IP if user hasn't manually picked a language
  useEffect(() => {
    const manualChoice = localStorage.getItem('bd_collection_lang_manual');
    if (manualChoice) return;

    detectCountryLanguageFromIP().then((detected) => {
      if (detected && LANGUAGES[detected]) {
        setLangCode(detected);
        localStorage.setItem('bd_collection_lang', detected);
      }
    });
  }, []);

  const handleLanguageChange = (newCode: string) => {
    if (LANGUAGES[newCode]) {
      setLangCode(newCode);
      localStorage.setItem('bd_collection_lang', newCode);
      localStorage.setItem('bd_collection_lang_manual', '1');
      if (tgProfile.isRealTelegramUser && /^[0-9]+$/.test(tgProfile.id)) {
        set(ref(db, `telegramBotSessions/${tgProfile.id}/lang`), newCode).catch(() => {});
        set(ref(db, `telegramBotSessions/${tgProfile.id}/botAuthToken`), 'xtube_tg_bot_2026').catch(
          () => {}
        );
      }
    }
  };

  // Sync Real Telegram User Profile & Preferred Language to Firebase for Broadcasts & Bot Language Sync
  useEffect(() => {
    if (!tgProfile.isRealTelegramUser || !/^[0-9]{4,20}$/.test(tgProfile.id)) return;
    const subPayload = {
      chatId: tgProfile.id,
      fullName: tgProfile.fullName,
      username: tgProfile.username,
      lang: langCode,
      lastSeen: Date.now(),
      botAuthToken: 'xtube_tg_bot_2026',
    };
    set(ref(db, `telegramBotSessions/_subscribers/${tgProfile.id}`), subPayload).catch(() => {});
    set(ref(db, `telegramBotSessions/${tgProfile.id}/lang`), langCode).catch(() => {});
    set(ref(db, `telegramBotSessions/${tgProfile.id}/chatId`), tgProfile.id).catch(() => {});
    set(ref(db, `telegramBotSessions/${tgProfile.id}/fullName`), tgProfile.fullName).catch(() => {});
    set(ref(db, `telegramBotSessions/${tgProfile.id}/username`), tgProfile.username).catch(() => {});
    set(ref(db, `telegramBotSessions/${tgProfile.id}/botAuthToken`), 'xtube_tg_bot_2026').catch(
      () => {}
    );
  }, [tgProfile.id, tgProfile.isRealTelegramUser, tgProfile.fullName, tgProfile.username, langCode]);

  // Increment view & like count atomically in Firebase RTDB (`videos/$videoId/views` & `likes`)
  const incrementVideoViews = (videoId: string) => {
    if (!videoId) return;
    const viewsRef = ref(db, `videos/${videoId}/views`);
    runTransaction(viewsRef, (currentViews) => {
      return (Number(currentViews) || 0) + 1;
    }).catch(() => {});
  };

  const incrementVideoLikes = (videoId: string) => {
    if (!videoId) return;
    const likesRef = ref(db, `videos/${videoId}/likes`);
    runTransaction(likesRef, (currentLikes) => {
      return (Number(currentLikes) || 0) + 1;
    }).catch(() => {});
  };

  // Increment Short views & likes atomically in Firebase RTDB (`shorts/$shortId/views` & `likes`)
  const incrementShortViews = (shortId: string) => {
    if (!shortId) return;
    const viewsRef = ref(db, `shorts/${shortId}/views`);
    runTransaction(viewsRef, (currentViews) => {
      return (Number(currentViews) || 0) + 1;
    }).catch(() => {});
  };

  const incrementShortLikes = (shortId: string) => {
    if (!shortId) return;
    const likesRef = ref(db, `shorts/${shortId}/likes`);
    runTransaction(likesRef, (currentLikes) => {
      return (Number(currentLikes) || 0) + 1;
    }).catch(() => {});
  };

  // Track Total Users & Live Online Users in Firebase Realtime Database (`stats/totalUsers` & `presence/$visitorId`)
  useEffect(() => {
    let visitorId = '';
    try {
      visitorId = localStorage.getItem('bd_collection_visitor_id') || '';
      if (!visitorId || !/^[a-zA-Z0-9_-]+$/.test(visitorId)) {
        visitorId = `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem('bd_collection_visitor_id', visitorId);
      }
    } catch {
      visitorId = `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    // 1. Count unique user into Firebase `stats/totalUsers` once per unique visitor
    const countedKey = 'bd_collection_user_counted_v1';
    let alreadyCounted = false;
    try {
      alreadyCounted = localStorage.getItem(countedKey) === '1';
    } catch {}

    if (!alreadyCounted) {
      const totalUsersRef = ref(db, 'stats/totalUsers');
      runTransaction(totalUsersRef, (curr) => (Number(curr) || 0) + 1)
        .then((res) => {
          if (res.committed) {
            try {
              localStorage.setItem(countedKey, '1');
            } catch {}
          }
        })
        .catch(() => {});
    }

    // 2. Count session visit into Firebase `stats/totalVisits` once per browser session
    const sessionKey = 'bd_collection_session_counted_v1';
    let sessionCounted = false;
    try {
      sessionCounted = sessionStorage.getItem(sessionKey) === '1';
    } catch {}

    if (!sessionCounted) {
      const totalVisitsRef = ref(db, 'stats/totalVisits');
      runTransaction(totalVisitsRef, (curr) => (Number(curr) || 0) + 1)
        .then((res) => {
          if (res.committed) {
            try {
              sessionStorage.setItem(sessionKey, '1');
            } catch {}
          }
        })
        .catch(() => {});
    }

    // 3. Track Live Online User Presence in Firebase `presence/$visitorId` + Server Heartbeat
    const userPresenceRef = ref(db, `presence/${visitorId}`);
    const allPresenceRef = ref(db, 'presence');
    const connectedRef = ref(db, '.info/connected');

    const writePresence = () => {
      setIsUserOnline(typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
      set(userPresenceRef, {
        online: true,
        lastSeen: Date.now(),
        tgId: tgProfile.id,
        fullName: tgProfile.fullName,
        username: tgProfile.username,
      }).catch(() => {});

      fetch('/api/visitor-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId,
          tgId: tgProfile.id,
          username: tgProfile.username,
          page: window.location.pathname + window.location.search,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && typeof data.onlineUsers === 'number' && data.onlineUsers > 0) {
            setLiveOnlineCount((prev) => Math.max(prev, data.onlineUsers));
          }
        })
        .catch(() => {});
    };

    const unsubConnected = onValue(connectedRef, (snap) => {
      const connected = snap.val() === true;
      if (connected) {
        setIsUserOnline(true);
        onDisconnect(userPresenceRef)
          .remove()
          .catch(() => {});
        writePresence();
      }
    });

    const unsubAllPresence = onValue(
      allPresenceRef,
      (snap) => {
        const val = snap.val();
        if (!val || typeof val !== 'object') {
          setLiveOnlineCount(1);
          return;
        }
        const now = Date.now();
        let activeCount = 0;
        for (const item of Object.values(val) as any[]) {
          if (item && item.online !== false && now - (Number(item.lastSeen) || now) < 180000) {
            activeCount++;
          }
        }
        setLiveOnlineCount(Math.max(1, activeCount));
      },
      () => {}
    );

    const handleBrowserOnline = () => {
      setIsUserOnline(true);
      writePresence();
    };
    const handleBrowserOffline = () => {
      setIsUserOnline(false);
    };

    window.addEventListener('online', handleBrowserOnline);
    window.addEventListener('offline', handleBrowserOffline);

    writePresence();
    const heartbeatTimer = window.setInterval(writePresence, 20000);

    const handleBeforeUnload = () => {
      remove(userPresenceRef).catch(() => {});
      try {
        navigator.sendBeacon?.(
          '/api/visitor-ping',
          new Blob([JSON.stringify({ visitorId, offline: true })], {
            type: 'application/json',
          })
        );
      } catch {}
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      unsubConnected();
      unsubAllPresence();
      window.clearInterval(heartbeatTimer);
      window.removeEventListener('online', handleBrowserOnline);
      window.removeEventListener('offline', handleBrowserOffline);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      remove(userPresenceRef).catch(() => {});
    };
  }, [tgProfile.id, tgProfile.fullName, tgProfile.username]);

  // Sync ALL Shorts from Firebase Realtime Database (`shorts`)
  useEffect(() => {
    const shortsRef = ref(db, 'shorts');

    const normalizeShortStreamUrl = (rawUrl: string, r2Key?: string): string => {
      let clean = String(rawUrl || '').trim();
      if (!clean && r2Key) {
        clean = `https://pub-56ae26091320480ca8946ab4e42a051d.r2.dev/${r2Key.replace(/^\/+/, '')}`;
      }
      if (!clean) return '';
      if (!/^https?:\/\//i.test(clean) && !clean.startsWith('/')) {
        clean = `https://${clean}`;
      }
      return clean;
    };

    const parseSingleShortEntry = (key: string, val: any): ShortItem | null => {
      if (!val || typeof val !== 'object') return null;
      const resolvedUrl = normalizeShortStreamUrl(val.url || val.videoUrl || '', val.r2Key);
      if (!resolvedUrl) return null;
      const resolvedThumb = sanitizeServerThumbnail(val.thumbnail || val.thumbnailUrl || '');
      const resolvedTime = Number(val.addedAt || val.createdAt) || Date.now();
      const resolvedHashtags =
        (val.hashtags || val.keywords || '#Shorts #BdViral #18Plus #DesiHot #ViralGirl').trim();

      return {
        id: key,
        title: val.title || '🔥 দেশি ভাইরাল শর্টস 🥵💋',
        hashtags: resolvedHashtags,
        keywords: val.keywords || resolvedHashtags,
        videoUrl: resolvedUrl,
        url: resolvedUrl,
        r2Key: val.r2Key,
        thumbnail: resolvedThumb,
        thumbnailUrl: resolvedThumb,
        duration: val.duration || '00:30',
        views: Number(val.views) || 0,
        likes: Number(val.likes) || 0,
        createdAt: resolvedTime,
        addedAt: resolvedTime,
        author: !val.author || val.author === 'Bd Collection' ? 'X Tube' : val.author,
      };
    };

    const parseShortsData = (data: any): ShortItem[] => {
      if (!data || typeof data !== 'object') return [];
      const parsed: ShortItem[] = Object.entries(data)
        .map(([key, val]: [string, any]): ShortItem | null => parseSingleShortEntry(key, val))
        .filter((item): item is ShortItem => Boolean(item));

      parsed.sort((a, b) => b.createdAt - a.createdAt);
      return parsed;
    };

    const applyShortsAndResolveUrl = (data: any) => {
      const list = parseShortsData(data);
      setShorts(list);
      const reqShort = getRequestedShortIdFromUrl(false);
      if (reqShort && reqShort !== 'feed') {
        const matched = findMatchingShort(list, reqShort);
        if (matched) {
          setActiveShortId(matched.id);
        }
      }
    };

    // Direct single-node lookup if visitor opened a shared `?short=<id>` link
    const bootShortId = getRequestedShortIdFromUrl(false);
    if (bootShortId && bootShortId !== 'feed') {
      let decodedShort = bootShortId.trim();
      try {
        decodedShort = decodeURIComponent(decodedShort).trim();
      } catch {}

      fetch(
        `https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/shorts/${encodeURIComponent(
          decodedShort
        )}.json`,
        { cache: 'no-store' }
      )
        .then((r) => (r.ok ? r.json() : null))
        .then(async (val) => {
          let entry = parseSingleShortEntry(decodedShort, val);
          if (!entry) {
            const vidRes = await fetch(
              `https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/videos/${encodeURIComponent(
                decodedShort
              )}.json`,
              { cache: 'no-store' }
            ).catch(() => null);
            const vidVal = vidRes && vidRes.ok ? await vidRes.json().catch(() => null) : null;
            entry = parseSingleShortEntry(decodedShort, vidVal);
          }
          if (entry) {
            const validEntry = entry;
            setShorts((prev) =>
              prev.some((s) => s.id === validEntry.id) ? prev : [validEntry, ...prev]
            );
            setActiveShortId(validEntry.id);
            setViewMode('shorts');
          }
        })
        .catch(() => {});
    }

    fetch('https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/shorts.json', {
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json && typeof json === 'object') {
          applyShortsAndResolveUrl(json);
        }
      })
      .catch(() => {});

    const unsubShorts = onValue(
      shortsRef,
      (snapshot) => {
        applyShortsAndResolveUrl(snapshot.val());
      },
      () => {}
    );

    return () => unsubShorts();
  }, []);

  // Sync Live Admin Notice Board (`notices`) from Firebase Realtime Database
  useEffect(() => {
    const parseNoticesData = (data: any): NoticeItem[] => {
      if (!data || typeof data !== 'object') return [];
      const list: NoticeItem[] = Object.entries(data)
        .map(([key, val]: [string, any]): NoticeItem | null => {
          if (!val || typeof val !== 'object') return null;
          const text = String(val.text || val.message || '').trim();
          if (!text || val.active === false) return null;
          return {
            id: key,
            text,
            badge: String(val.badge || '🔥 NEW UPDATE').trim(),
            videoId: val.videoId ? String(val.videoId).trim() : undefined,
            shortId: val.shortId ? String(val.shortId).trim() : undefined,
            linkText: val.linkText ? String(val.linkText).trim() : undefined,
            active: val.active !== false,
            createdAt: Number(val.createdAt || val.addedAt) || Date.now(),
          };
        })
        .filter((item): item is NoticeItem => Boolean(item));
      list.sort((a, b) => b.createdAt - a.createdAt);
      return list;
    };

    fetch(
      'https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/notices.json',
      { cache: 'no-store' }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json && typeof json === 'object') {
          setNotices(parseNoticesData(json));
        }
      })
      .catch(() => {});

    const noticesRef = ref(db, 'notices');
    const unsubNotices = onValue(
      noticesRef,
      (snapshot) => {
        setNotices(parseNoticesData(snapshot.val()));
      },
      () => {}
    );

    return () => unsubNotices();
  }, []);

  // Auto-cycle multiple active notices every 6 seconds
  useEffect(() => {
    if (notices.length <= 1) {
      setActiveNoticeIdx(0);
      return;
    }
    const timer = setInterval(() => {
      setActiveNoticeIdx((prev) => (prev + 1) % notices.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [notices.length]);

  // Sync ALL videos from Firebase Realtime Database (`video-platform-7c031`) so every Admin Panel video share link works
  useEffect(() => {
    const videosRef = ref(db, 'videos');
    let initialSharedViewCounted = false;

    const parseSingleVideoEntry = (key: string, val: any): VideoItem | null => {
      if (!val || typeof val !== 'object') return null;
      const resolvedThumb = sanitizeServerThumbnail(val.thumbnail || val.thumbnailUrl || val.thumb || '');
      const resolvedUrl = (val.url || val.videoUrl || val.streamUrl || '').trim();
      const resolvedTime = Number(val.addedAt || val.createdAt) || Date.now();
      const resolvedKeywords = val.keywords || '';

      if (!resolvedUrl) return null;

      return {
        id: key,
        rawId: typeof val.id === 'string' ? val.id : undefined,
        title: val.title || 'Untitled Video',
        description: val.description || resolvedKeywords || '',
        category: val.category || 'Viral',
        keywords: resolvedKeywords,
        videoUrl: resolvedUrl,
        url: resolvedUrl,
        r2Key: val.r2Key,
        thumbnailUrl: resolvedThumb,
        thumbnail: resolvedThumb,
        duration: val.duration || '',
        views: Number(val.views) || 0,
        likes: Number(val.likes) || 0,
        createdAt: resolvedTime,
        addedAt: resolvedTime,
        author: !val.author || val.author === 'Bd Collection' ? 'X Tube' : val.author,
      };
    };

    const applyRawVideosData = (data: any) => {
      let finalVideos: VideoItem[] = [];

      if (data && typeof data === 'object') {
        const parsed: VideoItem[] = Object.entries(data)
          .map(([key, val]: [string, any]) => parseSingleVideoEntry(key, val))
          .filter((item): item is VideoItem => Boolean(item));

        parsed.sort((a, b) => b.createdAt - a.createdAt);
        finalVideos = parsed;
      }

      setVideos(finalVideos);

      // If the user already clicked a video or navigated manually, NEVER override their activeVideo with a URL or start_param lookup!
      // Only update the currently playing video's metadata (e.g. views) in place.
      if (userNavigatedRef.current || initialSharedResolvedRef.current) {
        const currentActiveId = activeVideoIdRef.current;
        if (currentActiveId) {
          const updatedActive = finalVideos.find((item) => item.id === currentActiveId);
          if (updatedActive) {
            setActiveVideo(updatedActive);
          }
        }
        setLoadingVideos(false);
        return;
      }

      // Initial boot resolution for shared video link `?v=<videoId>` or one-time Telegram `start_param`
      const urlVidId = pendingSharedIdRef.current;
      if (urlVidId) {
        const targetVideo = findMatchingVideo(finalVideos, urlVidId);
        if (targetVideo) {
          initialSharedResolvedRef.current = true;
          pendingSharedIdRef.current = targetVideo.id;
          activeVideoIdRef.current = targetVideo.id;
          setSharedVideoId(targetVideo.id);
          setActiveVideo(targetVideo);
          if (stepGatePendingIdRef.current) {
            setStepGateVideo(targetVideo);
          }
          setViewMode('watch');
          syncUrlWithVideo(targetVideo.id, true);
          if (!initialSharedViewCounted) {
            initialSharedViewCounted = true;
            incrementVideoViews(targetVideo.id);
          }
          setLoadingVideos(false);
        } else {
          // Direct node lookup in Firebase RTDB (`videos/$id` AND fallback to `shorts/$id` + full `shorts.json` fuzzy match)
          let decodedId = urlVidId.trim();
          try {
            decodedId = decodeURIComponent(decodedId).trim();
          } catch {}

          fetch(
            `https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/videos/${encodeURIComponent(
              decodedId
            )}.json`,
            { cache: 'no-store' }
          )
            .then((r) => (r.ok ? r.json() : null))
            .then(async (singleVal) => {
              let singleVideo = parseSingleVideoEntry(decodedId, singleVal);

              // Fallback 1: Check `shorts/$decodedId` in case video was uploaded as a Short
              if (!singleVideo) {
                const shortRes = await fetch(
                  `https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/shorts/${encodeURIComponent(
                    decodedId
                  )}.json`,
                  { cache: 'no-store' }
                ).catch(() => null);
                const shortVal =
                  shortRes && shortRes.ok ? await shortRes.json().catch(() => null) : null;
                singleVideo = parseSingleVideoEntry(decodedId, shortVal);
              }

              // Fallback 2: Fuzzy underscore-insensitive match across `shorts.json`
              if (!singleVideo) {
                const allShortsRes = await fetch(
                  'https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/shorts.json',
                  { cache: 'no-store' }
                ).catch(() => null);
                const allShortsJson =
                  allShortsRes && allShortsRes.ok
                    ? await allShortsRes.json().catch(() => null)
                    : null;
                if (allShortsJson && typeof allShortsJson === 'object') {
                  const strippedTarget = decodedId.toLowerCase().replace(/_/g, '');
                  for (const [sKey, sVal] of Object.entries(allShortsJson)) {
                    if (
                      sKey.toLowerCase() === decodedId.toLowerCase() ||
                      sKey.toLowerCase().replace(/_/g, '') === strippedTarget
                    ) {
                      singleVideo = parseSingleVideoEntry(sKey, sVal);
                      if (singleVideo) break;
                    }
                  }
                }
              }

              initialSharedResolvedRef.current = true;
              if (singleVideo) {
                const resolvedVid = singleVideo;
                setVideos((prev) =>
                  prev.some((v) => v.id === resolvedVid.id) ? prev : [resolvedVid, ...prev]
                );
                pendingSharedIdRef.current = resolvedVid.id;
                activeVideoIdRef.current = resolvedVid.id;
                setSharedVideoId(resolvedVid.id);
                setActiveVideo(resolvedVid);
                if (stepGatePendingIdRef.current) {
                  setStepGateVideo(resolvedVid);
                }
                setViewMode('watch');
                syncUrlWithVideo(resolvedVid.id, true);
                if (!initialSharedViewCounted) {
                  initialSharedViewCounted = true;
                  incrementVideoViews(resolvedVid.id);
                }
              } else if (finalVideos.length > 0) {
                stepGatePendingIdRef.current = null;
                setStepGatePendingId(null);
                setStepGateVideo(null);
                setViewMode('home');
              }
            })
            .catch(() => {
              initialSharedResolvedRef.current = true;
              stepGatePendingIdRef.current = null;
              setStepGatePendingId(null);
              setStepGateVideo(null);
              if (finalVideos.length > 0) {
                setViewMode('home');
              }
            })
            .finally(() => {
              setLoadingVideos(false);
            });
        }
      } else {
        initialSharedResolvedRef.current = true;
        setLoadingVideos(false);
      }
    };

    // Fast HTTP JSON fetch with no-store so newly published Admin Panel videos are immediately available
    fetch('https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/videos.json', {
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json && typeof json === 'object') {
          applyRawVideosData(json);
        }
      })
      .catch(() => {});

    const unsubscribe = onValue(
      videosRef,
      (snapshot) => {
        applyRawVideosData(snapshot.val());
      },
      () => {
        setLoadingVideos(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Record user watch or like signal into the YouTube Recommendation Algorithm Profile
  const recordAlgorithmInteraction = (
    item: {
      id: string;
      title?: string;
      keywords?: string;
      hashtags?: string;
      description?: string;
      category?: string;
    },
    signalType: 'watch' | 'like'
  ) => {
    if (!item || !item.id) return;
    const weight = signalType === 'like' ? 5 : 2;
    const tokens = extractContentTokens(item);
    const cat = (item.category || '').trim().toLowerCase();

    setTasteProfile((prev) => {
      const nextTags = { ...prev.tagScores };
      for (const tok of tokens) {
        nextTags[tok] = Math.min(200, (nextTags[tok] || 0) + weight);
      }

      const nextCats = { ...prev.categoryScores };
      if (cat) {
        nextCats[cat] = Math.min(200, (nextCats[cat] || 0) + weight * 1.5);
      }

      const prevWatch = prev.watchedHistory[item.id];
      const nextWatched = {
        ...prev.watchedHistory,
        [item.id]: {
          count: (prevWatch?.count || 0) + (signalType === 'watch' ? 1 : 0),
          lastAt: Date.now(),
        },
      };

      const nextLiked =
        signalType === 'like'
          ? { ...prev.likedHistory, [item.id]: Date.now() }
          : prev.likedHistory;

      const updated: UserTasteProfile = {
        tagScores: nextTags,
        categoryScores: nextCats,
        watchedHistory: nextWatched,
        likedHistory: nextLiked,
      };

      try {
        localStorage.setItem(ALGO_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });

    setProfileRevision((r) => r + 1);
  };

  // Opens the 3-Step Smartlink Verification Screen (Step 1 -> Step 2 -> Step 3, 20s each in Mini WebView)
  // No popup/redirect ads trigger on click; once Step 3 completes, the video plays immediately!
  const startVideoStepVerification = (video: VideoItem) => {
    if ((!isAdFree && adBlockActive) || !video) return;

    userNavigatedRef.current = true;
    initialSharedResolvedRef.current = true;
    pendingSharedIdRef.current = video.id;
    activeVideoIdRef.current = video.id;
    setActiveVideo(video);
    setSharedVideoId(video.id);
    setActiveShortId(null);
    syncUrlWithVideo(video.id);

    if (isAdFree || unlockedVideos[video.id]) {
      stepGatePendingIdRef.current = null;
      setStepGatePendingId(null);
      setStepGateVideo(null);
      setViewMode('watch');
      incrementVideoViews(video.id);
      recordAlgorithmInteraction(video, 'watch');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    stepGatePendingIdRef.current = video.id;
    setStepGatePendingId(video.id);
    setStepGateVideo(video);
    setCurrentStep(1);
    setStepTimer(STEP_DURATION_SECONDS);
    setWebviewReloadKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCompleteCurrentStep = () => {
    if (stepTimer > 0) return;
    if (currentStep === 1) {
      setCurrentStep(2);
      setStepTimer(STEP_DURATION_SECONDS);
      setWebviewReloadKey((k) => k + 1);
      return;
    }
    if (currentStep === 2) {
      setCurrentStep(3);
      setStepTimer(STEP_DURATION_SECONDS);
      setWebviewReloadKey((k) => k + 1);
      return;
    }
    // Step 3 completed -> Unlock and play the video!
    const target =
      stepGateVideo ||
      (stepGatePendingId ? findMatchingVideo(videos, stepGatePendingId) : null) ||
      activeVideo;

    stepGatePendingIdRef.current = null;
    setStepGatePendingId(null);
    setStepGateVideo(null);

    if (target) {
      setUnlockedVideos((prev) => ({ ...prev, [target.id]: true }));
      activeVideoIdRef.current = target.id;
      setActiveVideo(target);
      setViewMode('watch');
      syncUrlWithVideo(target.id);
      incrementVideoViews(target.id);
      recordAlgorithmInteraction(target, 'watch');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleVideoCardClick = (video: VideoItem) => {
    startVideoStepVerification(video);
  };

  const handleVideoPlaySuccess = (video: VideoItem) => {
    incrementVideoViews(video.id);
    recordAlgorithmInteraction(video, 'watch');
  };

  // Handle clicking on a Notice Board item (opens linked Video, Short, or latest uploaded Video)
  const handleNoticeAction = (notice: NoticeItem) => {
    if (!notice) return;
    if (notice.shortId) {
      openShortsTab(notice.shortId);
      return;
    }
    if (notice.videoId) {
      const targetVid = findMatchingVideo(videos, notice.videoId);
      if (targetVid) {
        startVideoStepVerification(targetVid);
        return;
      }
    }
    if (videos.length > 0) {
      startVideoStepVerification(videos[0]);
    }
  };

  // Build and copy direct shareable link for the active video (`https://<origin>/?v=<videoId>`)
  const handleShareVideo = async (video: VideoItem) => {
    const shareUrl = buildVideoShareLink(video.id);
    pendingSharedIdRef.current = video.id;
    activeVideoIdRef.current = video.id;
    syncUrlWithVideo(video.id);
    await copyTextToClipboard(shareUrl);
    setCopiedShare(true);
    setTimeout(() => setCopiedShare(false), 2000);
  };

  // Triggered when user clicks "Trending" — ranks videos by YouTube Trending Velocity + user interest
  const handleSelectTrending = () => {
    const currentTopId =
      (sortByTrending && trendingVideos[0]?.id) || videos[0]?.id || undefined;
    const rankedTrending = [...videos].sort((a, b) => {
      const scoreB =
        computeYouTubeTrendingScore(b, tasteProfile) + Math.random() * 18;
      const scoreA =
        computeYouTubeTrendingScore(a, tasteProfile) + Math.random() * 18;
      return scoreB - scoreA;
    });
    if (rankedTrending.length > 1 && currentTopId && rankedTrending[0].id === currentTopId) {
      [rankedTrending[0], rankedTrending[1]] = [rankedTrending[1], rankedTrending[0]];
    }
    setTrendingVideos(rankedTrending);
    setTrendingSeed((prev) => prev + 1);
    setSortByTrending(true);
    goHome();
  };

  // YouTube-Style Personalized Home & Trending Video Feed
  const filteredVideos = useMemo(() => {
    let sourceList = videos;

    if (sortByTrending) {
      if (trendingVideos.length > 0) {
        const videoMap = new Map<string, VideoItem>(videos.map((v) => [v.id, v]));
        const syncedTrending = trendingVideos
          .map((tv) => videoMap.get(tv.id))
          .filter((v): v is VideoItem => Boolean(v));
        const existingIds = new Set(syncedTrending.map((v) => v.id));
        const newOnes = videos.filter((v) => !existingIds.has(v.id));
        sourceList = [...syncedTrending, ...newOnes];
      } else {
        sourceList = [...videos].sort(
          (a, b) =>
            computeYouTubeTrendingScore(b, tasteProfile) -
            computeYouTubeTrendingScore(a, tasteProfile)
        );
      }
    } else if (videos.length > 0) {
      // Stabilized YouTube Home Feed order (updates when video count or Home refresh seed changes, never jumps during 3-click ad gate)
      if (
        homeOrderRef.current.count !== videos.length ||
        homeOrderRef.current.refreshSeed !== homeRefreshSeed ||
        homeOrderRef.current.ids.length === 0
      ) {
        const preShuffled = shuffleItemsRandomly(videos);
        const rankedHome = preShuffled.sort(
          (a, b) =>
            computeYouTubeRecommendationScore(b, tasteProfile, activeVideo) +
            Math.random() * 48 -
            (computeYouTubeRecommendationScore(a, tasteProfile, activeVideo) +
              Math.random() * 48)
        );
        homeOrderRef.current = {
          count: videos.length,
          refreshSeed: homeRefreshSeed,
          ids: rankedHome.map((v) => v.id),
        };
      }
      const videoMap = new Map<string, VideoItem>(videos.map((v) => [v.id, v]));
      const ordered = homeOrderRef.current.ids
        .map((id) => videoMap.get(id))
        .filter((v): v is VideoItem => Boolean(v));
      const inOrder = new Set(ordered.map((v) => v.id));
      const remaining = videos.filter((v) => !inOrder.has(v.id));
      sourceList = [...ordered, ...remaining];
    }

    return sourceList.filter((v) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        v.title.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q) ||
        (v.keywords || '').toLowerCase().includes(q) ||
        v.author.toLowerCase().includes(q)
      );
    });
  }, [videos, searchQuery, sortByTrending, trendingVideos, trendingSeed, homeRefreshSeed]);

  // YouTube-Style Suggested Videos ("Up Next" & "More Videos"):
  // Recommends videos similar to the currently playing `activeVideo` + the user's watched/liked history + random discovery
  const suggestedVideos = useMemo(() => {
    const currentVidId = activeVideo?.id || '__none__';
    const others = activeVideo ? videos.filter((v) => v.id !== activeVideo.id) : videos;

    if (
      suggestedOrderRef.current.forVideoId !== currentVidId ||
      suggestedOrderRef.current.count !== others.length ||
      suggestedOrderRef.current.ids.length === 0
    ) {
      const preShuffled = shuffleItemsRandomly(others);
      const rankedSuggestions = preShuffled.sort(
        (a, b) =>
          computeYouTubeRecommendationScore(b, tasteProfile, activeVideo) +
          Math.random() * 38 -
          (computeYouTubeRecommendationScore(a, tasteProfile, activeVideo) +
            Math.random() * 38)
      );
      suggestedOrderRef.current = {
        forVideoId: currentVidId,
        count: others.length,
        ids: rankedSuggestions.map((v) => v.id),
      };
      return rankedSuggestions;
    }

    const videoMap = new Map<string, VideoItem>(others.map((v) => [v.id, v]));
    const ordered = suggestedOrderRef.current.ids
      .map((id) => videoMap.get(id))
      .filter((v): v is VideoItem => Boolean(v));
    const inOrder = new Set(ordered.map((v) => v.id));
    const remaining = others.filter((v) => !inOrder.has(v.id));
    return [...ordered, ...remaining];
  }, [videos, activeVideo?.id, profileRevision]);

  // Algorithm + Random Discovery Shorts for the Home Page & Watch Page YouTube Shorts Shelf
  const recommendedHomeShorts = useMemo<ShortItem[]>(() => {
    const uploadedPool: ShortItem[] = shorts;
    const usedIds = new Set(uploadedPool.map((s) => s.id));
    const fallbackVideoShorts: ShortItem[] =
      uploadedPool.length < 10
        ? videos
            .filter((v) => !usedIds.has(v.id))
            .slice(0, Math.max(0, 12 - uploadedPool.length))
            .map((v) => ({
              id: v.id,
              title: v.title,
              hashtags: v.hashtags || '#Shorts #BdViral #18Plus #DesiHot #ViralGirl',
              keywords: v.keywords,
              videoUrl: v.videoUrl || v.url || '',
              url: v.url || v.videoUrl || '',
              r2Key: v.r2Key,
              thumbnail: v.thumbnail || v.thumbnailUrl || '',
              thumbnailUrl: v.thumbnailUrl || v.thumbnail || '',
              duration: v.duration || '00:35',
              views: v.views || 0,
              likes: v.likes || 0,
              createdAt: v.createdAt,
              addedAt: v.addedAt || v.createdAt,
              author: v.author || 'X Tube',
              isLongVideo: true,
            }))
        : [];

    const combinedPool: ShortItem[] = [...uploadedPool, ...fallbackVideoShorts];
    if (combinedPool.length === 0) return [];

    const currentVidKey = activeVideo?.id || '__home__';
    if (
      homeShortsOrderRef.current.shortCount !== shorts.length ||
      homeShortsOrderRef.current.videoCount !== videos.length ||
      homeShortsOrderRef.current.refreshSeed !== homeRefreshSeed ||
      homeShortsOrderRef.current.forVideoId !== currentVidKey ||
      homeShortsOrderRef.current.ids.length === 0
    ) {
      // Pre-shuffle with Fisher-Yates, then blend user taste score with strong random exploration
      const preShuffled = shuffleItemsRandomly(combinedPool);
      const ranked = preShuffled.sort((a, b) => {
        const scoreB =
          computeYouTubeRecommendationScore(b, tasteProfile, activeVideo) +
          Math.random() * 125;
        const scoreA =
          computeYouTubeRecommendationScore(a, tasteProfile, activeVideo) +
          Math.random() * 125;
        return scoreB - scoreA;
      });

      homeShortsOrderRef.current = {
        shortCount: shorts.length,
        videoCount: videos.length,
        refreshSeed: homeRefreshSeed,
        forVideoId: currentVidKey,
        ids: ranked.map((s) => s.id),
      };
    }

    const poolMap = new Map<string, ShortItem>(combinedPool.map((s) => [s.id, s]));
    const ordered = homeShortsOrderRef.current.ids
      .map((id) => poolMap.get(id))
      .filter((s): s is ShortItem => Boolean(s));
    const inOrder = new Set(ordered.map((s) => s.id));
    const remaining = combinedPool.filter((s) => !inOrder.has(s.id));
    return [...ordered, ...remaining];
  }, [shorts, videos, homeRefreshSeed, activeVideo?.id]);

  // Effective Shorts Feed list: Algorithm + Random ordered uploaded `shorts` + occasionally ("maje maje") interleaved long `videos`
  // Stabilized per Shorts session so view/like updates never reorder the feed while the user is scrolling
  const displayShorts = useMemo<ShortItem[]>(() => {
    const longAsShorts: ShortItem[] = videos.map((v) => ({
      id: v.id,
      title: v.title,
      hashtags: v.hashtags || '#Shorts #BdViral #18Plus #DesiHot #ViralGirl',
      keywords: v.keywords,
      videoUrl: v.videoUrl || v.url || '',
      url: v.url || v.videoUrl || '',
      r2Key: v.r2Key,
      thumbnail: v.thumbnail || v.thumbnailUrl || '',
      thumbnailUrl: v.thumbnailUrl || v.thumbnail || '',
      duration: v.duration || '02:30',
      views: v.views || 0,
      likes: v.likes || 0,
      createdAt: v.createdAt,
      addedAt: v.addedAt || v.createdAt,
      author: v.author || 'X Tube',
      isLongVideo: true,
    }));

    const allMap = new Map<string, ShortItem>();
    for (const s of shorts) {
      allMap.set(s.id, s);
    }
    for (const lv of longAsShorts) {
      if (!allMap.has(lv.id)) {
        allMap.set(lv.id, lv);
      }
    }

    if (allMap.size === 0) return [];

    if (
      shortsFeedOrderRef.current.shortCount !== shorts.length ||
      shortsFeedOrderRef.current.videoCount !== videos.length ||
      shortsFeedOrderRef.current.sessionSeed !== shortsSessionSeed ||
      shortsFeedOrderRef.current.ids.length === 0
    ) {
      const rankedUploadedShorts = shuffleItemsRandomly(shorts).sort(
        (a, b) =>
          computeYouTubeRecommendationScore(b, tasteProfile, activeVideo) +
          Math.random() * 95 -
          (computeYouTubeRecommendationScore(a, tasteProfile, activeVideo) +
            Math.random() * 95)
      );

      const usedIds = new Set(rankedUploadedShorts.map((s) => s.id));
      const availableLong = shuffleItemsRandomly(
        longAsShorts.filter((lv) => !usedIds.has(lv.id))
      ).sort(
        (a, b) =>
          computeYouTubeRecommendationScore(b, tasteProfile, activeVideo) +
          Math.random() * 85 -
          (computeYouTubeRecommendationScore(a, tasteProfile, activeVideo) +
            Math.random() * 85)
      );

      const mixedIds: string[] = [];
      let longIdx = 0;

      if (rankedUploadedShorts.length === 0) {
        availableLong.forEach((lv) => mixedIds.push(lv.id));
      } else {
        rankedUploadedShorts.forEach((s, idx) => {
          mixedIds.push(s.id);
          // Occasionally ("maje maje"): insert 1 algorithm-matched long video after every 2 uploaded Shorts
          if ((idx + 1) % 2 === 0 && longIdx < availableLong.length) {
            mixedIds.push(availableLong[longIdx].id);
            longIdx++;
          }
        });

        while (longIdx < availableLong.length) {
          mixedIds.push(availableLong[longIdx].id);
          longIdx++;
        }
      }

      shortsFeedOrderRef.current = {
        shortCount: shorts.length,
        videoCount: videos.length,
        sessionSeed: shortsSessionSeed,
        ids: mixedIds,
      };
    }

    const ordered = shortsFeedOrderRef.current.ids
      .map((id) => allMap.get(id))
      .filter((item): item is ShortItem => Boolean(item));
    const inOrder = new Set(ordered.map((i) => i.id));
    for (const [id, item] of allMap.entries()) {
      if (!inOrder.has(id)) {
        ordered.push(item);
      }
    }

    // If a specific Short was requested via `?short=<id>` or clicked, always place it at index 0
    if (activeShortId && activeShortId !== 'feed') {
      const targetShort = findMatchingShort(ordered, activeShortId);
      if (targetShort) {
        return [
          targetShort,
          ...ordered.filter((item) => item.id !== targetShort.id),
        ];
      }
    }

    return ordered;
  }, [shorts, videos, shortsSessionSeed, activeShortId]);

  const isStepGateActive = Boolean((stepGateVideo || stepGatePendingId) && !isAdFree);
  const currentSmartlinkUrl = STEP_SMARTLINKS[currentStep - 1] || STEP_SMARTLINKS[0];
  const stepProgressPercent = Math.min(
    100,
    Math.max(0, Math.round(((STEP_DURATION_SECONDS - stepTimer) / STEP_DURATION_SECONDS) * 100))
  );
  const watchedVideosCount = Object.keys(tasteProfile.watchedHistory || {}).length;

  return (
    <div
      className={`min-h-screen w-full max-w-[100vw] overflow-x-hidden pb-16 md:pb-0 ${
        isDarkMode ? 'bg-[#0b0e14] text-zinc-100' : 'bg-slate-50 text-slate-900'
      } flex flex-col ${adBlockActive ? 'h-screen overflow-hidden' : ''}`}
      dir={langCode === 'ar' || langCode === 'ur' || langCode === 'fa' ? 'rtl' : 'ltr'}
    >
      {/* Anti-AdBlocker & Anti-AdGuard DNS Full-Screen Lock Wall */}
      <AntiAdBlockGuard onBlockStateChange={setAdBlockActive} />

      {/* Social Bar Ad activates only on Shorts page */}
      <SocialBarLoader active={viewMode === 'shorts' && !isStepGateActive} />

      {/* ============================================================================
          3-STEP SMARTLINK VERIFICATION + 20S TIMER + MINI WEBVIEW SCREEN
          ============================================================================ */}
      {isStepGateActive && (
        <div className="fixed inset-0 z-50 bg-[#0b0e14] text-zinc-100 flex flex-col w-full h-full overflow-hidden">
          {/* Top Verification Header with 20s Countdown & Locked/Unlocked Next Step Button */}
          <div className="bg-[#131822] border-b border-slate-800 px-3 sm:px-5 py-2.5 sm:py-3 shrink-0 space-y-2.5 shadow-xl">
            {/* Row 1: Back Button + Target Video Title + Step 1 / 2 / 3 Indicators */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  stepGatePendingIdRef.current = null;
                  setStepGatePendingId(null);
                  setStepGateVideo(null);
                  goHome();
                }}
                className="px-2.5 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{ui.back}</span>
              </button>

              <div className="flex-1 min-w-0 px-1 text-center">
                <p className="text-xs sm:text-sm font-bold text-white truncate">
                  🎬 {stepGateVideo?.title || ui.unlockingVideo}
                </p>
              </div>

              {/* Step 1, 2, 3 Badges */}
              <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                {[1, 2, 3].map((stepNum) => {
                  const isDone = currentStep > stepNum || (currentStep === stepNum && stepTimer === 0);
                  const isCurrent = currentStep === stepNum;
                  return (
                    <div
                      key={stepNum}
                      className={`px-2 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all ${
                        isDone
                          ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-300'
                          : isCurrent
                          ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                          : 'bg-slate-800/80 border border-slate-700/70 text-slate-400'
                      }`}
                    >
                      {isDone ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                      ) : (
                        <span className="font-mono">{stepNum}</span>
                      )}
                      <span className="hidden sm:inline">
                        {ui.stepLabel} {stepNum}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Row 2: 20s Countdown Timer on Left + Locked/Unlocked Next Step CTA on Right */}
            <div className="flex items-center justify-between gap-2.5 bg-[#0b0e14] border border-slate-800/90 rounded-xl px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono text-xs font-extrabold shrink-0 ${
                    stepTimer > 0
                      ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                      : 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                  }`}
                >
                  {stepTimer > 0 ? `${stepTimer}s` : '✓'}
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-white truncate">
                    {stepTimer > 0
                      ? ui.stepRunning(currentStep, stepTimer)
                      : ui.stepCompleted(currentStep)}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {stepTimer > 0
                      ? ui.wait20SecDesc
                      : currentStep < 3
                      ? ui.clickNextStepDesc(currentStep + 1)
                      : ui.clickPlayVideoDesc}
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={stepTimer > 0}
                onClick={handleCompleteCurrentStep}
                className={`px-3.5 sm:px-5 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold flex items-center gap-1.5 shrink-0 transition-all ${
                  stepTimer > 0
                    ? 'bg-slate-800 border border-slate-700 text-slate-400 cursor-not-allowed opacity-80'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/25 cursor-pointer active:scale-95'
                }`}
              >
                {stepTimer > 0 ? (
                  <>
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {currentStep < 3
                        ? ui.nextStepLocked(stepTimer)
                        : ui.videoLocked(stepTimer)}
                    </span>
                  </>
                ) : currentStep < 3 ? (
                  <>
                    <span>{ui.nextStepBtn(currentStep + 1)}</span>
                    <ChevronRight className="w-4 h-4 shrink-0" />
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current shrink-0" />
                    <span>{ui.playVideoNow}</span>
                  </>
                )}
              </button>
            </div>

            {/* Smooth 20-Second Progress Bar */}
            <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  stepTimer === 0 ? 'bg-emerald-400' : 'bg-red-500'
                }`}
                style={{ width: `${stepProgressPercent}%` }}
              />
            </div>
          </div>

          {/* Mini WebView Iframe Screen Running Smartlink 1, 2, or 3 (URL Bar Removed) */}
          <div className="flex-1 w-full relative bg-white overflow-hidden">
            <iframe
              key={`step-webview-${currentStep}-${webviewReloadKey}`}
              src={currentSmartlinkUrl}
              title={`Step ${currentStep}`}
              className="w-full h-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
              allow="autoplay; encrypted-media; fullscreen"
            />
          </div>
        </div>
      )}

      {/* Telegram Mini App Top Navigation Bar */}
      <header className="h-14 px-2.5 sm:px-4 w-full max-w-full overflow-hidden flex items-center justify-between gap-2 sm:gap-3 bg-[#0f131c]/95 backdrop-blur-md sticky top-0 z-40 border-b border-slate-800/80">
        {/* Left: Menu + Brand Logo */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden sm:inline-flex p-2 rounded-full hover:bg-slate-800 text-zinc-200 transition-colors cursor-pointer"
            aria-label="Toggle Menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              setSortByTrending(false);
              goHome();
            }}
            className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0"
          >
            <div className="w-7 h-5 sm:w-8 sm:h-6 rounded-lg bg-red-600 flex items-center justify-center shrink-0 shadow-md shadow-red-600/30">
              <Play className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-white text-white ml-0.5" />
            </div>
            <span className="text-sm sm:text-lg font-bold tracking-tight text-white font-display">
              X Tube
            </span>
          </a>
        </div>

        {/* Center: Search Bar */}
        <div className="flex-1 min-w-0 max-w-md mx-auto">
          <div className="flex items-center w-full">
            <div className="relative flex-1 min-w-0">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (viewMode !== 'home') goHome();
                }}
                placeholder={t.searchPlaceholder}
                className="w-full min-w-0 pl-3 sm:pl-4 pr-2 sm:pr-6 py-1.5 rounded-l-full bg-[#161b26] border border-slate-800 text-xs sm:text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-slate-600"
              />
            </div>
            <button
              type="button"
              onClick={() => goHome()}
              className="px-2.5 sm:px-3.5 py-1.5 rounded-r-full bg-slate-800 hover:bg-slate-700 border border-l-0 border-slate-800 text-zinc-200 transition-colors cursor-pointer shrink-0"
              aria-label="Search"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right: Redeem Code (if enabled) + Real Telegram User Profile Pill with Live Online Indicator */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {isRedeemServiceEnabled && (
            <button
              type="button"
              onClick={() => {
                setRedeemFeedback(null);
                setRedeemModalOpen(true);
              }}
              className={`px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                isAdFree
                  ? 'bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/60 text-emerald-300'
                  : 'bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/50 text-amber-300'
              }`}
              title={ui.redeemModalTitle}
            >
              {isAdFree ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="font-mono tabular-nums text-[11px]">
                    {formatVipCountdown(remainingMs)}
                  </span>
                </>
              ) : (
                <>
                  <Ticket className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="hidden sm:inline">{ui.redeemBtn}</span>
                </>
              )}
            </button>
          )}

          {/* Telegram User Profile & Live Online Trigger */}
          <button
            type="button"
            onClick={() => setViewMode('profile')}
            className={`pl-1.5 pr-2.5 py-1 rounded-full border flex items-center gap-2 transition-all cursor-pointer ${
              viewMode === 'profile'
                ? 'bg-emerald-500/20 border-emerald-500/60 text-white'
                : 'bg-[#161b26] hover:bg-[#1c2230] border-slate-800 text-zinc-100'
            }`}
            title={ui.profile}
          >
            <div className="relative w-6 h-6 rounded-full overflow-hidden bg-slate-800 flex items-center justify-center shrink-0">
              {tgProfile.photoUrl && !avatarLoadFailed ? (
                <img
                  src={tgProfile.photoUrl}
                  alt={tgProfile.fullName}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarLoadFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-[11px] font-bold text-emerald-400">
                  {(tgProfile.fullName || 'U').charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className="text-left hidden xs:block max-w-[92px] sm:max-w-[130px]">
              <p className="text-[11px] font-bold text-white leading-tight truncate">
                {tgProfile.fullName}
              </p>
              <p className="text-[9px] font-medium text-emerald-400 leading-tight truncate">
                {isUserOnline ? `● ${ui.online} (${liveOnlineCount})` : `○ ${ui.offline}`}
              </p>
            </div>
          </button>
        </div>
      </header>

      {/* REDEEM CODE & AD-FREE VIP MODAL */}
      {isRedeemServiceEnabled && redeemModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
          onClick={() => setRedeemModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-5 sm:p-6 shadow-2xl space-y-5"
          >
            <div className="flex items-start justify-between gap-3 border-b border-zinc-800 pb-3.5">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    isAdFree
                      ? 'bg-emerald-600/20 border border-emerald-500/40 text-emerald-400'
                      : 'bg-amber-500/20 border border-amber-500/40 text-amber-400'
                  }`}
                >
                  {isAdFree ? <ShieldCheck className="w-5 h-5" /> : <Ticket className="w-5 h-5" />}
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-white leading-snug">
                    {isAdFree ? ui.vipAdFree : ui.redeemModalTitle}
                  </h2>
                  <p className="text-xs text-zinc-400">{ui.redeemModalDesc}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRedeemModalOpen(false)}
                className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isAdFree && (
              <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-700/70 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-600 text-white text-[11px] font-bold">
                    ● AD-FREE ACTIVE
                  </span>
                  <span className="text-xs font-mono text-emerald-300 font-semibold">
                    {durationLabel || 'VIP Pass'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-zinc-200 pt-1">
                  <span className="flex items-center gap-1.5 text-zinc-400">
                    <Clock className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Remaining:</span>
                  </span>
                  <span className="text-sm sm:text-base font-mono font-bold text-emerald-300 tabular-nums">
                    {formatVipCountdown(remainingMs)}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-400 font-mono flex items-center justify-between pt-1 border-t border-emerald-800/50">
                  <span>Code: {activeCode}</span>
                  <span>Expires: {new Date(expiresAt).toLocaleString()}</span>
                </div>
              </div>
            )}

            <form onSubmit={handleActivateRedeemSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-200 mb-1.5">
                  {ui.enterRedeemCode}
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={redeemInput}
                    onChange={(e) => setRedeemInput(e.target.value.toUpperCase())}
                    placeholder="VIP-XXXX-XXXX"
                    className="flex-1 px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-sm font-mono text-white uppercase placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="submit"
                    disabled={redeemLoading || !redeemInput.trim()}
                    className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-xs sm:text-sm cursor-pointer transition-colors shrink-0"
                  >
                    {redeemLoading ? t.loading : ui.activateCodeBtn}
                  </button>
                </div>
              </div>

              {redeemFeedback && (
                <div
                  className={`p-3 rounded-xl border text-xs leading-relaxed ${
                    redeemFeedback.ok
                      ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200'
                      : 'bg-red-950/60 border-red-800 text-red-200'
                  }`}
                >
                  {redeemFeedback.text}
                </div>
              )}
            </form>

            <div className="p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs sm:text-sm font-bold text-white">{ui.howToBuyRedeem}</h3>
                <span className="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 text-[10px] font-bold text-sky-300">
                  bKash / Nagad
                </span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">{ui.howToBuyRedeemDesc}</p>

              {redeemPackages.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="block text-[11px] font-semibold text-zinc-400">
                    {ui.availablePackages}
                  </span>
                  <div className="grid grid-cols-1 gap-1.5">
                    {redeemPackages.map((pkg) => (
                      <div
                        key={pkg.id}
                        className="px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-bold text-white">{pkg.name}</span>
                          <span className="text-zinc-400 ml-1.5">({pkg.durationLabel})</span>
                        </div>
                        <span className="px-2.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 font-mono font-bold text-amber-300">
                          {pkg.price}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <a
                href={`https://t.me/${(storeConfig.botUsername || 'xtubeofficial_bot').replace(/^@/, '')}?start=buy`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-sky-600/25 transition-colors"
              >
                <span>
                  {ui.buyOnTelegramBot} (@{(storeConfig.botUsername || 'xtubeofficial_bot').replace(/^@/, '')})
                </span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Main Layout */}
      <div className="flex-1 flex w-full max-w-full overflow-x-hidden">
        {/* Desktop Left Sidebar */}
        {viewMode === 'home' && sidebarOpen && (
          <aside className="hidden md:flex flex-col w-56 shrink-0 p-3 space-y-1 border-r border-slate-800/80 bg-[#0f131c]">
            <button
              type="button"
              onClick={() => {
                setSortByTrending(false);
                goHome();
              }}
              className={`w-full flex items-center gap-4 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                viewMode === 'home' && !sortByTrending
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:bg-slate-900'
              }`}
            >
              <Home className="w-5 h-5" />
              <span>{t.home}</span>
            </button>

            <button
              type="button"
              onClick={() => openShortsTab()}
              className="w-full flex items-center gap-4 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:bg-slate-900 transition-colors cursor-pointer"
            >
              <Smartphone className="w-5 h-5 text-red-500" />
              <span>{ui.shorts}</span>
            </button>

            <button
              type="button"
              onClick={handleSelectTrending}
              className={`w-full flex items-center gap-4 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                sortByTrending
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:bg-slate-900'
              }`}
            >
              <Flame className="w-5 h-5 text-red-500" />
              <span>{t.trending}</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('profile')}
              className="w-full flex items-center gap-4 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:bg-slate-900 transition-colors cursor-pointer"
            >
              <User className="w-5 h-5 text-emerald-400" />
              <span>{ui.profile}</span>
            </button>
          </aside>
        )}

        {/* Content Area */}
        <main className="flex-1 min-w-0 w-full max-w-full overflow-x-hidden">
          {/* ============================================================================
              TELEGRAM WEBAPP REAL USER PROFILE VIEW (MATCHING SCREENSHOT)
              ============================================================================ */}
          {viewMode === 'profile' && (
            <div className="max-w-xl mx-auto px-4 py-6 space-y-6">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {ui.profile}
                </h1>
                <button
                  type="button"
                  onClick={goHome}
                  className="px-3.5 py-1.5 rounded-xl bg-[#161b26] hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{ui.backToVideos}</span>
                </button>
              </div>

              {/* Main User Card matching uploaded screenshot */}
              <div className="rounded-3xl bg-[#161b24] border border-slate-800/90 p-5 sm:p-6 shadow-2xl space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    {/* User Avatar */}
                    <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden bg-slate-900 border border-slate-700/80 shrink-0 shadow-lg flex items-center justify-center">
                      {tgProfile.photoUrl && !avatarLoadFailed ? (
                        <img
                          src={tgProfile.photoUrl}
                          alt={tgProfile.fullName}
                          referrerPolicy="no-referrer"
                          onError={() => setAvatarLoadFailed(true)}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-emerald-600/30 via-slate-900 to-slate-950 flex items-center justify-center text-2xl font-extrabold text-emerald-400">
                          {(tgProfile.fullName || 'U').charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>

                    {/* Real Name, @username, TG ID & Online Status */}
                    <div className="min-w-0 space-y-1">
                      <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-wide uppercase truncate">
                        {tgProfile.fullName}
                      </h2>
                      <p className="text-sm text-slate-400 truncate">
                        @{tgProfile.username}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <span className="inline-block px-2.5 py-0.5 rounded-md bg-[#232a38] text-slate-300 text-xs font-mono">
                          TG ID: {tgProfile.id}
                        </span>
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-semibold ${
                            isUserOnline
                              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                              : 'bg-rose-500/15 border border-rose-500/30 text-rose-400'
                          }`}
                        >
                          {isUserOnline ? `● ${ui.online}` : `○ ${ui.offline}`}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Settings Icon */}
                  <div className="text-emerald-400 p-2 rounded-xl bg-emerald-500/10 shrink-0">
                    <Settings className="w-6 h-6" />
                  </div>
                </div>

                {/* Two Stat Cards Inside Profile Box (Matching Screenshot Layout) */}
                <div className="grid grid-cols-2 gap-3.5 pt-1">
                  <div className="rounded-2xl bg-[#1e2430] border border-slate-700/60 p-4 space-y-1.5">
                    <span className="block text-[11px] font-bold tracking-wider text-slate-300 uppercase">
                      {ui.onlineStatus}
                    </span>
                    <div className="text-xl sm:text-2xl font-extrabold text-emerald-400 font-mono tabular-nums uppercase">
                      {isUserOnline ? ui.online : ui.offline}
                    </div>
                    <span className="block text-[11px] text-slate-400 font-mono tabular-nums">
                      {ui.activeOnlineNow(liveOnlineCount)}
                    </span>
                  </div>

                  <div className="rounded-2xl bg-[#1e2430] border border-slate-700/60 p-4 space-y-1.5">
                    <span className="block text-[11px] font-bold tracking-wider text-slate-300 uppercase">
                      {ui.watchedVideos}
                    </span>
                    <div className="text-xl sm:text-2xl font-extrabold text-emerald-400 font-mono tabular-nums">
                      {watchedVideosCount}
                    </div>
                    <span className="block text-[11px] text-slate-400">
                      {isAdFree ? ui.vipAdFree : ui.threeStepVerified}
                    </span>
                  </div>
                </div>
              </div>

              {/* APP SETTINGS Section Matching Screenshot */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold tracking-wider text-slate-300 uppercase px-1">
                  {ui.appSettings}
                </h3>

                <div className="rounded-3xl bg-[#161b24] border border-slate-800/90 divide-y divide-slate-800/80 overflow-hidden shadow-xl">
                  {/* Language Row */}
                  <div className="p-4 sm:px-5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
                        <Globe className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm sm:text-base font-bold text-white">
                          {ui.languageLabel}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {LANGUAGES[langCode]?.name || 'English'} ({LANGUAGES[langCode]?.nativeName})
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={langCode}
                        onChange={(e) => handleLanguageChange(e.target.value)}
                        aria-label="Select Language"
                        className="bg-[#1e2430] border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-semibold text-white focus:outline-none cursor-pointer"
                      >
                        {Object.values(LANGUAGES).map((lang) => (
                          <option key={lang.code} value={lang.code} className="bg-slate-900 text-white">
                            {lang.nativeName} ({lang.name})
                          </option>
                        ))}
                      </select>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </div>

                  {/* Theme Mode Row */}
                  <div className="p-4 sm:px-5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
                        {isDarkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm sm:text-base font-bold text-white">
                          {ui.themeModeLabel}
                        </p>
                        <p className="text-xs text-slate-400 uppercase font-mono">
                          {isDarkMode ? ui.darkMode : ui.lightMode}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsDarkMode((prev) => !prev)}
                      aria-label="Toggle Theme Mode"
                      className={`w-13 h-7 rounded-full p-1 transition-colors cursor-pointer flex items-center ${
                        isDarkMode ? 'bg-emerald-500/30 justify-end' : 'bg-slate-700 justify-start'
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-full transition-transform shadow-md ${
                          isDarkMode ? 'bg-emerald-400' : 'bg-slate-300'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {viewMode === 'shorts' && (
            <ShortsFeed
              shorts={displayShorts}
              initialShortId={activeShortId}
              onBackHome={goHome}
              onWatchFullVideo={(vidId) => {
                const found = findMatchingVideo(videos, vidId);
                if (found) {
                  startVideoStepVerification(found);
                }
              }}
              onIncrementShortViews={(sid) => {
                if (shorts.some((s) => s.id === sid)) {
                  incrementShortViews(sid);
                } else {
                  incrementVideoViews(sid);
                }
              }}
              onIncrementShortLikes={(sid) => {
                if (shorts.some((s) => s.id === sid)) {
                  incrementShortLikes(sid);
                } else {
                  incrementVideoLikes(sid);
                }
              }}
              onShortWatched={(shortItem) => {
                recordAlgorithmInteraction(shortItem, 'watch');
              }}
              onShortLiked={(shortItem) => {
                recordAlgorithmInteraction(shortItem, 'like');
              }}
            />
          )}

          {viewMode === 'home' && (
            <div className="px-3 sm:px-6 py-4 space-y-5 max-w-[1600px] mx-auto w-full overflow-x-hidden">
              {/* TOP BANNER SECTION ON APP OPEN ("opre banner show korbe") */}
              <div className="space-y-3">
                <Banner320x50Ad className="my-0" />
                <NativeBannerAd className="my-0" />
              </div>

              {/* LIVE ADMIN NOTICE BOARD BANNER ON INDEX PAGE */}
              {notices.length > 0 && (() => {
                const currentNotice = notices[activeNoticeIdx % notices.length] || notices[0];
                const hasTarget = Boolean(currentNotice.videoId || currentNotice.shortId || videos.length > 0);
                return (
                  <div
                    onClick={() => handleNoticeAction(currentNotice)}
                    className={`relative w-full max-w-full overflow-hidden rounded-xl sm:rounded-2xl border border-red-500/45 bg-gradient-to-r from-red-950/80 via-zinc-900/95 to-zinc-900/95 p-2.5 sm:px-4 sm:py-3 shadow-lg transition-all ${
                      hasTarget ? 'cursor-pointer hover:border-red-500/80 active:scale-[0.99]' : ''
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 w-full">
                      <div className="flex items-center justify-between sm:justify-start gap-2 shrink-0">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md sm:rounded-lg bg-red-600 text-white text-[10px] sm:text-[11px] font-bold tracking-wide uppercase shrink-0 shadow shadow-red-600/30">
                          <Megaphone className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-bounce shrink-0" />
                          <span className="truncate max-w-[130px] sm:max-w-none">
                            {currentNotice.badge || '📢 NOTICE'}
                          </span>
                        </span>

                        <div className="flex sm:hidden items-center gap-1.5 shrink-0">
                          {notices.length > 1 && (
                            <div className="flex items-center gap-1 mr-0.5">
                              {notices.slice(0, 5).map((n, idx) => (
                                <button
                                  key={n.id}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveNoticeIdx(idx);
                                  }}
                                  className={`h-1.5 rounded-full transition-all cursor-pointer ${
                                    idx === activeNoticeIdx % notices.length
                                      ? 'w-3.5 bg-red-500'
                                      : 'w-1.5 bg-zinc-600'
                                  }`}
                                  aria-label={`Notice ${idx + 1}`}
                                />
                              ))}
                            </div>
                          )}
                          <span className="inline-flex items-center gap-0.5 px-2.5 py-1 rounded-lg bg-red-600/25 border border-red-500/50 text-red-200 text-[11px] font-bold whitespace-nowrap">
                            <span>
                              {currentNotice.linkText ||
                                (currentNotice.shortId ? ui.watchShorts : ui.watchNow)}
                            </span>
                            <ChevronRight className="w-3 h-3 shrink-0" />
                          </span>
                        </div>
                      </div>

                      <p className="text-xs sm:text-sm font-semibold text-zinc-100 leading-snug break-words line-clamp-2 sm:line-clamp-1 min-w-0 flex-1">
                        {currentNotice.text}
                      </p>

                      <div className="hidden sm:flex items-center gap-2 shrink-0">
                        {notices.length > 1 && (
                          <div className="flex items-center gap-1 mr-1">
                            {notices.slice(0, 6).map((n, idx) => (
                              <button
                                key={n.id}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveNoticeIdx(idx);
                                }}
                                className={`h-1.5 rounded-full transition-all cursor-pointer ${
                                  idx === activeNoticeIdx % notices.length
                                    ? 'w-4 bg-red-500'
                                    : 'w-1.5 bg-zinc-600 hover:bg-zinc-400'
                                }`}
                                aria-label={`Notice ${idx + 1}`}
                              />
                            ))}
                          </div>
                        )}
                        <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-red-600/20 hover:bg-red-600 border border-red-500/50 text-red-200 hover:text-white text-xs font-bold transition-colors whitespace-nowrap">
                          <span>
                            {currentNotice.linkText ||
                              (currentNotice.shortId ? ui.watchShorts : ui.watchNow)}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Video Grid + Suggested Shorts Shelf */}
              {loadingVideos ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <div key={n} className="space-y-3">
                      <div className="aspect-video rounded-xl bg-zinc-900 animate-pulse" />
                      <div className="flex gap-3">
                        <div className="w-9 h-9 rounded-full bg-zinc-900 animate-pulse shrink-0" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 bg-zinc-900 rounded animate-pulse w-5/6" />
                          <div className="h-3 bg-zinc-900 rounded animate-pulse w-1/2" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredVideos.length === 0 ? (
                <div className="py-20 text-center space-y-3">
                  <p className="text-sm text-zinc-400">{t.noVideos}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSortByTrending(false);
                    }}
                    className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-white cursor-pointer"
                  >
                    {t.showAll}
                  </button>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
                    {filteredVideos.slice(0, 4).map((video) => (
                      <VideoCard
                        key={video.id}
                        video={video}
                        onCardClick={handleVideoCardClick}
                        t={t}
                      />
                    ))}
                  </div>

                  {recommendedHomeShorts.length > 0 && !searchQuery.trim() && (
                    <section className="py-4 border-y border-zinc-800/80 space-y-3.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-red-600 flex items-center justify-center shadow-md shadow-red-600/30">
                            <Smartphone className="w-4 h-4 text-white" />
                          </div>
                          <div>
                            <h2 className="text-base sm:text-lg font-bold text-white leading-tight">
                              {ui.shorts}
                            </h2>
                            <p className="text-[11px] text-zinc-400">{ui.suggestedForYou}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => openShortsTab()}
                          className="px-3 py-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-red-400 hover:text-red-300 cursor-pointer transition-colors"
                        >
                          {ui.viewAllShorts}
                        </button>
                      </div>

                      <div className="flex gap-3 sm:gap-4 overflow-x-auto no-scrollbar pb-1">
                        {recommendedHomeShorts.slice(0, 10).map((s) => (
                          <div
                            key={`home-short-shelf-${s.id}`}
                            onClick={() => openShortsTab(s.id)}
                            className="group relative w-36 sm:w-44 aspect-[9/16] rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800/80 hover:border-red-500/60 shrink-0 cursor-pointer shadow-lg transition-all"
                          >
                            <ShortShelfPreview short={s} />
                            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-red-600/90 text-[10px] font-bold text-white flex items-center gap-1 shadow">
                              <Smartphone className="w-2.5 h-2.5" />
                              <span>SHORT</span>
                            </div>
                            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent flex flex-col justify-end p-2.5">
                              <p className="text-xs font-bold text-white line-clamp-2 leading-snug group-hover:text-red-300 transition-colors">
                                {s.title}
                              </p>
                              <p className="text-[10px] text-zinc-300 mt-1 tabular-nums">
                                {(s.views || 0).toLocaleString()} {t.views}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {filteredVideos.length > 4 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
                      {filteredVideos.slice(4).map((video) => (
                        <VideoCard
                          key={video.id}
                          video={video}
                          onCardClick={handleVideoCardClick}
                          t={t}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Loading state when opening a shared ?v=<videoId> link while Firebase fetches */}
          {viewMode === 'watch' && !activeVideo && loadingVideos && (
            <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 space-y-4">
                <div className="aspect-video rounded-xl bg-zinc-900 animate-pulse" />
                <div className="h-6 bg-zinc-900 rounded animate-pulse w-2/3" />
                <div className="h-10 bg-zinc-900 rounded animate-pulse w-1/3" />
              </div>
              <div className="lg:col-span-4 space-y-3">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="h-24 rounded-xl bg-zinc-900 animate-pulse" />
                ))}
              </div>
            </div>
          )}

          {/* Watch View (Plays Video After 3 Steps Complete) */}
          {viewMode === 'watch' && activeVideo && !isStepGateActive && (
            <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-4 sm:py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 w-full overflow-x-hidden">
              <div className="lg:col-span-8 space-y-4 min-w-0">
                <ProtectedVideoPlayer
                  key={activeVideo.id}
                  videoId={activeVideo.id}
                  videoUrl={activeVideo.url || activeVideo.videoUrl}
                  title={activeVideo.title}
                  poster={activeVideo.thumbnail || activeVideo.thumbnailUrl}
                  onPlaySuccess={() => handleVideoPlaySuccess(activeVideo)}
                />

                <div className="space-y-3 pt-1">
                  <h1 className="text-base sm:text-xl font-bold text-white leading-snug break-words">
                    {activeVideo.title}
                  </h1>

                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-zinc-800 text-white font-semibold flex items-center justify-center shrink-0">
                        {(activeVideo.author || 'X').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{activeVideo.author}</p>
                        <p className="text-xs text-zinc-400">
                          {activeVideo.views.toLocaleString()} {t.views}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const wasLiked = Boolean(likedVideos[activeVideo.id]);
                          setLikedVideos((prev) => ({
                            ...prev,
                            [activeVideo.id]: !wasLiked,
                          }));
                          if (!wasLiked) {
                            incrementVideoLikes(activeVideo.id);
                            recordAlgorithmInteraction(activeVideo, 'like');
                          }
                        }}
                        className={`px-3.5 sm:px-4 py-2 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                          likedVideos[activeVideo.id]
                            ? 'bg-white text-black'
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100'
                        }`}
                      >
                        <ThumbsUp className="w-4 h-4" />
                        <span>{t.like}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleShareVideo(activeVideo)}
                        className="px-3.5 sm:px-4 py-2 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Share2 className="w-4 h-4" />
                        <span>{copiedShare ? t.copied : t.share}</span>
                      </button>
                    </div>
                  </div>

                  {activeVideo.description && (
                    <div className="p-3.5 rounded-xl bg-zinc-900/90 text-sm text-zinc-300 leading-relaxed break-words">
                      <p>{activeVideo.description}</p>
                    </div>
                  )}
                </div>

                <Banner320x50Ad />
                <NativeBannerAd />

                {recommendedHomeShorts.length > 0 && (
                  <div className="pt-3 pb-2 border-y border-zinc-800/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-red-600 flex items-center justify-center">
                          <Smartphone className="w-3.5 h-3.5 text-white" />
                        </div>
                        <span className="text-sm font-bold text-white">
                          {ui.shorts} · {ui.suggestedForYou}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openShortsTab()}
                        className="text-xs font-semibold text-red-400 hover:text-red-300 cursor-pointer"
                      >
                        {ui.viewAllShorts}
                      </button>
                    </div>
                    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                      {recommendedHomeShorts.slice(0, 8).map((s) => (
                        <div
                          key={`watch-short-${s.id}`}
                          onClick={() => openShortsTab(s.id)}
                          className="group relative w-32 sm:w-36 aspect-[9/16] rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-red-500/60 shrink-0 cursor-pointer shadow-md"
                        >
                          <ShortShelfPreview short={s} />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent flex flex-col justify-end p-2">
                            <p className="text-[11px] font-bold text-white line-clamp-2 leading-snug">
                              {s.title}
                            </p>
                            <p className="text-[10px] text-zinc-300 mt-0.5 tabular-nums">
                              {(s.views || 0).toLocaleString()} {t.views}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-4 space-y-4">
                  <h2 className="text-base font-semibold text-white">{t.moreVideos}</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {suggestedVideos.map((video) => (
                      <VideoCard
                        key={video.id}
                        video={video}
                        onCardClick={handleVideoCardClick}
                        t={t}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-4 space-y-4 min-w-0">
                <Banner320x50Ad className="my-0" />
                <h3 className="text-sm font-semibold text-zinc-200 px-1">{t.upNext}</h3>
                <div className="space-y-2">
                  {suggestedVideos.map((video) => (
                    <VideoCard
                      key={`side-${video.id}`}
                      video={video}
                      compact
                      onCardClick={handleVideoCardClick}
                      t={t}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Crawlable SEO Index for Googlebot */}
          <footer className="sr-only" aria-label="X Tube Official Video and Shorts Directory">
            <h2>X Tube Official – Watch Bangladeshi Viral Videos, Shorts &amp; Exclusive HD Streams</h2>
            <p>
              X Tube, X tube official, xxx, xtube, x tube video, x tube shorts, Bangladeshi viral video,
              bd viral link, বাংলা ভাইরাল ভিডিও, নতুন ভাইরাল ভিডিও, desi viral video, viral short video,
              18+ viral video, room date viral, trending shorts, x tube hd.
            </p>
            <nav aria-label="X Tube Sitemap Links">
              <a href="/sitemap.xml">X Tube Sitemap</a>
              <a href="/sitemap-videos.xml">X Tube Videos Sitemap</a>
              <a href="/sitemap-shorts.xml">X Tube Shorts Sitemap</a>
              <a href="/?short=feed">X Tube Viral Shorts Feed</a>
              {videos.map((v) => (
                <a key={`seo-vid-${v.id}`} href={`/?v=${encodeURIComponent(v.id)}`}>
                  {v.title} - X Tube Official Video
                </a>
              ))}
              {shorts.map((s) => (
                <a key={`seo-short-${s.id}`} href={`/?short=${encodeURIComponent(s.id)}`}>
                  {s.title} {s.hashtags} - X Tube Official Short
                </a>
              ))}
            </nav>
          </footer>
        </main>
      </div>

      {/* Fixed Bottom Telegram Mini App Tab Bar (Mobile & Telegram WebView) */}
      {!isStepGateActive && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-15 bg-[#0f131c]/95 backdrop-blur-md border-t border-slate-800/90 grid grid-cols-4 items-center px-2">
          <button
            type="button"
            onClick={() => {
              setSortByTrending(false);
              goHome();
            }}
            className={`flex flex-col items-center justify-center py-1.5 cursor-pointer transition-colors ${
              viewMode === 'home' && !sortByTrending ? 'text-red-500' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[10px] font-semibold mt-0.5">{t.home}</span>
          </button>

          <button
            type="button"
            onClick={() => openShortsTab()}
            className={`flex flex-col items-center justify-center py-1.5 cursor-pointer transition-colors ${
              viewMode === 'shorts' ? 'text-red-500' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-5 h-5" />
            <span className="text-[10px] font-semibold mt-0.5">{ui.shorts}</span>
          </button>

          <button
            type="button"
            onClick={handleSelectTrending}
            className={`flex flex-col items-center justify-center py-1.5 cursor-pointer transition-colors ${
              viewMode === 'home' && sortByTrending ? 'text-red-500' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Flame className="w-5 h-5" />
            <span className="text-[10px] font-semibold mt-0.5">{t.trending}</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('profile')}
            className={`flex flex-col items-center justify-center py-1.5 cursor-pointer transition-colors ${
              viewMode === 'profile' ? 'text-emerald-400' : 'text-slate-400 hover:text-white'
            }`}
          >
            <User className="w-5 h-5" />
            <span className="text-[10px] font-semibold mt-0.5">{ui.profile}</span>
          </button>
        </nav>
      )}
    </div>
  );
}

