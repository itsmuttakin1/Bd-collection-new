import React, { useState, useEffect } from 'react';
import { ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
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

const BUTTONS = [
  { id: 'hd', label: 'Download Video HD', img: '/images/buttons/btn-hd.png' },
  { id: '1080p', label: 'Download Video 1080p', img: '/images/buttons/btn-1080p.png' },
  { id: '4k', label: 'Download Video 4K', img: '/images/buttons/btn-4k.png' },
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
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [clickedButtons, setClickedButtons] = useState<Record<number, boolean>>({});

  // Auto-bypass if user has active VIP (ONLY for real videos, NEVER for Fake Pop-Up Links)
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
  }, [video.id, isFakePopupMode]);

  const handleButtonClick = (buttonIndex: number) => {
    if (isSuccess) return;

    setClickedButtons((prev) => ({ ...prev, [buttonIndex]: true }));

    // WINNER (Only when NOT a Fake Pop-Up Link): User hit the random button containing the real video URL!
    if (!isFakePopupMode && buttonIndex === winningIndex) {
      setIsSuccess(true);
      setToastMessage('✓ লিঙ্ক ভেরিফাই হয়েছে! ভিডিও চালু হচ্ছে...');
      setTimeout(() => {
        onUnlock(video);
      }, 250);
      return;
    }

    // AD BUTTON (or Fake Pop-Up Link where ALL 3 buttons are 100% Ads):
    triggerPopunderAd();

    if (isFakePopupMode && video.id && String(video.id).startsWith('fake_')) {
      runTransaction(ref(db, `fakeLinks/${video.id}/clicks`), (curr) => (Number(curr) || 0) + 1).catch(
        () => {}
      );
    }

    // Select current Smartlink (in Fake Pop-Up mode, map button index + rotation so each button opens an Ad link)
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

    setToastMessage('⚠️ Server এর সমস্যার জন্য এই লিংকটি কাজ করেনি। অন্য লিংকে ট্রাই করুন!');
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  return (
    <div className="min-h-[90vh] w-full flex items-center justify-center p-3 sm:p-6 pb-28 sm:pb-20 select-none animate-fadeIn">
      <div className="w-full max-w-[560px] bg-white text-slate-900 rounded-3xl p-4 sm:p-6 shadow-2xl border-4 border-slate-200/90 flex flex-col items-center relative overflow-hidden">
        {/* Top Header: Back Button & Video Title */}
        <div className="w-full flex items-center justify-between gap-3 pb-3 border-b border-slate-200 mb-3">
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

        {/* 1. Exact Red Pill Header Banner from screenshot */}
        <div className="w-full flex items-center justify-center my-2">
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
            className={`w-full max-w-[460px] p-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 my-2 transition-all shadow-md ${
              isSuccess
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
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

        {/* 2. Exactly 3 Buttons Stacked Vertically */}
        <div className="w-full max-w-[460px] flex flex-col items-center gap-3.5 my-2.5">
          {BUTTONS.map((btn, index) => {
            const hasBeenClicked = Boolean(clickedButtons[index]);
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
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-slate-900/80 text-white text-[10px] font-mono">
                    Tried
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 3. Exact Yellow Notice Card Banner from screenshot */}
        <div className="w-full flex items-center justify-center mt-2.5 mb-1.5">
          <img
            src="/images/buttons/notice-banner.png"
            alt="মাঝে মাঝে Server এর সমস্যার জন্য একটা লিংক কাজ করে না, তাই সব কয়টা লিংকে ট্রাই করবেন"
            className="w-full max-w-[480px] h-auto object-contain drop-shadow select-none pointer-events-none"
          />
        </div>

        {/* Bottom Ad Unit */}
        <Banner320x50Ad className="my-1.5" />

        {/* Footer Sub-Note */}
        <p className="text-[11px] text-slate-500 font-medium text-center mt-2">
          🔒 Secure Protected Stream · 100% Free HD Playback
        </p>
      </div>
    </div>
  );
};
