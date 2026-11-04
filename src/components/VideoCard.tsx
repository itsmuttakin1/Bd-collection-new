import React, { useState, useRef, useEffect } from 'react';
import { Play, Share2, Check } from 'lucide-react';
import {
  VideoItem,
  ShortItem,
  buildVideoShareLink,
  copyTextToClipboard,
  buildVideoStreamCandidates,
} from '../firebase';
import { TranslationStrings } from '../i18n';
import {
  getCachedVideoFrameSync,
  getCachedVideoFrameAsync,
  tryCaptureAndCacheVideoFrame,
  requestVideoPreviewSlot,
  releaseVideoPreviewSlot,
} from '../utils/thumbCache';

interface VideoCardProps {
  video: VideoItem;
  onCardClick: (video: VideoItem) => void;
  compact?: boolean;
  t: TranslationStrings;
}

const CARD_GRADIENTS = [
  'from-red-950/90 via-zinc-900 to-zinc-950',
  'from-amber-950/80 via-zinc-900 to-zinc-950',
  'from-rose-950/85 via-zinc-900 to-zinc-950',
  'from-purple-950/80 via-zinc-900 to-zinc-950',
  'from-blue-950/80 via-zinc-900 to-zinc-950',
  'from-emerald-950/80 via-zinc-900 to-zinc-950',
];

/**
 * Ultra-fast cached & viewport-prioritized preview for Shorts Shelf cards on Home & Watch pages.
 */
export const ShortShelfPreview: React.FC<{ short: ShortItem }> = ({ short }) => {
  const cacheKey = `short_${short.id}_${short.url || short.videoUrl || ''}`;
  const [cachedFrame, setCachedFrame] = useState<string | null>(() =>
    getCachedVideoFrameSync(cacheKey)
  );
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);
  const [streamStage, setStreamStage] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const slotId = `shelf_${short.id}`;

  const streamCandidates = React.useMemo(
    () => buildVideoStreamCandidates(short.url || short.videoUrl, short.r2Key),
    [short.url, short.videoUrl, short.r2Key]
  );

  const currentStreamUrl =
    streamCandidates.length > 0
      ? streamCandidates[Math.min(streamStage, streamCandidates.length - 1)]
      : '';

  // Single-pass Media Fragment (#t=1.2) avoids double-seeking and loads in 1 Range request
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
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [cacheKey, cachedFrame]);

  useEffect(() => {
    if (cachedFrame || !streamWithTime) return;
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
  }, [cachedFrame, streamWithTime, slotId]);

  const handleFrameReady = () => {
    releaseVideoPreviewSlot(slotId);
    const captured = tryCaptureAndCacheVideoFrame(videoRef.current, cacheKey);
    if (captured) {
      setCachedFrame(captured);
    }
  };

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      {cachedFrame ? (
        <img
          src={cachedFrame}
          alt={short.title}
           decoding="async"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
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
            className="w-full h-full object-cover pointer-events-none group-hover:scale-105 transition-transform duration-300"
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
  const [videoReady, setVideoReady] = useState(false);
  const [streamStage, setStreamStage] = useState(0);
  const [copiedCardLink, setCopiedCardLink] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const slotId = `card_${video.id}_${compact ? 'c' : 'f'}`;

  const hashIdx =
    (video.id || video.title || '0')
      .split('')
      .reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % CARD_GRADIENTS.length;
  const gradientBg = CARD_GRADIENTS[hashIdx];

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

  // Single-pass #t=1.2 avoids double-seeking and loads the keyframe in 1 fast HTTP Range request
  const streamWithFragment = streamSrc
    ? streamSrc.includes('#t=')
      ? streamSrc
      : `${streamSrc}#t=1.2`
    : '';

  // Check IndexedDB cache on mount
  useEffect(() => {
    let cancelled = false;
    if (!cachedFrame) {
      getCachedVideoFrameAsync(cacheKey).then((found) => {
        if (!cancelled && found) {
          setCachedFrame(found);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [cacheKey, cachedFrame]);

  // Viewport-prioritized concurrency queue so visible cards load immediately without clogging the browser
  useEffect(() => {
    if (cachedFrame || !streamWithFragment) return;
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
  }, [cachedFrame, streamWithFragment, slotId]);

  const handleFrameReady = () => {
    setVideoReady(true);
    releaseVideoPreviewSlot(slotId);
    const captured = tryCaptureAndCacheVideoFrame(videoRef.current, cacheKey);
    if (captured) {
      setCachedFrame(captured);
    }
  };

  const renderThumbnailMedia = () => (
    <div ref={containerRef} className="absolute inset-0 w-full h-full overflow-hidden">
      {/* Rich Fallback Card Base (Always visible while frame loads so card is never blank) */}
      <div
        className={`absolute inset-0 bg-gradient-to-br ${gradientBg} flex flex-col items-center justify-center p-4 text-center select-none`}
      >
        <div className="w-11 h-11 rounded-full bg-white/10 backdrop-blur-sm border border-white/15 flex items-center justify-center mb-2 shadow-lg group-hover:scale-110 transition-transform">
          <Play className="w-5 h-5 fill-white text-white ml-0.5" />
        </div>
        <p className="text-xs font-semibold text-zinc-100 line-clamp-2 max-w-[90%] drop-shadow">
          {video.title}
        </p>
      </div>

      {/* Instant 0ms Cached Video Frame (from IndexedDB / Memory Cache) */}
      {cachedFrame ? (
        <img
          src={cachedFrame}
          alt={video.title}
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover object-center z-10 pointer-events-none group-hover:scale-105 transition-transform duration-200"
        />
      ) : (
        /* Live Video Frame Preview directly from video stream */
        shouldLoadVideo &&
        streamWithFragment && (
          <video
            key={`${video.id}-preview-${streamStage}`}
            ref={videoRef}
            src={streamWithFragment}
            poster="https://xtubeofficial.pages.dev/favicon.png"
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
            className={`absolute inset-0 w-full h-full object-cover object-center z-10 pointer-events-none group-hover:scale-105 transition-all duration-200 ${
              videoReady ? 'opacity-100' : 'opacity-95'
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
