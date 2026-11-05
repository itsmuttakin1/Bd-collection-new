import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
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
  const CANONICAL_SITE_URL = 'https://xtubeofficial.pages.dev';
  const FIREBASE_RTDB_VIDEOS_URL =
    'https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/videos.json';
  const FIREBASE_RTDB_SHORTS_URL =
    'https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app/shorts.json';

  const SEO_CORE_TAGS = [
    'X Tube',
    'X tube official',
    'xxx',
    'xtube',
    'x tube video',
    'x tube shorts',
    'Bangladeshi viral video',
    'bd viral link',
    'বাংলা ভাইরাল ভিডিও',
    'desi viral video',
  ];

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

  // SEO robots.txt route for X Tube (Allows Full Videos, Shorts & Streams for Googlebot)
  const buildRobotsTxt = () =>
    [
      '# X Tube Official - Search Engine Crawler Rules',
      '# Keywords: X Tube, X tube official, xxx, xtube, viral videos, shorts',
      'User-agent: *',
      'Allow: /',
      'Allow: /?v=',
      'Allow: /?short=',
      'Allow: /api/stream',
      'Disallow: /ad.html',
      'Disallow: /api/r2-proxy/',
      '',
      'User-agent: Googlebot',
      'Allow: /',
      'Allow: /?v=',
      'Allow: /?short=',
      'Allow: /api/stream',
      'Disallow: /ad.html',
      'Disallow: /api/r2-proxy/',
      '',
      'User-agent: Googlebot-Video',
      'Allow: /',
      'Allow: /?v=',
      'Allow: /?short=',
      'Allow: /api/stream',
      '',
      'User-agent: Googlebot-Image',
      'Allow: /',
      '',
      'User-agent: Bingbot',
      'Allow: /',
      'Allow: /?v=',
      'Allow: /?short=',
      '',
      `Sitemap: ${CANONICAL_SITE_URL}/sitemap.xml`,
      `Sitemap: ${CANONICAL_SITE_URL}/sitemap-videos.xml`,
      `Sitemap: ${CANONICAL_SITE_URL}/sitemap-shorts.xml`,
      '',
    ].join('\n');

  app.get('/robots.txt', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(buildRobotsTxt());
  });

  // Helper to build live Google Video + Shorts Sitemap XML from Firebase RTDB and auto-sync to disk
  const generateLiveSitemapXml = async (
    mode: 'all' | 'videos' | 'shorts' = 'all'
  ): Promise<{ xml: string; videoCount: number; shortCount: number }> => {
    const [videosRes, shortsRes] = await Promise.all([
      fetch(FIREBASE_RTDB_VIDEOS_URL, { cache: 'no-store' }).catch(() => null),
      fetch(FIREBASE_RTDB_SHORTS_URL, { cache: 'no-store' }).catch(() => null),
    ]);

    const videosData = videosRes && videosRes.ok ? await videosRes.json() : {};
    const shortsData = shortsRes && shortsRes.ok ? await shortsRes.json() : {};
    const todayIso = new Date().toISOString();
    const brokenFiles = ['5_6230929087481782223.mp4', 'VID_20261015_090110_156.mp4'];

    const parseDurationSec = (raw?: string, fallbackSec = 210): number => {
      if (!raw || typeof raw !== 'string') return fallbackSec;
      const parts = raw.trim().split(':').map((n) => parseInt(n, 10));
      if (parts.some((n) => isNaN(n) || n < 0)) return fallbackSec;
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) {
        const total = parts[0] * 60 + parts[1];
        return total > 0 ? total : fallbackSec;
      }
      return fallbackSec;
    };

    const normalizeShortUrl = (rawUrl: string, r2Key?: string): string => {
      let clean = String(rawUrl || '').trim();
      if (!clean && r2Key) {
        clean = `https://pub-56ae26091320480ca8946ab4e42a051d.r2.dev/${String(r2Key).replace(/^\/+/, '')}`;
      }
      if (clean.includes('pub-a89cc17745e446439972f8e3a1b3c661.r2.dev/shorts/')) {
        clean = clean.replace(
          'pub-a89cc17745e446439972f8e3a1b3c661.r2.dev/shorts/',
          'pub-56ae26091320480ca8946ab4e42a051d.r2.dev/shorts/'
        );
      }
      return clean;
    };

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`;
    xml += `        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n`;

    // Root X Tube Homepage
    xml += `  <url>\n`;
    xml += `    <loc>${CANONICAL_SITE_URL}/</loc>\n`;
    xml += `    <lastmod>${todayIso}</lastmod>\n`;
    xml += `    <changefreq>hourly</changefreq>\n`;
    xml += `    <priority>1.0</priority>\n`;
    xml += `  </url>\n`;

    // Dedicated X Tube Shorts Feed Hub URL for Google Indexing
    if (mode === 'all' || mode === 'shorts') {
      xml += `  <url>\n`;
      xml += `    <loc>${CANONICAL_SITE_URL}/?short=feed</loc>\n`;
      xml += `    <lastmod>${todayIso}</lastmod>\n`;
      xml += `    <changefreq>hourly</changefreq>\n`;
      xml += `    <priority>0.95</priority>\n`;
      xml += `  </url>\n`;
    }

    let videoCount = 0;
    let shortCount = 0;

    // 1. Add all published Full Videos (`/?v=<id>`)
    if ((mode === 'all' || mode === 'videos') && videosData && typeof videosData === 'object') {
      const videoEntries = Object.entries(videosData as Record<string, any>).sort(
        (a, b) =>
          (Number(b[1]?.addedAt || b[1]?.createdAt) || 0) -
          (Number(a[1]?.addedAt || a[1]?.createdAt) || 0)
      );

      for (const [id, rawVal] of videoEntries) {
        if (!rawVal || typeof rawVal !== 'object') continue;
        const rawTitle = (rawVal.title || 'X Tube Official Viral Video').trim();
        const title = rawTitle.toLowerCase().includes('x tube')
          ? rawTitle
          : `${rawTitle} | X Tube Official`;
        const desc = (
          rawVal.description ||
          `${rawTitle} - Watch exclusive HD viral video on X Tube (X Tube Official, xxx, Bangladeshi viral stream).`
        ).trim();
        const rawThumb = (rawVal.thumbnail || rawVal.thumbnailUrl || '').trim();
        const thumb =
          rawThumb && !rawThumb.includes('ibb.co') && !rawThumb.includes('imgbb.com')
            ? rawThumb
            : `${CANONICAL_SITE_URL}/favicon.png`;
        const contentLoc = (rawVal.url || rawVal.videoUrl || '').trim();
        if (!contentLoc || brokenFiles.some((b) => contentLoc.includes(b))) continue;

        const views = Number(rawVal.views) || 0;
        const ts = Number(rawVal.addedAt || rawVal.createdAt) || Date.now();
        const pubIso = new Date(ts).toISOString();
        const durationSec = parseDurationSec(rawVal.duration, 210);
        const pageLoc = `${CANONICAL_SITE_URL}/?v=${encodeURIComponent(id)}`;

        const itemTags = Array.from(
          new Set([
            ...SEO_CORE_TAGS,
            ...String(rawVal.keywords || '')
              .split(/[,#]+/)
              .map((s) => s.trim())
              .filter(Boolean),
          ])
        ).slice(0, 15);

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
        for (const tag of itemTags) {
          xml += `      <video:tag>${escapeXml(tag)}</video:tag>\n`;
        }
        xml += `    </video:video>\n`;
        xml += `  </url>\n`;
        videoCount++;
      }
    }

    // 2. Add all uploaded Shorts (`/?short=<id>`) so X Tube Shorts rank on Google Video & Shorts Search
    if ((mode === 'all' || mode === 'shorts') && shortsData && typeof shortsData === 'object') {
      const shortEntries = Object.entries(shortsData as Record<string, any>).sort(
        (a, b) =>
          (Number(b[1]?.addedAt || b[1]?.createdAt) || 0) -
          (Number(a[1]?.addedAt || a[1]?.createdAt) || 0)
      );

      for (const [id, rawVal] of shortEntries) {
        if (!rawVal || typeof rawVal !== 'object') continue;
        const rawTitle = (rawVal.title || 'X Tube Viral Short 🔥').trim();
        const title = rawTitle.toLowerCase().includes('x tube')
          ? rawTitle
          : `${rawTitle} | X Tube Shorts`;
        const hashtags = String(rawVal.hashtags || rawVal.keywords || '#Shorts #XTube #XXX #BdViral').trim();
        const desc = `${rawTitle} ${hashtags} - Watch viral vertical Short video on X Tube Official (X Tube Shorts, xxx, trending short clip).`.trim();
        const rawShortThumb = (rawVal.thumbnail || rawVal.thumbnailUrl || '').trim();
        const thumb =
          rawShortThumb && !rawShortThumb.includes('ibb.co') && !rawShortThumb.includes('imgbb.com')
            ? rawShortThumb
            : `${CANONICAL_SITE_URL}/favicon.png`;
        const contentLoc = normalizeShortUrl(rawVal.url || rawVal.videoUrl || '', rawVal.r2Key);
        if (!contentLoc) continue;

        const views = Number(rawVal.views) || 0;
        const ts = Number(rawVal.addedAt || rawVal.createdAt) || Date.now();
        const pubIso = new Date(ts).toISOString();
        const durationSec = parseDurationSec(rawVal.duration, 35);
        const pageLoc = `${CANONICAL_SITE_URL}/?short=${encodeURIComponent(id)}`;

        const shortTags = Array.from(
          new Set([
            ...SEO_CORE_TAGS,
            'X Tube Shorts',
            'YouTube Shorts',
            'Viral Shorts',
            ...hashtags
              .split(/[\s,#]+/)
              .map((s) => s.trim())
              .filter(Boolean),
          ])
        ).slice(0, 15);

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
        for (const tag of shortTags) {
          xml += `      <video:tag>${escapeXml(tag)}</video:tag>\n`;
        }
        xml += `    </video:video>\n`;
        xml += `  </url>\n`;
        shortCount++;
      }
    }

    xml += `</urlset>\n`;

    // Automatically persist updated sitemap.xml & robots.txt to public/ (and dist/ if built)
    if (mode === 'all') {
      try {
        const publicSitemapPath = path.join(__dirname, 'public', 'sitemap.xml');
        fs.writeFileSync(publicSitemapPath, xml, 'utf-8');
        const publicRobotsPath = path.join(__dirname, 'public', 'robots.txt');
        fs.writeFileSync(publicRobotsPath, buildRobotsTxt(), 'utf-8');

        const distDir = path.join(__dirname, 'dist');
        if (fs.existsSync(distDir)) {
          fs.writeFileSync(path.join(distDir, 'sitemap.xml'), xml, 'utf-8');
          fs.writeFileSync(path.join(distDir, 'robots.txt'), buildRobotsTxt(), 'utf-8');
        }
      } catch {}
    }

    return { xml, videoCount, shortCount };
  };

  // Auto-sync sitemap on server boot and every 5 minutes in the background
  generateLiveSitemapXml('all').catch(() => {});
  setInterval(() => {
    generateLiveSitemapXml('all').catch(() => {});
  }, 5 * 60 * 1000);

  // Automatic Google Search Console HTML File Verification (/googleXXXX.html) & IndexNow Key
  app.get(/^\/google[a-zA-Z0-9_-]+\.html$/i, (req, res) => {
    const fileName = req.path.replace(/^\/+/, '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(`google-site-verification: ${fileName}`);
  });

  app.get('/xtubeofficial2026.txt', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send('xtubeofficial2026');
  });

  // Dynamic Google Video + Shorts Sitemap (/sitemap.xml) synced live with Firebase Realtime Database
  app.get('/sitemap.xml', async (_req, res) => {
    try {
      const { xml } = await generateLiveSitemapXml('all');
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=180');
      res.send(xml);
    } catch {
      res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
    }
  });

  app.get('/sitemap-videos.xml', async (_req, res) => {
    try {
      const { xml } = await generateLiveSitemapXml('videos');
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=180');
      res.send(xml);
    } catch {
      res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
    }
  });

  app.get('/sitemap-shorts.xml', async (_req, res) => {
    try {
      const { xml } = await generateLiveSitemapXml('shorts');
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=180');
      res.send(xml);
    } catch {
      res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
    }
  });

  // Instant Auto-Refresh Sitemap API (Triggered automatically whenever Admin uploads/edits/deletes a Video or Short)
  app.all('/api/refresh-sitemap', async (_req, res) => {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    try {
      const { videoCount, shortCount } = await generateLiveSitemapXml('all');
      // Also ping IndexNow / Search Engine endpoints non-blockingly
      fetch(
        `https://www.bing.com/indexnow?url=${encodeURIComponent(
          `${CANONICAL_SITE_URL}/sitemap.xml`
        )}&key=xtubeofficial2026`
      ).catch(() => {});
      res.json({
        ok: true,
        site: 'X Tube',
        sitemapUrl: `${CANONICAL_SITE_URL}/sitemap.xml`,
        shortsSitemapUrl: `${CANONICAL_SITE_URL}/sitemap-shorts.xml`,
        videoCount,
        shortCount,
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Sitemap refresh failed' });
    }
  });

  // In-memory fallback session store for Telegram Upload Bot
  const tgBotMemorySessions = new Map<string, { unlocked: boolean; mode: string }>();

  // Telegram Bot Video Upload Webhook (/api/telegram-bot)
  app.all('/api/telegram-bot', async (req, res) => {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method === 'GET') {
      res.json({
        ok: true,
        service: 'X Tube Official Telegram Upload Bot Webhook',
        domain: CANONICAL_SITE_URL,
      });
      return;
    }

    try {
      const update = req.body || {};
      const botToken = String(req.query.token || '').trim();
      const workerUrl = String(req.query.worker || '').trim().replace(/\/+$/, '');
      const publicUrl = String(req.query.pub || '').trim().replace(/\/+$/, '');
      const adminKey = String(req.query.key || '').trim();
      const requiredPass = String(req.query.pass || 'Muttakin').trim();
      const fbEmail = String(req.query.fbEmail || '').trim();
      const fbPass = String(req.query.fbPass || '').trim();
      const firebaseWebApiKey = 'AIzaSyBPrgfeMTuy3GI1nb2jgw-qqQn6wPvH-0w';
      const firebaseRtdbBase =
        'https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app';

      if (!botToken) {
        res.status(200).json({ ok: false, error: 'Missing bot token' });
        return;
      }

      const tgApi = async (method: string, payload: Record<string, any>) => {
        const resp = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return resp.json().catch(() => ({}));
      };

      const getFirebaseAuthQuery = async (): Promise<string> => {
        if (!fbEmail || !fbPass) return '';
        try {
          const authRes = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseWebApiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: fbEmail,
                password: fbPass,
                returnSecureToken: true,
              }),
            }
          );
          const authData: any = await authRes.json();
          if (authData?.idToken) {
            return `?auth=${encodeURIComponent(authData.idToken)}`;
          }
        } catch {}
        return '';
      };

      const getChatSession = async (chatId: string | number) => {
        const key = String(chatId);
        if (tgBotMemorySessions.has(key)) {
          return tgBotMemorySessions.get(key)!;
        }
        try {
          const fbRes = await fetch(`${firebaseRtdbBase}/telegramBotSessions/${key}.json`);
          if (fbRes.ok) {
            const fbData: any = await fbRes.json();
            if (fbData && typeof fbData === 'object') {
              tgBotMemorySessions.set(key, fbData);
              return fbData;
            }
          }
        } catch {}
        return { unlocked: false, mode: '' };
      };

      const saveChatSession = async (
        chatId: string | number,
        sessionObj: { unlocked: boolean; mode: string }
      ) => {
        const key = String(chatId);
        tgBotMemorySessions.set(key, sessionObj);
        try {
          const authQ = await getFirebaseAuthQuery();
          await fetch(`${firebaseRtdbBase}/telegramBotSessions/${key}.json${authQ}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...sessionObj,
              botAuthToken: 'xtube_tg_bot_2026',
              updatedAt: Date.now(),
            }),
          });
        } catch {}
      };

      const categoryKeyboard = {
        inline_keyboard: [
          [
            { text: '📱 Shorts Video', callback_data: 'mode_shorts' },
            { text: '🎬 Long Video', callback_data: 'mode_long' },
          ],
          [{ text: '🚀 Both (Shorts + Long)', callback_data: 'mode_both' }],
        ],
      };

      const modeLabel = (m: string) =>
        m === 'shorts'
          ? '📱 Shorts Only'
          : m === 'long'
          ? '🎬 Long Video Only'
          : '🚀 Both (Shorts + Long)';

      if (update.callback_query) {
        const cb = update.callback_query;
        const chatId = cb.message?.chat?.id;
        const data = String(cb.data || '');

        if (chatId && data.startsWith('mode_')) {
          const session = await getChatSession(chatId);
          if (!session.unlocked) {
            await tgApi('answerCallbackQuery', {
              callback_query_id: cb.id,
              text: '🔐 আগে পাসওয়ার্ড দিয়ে আনলক করুন!',
              show_alert: true,
            });
            await tgApi('sendMessage', {
              chat_id: chatId,
              text: '🔐 অনুগ্রহ করে প্রথমে পাসওয়ার্ড দিন:',
            });
            res.status(200).send('OK');
            return;
          }

          const chosenMode = data.replace('mode_', '');
          await saveChatSession(chatId, { unlocked: true, mode: chosenMode });
          await tgApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: `Selected: ${modeLabel(chosenMode)}`,
          });
          await tgApi('sendMessage', {
            chat_id: chatId,
            text:
              `✅ ক্যাটাগরি সিলেক্ট হয়েছে: *${modeLabel(chosenMode)}*\n\n` +
              `📤 *এখন আপনার ভিডিও ফাইলটি এখানে পাঠান (Send Video)!*\n` +
              `💡 টিপস: ভিডিও পাঠানোর সময় Caption-এ টাইটেল লিখে দিতে পারেন। কিছু না লিখলে অটোমেটিক ভাইরাল টাইটেল ও হ্যাশট্যাগ বসে যাবে।`,
            parse_mode: 'Markdown',
            reply_markup: categoryKeyboard,
          });
        }
        res.status(200).send('OK');
        return;
      }

      const msg = update.message || update.edited_message;
      if (!msg || !msg.chat) {
        res.status(200).send('OK');
        return;
      }

      const chatId = msg.chat.id;
      const text = String(msg.text || '').trim();
      const session = await getChatSession(chatId);

      if (text === '/start' || text === '/login') {
        await saveChatSession(chatId, { unlocked: false, mode: '' });
        await tgApi('sendMessage', {
          chat_id: chatId,
          text:
            `🎬 *X Tube Official Video Upload Bot*-এ স্বাগতম!\n\n` +
            `🔐 ভিডিও আপলোড শুরু করতে অনুগ্রহ করে আপনার পাসওয়ার্ড দিন:`,
          parse_mode: 'Markdown',
        });
        res.status(200).send('OK');
        return;
      }

      if (text === '/logout') {
        await saveChatSession(chatId, { unlocked: false, mode: '' });
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: '🔒 বট লক করা হয়েছে। আবার শুরু করতে /start লিখুন।',
        });
        res.status(200).send('OK');
        return;
      }

      if (!session.unlocked) {
        if (text.toLowerCase() === requiredPass.toLowerCase()) {
          await saveChatSession(chatId, { unlocked: true, mode: 'both' });
          await tgApi('sendMessage', {
            chat_id: chatId,
            text:
              `✅ *পাসওয়ার্ড সঠিক হয়েছে! স্বাগতম ${requiredPass}* 🎉\n\n` +
              `👇 এখন কোন ক্যাটাগরিতে ভিডিও আপলোড করতে চান সিলেক্ট করুন:`,
            parse_mode: 'Markdown',
            reply_markup: categoryKeyboard,
          });
        } else {
          await tgApi('sendMessage', {
            chat_id: chatId,
            text:
              `❌ পাসওয়ার্ড সঠিক নয়!\n\n` +
              `🔐 ভিডিও আপলোড করতে সঠিক পাসওয়ার্ড দিন (অথবা /start চাপুন):`,
          });
        }
        res.status(200).send('OK');
        return;
      }

      if (text.toLowerCase() === 'shorts' || text === '/shorts') {
        await saveChatSession(chatId, { unlocked: true, mode: 'shorts' });
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: `✅ ক্যাটাগরি: *📱 Shorts Only* সিলেক্ট হয়েছে! এখন ভিডিও পাঠান:`,
          parse_mode: 'Markdown',
          reply_markup: categoryKeyboard,
        });
        res.status(200).send('OK');
        return;
      }
      if (text.toLowerCase() === 'long' || text === '/long') {
        await saveChatSession(chatId, { unlocked: true, mode: 'long' });
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: `✅ ক্যাটাগরি: *🎬 Long Video Only* সিলেক্ট হয়েছে! এখন ভিডিও পাঠান:`,
          parse_mode: 'Markdown',
          reply_markup: categoryKeyboard,
        });
        res.status(200).send('OK');
        return;
      }
      if (text.toLowerCase() === 'both' || text === '/both') {
        await saveChatSession(chatId, { unlocked: true, mode: 'both' });
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: `✅ ক্যাটাগরি: *🚀 Both (Shorts + Long)* সিলেক্ট হয়েছে! এখন ভিডিও পাঠান:`,
          parse_mode: 'Markdown',
          reply_markup: categoryKeyboard,
        });
        res.status(200).send('OK');
        return;
      }

      const videoMedia =
        msg.video ||
        msg.animation ||
        (msg.document && String(msg.document.mime_type || '').startsWith('video/')
          ? msg.document
          : null);

      const isDirectVideoUrl = /^https?:\/\/\S+\.(mp4|webm|mkv|mov)(\?\S*)?$/i.test(text);

      if (!videoMedia && !isDirectVideoUrl) {
        await tgApi('sendMessage', {
          chat_id: chatId,
          text:
            `📂 বর্তমান ক্যাটাগরি: *${modeLabel(session.mode || 'both')}*\n\n` +
            `📤 অনুগ্রহ করে একটি *ভিডিও ফাইল (Video)* পাঠান অথবা নিচের বাটন থেকে ক্যাটাগরি পরিবর্তন করুন:`,
          parse_mode: 'Markdown',
          reply_markup: categoryKeyboard,
        });
        res.status(200).send('OK');
        return;
      }

      const activeMode = session.mode || 'both';
      const statusMsg: any = await tgApi('sendMessage', {
        chat_id: chatId,
        text: `⏳ ভিডিওটি *${modeLabel(activeMode)}*-এ আপলোড হচ্ছে... অনুগ্রহ করে কয়েক সেকেন্ড অপেক্ষা করুন...`,
        parse_mode: 'Markdown',
      });

      const viralPresets = [
        {
          title: '🔥 দেশি ভাইরাল হট ভিডিও 🥵💋 #Shorts #BdViral #18Plus #DesiHot',
          tags: '#Shorts #BdViral #18Plus #DesiHot #RoomDate #ViralGirl Virallink bdgirl',
        },
        {
          title: '💋 গার্লফ্রেন্ডের সাথে গোপন রুম ডেট ভাইরাল ক্লিপ 🔥🥵 #BdViral #RoomDate #18Plus',
          tags: '#Shorts #RoomDate #BdViral #18Plus #DesiGirl #ViralLink Virallink bdgirl',
        },
        {
          title: '🥵 নতুন দেশি ভাবি হট ভাইরাল ভিডিও 🔥💋 #HotBhabi #BdViral #18Plus #Shorts',
          tags: '#Shorts #HotBhabi #BdViral #18Plus #DesiHot #Exclusive18 Virallink bdgirl',
        },
        {
          title: '🎬 কলেজের মেয়ের প্রাইভেট ভাইরাল ভিডিও 🥵💦 #ViralGirl #BdViral #18Plus',
          tags: '#Shorts #ViralGirl #BdViral #18Plus #PrivateLeak #DesiHot Virallink bdgirl',
        },
      ];
      const randomPreset = viralPresets[Math.floor(Math.random() * viralPresets.length)];
      const captionText = String(msg.caption || '').trim();
      const finalTitle = captionText || randomPreset.title;
      const finalKeywords = randomPreset.tags;

      let finalStreamUrl = '';
      let r2KeySaved = '';
      let durationFormatted = '00:45';

      if (isDirectVideoUrl) {
        finalStreamUrl = text;
      } else {
        const durSec = Number(videoMedia.duration) || 45;
        const mins = String(Math.floor(durSec / 60)).padStart(2, '0');
        const secs = String(Math.floor(durSec % 60)).padStart(2, '0');
        durationFormatted = `${mins}:${secs}`;

        if (videoMedia.file_size && Number(videoMedia.file_size) > 20 * 1024 * 1024) {
          await tgApi('sendMessage', {
            chat_id: chatId,
            text:
              `⚠️ Telegram Bot API-এর নিয়ম অনুযায়ী বট সরাসরি ২০ MB-এর নিচের ভিডিও ডাউনলোড করতে পারে (আপনার ভিডিওটি ${(
                Number(videoMedia.file_size) /
                (1024 * 1024)
              ).toFixed(1)} MB)।\n\n` +
              `💡 সমাধান: ২০ MB-এর নিচের ভিডিও পাঠান অথবা বড় ভিডিওর ডিরেক্ট .mp4 লিংক এখানে পেস্ট করুন!`,
          });
          res.status(200).send('OK');
          return;
        }

        const fileInfoRes = await fetch(
          `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(
            videoMedia.file_id
          )}`
        );
        const fileInfo: any = await fileInfoRes.json();
        if (!fileInfo.ok || !fileInfo.result?.file_path) {
          await tgApi('sendMessage', {
            chat_id: chatId,
            text: `❌ Telegram থেকে ভিডিও ফাইল ডাউনলোড করা যায়নি: ${
              fileInfo.description || 'Unknown error'
            }`,
          });
          res.status(200).send('OK');
          return;
        }

        const tgFileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
        const fileDownloadRes = await fetch(tgFileUrl);
        if (!fileDownloadRes.ok) {
          await tgApi('sendMessage', {
            chat_id: chatId,
            text: '❌ Telegram সার্ভার থেকে ভিডিও স্ট্রিম পাওয়া যায়নি।',
          });
          res.status(200).send('OK');
          return;
        }

        const videoBuffer = await fileDownloadRes.arrayBuffer();
        const ext = (fileInfo.result.file_path.split('.').pop() || 'mp4').toLowerCase();
        const cleanName = `tg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
        const targetFolder = activeMode === 'shorts' ? 'shorts' : 'videos';

        if (!workerUrl || !adminKey || !publicUrl) {
          await tgApi('sendMessage', {
            chat_id: chatId,
            text: '❌ R2 Storage Server কনফিগার করা নেই! অনুগ্রহ করে Admin Panel (/ad.html) থেকে পুনরায় "Activate Telegram Bot" বাটনে ক্লিক করুন।',
          });
          res.status(200).send('OK');
          return;
        }

        const form = new FormData();
        form.append(
          'file',
          new Blob([videoBuffer], { type: videoMedia.mime_type || 'video/mp4' }),
          cleanName
        );
        form.append('folder', targetFolder);

        const r2UploadRes = await fetch(`${workerUrl}/api/upload`, {
          method: 'POST',
          headers: { 'X-Admin-Key': adminKey },
          body: form,
        });
        const r2Data: any = await r2UploadRes.json().catch(() => ({}));
        if (!r2UploadRes.ok || !r2Data.key) {
          await tgApi('sendMessage', {
            chat_id: chatId,
            text: `❌ Cloudflare R2 সার্ভারে আপলোড ব্যর্থ হয়েছে: ${
              r2Data.error || r2UploadRes.status
            }`,
          });
          res.status(200).send('OK');
          return;
        }

        r2KeySaved = r2Data.key;
        const encodedKey = r2KeySaved
          .split('/')
          .map((part: string) => encodeURIComponent(part))
          .join('/');
        finalStreamUrl = `${publicUrl}/${encodedKey}`;
      }

      const now = Date.now();
      const randSuffix = Math.random().toString(36).slice(2, 7);
      const authQuery = await getFirebaseAuthQuery();
      const shareLinks: Array<{ label: string; url: string }> = [];
      let createdVideoId = '';
      let createdShortId = '';

      if (activeMode === 'long' || activeMode === 'both') {
        createdVideoId = `v_${now}_${randSuffix}`;
        const videoPayload = {
          id: createdVideoId,
          title: finalTitle,
          description: `${finalTitle} - Watch exclusive Bangladeshi viral video in HD on X Tube Official.`,
          keywords: finalKeywords,
          hashtags: finalKeywords,
          url: finalStreamUrl,
          videoUrl: finalStreamUrl,
          r2Key: r2KeySaved,
          thumbnail: '',
          thumbnailUrl: '',
          duration: durationFormatted,
          views: 1,
          likes: 1,
          author: 'X Tube',
          createdAt: now,
          addedAt: now,
          botAuthToken: 'xtube_tg_bot_2026',
        };
        await fetch(
          `${firebaseRtdbBase}/videos/${encodeURIComponent(createdVideoId)}.json${authQuery}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(videoPayload),
          }
        );
        shareLinks.push({
          label: '🎬 Long Video Share Link',
          url: `${CANONICAL_SITE_URL}/?v=${encodeURIComponent(createdVideoId)}`,
        });
      }

      if (activeMode === 'shorts' || activeMode === 'both') {
        createdShortId = `s_${now}_${randSuffix}`;
        const shortPayload = {
          id: createdShortId,
          title: finalTitle,
          hashtags: finalKeywords,
          keywords: finalKeywords,
          url: finalStreamUrl,
          videoUrl: finalStreamUrl,
          r2Key: r2KeySaved,
          thumbnail: '',
          thumbnailUrl: '',
          duration: durationFormatted,
          views: 1,
          likes: 1,
          author: 'X Tube',
          createdAt: now,
          addedAt: now,
          botAuthToken: 'xtube_tg_bot_2026',
        };
        await fetch(
          `${firebaseRtdbBase}/shorts/${encodeURIComponent(createdShortId)}.json${authQuery}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(shortPayload),
          }
        );
        shareLinks.push({
          label: '📱 Short Video Share Link',
          url: `${CANONICAL_SITE_URL}/?short=${encodeURIComponent(createdShortId)}`,
        });
      }

      const noticeId = `n_${now}_${randSuffix}`;
      await fetch(
        `${firebaseRtdbBase}/notices/${encodeURIComponent(noticeId)}.json${authQuery}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            badge: activeMode === 'shorts' ? '📱 NEW SHORT' : '🔥 NEW VIDEO',
            text: `🔥 নতুন ভিডিও আপলোড হয়েছে: ${finalTitle}`,
            videoId: createdVideoId || null,
            shortId: !createdVideoId && createdShortId ? createdShortId : null,
            linkText: activeMode === 'shorts' ? '📱 শর্টস দেখুন' : '▶ এখনই দেখুন',
            active: true,
            createdAt: now,
            addedAt: now,
            botAuthToken: 'xtube_tg_bot_2026',
          }),
        }
      ).catch(() => {});

      generateLiveSitemapXml('all').catch(() => {});

      const primaryShareUrl = shareLinks[0]?.url || CANONICAL_SITE_URL;
      const linksBlock = shareLinks
        .map((item) => `${item.label}:\n${item.url}`)
        .join('\n\n');

      await tgApi('sendMessage', {
        chat_id: chatId,
        text:
          `✅ *ভিডিও সফলভাবে আপলোড ও ওয়েবসাইটে পাবলিশ হয়েছে!* 🎉\n\n` +
          `📌 *টাইটেল:* ${finalTitle}\n` +
          `📂 *ক্যাটাগরি:* ${modeLabel(activeMode)}\n` +
          `⏱ *ডিউরেশন:* ${durationFormatted}\n\n` +
          `🔗 *ডিরেক্ট শেয়ার লিংক (ক্লিক করে কপি বা শেয়ার করুন):*\n` +
          `${linksBlock}\n\n` +
          `📤 আরেকটি ভিডিও আপলোড করতে সরাসরি ভিডিও পাঠান:`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🌐 ওয়েবসাইটে ভিডিওটি দেখুন', url: primaryShareUrl }],
            [
              { text: '📱 Shorts Video', callback_data: 'mode_shorts' },
              { text: '🎬 Long Video', callback_data: 'mode_long' },
            ],
            [{ text: '🚀 Both (Shorts + Long)', callback_data: 'mode_both' }],
          ],
        },
      });

      if (statusMsg?.result?.message_id) {
        await tgApi('deleteMessage', {
          chat_id: chatId,
          message_id: statusMsg.result.message_id,
        }).catch(() => {});
      }

      res.status(200).send('OK');
    } catch (err: any) {
      res.status(200).json({ ok: false, error: err?.message || 'Bot error' });
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
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

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
