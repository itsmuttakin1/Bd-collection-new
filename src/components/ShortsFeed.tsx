import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  ThumbsUp,
  Share2,
  Check,
  Eye,
  ChevronUp,
  ChevronDown,
  Flame,
  ArrowLeft,
  ExternalLink,
} from 'lucide-react';
import {
  ShortItem,
  buildShortShareLink,
  copyTextToClipboard,
} from '../firebase';
import {
  Banner320x50Ad,
  NativeBannerAd,
  triggerPopunderAd,
  triggerSmartlinkAd,
} from './AdUnits';

interface ShortsFeedProps {
  shorts: ShortItem[];
  initialShortId?: string | null;
  onBackHome: () => void;
  onWatchFullVideo?: (videoId: string) => void;
  onIncrementShortViews: (shortId: string) => void;
  onIncrementShortLikes: (shortId: string) => void;
  onShortWatched?: (short: ShortItem) => void;
  onShortLiked?: (short: ShortItem) => void;
}

type FeedSlide =
  | { type: 'short'; item: ShortItem }
  | { type: 'ad'; id: string };

const KNOWN_R2_PUBLIC_DOMAINS = [
  'https://pub-56ae26091320480ca8946ab4e42a051d.r2.dev',
  'https://pub-a89cc17745e446439972f8e3a1b3c661.r2.dev',
  'https://pub-b89fbff1088544e2a25d432417afc3b1.r2.dev',
  'https://pub-f58d47fa71fd4d4e98985fc906988f57.r2.dev',
];

