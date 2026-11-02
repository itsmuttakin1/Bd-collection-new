import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import {
  NATIVE_BANNER_SCRIPT_SRC,
  NATIVE_BANNER_CONTAINER_ID,
  BANNER_320x50_KEY,
  BANNER_320x50_SCRIPT_SRC,
  SOCIAL_BAR_SCRIPT_SRC,
  POPUNDER_SCRIPT_SRC,
  SMARTLINK_URL,
} from '../firebase';

// Global event bus so any blocked ad script immediately triggers the Anti-AdBlock lock screen
const AD_BLOCK_EVENT = 'bd_collection_adblock_detected';

export function notifyAdBlocked() {
  try {
    window.dispatchEvent(new CustomEvent(AD_BLOCK_EVENT));
  } catch {}
}

/**
 * Checks if visitor is a search engine crawler (Googlebot, Googlebot-Video, Bingbot, etc.)
 * so SEO & Google Video Indexing are never blocked.
 */
function isSearchEngineBot(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator.userAgent || '').toLowerCase();
  return /googlebot|google-inspectiontool|adsbot-google|mediapartners-google|bingbot|slurp|duckduckbot|baiduspider|yandexbot|facebookexternalhit|twitterbot/i.test(
    ua
  );
}

/**
 * Runs multi-layer AdBlocker + AdGuard DNS / Private DNS / Pi-hole detection:
 * 1. DOM cosmetic filter bait (uBlock Origin, AdBlock Plus, Brave, AdGuard Extension)
 * 2. DNS / Network probe to Google Ads (`pagead2.googlesyndication.com`) & site ad server (`brijmohan.org`)
 *    which are blocked at the DNS level by `dns.adguard.com` / `dns.adguard-dns.com` / NextDNS / Pi-hole.
 */
export async function detectAdBlockerOrDns(): Promise<boolean> {
  if (typeof window === 'undefined' || isSearchEngineBot()) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

  // Layer 1: DOM Cosmetic Filter Bait Check
  const domBlocked = await new Promise<boolean>((resolve) => {
    try {
      const bait = document.createElement('div');
      bait.className =
        'pub_300x250 pub_300x250m pub_728x90 text-ad textAd text_ad text_ads text-ads text-ad-links ad-banner adsbox ad-placement doubleclick ad-placeholder';
      bait.setAttribute('aria-hidden', 'true');
      bait.style.position = 'absolute';
      bait.style.top = '-9999px';
      bait.style.left = '-9999px';
      bait.style.width = '300px';
      bait.style.height = '250px';
      bait.style.pointerEvents = 'none';
      document.body.appendChild(bait);

      window.setTimeout(() => {
        let isHidden = false;
        try {
          const style = window.getComputedStyle(bait);
          if (
            !bait.offsetParent ||
            bait.offsetHeight === 0 ||
            bait.offsetWidth === 0 ||
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0'
          ) {
            isHidden = true;
          }
        } catch {}
        try {
          bait.remove();
        } catch {}
        resolve(isHidden);
      }, 180);
    } catch {
      resolve(false);
    }
  });

  if (domBlocked) return true;

  // Layer 2: AdGuard DNS / Private DNS / Network Filter Probe
  const probeUrl = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?_cb=${Date.now()}`;
  const dnsOrNetBlocked = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (blocked: boolean) => {
      if (!settled) {
        settled = true;
        resolve(blocked);
      }
    };

    const timer = window.setTimeout(() => finish(false), 3500);

    fetch(probeUrl, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
    })
      .then(() => {
        window.clearTimeout(timer);
        finish(false);
      })
      .catch(() => {
        window.clearTimeout(timer);
        finish(true);
      });
  });

  if (dnsOrNetBlocked) return true;

  // Layer 3: Script tag load test for AdGuard DNS / Brave Shields
  const scriptBlocked = await new Promise<boolean>((resolve) => {
    try {
      const s = document.createElement('script');
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?check=${Date.now()}`;
      s.async = true;
      const cleanup = () => {
        try {
          s.remove();
        } catch {}
      };
      const t = window.setTimeout(() => {
        cleanup();
        resolve(false);
      }, 3000);
      s.onload = () => {
        window.clearTimeout(t);
        cleanup();
        resolve(false);
      };
      s.onerror = () => {
        window.clearTimeout(t);
        cleanup();
        resolve(true);
      };
      document.head.appendChild(s);
    } catch {
      resolve(false);
    }
  });

  return scriptBlocked;
}

