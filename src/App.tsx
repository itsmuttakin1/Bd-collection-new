/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  db,
  ref,
  onValue,
  update,
  VideoItem,
  WORKER_BASE_URL,
} from './firebase';
import {
  NativeBannerAd,
  Banner320x50Ad,
  SocialBarLoader,
  triggerSmartlinkAd,
} from './components/AdUnits';
import { ProtectedVideoPlayer } from './components/ProtectedVideoPlayer';
import { VideoCard } from './components/VideoCard';
import { AdminPanel } from './components/AdminPanel';
import { PromptModal } from './components/PromptModal';
import {
  Play,
  Search,
  ArrowLeft,
  Shield,
  FileCode2,
  Film,
  Lock,
} from 'lucide-react';

const INITIAL_DEMO_VIDEOS: VideoItem[] = [
  {
    id: 'ghost-stream-1',
    title: 'Neon Horizon: Midnight Drift in Tokyo',
    description:
      'High-contrast 4K cinema reel shot on 35mm anamorphic lenses through rain-slicked Shibuya streets. Protected stream hosted via Cloudflare R2 and synced with Firebase Realtime Database.',
    category: 'Cinema',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    duration: '00:15',
    views: 18420,
    createdAt: Date.now() - 3600000 * 12,
    author: 'MrGhost Studio',
  },
  {
    id: 'ghost-stream-2',
    title: 'Volcanic Coast: Black Sand & Atlantic Storm',
    description:
      'Aerial documentary cinematography capturing raw ocean swells crashing against basalt cliffs at golden hour.',
    category: 'Documentary',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    duration: '00:15',
    views: 12390,
    createdAt: Date.now() - 3600000 * 24,
    author: 'MrGhost Studio',
  },
  {
    id: 'ghost-stream-3',
    title: 'Endurance GT Prototype: Wet Track Telemetry',
    description:
      'Trackside high-speed panning showcase of matte-black endurance prototypes testing under dusk floodlights.',
    category: 'Trending',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    duration: '01:00',
    views: 29150,
    createdAt: Date.now() - 3600000 * 36,
    author: 'MrGhost Studio',
  },
  {
    id: 'ghost-stream-4',
    title: 'Analog Mastering Suite: Studio Hardware Session',
    description:
      'Behind-the-scenes sound design and color grading workflow inside an acoustic dark-slate mastering room.',
    category: 'Exclusive',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoy.mp4',
    duration: '00:15',
    views: 9840,
    createdAt: Date.now() - 3600000 * 48,
    author: 'MrGhost Studio',
  },
  {
    id: 'ghost-stream-5',
    title: 'Cybernetic Synth Live: Warehouse Visual Reel',
    description:
      'Live modular synthesizer performance paired with synchronized laser projection mapping.',
    category: 'Music & Live',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
    duration: '00:15',
    views: 15620,
    createdAt: Date.now() - 3600000 * 60,
    author: 'MrGhost Studio',
  },
  {
    id: 'ghost-stream-6',
    title: 'Alpine Ridge: High-Altitude Expedition Log',
    description:
      'Unfiltered expedition footage crossing glaciated granite ridges above 4,200 meters.',
    category: 'Documentary',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackSeeTheWorld.mp4',
    duration: '00:59',
    views: 21700,
    createdAt: Date.now() - 3600000 * 72,
    author: 'MrGhost Studio',
  },
];

type ViewMode = 'home' | 'watch' | 'admin';

