import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, AlertCircle, CheckCircle2, ShieldAlert, Timer } from 'lucide-react';
import { VideoItem, db, ref, runTransaction } from '../firebase';
import { Banner320x50Ad, triggerPopunderAd, useAdFreeVip } from './AdUnits';

interface ThreeButtonGateScreenProps {
  video: VideoItem;
  onUnlock: (video: VideoItem) => void;
  onBack: () => void;
  onBypassDetected?: (bypassCount: number) => void;
  userCoins?: number;
  onGoToProfile?: () => void;
}

const SMARTLINKS = [
  'https://auctionr.org/4/80cdada28d438b51a0e96e917763f683',
  'https://auctionr.org/4/5ad4cd88923c063b5b21a813a4822ed8',
  'https://auctionr.org/4/8746da2e2590f7ab0f808a8e3d2568c0',
];

const BUTTONS = [
  { id: 'hd', label: 'Download Video HD', img: '/images/buttons/btn-hd.png' },
  { id: '1080p', label: 'Download Video 1080p', img: '/images/buttons/btn-1080p.png' },
  { id: '4k', label: 'Download Video 4K', img: '/images/buttons/btn-4k.png' },
];

const MIN_AD_VIEW_MS = 5000;
const LAST_WIN_BTN_STORAGE_KEY = 'xtube_last_gate_win_idx';

const pickNextRandomWinningIndex = (): number => {
  try {
    const rawPrev = localStorage.getItem(LAST_WIN_BTN_STORAGE_KEY);
    const prevIdx = rawPrev !== null ? parseInt(rawPrev, 10) : -1;
    // On first visit pick from [1, 2]; on subsequent videos strictly avoid repeating prevIdx so it changes every time
    const candidates =
      prevIdx >= 0 && prevIdx <= 2 ? [0, 1, 2].filter((idx) => idx !== prevIdx) : [1, 2];
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    localStorage.setItem(LAST_WIN_BTN_STORAGE_KEY, String(chosen));
    return chosen;
  } catch {
    return 1;
  }
};

