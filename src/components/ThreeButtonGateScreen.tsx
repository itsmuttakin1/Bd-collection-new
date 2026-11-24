import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, AlertCircle, CheckCircle2, ShieldAlert, Timer } from 'lucide-react';
import { VideoItem, db, ref, runTransaction } from '../firebase';
import { Banner320x50Ad, triggerPopunderAd, useAdFreeVip } from './AdUnits';

interface ThreeButtonGateScreenProps {
  video: VideoItem;
  onUnlock: (video: VideoItem) => void;
  onBack: () => void;
  onBypassDetected?: (bypassCount: number) => void;
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

export const ThreeButtonGateScreen: React.FC<ThreeButtonGateScreenProps> = ({
  video,
  onUnlock,
  onBack,
  onBypassDetected,
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

  // Winning button is randomized every time for normal videos, or -1 (NO winner, 100% Ads) for Fake Pop-Up Links!
  const [winningIndex, setWinningIndex] = useState<number>(() =>
    isFakePopupMode ? -1 : Math.floor(Math.random() * 3)
  );
  const [smartlinkIndex, setSmartlinkIndex] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'info' | 'success' | 'warning' | 'danger'>('info');
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [clickedButtons, setClickedButtons] = useState<Record<number, boolean>>({});

  // Anti-Bypass verification timer & fast-back detection
  const [verifyingAd, setVerifyingAd] = useState<boolean>(false);
  const [verifyCountdown, setVerifyCountdown] = useState<number>(5);
  const [pendingUnlockIndex, setPendingUnlockIndex] = useState<number | null>(null);
  const adClickTimestampRef = useRef<number>(0);
  const bypassAttemptCountRef = useRef<number>(0);
  const verifyTimerIntervalRef = useRef<any>(null);

  // 1. Hardware & Browser Back-Button Trap: Prevents pressing back to bypass the ad gate
  useEffect(() => {
    const handlePopState = () => {
      if (!isSuccess) {
        try {
          window.history.pushState({ gateTrap: true }, '', window.location.href);
        } catch { }
        setToastType('danger');
        setToastMessage('⚠️ ব্যাক করলে ভিডিও আনলক হবে না! ভিডিও দেখতে নিচের বাটনে ক্লিক করে ভেরিফিকেশন সম্পন্ন করুন।');
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
      onUnlock(video);
    }
  }, [isAdFree, isFakePopupMode, video, onUnlock]);

  // Rotate winning index on video change
  useEffect(() => {
    setWinningIndex(isFakePopupMode ? -1 : Math.floor(Math.random() * 3));
    setToastMessage(null);
    setIsSuccess(false);
    setClickedButtons({});
    setVerifyingAd(false);
    setVerifyCountdown(5);
    setPendingUnlockIndex(null);
  }, [video.id, isFakePopupMode]);

  // 3. Tab visibility / Fast-Back Bypass Detector
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && verifyingAd) {
        const timeSpentAway = Date.now() - adClickTimestampRef.current;
        // User came back too fast (< 4 seconds) -> they clicked and immediately pressed back!
        if (timeSpentAway < 4000) {
          bypassAttemptCountRef.current += 1;
          const count = bypassAttemptCountRef.current;
          setVerifyingAd(false);
          setPendingUnlockIndex(null);
          if (verifyTimerIntervalRef.current) clearInterval(verifyTimerIntervalRef.current);

          setToastType('danger');
          setToastMessage(
            `⚠️ অ্যাড লোড হওয়ার আগেই ব্যাক করেছেন! (${count}x ধরা পড়েছে) — ভিডিও আনলক করতে অ্যাড পেজে অন্তত ৫ সেকেন্ড অপেক্ষা করতে হবে!`
          );

          if (count >= 2 && onBypassDetected) {
            onBypassDetected(count);
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [verifyingAd, onBypassDetected]);

  // 4. Verify Countdown Timer (counts down 5s while verifying)
  useEffect(() => {
    if (!verifyingAd) return;

    setVerifyCountdown(5);
    verifyTimerIntervalRef.current = setInterval(() => {
      setVerifyCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(verifyTimerIntervalRef.current);
          setVerifyingAd(false);

          // Verification complete!
          if (!isFakePopupMode && pendingUnlockIndex === winningIndex) {
            setIsSuccess(true);
            setToastType('success');
            setToastMessage('✓ অ্যাড ভেরিফিকেশন সফল হয়েছে! ভিডিও চালু হচ্ছে...');
            setTimeout(() => {
              onUnlock(video);
            }, 600);
          } else if (isFakePopupMode) {
            setToastType('warning');
            setToastMessage('⚠️ Server সমস্যার জন্য এই লিংকটি কাজ করেনি। অন্য লিংকে ট্রাই করুন!');
          } else {
            setToastType('warning');
            setToastMessage('⚠️ এই লিংকে ভিডিও পাওয়া যায়নি, অন্য ২টির একটিতে ট্রাই করুন!');
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (verifyTimerIntervalRef.current) clearInterval(verifyTimerIntervalRef.current);
    };
  }, [verifyingAd, pendingUnlockIndex, winningIndex, isFakePopupMode, video, onUnlock]);

  const handleButtonClick = (buttonIndex: number) => {
    if (isSuccess || verifyingAd) return;

    setClickedButtons((prev) => ({ ...prev, [buttonIndex]: true }));
    setPendingUnlockIndex(buttonIndex);
    adClickTimestampRef.current = Date.now();
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

    setToastType('info');
    setToastMessage('⏳ স্পন্সর পেজ ওপেন হয়েছে... ভিডিও আনলক করতে অনুগ্রহ করে ৫ সেকেন্ড অপেক্ষা করুন (এখন ব্যাক করবেন না)!');
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
                <p className="text-xs font-bold">অ্যাড ভেরিফিকেশন চলছে...</p>
                <p className="text-[10px] text-amber-800">এখন ব্যাক করবেন না, সম্পূর্ণ হতে দিন</p>
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

        {/* 2. Exactly 3 Buttons Stacked Vertically */}
        <div className="w-full max-w-[440px] flex flex-col items-center gap-3 my-2">
          {BUTTONS.map((btn, index) => {
            const hasBeenClicked = Boolean(clickedButtons[index]);
            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => handleButtonClick(index)}
                disabled={verifyingAd || isSuccess}
                className={`w-full transform hover:scale-[1.02] active:scale-95 transition-all duration-150 cursor-pointer focus:outline-none drop-shadow-md hover:drop-shadow-xl relative rounded-full ${
                  verifyingAd ? 'opacity-60 cursor-not-allowed' : ''
                }`}
                title={btn.label}
              >
                <img
                  src={btn.img}
                  alt={btn.label}
                  className="w-full h-auto object-contain select-none pointer-events-none rounded-full"
                />
                {hasBeenClicked && !isSuccess && !verifyingAd && (
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 px-2.5 py-0.5 rounded-full bg-slate-900/80 text-amber-300 text-[10px] font-mono font-bold">
                    Checked ✖
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
          <span>🔒 সিকিউর স্ট্রিমিং · অ্যাড বাইপাস করলে অ্যাকাউন্ট ও ডিভাইস ব্যান হতে পারে</span>
        </p>
      </div>
    </div>
  );
};
