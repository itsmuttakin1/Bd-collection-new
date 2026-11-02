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
  buildVideoShareLink,
  buildShortShareLink,
  copyTextToClipboard,
} from './firebase';
import {
  NativeBannerAd,
  Banner320x50Ad,
  SocialBarLoader,
  AntiAdBlockGuard,
  triggerSmartlinkAd,
} from './components/AdUnits';
import { ProtectedVideoPlayer } from './components/ProtectedVideoPlayer';
import { VideoCard } from './components/VideoCard';
import { ShortsFeed } from './components/ShortsFeed';
import {
  LANGUAGES,
  detectInitialLanguage,
  detectCountryLanguageFromIP,
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
} from 'lucide-react';

type ViewMode = 'home' | 'watch' | 'shorts';

let telegramStartParamConsumed = false;

const getRequestedShortIdFromUrl = (allowTelegramStartParam = false): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('short') || params.get('s');
    if (s && s.trim()) return s.trim();

    if (allowTelegramStartParam && !telegramStartParamConsumed) {
      const startParam =
        params.get('tgWebAppStartParam') ||
        params.get('startapp') ||
        (window as any).Telegram?.WebApp?.initDataUnsafe?.start_param;
      if (typeof startParam === 'string' && startParam.trim().startsWith('short_')) {
        telegramStartParamConsumed = true;
        return startParam.trim().replace(/^short_/, '');
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
    if (v && v.trim()) return v.trim();

    // Only read Telegram start_param ONCE on initial app launch so subsequent Firebase view updates never revert to the initial video
    if (allowTelegramStartParam && !telegramStartParamConsumed) {
      const tgParam =
        params.get('tgWebAppStartParam') ||
        params.get('startapp') ||
        (window as any).Telegram?.WebApp?.initDataUnsafe?.start_param;
      if (typeof tgParam === 'string' && tgParam.trim() && !tgParam.trim().startsWith('short_')) {
        telegramStartParamConsumed = true;
        return tgParam.trim();
      }
    }

    if (window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#\/?\??/, ''));
      const hv = hashParams.get('v') || hashParams.get('video') || hashParams.get('id');
      if (hv && hv.trim()) return hv.trim();
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

  // 2. Case-insensitive ID match
  const lower = decoded.toLowerCase();
  const caseMatch = list.find(
    (v) =>
      v.id.toLowerCase() === lower ||
      (v.rawId && v.rawId.toLowerCase() === lower)
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

  // Initialize Telegram Mini App WebApp SDK if opened inside Telegram
  useEffect(() => {
    const tg = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : undefined;
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor('#050505');
      if (typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor('#050505');
    } catch {}
  }, []);

  // Sync Telegram Mini App native BackButton with Watch/Shorts vs Home view
  useEffect(() => {
    const tg = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : undefined;
    const backButton = tg?.BackButton;
    if (!backButton) return;

    const handleBack = () => {
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
      if (viewMode === 'watch' || viewMode === 'shorts') {
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
  }, [viewMode]);
  const [sortByTrending, setSortByTrending] = useState<boolean>(false);
  const [trendingSeed, setTrendingSeed] = useState<number>(0);
  const [trendingVideos, setTrendingVideos] = useState<VideoItem[]>([]);

  // Language State (34+ languages, auto-detected by Visitor Country / Timezone)
  const [langCode, setLangCode] = useState<string>(() => detectInitialLanguage());
  const t = LANGUAGES[langCode] || LANGUAGES.bn;

  // Per-video Smartlink click counter (requires 3 clicks before opening the Watch page)
  const [smartlinkCounts, setSmartlinkCounts] = useState<Record<string, number>>({});

  // Search & Like State (Supports Google SearchAction ?q= parameter)
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('q') || '';
  });
  const [likedVideos, setLikedVideos] = useState<Record<string, boolean>>({});
  const [copiedShare, setCopiedShare] = useState<boolean>(false);
  const [adBlockActive, setAdBlockActive] = useState<boolean>(false);

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

  // Dynamic Google SEO, OpenGraph, Canonical URL, and Schema.org VideoObject JSON-LD for ALL videos
  useEffect(() => {
    const SITE_ORIGIN = 'https://bdcollection.pages.dev';
    const defaultTitle = 'Bd Collection – Watch Bangladeshi Viral Videos & Trending Streams';
    const defaultDesc =
      'Watch and stream the latest Bangladeshi viral videos, trending clips, and exclusive HD entertainment on Bd Collection.';
    const defaultImg = 'https://i.ibb.co/23nQP6mb/1000012168.jpg';

    const setMetaContent = (selector: string, val: string) => {
      const el = document.querySelector(selector);
      if (el) el.setAttribute('content', val);
    };

    const canonicalEl = document.getElementById('canonical-link');
    const jsonLdEl = document.getElementById('dynamic-video-jsonld');

    const buildVideoObjectNode = (v: VideoItem) => {
      const vTitle = (v.title || 'Bd Collection Viral Video').trim();
      const vDesc = (
        v.description ||
        v.keywords ||
        `Watch "${vTitle}" in HD on Bd Collection. Bangladeshi viral video stream.`
      ).trim();
      const vThumb = (v.thumbnail || v.thumbnailUrl || defaultImg).trim();
      const vStream = (v.url || v.videoUrl || '').trim();
      const vWatchUrl = `${SITE_ORIGIN}/?v=${encodeURIComponent(v.id)}`;
      const vUploadIso = new Date(
        Number(v.addedAt || v.createdAt) || 1761868800000
      ).toISOString();

      return {
        '@type': 'VideoObject',
        '@id': `${vWatchUrl}#video`,
        url: vWatchUrl,
        name: vTitle,
        description: vDesc,
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
          name: 'Bd Collection',
          url: SITE_ORIGIN,
          logo: {
            '@type': 'ImageObject',
            url: `${SITE_ORIGIN}/favicon.png`,
          },
        },
      };
    };

    if (viewMode === 'watch' && activeVideo) {
      const vidTitle = `${activeVideo.title} – Bd Collection`;
      const vidDesc =
        activeVideo.description ||
        activeVideo.keywords ||
        `Watch "${activeVideo.title}" in HD on Bd Collection. Bangladeshi viral video stream.`;
      const vidThumb = activeVideo.thumbnail || activeVideo.thumbnailUrl || defaultImg;
      const vidStream = activeVideo.url || activeVideo.videoUrl || '';
      const vidPageUrl = `${SITE_ORIGIN}/?v=${encodeURIComponent(activeVideo.id)}`;

      document.title = vidTitle;
      setMetaContent('meta[name="description"]', vidDesc);
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
    } else {
      document.title = defaultTitle;
      setMetaContent('meta[name="description"]', defaultDesc);
      setMetaContent('meta[property="og:type"]', 'website');
      setMetaContent('#og-title', defaultTitle);
      setMetaContent('#og-description', defaultDesc);
      setMetaContent('#og-image', videos[0]?.thumbnail || defaultImg);
      setMetaContent('#og-url', `${SITE_ORIGIN}/`);
      if (videos[0]?.url) {
        setMetaContent('#og-video', videos[0].url);
        setMetaContent('#og-video-secure', videos[0].url);
      }
      setMetaContent('#twitter-title', defaultTitle);
      setMetaContent('#twitter-description', defaultDesc);
      setMetaContent('#twitter-image', videos[0]?.thumbnail || defaultImg);
      if (canonicalEl) canonicalEl.setAttribute('href', `${SITE_ORIGIN}/`);

      if (jsonLdEl && videos.length > 0) {
        const NON_INDEXABLE_STREAMS = [
          '5_6230929087481782223.mp4',
          'VID_20261015_090110_156.mp4',
        ];
        const validVideos = videos.filter(
          (v) =>
            Boolean(v.url && v.thumbnail) &&
            !NON_INDEXABLE_STREAMS.some((bad) => (v.url || '').includes(bad))
        );
        const videoNodes = validVideos.map((v) => buildVideoObjectNode(v));
        const multiVideoGraph = {
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'ItemList',
              '@id': `${SITE_ORIGIN}/#videolist`,
              name: 'Bd Collection Trending & Viral Videos',
              numberOfItems: videoNodes.length,
              itemListElement: videoNodes.map((node, idx) => ({
                '@type': 'ListItem',
                position: idx + 1,
                url: node.url,
                item: node,
              })),
            },
            ...videoNodes,
          ],
        };
        jsonLdEl.textContent = JSON.stringify(multiVideoGraph);
      }
    }
  }, [viewMode, activeVideo, videos]);

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
    const targetId = shortId || shorts[0]?.id || null;
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
    }
  };

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
    const connectedRef = ref(db, '.info/connected');

    const writePresence = () => {
      set(userPresenceRef, {
        online: true,
        lastSeen: Date.now(),
      }).catch(() => {});

      fetch('/api/visitor-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId,
          page: window.location.pathname + window.location.search,
        }),
      }).catch(() => {});
    };

    const unsubConnected = onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        onDisconnect(userPresenceRef)
          .remove()
          .catch(() => {});
        writePresence();
      }
    });

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
      window.clearInterval(heartbeatTimer);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      remove(userPresenceRef).catch(() => {});
    };
  }, []);

  // Sync ALL Shorts from Firebase Realtime Database (`shorts`)
  useEffect(() => {
    const shortsRef = ref(db, 'shorts');

    const parseShortsData = (data: any): ShortItem[] => {
      if (!data || typeof data !== 'object') return [];
      const parsed: ShortItem[] = Object.entries(data)
        .map(([key, val]: [string, any]) => {
          if (!val || typeof val !== 'object') return null;
          const resolvedUrl = (val.url || val.videoUrl || '').trim();
          if (!resolvedUrl) return null;
          const resolvedThumb = (val.thumbnail || val.thumbnailUrl || '').trim();
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
            author: val.author || 'Bd Collection',
          };
        })
        .filter((item): item is ShortItem => Boolean(item));

      parsed.sort((a, b) => b.createdAt - a.createdAt);
      return parsed;
    };

    fetch('https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/shorts.json', {
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json && typeof json === 'object') {
          setShorts(parseShortsData(json));
        }
      })
      .catch(() => {});

    const unsubShorts = onValue(
      shortsRef,
      (snapshot) => {
        setShorts(parseShortsData(snapshot.val()));
      },
      () => {}
    );

    return () => unsubShorts();
  }, []);

  // Sync ALL videos from Firebase Realtime Database (`video-platform-7c031`) so every Admin Panel video share link works
  useEffect(() => {
    const videosRef = ref(db, 'videos');
    let initialSharedViewCounted = false;

    const parseSingleVideoEntry = (key: string, val: any): VideoItem | null => {
      if (!val || typeof val !== 'object') return null;
      const resolvedThumb = (val.thumbnail || val.thumbnailUrl || val.thumb || '').trim();
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
        author: val.author || 'Bd Collection',
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
          setViewMode('watch');
          syncUrlWithVideo(targetVideo.id, true);
          if (!initialSharedViewCounted) {
            initialSharedViewCounted = true;
            incrementVideoViews(targetVideo.id);
          }
          setLoadingVideos(false);
        } else {
          // Direct node lookup in Firebase RTDB in case video was just added or key needs direct resolution
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
            .then((singleVal) => {
              initialSharedResolvedRef.current = true;
              const singleVideo = parseSingleVideoEntry(decodedId, singleVal);
              if (singleVideo) {
                setVideos((prev) =>
                  prev.some((v) => v.id === singleVideo.id) ? prev : [singleVideo, ...prev]
                );
                pendingSharedIdRef.current = singleVideo.id;
                activeVideoIdRef.current = singleVideo.id;
                setSharedVideoId(singleVideo.id);
                setActiveVideo(singleVideo);
                setViewMode('watch');
                syncUrlWithVideo(singleVideo.id, true);
                if (!initialSharedViewCounted) {
                  initialSharedViewCounted = true;
                  incrementVideoViews(singleVideo.id);
                }
              } else if (finalVideos.length > 0) {
                setViewMode('home');
              }
            })
            .catch(() => {
              initialSharedResolvedRef.current = true;
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

  // 3x Smartlink clicks on any video card before opening Watch page
  // Uses functional state updater and locks onto the exact clicked `video.id`
  const handleVideoCardClick = (video: VideoItem) => {
    if (adBlockActive || !video) return;
    const currentClicks = smartlinkCounts[video.id] || 0;

    if (currentClicks < 3) {
      const nextClicks = currentClicks + 1;
      triggerSmartlinkAd();
      setSmartlinkCounts((prev) => ({
        ...prev,
        [video.id]: nextClicks,
      }));
      if (nextClicks < 3) {
        return;
      }
    }

    userNavigatedRef.current = true;
    initialSharedResolvedRef.current = true;
    pendingSharedIdRef.current = video.id;
    activeVideoIdRef.current = video.id;
    setActiveVideo(video);
    setSharedVideoId(video.id);
    setActiveShortId(null);
    setViewMode('watch');
    syncUrlWithVideo(video.id);
    incrementVideoViews(video.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleVideoPlaySuccess = (video: VideoItem) => {
    incrementVideoViews(video.id);
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

  // Fisher-Yates shuffle that guarantees a new random video at the top every time
  const shuffleVideosRandomly = (items: VideoItem[], prevTopId?: string): VideoItem[] => {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (arr.length > 1 && prevTopId && arr[0].id === prevTopId) {
      const swapIdx = 1 + Math.floor(Math.random() * (arr.length - 1));
      [arr[0], arr[swapIdx]] = [arr[swapIdx], arr[0]];
    }
    return arr;
  };

  // Triggered every time user clicks "Trending" — brings random videos to the top each time
  const handleSelectTrending = () => {
    const currentTopId =
      (sortByTrending && trendingVideos[0]?.id) || videos[0]?.id || undefined;
    const freshlyShuffled = shuffleVideosRandomly(videos, currentTopId);
    setTrendingVideos(freshlyShuffled);
    setTrendingSeed((prev) => prev + 1);
    setSortByTrending(true);
    goHome();
  };

  const filteredVideos = useMemo(() => {
    let sourceList = videos;
    if (sortByTrending) {
      if (trendingVideos.length > 0) {
        const videoMap = new Map<string, VideoItem>(videos.map((v) => [v.id, v]));
        const syncedRandom = trendingVideos
          .map((tv) => videoMap.get(tv.id))
          .filter((v): v is VideoItem => Boolean(v));
        const existingIds = new Set(syncedRandom.map((v) => v.id));
        const newOnes = videos.filter((v) => !existingIds.has(v.id));
        sourceList = [...syncedRandom, ...newOnes];
      } else {
        sourceList = videos;
      }
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
  }, [videos, searchQuery, sortByTrending, trendingVideos, trendingSeed]);

  // Stabilized Suggested Videos order so Firebase view increments NEVER reshuffle cards while user is clicking
  const suggestedVideos = useMemo(() => {
    const currentVidId = activeVideo?.id || '__none__';
    const others = activeVideo ? videos.filter((v) => v.id !== activeVideo.id) : videos;

    if (
      suggestedOrderRef.current.forVideoId !== currentVidId ||
      suggestedOrderRef.current.count !== others.length ||
      suggestedOrderRef.current.ids.length === 0
    ) {
      const shuffled = shuffleVideosRandomly(others);
      suggestedOrderRef.current = {
        forVideoId: currentVidId,
        count: others.length,
        ids: shuffled.map((v) => v.id),
      };
      return shuffled;
    }

    const videoMap = new Map<string, VideoItem>(others.map((v) => [v.id, v]));
    const ordered = suggestedOrderRef.current.ids
      .map((id) => videoMap.get(id))
      .filter((v): v is VideoItem => Boolean(v));
    const inOrder = new Set(ordered.map((v) => v.id));
    const remaining = others.filter((v) => !inOrder.has(v.id));
    return [...ordered, ...remaining];
  }, [videos, activeVideo?.id]);

  // Effective Shorts list: shows uploaded `shorts` from Admin Panel and occasionally ("maje maje") interleaves long `videos`
  const displayShorts = useMemo<ShortItem[]>(() => {
    const longVideosAsShorts: ShortItem[] = videos.map((v) => ({
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
      author: v.author || 'Bd Collection',
      isLongVideo: true,
    }));

    if (shorts.length === 0) {
      return longVideosAsShorts;
    }

    const usedIds = new Set(shorts.map((s) => s.id));
    const availableLong = longVideosAsShorts.filter((lv) => !usedIds.has(lv.id));
    const mixed: ShortItem[] = [];
    let longIdx = 0;

    shorts.forEach((s, idx) => {
      mixed.push(s);
      // Occasionally ("maje maje"): insert 1 long video after every 2 uploaded Shorts
      if ((idx + 1) % 2 === 0 && longIdx < availableLong.length) {
        mixed.push(availableLong[longIdx]);
        longIdx++;
      }
    });

    // If there are only 1-2 uploaded Shorts, still mix in up to 3 occasional long videos after them
    while (longIdx < availableLong.length && longIdx < Math.max(3, Math.ceil(shorts.length / 2) + 2)) {
      mixed.push(availableLong[longIdx]);
      longIdx++;
    }

    return mixed;
  }, [shorts, videos]);

  return (
    <div
      className={`min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-[#0f0f0f] text-zinc-100 flex flex-col ${
        adBlockActive ? 'h-screen overflow-hidden' : ''
      }`}
      dir={langCode === 'ar' || langCode === 'ur' || langCode === 'fa' ? 'rtl' : 'ltr'}
    >
      {/* Anti-AdBlocker & Anti-AdGuard DNS Full-Screen Lock Wall */}
      <AntiAdBlockGuard onBlockStateChange={setAdBlockActive} />

      {/* Social Bar Ad activates on Watch & Shorts pages */}
      <SocialBarLoader active={viewMode === 'watch' || viewMode === 'shorts'} />

      {/* YouTube-Style Top Navigation Bar (Responsive for Telegram Mini App & Mobile) */}
      <header className="h-14 px-2.5 sm:px-4 w-full max-w-full overflow-hidden flex items-center justify-between gap-2 sm:gap-3 bg-[#0f0f0f] sticky top-0 z-40 border-b border-zinc-900">
        {/* Left: Menu + Brand Logo */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden sm:inline-flex p-2 rounded-full hover:bg-zinc-800 text-zinc-200 transition-colors cursor-pointer"
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
            <div className="w-7 h-5 sm:w-8 sm:h-6 rounded-lg bg-red-600 flex items-center justify-center shrink-0">
              <Play className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-white text-white ml-0.5" />
            </div>
            <span className="text-sm sm:text-lg font-bold tracking-tight text-white font-display">
              Bd Collection
            </span>
          </a>
        </div>

        {/* Center: Search Bar */}
        <div className="flex-1 min-w-0 max-w-xl mx-auto">
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
                className="w-full min-w-0 pl-3 sm:pl-4 pr-2 sm:pr-6 py-1.5 rounded-l-full bg-[#121212] border border-zinc-800 text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
              />
            </div>
            <button
              type="button"
              onClick={() => goHome()}
              className="px-2.5 sm:px-4 py-1.5 rounded-r-full bg-zinc-800 hover:bg-zinc-700 border border-l-0 border-zinc-800 text-zinc-200 transition-colors cursor-pointer shrink-0"
              aria-label="Search"
            >
              <Search className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>

        {/* Right: Quick Shorts Button + Language Selector */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => openShortsTab()}
            className={`px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer ${
              viewMode === 'shorts'
                ? 'bg-red-600 text-white shadow-lg shadow-red-600/30'
                : 'bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-100'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 text-red-500" />
            <span>Shorts</span>
          </button>

          <div className="relative flex items-center bg-zinc-900 border border-zinc-800 rounded-full px-2 py-1.5 hover:border-zinc-700 transition-colors">
            <Globe className="w-3.5 h-3.5 text-zinc-400 mr-1 shrink-0 pointer-events-none" />
            <select
              value={langCode}
              onChange={(e) => handleLanguageChange(e.target.value)}
              aria-label="Select Language"
              className="bg-transparent text-[11px] sm:text-xs font-medium text-zinc-200 focus:outline-none cursor-pointer max-w-[78px] sm:max-w-[130px] truncate"
            >
              {Object.values(LANGUAGES).map((lang) => (
                <option key={lang.code} value={lang.code} className="bg-zinc-900 text-white">
                  {lang.nativeName} ({lang.name})
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex w-full max-w-full overflow-x-hidden">
        {/* YouTube Left Sidebar (Home, Shorts & Trending) */}
        {viewMode === 'home' && sidebarOpen && (
          <aside className="hidden md:flex flex-col w-52 shrink-0 p-3 space-y-1 border-r border-zinc-900/80 bg-[#0f0f0f]">
            <button
              type="button"
              onClick={() => {
                setSortByTrending(false);
                goHome();
              }}
              className={`w-full flex items-center gap-4 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                viewMode === 'home' && !sortByTrending
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <Home className="w-5 h-5" />
              <span>{t.home}</span>
            </button>

            <button
              type="button"
              onClick={() => openShortsTab()}
              className="w-full flex items-center gap-4 px-3 py-2.5 rounded-xl text-sm font-medium text-zinc-300 hover:bg-zinc-900 transition-colors cursor-pointer"
            >
              <Smartphone className="w-5 h-5 text-red-500" />
              <span>Shorts</span>
            </button>

            <button
              type="button"
              onClick={handleSelectTrending}
              className={`w-full flex items-center gap-4 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                sortByTrending
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <Flame className="w-5 h-5 text-red-500" />
              <span>{t.trending}</span>
            </button>
          </aside>
        )}

        {/* Content Area */}
        <main className="flex-1 min-w-0 w-full max-w-full overflow-x-hidden">
          {viewMode === 'shorts' && (
            <ShortsFeed
              shorts={displayShorts}
              initialShortId={activeShortId}
              onBackHome={goHome}
              onWatchFullVideo={(vidId) => {
                const found = findMatchingVideo(videos, vidId);
                if (found) {
                  userNavigatedRef.current = true;
                  activeVideoIdRef.current = found.id;
                  setActiveVideo(found);
                  setViewMode('watch');
                  syncUrlWithVideo(found.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
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
            />
          )}

          {viewMode === 'home' && (
            <div className="px-3 sm:px-6 py-4 space-y-6 max-w-[1600px] mx-auto w-full overflow-x-hidden">
              {/* Mobile Home, Shorts & Trending Bar */}
              <div className="flex md:hidden items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                <button
                  type="button"
                  onClick={() => {
                    setSortByTrending(false);
                    goHome();
                  }}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 cursor-pointer ${
                    !sortByTrending
                      ? 'bg-zinc-800 text-white'
                      : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                  }`}
                >
                  <Home className="w-4 h-4" />
                  <span>{t.home}</span>
                </button>
                <button
                  type="button"
                  onClick={() => openShortsTab()}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-red-600/15 border border-red-500/30 text-red-300 hover:bg-red-600/25 transition-colors shrink-0 cursor-pointer"
                >
                  <Smartphone className="w-4 h-4 text-red-500" />
                  <span>Shorts</span>
                </button>
                <button
                  type="button"
                  onClick={handleSelectTrending}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 cursor-pointer ${
                    sortByTrending
                      ? 'bg-zinc-800 text-white'
                      : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                  }`}
                >
                  <Flame className="w-4 h-4 text-red-500" />
                  <span>{t.trending}</span>
                </button>
              </div>

              {/* Native Banner Ad on Index */}
              <NativeBannerAd />

              {/* YouTube Video Grid (Home page displays only regular videos) */}
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
                  {filteredVideos.map((video) => (
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

          {/* YouTube Watch View */}
          {viewMode === 'watch' && activeVideo && (
            <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-4 sm:py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 w-full overflow-x-hidden">
              {/* Primary Column: Player + Info + Below-Video Suggestions */}
              <div className="lg:col-span-8 space-y-4 min-w-0">
                <ProtectedVideoPlayer
                  key={activeVideo.id}
                  videoId={activeVideo.id}
                  videoUrl={activeVideo.url || activeVideo.videoUrl}
                  title={activeVideo.title}
                  poster={activeVideo.thumbnail || activeVideo.thumbnailUrl}
                  onPlaySuccess={() => handleVideoPlaySuccess(activeVideo)}
                />

                {/* Video Title & Channel Bar */}
                <div className="space-y-3 pt-1">
                  <h1 className="text-base sm:text-xl font-bold text-white leading-snug break-words">
                    {activeVideo.title}
                  </h1>

                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-zinc-800 text-white font-semibold flex items-center justify-center shrink-0">
                        {(activeVideo.author || 'B').charAt(0).toUpperCase()}
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

                  {/* Description Box */}
                  {activeVideo.description && (
                    <div className="p-3.5 rounded-xl bg-zinc-900/90 text-sm text-zinc-300 leading-relaxed break-words">
                      <p>{activeVideo.description}</p>
                    </div>
                  )}
                </div>

                {/* 320x50 Banner Ad & Native Banner below video */}
                <Banner320x50Ad />
                <NativeBannerAd />

                {/* Suggested Videos Grid directly below the video player */}
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

              {/* Right Column: Up Next Sidebar + 320x50 Banner */}
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
        </main>
      </div>
    </div>
  );
}

