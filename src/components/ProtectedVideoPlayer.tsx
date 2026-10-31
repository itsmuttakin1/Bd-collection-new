import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react';
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

  // 0 = direct R2 URL, 1 = /api/stream range proxy, 2 = /api/stream?transcode=1 FFmpeg H.264 live stream
  const [streamStage, setStreamStage] = useState<number>(0);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [showControlsMobile, setShowControlsMobile] = useState<boolean>(true);

  const [posterFailed, setPosterFailed] = useState<boolean>(false);
  const [isPortraitPoster, setIsPortraitPoster] = useState<boolean>(false);

  const cleanVideoUrl = (videoUrl || '').trim();

  const resolvedVideoSrc = (() => {
    if (!cleanVideoUrl) return '';
    if (streamStage === 1) {
      return `/api/stream?url=${encodeURIComponent(cleanVideoUrl)}`;
    }
    if (streamStage === 2) {
      return `/api/stream?url=${encodeURIComponent(cleanVideoUrl)}&transcode=1`;
    }
    return cleanVideoUrl;
  })();

  useEffect(() => {
    setPopunderClicks(0);
    setIsUnlocked(false);
    setStreamStage(0);
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    setPosterFailed(false);
    setShowControlsMobile(true);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [videoId, videoUrl]);

  // Overlay Play button click (requires 3 Popunder clicks before playing)
  const handleOverlayPlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!isUnlocked) {
      const nextCount = popunderClicks + 1;
      triggerPopunderAd();
      if (nextCount < 3) {
        triggerSmartlinkAd();
      }
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
    if (vid.currentTime > 0 && !isPlaying && currentTime === 0) {
      try {
        vid.currentTime = 0;
      } catch {}
    }
    vid
      .play()
      .then(() => {
        setIsPlaying(true);
        if (onPlaySuccess) onPlaySuccess();
      })
      .catch(() => {
        // Fallback: if browser blocks unmuted play, start muted so video always plays
        try {
          vid.muted = true;
          setIsMuted(true);
          vid
            .play()
            .then(() => {
              setIsPlaying(true);
              if (onPlaySuccess) onPlaySuccess();
            })
            .catch(() => {});
        } catch {}
      });
  };

  const handleVideoError = () => {
    // Automatically escalate through 3-stage stream pipeline if direct R2 URL or codec fails
    if (streamStage < 2) {
      const nextStage = streamStage + 1;
      setStreamStage(nextStage);
      setTimeout(() => {
        const vid = videoRef.current;
        if (!vid) return;
        vid.load();
        if (isUnlocked) {
          startVideoPlayback();
        }
      }, 80);
    }
  };

  const togglePlayPause = () => {
    const vid = videoRef.current;
    if (!vid || !isUnlocked) return;
    setShowControlsMobile(true);
    if (vid.paused) {
      vid
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          if (streamStage < 2) {
            handleVideoError();
          }
        });
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
    const vid = videoRef.current as any;
    if (!container) return;
    if (!document.fullscreenElement) {
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {});
      } else if (vid?.webkitEnterFullscreen) {
        vid.webkitEnterFullscreen();
      }
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const formatTime = (sec: number) => {
    if (!sec || isNaN(sec) || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const hasValidPoster = Boolean(poster && poster.trim() && !posterFailed);

  return (
    <div
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (isUnlocked) setShowControlsMobile((prev) => !prev);
      }}
      className="relative w-full aspect-video bg-black rounded-xl overflow-hidden select-none group shadow-lg"
    >
      <video
        ref={videoRef}
        src={resolvedVideoSrc}
        poster={poster && poster.trim() ? poster.trim() : 'https://bdcollection.pages.dev/favicon.png'}
        title={title}
        playsInline
        preload="metadata"
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
        onError={handleVideoError}
        onTimeUpdate={() => {
          const vid = videoRef.current;
          if (!vid || !isUnlocked) return;
          setCurrentTime(vid.currentTime);
          if (vid.duration && isFinite(vid.duration)) {
            setProgress((vid.currentTime / vid.duration) * 100);
          }
        }}
        onLoadedMetadata={() => {
          const vid = videoRef.current;
          if (!vid) return;
          if (vid.duration && isFinite(vid.duration)) {
            setDuration(vid.duration);
          }
          // If there is no poster image and video hasn't started yet, seek to 3s so player isn't black
          if (!hasValidPoster && !isUnlocked && vid.duration > 1.5) {
            try {
              vid.currentTime = Math.min(3.0, vid.duration * 0.25);
            } catch {}
          }
          if (isUnlocked && vid.paused) {
            startVideoPlayback();
          }
        }}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        className="w-full h-full object-contain pointer-events-none"
      >
        {resolvedVideoSrc && <source src={resolvedVideoSrc} type="video/mp4" />}
      </video>

      {/* Smart Adjusted Thumbnail Overlay before video is unlocked */}
      {!isUnlocked && hasValidPoster && (
        <div className="absolute inset-0 z-10 overflow-hidden bg-zinc-950 pointer-events-none">
          <img
            src={poster}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover object-center blur-xl scale-125 opacity-70"
          />
          <img
            src={poster}
            alt=""
            referrerPolicy="no-referrer"
            onLoad={(e) => {
              const el = e.currentTarget;
              if (el.naturalWidth && el.naturalHeight) {
                setIsPortraitPoster(el.naturalHeight > el.naturalWidth * 1.05);
              }
            }}
            onError={() => setPosterFailed(true)}
            className={`relative z-10 w-full h-full ${
              isPortraitPoster ? 'object-contain' : 'object-cover object-center'
            }`}
          />
        </div>
      )}

      {/* Play Button Overlay */}
      {(!isUnlocked || !isPlaying) && (
        <div
          onClick={handleOverlayPlayClick}
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/35 cursor-pointer transition-opacity"
        >
          <button
            type="button"
            onClick={handleOverlayPlayClick}
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-red-600 hover:bg-red-500 active:scale-95 text-white flex items-center justify-center shadow-2xl transition-all duration-150 cursor-pointer"
            aria-label="Play"
          >
            <Play className="w-8 h-8 sm:w-10 sm:h-10 fill-white ml-1" />
          </button>
        </div>
      )}

      {/* Clean YouTube-Style Bottom Player Controls (No Download Option) */}
      {isUnlocked && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            togglePlayPause();
          }}
          className={`absolute inset-0 z-10 flex flex-col justify-end bg-gradient-to-t from-black/80 via-transparent to-transparent transition-opacity duration-150 cursor-pointer ${
            !isPlaying || showControlsMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <div onClick={(e) => e.stopPropagation()} className="px-4 pb-3 pt-2 space-y-2 cursor-default">
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={progress}
              onChange={handleSeek}
              className="w-full h-1 bg-zinc-600 rounded-lg appearance-none cursor-pointer accent-red-600"
            />

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={togglePlayPause}
                  className="text-white hover:text-zinc-200 transition-colors cursor-pointer"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
                </button>

                <button
                  type="button"
                  onClick={toggleMute}
                  className="text-white hover:text-zinc-200 transition-colors cursor-pointer"
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>

                <div className="text-xs font-mono text-zinc-200 tabular-nums">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </div>

                {isBuffering && <span className="text-xs text-zinc-400">Loading...</span>}
              </div>

              <button
                type="button"
                onClick={toggleFullscreen}
                className="text-white hover:text-zinc-200 transition-colors cursor-pointer"
                aria-label="Fullscreen"
              >
                <Maximize className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
