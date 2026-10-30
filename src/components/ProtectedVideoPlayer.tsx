import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, ShieldCheck, Lock } from 'lucide-react';
import { triggerPopunderAd, triggerSmartlinkAd } from './AdUnits';

interface ProtectedVideoPlayerProps {
  videoId: string;
  videoUrl: string;
  title: string;
  poster?: string;
  onPlaySuccess?: () => void;
}

export const ProtectedVideoPlayer: React.FC<ProtectedVideoPlayerProps> = ({
  videoId,
  videoUrl,
  title,
  poster,
  onPlaySuccess,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 3-click Popunder gate state before video actually plays
  const [popunderClicks, setPopunderClicks] = useState<number>(0);
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Reset 3-click play gate whenever the user switches to a different video
  useEffect(() => {
    setPopunderClicks(0);
    setIsUnlocked(false);
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    setVideoError(null);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [videoId, videoUrl]);

  // Handle the overlay Play button click (requires 3 Popunder clicks before playing)
  const handleOverlayPlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!isUnlocked) {
      const nextCount = popunderClicks + 1;
      // Trigger Popunder script and Smartlink fallback on each click
      triggerPopunderAd();
      triggerSmartlinkAd();
      setPopunderClicks(nextCount);

      if (nextCount >= 3) {
        setIsUnlocked(true);
        startVideoPlayback();
      }
    } else {
      togglePlayPause();
    }
  };

  const startVideoPlayback = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid
      .play()
      .then(() => {
        setIsPlaying(true);
        if (onPlaySuccess) onPlaySuccess();
      })
      .catch((err) => {
        console.error('Playback error:', err);
        setVideoError('Stream playback could not start. Check the video source URL or R2 public gateway.');
      });
  };

  const togglePlayPause = () => {
    const vid = videoRef.current;
    if (!vid || !isUnlocked) return;
    if (vid.paused) {
      vid.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      vid.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const vid = videoRef.current;
    if (!vid) return;
    vid.muted = !vid.muted;
    setIsMuted(vid.muted);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vid = videoRef.current;
    if (!vid || !isUnlocked || !duration) return;
    const val = Number(e.target.value);
    const newTime = (val / 100) * duration;
    vid.currentTime = newTime;
    setProgress(val);
  };

  const toggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const formatTime = (sec: number) => {
    if (!sec || isNaN(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
      className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-zinc-800 select-none group"
    >
      {/* Underlying HTML5 Video with download & PiP disabled */}
      <video
        ref={videoRef}
        src={videoUrl}
        poster={poster}
        playsInline
        preload="metadata"
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
        onTimeUpdate={() => {
          const vid = videoRef.current;
          if (!vid) return;
          setCurrentTime(vid.currentTime);
          if (vid.duration) {
            setProgress((vid.currentTime / vid.duration) * 100);
          }
        }}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration);
          }
        }}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={() => {
          setVideoError('Unable to load video stream. Ensure the R2 public URL or stream source is accessible.');
        }}
        className="w-full h-full object-contain pointer-events-none"
      />

      {/* Top Security Bar */}
      <div className="absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/80 via-black/30 to-transparent flex items-center justify-between pointer-events-none z-10">
        <div className="flex items-center gap-2 text-xs text-zinc-300 font-medium truncate max-w-[75%]">
          <ShieldCheck className="w-4 h-4 text-rose-500 shrink-0" />
          <span className="truncate">{title}</span>
        </div>
        <span className="text-[11px] font-mono text-zinc-400">DRM STREAM · NO DOWNLOAD</span>
      </div>

      {/* 3-Click Popunder Play Button Gate Overlay */}
      {(!isUnlocked || !isPlaying) && (
        <div
          onClick={handleOverlayPlayClick}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/65 backdrop-blur-[2px] cursor-pointer transition-opacity"
        >
          <button
            type="button"
            onClick={handleOverlayPlayClick}
            className="w-20 h-20 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white flex items-center justify-center shadow-2xl transition-all duration-150 group/btn"
            aria-label="Play Video"
          >
            <Play className="w-9 h-9 fill-white ml-1 transition-transform group-hover/btn:scale-110" />
          </button>

          <div className="mt-4 text-center px-4">
            {!isUnlocked ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-white">
                  {popunderClicks === 0
                    ? 'Click Play to Start Stream (Ad Verification 0/3)'
                    : `Click Play Again to Unlock Stream (${popunderClicks}/3)`}
                </p>
                <p className="text-xs text-zinc-400 font-mono">
                  Popunder verification step {popunderClicks} of 3 completed
                </p>
              </div>
            ) : (
              <p className="text-sm font-medium text-zinc-200">Stream Unlocked · Click to Resume</p>
            )}
          </div>
        </div>
      )}

      {/* Error Message Overlay */}
      {videoError && isUnlocked && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-zinc-950/90 p-6 text-center">
          <Lock className="w-8 h-8 text-rose-500 mb-2" />
          <p className="text-sm text-zinc-200 max-w-md mb-3">{videoError}</p>
          <p className="text-xs font-mono text-zinc-500 break-all max-w-lg">{videoUrl}</p>
        </div>
      )}

      {/* Custom Protected Bottom Controls (No Download Option) */}
      {isUnlocked && (
        <div
          onClick={togglePlayPause}
          className="absolute inset-0 z-10 flex flex-col justify-end bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-150 cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="p-4 space-y-2.5 cursor-default"
          >
            {/* Scrubber */}
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={progress}
              onChange={handleSeek}
              className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-rose-600"
            />

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={togglePlayPause}
                  className="text-zinc-200 hover:text-white transition-colors"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
                </button>

                <button
                  type="button"
                  onClick={toggleMute}
                  className="text-zinc-200 hover:text-white transition-colors"
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <VolumeX className="w-5 h-5 text-rose-500" /> : <Volume2 className="w-5 h-5" />}
                </button>

                <div className="text-xs font-mono text-zinc-300 tabular-nums">
                  {formatTime(currentTime)} <span className="text-zinc-600">/</span> {formatTime(duration)}
                </div>

                {isBuffering && (
                  <span className="text-xs font-mono text-amber-400">Buffering...</span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-zinc-400 hidden sm:inline">
                  PROTECTED PLAYER
                </span>
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="text-zinc-200 hover:text-white transition-colors"
                  aria-label="Fullscreen"
                >
                  <Maximize className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
