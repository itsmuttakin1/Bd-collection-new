/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  db,
  ref,
  onValue,
  runTransaction,
  VideoItem,
} from './firebase';
import {
  NativeBannerAd,
  Banner320x50Ad,
  SocialBarLoader,
  triggerSmartlinkAd,
} from './components/AdUnits';
import { ProtectedVideoPlayer } from './components/ProtectedVideoPlayer';
import { VideoCard } from './components/VideoCard';
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
} from 'lucide-react';

type ViewMode = 'home' | 'watch';

export default function App() {
  // Read `?v=<videoId>` from URL if someone opened a shared video link
  const [sharedVideoId, setSharedVideoId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('v');
  });

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('v') ? 'watch' : 'home';
  });
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loadingVideos, setLoadingVideos] = useState<boolean>(true);
  const [activeVideo, setActiveVideo] = useState<VideoItem | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
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
        const validVideos = videos.filter((v) => Boolean(v.url && v.thumbnail));
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

  // Helper to update browser URL with ?v=<videoId> or return to clean root URL
  const syncUrlWithVideo = (videoId: string | null) => {
    try {
      const url = new URL(window.location.href);
      if (videoId) {
        url.searchParams.set('v', videoId);
      } else {
        url.searchParams.delete('v');
      }
      window.history.pushState({}, '', url.toString());
    } catch {}
  };

  const goHome = () => {
    setViewMode('home');
    setSharedVideoId(null);
    syncUrlWithVideo(null);
  };

  // Listen to browser Back / Forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const vidId = params.get('v');
      if (vidId) {
        setSharedVideoId(vidId);
        const found = videos.find((item) => item.id === vidId);
        if (found) {
          setActiveVideo(found);
          setViewMode('watch');
        }
      } else {
        setSharedVideoId(null);
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

  // Increment view count atomically in Firebase RTDB (`videos/$videoId/views`)
  const incrementVideoViews = (videoId: string) => {
    if (!videoId) return;
    const viewsRef = ref(db, `videos/${videoId}/views`);
    runTransaction(viewsRef, (currentViews) => {
      return (Number(currentViews) || 0) + 1;
    }).catch(() => {});
  };

  // Sync videos from Firebase Realtime Database (`video-platform-7c031`) + Immediate REST fetch for Googlebot SEO
  useEffect(() => {
    const videosRef = ref(db, 'videos');
    let initialSharedViewCounted = false;
    const BROKEN_404_FILES = [
      '5_6230929087481782223.mp4',
      'VID_20261015_090110_156.mp4',
    ];

    const applyRawVideosData = (data: any) => {
      let finalVideos: VideoItem[] = [];

      if (data && typeof data === 'object') {
        const parsed: VideoItem[] = Object.entries(data)
          .map(([key, val]: [string, any]) => {
            if (!val || typeof val !== 'object') return null;
            const resolvedThumb = (val.thumbnail || val.thumbnailUrl || val.thumb || '').trim();
            const resolvedUrl = (val.url || val.videoUrl || val.streamUrl || '').trim();
            const resolvedTime = Number(val.addedAt || val.createdAt) || Date.now();
            const resolvedKeywords = val.keywords || '';

            if (
              !resolvedUrl ||
              BROKEN_404_FILES.some((broken) => resolvedUrl.includes(broken))
            ) {
              return null;
            }

            return {
              id: key,
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
              createdAt: resolvedTime,
              addedAt: resolvedTime,
              author: val.author || 'Bd Collection',
            };
          })
          .filter((item): item is VideoItem => Boolean(item));

        parsed.sort((a, b) => b.createdAt - a.createdAt);
        finalVideos = parsed;
      }

      setVideos(finalVideos);

      // Check if visitor or Googlebot arrived via a shared video link `?v=<videoId>`
      const params = new URLSearchParams(window.location.search);
      const urlVidId = params.get('v');
      if (urlVidId) {
        const targetVideo = finalVideos.find((item) => item.id === urlVidId);
        if (targetVideo) {
          setActiveVideo(targetVideo);
          setViewMode('watch');
          if (!initialSharedViewCounted) {
            initialSharedViewCounted = true;
            incrementVideoViews(targetVideo.id);
          }
        } else {
          setViewMode('home');
        }
      } else {
        setActiveVideo((prev) => {
          if (!prev) return null;
          const updated = finalVideos.find((item) => item.id === prev.id);
          return updated || prev;
        });
      }

      setLoadingVideos(false);
    };

    // Fast HTTP JSON fetch so Googlebot renderer gets all videos immediately without waiting for WebSocket
    fetch('https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/videos.json')
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
  const handleVideoCardClick = (video: VideoItem) => {
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

    setActiveVideo(video);
    setSharedVideoId(video.id);
    setViewMode('watch');
    syncUrlWithVideo(video.id);
    incrementVideoViews(video.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleVideoPlaySuccess = (video: VideoItem) => {
    incrementVideoViews(video.id);
  };

  // Build and copy direct shareable link for the active video (`https://domain/?v=<videoId>`)
  const handleShareVideo = async (video: VideoItem) => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?v=${encodeURIComponent(
      video.id
    )}`;
    syncUrlWithVideo(video.id);

    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }

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
    // Base list: if Trending is active, use the randomized trending order (synced with latest video data)
    let sourceList = videos;
    if (sortByTrending) {
      if (trendingVideos.length > 0) {
        const videoMap = new Map<string, VideoItem>(videos.map((v) => [v.id, v]));
        const syncedRandom = trendingVideos
          .map((tv) => videoMap.get(tv.id))
          .filter((v): v is VideoItem => Boolean(v));
        // Include any newly added videos that weren't in trendingVideos yet
        const existingIds = new Set(syncedRandom.map((v) => v.id));
        const newOnes = videos.filter((v) => !existingIds.has(v.id));
        sourceList = [...syncedRandom, ...newOnes];
      } else {
        sourceList = shuffleVideosRandomly(videos);
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

  const suggestedVideos = useMemo(() => {
    const others = activeVideo ? videos.filter((v) => v.id !== activeVideo.id) : videos;
    return shuffleVideosRandomly(others);
  }, [videos, activeVideo?.id]);

  return (
    <div
      className="min-h-screen bg-[#0f0f0f] text-zinc-100 flex flex-col"
      dir={langCode === 'ar' || langCode === 'ur' || langCode === 'fa' ? 'rtl' : 'ltr'}
    >
      {/* Social Bar Ad only activates on Watch page so Index strictly has ONLY the Native Banner */}
      <SocialBarLoader active={viewMode === 'watch'} />

      {/* YouTube-Style Top Navigation Bar */}
      <header className="h-14 px-4 flex items-center justify-between gap-3 bg-[#0f0f0f] sticky top-0 z-40 border-b border-zinc-900">
        {/* Left: Menu + Brand Logo */}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-200 transition-colors cursor-pointer"
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
            className="flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <div className="w-8 h-6 rounded-lg bg-red-600 flex items-center justify-center">
              <Play className="w-3.5 h-3.5 fill-white text-white ml-0.5" />
            </div>
            <span className="text-lg font-bold tracking-tight text-white font-display">
              Bd Collection
            </span>
          </a>
        </div>

        {/* Center: Search Bar */}
        <div className="flex-1 max-w-xl mx-auto">
          <div className="flex items-center w-full">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (viewMode !== 'home') goHome();
                }}
                placeholder={t.searchPlaceholder}
                className="w-full pl-4 pr-8 py-1.5 sm:py-2 rounded-l-full bg-[#121212] border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
              />
            </div>
            <button
              type="button"
              onClick={() => goHome()}
              className="px-4 sm:px-5 py-1.5 sm:py-2 rounded-r-full bg-zinc-800 hover:bg-zinc-700 border border-l-0 border-zinc-800 text-zinc-200 transition-colors cursor-pointer"
              aria-label="Search"
            >
              <Search className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Right: 34+ Languages Selector (Auto-detected by Country + Manual Switch) */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative flex items-center bg-zinc-900 border border-zinc-800 rounded-full px-2.5 py-1.5 hover:border-zinc-700 transition-colors">
            <Globe className="w-4 h-4 text-zinc-400 mr-1.5 shrink-0 pointer-events-none" />
            <select
              value={langCode}
              onChange={(e) => handleLanguageChange(e.target.value)}
              aria-label="Select Language"
              className="bg-transparent text-xs font-medium text-zinc-200 focus:outline-none cursor-pointer pr-1"
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
      <div className="flex-1 flex">
        {/* YouTube Left Sidebar (Only Home & Trending — removed Music/Vlog/Viral/Sports/Travel) */}
        {viewMode === 'home' && sidebarOpen && (
          <aside className="hidden md:flex flex-col w-52 shrink-0 p-3 space-y-1 border-r border-zinc-900/80 bg-[#0f0f0f]">
            <button
              type="button"
              onClick={() => {
                setSortByTrending(false);
                goHome();
              }}
              className={`w-full flex items-center gap-4 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                !sortByTrending
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <Home className="w-5 h-5" />
              <span>{t.home}</span>
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
        <main className="flex-1 min-w-0">
          {viewMode === 'home' && (
            <div className="px-4 sm:px-6 py-4 space-y-6 max-w-[1600px] mx-auto">
              {/* Mobile Home & Trending Bar so phone users can also tap Trending anytime */}
              <div className="flex md:hidden items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSortByTrending(false);
                    goHome();
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
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
                  onClick={handleSelectTrending}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                    sortByTrending
                      ? 'bg-zinc-800 text-white'
                      : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                  }`}
                >
                  <Flame className="w-4 h-4 text-red-500" />
                  <span>{t.trending}</span>
                </button>
              </div>

              {/* Native Banner Ad ONLY on Index */}
              <NativeBannerAd />

              {/* YouTube Video Grid (Category filter chips removed as requested) */}
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
            <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
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
            <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Primary Column: Player + Info + Below-Video Suggestions */}
              <div className="lg:col-span-8 space-y-4">
                <ProtectedVideoPlayer
                  videoId={activeVideo.id}
                  videoUrl={activeVideo.url || activeVideo.videoUrl}
                  title={activeVideo.title}
                  poster={activeVideo.thumbnail || activeVideo.thumbnailUrl}
                  onPlaySuccess={() => handleVideoPlaySuccess(activeVideo)}
                />

                {/* Video Title & Channel Bar */}
                <div className="space-y-3 pt-1">
                  <h1 className="text-lg sm:text-xl font-bold text-white leading-snug">
                    {activeVideo.title}
                  </h1>

                  <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-zinc-800/80">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-zinc-800 text-white font-semibold flex items-center justify-center">
                        {(activeVideo.author || 'B').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{activeVideo.author}</p>
                        <p className="text-xs text-zinc-400">
                          {activeVideo.views.toLocaleString()} {t.views}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setLikedVideos((prev) => ({
                            ...prev,
                            [activeVideo.id]: !prev[activeVideo.id],
                          }))
                        }
                        className={`px-4 py-2 rounded-full text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer ${
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
                        className="px-4 py-2 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer"
                      >
                        <Share2 className="w-4 h-4" />
                        <span>{copiedShare ? t.copied : t.share}</span>
                      </button>
                    </div>
                  </div>

                  {/* Description Box */}
                  {activeVideo.description && (
                    <div className="p-3.5 rounded-xl bg-zinc-900/90 text-sm text-zinc-300 leading-relaxed">
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
              <div className="lg:col-span-4 space-y-4">
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
