import React from 'react';
import { Play, Film, Shield, Flame, Sparkles, Compass } from 'lucide-react';
import { VideoItem } from '../firebase';

interface VideoCardProps {
  video: VideoItem;
  smartlinkClicks: number;
  onCardClick: (video: VideoItem) => void;
  featured?: boolean;
}

const GRADIENT_PALETTES = [
  'from-rose-950/80 via-zinc-900 to-zinc-950',
  'from-amber-950/70 via-zinc-900 to-zinc-950',
  'from-blue-950/70 via-zinc-900 to-zinc-950',
  'from-emerald-950/70 via-zinc-900 to-zinc-950',
  'from-stone-900 via-zinc-900 to-zinc-950',
];

export const VideoCard: React.FC<VideoCardProps> = ({
  video,
  smartlinkClicks,
  onCardClick,
  featured = false,
}) => {
  const hashIndex =
    video.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) %
    GRADIENT_PALETTES.length;
  const gradientClass = GRADIENT_PALETTES[hashIndex];

  const remainingClicks = Math.max(0, 3 - smartlinkClicks);

  return (
    <article
      onClick={() => onCardClick(video)}
      className={`group cursor-pointer rounded-2xl border border-zinc-800/90 bg-zinc-950 hover:border-zinc-700 transition-all duration-150 overflow-hidden flex flex-col ${
        featured ? 'md:col-span-2 md:row-span-2' : ''
      }`}
    >
      {/* Thumbnail Viewport with Zero-Broken-Image CSS/SVG fallback */}
      <div
        className={`relative w-full aspect-video bg-gradient-to-br ${gradientClass} overflow-hidden flex items-center justify-center`}
      >
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            referrerPolicy="no-referrer"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          />
        ) : null}

        {/* Stylized Cinema Backdrop Graphic when no external thumbnail is set */}
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center pointer-events-none select-none">
          <Film className="w-10 h-10 text-zinc-700/60 mb-2 group-hover:scale-110 transition-transform duration-150" />
          <span className="text-xs font-mono text-zinc-500 uppercase tracking-widest line-clamp-1">
            {video.category}
          </span>
        </div>

        {/* Contrast Scrim */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

        {/* Center Play Affordance */}
        <div className="relative z-10 w-12 h-12 rounded-full bg-rose-600/90 group-hover:bg-rose-500 text-white flex items-center justify-center shadow-lg transition-transform duration-150 group-hover:scale-110">
          <Play className="w-5 h-5 fill-white ml-0.5" />
        </div>

        {/* Bottom Overlay Info (Duration & Smartlink Gate Status) */}
        <div className="absolute bottom-3 inset-x-3 z-10 flex items-center justify-between text-xs font-mono">
          <span className="text-zinc-300 tabular-nums">
            {smartlinkClicks === 0
              ? 'Click to Open (0/3)'
              : smartlinkClicks < 3
              ? `Smartlink Step ${smartlinkClicks}/3`
              : 'Ready to Watch (3/3)'}
          </span>
          <span className="text-zinc-200 tabular-nums">{video.duration}</span>
        </div>
      </div>

      {/* Card Body - Clean Unboxed Metadata with Typographic Separators */}
      <div className="p-4 flex-1 flex flex-col justify-between space-y-2">
        <div>
          <h3
            className={`font-semibold text-zinc-100 group-hover:text-rose-400 transition-colors line-clamp-2 ${
              featured ? 'text-lg' : 'text-sm'
            }`}
          >
            {video.title}
          </h3>
          {featured && (
            <p className="text-xs text-zinc-400 mt-1.5 line-clamp-2 leading-relaxed">
              {video.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-zinc-500 pt-1">
          <span>{video.category}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{video.views.toLocaleString()} views</span>
          <span aria-hidden="true">·</span>
          <span>
            {remainingClicks > 0 ? `${remainingClicks} clicks to unlock` : 'Unlocked'}
          </span>
        </div>
      </div>
    </article>
  );
};
