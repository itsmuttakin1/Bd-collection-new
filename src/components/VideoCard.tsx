import React, { useState, useRef } from 'react';
import { Play, Share2, Check } from 'lucide-react';
import { VideoItem, buildVideoShareLink, copyTextToClipboard } from '../firebase';
import { TranslationStrings } from '../i18n';

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

export const VideoCard: React.FC<VideoCardProps> = ({
  video,
  onCardClick,
  compact = false,
  t,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [copiedCardLink, setCopiedCardLink] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

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

  const [imgLoaded, setImgLoaded] = useState(false);
  const [isPortraitThumb, setIsPortraitThumb] = useState(false);

  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const dur = Number(v.duration) || 0;
      // Avoid 0.0s–1.5s where many videos fade in from black; seek to 25% or 3.5s
      const targetTime =
        dur > 6
          ? Math.min(Math.max(dur * 0.25, 3.0), dur - 1)
          : dur > 1.5
          ? Math.min(dur * 0.5, dur - 0.2)
          : 0.5;
      v.currentTime = targetTime;
    } catch {
      setVideoReady(true);
    }
  };

  const thumbSrc = (video.thumbnail || video.thumbnailUrl || '').trim();
  const streamSrc = (video.url || video.videoUrl || '').trim();
  const streamWithFragment = streamSrc
    ? streamSrc.includes('#t=')
      ? streamSrc
      : `${streamSrc}#t=3.5`
    : '';

  const renderThumbnailMedia = () => (
    <>
      {/* Rich Fallback Card Base (Always visible behind media so card is never a black box) */}
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

      {/* Custom / ImgBB Thumbnail with Smart Aspect Ratio Adjustment */}
      {thumbSrc && !imgFailed && (
        <div
          className={`absolute inset-0 z-10 overflow-hidden bg-zinc-950 transition-opacity duration-200 ${
            imgLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Blurred ambient backdrop fills any aspect ratio gap so portrait/square images never have black bars */}
          <img
            src={thumbSrc}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover object-center blur-xl scale-125 opacity-75 pointer-events-none"
          />
          {/* Foreground crisp thumbnail properly fitted */}
          <img
            src={thumbSrc}
            alt={video.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={(e) => {
              const el = e.currentTarget;
              if (el.naturalWidth && el.naturalHeight) {
                setIsPortraitThumb(el.naturalHeight > el.naturalWidth * 1.05);
              }
              setImgLoaded(true);
            }}
            onError={() => {
              setImgFailed(true);
              setImgLoaded(false);
            }}
            className={`relative z-10 w-full h-full transition-transform duration-200 group-hover:scale-105 ${
              isPortraitThumb ? 'object-contain' : 'object-cover object-center'
            }`}
          />
          {/* Crawl-discoverable HTML5 video element with poster & contentUrl for Googlebot-Video */}
          {streamSrc && (
            <video
              src={streamSrc}
              poster={thumbSrc}
              preload="none"
              muted
              playsInline
              aria-label={video.title}
              className="sr-only"
            >
              <source src={streamSrc} type="video/mp4" />
            </video>
          )}
        </div>
      )}

      {/* Live Video Frame Preview if no Thumbnail image is set */}
      {(!thumbSrc || imgFailed) && streamWithFragment && (
        <video
          ref={videoRef}
          src={streamWithFragment}
          poster="https://bdcollection.pages.dev/favicon.png"
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={handleLoadedMetadata}
          onLoadedData={() => {
            const v = videoRef.current;
            if (v && v.currentTime < 0.2 && v.duration > 1) {
              try {
                v.currentTime = Math.min(3.0, v.duration * 0.3);
              } catch {
                setVideoReady(true);
              }
            } else {
              setVideoReady(true);
            }
          }}
          onSeeked={() => setVideoReady(true)}
          onContextMenu={(e) => e.preventDefault()}
          className={`absolute inset-0 w-full h-full object-cover object-center z-10 pointer-events-none group-hover:scale-105 transition-all duration-200 ${
            videoReady ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <source src={streamSrc} type="video/mp4" />
        </video>
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
    </>
  );

  const watchHref = buildVideoShareLink(video.id);

  const handleAnchorClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Allow Ctrl/Cmd/Middle-click to open in new tab normally; intercept standard left-click
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
