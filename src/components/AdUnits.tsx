import React, { useEffect, useRef } from 'react';
import {
  NATIVE_BANNER_SCRIPT_SRC,
  NATIVE_BANNER_CONTAINER_ID,
  BANNER_320x50_KEY,
  BANNER_320x50_SCRIPT_SRC,
  SOCIAL_BAR_SCRIPT_SRC,
  POPUNDER_SCRIPT_SRC,
  SMARTLINK_URL,
} from '../firebase';

/**
 * Native Banner Ad
 * <script async="async" data-cfasync="false" src="https://brijmohan.org/21/9e05788a1e91471d1f2353aad323fd56"></script>
 * <div id="container-9e05788a1e91471d1f2353aad323fd56"></div>
 */
export const NativeBannerAd: React.FC<{ className?: string }> = ({ className = '' }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // Avoid duplicate script injection inside this mount
    const existingScript = document.querySelector(`script[src="${NATIVE_BANNER_SCRIPT_SRC}"]`);
    if (!existingScript) {
      const script = document.createElement('script');
      script.async = true;
      script.setAttribute('data-cfasync', 'false');
      script.src = NATIVE_BANNER_SCRIPT_SRC;
      wrapper.appendChild(script);
    }
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`w-full border border-zinc-900 bg-zinc-950/70 rounded-xl p-4 my-6 transition-colors ${className}`}
    >
      <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-2 font-mono">
        <span>SPONSORED NATIVE FEED</span>
        <span>AD NETWORK · BRIJMOHAN</span>
      </div>
      <div id={NATIVE_BANNER_CONTAINER_ID} className="min-h-[90px] flex items-center justify-center text-xs text-zinc-600">
        <span className="pointer-events-none select-none">Sponsored Recommendation Space</span>
      </div>
    </div>
  );
};

/**
 * 320x50 Iframe Banner Ad
 * Uses srcdoc iframe to isolate global `atOptions` and `document.write` calls safely inside React SPA
 */
export const Banner320x50Ad: React.FC<{ className?: string }> = ({ className = '' }) => {
  const srcDocContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { margin: 0; padding: 0; background: transparent; display: flex; align-items: center; justify-content: center; overflow: hidden; font-family: sans-serif; color: #52525b; font-size: 11px; }
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
    <div className={`flex flex-col items-center justify-center my-4 ${className}`}>
      <div className="w-[320px] h-[50px] bg-zinc-950 border border-zinc-900 rounded overflow-hidden flex items-center justify-center relative">
        <span className="text-[10px] font-mono text-zinc-700 absolute pointer-events-none">320×50 SPONSORED BANNER</span>
        <iframe
          title="Sponsored 320x50 Banner"
          width={320}
          height={50}
          scrolling="no"
          frameBorder={0}
          srcDoc={srcDocContent}
          className="relative z-10 w-[320px] h-[50px]"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        />
      </div>
    </div>
  );
};

/**
 * Social Bar Ad Loader (Only loaded when enabled on Watch pages, NOT on initial index landing)
 * <script data-cfasync="false" src="https://brijmohan.org/14/9685e94c6cd837de7f2e6be4199a8040"></script>
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
      document.body.appendChild(script);
    }
  }, [active]);

  return null;
};

/**
 * Triggers the Popunder script dynamically on Play button click (3-step gate)
 * <script data-cfasync="false" src="https://ahuramazda.org/1/eab46957ba8ada08fe799687dd63716f"></script>
 */
export function triggerPopunderAd() {
  try {
    // Re-inject popunder script with cache-busting query or fresh element so it fires per click
    const existing = document.getElementById('dynamic-popunder-script');
    if (existing) {
      existing.remove();
    }
    const script = document.createElement('script');
    script.id = 'dynamic-popunder-script';
    script.setAttribute('data-cfasync', 'false');
    script.src = POPUNDER_SCRIPT_SRC;
    script.async = true;
    document.body.appendChild(script);
  } catch (e) {
    console.error('Popunder trigger error:', e);
  }
}

/**
 * Opens the Smartlink URL safely inside a new tab/window or fallback anchor click
 * Smartlink: https://asiaso.org/4/83d7ffcba5e9ff163422eb60b234e632
 */
export function triggerSmartlinkAd() {
  try {
    const link = document.createElement('a');
    link.href = SMARTLINK_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    console.error('Smartlink trigger error:', e);
  }
}
