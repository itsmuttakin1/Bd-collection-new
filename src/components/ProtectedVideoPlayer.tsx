import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCw,
  RotateCcw,
  ArrowLeft,
} from 'lucide-react';
import { sanitizeServerThumbnail } from '../firebase';
import { getBlurUpLqipSync } from '../utils/thumbCache';

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
  const seekTrackRef = useRef<HTMLDivElement>(null);

  // Video is unlocked once the 3-step verification completes
  const [isUnlocked, setIsUnlocked] = useState<boolean>(true);

  // 0 = direct R2 URL, 1 = /api/stream range proxy, 2 = /api/stream?transcode=1 FFmpeg H.264 live stream, 3 = backup stream fallback
  const [streamStage, setStreamStage] = useState<number>(0);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [showControlsMobile, setShowControlsMobile] = useState<boolean>(true);
  const [isSeeking, setIsSeeking] = useState<boolean>(false);

  // Fullscreen & Landscape Screen Rotation state (works in Telegram Mini App WebView, iOS, Android & Browsers)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isRotatedLandscape, setIsRotatedLandscape] = useState<boolean>(false);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 390,
    h: typeof window !== 'undefined' ? window.innerHeight : 844,
  }));

  const [posterFailed, setPosterFailed] = useState<boolean>(false);
  const [posterLoaded, setPosterLoaded] = useState<boolean>(false);
  const [isPortraitPoster, setIsPortraitPoster] = useState<boolean>(false);
  const lqipBackdropUrl = React.useMemo(
    () => getBlurUpLqipSync(`vid_${videoId}_${videoUrl}`, videoId || title),
    [videoId, videoUrl, title]
  );

  // Track live viewport dimensions so CSS 90deg rotation automatically adapts if device physically rotates
  useEffect(() => {
    const updateSize = () => {
      setViewportSize({
        w: window.innerWidth || document.documentElement.clientWidth || 390,
        h: window.innerHeight || document.documentElement.clientHeight || 844,
      });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    window.addEventListener('orientationchange', updateSize);
    return () => {
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('orientationchange', updateSize);
    };
  }, []);

  // Sync with native browser fullscreen exit (e.g. hardware Back or Escape)
  useEffect(() => {
    const handleFsChange = () => {
      const fsEl =
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).msFullscreenElement;
      if (!fsEl && isFullscreen) {
        // Only auto-exit if native fullscreen was previously active and user pressed Escape/Back
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        exitFullscreenMode();
      }
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  // Lock page scrolling while in Fullscreen mode
  useEffect(() => {
    if (isFullscreen) {
      const prevBodyOverflow = document.body.style.overflow;
      const prevHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevBodyOverflow;
        document.documentElement.style.overflow = prevHtmlOverflow;
      };
    }
  }, [isFullscreen]);

  const cleanVideoUrl = (() => {
    let u = (videoUrl || '').trim();
    if (u && !/^https?:\/\//i.test(u) && !u.startsWith('/')) {
      u = `https://${u}`;
    }
    return u;
  })();

  const candidateVideoUrls = React.useMemo(() => {
    if (!cleanVideoUrl) return [];
    const list: string[] = [cleanVideoUrl];
    const knownR2Domains = [
      'https://pub-56ae26091320480ca8946ab4e42a051d.r2.dev',
      'https://pub-a89cc17745e446439972f8e3a1b3c661.r2.dev',
      'https://pub-b89fbff1088544e2a25d432417afc3b1.r2.dev',
      'https://pub-f58d47fa71fd4d4e98985fc906988f57.r2.dev',
    ];
    try {
      const parsed = new URL(cleanVideoUrl);
      if (parsed.hostname.endsWith('.r2.dev')) {
        const pathPart = parsed.pathname + parsed.search;
        for (const dom of knownR2Domains) {
          const alt = `${dom}${pathPart}`;
          if (!list.includes(alt)) list.push(alt);
        }
      }
    } catch {}
    const streamProxy = `/api/stream?url=${encodeURIComponent(cleanVideoUrl)}`;
    if (!list.includes(streamProxy)) list.push(streamProxy);
    const transcodeProxy = `/api/stream?url=${encodeURIComponent(cleanVideoUrl)}&transcode=1`;
    if (!list.includes(transcodeProxy)) list.push(transcodeProxy);
    return list;
  }, [cleanVideoUrl]);

  const resolvedVideoSrc =
    candidateVideoUrls.length > 0
      ? candidateVideoUrls[Math.min(streamStage, candidateVideoUrls.length - 1)]
      : '';

  useEffect(() => {
    setIsUnlocked(true);
    setStreamStage(0);
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    setPosterFailed(false);
    setShowControlsMobile(true);
    setIsFullscreen(false);
    setIsRotatedLandscape(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      videoRef.current.load();
      setTimeout(() => {
        startVideoPlayback();
      }, 80);
    }
  }, [videoId, videoUrl]);

  const handleOverlayPlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isUnlocked) {
      setIsUnlocked(true);
    }
    if (!isPlaying) {
      startVideoPlayback();
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
    if (streamStage + 1 < candidateVideoUrls.length) {
      const nextStage = streamStage + 1;
      setStreamStage(nextStage);
      setTimeout(() => {
        const vid = videoRef.current;
        if (!vid) return;
        vid.load();
        if (isUnlocked) {
          startVideoPlayback();
        }
      }, 100);
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
          if (streamStage + 1 < candidateVideoUrls.length) {
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

  const skipSeconds = (e: React.MouseEvent, delta: number) => {
    e.stopPropagation();
    const vid = videoRef.current;
    if (!vid || !isUnlocked || !duration) return;
    const nextTime = Math.max(0, Math.min(duration, vid.currentTime + delta));
    vid.currentTime = nextTime;
    setCurrentTime(nextTime);
    setProgress((nextTime / duration) * 100);
    setShowControlsMobile(true);
  };

  // True when in Fullscreen mode with Landscape rotation active while the physical screen is in Portrait
  const shouldCssRotate90 = isFullscreen && isRotatedLandscape && viewportSize.h > viewportSize.w;

  // Compute accurate seek percentage for both normal (0deg) and rotated landscape (90deg) modes
  const seekToClientCoords = useCallback(
    (clientX: number, clientY: number) => {
      const vid = videoRef.current;
      const track = seekTrackRef.current;
      if (!vid || !track || !isUnlocked || !duration) return;
      const rect = track.getBoundingClientRect();
      let pct = 0;
      if (shouldCssRotate90) {
        if (rect.height <= 0) return;
        pct = ((clientY - rect.top) / rect.height) * 100;
      } else {
        if (rect.width <= 0) return;
        pct = ((clientX - rect.left) / rect.width) * 100;
      }
      const clamped = Math.max(0, Math.min(100, pct));
      const newTime = (clamped / 100) * duration;
      vid.currentTime = newTime;
      setCurrentTime(newTime);
      setProgress(clamped);
    },
    [duration, isUnlocked, shouldCssRotate90]
  );

  const enterFullscreenMode = (rotateLandscape = true) => {
    const container = containerRef.current as any;
    setIsFullscreen(true);
    setIsRotatedLandscape(rotateLandscape);
    setShowControlsMobile(true);

    // 1. Expand Telegram WebApp & unlock orientation if running inside Telegram Mini App
    const tg = (window as any).Telegram?.WebApp;
    try {
      tg?.expand?.();
    } catch {}
    try {
      if (typeof tg?.requestFullscreen === 'function') {
        tg.requestFullscreen();
      }
    } catch {}
    try {
      if (typeof tg?.unlockOrientation === 'function') {
        tg.unlockOrientation();
      }
    } catch {}

    // 2. Also attempt native Fullscreen API + Screen Orientation Lock when supported by browser
    if (container) {
      const reqFs =
        container.requestFullscreen ||
        container.webkitRequestFullscreen ||
        container.msRequestFullscreen;
      if (reqFs) {
        try {
          Promise.resolve(reqFs.call(container))
            .then(() => {
              if (rotateLandscape) {
                const ori = (window.screen as any)?.orientation;
                if (ori && typeof ori.lock === 'function') {
                  ori.lock('landscape').catch(() => {});
                }
              }
            })
            .catch(() => {
              // Native fullscreen blocked in Telegram WebView / iOS — our CSS Fullscreen + 90deg Landscape Rotation handles it seamlessly
            });
        } catch {}
      }
    }
  };

  const exitFullscreenMode = () => {
    setIsFullscreen(false);
    setIsRotatedLandscape(false);
    setShowControlsMobile(true);

    // Unlock screen orientation
    try {
      const ori = (window.screen as any)?.orientation;
      if (ori && typeof ori.unlock === 'function') {
        ori.unlock();
      }
    } catch {}

    // Exit native browser fullscreen if active
    try {
      const fsEl =
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).msFullscreenElement;
      if (fsEl) {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if ((document as any).webkitExitFullscreen) {
          (document as any).webkitExitFullscreen();
        }
      }
    } catch {}

    // Exit Telegram fullscreen if active
    try {
      const tg = (window as any).Telegram?.WebApp;
      if (typeof tg?.exitFullscreen === 'function') {
        tg.exitFullscreen();
      }
    } catch {}
  };

  const toggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isFullscreen) {
      // Clicking Fullscreen automatically enters Fullscreen AND rotates to Landscape on mobile/Telegram
      enterFullscreenMode(true);
    } else {
      exitFullscreenMode();
    }
  };

  const toggleRotateScreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isFullscreen) {
      enterFullscreenMode(true);
    } else {
      const nextRotate = !isRotatedLandscape;
      setIsRotatedLandscape(nextRotate);
      try {
        const ori = (window.screen as any)?.orientation;
        if (ori && typeof ori.lock === 'function') {
          ori.lock(nextRotate ? 'landscape' : 'portrait').catch(() => {});
        }
      } catch {}
    }
  };

  const formatTime = (sec: number) => {
    if (!sec || isNaN(sec) || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const cleanPoster = sanitizeServerThumbnail(poster);
  const hasValidPoster = Boolean(cleanPoster && !posterFailed);
  const videoSrcForElement =
    !isUnlocked && !hasValidPoster && resolvedVideoSrc && !resolvedVideoSrc.includes('#t=')
      ? `${resolvedVideoSrc}#t=3.0`
      : resolvedVideoSrc;

  // Dynamic style for Fullscreen + 90-degree Landscape Rotation inside Telegram WebApp / Mobile WebView
  const fullscreenContainerStyle: React.CSSProperties | undefined = isFullscreen
    ? shouldCssRotate90
      ? {
          position: 'fixed',
          top: '50%',
          left: '50%',
          width: `${viewportSize.h}px`,
          height: `${viewportSize.w}px`,
          transform: 'translate(-50%, -50%) rotate(90deg)',
          transformOrigin: 'center center',
          zIndex: 999999,
          backgroundColor: '#000000',
          borderRadius: 0,
        }
      : {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100vw',
          height: '100dvh',
          zIndex: 999999,
          backgroundColor: '#000000',
          borderRadius: 0,
        }
    : undefined;

  return (
    <>
      {/* Placeholder in normal page flow while video player is expanded to fixed fullscreen */}
      {isFullscreen && <div className="w-full aspect-video bg-black rounded-xl" />}

      <div
        ref={containerRef}
        style={fullscreenContainerStyle}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (isUnlocked) setShowControlsMobile((prev) => !prev);
        }}
        onDoubleClick={toggleFullscreen}
        className={
          isFullscreen
            ? 'overflow-hidden select-none group bg-black flex items-center justify-center'
            : 'relative w-full aspect-video bg-black rounded-xl overflow-hidden select-none group shadow-lg'
        }
      >
        <video
          key={`${videoId}-${streamStage}`}
          ref={videoRef}
          src={videoSrcForElement}
          poster={hasValidPoster ? cleanPoster : 'https://xtubeofficial.pages.dev/favicon.png'}
          title={title}
          playsInline
          // @ts-ignore - webkit-playsinline & x5 attributes prevent hijack while allowing custom rotated fullscreen
          webkit-playsinline="true"
          preload="metadata"
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
          onError={handleVideoError}
          onTimeUpdate={() => {
            const vid = videoRef.current;
            if (!vid || !isUnlocked || isSeeking) return;
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
        />

        {/* Top Left-to-Right Skeleton Shimmer Bar when Buffering (No Spinning Loader) */}
        {isBuffering && (
          <div className="absolute top-0 left-0 right-0 h-1 z-30 skeleton-shimmer bg-red-950/60 pointer-events-none" />
        )}

        {/* 0ms Blur-Up LQIP + Left-to-Right Shimmer Underlay before video first frame */}
        {!isPlaying && duration === 0 && (
          <div className="absolute inset-0 z-0 overflow-hidden skeleton-shimmer pointer-events-none">
            <img
              src={lqipBackdropUrl}
              alt=""
              aria-hidden="true"
              className="w-full h-full object-cover blur-2xl scale-110 opacity-60"
            />
          </div>
        )}

        {/* Smart Adjusted R2 Server Thumbnail Overlay with Blur-Up LQIP before video is unlocked */}
        {!isUnlocked && hasValidPoster && (
          <div className={`absolute inset-0 z-10 overflow-hidden bg-zinc-950 pointer-events-none ${!posterLoaded ? 'skeleton-shimmer' : ''}`}>
            <img
              src={posterLoaded ? cleanPoster : lqipBackdropUrl}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover object-center blur-xl scale-125 opacity-70"
            />
            <img
              src={cleanPoster}
              alt=""
              referrerPolicy="no-referrer"
              onLoad={(e) => {
                setPosterLoaded(true);
                const el = e.currentTarget;
                if (el.naturalWidth && el.naturalHeight) {
                  setIsPortraitPoster(el.naturalHeight > el.naturalWidth * 1.05);
                }
              }}
              onError={() => setPosterFailed(true)}
              className={`relative z-10 w-full h-full lqip-img ${
                posterLoaded ? 'lqip-img-loaded' : 'lqip-img-loading'
              } ${isPortraitPoster ? 'object-contain' : 'object-cover object-center'}`}
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

        {/* Top Bar inside Fullscreen Mode (Exit Fullscreen + Video Title + Rotate Screen Toggle) */}
        {isFullscreen && isUnlocked && (
          <div
            onClick={(e) => e.stopPropagation()}
            className={`absolute top-0 left-0 right-0 z-30 flex items-center justify-between gap-3 px-4 py-3 bg-gradient-to-b from-black/85 via-black/40 to-transparent transition-opacity duration-200 ${
              !isPlaying || showControlsMobile ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <button
              type="button"
              onClick={toggleFullscreen}
              className="px-3 py-1.5 rounded-xl bg-black/60 hover:bg-zinc-800 border border-white/15 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-lg"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Exit Fullscreen</span>
            </button>

            <p className="text-xs sm:text-sm font-semibold text-zinc-100 truncate flex-1 text-center px-2">
              {title}
            </p>

            <button
              type="button"
              onClick={toggleRotateScreen}
              className="px-3 py-1.5 rounded-xl bg-red-600/90 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-lg shrink-0"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>{isRotatedLandscape ? 'Portrait' : 'Rotate'}</span>
            </button>
          </div>
        )}

        {/* Bottom Player Controls (Works in both Normal & Rotated Landscape Fullscreen) */}
        {isUnlocked && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setShowControlsMobile((prev) => !prev);
            }}
            className={`absolute inset-0 z-20 flex flex-col justify-end bg-gradient-to-t from-black/85 via-transparent to-transparent transition-opacity duration-150 cursor-pointer ${
              !isPlaying || showControlsMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`px-4 ${isFullscreen ? 'pb-5 pt-3' : 'pb-3 pt-2'} space-y-2.5 cursor-default`}
            >
              {/* Custom Touch/Pointer Timeline Seek Bar (Works accurately in both 0deg and 90deg Rotated Landscape) */}
              <div
                ref={seekTrackRef}
                onClick={(e) => {
                  e.stopPropagation();
                  seekToClientCoords(e.clientX, e.clientY);
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setIsSeeking(true);
                  try {
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  } catch {}
                  seekToClientCoords(e.clientX, e.clientY);
                }}
                onPointerMove={(e) => {
                  if (!isSeeking) return;
                  e.stopPropagation();
                  seekToClientCoords(e.clientX, e.clientY);
                }}
                onPointerUp={(e) => {
                  if (!isSeeking) return;
                  e.stopPropagation();
                  setIsSeeking(false);
                  try {
                    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                  } catch {}
                }}
                className="w-full py-2 flex items-center cursor-pointer touch-none"
              >
                <div className="relative w-full h-1.5 bg-zinc-600/90 rounded-full overflow-visible">
                  <div
                    className="h-full bg-red-600 rounded-full relative"
                    style={{ width: `${ Math.max(0, Math.min(100, progress)) }%` }}
                  >
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-white shadow-md" />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 sm:gap-4">
                <div className="flex items-center gap-3 sm:gap-4">
                  <button
                    type="button"
                    onClick={togglePlayPause}
                    className="text-white hover:text-zinc-200 transition-colors cursor-pointer p-1"
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? (
                      <Pause className="w-5 h-5 fill-current" />
                    ) : (
                      <Play className="w-5 h-5 fill-current" />
                    )}
                  </button>

                  {/* -10s / +10s Quick Seek Buttons */}
                  <button
                    type="button"
                    onClick={(e) => skipSeconds(e, -10)}
                    className="text-zinc-200 hover:text-white transition-colors cursor-pointer text-[11px] font-bold flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/10"
                    title="Rewind 10s"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>10s</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => skipSeconds(e, 10)}
                    className="text-zinc-200 hover:text-white transition-colors cursor-pointer text-[11px] font-bold flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/10"
                    title="Forward 10s"
                  >
                    <span>10s</span>
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={toggleMute}
                    className="text-white hover:text-zinc-200 transition-colors cursor-pointer p-1"
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  </button>

                  <div className="text-xs font-mono text-zinc-200 tabular-nums">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </div>

                  {isBuffering && <span className="text-xs text-zinc-400">Loading...</span>}
                </div>

                {/* Right Controls: Rotate Screen + Fullscreen Toggle */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleRotateScreen}
                    className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                    aria-label="Rotate Screen"
                    title="Rotate Screen"
                  >
                    <RotateCw className="w-4 h-4" />
                    <span className="hidden xs:inline sm:inline text-[11px]">Rotate</span>
                  </button>

                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="p-1.5 rounded-lg bg-red-600/90 hover:bg-red-500 text-white transition-colors cursor-pointer flex items-center justify-center shadow"
                    aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                    title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  >
                    {isFullscreen ? (
                      <Minimize className="w-4 h-4" />
                    ) : (
                      <Maximize className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
