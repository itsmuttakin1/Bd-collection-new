import React, { useState, useEffect } from 'react';
import { ArrowLeft, AlertCircle, CheckCircle2, Flame, ShieldAlert, Sparkles, ExternalLink, RefreshCw } from 'lucide-react';
import { VideoItem, db, ref, runTransaction } from '../firebase';
import { Banner320x50Ad, triggerPopunderAd, useAdFreeVip } from './AdUnits';

interface ThreeButtonGateScreenProps {
  video: VideoItem;
  onUnlock: (video: VideoItem) => void;
  onBack: () => void;
}

const SMARTLINKS = [
  'https://auctionr.org/4/80cdada28d438b51a0e96e917763f683',
  'https://auctionr.org/4/5ad4cd88923c063b5b21a813a4822ed8',
  'https://auctionr.org/4/8746da2e2590f7ab0f808a8e3d2568c0',
];

interface GateButtonConfig {
  id: string;
  label: string;
  subLabel?: string;
  img?: string;
  variant?: 'image' | 'gradient-red' | 'gradient-green' | 'gradient-blue' | 'gradient-purple' | 'gradient-amber';
}

const GATE_BUTTONS: GateButtonConfig[] = [
  { id: 'hd', label: 'Download Video HD', img: '/images/buttons/btn-hd.png', variant: 'image' },
  { id: 'fast_cdn', label: '⚡ Fast CDN Server 1 (1080p)', subLabel: 'High Speed Direct Buffer', variant: 'gradient-red' },
  { id: '1080p', label: 'Download Video 1080p', img: '/images/buttons/btn-1080p.png', variant: 'image' },
  { id: 'cloud_mirror', label: '📥 Cloud Mirror 2 (Full Video)', subLabel: 'No Buffering • 60 FPS', variant: 'gradient-green' },
  { id: '4k', label: 'Download Video 4K', img: '/images/buttons/btn-4k.png', variant: 'image' },
  { id: 'vip_stream', label: '👑 VIP Ultra Speed Server', subLabel: 'Instant Play • Exclusive HD', variant: 'gradient-purple' },
  { id: 'direct_stream', label: '▶️ Play Online Stream (Free)', subLabel: 'Mobile & Desktop Friendly', variant: 'gradient-blue' },
  { id: 'backup_cdn', label: '🔒 Backup Server 3 (Unlocked)', subLabel: 'Anti-Freeze Stream', variant: 'gradient-amber' },
];

