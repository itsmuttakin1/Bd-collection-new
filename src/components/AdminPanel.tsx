import React, { useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  auth,
  db,
  ref,
  push,
  set,
  remove,
  WORKER_BASE_URL,
  VideoItem,
} from '../firebase';
import {
  Lock,
  Upload,
  Trash2,
  FolderOpen,
  RefreshCw,
  LogOut,
  Film,
  CheckCircle2,
  AlertTriangle,
  HardDrive,
  PlusCircle,
  ExternalLink,
  Copy,
} from 'lucide-react';

interface R2FileItem {
  key: string;
  size: number;
  uploaded: string;
}

interface AdminPanelProps {
  videos: VideoItem[];
  onCloseAdmin: () => void;
}

// Helper to always strip any trailing slashes from the API base URL
const normalizeBaseUrl = (url: string): string => {
  return (url || WORKER_BASE_URL).trim().replace(/\/+$/, '');
};

export const AdminPanel: React.FC<AdminPanelProps> = ({ videos, onCloseAdmin }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);

  // Firebase Auth Email & Password state
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isRegisterMode, setIsRegisterMode] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Cloudflare Worker R2 Admin settings
  const [workerUrl, setWorkerUrl] = useState<string>(
    () => normalizeBaseUrl(localStorage.getItem('r2_worker_url') || WORKER_BASE_URL)
  );
  const [adminKey, setAdminKey] = useState<string>(
    () => localStorage.getItem('r2_admin_key') || ''
  );
  const [publicDomainUrl, setPublicDomainUrl] = useState<string>(
    () => normalizeBaseUrl(localStorage.getItem('r2_public_domain') || WORKER_BASE_URL)
  );

  // R2 Bucket file list state
  const [r2Files, setR2Files] = useState<R2FileItem[]>([]);
  const [isListingR2, setIsListingR2] = useState<boolean>(false);
  const [r2StatusMessage, setR2StatusMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Direct Upload & Publish form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [folder, setFolder] = useState<string>('videos');
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [videoCategory, setVideoCategory] = useState<string>('Cinema');
  const [videoDuration, setVideoDuration] = useState<string>('04:15');
  const [videoDescription, setVideoDescription] = useState<string>('');
  const [customVideoUrl, setCustomVideoUrl] = useState<string>('');
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Active tab inside Admin Panel
  const [activeSubTab, setActiveSubTab] = useState<'upload' | 'bucket' | 'catalog' | 'prompt'>('upload');
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  const handleSaveWorkerConfig = () => {
    const cleanWorker = normalizeBaseUrl(workerUrl);
    const cleanDomain = normalizeBaseUrl(publicDomainUrl);
    setWorkerUrl(cleanWorker);
    setPublicDomainUrl(cleanDomain);
    localStorage.setItem('r2_worker_url', cleanWorker);
    localStorage.setItem('r2_admin_key', adminKey.trim());
    localStorage.setItem('r2_public_domain', cleanDomain);
    setR2StatusMessage({
      type: 'success',
      text: 'Cloudflare R2 Worker configuration saved locally.',
    });
  };

  const handleFirebaseAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      if (isRegisterMode) {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Authentication failed. Check your email and password.');
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  /**
   * Fetch file list from Cloudflare R2 Worker (`GET /api/list`)
   * - Strips trailing slashes before appending `/api/list`
   * - Always includes `"X-Admin-Key": <ADMIN_KEY>`
   * - Automatically falls back to `/api/r2-proxy/list` if remote Worker hasn't deployed the CORS fix yet
   */
  const fetchR2FileList = async () => {
    const trimmedKey = adminKey.trim();
    if (!trimmedKey) {
      setR2StatusMessage({
        type: 'error',
        text: 'Please enter your X-Admin-Key to authenticate with Cloudflare R2 Worker.',
      });
      return;
    }

    setIsListingR2(true);
    setR2StatusMessage(null);
    const baseUrl = normalizeBaseUrl(workerUrl);

    try {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/api/list`, {
          method: 'GET',
          headers: {
            'X-Admin-Key': trimmedKey,
          },
        });
      } catch {
        // Fallback to server-side CORS proxy if browser preflight fails against un-updated remote worker
        response = await fetch('/api/r2-proxy/list', {
          method: 'GET',
          headers: {
            'X-Admin-Key': trimmedKey,
            'X-Worker-Url': baseUrl,
          },
        });
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setR2Files(data.files || []);
      setR2StatusMessage({
        type: 'success',
        text: `Loaded ${(data.files || []).length} files from R2 storage.`,
      });
    } catch (err: any) {
      setR2StatusMessage({
        type: 'error',
        text: `R2 List Error: ${err?.message || 'Failed to connect to Worker'}.`,
      });
    } finally {
      setIsListingR2(false);
    }
  };

  /**
   * Direct file upload to Cloudflare R2 (`POST /api/upload`) + save metadata to Firebase RTDB
   * - Sends FormData (multipart/form-data) WITHOUT manually setting "Content-Type" so browser generates boundary
   * - Always includes `"X-Admin-Key": <ADMIN_KEY>`
   * - Strips trailing slashes from API base URL before appending `/api/upload`
   */
  const handleUploadAndPublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setR2StatusMessage(null);

    if (!videoTitle.trim()) {
      setR2StatusMessage({ type: 'error', text: 'Please enter a video title.' });
      return;
    }

    setIsUploading(true);
    let finalVideoUrl = customVideoUrl.trim();
    let uploadedKey = '';

    try {
      // If user selected a local file, upload it to Cloudflare R2 Worker
      if (selectedFile) {
        const trimmedKey = adminKey.trim();
        if (!trimmedKey) {
          throw new Error('X-Admin-Key is required to upload files to Cloudflare R2 Worker.');
        }

        const baseUrl = normalizeBaseUrl(workerUrl);
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('folder', folder.trim().replace(/^\/+|\/+$/g, ''));

        let res: Response;
        try {
          // IMPORTANT: Do NOT set "Content-Type" when sending FormData; browser sets multipart/form-data; boundary=...
          res = await fetch(`${baseUrl}/api/upload`, {
            method: 'POST',
            headers: {
              'X-Admin-Key': trimmedKey,
            },
            body: formData,
          });
        } catch {
          // Automatic fallback through backend proxy if remote Worker still returns origin "null"
          res = await fetch('/api/r2-proxy/upload', {
            method: 'POST',
            headers: {
              'X-Admin-Key': trimmedKey,
              'X-Worker-Url': baseUrl,
            },
            body: formData,
          });
        }

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Upload failed with status ${res.status}`);
        }

        uploadedKey = data.key;
        const cleanDomain = normalizeBaseUrl(publicDomainUrl);
        finalVideoUrl = `${cleanDomain}/${uploadedKey}`;
      }

      if (!finalVideoUrl) {
        throw new Error('Select a video file to upload to R2 or provide a direct stream URL.');
      }

      // Push metadata to Firebase Realtime Database (`video-platform-7c031`)
      const videosRef = ref(db, 'videos');
      const newVideoRef = push(videosRef);
      const payload: VideoItem = {
        id: newVideoRef.key || String(Date.now()),
        title: videoTitle.trim(),
        description:
          videoDescription.trim() ||
          'Protected high-definition stream hosted on Cloudflare R2 & synced with Firebase.',
        category: videoCategory,
        videoUrl: finalVideoUrl,
        r2Key: uploadedKey || undefined,
        duration: videoDuration.trim() || '03:45',
        views: 1,
        createdAt: Date.now(),
        author: user?.email?.split('@')[0] || 'Admin',
      };

      await set(newVideoRef, payload);

      setR2StatusMessage({
        type: 'success',
        text: uploadedKey
          ? `Uploaded "${uploadedKey}" to Cloudflare R2 and published to Firebase catalog!`
          : 'Published video stream directly to Firebase catalog!',
      });

      // Reset form
      setSelectedFile(null);
      setVideoTitle('');
      setVideoDescription('');
      setCustomVideoUrl('');
    } catch (err: any) {
      setR2StatusMessage({
        type: 'error',
        text: err?.message || 'Upload or Firebase publish failed.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Delete object from Cloudflare R2 (`DELETE /api/delete`)
   * - Strips trailing slashes from API base URL before appending `/api/delete`
   * - Always includes `"X-Admin-Key": <ADMIN_KEY>`
   */
  const handleDeleteR2File = async (key: string) => {
    const trimmedKey = adminKey.trim();
    if (!trimmedKey) {
      setR2StatusMessage({
        type: 'error',
        text: 'X-Admin-Key is required to delete files from R2.',
      });
      return;
    }

    const baseUrl = normalizeBaseUrl(workerUrl);
    try {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/api/delete`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Key': trimmedKey,
          },
          body: JSON.stringify({ key }),
        });
      } catch {
        res = await fetch('/api/r2-proxy/delete', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Key': trimmedKey,
            'X-Worker-Url': baseUrl,
          },
          body: JSON.stringify({ key }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Delete failed');
      }
      setR2Files((prev) => prev.filter((item) => item.key !== key));
      setR2StatusMessage({
        type: 'success',
        text: `Deleted "${key}" from R2 bucket.`,
      });
    } catch (err: any) {
      setR2StatusMessage({
        type: 'error',
        text: `Delete Error: ${err?.message}`,
      });
    }
  };

  // Publish an existing R2 file directly into Firebase Realtime Database
  const handleQuickPublishR2File = async (file: R2FileItem) => {
    try {
      const cleanDomain = normalizeBaseUrl(publicDomainUrl);
      const fileUrl = `${cleanDomain}/${file.key}`;
      const cleanTitle =
        file.key
          .split('/')
          .pop()
          ?.replace(/\.[^/.]+$/, '')
          .replace(/[_-]+/g, ' ') || file.key;

      const videosRef = ref(db, 'videos');
      const newVideoRef = push(videosRef);
      await set(newVideoRef, {
        id: newVideoRef.key || String(Date.now()),
        title: cleanTitle,
        description: `Direct stream from Cloudflare R2 storage (${file.key}).`,
        category: 'R2 Stream',
        videoUrl: fileUrl,
        r2Key: file.key,
        duration: '04:00',
        views: 1,
        createdAt: Date.now(),
        author: user?.email?.split('@')[0] || 'Admin',
      });

      setR2StatusMessage({
        type: 'success',
        text: `Published "${cleanTitle}" to live video feed!`,
      });
    } catch (err: any) {
      setR2StatusMessage({
        type: 'error',
        text: `Firebase Error: ${err?.message}`,
      });
    }
  };

  const handleDeleteFirebaseVideo = async (video: VideoItem) => {
    try {
      await remove(ref(db, `videos/${video.id}`));
      setR2StatusMessage({
        type: 'success',
        text: `Removed "${video.title}" from Firebase database.`,
      });
    } catch (err: any) {
      setR2StatusMessage({
        type: 'error',
        text: `Failed to remove from Firebase: ${err?.message}`,
      });
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  if (authLoading) {
    return (
      <div className="max-w-4xl mx-auto py-20 px-6 text-center">
        <p className="text-sm font-mono text-zinc-400">Verifying Firebase Authentication lock...</p>
      </div>
    );
  }

  // Firebase Lock Screen (`ad.html` login gate with email & password)
  if (!user) {
    return (
      <div className="max-w-md mx-auto my-14 p-8 rounded-2xl border border-zinc-800 bg-zinc-950">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <Lock className="w-5 h-5 text-rose-500" />
            <h1 className="text-xl font-bold tracking-tight text-white">ad.html · Admin Lock</h1>
          </div>
          <button
            type="button"
            onClick={onCloseAdmin}
            className="text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Back to Feed
          </button>
        </div>

        <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
          Sign in with your Firebase Email &amp; Password (`video-platform-7c031`) to unlock direct
          Cloudflare R2 uploads and catalog management.
        </p>

        {authError && (
          <div className="mb-4 p-3 rounded-lg border border-rose-900/60 bg-rose-950/30 text-xs text-rose-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <span>{authError}</span>
          </div>
        )}

        <form onSubmit={handleFirebaseAuth} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Admin Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="w-full px-3.5 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-white focus:outline-none focus:border-rose-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-white focus:outline-none focus:border-rose-500"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium transition-colors cursor-pointer"
          >
            {isRegisterMode ? 'Create Admin Account' : 'Unlock Admin Panel'}
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-zinc-900 flex items-center justify-between text-xs text-zinc-500">
          <span>Firebase Auth: video-platform-7c031</span>
          <button
            type="button"
            onClick={() => setIsRegisterMode(!isRegisterMode)}
            className="text-zinc-300 hover:text-white underline cursor-pointer"
          >
            {isRegisterMode ? 'Switch to Login' : 'Register Admin Email'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-6 space-y-8">
      {/* Admin Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-zinc-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            ad.html · Storage &amp; Stream Control
          </h1>
          <p className="text-xs text-zinc-400 mt-1 font-mono">
            Authenticated as {user.email} · Worker: {normalizeBaseUrl(workerUrl)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCloseAdmin}
            className="px-3.5 py-2 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-zinc-200 transition-colors cursor-pointer"
          >
            Return to Platform
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="px-3.5 py-2 rounded-lg border border-rose-900/50 bg-rose-950/30 hover:bg-rose-900/50 text-xs font-medium text-rose-300 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Lock Session</span>
          </button>
        </div>
      </div>

      {/* Cloudflare Worker Connection Bar */}
      <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-950 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-rose-500" />
            <span>Cloudflare R2 Worker Credentials (`mrghost-storage`)</span>
          </h2>
          <button
            type="button"
            onClick={handleSaveWorkerConfig}
            className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white transition-colors cursor-pointer"
          >
            Save Credentials
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Worker API Endpoint</label>
            <input
              type="url"
              value={workerUrl}
              onChange={(e) => setWorkerUrl(e.target.value)}
              placeholder="https://mrghost-storage.djsungroup.workers.dev"
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-200 focus:outline-none focus:border-rose-500"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              X-Admin-Key Secret (`env.ADMIN_KEY`)
            </label>
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="Enter Worker X-Admin-Key..."
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-200 focus:outline-none focus:border-rose-500"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Public Stream Base URL / R2 Bucket Domain
            </label>
            <input
              type="url"
              value={publicDomainUrl}
              onChange={(e) => setPublicDomainUrl(e.target.value)}
              placeholder="https://mrghost-storage.djsungroup.workers.dev"
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-200 focus:outline-none focus:border-rose-500"
            />
          </div>
        </div>
      </div>

      {/* Status Banner */}
      {r2StatusMessage && (
        <div
          className={`p-4 rounded-xl border text-xs flex items-center justify-between ${
            r2StatusMessage.type === 'success'
              ? 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'
              : r2StatusMessage.type === 'error'
              ? 'border-rose-900/60 bg-rose-950/30 text-rose-300'
              : 'border-zinc-800 bg-zinc-900 text-zinc-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {r2StatusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
            )}
            <span>{r2StatusMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setR2StatusMessage(null)}
            className="text-zinc-400 hover:text-white ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Sub-navigation Tabs */}
      <div className="flex items-center gap-1 p-1 bg-zinc-900/80 border border-zinc-800 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setActiveSubTab('upload')}
          className={`px-4 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeSubTab === 'upload'
              ? 'bg-rose-600 text-white'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          Direct Upload &amp; Publish
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveSubTab('bucket');
            fetchR2FileList();
          }}
          className={`px-4 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeSubTab === 'bucket'
              ? 'bg-rose-600 text-white'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          R2 Bucket Explorer (`/api/list`)
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('catalog')}
          className={`px-4 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeSubTab === 'catalog'
              ? 'bg-rose-600 text-white'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          Firebase Video Catalog ({videos.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('prompt')}
          className={`px-4 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeSubTab === 'prompt'
              ? 'bg-rose-600 text-white'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          Worker CORS Fix Code
        </button>
      </div>

      {/* Tab 1: Direct Select Upload to Cloudflare R2 & Publish to Firebase */}
      {activeSubTab === 'upload' && (
        <form
          onSubmit={handleUploadAndPublish}
          className="p-6 rounded-xl border border-zinc-800 bg-zinc-950 space-y-6"
        >
          <div className="border-b border-zinc-900 pb-4">
            <h3 className="text-base font-semibold text-white">
              Upload Video to Cloudflare R2 &amp; Sync to Firebase
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              Directly select a video file from your device to upload via `POST /api/upload` (using
              FormData without manual Content-Type so the browser sets the multipart boundary) and
              automatically register it in your Firebase Realtime Database.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Select Video File (Direct R2 Upload)
                </label>
                <label className="flex flex-col items-center justify-center w-full h-36 border border-dashed border-zinc-700 hover:border-rose-500 rounded-xl bg-zinc-900/40 cursor-pointer transition-colors p-4 text-center">
                  <Upload className="w-6 h-6 text-rose-500 mb-2" />
                  <span className="text-xs font-medium text-zinc-200">
                    {selectedFile ? selectedFile.name : 'Click to select video file (.mp4, .webm, .mkv)'}
                  </span>
                  <span className="text-[11px] font-mono text-zinc-500 mt-1">
                    {selectedFile
                      ? `${formatBytes(selectedFile.size)} · Ready for /api/upload`
                      : 'Uploads directly to mrghost-storage.djsungroup.workers.dev'}
                  </span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setSelectedFile(file);
                      if (file && !videoTitle) {
                        setVideoTitle(
                          file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ')
                        );
                      }
                    }}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    R2 Target Folder (`folder`)
                  </label>
                  <input
                    type="text"
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                    placeholder="videos"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white focus:outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Duration</label>
                  <input
                    type="text"
                    value={videoDuration}
                    onChange={(e) => setVideoDuration(e.target.value)}
                    placeholder="04:30"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Or Direct Stream URL (Optional if uploading file)
                </label>
                <input
                  type="url"
                  value={customVideoUrl}
                  onChange={(e) => setCustomVideoUrl(e.target.value)}
                  placeholder="https://mrghost-storage.djsungroup.workers.dev/videos/sample.mp4"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-white focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Video Title *
                </label>
                <input
                  type="text"
                  required
                  value={videoTitle}
                  onChange={(e) => setVideoTitle(e.target.value)}
                  placeholder="Enter video title..."
                  className="w-full px-3.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-white focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Category
                </label>
                <select
                  value={videoCategory}
                  onChange={(e) => setVideoCategory(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-white focus:outline-none focus:border-rose-500"
                >
                  <option value="Cinema">Cinema</option>
                  <option value="Exclusive">Exclusive</option>
                  <option value="Trending">Trending</option>
                  <option value="Documentary">Documentary</option>
                  <option value="Music & Live">Music &amp; Live</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Description
                </label>
                <textarea
                  rows={4}
                  value={videoDescription}
                  onChange={(e) => setVideoDescription(e.target.value)}
                  placeholder="Describe the video episode or stream details..."
                  className="w-full px-3.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-white focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={isUploading}
              className="px-6 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>
                {isUploading
                  ? 'Uploading to R2 & Publishing...'
                  : 'Upload to Cloudflare R2 & Publish'}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* Tab 2: Cloudflare R2 Bucket Explorer (/api/list & /api/delete) */}
      {activeSubTab === 'bucket' && (
        <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-950 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-rose-500" />
                <span>Cloudflare R2 Bucket Files (`GET /api/list`)</span>
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Manage files stored on your Worker bucket or click Publish to add any existing R2
                object to the video feed.
              </p>
            </div>
            <button
              type="button"
              onClick={fetchR2FileList}
              disabled={isListingR2}
              className="px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isListingR2 ? 'animate-spin' : ''}`} />
              <span>Refresh Bucket</span>
            </button>
          </div>

          {r2Files.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-zinc-900 rounded-xl">
              <p className="text-xs text-zinc-400">
                No files loaded from `/api/list` yet. Enter your `X-Admin-Key` above and click
                Refresh Bucket.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 text-[11px] font-mono text-zinc-500">
                    <th className="py-2.5 px-3">OBJECT KEY</th>
                    <th className="py-2.5 px-3 text-right">SIZE</th>
                    <th className="py-2.5 px-3">UPLOADED</th>
                    <th className="py-2.5 px-3 text-right">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 text-xs">
                  {r2Files.map((file) => (
                    <tr key={file.key} className="hover:bg-zinc-900/50">
                      <td className="py-3 px-3 font-mono text-zinc-200">{file.key}</td>
                      <td className="py-3 px-3 text-right font-mono text-zinc-400 tabular-nums">
                        {formatBytes(file.size)}
                      </td>
                      <td className="py-3 px-3 font-mono text-zinc-500">
                        {new Date(file.uploaded).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => handleQuickPublishR2File(file)}
                          className="px-2.5 py-1 rounded bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-800/60 text-emerald-300 text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer"
                        >
                          <PlusCircle className="w-3 h-3" />
                          <span>Publish to Feed</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteR2File(file.key)}
                          className="px-2.5 py-1 rounded bg-rose-950/60 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Delete</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Firebase Realtime Database Catalog */}
      {activeSubTab === 'catalog' && (
        <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-950 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Film className="w-4 h-4 text-rose-500" />
              <span>Live Firebase Video Catalog (`video-platform-7c031`)</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              All videos currently synced to your public streaming homepage and watch suggestions.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 text-[11px] font-mono text-zinc-500">
                  <th className="py-2.5 px-3">TITLE</th>
                  <th className="py-2.5 px-3">CATEGORY</th>
                  <th className="py-2.5 px-3">STREAM URL</th>
                  <th className="py-2.5 px-3 text-right">VIEWS</th>
                  <th className="py-2.5 px-3 text-right">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 text-xs">
                {videos.map((v) => (
                  <tr key={v.id} className="hover:bg-zinc-900/50">
                    <td className="py-3 px-3 font-medium text-white">{v.title}</td>
                    <td className="py-3 px-3 text-zinc-400">{v.category}</td>
                    <td className="py-3 px-3 font-mono text-zinc-400 max-w-xs truncate">
                      <a
                        href={v.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-rose-400 inline-flex items-center gap-1"
                      >
                        <span className="truncate max-w-[220px]">{v.videoUrl}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-zinc-300 tabular-nums">
                      {v.views.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteFirebaseVideo(v)}
                        className="px-2.5 py-1 rounded bg-rose-950/60 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Remove</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Complete CORS-Fixed Cloudflare Worker Code */}
      {activeSubTab === 'prompt' && (
        <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-950 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">
                CORS-Fixed Cloudflare Worker Script (`cloudflare-worker.js`)
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Replaces `"Access-Control-Allow-Origin": "null"` with `"*"` and merges `corsHeaders`
                into every `json()` response (200, 400, 401, 404, 500) and `OPTIONS` (204).
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(UPDATED_WORKER_CODE);
                setCopiedPrompt(true);
                setTimeout(() => setCopiedPrompt(false), 2000);
              }}
              className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copiedPrompt ? 'Copied Worker Code!' : 'Copy Fixed Worker Code'}</span>
            </button>
          </div>

          <div className="space-y-2">
            <pre className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-300 overflow-x-auto leading-relaxed">
              {UPDATED_WORKER_CODE}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

const UPDATED_WORKER_CODE = `const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (!env.ADMIN_KEY) {
      return json({ error: "Admin secret is not configured" }, 500);
    }

    if (request.headers.get("X-Admin-Key") !== env.ADMIN_KEY) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (!env.BUCKET) {
      return json({ error: "R2 bucket binding missing" }, 500);
    }

    try {
      if (url.pathname === "/api/list" && request.method === "GET") {
        const result = await env.BUCKET.list({
          limit: 1000,
          cursor: url.searchParams.get("cursor") || undefined
        });

        return json({
          files: result.objects.map(obj => ({
            key: obj.key,
            size: obj.size,
            uploaded: obj.uploaded
          })),
          truncated: result.truncated,
          cursor: result.cursor || null
        });
      }

      if (url.pathname === "/api/upload" && request.method === "POST") {
        const form = await request.formData();
        const file = form.get("file");
        const folder = String(form.get("folder") || "")
          .replace(/^\\/+|\\/+$/g, "");

        if (!file || typeof file === "string") {
          return json({ error: "Select a file" }, 400);
        }

        const safeName = file.name.replace(/[\\\\/\\r\\n]/g, "_");

        if (!safeName || safeName === "." || safeName === "..") {
          return json({ error: "Invalid filename" }, 400);
        }

        const key = [folder, safeName].filter(Boolean).join("/");

        await env.BUCKET.put(key, file.stream(), {
          httpMetadata: {
            contentType: file.type || "application/octet-stream"
          }
        });

        return json({ success: true, key });
      }

      if (url.pathname === "/api/delete" && request.method === "DELETE") {
        const body = await request.json();
        const key = body.key;

        if (
          typeof key !== "string" ||
          !key.trim() ||
          key.startsWith("/") ||
          key.split("/").some(part => part === "." || part === "..")
        ) {
          return json({ error: "Invalid file key" }, 400);
        }

        await env.BUCKET.delete(key);
        return json({ success: true, key });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: "Request failed" }, 500);
    }
  }
};`;
