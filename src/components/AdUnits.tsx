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
      wrapper.appendChild(script);
    }
  }, []);

  return (
    <div ref={wrapperRef} className={`w-full my-4 ${className}`}>
      <div id={NATIVE_BANNER_CONTAINER_ID} className="w-full flex items-center justify-center" />
    </div>
  );
};

/**
 * 320x50 Iframe Banner Ad
 */
export const Banner320x50Ad: React.FC<{ className?: string }> = ({ className = '' }) => {
  const srcDocContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { margin: 0; padding: 0; background: transparent; display: flex; align-items: center; justify-content: center; overflow: hidden; }
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
    <div className={`flex items-center justify-center my-2 ${className}`}>
      <div className="w-[320px] h-[50px] overflow-hidden flex items-center justify-center">
        <iframe
          title="Ad Banner"
          width={320}
          height={50}
          scrolling="no"
          frameBorder={0}
          srcDoc={srcDocContent}
          className="w-[320px] h-[50px]"
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
    document.body.appendChild(script);
  } catch (e) {
    console.error(e);
  }
}

/**
 * Opens the Smartlink URL
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
    console.error(e);
  }
}