export const ThreeButtonGateScreen: React.FC<ThreeButtonGateScreenProps> = ({
  video,
  onUnlock,
  onBack,
  onBypassDetected,
  userCoins = 0,
  onGoToProfile,
}) => {
  const { isAdFree } = useAdFreeVip();
  const isFakePopupMode = Boolean(
    video.isFakePopup || String(video.id || '').startsWith('fake_') || !video.url
  );

  // Active smartlinks pool (uses custom ad links if provided on fake popup, otherwise default SMARTLINKS)
  const activeSmartlinks =
    Array.isArray(video.fakeSmartlinks) && video.fakeSmartlinks.filter(Boolean).length > 0
      ? video.fakeSmartlinks.filter(Boolean)
      : SMARTLINKS;

  // Exactly 1 random button out of 3 holds the original video link per video (strictly rotates every video)
  const prevVideoIdRef = useRef<string>(video.id);
  const [winningIndex, setWinningIndex] = useState<number>(() =>
    isFakePopupMode ? -1 : pickNextRandomWinningIndex()
  );
  const [smartlinkIndex, setSmartlinkIndex] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'info' | 'success' | 'warning' | 'danger'>('info');
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [foundWinningButtonIdx, setFoundWinningButtonIdx] = useState<number | null>(null);
  const [checkedButtons, setCheckedButtons] = useState<Record<number, boolean>>({});

  // Strict Anti-Bypass Ad Load Verification state
  const [verifyingAd, setVerifyingAd] = useState<boolean>(false);
  const [verifyCountdown, setVerifyCountdown] = useState<number>(5);
  const [pendingUnlockIndex, setPendingUnlockIndex] = useState<number | null>(null);

  const adClickTimestampRef = useRef<number>(0);
  const didLeaveForAdRef = useRef<boolean>(false);
  const bypassAttemptCountRef = useRef<number>(0);
  const verifyingAdRef = useRef<boolean>(false);
  const pendingUnlockIndexRef = useRef<number | null>(null);
  const winningIndexRef = useRef<number>(winningIndex);
  const onUnlockRef = useRef(onUnlock);
  const onBypassDetectedRef = useRef(onBypassDetected);
  const videoRef = useRef(video);

  useEffect(() => {
    onUnlockRef.current = onUnlock;
  }, [onUnlock]);

  useEffect(() => {
    onBypassDetectedRef.current = onBypassDetected;
  }, [onBypassDetected]);

  useEffect(() => {
    videoRef.current = video;
  }, [video]);

  useEffect(() => {
    winningIndexRef.current = winningIndex;
  }, [winningIndex]);

  useEffect(() => {
    verifyingAdRef.current = verifyingAd;
  }, [verifyingAd]);

  useEffect(() => {
    pendingUnlockIndexRef.current = pendingUnlockIndex;
  }, [pendingUnlockIndex]);

  // 1. Hardware & Browser Back-Button Trap: Prevents pressing back to bypass the ad gate
  useEffect(() => {
    const handlePopState = () => {
      if (!isSuccess) {
        try {
          window.history.pushState({ gateTrap: true }, '', window.location.href);
        } catch { }
        setToastType('danger');
        setToastMessage(
          '⚠️ ব্যাক করলে ভিডিও আনলক হবে না! ভিডিও দেখতে নিচের বাটনে ক্লিক করে অ্যাড পেজে অন্তত ৫ সেকেন্ড অপেক্ষা করুন।'
        );
      }
    };

    try {
      window.history.pushState({ gateTrap: true }, '', window.location.href);
    } catch { }

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isSuccess]);

  // 2. Auto-bypass if user has active VIP (ONLY for real videos, NEVER for Fake Pop-Up Links)
  useEffect(() => {
    if (isAdFree && !isFakePopupMode) {
      onUnlockRef.current(videoRef.current);
    }
  }, [isAdFree, isFakePopupMode]);

  // Rotate winning index ONLY when video.id actually changes
  useEffect(() => {
    if (prevVideoIdRef.current === video.id) return;
    prevVideoIdRef.current = video.id;
    const nextWin = isFakePopupMode ? -1 : pickNextRandomWinningIndex();
    setWinningIndex(nextWin);
    winningIndexRef.current = nextWin;
    setToastMessage(null);
    setIsSuccess(false);
    setFoundWinningButtonIdx(null);
    setCheckedButtons({});
    setVerifyingAd(false);
    verifyingAdRef.current = false;
    setVerifyCountdown(5);
    setPendingUnlockIndex(null);
    pendingUnlockIndexRef.current = null;
    didLeaveForAdRef.current = false;
    adClickTimestampRef.current = 0;
  }, [video.id, isFakePopupMode]);

  // Complete or reject button verification ONLY when user returns after viewing the ad
  const evaluateAdReturn = () => {
    if (!verifyingAdRef.current || pendingUnlockIndexRef.current === null) return;

    const btnIdx = pendingUnlockIndexRef.current;
    const elapsedMs = Date.now() - adClickTimestampRef.current;
    const didLeave = didLeaveForAdRef.current;

    // Must have actually left the tab/app to view the ad AND stayed >= 5 seconds!
    if (!didLeave || elapsedMs < MIN_AD_VIEW_MS) {
      bypassAttemptCountRef.current += 1;
      const count = bypassAttemptCountRef.current;

      verifyingAdRef.current = false;
      setVerifyingAd(false);
      pendingUnlockIndexRef.current = null;
      setPendingUnlockIndex(null);
      didLeaveForAdRef.current = false;

      const secSpent = Math.max(0, Math.floor(elapsedMs / 1000));
      setToastType('danger');
      setToastMessage(
        !didLeave
          ? '⚠️ অ্যাড লোড হয়নি বা পপআপ ব্লক হয়েছে! অ্যাড পেজে গিয়ে অন্তত ৫ সেকেন্ড অ্যাড দেখুন, নাহলে কাজ করবে না।'
          : `⚠️ অ্যাড লোড হওয়ার আগেই ব্যাক করেছেন (${secSpent}s)! (${count}x ধরা পড়েছে) — কাজ করতে হলে অ্যাড পেজে অন্তত ৫ সেকেন্ড থাকতেই হবে!`
      );

      if (count >= 2 && onBypassDetectedRef.current) {
        onBypassDetectedRef.current(count);
      }
      return;
    }

    // User legitimately spent >= 5 seconds viewing the ad!
    verifyingAdRef.current = false;
    setVerifyingAd(false);
    pendingUnlockIndexRef.current = null;
    setPendingUnlockIndex(null);
    didLeaveForAdRef.current = false;

    if (!isFakePopupMode && btnIdx === winningIndexRef.current) {
      setIsSuccess(true);
      setFoundWinningButtonIdx(btnIdx);
      setToastType('success');
      setToastMessage('✓ সার্ভার কানেক্ট হয়েছে! ভিডিও প্লে হচ্ছে...');
      setTimeout(() => {
        onUnlockRef.current(videoRef.current);
      }, 900);
    } else if (isFakePopupMode) {
      setCheckedButtons((prev) => ({ ...prev, [btnIdx]: true }));
      setToastType('warning');
      setToastMessage('⚠️ সার্ভার সমস্যার কারণে এই লিংকে ভিডিও প্লে হচ্ছে না! অনুগ্রহ করে অন্য বাটনগুলোতে ট্রাই করুন।');
    } else {
      setCheckedButtons((prev) => ({ ...prev, [btnIdx]: true }));
      setToastType('warning');
      setToastMessage('⚠️ সার্ভার সমস্যার কারণে এই লিংকে ভিডিও প্লে হচ্ছে না! অনুগ্রহ করে অন্য বাটনগুলোতে ট্রাই করুন।');
    }
  };

  // 3. Strict Leave & Return Listeners (visibilitychange + blur/focus for Mobile/Desktop/Telegram WebView)
  useEffect(() => {
    const handleLeave = () => {
      if (verifyingAdRef.current) {
        didLeaveForAdRef.current = true;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleLeave();
      } else if (document.visibilityState === 'visible') {
        if (verifyingAdRef.current) {
          evaluateAdReturn();
        }
      }
    };

    const handleWindowBlur = () => {
      handleLeave();
    };

    const handleWindowFocus = () => {
      if (verifyingAdRef.current && didLeaveForAdRef.current) {
        evaluateAdReturn();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [isFakePopupMode]);

  // 4. Visual countdown display + timeout safety if user didn't leave at all (blocked popup)
  useEffect(() => {
    if (!verifyingAd) return;

    const timer = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - adClickTimestampRef.current) / 1000);
      const rem = Math.max(0, 5 - elapsedSec);
      setVerifyCountdown(rem);

      // If 3+ seconds passed on THIS page and the user NEVER left to the ad tab, popup was blocked or ignored!
      if (elapsedSec >= 3 && !didLeaveForAdRef.current) {
        clearInterval(timer);
        evaluateAdReturn();
      }
    }, 500);

    return () => clearInterval(timer);
  }, [verifyingAd]);

  const handleButtonClick = (buttonIndex: number) => {
    if (isSuccess || checkedButtons[buttonIndex]) return;

    // If previous verification got stuck without leaving, reset it cleanly
    if (verifyingAdRef.current) {
      const elapsed = Date.now() - adClickTimestampRef.current;
      if (elapsed < 2500) return;
    }

    adClickTimestampRef.current = Date.now();
    didLeaveForAdRef.current = false;
    pendingUnlockIndexRef.current = buttonIndex;
    setPendingUnlockIndex(buttonIndex);
    verifyingAdRef.current = true;
    setVerifyingAd(true);
    setVerifyCountdown(5);

    // Trigger Popunder Ad
    triggerPopunderAd();

    if (isFakePopupMode && video.id && String(video.id).startsWith('fake_')) {
      runTransaction(ref(db, `fakeLinks/${video.id}/clicks`), (curr) => (Number(curr) || 0) + 1).catch(
        () => { }
      );
    }

    // Select current Smartlink
    const chosenSmartlink =
      activeSmartlinks[(buttonIndex + smartlinkIndex) % activeSmartlinks.length] || SMARTLINKS[0];
    setSmartlinkIndex((prev) => (prev + 1) % activeSmartlinks.length);

    // Open Smartlink in new window or Telegram Mini App
    let openedWin: Window | null = null;
    try {
      const tgWebApp = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : undefined;
      if (tgWebApp && tgWebApp.initData && typeof tgWebApp.openLink === 'function') {
        tgWebApp.openLink(chosenSmartlink, { try_instant_view: false });
        didLeaveForAdRef.current = true;
      } else {
        openedWin = window.open(chosenSmartlink, '_blank', 'noopener,noreferrer');
        if (openedWin) {
          didLeaveForAdRef.current = true;
        }
      }
    } catch {
      openedWin = window.open(chosenSmartlink, '_blank');
      if (openedWin) {
        didLeaveForAdRef.current = true;
      }
    }

    setToastType('info');
    setToastMessage(
      '⏳ অ্যাড ওপেন হয়েছে! মূল লিংক পেতে অ্যাড পেজ লোড হওয়ার পর অন্তত ৫ সেকেন্ড অপেক্ষা করে তারপর ব্যাক করুন।'
    );
  };

  return (
    <div className="min-h-[85vh] w-full flex items-center justify-center p-3 sm:p-6 pb-24 sm:pb-20 select-none animate-fadeIn">
      <div className="w-full max-w-[520px] bg-white text-slate-900 rounded-3xl p-4 sm:p-6 shadow-2xl border-4 border-slate-200/90 flex flex-col items-center relative overflow-hidden">
        {/* Top Header: Back Button & Video Title */}
        <div className="w-full flex items-center justify-between gap-3 pb-3 border-b border-slate-200 mb-2">
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

        {/* Coin Bypass Hint Banner when user has < 2 coins */}
        {!isFakePopupMode && userCoins < 2 && (
          <div className="w-full px-3 py-2 rounded-xl bg-amber-50 border border-amber-300/80 flex items-center justify-between gap-2 mb-2 text-[11px]">
            <span className="text-amber-900 font-semibold">
              🪙 আপনার কয়েন: <strong>{userCoins}</strong> (অ্যাড ছাড়া দেখতে ২ কয়েন লাগে)
            </span>
            {onGoToProfile && (
              <button
                type="button"
                onClick={onGoToProfile}
                className="px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[10px] shrink-0 cursor-pointer"
              >
                কয়েন নিন →
              </button>
            )}
          </div>
        )}

        {/* 1. Header Banner */}
        <div className="w-full flex items-center justify-center my-2">
          <img
            src="/images/buttons/header-banner.png"
            alt="ভিডিও দেখার জন্য নিচের বাটনে ক্লিক করুন"
            className="w-full max-w-[420px] h-auto object-contain drop-shadow select-none pointer-events-none"
          />
        </div>

        {/* Top Ad Unit */}
        <Banner320x50Ad className="my-1" />

        {/* Anti-Bypass Live Verification Timer Status */}
        {verifyingAd && (
          <div className="w-full max-w-[460px] p-3 rounded-2xl bg-amber-50 border-2 border-amber-400 text-amber-950 flex items-center justify-between gap-3 my-2 shadow-lg animate-pulse">
            <div className="flex items-center gap-2">
              <Timer className="w-5 h-5 text-amber-600 animate-spin" />
              <div>
                <p className="text-xs font-bold">অ্যাড পেজে ৫ সেকেন্ড অপেক্ষা করুন...</p>
                <p className="text-[10px] text-amber-800">অ্যাড লোড না হয়েই ব্যাক করলে কাজ করবে না!</p>
              </div>
            </div>
            <div className="w-10 h-10 rounded-full bg-amber-500 text-white font-mono font-extrabold flex items-center justify-center text-base shadow">
              {verifyCountdown}s
            </div>
          </div>
        )}

        {/* Dynamic Feedback Toast */}
        {toastMessage && !verifyingAd && (
          <div
            className={`w-full max-w-[460px] p-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 my-2 transition-all shadow-md ${
              toastType === 'success'
                ? 'bg-emerald-100 text-emerald-800 border-2 border-emerald-400'
                : toastType === 'danger'
                ? 'bg-rose-100 text-rose-900 border-2 border-rose-400 animate-bounce'
                : toastType === 'warning'
                ? 'bg-amber-100 text-amber-900 border-2 border-amber-300'
                : 'bg-sky-100 text-sky-900 border-2 border-sky-300'
            }`}
          >
            {toastType === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : toastType === 'danger' ? (
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            )}
            <span className="text-center">{toastMessage}</span>
          </div>
        )}

        {/* 2. Exactly 3 Buttons Stacked Vertically (1 random button has the original video link) */}
        <div className="w-full max-w-[440px] flex flex-col items-center gap-3 my-2">
          {BUTTONS.map((btn, index) => {
            const hasBeenCheckedAndEmpty = Boolean(checkedButtons[index]);
            const isWinningBtn = foundWinningButtonIdx === index;
            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => handleButtonClick(index)}
                disabled={isSuccess || hasBeenCheckedAndEmpty}
                className={`w-full transform transition-all duration-150 focus:outline-none drop-shadow-md relative rounded-full ${
                  hasBeenCheckedAndEmpty
                    ? 'opacity-45 cursor-not-allowed grayscale'
                    : isWinningBtn
                    ? 'ring-4 ring-emerald-400 scale-[1.02] cursor-default'
                    : 'hover:scale-[1.02] active:scale-95 cursor-pointer hover:drop-shadow-xl'
                }`}
                title={btn.label}
              >
                <img
                  src={btn.img}
                  alt={btn.label}
                  className="w-full h-auto object-contain select-none pointer-events-none rounded-full"
                />
                {hasBeenCheckedAndEmpty && !isSuccess && (
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 px-2.5 py-0.5 rounded-full bg-slate-900/95 text-rose-300 border border-rose-500/50 text-[10px] font-mono font-bold shadow">
                    Server Error ✖
                  </span>
                )}
                {isWinningBtn && (
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 px-3 py-1 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-mono font-black shadow-lg">
                    ✅ Server Ready!
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 3. Exact Yellow Notice Card Banner */}
        <div className="w-full flex items-center justify-center mt-2 mb-1">
          <img
            src="/images/buttons/notice-banner.png"
            alt="মাঝে মাঝে Server এর সমস্যার জন্য একটা লিংক কাজ করে না, তাই সব কয়টা লিংকে ট্রাই করবেন"
            className="w-full max-w-[460px] h-auto object-contain drop-shadow select-none pointer-events-none"
          />
        </div>

        {/* Bottom Ad Unit */}
        <Banner320x50Ad className="my-1" />

        {/* Anti-Bypass Rules Sub-Note */}
        <p className="text-[10px] text-slate-500 font-medium text-center mt-1.5 flex items-center justify-center gap-1">
          <span>🔒 সিকিউর সার্ভার · কোনো লিংক কাজ না করলে অন্য বাটনে ট্রাই করুন (অ্যাড ৫ সেকেন্ড না দেখে ব্যাক করলে কাজ করবে না)</span>
        </p>
      </div>
    </div>
  );
};