const buildShortCandidateUrls = (short: ShortItem): string[] => {
  let raw = String(short.url || short.videoUrl || '').trim();
  if (!raw && short.r2Key) {
    raw = `https://pub-56ae26091320480ca8946ab4e42a051d.r2.dev/${short.r2Key.replace(/^\/+/, '')}`;
  }
  if (!raw) return [];
  if (!/^https?:\/\//i.test(raw) && !raw.startsWith('/')) {
    raw = `https://${raw}`;
  }

  // Prioritize the Shorts R2 bucket if saved with Server 1 domain on /shorts/ path
  if (raw.includes('pub-a89cc17745e446439972f8e3a1b3c661.r2.dev/shorts/')) {
    raw = raw.replace(
      'pub-a89cc17745e446439972f8e3a1b3c661.r2.dev/shorts/',
      'pub-56ae26091320480ca8946ab4e42a051d.r2.dev/shorts/'
    );
  }

  const candidates: string[] = [raw];

  try {
    const parsed = new URL(raw);
    if (parsed.hostname.endsWith('.r2.dev')) {
      const pathPart = parsed.pathname + parsed.search;
      for (const dom of KNOWN_R2_PUBLIC_DOMAINS) {
        const alt = `${dom}${pathPart}`;
        if (!candidates.includes(alt)) candidates.push(alt);
      }
      if (parsed.pathname.startsWith('/shorts/')) {
        const rootPath = parsed.pathname.replace(/^\/shorts\//, '/');
        for (const dom of KNOWN_R2_PUBLIC_DOMAINS) {
          const rootAlt = `${dom}${rootPath}${parsed.search}`;
          if (!candidates.includes(rootAlt)) candidates.push(rootAlt);
        }
      }
    }
  } catch {}

  const streamProxy = `/api/stream?url=${encodeURIComponent(raw)}`;
  if (!candidates.includes(streamProxy)) candidates.push(streamProxy);

  const transcodeProxy = `/api/stream?url=${encodeURIComponent(raw)}&transcode=1`;
  if (!candidates.includes(transcodeProxy)) candidates.push(transcodeProxy);

  return candidates;
};

export const ShortsFeed: React.FC<ShortsFeedProps> = ({
  shorts,
  initialShortId,
  onBackHome,
  onWatchFullVideo,
  onIncrementShortViews,
  onIncrementShortLikes,
  onShortWatched,
  onShortLiked,
}) => {
  // Build slides with a Sponsored Ad slide after every 2 Shorts
  const slides: FeedSlide[] = React.useMemo(() => {
    const result: FeedSlide[] = [];
    shorts.forEach((s, idx) => {
      result.push({ type: 'short', item: s });
      if ((idx + 1) % 2 === 0 && idx < shorts.length - 1) {
        result.push({ type: 'ad', id: `short-ad-${idx}` });
      }
    });
    return result;
  }, [shorts]);

  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('bd_liked_shorts_v1');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [adGateClicks, setAdGateClicks] = useState<Record<string, number>>({});
  const [unlockedMap, setUnlockedMap] = useState<Record<string, boolean>>({});
  const [playingMap, setPlayingMap] = useState<Record<string, boolean>>({});
  const [streamStages, setStreamStages] = useState<Record<string, number>>({});

  const feedContainerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const viewedIdsRef = useRef<Set<string>>(new Set());
  const likedCountedRef = useRef<Set<string>>(new Set());

  // Jump to initialShortId if opened via ?short=<id> link
  useEffect(() => {
    if (!initialShortId || slides.length === 0) return;
    const foundIdx = slides.findIndex(
      (sl) => sl.type === 'short' && sl.item.id === initialShortId
    );
    if (foundIdx >= 0) {
      setActiveIndex(foundIdx);
      const container = feedContainerRef.current;
      if (container) {
        setTimeout(() => {
          const slideEl = container.children[foundIdx] as HTMLElement | undefined;
          slideEl?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
        }, 50);
      }
    }
  }, [initialShortId, slides.length]);

  // Pause non-active videos and auto-play active Short (uploaded Shorts auto-play like YouTube; full videos play once unlocked)
  useEffect(() => {
    slides.forEach((sl, idx) => {
      if (sl.type !== 'short') return;
      const vid = videoRefs.current[sl.item.id];
      if (!vid) return;

      const isItemUnlocked = !sl.item.isLongVideo || Boolean(unlockedMap[sl.item.id]);

      if (idx === activeIndex && isItemUnlocked) {
        vid.muted = isMuted;
        const playPromise = vid.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              setPlayingMap((prev) => ({ ...prev, [sl.item.id]: true }));
              if (!viewedIdsRef.current.has(sl.item.id)) {
                viewedIdsRef.current.add(sl.item.id);
                onIncrementShortViews(sl.item.id);
                onShortWatched?.(sl.item);
              }
            })
            .catch(() => {
              vid.muted = true;
              setIsMuted(true);
              vid
                .play()
                .then(() => {
                  setPlayingMap((prev) => ({ ...prev, [sl.item.id]: true }));
                  if (!viewedIdsRef.current.has(sl.item.id)) {
                    viewedIdsRef.current.add(sl.item.id);
                    onIncrementShortViews(sl.item.id);
                    onShortWatched?.(sl.item);
                  }
                })
                .catch(() => {});
            });
        }
      } else {
        vid.pause();
        setPlayingMap((prev) => ({ ...prev, [sl.item.id]: false }));
      }
    });
  }, [activeIndex, unlockedMap, slides, streamStages]);

  const handleScroll = () => {
    const container = feedContainerRef.current;
    if (!container) return;
    const scrollTop = container.scrollTop;
    const height = container.clientHeight || 1;
    const newIdx = Math.round(scrollTop / height);
    if (newIdx !== activeIndex && newIdx >= 0 && newIdx < slides.length) {
      setActiveIndex(newIdx);
    }
  };

  const scrollToSlide = (targetIdx: number) => {
    const container = feedContainerRef.current;
    if (!container || targetIdx < 0 || targetIdx >= slides.length) return;
    const child = container.children[targetIdx] as HTMLElement | undefined;
    if (child) {
      child.scrollIntoView({ behavior: 'smooth' });
      setActiveIndex(targetIdx);
    }
  };

  // Uploaded Shorts auto-play like YouTube (no 3-click gate); interleaved Full/Long videos keep the 3-Click Ad Gate
  const handleShortTapOrUnlock = (short: ShortItem, e: React.MouseEvent) => {
    e.stopPropagation();

    const isUnlocked = !short.isLongVideo || Boolean(unlockedMap[short.id]);
    if (!isUnlocked) {
      const currentClicks = adGateClicks[short.id] || 0;
      const nextClicks = currentClicks + 1;

      triggerPopunderAd();
      if (nextClicks < 3) {
        triggerSmartlinkAd();
      }

      setAdGateClicks((prev) => ({ ...prev, [short.id]: nextClicks }));

      if (nextClicks >= 3) {
        setUnlockedMap((prev) => ({ ...prev, [short.id]: true }));
        const vid = videoRefs.current[short.id];
        if (vid) {
          vid.muted = false;
          setIsMuted(false);
          vid
            .play()
            .then(() => {
              setPlayingMap((prev) => ({ ...prev, [short.id]: true }));
              if (!viewedIdsRef.current.has(short.id)) {
                viewedIdsRef.current.add(short.id);
                onIncrementShortViews(short.id);
                onShortWatched?.(short);
              }
            })
            .catch(() => {
              vid.muted = true;
              setIsMuted(true);
              vid.play().catch(() => {});
            });
        }
      }
      return;
    }

    // Already unlocked (or uploaded Short): toggle play/pause (and unmute if it was auto-muted by browser policy)
    const vid = videoRefs.current[short.id];
    if (!vid) return;
    if (vid.paused) {
      vid.muted = false;
      setIsMuted(false);
      vid
        .play()
        .then(() => setPlayingMap((prev) => ({ ...prev, [short.id]: true })))
        .catch(() => {
          vid.muted = true;
          setIsMuted(true);
          vid.play().catch(() => {});
        });
    } else if (isMuted) {
      // First tap on a playing muted Short unmutes sound without pausing
      vid.muted = false;
      setIsMuted(false);
    } else {
      vid.pause();
      setPlayingMap((prev) => ({ ...prev, [short.id]: false }));
    }
  };

  const handleVideoStreamError = (short: ShortItem) => {
    const candidates = buildShortCandidateUrls(short);
    const currentStage = streamStages[short.id] || 0;
    if (currentStage + 1 < candidates.length) {
      const nextStage = currentStage + 1;
      setStreamStages((prev) => ({ ...prev, [short.id]: nextStage }));
    }
  };

  const getResolvedShortStreamUrl = (short: ShortItem): string => {
    const candidates = buildShortCandidateUrls(short);
    if (candidates.length === 0) return '';
    const stage = streamStages[short.id] || 0;
    return candidates[Math.min(stage, candidates.length - 1)] || candidates[0];
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    Object.values(videoRefs.current).forEach((v) => {
      if (v) v.muted = nextMuted;
    });
  };

  const handleLikeShort = (short: ShortItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const alreadyLiked = Boolean(likedMap[short.id]);
    const nextState = !alreadyLiked;
    setLikedMap((prev) => {
      const updated = { ...prev, [short.id]: nextState };
      try {
        localStorage.setItem('bd_liked_shorts_v1', JSON.stringify(updated));
      } catch {}
      return updated;
    });
    if (nextState && !likedCountedRef.current.has(short.id)) {
      likedCountedRef.current.add(short.id);
      onIncrementShortLikes(short.id);
      onShortLiked?.(short);
    }
  };

  const handleShareShort = async (short: ShortItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const link = buildShortShareLink(short.id);
    await copyTextToClipboard(link);
    setCopiedId(short.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (shorts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-4 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-red-600/20 border border-red-500/40 flex items-center justify-center text-red-500">
          <Flame className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-bold text-white">No Shorts Uploaded Yet</h2>
        <p className="text-xs text-zinc-400 max-w-md">
          Admin Panel (`/ad.html`) থেকে নতুন Shorts ভিডিও আপলোড করলে এখানে YouTube Shorts-এর মতো ভার্টিক্যাল ফিডে দেখাবে।
        </p>
        <Banner320x50Ad />
        <button
          type="button"
          onClick={onBackHome}
          className="px-5 py-2.5 rounded-full bg-red-600 hover:bg-red-500 text-xs font-semibold text-white cursor-pointer"
        >
          ← Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-full h-[calc(100dvh-3.5rem)] bg-black overflow-hidden flex flex-col items-center justify-center select-none">
      {/* Top Floating Back Button + Compact 320x50 Banner Ad */}
      <div className="w-full max-w-[440px] px-2 pt-1.5 pb-1 flex items-center justify-between gap-2 z-30 bg-black/90 border-b border-zinc-900">
        <button
          type="button"
          onClick={onBackHome}
          className="px-3 py-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-200 flex items-center gap-1.5 shrink-0 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Home</span>
        </button>

        <div className="flex items-center gap-1.5 text-xs font-bold text-white">
          <Flame className="w-4 h-4 text-red-500 fill-red-500" />
          <span>Viral Shorts</span>
          <span className="text-[11px] font-mono text-zinc-400">
            ({activeIndex + 1}/{slides.length})
          </span>
        </div>

        <button
          type="button"
          onClick={() => triggerSmartlinkAd()}
          className="px-2.5 py-1 rounded-full bg-red-600 hover:bg-red-500 text-[11px] font-bold text-white flex items-center gap-1 shrink-0 cursor-pointer"
        >
          <span>🔥 VIP 18+</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {/* Vertical Snap-Scroll Feed */}
      <div
        ref={feedContainerRef}
        onScroll={handleScroll}
        className="w-full flex-1 overflow-y-scroll snap-y snap-mandatory no-scrollbar"
      >
        {slides.map((slide, idx) => {
          if (slide.type === 'ad') {
            return (
              <div
                key={slide.id}
                className="w-full h-full snap-start snap-always flex items-center justify-center p-3 bg-zinc-950"
              >
                <div className="relative w-full max-w-[420px] h-full max-h-[820px] rounded-2xl border border-red-900/50 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black p-4 flex flex-col items-center justify-between overflow-hidden shadow-2xl">
                  <div className="w-full flex items-center justify-between border-b border-zinc-800 pb-2.5">
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-[11px] font-bold text-amber-300">
                      Sponsored · Ad
                    </span>
                    <button
                      type="button"
                      onClick={() => scrollToSlide(Math.min(slides.length - 1, idx + 1))}
                      className="text-xs text-zinc-400 hover:text-white cursor-pointer"
                    >
                      Next Short ↓
                    </button>
                  </div>

                  <div className="w-full flex-1 flex flex-col items-center justify-center gap-3 overflow-hidden my-2">
                    <Banner320x50Ad className="my-0" />
                    <NativeBannerAd className="my-1" />
                    <button
                      type="button"
                      onClick={() => {
                        triggerPopunderAd();
                        triggerSmartlinkAd();
                      }}
                      className="w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-95"
                    >
                      <span>🔥 Watch Full Uncensored VIP Video</span>
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => scrollToSlide(Math.min(slides.length - 1, idx + 1))}
                    className="w-full py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-300 cursor-pointer"
                  >
                    Swipe or Tap for Next Short ↓
                  </button>
                </div>
              </div>
            );
          }

          const short = slide.item;
          const isUnlocked = !short.isLongVideo || Boolean(unlockedMap[short.id]);
          const isPlaying = Boolean(playingMap[short.id]);
          const clicksSoFar = adGateClicks[short.id] || 0;
          const streamUrl = getResolvedShortStreamUrl(short);
          const thumbUrl = (short.thumbnail || short.thumbnailUrl || '').trim();
          const hashtagsList = (short.hashtags || short.keywords || '#Shorts #BdViral #18Plus #DesiHot')
            .split(/\s+/)
            .filter(Boolean)
            .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));

          return (
            <div
              key={short.id}
              className="w-full h-full snap-start snap-always flex items-center justify-center bg-black sm:py-2"
            >
              <div
                onClick={(e) => handleShortTapOrUnlock(short, e)}
                className="relative w-full max-w-[430px] h-full sm:rounded-2xl overflow-hidden bg-zinc-950 border-x sm:border border-zinc-900 shadow-2xl flex flex-col justify-between cursor-pointer"
              >
                {/* Blurred ambient backdrop for horizontal long videos interleaved in Shorts */}
                {short.isLongVideo && thumbUrl && (
                  <img
                    src={thumbUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover blur-2xl scale-125 opacity-45 pointer-events-none"
                  />
                )}

                {/* Video Element (Mounted for active & adjacent slides so mobile/Telegram decoders never stall) */}
                {Math.abs(idx - activeIndex) <= 1 ? (
                  <video
                    key={`${short.id}-${streamStages[short.id] || 0}`}
                    ref={(el) => {
                      videoRefs.current[short.id] = el;
                    }}
                    src={streamUrl}
                    poster={thumbUrl || 'https://bdcollection.pages.dev/favicon.png'}
                    playsInline
                    autoPlay={idx === activeIndex && !short.isLongVideo}
                    loop
                    muted={isMuted}
                    preload={idx === activeIndex ? 'auto' : 'metadata'}
                    controlsList="nodownload noplaybackrate"
                    disablePictureInPicture
                    onContextMenu={(e) => e.preventDefault()}
                    onPlay={() => setPlayingMap((prev) => ({ ...prev, [short.id]: true }))}
                    onPlaying={() => setPlayingMap((prev) => ({ ...prev, [short.id]: true }))}
                    onPause={() => setPlayingMap((prev) => ({ ...prev, [short.id]: false }))}
                    onCanPlay={(e) => {
                      if (idx === activeIndex && (!short.isLongVideo || unlockedMap[short.id])) {
                        const vid = e.currentTarget;
                        if (vid.paused) {
                          vid
                            .play()
                            .then(() => {
                              setPlayingMap((prev) => ({ ...prev, [short.id]: true }));
                              if (!viewedIdsRef.current.has(short.id)) {
                                viewedIdsRef.current.add(short.id);
                                onIncrementShortViews(short.id);
                                onShortWatched?.(short);
                              }
                            })
                            .catch(() => {
                              vid.muted = true;
                              setIsMuted(true);
                              vid.play().catch(() => {});
                            });
                        }
                      }
                    }}
                    onError={() => handleVideoStreamError(short)}
                    className={`absolute inset-0 w-full h-full ${
                      short.isLongVideo ? 'object-contain' : 'object-cover'
                    } pointer-events-none`}
                  />
                ) : (
                  thumbUrl && (
                    <img
                      src={thumbUrl}
                      alt={short.title}
                      referrerPolicy="no-referrer"
                      className={`absolute inset-0 w-full h-full ${
                        short.isLongVideo ? 'object-contain' : 'object-cover'
                      } pointer-events-none`}
                    />
                  )
                )}

                {/* Thumbnail Poster Overlay before Unlock (ONLY for interleaved Full/Long videos) */}
                {short.isLongVideo && !isUnlocked && thumbUrl && (
                  <div className="absolute inset-0 z-10 overflow-hidden bg-black pointer-events-none">
                    <img
                      src={thumbUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="absolute inset-0 w-full h-full object-cover blur-xl scale-125 opacity-60"
                    />
                    <img
                      src={thumbUrl}
                      alt={short.title}
                      referrerPolicy="no-referrer"
                      className="relative z-10 w-full h-full object-contain"
                    />
                  </div>
                )}

                {/* Center Play / 3-Click Ad Unlock Button (ONLY on interleaved Full/Long videos; uploaded Shorts have NO play button overlay and play automatically like YouTube) */}
                {short.isLongVideo && (!isUnlocked || !isPlaying) && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/35 pointer-events-none">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-red-600/95 text-white flex items-center justify-center shadow-2xl border-2 border-white/20">
                      <Play className="w-8 h-8 sm:w-10 sm:h-10 fill-white ml-1" />
                    </div>
                    {!isUnlocked && clicksSoFar > 0 && (
                      <span className="mt-2.5 px-3 py-1 rounded-full bg-black/80 border border-white/15 text-xs font-semibold text-amber-300">
                        Tap {3 - clicksSoFar} more {3 - clicksSoFar === 1 ? 'time' : 'times'} to Play Video ▶
                      </span>
                    )}
                  </div>
                )}

                {/* Right Side YouTube Shorts Action Buttons */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-2.5 bottom-28 z-30 flex flex-col items-center gap-3.5"
                >
                  {/* Like (Shows only 'Like' / 'Liked' on public website; numeric count is visible only in Admin Panel) */}
                  <button
                    type="button"
                    onClick={(e) => handleLikeShort(short, e)}
                    className="flex flex-col items-center gap-1 group cursor-pointer"
                  >
                    <div
                      className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-md border transition-all ${
                        likedMap[short.id]
                          ? 'bg-red-600 border-red-400 text-white scale-105'
                          : 'bg-black/65 border-white/15 text-white hover:bg-zinc-800/80'
                      }`}
                    >
                      <ThumbsUp className={`w-5 h-5 ${likedMap[short.id] ? 'fill-white' : ''}`} />
                    </div>
                    <span className="text-[11px] font-semibold text-white drop-shadow">
                      {likedMap[short.id] ? 'Liked' : 'Like'}
                    </span>
                  </button>

                  {/* Views */}
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-11 h-11 rounded-full bg-black/65 border border-white/15 backdrop-blur-md flex items-center justify-center text-white">
                      <Eye className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-semibold text-white drop-shadow">
                      {(short.views || 0).toLocaleString()}
                    </span>
                  </div>

                  {/* Share */}
                  <button
                    type="button"
                    onClick={(e) => handleShareShort(short, e)}
                    className="flex flex-col items-center gap-1 cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded-full bg-black/65 hover:bg-zinc-800/80 border border-white/15 backdrop-blur-md flex items-center justify-center text-white transition-colors">
                      {copiedId === short.id ? (
                        <Check className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <Share2 className="w-5 h-5" />
                      )}
                    </div>
                    <span className="text-[11px] font-semibold text-white drop-shadow">
                      {copiedId === short.id ? 'Copied' : 'Share'}
                    </span>
                  </button>

                  {/* Mute / Unmute */}
                  <button
                    type="button"
                    onClick={toggleMute}
                    className="flex flex-col items-center gap-1 cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded-full bg-black/65 hover:bg-zinc-800/80 border border-white/15 backdrop-blur-md flex items-center justify-center text-white transition-colors">
                      {isMuted ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
                    </div>
                    <span className="text-[10px] font-medium text-zinc-200 drop-shadow">
                      {isMuted ? 'Muted' : 'Sound'}
                    </span>
                  </button>

                  {/* Prev / Next Navigation */}
                  <div className="flex flex-col gap-1.5 pt-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => scrollToSlide(idx - 1)}
                      className="w-9 h-9 rounded-full bg-black/65 hover:bg-zinc-800 disabled:opacity-30 border border-white/15 flex items-center justify-center text-white cursor-pointer"
                      aria-label="Previous Short"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={idx >= slides.length - 1}
                      onClick={() => scrollToSlide(idx + 1)}
                      className="w-9 h-9 rounded-full bg-black/65 hover:bg-zinc-800 disabled:opacity-30 border border-white/15 flex items-center justify-center text-white cursor-pointer"
                      aria-label="Next Short"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Bottom Info + Viral Adult Hashtags + Embedded 320x50 Banner Ad */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="relative z-30 mt-auto w-full bg-gradient-to-t from-black via-black/85 to-transparent pt-10 pb-2 px-3 space-y-2"
                >
                  <div className="pr-14 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="w-7 h-7 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                        B
                      </div>
                      <span className="text-xs font-bold text-white truncate">
                        @{short.author || 'BdCollection'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          triggerPopunderAd();
                          triggerSmartlinkAd();
                        }}
                        className="px-2.5 py-0.5 rounded-full bg-red-600 hover:bg-red-500 text-[10px] font-bold text-white cursor-pointer"
                      >
                        Follow 18+
                      </button>
                      {short.isLongVideo && onWatchFullVideo && (
                        <button
                          type="button"
                          onClick={() => onWatchFullVideo(short.id)}
                          className="px-2.5 py-0.5 rounded-full bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-[10px] font-bold text-amber-300 cursor-pointer"
                        >
                          ▶ Full Video
                        </button>
                      )}
                    </div>

                    <h3 className="text-sm font-bold text-white leading-snug line-clamp-2 drop-shadow">
                      {short.title}
                    </h3>

                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {hashtagsList.slice(0, 7).map((tag, i) => (
                        <span
                          key={`${short.id}-tag-${i}`}
                          onClick={() => triggerSmartlinkAd()}
                          className="text-[11px] font-semibold text-red-400 hover:text-red-300 cursor-pointer"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Contained 320x50 Ad inside Shorts footer */}
                  <div className="w-full max-w-full overflow-hidden pt-0.5">
                    <Banner320x50Ad className="my-0" />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