/**
 * Full-Screen Un-bypassable Anti-AdBlock & Anti-AdGuard DNS Wall
 * Blocks website access until AdBlocker / AdGuard DNS is disabled and user clicks Refresh.
 */
export const AntiAdBlockGuard: React.FC<{
  onBlockStateChange?: (blocked: boolean) => void;
}> = ({ onBlockStateChange }) => {
  const [isBlocked, setIsBlocked] = useState<boolean>(false);
  const [isRechecking, setIsRechecking] = useState<boolean>(false);

  const runCheck = useCallback(async () => {
    const detected = await detectAdBlockerOrDns();
    setIsBlocked((prev) => {
      const next = prev || detected;
      if (onBlockStateChange) onBlockStateChange(next);
      return next;
    });
    if (detected) {
      // Pause any active video elements immediately
      try {
        document.querySelectorAll('video').forEach((v) => {
          v.pause();
        });
      } catch {}
    }
  }, [onBlockStateChange]);

  useEffect(() => {
    runCheck();

    const handleAdBlockEvent = () => {
      if (isSearchEngineBot()) return;
      setIsBlocked(true);
      if (onBlockStateChange) onBlockStateChange(true);
      try {
        document.querySelectorAll('video').forEach((v) => v.pause());
      } catch {}
    };

    window.addEventListener(AD_BLOCK_EVENT, handleAdBlockEvent);
    const interval = window.setInterval(runCheck, 7000);

    return () => {
      window.removeEventListener(AD_BLOCK_EVENT, handleAdBlockEvent);
      window.clearInterval(interval);
    };
  }, [runCheck, onBlockStateChange]);

  const handleRefreshClick = () => {
    setIsRechecking(true);
    window.location.reload();
  };

  if (!isBlocked) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="w-full max-w-md rounded-2xl border border-red-900/70 bg-zinc-950 p-6 sm:p-8 shadow-2xl text-center space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-red-600/15 border border-red-500/30 text-red-500 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-9 h-9" />
        </div>

        <div className="space-y-2">
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Ad Blocker / AdGuard DNS Detected!
          </h2>
          <p className="text-sm text-zinc-300 leading-relaxed">
            আপনি <strong>Ad Blocker</strong> অথবা <strong>AdGuard DNS (Private DNS)</strong> ব্যবহার করছেন। আমাদের ওয়েবসাইটটি ব্যবহার করতে এবং ভিডিও প্লে করতে অনুগ্রহ করে Ad Blocker / AdGuard DNS বন্ধ করে নিচের <strong>Refresh</strong> বাটনে ক্লিক করুন।
          </p>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 text-left space-y-2 text-xs text-zinc-300 leading-relaxed">
          <p className="font-semibold text-zinc-100">কীভাবে বন্ধ করবেন (How to disable):</p>
          <p>
            ১. <strong>Browser Ad Blocker:</strong> আপনার ব্রাউজারের AdBlock / uBlock / Brave Shields এই সাইটের জন্য <strong>Off / Pause</strong> করুন।
          </p>
          <p>
            ২. <strong>AdGuard / Private DNS (Mobile):</strong> ফোনের <strong>Settings → Connection &amp; Sharing → Private DNS</strong> অপশনে গিয়ে <strong>Off</strong> অথবা <strong>Automatic</strong> করে দিন।
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefreshClick}
          disabled={isRechecking}
          className="w-full py-3 px-5 rounded-xl bg-red-600 hover:bg-red-500 active:scale-[0.99] text-white text-sm font-semibold flex items-center justify-center gap-2.5 shadow-lg transition-all cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${isRechecking ? 'animate-spin' : ''}`} />
          <span>{isRechecking ? 'Reloading Website...' : 'Refresh Website (রিলোড করুন)'}</span>
        </button>
      </div>
    </div>
  );
};

/**
 * Native Banner Ad (Clean integration without debug labels)
 */