export const ThreeButtonGateScreen: React.FC<ThreeButtonGateScreenProps> = ({
  video,
  onUnlock,
  onBack,
}) => {
  const { isAdFree } = useAdFreeVip();
  const isFakePopupMode = Boolean(
    video.isFakePopup || String(video.id || '').startsWith('fake_') || !video.url
  );

  // Active smartlinks pool
  const activeSmartlinks =
    Array.isArray(video.fakeSmartlinks) && video.fakeSmartlinks.filter(Boolean).length > 0
      ? video.fakeSmartlinks.filter(Boolean)
      : SMARTLINKS;

  // Real videos pick a random winner among GATE_BUTTONS, fake popup has NO winner (-1)
  const [winningIndex, setWinningIndex] = useState<number>(() =>
    isFakePopupMode ? -1 : Math.floor(Math.random() * GATE_BUTTONS.length)
  );
  const [smartlinkIndex, setSmartlinkIndex] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [clickedButtons, setClickedButtons] = useState<Record<number, boolean>>({});
  const [attemptCount, setAttemptCount] = useState<number>(0);

  // Auto-bypass if user has active VIP (ONLY for real videos, NEVER for Fake Pop-Up Links)
  useEffect(() => {
    if (isAdFree && !isFakePopupMode) {
      onUnlock(video);
    }
  }, [isAdFree, isFakePopupMode, video, onUnlock]);

  // Rotate winning index on video change
  useEffect(() => {
    setWinningIndex(isFakePopupMode ? -1 : Math.floor(Math.random() * GATE_BUTTONS.length));
    setToastMessage(null);
    setIsSuccess(false);
    setClickedButtons({});
    setAttemptCount(0);
  }, [video.id, isFakePopupMode]);

  const handleButtonClick = (buttonIndex: number) => {
    if (isSuccess) return;

    const nextAttempts = attemptCount + 1;
    setAttemptCount(nextAttempts);
    setClickedButtons((prev) => ({ ...prev, [buttonIndex]: true }));

    // User must click at least 2 ad buttons before the winning button can unlock!
    // This maximizes ad impressions & makes link finding delightfully challenging!
    const isReadyForUnlock = nextAttempts >= 2;

    if (!isFakePopupMode && buttonIndex === winningIndex && isReadyForUnlock) {
      setIsSuccess(true);
      setToastMessage('✓ আসল ভিডিও লিঙ্ক ভেরিফাই হয়েছে! ভিডিও চালু হচ্ছে...');
      setTimeout(() => {
        onUnlock(video);
      }, 350);
      return;
    }

    // Trigger Popunder Ad
    triggerPopunderAd();

    if (isFakePopupMode && video.id && String(video.id).startsWith('fake_')) {
      runTransaction(ref(db, `fakeLinks/${video.id}/clicks`), (curr) => (Number(curr) || 0) + 1).catch(
        () => {}
      );
    }

    // Select Smartlink Ad
    const chosenSmartlink =
      activeSmartlinks[(buttonIndex + smartlinkIndex) % activeSmartlinks.length] || SMARTLINKS[0];
    setSmartlinkIndex((prev) => (prev + 1) % activeSmartlinks.length);

    try {
      const tgWebApp = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : undefined;
      if (tgWebApp && tgWebApp.initData && typeof tgWebApp.openLink === 'function') {
        tgWebApp.openLink(chosenSmartlink, { try_instant_view: false });
      } else {
        window.open(chosenSmartlink, '_blank', 'noopener,noreferrer');
      }
    } catch {
      window.open(chosenSmartlink, '_blank');
    }

    // Dynamic challenging feedback messages
    const errorMsgs = [
      '⚠️ এই সার্ভারটি ব্যস্ত! আসল ভিডিও লিংক খুঁজতে নিচের অন্য বাটনে চেষ্টা করুন।',
      '⚠️ ক্যাপচা যাচাই ব্যর্থ হয়েছে! নিচের অন্য কোনো সার্ভারে ক্লিক করুন।',
      '⚠️ সার্ভার ১ এ উচ্চ ট্রাফিক! নিচে অন্য সার্ভার বাটনে ট্রাই করে ভিডিও আনলক করুন।',
      '⚠️ লিঙ্কটি এখনো জেনারেট হয়নি! অন্য বাটনে ক্লিক করে আনলক করার চেষ্টা করুন।',
      '⚠️ সার্ভার সংযোগ বিচ্ছিন্ন! নিচের অন্য বাটনে চাপ দিয়ে রিয়েল লিংক খুঁজুন।',
    ];
    const randMsg = errorMsgs[(nextAttempts - 1) % errorMsgs.length];

    setToastMessage(randMsg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === randMsg ? null : prev));
    }, 4500);
  };

  const triedCount = Object.keys(clickedButtons).length;

  return (
    <div className="min-h-[90vh] w-full flex items-center justify-center p-2.5 sm:p-5 pb-28 sm:pb-20 select-none animate-fadeIn">
      <div className="w-full max-w-[580px] bg-white text-slate-900 rounded-3xl p-3.5 sm:p-6 shadow-2xl border-4 border-slate-200/90 flex flex-col items-center relative overflow-hidden">
        {/* Top Header: Back Button & Video Title */}
        <div className="w-full flex items-center justify-between gap-3 pb-3 border-b border-slate-200 mb-2.5">
          <button
            type="button"
            onClick={onBack}
            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-slate-700" />
            <span>হোমে ফিরুন</span>
          </button>

          <p className="text-xs sm:text-sm font-extrabold text-slate-800 truncate text-right flex-1 min-w-0">
            🎬 {video.title}
          </p>
        </div>

        {/* Status Indicator & Attempt Tracker */}
        <div className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-semibold mb-2">
          <span className="flex items-center gap-1">
            <Flame className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
            <span>আসল লিংক খুঁজতে সব বাটনে ট্রাই করুন:</span>
          </span>
          <span className="px-2 py-0.5 rounded-full bg-amber-200 font-mono font-bold text-amber-950 text-[10px]">
            {triedCount} / {GATE_BUTTONS.length} Tried
          </span>
        </div>

        {/* 1. Exact Red Pill Header Banner */}
        <div className="w-full flex items-center justify-center my-1.5">
          <img
            src="/images/buttons/header-banner.png"
            alt="ভিডিও দেখার জন্য নিচের বাটনে ক্লিক করুন"
            className="w-full max-w-[440px] h-auto object-contain drop-shadow select-none pointer-events-none"
          />
        </div>

        {/* Top Ad Unit */}
        <Banner320x50Ad className="my-1.5" />

        {/* Dynamic Toast Feedback */}
        {toastMessage && (
          <div
            className={`w-full max-w-[500px] p-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 my-2 transition-all shadow-md ${
              isSuccess
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse'
                : 'bg-amber-100 text-amber-900 border border-amber-300'
            }`}
          >
            {isSuccess ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 animate-bounce" />
            )}
            <span className="text-center">{toastMessage}</span>
          </div>
        )}

        {/* 2. Multiple Tricky Buttons Stacked (Image Pills + Gradient Decoys) */}
        <div className="w-full max-w-[480px] flex flex-col items-center gap-3 my-2">
          {GATE_BUTTONS.map((btn, index) => {
            const hasBeenClicked = Boolean(clickedButtons[index]);

            if (btn.variant === 'image' && btn.img) {
              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => handleButtonClick(index)}
                  className="w-full transform hover:scale-[1.02] active:scale-95 transition-all duration-150 cursor-pointer focus:outline-none drop-shadow-md hover:drop-shadow-xl relative rounded-full"
                  title={btn.label}
                >
                  <img
                    src={btn.img}
                    alt={btn.label}
                    className="w-full h-auto object-contain select-none pointer-events-none rounded-full"
                  />
                  {hasBeenClicked && !isSuccess && (
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 px-2.5 py-0.5 rounded-full bg-slate-900/80 text-amber-300 text-[10px] font-mono font-bold">
                      Tried ✖
                    </span>
                  )}
                </button>
              );
            }

            // Styled Decoy Buttons
            const gradientClass =
              btn.variant === 'gradient-red'
                ? 'from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white shadow-red-500/30'
                : btn.variant === 'gradient-green'
                ? 'from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white shadow-emerald-500/30'
                : btn.variant === 'gradient-purple'
                ? 'from-purple-600 to-indigo-700 hover:from-purple-500 hover:to-indigo-600 text-white shadow-purple-500/30'
                : btn.variant === 'gradient-blue'
                ? 'from-blue-600 to-sky-700 hover:from-blue-500 hover:to-sky-600 text-white shadow-blue-500/30'
                : 'from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white shadow-orange-500/30';

            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => handleButtonClick(index)}
                className={`w-full py-3 px-5 rounded-2xl bg-gradient-to-r ${gradientClass} shadow-lg font-bold flex items-center justify-between text-left transition-all duration-150 transform hover:scale-[1.02] active:scale-95 cursor-pointer relative overflow-hidden`}
              >
                <div className="flex flex-col min-w-0 pr-2">
                  <span className="text-xs sm:text-sm font-extrabold truncate">{btn.label}</span>
                  {btn.subLabel && (
                    <span className="text-[10px] text-white/80 font-normal truncate">{btn.subLabel}</span>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  {hasBeenClicked && !isSuccess ? (
                    <span className="px-2 py-0.5 rounded-full bg-black/40 text-amber-300 text-[9px] font-mono font-bold">
                      Tried ✖
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full bg-white/20 text-white text-[10px] font-bold flex items-center gap-1">
                      <span>Server</span>
                      <ExternalLink className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* 3. Exact Yellow Notice Card Banner */}
        <div className="w-full flex items-center justify-center mt-2 mb-1.5">
          <img
            src="/images/buttons/notice-banner.png"
            alt="মাঝে মাঝে Server এর সমস্যার জন্য একটা লিংক কাজ করে না, তাই সব কয়টা লিংকে ট্রাই করবেন"
            className="w-full max-w-[480px] h-auto object-contain drop-shadow select-none pointer-events-none"
          />
        </div>

        {/* Decoy Partner Booster Ad Button */}
        <button
          type="button"
          onClick={() => {
            triggerPopunderAd();
            const sl = activeSmartlinks[smartlinkIndex % activeSmartlinks.length];
            setSmartlinkIndex((p) => (p + 1) % activeSmartlinks.length);
            window.open(sl, '_blank');
          }}
          className="w-full max-w-[480px] my-1.5 p-2.5 rounded-xl bg-slate-900 text-white text-[11px] font-bold flex items-center justify-between border border-slate-700 hover:border-amber-400 transition cursor-pointer"
        >
          <span className="flex items-center gap-1.5 text-amber-300">
            <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            <span>Fast CDN Turbo Unlock (Click to Speed Up)</span>
          </span>
          <span className="text-[10px] text-slate-400 font-mono">AD ↗</span>
        </button>

        {/* Bottom Ad Unit */}
        <Banner320x50Ad className="my-1.5" />

        {/* Footer Sub-Note */}
        <p className="text-[11px] text-slate-500 font-medium text-center mt-2">
          🔒 Secure Protected Stream · সব লিংকে ক্লিক করে আসল ভিডিও লিংকটি খুঁজুন
        </p>
      </div>
    </div>
  );
};
