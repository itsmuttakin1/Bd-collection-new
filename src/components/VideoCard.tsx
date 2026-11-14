import React, { useState, useRef, useEffect } from 'react';
import { Play, Share2, Check } from 'lucide-react';
import {
  VideoItem,
  ShortItem,
  buildVideoShareLink,
  copyTextToClipboard,
  buildVideoStreamCandidates,
  sanitizeServerThumbnail,
} from '../firebase';
import { TranslationStrings } from '../i18n';
import {
  getCachedVideoFrameSync,
  getCachedVideoFrameAsync,
  tryCaptureAndCacheVideoFrame,
  requestVideoPreviewSlot,
  releaseVideoPreviewSlot,
  getBlurUpLqipSync,
} from '../utils/thumbCache';

interface VideoCardProps {
  video: VideoItem;
  onCardClick: (video: VideoItem) => void;
  compact?: boolean;
  t: TranslationStrings;
}

/**
 * Universal Blur-Up LQIP (Low-Quality Image Placeholder) + Left-to-Right Skeleton Shimmer Image Component.
 * Used across the entire website so every image starts with a blurred LQIP + left-to-right shimmer
 * and smoothly transitions to sharp HD (`blur(22px) scale(1.08)` -> `blur(0px) scale(1)`).
 */
export const BlurUpLqipImage: React.FC<{
  src: string;
  alt?: string;
  seed?: string;
  className?: string;
  imgClassName?: string;
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}> = ({ src, alt = '', seed = '', className = '', imgClassName = 'object-cover object-center', onLoad, onError }) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const lqipUrl = React.useMemo(
    () => getBlurUpLqipSync(seed || src, seed || alt || src),
    [seed, src, alt]
  );

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  return (
    <div className={`relative overflow-hidden ${!loaded ? 'skeleton-shimmer' : ''} ${className}`}>
      {/* Always-present 0ms Blurred LQIP Underlay */}
      <img
        src={lqipUrl}
        alt=""
        aria-hidden="true"
        decoding="async"
        className={`absolute inset-0 w-full h-full object-cover scale-110 blur-xl pointer-events-none transition-opacity duration-500 ${
          loaded ? 'opacity-0' : 'opacity-90'
        }`}
      />
      {!failed && src && (
        <img
          src={src}
          alt={alt}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={(e) => {
            setLoaded(true);
            onLoad?.(e);
          }}
          onError={(e) => {
            setFailed(true);
            onError?.(e);
          }}
          className={`relative z-10 w-full h-full lqip-img ${
            loaded ? 'lqip-img-loaded' : 'lqip-img-loading'
          } ${imgClassName}`}
        />
      )}
    </div>
  );
};

/**
 * Left-to-Right Skeleton Shimmer Charts + Video & Shorts Feed Skeleton
 * Replaces old pulse/spinner loading animations across the Home & Trending views.
 */
