import React, { useState } from 'react';
import { Copy, Check, FileCode2, Shield, Sparkles } from 'lucide-react';

export const FULL_PLATFORM_PROMPT = `Build a full-featured Video Sharing Platform Website ("GhostStream") with a custom multi-step Ad Monetization Engine, Anti-Download Protected Video Player, Firebase Realtime Database + Auth integration, and a dedicated Admin Panel (ad.html) connected to a Cloudflare R2 Storage Worker.

### 1. Ad Monetization Rules & Exact Ad Scripts
- **Initial Homepage (Index) Rule**: On initial load of the index/home page, DO NOT trigger intrusive popups, popunders, or extra banners. ONLY display the **Native Banner** inside the main feed:
  \`\`\`html
  <script async="async" data-cfasync="false" src="https://brijmohan.org/21/9e05788a1e91471d1f2353aad323fd56"></script>
  <div id="container-9e05788a1e91471d1f2353aad323fd56"></div>
  \`\`\`
- **Video Card Click Gate (3x Smartlink Rule)**: When a user clicks any video card on the homepage or in the suggested videos list, intercept the click:
  - Clicks 1, 2, and 3 on a video card open the **Smartlink** (\`https://asiaso.org/4/83d7ffcba5e9ff163422eb60b234e632\`) in a new tab and update the card's progress indicator (1/3, 2/3, 3/3).
  - After 3 Smartlink clicks, navigate to the **Video Watch Page** for that video.
- **Video Watch Page & Play Button Gate (3x Popunder Rule)**:
  - Render a custom Play Button overlay on top of the video player.
  - Clicking the Play Button triggers the **Popunder Ad** script 3 times before video playback starts:
    \`\`\`html
    <script data-cfasync="false" src="https://ahuramazda.org/1/eab46957ba8ada08fe799687dd63716f"></script>
    \`\`\`
  - After the 3rd Play button click, unlock the player and start streaming the video.
- **Additional Ad Placements (Watch Page & Secondary Placements)**:
  - **320x50 Banner Ad**:
    \`\`\`html
    <script>
      atOptions = {
        'key' : 'f9d96eee7a61e1baf855ad37f42838ae',
        'format' : 'iframe',
        'height' : 50,
        'width' : 320,
        'params' : {}
      };
    </script>
    <script src="https://brijmohan.org/22/f9d96eee7a61e1baf855ad37f42838ae"></script>
    \`\`\`
  - **Social Bar Ad**:
    \`\`\`html
    <script data-cfasync="false" src="https://brijmohan.org/14/9685e94c6cd837de7f2e6be4199a8040"></script>
    \`\`\`
- **Suggested Videos Below Player**: Below the active video player, display the remaining videos in a responsive recommendation grid. Clicking any suggested video also enforces the 3-click Smartlink gate before switching the active video.

### 2. Anti-Download Video Protection
- Disable all video downloading:
  - Set \`controlsList="nodownload noplaybackrate"\` and \`disablePictureInPicture\` on the \`<video>\` element.
  - Intercept and block \`onContextMenu\` (right-click) and drag events on the video player container.
  - Use custom playback controls (Play/Pause, Scrubber, Mute, Timecode, Fullscreen) with zero download buttons.

### 3. Firebase Realtime Database & Auth Configuration
Load all video catalog items and authenticate the admin panel using this exact Firebase configuration:
\`\`\`javascript
const firebaseConfig = {
  apiKey: "AIzaSyBPrgfeMTuy3GI1nb2jgw-qqQn6wPvH-0w",
  authDomain: "video-platform-7c031.firebaseapp.com",
  databaseURL: "https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "video-platform-7c031",
  storageBucket: "video-platform-7c031.firebasestorage.app",
  messagingSenderId: "1095431449628",
  appId: "1:1095431449628:web:4527ae65c83fd9966403d9"
};
\`\`\`

### 4. Admin Panel (\`ad.html\`) with Firebase Lock & Direct Cloudflare R2 Upload
- Protect \`ad.html\` using **Firebase Email & Password Authentication** (\`signInWithEmailAndPassword\`).
- Connect the Admin Panel directly to the Cloudflare R2 Worker at \`https://mrghost-storage.djsungroup.workers.dev/\` using the \`X-Admin-Key\` header:
  - \`POST /api/upload\`: Directly select a video file from device + optional \`folder\` name, upload via \`FormData\`, and automatically save the resulting stream URL and metadata to Firebase Realtime Database (\`/videos\`).
  - \`GET /api/list\`: List all files stored in the R2 bucket with file size, upload timestamp, one-click publish to Firebase, and delete button.
  - \`DELETE /api/delete\`: Remove files from the R2 bucket by \`{ key }\`.`;

export const PromptModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(FULL_PLATFORM_PROMPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-zinc-900 pb-4">
          <div className="flex items-center gap-2.5">
            <FileCode2 className="w-5 h-5 text-rose-500" />
            <h2 className="text-lg font-bold text-white">
              Master Website Prompt Blueprint (Ready to Copy)
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-medium text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied Prompt!' : 'Copy Full Prompt'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        <p className="text-xs text-zinc-400">
          Your entire Video Sharing Platform is already live and running in this app! Below is the
          complete structured prompt containing all your ad scripts, 3-click Smartlink &amp;
          Popunder gates, Firebase config, and Cloudflare R2 Worker integration.
        </p>

        <div className="flex-1 overflow-y-auto rounded-xl border border-zinc-900 bg-zinc-900/60 p-4">
          <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed">
            {FULL_PLATFORM_PROMPT}
          </pre>
        </div>
      </div>
    </div>
  );
};
