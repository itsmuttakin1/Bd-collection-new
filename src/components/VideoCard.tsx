import React, { useState, useRef } from 'react';
import { Play } from 'lucide-react';
import { VideoItem } from '../firebase';
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

  const authorInitial = (video.author || 'B').charAt(0).toUpperCase();

  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const targetTime = v.duration && v.duration > 2 ? 1.5 : 0.1;
      v.currentTime = targetTime;
    } catch {
      setVideoReady(true);
    }
  };

  const thumbSrc = video.thumbnail || video.thumbnailUrl || '';
  const streamSrc = video.url || video.videoUrl || '';

  const renderThumbnailMedia = () => (
    <>
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

      {thumbSrc && !imgFailed && (
        <img
          src={thumbSrc}
          alt={video.title}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="absolute inset-0 w-full h-full object-cover z-10 group-hover:scale-105 transition-transform duration-200"
        />
      )}

      {(!thumbSrc || imgFailed) && streamSrc && (
        <video
          ref={videoRef}
          src={streamSrc}
          preload="auto"
          muted
          playsInline
          onLoadedMetadata={handleLoadedMetadata}
          onLoadedData={() => setVideoReady(true)}
          onSeeked={() => setVideoReady(true)}
          onContextMenu={(e) => e.preventDefault()}
          className={`absolute inset-0 w-full h-full object-cover z-10 pointer-events-none group-hover:scale-105 transition-all duration-200 ${
            videoReady ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

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

  if (compact) {
    return (
      <div
        onClick={() => onCardClick(video)}
        className="group flex gap-3 cursor-pointer rounded-xl p-1.5 hover:bg-zinc-900/70 transition-colors"
      >
        <div className="relative w-40 sm:w-44 aspect-video rounded-lg bg-zinc-900 overflow-hidden shrink-0">
          {renderThumbnailMedia()}
        </div>

        <div className="flex-1 min-w-0 py-0.5">
          <h4 className="text-sm font-medium text-zinc-100 group-hover:text-white line-clamp-2 leading-snug">
            {video.title}
          </h4>
          <p className="text-xs text-zinc-400 mt-1 truncate">{video.author}</p>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-0.5">
            <span className="tabular-nums">{formatViews(video.views)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatTimeAgo(video.createdAt)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <article
      onClick={() => onCardClick(video)}
      className="group cursor-pointer flex flex-col gap-3"
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
            {video.author}
          </p>
          <div className="flex items-center gap-1.5 text-[13px] text-zinc-400">
            <span className="tabular-nums">{formatViews(video.views)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatTimeAgo(video.createdAt)}</span>
          </div>
        </div>
      </div>
    </article>
  );
};