export const NativeBannerAd: React.FC<{ className?: string }> = ({ className = '' }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const existingScript = document.querySelector(`script[src="${NATIVE_BANNER_SCRIPT_SRC}"]`);
    if (!existingScript) {
      const script = document.createElement('script');
      script.async = true;
      script.setAttribute('data-cfasync', 'false');
      script.src = NATIVE_BANNER_SCRIPT_SRC;
      script.onerror = () => {
        if (navigator.onLine !== false) notifyAdBlocked();
      };
      wrapper.appendChild(script);
    }
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`ad-safe-container w-full max-w-full overflow-hidden my-3 px-0 ${className}`}
    >
      <div
        id={NATIVE_BANNER_CONTAINER_ID}
        className="w-full max-w-full overflow-hidden flex items-center justify-center"
      />
    </div>
  );
};

/**
 * 320x50 Iframe Banner Ad (Responsive & Contained for Telegram Mini App / Mobile)
 */
export const Banner320x50Ad: React.FC<{ className?: string }> = ({ className = '' }) => {
  const srcDocContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
        <style>
          html, body { margin: 0; padding: 0; width: 100%; max-width: 100%; background: transparent; display: flex; align-items: center; justify-content: center; overflow: hidden; }
          iframe, img, div { max-width: 100% !important; }
        </style>
      </head>
      <body>
        <script type="text/javascript">
          atOptions = {
            'key' : '${BANNER_320x50_KEY}',
            'format' : 'iframe',
            'height' : 50,
            'width' : 320,
            'params' : {}
          };
        </script>
        <script type="text/javascript" src="${BANNER_320x50_SCRIPT_SRC}"></script>
      </body>
    </html>
  `;

  return (
    <div className={`ad-safe-container w-full max-w-full overflow-hidden flex items-center justify-center my-2 ${className}`}>
      <div className="w-full max-w-[320px] h-[50px] overflow-hidden flex items-center justify-center mx-auto">
        <iframe
          title="Ad Banner"
          width={320}
          height={50}
          scrolling="no"
          frameBorder={0}
          srcDoc={srcDocContent}
          className="w-full max-w-[320px] h-[50px] border-0 overflow-hidden"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        />
      </div>
    </div>
  );
};

/**
 * Social Bar Ad Loader
 */
export const SocialBarLoader: React.FC<{ active: boolean }> = ({ active }) => {
  useEffect(() => {
    if (!active) return;
    const id = 'social-bar-ad-script';
    if (!document.getElementById(id)) {
      const script = document.createElement('script');
      script.id = id;
      script.setAttribute('data-cfasync', 'false');
      script.src = SOCIAL_BAR_SCRIPT_SRC;
      script.async = true;
      script.onerror = () => {
        if (navigator.onLine !== false) notifyAdBlocked();
      };
      document.body.appendChild(script);
    }
  }, [active]);

  return null;
};

/**
 * Triggers the Popunder script dynamically on Play button click (3-step gate)
 */
export function triggerPopunderAd() {
  try {
    const existing = document.getElementById('dynamic-popunder-script');
    if (existing) {
      existing.remove();
    }
    const script = document.createElement('script');
    script.id = 'dynamic-popunder-script';
    script.setAttribute('data-cfasync', 'false');
    script.src = POPUNDER_SCRIPT_SRC;
    script.async = true;
    script.onerror = () => {
      if (navigator.onLine !== false) notifyAdBlocked();
    };
    document.body.appendChild(script);
  } catch (e) {
    console.error(e);
  }
}

/**
 * Opens the Smartlink URL (Supports both standard browsers & Telegram Mini App WebView)
 */
export function triggerSmartlinkAd() {
  try {
    const tgWebApp = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : undefined;
    // If running inside Telegram Mini App, use Telegram's native openLink API so the ad opens
    // in the external browser without closing the Mini App or being blocked by WebView popup rules.
    if (tgWebApp && tgWebApp.initData && typeof tgWebApp.openLink === 'function') {
      try {
        tgWebApp.openLink(SMARTLINK_URL, { try_instant_view: false });
        return;
      } catch {
        // Fallback to anchor click below
      }
    }

    const link = document.createElement('a');
    link.href = SMARTLINK_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    console.error(e);
  }
}