export default function App() {
  // Detect if URL path or query is `ad.html`
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const path = window.location.pathname.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    if (path.endsWith('/ad.html') || hash.includes('ad.html')) {
      return 'admin';
    }
    return 'home';
  });

  const [videos, setVideos] = useState<VideoItem[]>(INITIAL_DEMO_VIDEOS);
  const [loadingVideos, setLoadingVideos] = useState<boolean>(true);
  const [activeVideo, setActiveVideo] = useState<VideoItem | null>(null);

  // Per-video Smartlink click counter (requires 3 clicks to open watch page)
  const [smartlinkCounts, setSmartlinkCounts] = useState<Record<string, number>>({});
  const [gateNotice, setGateNotice] = useState<string | null>(null);

  // Filtering and Search on Home
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Prompt Blueprint Modal
  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false);

  // Sync videos from Firebase Realtime Database (`video-platform-7c031`)
  useEffect(() => {
    const videosRef = ref(db, 'videos');
    const unsubscribe = onValue(
      videosRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data && typeof data === 'object') {
          const parsed: VideoItem[] = Object.entries(data).map(([key, val]: [string, any]) => ({
            id: key,
            title: val.title || 'Untitled Stream',
            description: val.description || 'Protected stream hosted on Cloudflare R2.',
            category: val.category || 'Cinema',
            videoUrl: val.videoUrl || '',
            r2Key: val.r2Key,
            thumbnailUrl: val.thumbnailUrl,
            duration: val.duration || '03:30',
            views: Number(val.views) || 1,
            createdAt: Number(val.createdAt) || Date.now(),
            author: val.author || 'Admin',
          }));
          // Sort newest first
          parsed.sort((a, b) => b.createdAt - a.createdAt);
          setVideos(parsed.length > 0 ? parsed : INITIAL_DEMO_VIDEOS);
        } else {
          setVideos(INITIAL_DEMO_VIDEOS);
        }
        setLoadingVideos(false);
      },
      (err) => {
        console.warn('Firebase RTDB read fallback:', err.message);
        setVideos(INITIAL_DEMO_VIDEOS);
        setLoadingVideos(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Handle clicking any video card (Home or Suggested videos) -> 3 Smartlink clicks required before opening Video Watch Page
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
        setGateNotice(
          `Smartlink Ad ${nextClicks}/3 opened for "${video.title}". Click ${
            3 - nextClicks
          } more time(s) to open the video page.`
        );
        return;
      }
    }

    // Once 3 Smartlink clicks are completed, navigate to the Video Watch Page
    setGateNotice(null);
    setActiveVideo(video);
    setViewMode('watch');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Increment Firebase view count when video starts playing after 3 Popunder clicks
  const handleVideoPlaySuccess = (video: VideoItem) => {
    try {
      if (!video.id.startsWith('ghost-stream-')) {
        update(ref(db, `videos/${video.id}`), {
          views: (video.views || 0) + 1,
        }).catch(() => {});
      }
    } catch {
      // ignore if demo item
    }
  };

  const categories = useMemo(() => {
    const set = new Set<string>(['All', 'Cinema', 'Trending', 'Documentary', 'Exclusive', 'Music & Live']);
    videos.forEach((v) => {
      if (v.category) set.add(v.category);
    });
    return Array.from(set);
  }, [videos]);

  const filteredVideos = useMemo(() => {
    return videos.filter((v) => {
      const matchesCategory =
        selectedCategory === 'All' || v.category.toLowerCase() === selectedCategory.toLowerCase();
      const matchesSearch =
        !searchQuery.trim() ||
        v.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.category.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [videos, selectedCategory, searchQuery]);

  const featuredVideo = filteredVideos[0] || videos[0];

  // Suggested videos shown below the active player on the Watch page
  const suggestedVideos = useMemo(() => {
    if (!activeVideo) return videos;
    return videos.filter((v) => v.id !== activeVideo.id);
  }, [videos, activeVideo]);

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 flex flex-col">
      {/* Social Bar Ad only activates on Watch page so Index strictly has ONLY the Native Banner */}
      <SocialBarLoader active={viewMode === 'watch'} />

      {/* Top Bar Contract: 3 Zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-zinc-900 bg-[#050505]/95 backdrop-blur-md sticky top-0 z-40">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#home"
          onClick={(e) => {
            e.preventDefault();
            setViewMode('home');
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 font-display"
        >
          GhostStream
        </a>

        {/* Zone 2: 4–5 clean single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400">
          <a
            href="#discover"
            onClick={(e) => {
              e.preventDefault();
              setSelectedCategory('All');
              setViewMode('home');
            }}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Discover
          </a>
          <a
            href="#trending"
            onClick={(e) => {
              e.preventDefault();
              setSelectedCategory('Trending');
              setViewMode('home');
            }}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Trending
          </a>
          <a
            href="#cinema"
            onClick={(e) => {
              e.preventDefault();
              setSelectedCategory('Cinema');
              setViewMode('home');
            }}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Cinema
          </a>
          <a
            href="#prompt"
            onClick={(e) => {
              e.preventDefault();
              setIsPromptModalOpen(true);
            }}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Platform Prompt
          </a>
          <a
            href="#ad.html"
            onClick={(e) => {
              e.preventDefault();
              setViewMode('admin');
            }}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            ad.html
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'admin' ? 'home' : 'admin')}
            className="px-4 py-2 text-xs font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {viewMode === 'admin' ? 'Exit Admin' : 'Admin Upload'}
          </button>
        </div>
      </header>

      {/* Smartlink 3-Click Gate Notification Toast */}
      {gateNotice && (
        <div className="bg-zinc-900/95 border-b border-zinc-800 px-6 py-2.5 text-xs text-zinc-200 flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono">
            <Shield className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{gateNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setGateNotice(null)}
            className="text-zinc-400 hover:text-white ml-4 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Content Viewport */}
      <main className="flex-1">
        {viewMode === 'admin' && (
          <AdminPanel videos={videos} onCloseAdmin={() => setViewMode('home')} />
        )}

        {viewMode === 'home' && (
          <div className="max-w-[1360px] mx-auto px-6 py-8 space-y-10">
            {/* Split-Screen Hero Showcase */}
            {featuredVideo && (
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch pb-8 border-b border-zinc-900">
                {/* Left Column: Typographic Hierarchy */}
                <div className="lg:col-span-5 flex flex-col justify-between space-y-6 py-2">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
                      <span>FEATURED STREAM</span>
                      <span aria-hidden="true">·</span>
                      <span>{featuredVideo.category.toUpperCase()}</span>
                    </div>

                    <h1
                      className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-white leading-[1.12] font-display"
                      style={{ textWrap: 'balance' }}
                    >
                      {featuredVideo.title}
                    </h1>

                    <p className="text-sm text-zinc-400 leading-relaxed max-w-xl">
                      {featuredVideo.description}
                    </p>
                  </div>

                  <div className="space-y-4 pt-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleVideoCardClick(featuredVideo)}
                        className="px-5 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        <span>
                          {(smartlinkCounts[featuredVideo.id] || 0) < 3
                            ? `Watch Stream (Smartlink ${
                                smartlinkCounts[featuredVideo.id] || 0
                              }/3)`
                            : 'Open Stream Page'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsPromptModalOpen(true)}
                        className="px-4 py-2.5 rounded-lg border border-zinc-800 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <FileCode2 className="w-4 h-4 text-rose-500" />
                        <span>View Website Prompt</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono">
                      <span>Duration {featuredVideo.duration}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {featuredVideo.views.toLocaleString()} views
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Download Protected</span>
                    </div>
                  </div>
                </div>

                {/* Right Column: Matching Height Featured Visual Container */}
                <div
                  onClick={() => handleVideoCardClick(featuredVideo)}
                  className="lg:col-span-7 relative rounded-2xl border border-zinc-800 bg-gradient-to-br from-rose-950/60 via-zinc-900 to-zinc-950 overflow-hidden cursor-pointer group min-h-[280px] lg:h-full flex items-center justify-center"
                >
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center pointer-events-none">
                    <Film className="w-16 h-16 text-zinc-800 mb-3 group-hover:scale-105 transition-transform" />
                    <span className="text-xs font-mono text-zinc-500 tracking-widest uppercase">
                      CLOUDFLARE R2 · FIREBASE RTDB STREAM
                    </span>
                  </div>

                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

                  <div className="relative z-10 flex flex-col items-center">
                    <div className="w-16 h-16 rounded-full bg-rose-600 group-hover:bg-rose-500 text-white flex items-center justify-center shadow-2xl transition-transform duration-150 group-hover:scale-110">
                      <Play className="w-7 h-7 fill-white ml-0.5" />
                    </div>
                    <span className="mt-3 text-xs font-mono text-zinc-300">
                      {(smartlinkCounts[featuredVideo.id] || 0) < 3
                        ? `Click ${3 - (smartlinkCounts[featuredVideo.id] || 0)}x to Unlock Watch Page`
                        : 'Unlocked · Click to Watch'}
                    </span>
                  </div>

                  <div className="absolute bottom-4 inset-x-5 flex items-center justify-between text-xs text-zinc-300 font-mono">
                    <span>{featuredVideo.author}</span>
                    <span>{featuredVideo.duration}</span>
                  </div>
                </div>
              </section>
            )}

            {/* Index Page Native Banner Ad ONLY (Strictly per user rule: "fast a index a ads thakbe na just narrative bannaer thkabe") */}
            <NativeBannerAd />

            {/* Workspace Toolbar: Category Filter Tabs + Search Input */}
            <section className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-1 p-1 bg-zinc-900/90 border border-zinc-800/80 rounded-lg overflow-x-auto">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      selectedCategory === cat
                        ? 'bg-zinc-100 text-zinc-950 shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="relative w-full md:w-72">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search videos or categories..."
                  className="w-full pl-9 pr-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                />
              </div>
            </section>

            {/* Video Grid Section */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">
                  {selectedCategory === 'All' ? 'All Streaming Videos' : selectedCategory}
                </h2>
                <span className="text-xs font-mono text-zinc-500 tabular-nums">
                  {filteredVideos.length} videos available
                </span>
              </div>

              {loadingVideos ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <div
                      key={n}
                      className="h-64 rounded-2xl border border-zinc-900 bg-zinc-950 animate-pulse"
                    />
                  ))}
                </div>
              ) : filteredVideos.length === 0 ? (
                <div className="py-16 text-center border border-dashed border-zinc-900 rounded-2xl space-y-3">
                  <p className="text-sm text-zinc-400">
                    No videos match your current filter.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory('All');
                      setSearchQuery('');
                    }}
                    className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-xs text-white cursor-pointer"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredVideos.map((video) => (
                    <VideoCard
                      key={video.id}
                      video={video}
                      smartlinkClicks={smartlinkCounts[video.id] || 0}
                      onCardClick={handleVideoCardClick}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* Video Watch Page */}
        {viewMode === 'watch' && activeVideo && (
          <div className="max-w-[1360px] mx-auto px-6 py-8 space-y-10">
            {/* Back Navigation & 320x50 Banner Ad */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => setViewMode('home')}
                className="px-3.5 py-2 rounded-lg border border-zinc-800 bg-zinc-900/70 hover:bg-zinc-800 text-xs font-medium text-zinc-200 flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Video Feed</span>
              </button>

              {/* 320x50 Banner Ad placed on the Watch Page */}
              <Banner320x50Ad className="my-0" />
            </div>

            {/* Protected Video Player (with 3-click Popunder Play button gate & anti-download) */}
            <section className="space-y-5">
              <ProtectedVideoPlayer
                videoId={activeVideo.id}
                videoUrl={activeVideo.videoUrl}
                title={activeVideo.title}
                poster={activeVideo.thumbnailUrl}
                onPlaySuccess={() => handleVideoPlaySuccess(activeVideo)}
              />

              {/* Video Metadata Header */}
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 pb-6 border-b border-zinc-900">
                <div className="space-y-2 max-w-3xl">
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white font-display">
                    {activeVideo.title}
                  </h1>
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <span>{activeVideo.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {activeVideo.views.toLocaleString()} views
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Uploaded by {activeVideo.author}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-rose-400 flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Download Disabled
                    </span>
                  </div>
                  <p className="text-sm text-zinc-400 pt-2 leading-relaxed">
                    {activeVideo.description}
                  </p>
                </div>

                {/* Secondary 320x50 Banner Slot */}
                <div className="shrink-0">
                  <Banner320x50Ad className="my-0" />
                </div>
              </div>
            </section>

            {/* Native Banner Ad between Player and Suggested Videos */}
            <NativeBannerAd />

            {/* Suggested Videos Below Player ("video ar neche onno video golaa show/suggest korbe chaile click kora jabe") */}
            <section className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Suggested Videos
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Click any suggested video (3x Smartlink gate) to switch stream
                  </p>
                </div>
                <span className="text-xs font-mono text-zinc-500 tabular-nums">
                  {suggestedVideos.length} suggestions
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {suggestedVideos.map((video) => (
                  <VideoCard
                    key={video.id}
                    video={video}
                    smartlinkClicks={smartlinkCounts[video.id] || 0}
                    onCardClick={handleVideoCardClick}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-zinc-900 py-8 px-6 mt-16 text-xs text-zinc-500">
        <div className="max-w-[1360px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-300">GhostStream</span>
            <span aria-hidden="true">·</span>
            <span>Firebase RTDB (`video-platform-7c031`)</span>
            <span aria-hidden="true">·</span>
            <span>Cloudflare R2 (`{WORKER_BASE_URL.replace('https://', '')}`)</span>
          </div>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setIsPromptModalOpen(true)}
              className="hover:text-zinc-300 transition-colors cursor-pointer"
            >
              Website Prompt
            </button>
            <button
              type="button"
              onClick={() => setViewMode('admin')}
              className="hover:text-zinc-300 transition-colors cursor-pointer"
            >
              Admin Panel (ad.html)
            </button>
          </div>
        </div>
      </footer>

      {/* Copyable Master Website Prompt Modal */}
      <PromptModal
        isOpen={isPromptModalOpen}
        onClose={() => setIsPromptModalOpen(false)}
      />
    </div>
  );
}
