import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { spawn } from 'child_process';
import { Readable } from 'stream';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, X-Worker-Url, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
};

async function startServer() {
  const app = express();
  const PORT = 3000;
  const CANONICAL_SITE_URL = 'https://bdcollection.pages.dev';
  const FIREBASE_RTDB_VIDEOS_URL =
    'https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/videos.json';

  const escapeXml = (str: string) =>
    String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  // Live in-memory + persistent visitor tracking fallback alongside Firebase RTDB
  const seenVisitorIds = new Set<string>();
  const activeOnlineVisitors = new Map<string, { lastSeen: number; page: string }>();

  app.use(express.json({ limit: '64kb' }));

  app.options('/api/visitor-ping', (_req, res) => {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    res.status(204).end();
  });

  app.post('/api/visitor-ping', (req, res) => {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    const visitorId = String(req.body?.visitorId || '').trim().slice(0, 80);
    const page = String(req.body?.page || '/').trim().slice(0, 120);
    const offline = Boolean(req.body?.offline);

    if (visitorId) {
      seenVisitorIds.add(visitorId);
      if (offline) {
        activeOnlineVisitors.delete(visitorId);
      } else {
        activeOnlineVisitors.set(visitorId, { lastSeen: Date.now(), page });
      }
    }

    const cutoff = Date.now() - 65000;
    for (const [vid, info] of activeOnlineVisitors.entries()) {
      if (info.lastSeen < cutoff) activeOnlineVisitors.delete(vid);
    }

    res.json({
      ok: true,
      onlineUsers: activeOnlineVisitors.size,
      totalUsers: seenVisitorIds.size,
    });
  });

  app.get('/api/visitor-stats', (_req, res) => {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    const cutoff = Date.now() - 65000;
    for (const [vid, info] of activeOnlineVisitors.entries()) {
      if (info.lastSeen < cutoff) activeOnlineVisitors.delete(vid);
    }
    res.json({
      onlineUsers: activeOnlineVisitors.size,
      totalUsers: seenVisitorIds.size,
      onlineVisitorIds: Array.from(activeOnlineVisitors.keys()),
    });
  });

  // SEO robots.txt route
  app.get('/robots.txt', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(
      [
        'User-agent: *',
        'Allow: /',
        'Allow: /api/stream',
        'Disallow: /ad.html',
        'Disallow: /api/r2-proxy/',
        '',
        'User-agent: Googlebot',
        'Allow: /',
        'Allow: /api/stream',
        'Disallow: /ad.html',
        'Disallow: /api/r2-proxy/',
        '',
        'User-agent: Googlebot-Video',
        'Allow: /',
        'Allow: /api/stream',
        '',
        'User-agent: Googlebot-Image',
        'Allow: /',
        '',
        `Sitemap: ${CANONICAL_SITE_URL}/sitemap.xml`,
        '',
      ].join('\n')
    );
  });

  // Dynamic Google Video Sitemap (/sitemap.xml) synced live with Firebase Realtime Database
  app.get('/sitemap.xml', async (_req, res) => {
    try {
      const fbRes = await fetch(FIREBASE_RTDB_VIDEOS_URL);
      const data = fbRes.ok ? await fbRes.json() : {};
      const todayIso = new Date().toISOString();
      const brokenFiles = ['5_6230929087481782223.mp4', 'VID_20261015_090110_156.mp4'];

      const parseDurationSec = (raw?: string): number => {
        if (!raw || typeof raw !== 'string') return 210;
        const parts = raw.trim().split(':').map((n) => parseInt(n, 10));
        if (parts.some((n) => isNaN(n) || n < 0)) return 210;
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) {
          const total = parts[0] * 60 + parts[1];
          return total > 0 ? total : 210;
        }
        return 210;
      };

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`;
      xml += `        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n`;
      xml += `  <url>\n`;
      xml += `    <loc>${CANONICAL_SITE_URL}/</loc>\n`;
      xml += `    <lastmod>${todayIso}</lastmod>\n`;
      xml += `    <changefreq>hourly</changefreq>\n`;
      xml += `    <priority>1.0</priority>\n`;
      xml += `  </url>\n`;

      if (data && typeof data === 'object') {
        for (const [id, rawVal] of Object.entries(data as Record<string, any>)) {
          if (!rawVal || typeof rawVal !== 'object') continue;
          const title = (rawVal.title || 'Bd Collection Viral Video').trim();
          const desc = (
            rawVal.description ||
            rawVal.keywords ||
            `${title} - Watch exclusive Bangladeshi viral video in HD on Bd Collection.`
          ).trim();
          const thumb = (rawVal.thumbnail || rawVal.thumbnailUrl || `${CANONICAL_SITE_URL}/favicon.png`).trim();
          const contentLoc = (rawVal.url || rawVal.videoUrl || '').trim();
          if (!contentLoc || brokenFiles.some((b) => contentLoc.includes(b))) continue;

          const views = Number(rawVal.views) || 0;
          const ts = Number(rawVal.addedAt || rawVal.createdAt) || Date.now();
          const pubIso = new Date(ts).toISOString();
          const durationSec = parseDurationSec(rawVal.duration);
          const pageLoc = `${CANONICAL_SITE_URL}/?v=${encodeURIComponent(id)}`;

          xml += `  <url>\n`;
          xml += `    <loc>${escapeXml(pageLoc)}</loc>\n`;
          xml += `    <lastmod>${pubIso}</lastmod>\n`;
          xml += `    <changefreq>daily</changefreq>\n`;
          xml += `    <priority>0.9</priority>\n`;
          xml += `    <video:video>\n`;
          xml += `      <video:thumbnail_loc>${escapeXml(thumb)}</video:thumbnail_loc>\n`;
          xml += `      <video:title>${escapeXml(title)}</video:title>\n`;
          xml += `      <video:description>${escapeXml(desc)}</video:description>\n`;
          xml += `      <video:content_loc>${escapeXml(contentLoc)}</video:content_loc>\n`;
          xml += `      <video:player_loc allow_embed="yes">${escapeXml(pageLoc)}</video:player_loc>\n`;
          xml += `      <video:duration>${durationSec}</video:duration>\n`;
          xml += `      <video:view_count>${views}</video:view_count>\n`;
          xml += `      <video:publication_date>${pubIso}</video:publication_date>\n`;
          xml += `      <video:family_friendly>yes</video:family_friendly>\n`;
          xml += `      <video:live>no</video:live>\n`;
          xml += `    </video:video>\n`;
          xml += `  </url>\n`;
        }
      }

      xml += `</urlset>\n`;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.send(xml);
    } catch {
      res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
    }
  });

  // Direct Image Download Proxy (/api/download-image) so external thumbnails (ImgBB/PostImg) download cleanly
  app.get('/api/download-image', async (req, res) => {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    const rawUrl = String(req.query.url || '').trim();
    const rawName = String(req.query.filename || 'thumbnail.jpg')
      .replace(/[^a-zA-Z0-9_\-.]/g, '_')
      .slice(0, 90);
    const filename = rawName.endsWith('.jpg') || rawName.endsWith('.png') || rawName.endsWith('.webp')
      ? rawName
      : `${rawName}.jpg`;

    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      res.status(400).json({ error: 'Invalid image URL' });
      return;
    }

    try {
      const upstream = await fetch(rawUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        redirect: 'follow',
      });
      if (!upstream.ok) {
        res.status(upstream.status).end();
        return;
      }
      const ct = upstream.headers.get('content-type') || 'image/jpeg';
      const arrayBuf = await upstream.arrayBuffer();
      res.setHeader('Content-Type', ct);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(Buffer.from(arrayBuf));
    } catch (err: any) {
      res.status(502).json({ error: err?.message || 'Failed to download image' });
    }
  });

  // High-speed Video Stream Proxy & Codec Transcoder (/api/stream)
  // Fixes playback for pub-*.r2.dev/*.mp4 across all ISPs, browsers, Range requests, and HEVC/AV1 codecs
  app.options('/api/stream', (_req, res) => {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    res.status(204).end();
  });

  app.get('/api/stream', async (req, res) => {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

    const rawUrl = String(req.query.url || '').trim();
    const transcode = req.query.transcode === '1';

    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      res.status(400).json({ error: 'Invalid or missing video URL' });
      return;
    }

    // Ensure proper URL encoding for Bengali/spaces in filenames while preserving existing %XX sequences
    let targetUrl = rawUrl;
    try {
      const parsed = new URL(rawUrl);
      targetUrl = parsed.toString();
    } catch {
      targetUrl = encodeURI(rawUrl);
    }

    const KNOWN_R2_PUBLIC_DOMAINS = [
      'https://pub-56ae26091320480ca8946ab4e42a051d.r2.dev',
      'https://pub-a89cc17745e446439972f8e3a1b3c661.r2.dev',
      'https://pub-b89fbff1088544e2a25d432417afc3b1.r2.dev',
      'https://pub-f58d47fa71fd4d4e98985fc906988f57.r2.dev',
    ];

    const buildR2FallbackCandidates = (initialUrl: string): string[] => {
      const list = [initialUrl];
      try {
        const u = new URL(initialUrl);
        if (u.hostname.endsWith('.r2.dev')) {
          const pathWithQuery = u.pathname + u.search;
          for (const dom of KNOWN_R2_PUBLIC_DOMAINS) {
            const candidate = `${dom}${pathWithQuery}`;
            if (!list.includes(candidate)) list.push(candidate);
          }
          // If path starts with /shorts/, also try root key on each domain as fallback
          if (u.pathname.startsWith('/shorts/')) {
            const rootPath = u.pathname.replace(/^\/shorts\//, '/');
            for (const dom of KNOWN_R2_PUBLIC_DOMAINS) {
              const candidate = `${dom}${rootPath}${u.search}`;
              if (!list.includes(candidate)) list.push(candidate);
            }
          }
        }
      } catch {}
      return list;
    };

    // Optional FFmpeg live transcode mode for HEVC (H.265) / AV1 / incompatible MP4 containers
    if (transcode) {
      res.status(200);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'no-cache');

      const ffArgs = [
        '-loglevel', 'error',
        '-i', targetUrl,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '28',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4',
        'pipe:1',
      ];

      const ffProc = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
      ffProc.stdout.pipe(res);

      const cleanup = () => {
        try {
          ffProc.kill('SIGKILL');
        } catch {}
      };
      req.on('close', cleanup);
      res.on('close', cleanup);
      ffProc.on('error', () => {
        if (!res.headersSent) res.status(502).end();
      });
      return;
    }

    // Standard HTTP Byte-Range Streaming Proxy (206 Partial Content) with automatic multi-bucket R2 failover
    const abortController = new AbortController();
    req.on('close', () => {
      try {
        abortController.abort();
      } catch {}
    });

    try {
      const upstreamHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      };
      if (req.headers.range) {
        upstreamHeaders['Range'] = req.headers.range;
      } else {
        // Request from byte 0 so Cloudflare R2 always includes Content-Range and Accept-Ranges
        upstreamHeaders['Range'] = 'bytes=0-';
      }

      const candidateUrls = buildR2FallbackCandidates(targetUrl);
      let upstreamRes: Response | null = null;

      for (const candidateUrl of candidateUrls) {
        const attemptRes = await fetch(candidateUrl, {
          method: req.method === 'HEAD' ? 'HEAD' : 'GET',
          headers: upstreamHeaders,
          redirect: 'follow',
          signal: abortController.signal,
        });
        if (attemptRes.ok || attemptRes.status === 206) {
          upstreamRes = attemptRes;
          break;
        }
        if (!upstreamRes) {
          upstreamRes = attemptRes;
        }
      }

      if (!upstreamRes || (!upstreamRes.ok && upstreamRes.status !== 206)) {
        res.status(upstreamRes ? upstreamRes.status : 404).end();
        return;
      }

      const status = req.headers.range ? upstreamRes.status : (upstreamRes.status === 206 ? 206 : 200);
      res.status(status);

      const contentType = upstreamRes.headers.get('content-type');
      res.setHeader(
        'Content-Type',
        contentType && contentType.includes('video') ? contentType : 'video/mp4'
      );
      res.setHeader('Accept-Ranges', 'bytes');

      const contentLength = upstreamRes.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);

      const contentRange = upstreamRes.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);

      const etag = upstreamRes.headers.get('etag');
      if (etag) res.setHeader('ETag', etag);

      if (req.method === 'HEAD' || !upstreamRes.body) {
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(upstreamRes.body as any);
      nodeStream.on('error', () => {
        try {
          res.end();
        } catch {}
      });
      nodeStream.pipe(res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(502).json({ error: err?.message || 'Stream proxy error' });
      }
    }
  });

  // Apply CORS headers to all /api/r2-proxy routes and handle OPTIONS preflight
  app.use('/api/r2-proxy', (req, res, next) => {
    Object.entries(corsHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Server-side proxy fallback to forward requests to the Cloudflare Worker
  // in case the remote Cloudflare Worker still returns Access-Control-Allow-Origin: "null"
  app.all('/api/r2-proxy/:endpoint', async (req, res) => {
    try {
      const endpoint = req.params.endpoint; // 'list', 'upload', or 'delete'
      const rawWorkerUrl = (req.headers['x-worker-url'] as string) || '';
      const baseUrl = rawWorkerUrl.trim().replace(/\/+$/, '');
      if (!baseUrl) {
        res.status(400).set(corsHeaders).json({ error: 'Missing X-Worker-Url header' });
        return;
      }
      const adminKey = (req.headers['x-admin-key'] as string) || '';

      const queryIndex = req.originalUrl.indexOf('?');
      const queryString = queryIndex !== -1 ? req.originalUrl.slice(queryIndex) : '';
      const targetUrl = `${baseUrl}/api/${endpoint}${queryString}`;

      const forwardHeaders: Record<string, string> = {
        'X-Admin-Key': adminKey,
      };

      if (req.headers['content-type']) {
        forwardHeaders['Content-Type'] = req.headers['content-type'] as string;
      }

      let bodyBuffer: Buffer | undefined = undefined;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        bodyBuffer = Buffer.concat(chunks);
      }

      const upstreamRes = await fetch(targetUrl, {
        method: req.method,
        headers: forwardHeaders,
        body: bodyBuffer ? new Uint8Array(bodyBuffer) : undefined,
      });

      const responseText = await upstreamRes.text();
      res.status(upstreamRes.status);
      res.setHeader('Content-Type', 'application/json');
      Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
      res.send(responseText);
    } catch (error: any) {
      console.error('R2 Proxy error:', error);
      res.status(500).set(corsHeaders).json({
        error: error?.message || 'Proxy request to Cloudflare Worker failed',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/ad.html', (_req, res) => {
      res.sendFile(path.join(distPath, 'ad.html'));
    });
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