export const SkeletonChartsAndFeed: React.FC = () => {
  const chartHeights = [38, 68, 52, 88, 64, 95, 48, 78, 84, 60, 92, 72];
  return (
    <div className="space-y-6 select-none" aria-busy="true" aria-label="Loading content">
      {/* Top Skeleton Charts Strip (Trending Activity Bar Chart + Live Stream Metrics Skeleton) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
        <div className="md:col-span-7 p-4 rounded-2xl border border-zinc-800/80 bg-zinc-950/90 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-1.5">
              <div className="h-3.5 w-36 rounded-md skeleton-shimmer" />
              <div className="h-2.5 w-24 rounded-md skeleton-shimmer" />
            </div>
            <div className="h-6 w-20 rounded-lg skeleton-shimmer" />
          </div>
          {/* Skeleton Bar Chart with Left-to-Right Shimmer */}
          <div className="h-20 pt-2 flex items-end gap-2 px-1">
            {chartHeights.map((h, i) => (
              <div
                key={i}
                style={{ height: `${h}%` }}
                className="flex-1 rounded-t-md skeleton-shimmer"
              />
            ))}
          </div>
        </div>

        <div className="md:col-span-5 p-4 rounded-2xl border border-zinc-800/80 bg-zinc-950/90 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <div className="h-3.5 w-32 rounded-md skeleton-shimmer" />
            <div className="h-5 w-14 rounded-full skeleton-shimmer" />
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5">
              <div className="w-16 h-2.5 rounded skeleton-shimmer shrink-0" />
              <div className="flex-1 h-3 rounded-full skeleton-shimmer" />
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-16 h-2.5 rounded skeleton-shimmer shrink-0" />
              <div className="w-4/5 h-3 rounded-full skeleton-shimmer" />
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-16 h-2.5 rounded skeleton-shimmer shrink-0" />
              <div className="w-3/5 h-3 rounded-full skeleton-shimmer" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="h-3 w-20 rounded skeleton-shimmer" />
            <div className="h-3 w-16 rounded skeleton-shimmer" />
          </div>
        </div>
      </div>

      {/* Video Cards Grid Skeleton (Left-to-Right Shimmer + Blur-Up LQIP Underlay) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <div key={n} className="space-y-3">
            <div className="relative aspect-video rounded-xl overflow-hidden skeleton-shimmer border border-zinc-800/60">
              <img
                src={getBlurUpLqipSync(`skel_${n}`, `skel_${n}`)}
                alt=""
                aria-hidden="true"
                className="w-full h-full object-cover blur-xl scale-110 opacity-45"
              />
              <div className="absolute bottom-2 right-2 w-10 h-4 rounded skeleton-shimmer" />
            </div>
            <div className="flex gap-3 items-start">
              <div className="w-9 h-9 rounded-full skeleton-shimmer shrink-0" />
              <div className="flex-1 space-y-2 pt-0.5">
                <div className="h-4 rounded-md skeleton-shimmer w-11/12" />
                <div className="h-3.5 rounded-md skeleton-shimmer w-2/3" />
                <div className="h-2.5 rounded-md skeleton-shimmer w-5/12" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Watch Page Left-to-Right Skeleton Shimmer + Skeleton Chart View
 */
export const WatchSkeletonView: React.FC = () => {
  return (
    <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 select-none">
      <div className="lg:col-span-8 space-y-4">
        <div className="relative aspect-video rounded-xl overflow-hidden skeleton-shimmer border border-zinc-800/70">
          <img
            src={getBlurUpLqipSync('watch_hero_lqip', 'watch_hero_lqip')}
            alt=""
            aria-hidden="true"
            className="w-full h-full object-cover blur-2xl scale-110 opacity-50"
          />
        </div>
        <div className="h-6 rounded-lg skeleton-shimmer w-3/4" />
        <div className="flex items-center justify-between gap-4 pt-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full skeleton-shimmer" />
            <div className="space-y-2">
              <div className="h-3.5 w-28 rounded skeleton-shimmer" />
              <div className="h-2.5 w-20 rounded skeleton-shimmer" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-24 rounded-full skeleton-shimmer" />
            <div className="h-9 w-24 rounded-full skeleton-shimmer" />
          </div>
        </div>
        {/* Skeleton Engagement Chart Box */}
        <div className="p-3.5 rounded-xl border border-zinc-800/70 bg-zinc-950/80 space-y-2.5">
          <div className="h-3 w-36 rounded skeleton-shimmer" />
          <div className="h-12 flex items-end gap-1.5">
            {[45, 70, 55, 90, 65, 80, 50, 95, 60, 75, 85, 68].map((h, idx) => (
              <div
                key={idx}
                style={{ height: `${h}%` }}
                className="flex-1 rounded-t skeleton-shimmer"
              />
            ))}
          </div>
        </div>
      </div>
      <div className="lg:col-span-4 space-y-3">
        {[1, 2, 3, 4, 5].map((n) => (
          <div key={n} className="flex gap-3 p-1.5 rounded-xl">
            <div className="w-40 aspect-video rounded-lg skeleton-shimmer shrink-0" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-3.5 rounded skeleton-shimmer w-11/12" />
              <div className="h-3 rounded skeleton-shimmer w-2/3" />
              <div className="h-2.5 rounded skeleton-shimmer w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Ultra-fast cached & viewport-prioritized preview for Shorts Shelf cards on Home & Watch pages
 * with Blur-Up LQIP + Left-to-Right Skeleton Shimmer.
 */
export const ShortShelfPreview: React.FC<{ short: ShortItem }> = ({ short }) => {
  const cacheKey = `short_${short.id}_${short.url || short.videoUrl || ''}`;
  const [cachedFrame, setCachedFrame] = useState<string | null>(() =>
    getCachedVideoFrameSync(cacheKey)
  );
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);
  const [mediaLoaded, setMediaLoaded] = useState<boolean>(() =>
    Boolean(getCachedVideoFrameSync(cacheKey))
  );
  const [streamStage, setStreamStage] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const slotId = `shelf_${short.id}`;

  const serverThumb = sanitizeServerThumbnail(short.thumbnail || short.thumbnailUrl);
  const lqipDataUrl = React.useMemo(
    () => getBlurUpLqipSync(cacheKey, short.id || short.title),
    [cacheKey, short.id, short.title]
  );

  const streamCandidates = React.useMemo(
    () => buildVideoStreamCandidates(short.url || short.videoUrl, short.r2Key),
    [short.url, short.videoUrl, short.r2Key]
  );

  const currentStreamUrl =
    streamCandidates.length > 0
      ? streamCandidates[Math.min(streamStage, streamCandidates.length - 1)]
      : '';

  const streamWithTime = currentStreamUrl
    ? currentStreamUrl.includes('#t=')
      ? currentStreamUrl
      : `${currentStreamUrl}#t=1.2`
    : '';

  useEffect(() => {
    let cancelled = false;
    if (!cachedFrame) {
      getCachedVideoFrameAsync(cacheKey).then((found) => {
        if (!cancelled && found) {
          setCachedFrame(found);
          setMediaLoaded(true);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [cacheKey, cachedFrame]);

  useEffect(() => {
    if (cachedFrame || serverThumb || !streamWithTime) return;
    const el = containerRef.current;
    if (!el) {
      setShouldLoadVideo(true);
      return;
    }

    let cleanupSlot: (() => void) | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    const startSlot = (priority: number) => {
      if (cleanupSlot) return;
      cleanupSlot = requestVideoPreviewSlot(slotId, priority, () => {
        setShouldLoadVideo(true);
        safetyTimer = setTimeout(() => {
          releaseVideoPreviewSlot(slotId);
        }, 2200);
      });
    };

    if (typeof IntersectionObserver === 'undefined') {
      startSlot(50);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          const top = entry.boundingClientRect.top;
          const priority = Math.max(10, 2000 - Math.max(0, Math.round(top)));
          startSlot(priority);
          observer.disconnect();
        }
      },
      { rootMargin: '450px 150px' }
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (safetyTimer) clearTimeout(safetyTimer);
      if (cleanupSlot) cleanupSlot();
    };
  }, [cachedFrame, serverThumb, streamWithTime, slotId]);

  const handleFrameReady = () => {
    setMediaLoaded(true);
    releaseVideoPreviewSlot(slotId);
    const captured = tryCaptureAndCacheVideoFrame(videoRef.current, cacheKey);
    if (captured) {
      setCachedFrame(captured);
    }
  };

  const displayImgSrc = cachedFrame || serverThumb;

  return (
    <div
      ref={containerRef}
      className={`w-full h-full relative overflow-hidden ${!mediaLoaded ? 'skeleton-shimmer' : ''}`}
    >
      {/* 0ms Blur-Up LQIP Underlay */}
      <img
        src={lqipDataUrl}
        alt=""
        aria-hidden="true"
        decoding="async"
        className={`absolute inset-0 w-full h-full object-cover scale-110 blur-xl pointer-events-none transition-opacity duration-500 ${
          mediaLoaded ? 'opacity-0' : 'opacity-90'
        }`}
      />

      {displayImgSrc ? (
        <img
          src={displayImgSrc}
          alt={short.title}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setMediaLoaded(true)}
          className={`relative z-10 w-full h-full object-cover group-hover:scale-105 lqip-img ${
            mediaLoaded ? 'lqip-img-loaded' : 'lqip-img-loading'
          }`}
        />
      ) : (
        shouldLoadVideo &&
        streamWithTime && (
          <video
            key={`${short.id}-shelf-${streamStage}`}
            ref={videoRef}
            src={streamWithTime}
            preload="metadata"
            muted
            playsInline
            onLoadedData={handleFrameReady}
            onSeeked={handleFrameReady}
            onError={() => {
              if (streamStage + 1 < streamCandidates.length) {
                setStreamStage((s) => s + 1);
              } else {
                releaseVideoPreviewSlot(slotId);
              }
            }}
            className={`relative z-10 w-full h-full object-cover pointer-events-none group-hover:scale-105 lqip-img ${
              mediaLoaded ? 'lqip-img-loaded' : 'lqip-img-loading'
            }`}
          />
        )
      )}
    </div>
  );
};

export const VideoCard: React.FC<VideoCardProps> = ({
  video,
  onCardClick,
  compact = false,
  t,
}) => {
  const cacheKey = `vid_${video.id}_${video.url || video.videoUrl || ''}`;
  const [cachedFrame, setCachedFrame] = useState<string | null>(() =>
    getCachedVideoFrameSync(cacheKey)
  );
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);
  const [videoReady, setVideoReady] = useState<boolean>(() =>
    Boolean(getCachedVideoFrameSync(cacheKey))
  );
  const [thumbFailed, setThumbFailed] = useState(false);
  const [streamStage, setStreamStage] = useState(0);
  const [copiedCardLink, setCopiedCardLink] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const slotId = `card_${video.id}_${compact ? 'c' : 'f'}`;

  const serverThumb = !thumbFailed
    ? sanitizeServerThumbnail(video.thumbnail || video.thumbnailUrl)
    : '';
  const lqipDataUrl = React.useMemo(
    () => getBlurUpLqipSync(cacheKey, video.id || video.title),
    [cacheKey, video.id, video.title]
  );

  const formatViews = (views: number) => {
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M ${t.views}`;
    if (views >= 1000) return `${(views / 1000).toFixed(1)}K ${t.views}`;
    return `${views} ${t.views}`;
  };

  const formatTimeAgo = (timestamp: number) => {
    const diff = Math.max(0, Date.now() - timestamp);
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return t.justNow;
    if (hours < 24) return `${hours} ${t.hoursAgo}`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} ${t.daysAgo}`;
    return `${Math.floor(days / 30)} ${t.monthsAgo}`;
  };

  const displayAuthor =
    !video.author || video.author === 'Bd Collection' ? 'X Tube' : video.author;
  const authorInitial = displayAuthor.charAt(0).toUpperCase();

  const streamCandidates = React.useMemo(
    () => buildVideoStreamCandidates(video.url || video.videoUrl, video.r2Key),
    [video.url, video.videoUrl, video.r2Key]
  );

  const streamSrc =
    streamCandidates.length > 0
      ? streamCandidates[Math.min(streamStage, streamCandidates.length - 1)]
      : '';

  const streamWithFragment = streamSrc
    ? streamSrc.includes('#t=')
      ? streamSrc
      : `${streamSrc}#t=1.2`
    : '';

  useEffect(() => {
    let cancelled = false;
    if (!cachedFrame) {
      getCachedVideoFrameAsync(cacheKey).then((found) => {
        if (!cancelled && found) {
          setCachedFrame(found);
          setVideoReady(true);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [cacheKey, cachedFrame]);

  useEffect(() => {
    if (cachedFrame || serverThumb || !streamWithFragment) return;
    const el = containerRef.current;
    if (!el) {
      setShouldLoadVideo(true);
      return;
    }

    let cleanupSlot: (() => void) | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    const startSlot = (priority: number) => {
      if (cleanupSlot) return;
      cleanupSlot = requestVideoPreviewSlot(slotId, priority, () => {
        setShouldLoadVideo(true);
        safetyTimer = setTimeout(() => {
          releaseVideoPreviewSlot(slotId);
        }, 2200);
      });
    };

    if (typeof IntersectionObserver === 'undefined') {
      startSlot(50);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          const top = entry.boundingClientRect.top;
          const priority = Math.max(10, 2000 - Math.max(0, Math.round(top)));
          startSlot(priority);
          observer.disconnect();
        }
      },
      { rootMargin: '450px 0px' }
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (safetyTimer) clearTimeout(safetyTimer);
      if (cleanupSlot) cleanupSlot();
    };
  }, [cachedFrame, serverThumb, streamWithFragment, slotId]);

  const handleFrameReady = () => {
    setVideoReady(true);
    releaseVideoPreviewSlot(slotId);
    const captured = tryCaptureAndCacheVideoFrame(videoRef.current, cacheKey);
    if (captured) {
      setCachedFrame(captured);
    }
  };

  const activeImageSrc = cachedFrame || serverThumb;

  const renderThumbnailMedia = () => (
    <div
      ref={containerRef}
      className={`absolute inset-0 w-full h-full overflow-hidden ${
        !videoReady ? 'skeleton-shimmer' : ''
      }`}
    >
      {/* 0ms Blur-Up LQIP (Low-Quality Image Placeholder) Underlay */}
      <img
        src={lqipDataUrl}
        alt=""
        aria-hidden="true"
        decoding="async"
        className={`absolute inset-0 w-full h-full object-cover scale-110 blur-xl pointer-events-none select-none transition-opacity duration-500 ${
          videoReady ? 'opacity-25' : 'opacity-90'
        }`}
      />

      {/* Progressive Blur-Up Image (Cached Frame or Server Thumbnail) */}
      {activeImageSrc ? (
        <img
          src={activeImageSrc}
          alt={video.title}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setVideoReady(true)}
          onError={() => {
            if (serverThumb && !cachedFrame) {
              setThumbFailed(true);
              setVideoReady(false);
            }
          }}
          className={`absolute inset-0 w-full h-full object-cover object-center z-10 pointer-events-none group-hover:scale-105 lqip-img ${
            videoReady ? 'lqip-img-loaded' : 'lqip-img-loading'
          }`}
        />
      ) : (
        /* Live Video Frame Preview with Blur-Up LQIP Transition */
        shouldLoadVideo &&
        streamWithFragment && (
          <video
            key={`${video.id}-preview-${streamStage}`}
            ref={videoRef}
            src={streamWithFragment}
            preload="metadata"
            muted
            playsInline
            onLoadedMetadata={() => {
              setVideoReady(true);
            }}
            onLoadedData={handleFrameReady}
            onSeeked={handleFrameReady}
            onCanPlay={handleFrameReady}
            onError={() => {
              if (streamStage + 1 < streamCandidates.length) {
                setStreamStage((s) => s + 1);
              } else {
                releaseVideoPreviewSlot(slotId);
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
            className={`absolute inset-0 w-full h-full object-cover object-center z-10 pointer-events-none group-hover:scale-105 lqip-img ${
              videoReady ? 'lqip-img-loaded' : 'lqip-img-loading'
            }`}
          />
        )
      )}

      {/* Hover Play Overlay */}
      <div className="absolute inset-0 z-20 bg-black/10 group-hover:bg-black/25 transition-colors flex items-center justify-center">
        <div className="w-11 h-11 rounded-full bg-red-600/95 text-white flex items-center justify-center shadow-xl opacity-0 group-hover:opacity-100 scale-95 group-hover:scale-100 transition-all">
          <Play className="w-5 h-5 fill-white ml-0.5" />
        </div>
      </div>

      {video.duration && (
        <span className="absolute bottom-2 right-2 z-20 px-1.5 py-0.5 rounded bg-black/85 text-[11px] font-mono font-medium text-white tabular-nums">
          {video.duration}
        </span>
      )}
    </div>
  );

  const watchHref = buildVideoShareLink(video.id);

  const handleAnchorClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    onCardClick(video);
  };

  const handleQuickShare = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const shareUrl = buildVideoShareLink(video.id);
    await copyTextToClipboard(shareUrl);
    setCopiedCardLink(true);
    setTimeout(() => setCopiedCardLink(false), 2000);
  };

  if (compact) {
    return (
      <div className="group flex gap-3 items-start rounded-xl p-1.5 hover:bg-zinc-900/70 transition-colors">
        <a
          href={watchHref}
          onClick={handleAnchorClick}
          className="flex flex-1 min-w-0 gap-3 cursor-pointer"
        >
          <div className="relative w-40 sm:w-44 aspect-video rounded-lg bg-zinc-900 overflow-hidden shrink-0">
            {renderThumbnailMedia()}
          </div>

          <div className="flex-1 min-w-0 py-0.5">
            <h4 className="text-sm font-medium text-zinc-100 group-hover:text-white line-clamp-2 leading-snug">
              {video.title}
            </h4>
            <p className="text-xs text-zinc-400 mt-1 truncate">{displayAuthor}</p>
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-0.5">
              <span className="tabular-nums">{formatViews(video.views)}</span>
              <span aria-hidden="true">·</span>
              <span>{formatTimeAgo(video.createdAt)}</span>
            </div>
          </div>
        </a>
        <button
          type="button"
          onClick={handleQuickShare}
          title={copiedCardLink ? t.copied : t.share}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors shrink-0 cursor-pointer"
        >
          {copiedCardLink ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Share2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    );
  }

  return (
    <article className="group flex flex-col gap-3">
      <a
        href={watchHref}
        onClick={handleAnchorClick}
        className="flex flex-col gap-3 cursor-pointer"
      >
        <div className="relative w-full aspect-video rounded-xl bg-zinc-900 overflow-hidden shadow-md">
          {renderThumbnailMedia()}
          {video.isTrending && (
            <span className="absolute top-2 left-2 z-20 px-2 py-0.5 rounded-md bg-gradient-to-r from-red-600 to-amber-500 text-white text-[10px] font-extrabold tracking-wide shadow-lg flex items-center gap-1">
              <span>🔥 TRENDING</span>
              {video.trendingRank && video.trendingRank < 999 ? (
                <span className="font-mono">#{video.trendingRank}</span>
              ) : null}
            </span>
          )}
        </div>

        <div className="flex gap-3 items-start px-0.5">
          <div className="w-9 h-9 rounded-full bg-red-600/20 border border-red-500/30 text-red-400 font-semibold text-sm flex items-center justify-center shrink-0 select-none">
            {authorInitial}
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold text-zinc-100 group-hover:text-white line-clamp-2 leading-snug">
              {video.title}
            </h3>
            <p className="text-[13px] text-zinc-400 mt-1 truncate hover:text-zinc-300">
              {displayAuthor}
            </p>
            <div className="flex items-center gap-1.5 text-[13px] text-zinc-400">
              <span className="tabular-nums">{formatViews(video.views)}</span>
              <span aria-hidden="true">·</span>
              <span>{formatTimeAgo(video.createdAt)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleQuickShare}
            title={copiedCardLink ? t.copied : t.share}
            className="px-2 py-1 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white text-[11px] font-medium flex items-center gap-1 transition-colors shrink-0 cursor-pointer"
          >
            {copiedCardLink ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">{t.copied}</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5" />
                <span>{t.share}</span>
              </>
            )}
          </button>
        </div>
      </a>
    </article>
  );
};
