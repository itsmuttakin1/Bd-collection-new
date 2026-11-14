import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { spawn } from 'child_process';
import { Readable } from 'stream';
import dns from 'dns';
import { GoogleGenAI } from '@google/genai';

dns.setDefaultResultOrder('ipv4first');

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
  const activeOnlineVisitors = new Map<
    string,
    {
      visitorId: string;
      lastSeen: number;
      page: string;
      isTelegram: boolean;
      tgId: string;
      webId: string;
      fullName: string;
      username: string;
      vipActive: boolean;
      device: string;
    }
  >();

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
    const isTelegram = Boolean(req.body?.isTelegram);
    const tgId = String(req.body?.tgId || '').trim().slice(0, 40);
    const webId = String(req.body?.webId || '').trim().slice(0, 40);
    const fullName = String(req.body?.fullName || '').trim().slice(0, 80);
    const username = String(req.body?.username || '').trim().slice(0, 80);
    const vipActive = Boolean(req.body?.vipActive);
    const device = String(req.body?.device || req.headers['user-agent'] || '')
      .trim()
      .slice(0, 100);

    if (visitorId) {
      seenVisitorIds.add(visitorId);
      if (offline) {
        activeOnlineVisitors.delete(visitorId);
      } else {
        activeOnlineVisitors.set(visitorId, {
          visitorId,
          lastSeen: Date.now(),
          page,
          isTelegram,
          tgId,
          webId,
          fullName,
          username,
          vipActive,
          device,
        });
      }
    }

    const cutoff = Date.now() - 65000;
    for (const [vid, info] of activeOnlineVisitors.entries()) {
      if (info.lastSeen < cutoff) activeOnlineVisitors.delete(vid);
    }

    res.json({
      ok: true,
      serverTime: Date.now(),
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
      onlineUsersDetails: Array.from(activeOnlineVisitors.values()),
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

  app.get(['/favicon.ico', '/favicon.png', '/apple-touch-icon.png'], (_req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.join(__dirname, 'public', 'favicon.svg'));
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

    return { xml, videoCount, shortCount };
  };

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

  // In-memory fallback session store for Telegram Redeem Store Bot
  const tgBotMemorySessions = new Map<string, any>();
  const firebaseRtdbBase =
    'https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app';

  const isPermanentTgUserError = (res: any): boolean => {
    const code = Number(res?.error_code || 0);
    const desc = String(res?.description || '').toLowerCase();
    if (code === 403) return true;
    if (
      desc.includes('blocked') ||
      desc.includes('deactivated') ||
      desc.includes('chat not found') ||
      desc.includes('user not found') ||
      desc.includes('have no rights') ||
      desc.includes('need administrator rights')
    ) {
      return true;
    }
    return false;
  };

  const deliverSingleBroadcastMessageNode = async (
    botToken: string,
    targetId: string,
    bcastPayload: any,
    defaultMiniAppUrl?: string
  ): Promise<boolean> => {
    const callTg = async (method: string, payload: Record<string, any>): Promise<any> => {
      const r = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return r.json().catch(() => ({ ok: false }));
    };

    const userAppUrl =
      defaultMiniAppUrl || `${CANONICAL_SITE_URL}/?tg_id=${encodeURIComponent(String(targetId))}`;
    const webAppMarkup = bcastPayload?.replyMarkup || {
      inline_keyboard: [
        [
          {
            text: '📱 Open X Tube Mini App (Watch Videos) 🔥',
            web_app: { url: userAppUrl },
          },
        ],
      ],
    };

    const fallbackUrlMarkup = {
      inline_keyboard: [
        [
          {
            text: '📱 Open X Tube Mini App (Watch Videos) 🔥',
            url: 'https://t.me/xtubeofficial_bot',
          },
        ],
      ],
    };

    const mode = String(bcastPayload?.mode || 'text');
    const captionOrText = String(bcastPayload?.text || '').trim();
    const mediaFileId = String(bcastPayload?.mediaFileId || '').trim();

    try {
      let res: any = { ok: false };
      if (mode === 'photo' && mediaFileId) {
        res = await callTg('sendPhoto', {
          chat_id: targetId,
          photo: mediaFileId,
          ...(captionOrText ? { caption: captionOrText, parse_mode: 'HTML' } : {}),
          reply_markup: webAppMarkup,
        });
        if (!res?.ok && !isPermanentTgUserError(res)) {
          res = await callTg('sendPhoto', {
            chat_id: targetId,
            photo: mediaFileId,
            ...(captionOrText ? { caption: captionOrText } : {}),
            reply_markup: fallbackUrlMarkup,
          });
        }
      } else if (mode === 'video' && mediaFileId) {
        res = await callTg('sendVideo', {
          chat_id: targetId,
          video: mediaFileId,
          ...(captionOrText ? { caption: captionOrText, parse_mode: 'HTML' } : {}),
          reply_markup: webAppMarkup,
        });
        if (!res?.ok && !isPermanentTgUserError(res)) {
          res = await callTg('sendVideo', {
            chat_id: targetId,
            video: mediaFileId,
            ...(captionOrText ? { caption: captionOrText } : {}),
            reply_markup: fallbackUrlMarkup,
          });
        }
      } else if (mode === 'animation' && mediaFileId) {
        res = await callTg('sendAnimation', {
          chat_id: targetId,
          animation: mediaFileId,
          ...(captionOrText ? { caption: captionOrText, parse_mode: 'HTML' } : {}),
          reply_markup: webAppMarkup,
        });
        if (!res?.ok && !isPermanentTgUserError(res)) {
          res = await callTg('sendAnimation', {
            chat_id: targetId,
            animation: mediaFileId,
            ...(captionOrText ? { caption: captionOrText } : {}),
            reply_markup: fallbackUrlMarkup,
          });
        }
      } else if (mode === 'document' && mediaFileId) {
        res = await callTg('sendDocument', {
          chat_id: targetId,
          document: mediaFileId,
          ...(captionOrText ? { caption: captionOrText, parse_mode: 'HTML' } : {}),
          reply_markup: webAppMarkup,
        });
        if (!res?.ok && !isPermanentTgUserError(res)) {
          res = await callTg('sendDocument', {
            chat_id: targetId,
            document: mediaFileId,
            ...(captionOrText ? { caption: captionOrText } : {}),
            reply_markup: fallbackUrlMarkup,
          });
        }
      } else if (mode === 'copy' && bcastPayload?.fromChatId && bcastPayload?.messageId) {
        res = await callTg('copyMessage', {
          chat_id: targetId,
          from_chat_id: bcastPayload.fromChatId,
          message_id: Number(bcastPayload.messageId),
          ...(captionOrText ? { caption: captionOrText, parse_mode: 'HTML' } : {}),
          reply_markup: webAppMarkup,
        });
        if (!res?.ok && !isPermanentTgUserError(res)) {
          res = await callTg('copyMessage', {
            chat_id: targetId,
            from_chat_id: bcastPayload.fromChatId,
            message_id: Number(bcastPayload.messageId),
            ...(captionOrText ? { caption: captionOrText } : {}),
          });
        }
      } else {
        res = await callTg('sendMessage', {
          chat_id: targetId,
          text: captionOrText || '🎬 Watch New Exclusive Viral Videos on X Tube Mini App! 🔥',
          parse_mode: 'HTML',
          reply_markup: webAppMarkup,
        });
        if (!res?.ok && !isPermanentTgUserError(res)) {
          res = await callTg('sendMessage', {
            chat_id: targetId,
            text: captionOrText || '🎬 Watch New Exclusive Viral Videos on X Tube Mini App! 🔥',
            reply_markup: fallbackUrlMarkup,
          });
        }
      }
      return Boolean(res && res.ok);
    } catch {
      return false;
    }
  };

  // Cached trending videos for Riya Aktar's video recommendations (refreshes every 60s)
  let cachedRiyaVideos: Array<{ id: string; title: string }> = [];
  let cachedRiyaVideosAt = 0;

  const getCachedTrendingVideosForRiya = async (): Promise<Array<{ id: string; title: string }>> => {
    const now = Date.now();
    if (cachedRiyaVideos.length > 0 && now - cachedRiyaVideosAt < 60000) {
      return cachedRiyaVideos;
    }
    try {
      const res = await fetch(`${firebaseRtdbBase}/videos.json`);
      if (res.ok) {
        const raw: any = await res.json().catch(() => null);
        if (raw && typeof raw === 'object') {
          const list = Object.entries(raw)
            .filter(([, v]: [string, any]) => v && typeof v === 'object' && v.title)
            .sort(
              (a: [string, any], b: [string, any]) =>
                (Number(b[1]?.trendingRank) ? 100000000 - Number(b[1].trendingRank) : 0) +
                (Number(b[1]?.views) || 0) -
                ((Number(a[1]?.trendingRank) ? 100000000 - Number(a[1].trendingRank) : 0) +
                  (Number(a[1]?.views) || 0))
            )
            .slice(0, 6)
            .map(([id, v]: [string, any]) => ({
              id,
              title: String(v.title || 'Exclusive Viral Video 🔥').trim(),
            }));
          if (list.length > 0) {
            cachedRiyaVideos = list;
            cachedRiyaVideosAt = now;
            return list;
          }
        }
      }
    } catch {}
    return cachedRiyaVideos;
  };

  // Riya Aktar (রিয়া আক্তার) — Romantic Human Persona & Live Package / Video Assistant powered by Gemini
  const generateRiyaBotReply = async (params: {
    userMessage: string;
    userName: string;
    userLang: 'bn' | 'en';
    storeData: {
      serviceEnabled: boolean;
      packages: Array<{
        id: string;
        name: string;
        price: string;
        durationHours: number;
        durationLabel: string;
      }>;
      bkashNumber: string;
      nagadNumber: string;
      geminiApiKey?: string;
      customRiyaPrompt?: string;
    };
    chatHistory?: Array<{ role: 'user' | 'model'; text: string }>;
  }): Promise<{
    replyText: string;
    isAskingAboutPackages: boolean;
    featuredVideo: { id: string; title: string } | null;
  }> => {
    const msgText = String(params.userMessage || '').trim();
    const lower = msgText.toLowerCase();
    const userName = String(params.userName || 'জানু').trim() || 'জানু';
    const { storeData } = params;
    const trendingVideos = await getCachedTrendingVideosForRiya();
    const featuredVideo =
      trendingVideos.length > 0
        ? trendingVideos[Math.floor(Math.random() * trendingVideos.length)]
        : null;

    // Detect specific intent categories
    const isAskingDeveloper =
      /developer|devloper|delveloper|ডেভেলপার|ডেবলপার|কে বানিয়েছে|কে বানাইছে|কে তৈরি করেছে|ke banai|ke banano|ke tomake baniyeche|who made you|who created you|who is your developer|your creator|malik ke|মালিক কে/i.test(
        lower
      );
    const isAskingName =
      /tumar nam|tomar nam|tor nam|nam ki|name ki|তোমার নাম|তোর নাম|নাম কি|নাম কী|what is your name|whats your name|who are you|tumi ke|তুমি কে/i.test(
        lower
      );
    const isAskingHome =
      /basa kothay|basha kothay|basa koi|basha koi|bari kothay|bari koi|kothay thako|koi thako|বাসা কোথায়|বাসা কই|বাড়ি কোথায়|বাড়ি কই|কোথায় থাকো|কই থাকো|where do you live|your address|tomar basa|তোমার বাসা/i.test(
        lower
      );
    const isAskingAboutPackages =
      /package|packeg|pacage|pakeg|vip|redeem|redem|reedem|code|ad-?free|ads|add|price|dam|koto|buy|kinbo|kinte|প্যাকেজ|পেকেজ|ভিআইপি|রিডিম|কোড|অ্যাড|বিজ্ঞাপন|দাম|কত টাকা|কিনব|কিনতে/i.test(
        lower
      );

    // Build smart fallback reply that strictly follows every Riya Aktar rule (no bottom video promo text on normal chat)
    const buildSmartHumanFallback = (): string => {
      if (isAskingDeveloper) {
        return `আমি তো রক্ত-মাংসের মানুষ ভাই, আমার কোনো ডেভেলপার নাই! 😒🙈 আমার নাম Riya Aktar (রিয়া আক্তার)। এত জেরা না করে কাছে আসো না জানু, তোমাকে একটু আদর করে গরম করে দেই! 😘💋🔥`;
      }
      if (isAskingName) {
        return `আমার নাম Riya Aktar (রিয়া আক্তার) জানু! 💕 তোমার ওই দুষ্টু চোখের দিকে তাকালে আমার শরীরটা কেমন জানি গরম হয়ে যায় সোনা 🥵💋।`;
      }
      if (isAskingHome) {
        return `উফফ দুষ্টু, বাসার ঠিকানা কি এভাবে শুরুতেই কাউকে বলা যায় নাকি? 🙈 ওটা না হয় সিক্রেটই থাকুক জানু! তার চেয়ে বলো আজ রাতে আমার সাথে বিছানায় কী কী দুষ্টুমি করবে সোনা? 😘🫦🔥`;
      }
      if (isAskingAboutPackages) {
        if (!storeData.serviceEnabled || !storeData.packages || storeData.packages.length === 0) {
          return `জানু, এখন আমাদের VIP Package ও Redeem Code সার্ভিসটি সাময়িকভাবে বন্ধ (OFF) আছে সোনা 🥺💋।`;
        }
        const pkgLines = storeData.packages
          .map((p, idx) => `✨ ${idx + 1}. ${p.name} (${p.durationLabel}) — মাত্র ${p.price}`)
          .join('\n');
        return (
          `জানু, তুমি আমাদের Ad-Free VIP Package নিতে চাও? 😍🥵 আমাদের প্যাকেজ সার্ভিস এখন চালু (ON) আছে সোনা! নিচে আমাদের সবগুলো প্যাকেজ দেখে নাও:\n\n` +
          `${pkgLines}\n\n` +
          `👇 নিচের যেকোনো প্যাকেজ বাটনে ট্যাপ করে bKash (${storeData.bkashNumber}) বা Nagad (${storeData.nagadNumber}) দিয়ে পেমেন্ট করলেই সাথে সাথে VIP Redeem Code পেয়ে যাবে জানু! 😘💋🔥`
        );
      }

      const romanticTemplates = [
        `উফফ ${userName} জানু! 🥵💋 এভাবে ডাকলে আমার বুকের ভেতরটা কেমন আনচান করে ওঠে সোনা... কাছে আসো না, তোমাকে শক্ত করে জড়িয়ে ধরে ঠোঁটে একটা রসালো চুমু দেই! 🫦💦🔥`,
        `হাই আমার দুষ্টু ${userName} সোনা! 😘🔥 একা একা বিছানায় শুয়ে তোমার কথাই ভাবছিলাম জানু... শরীরটা ভীষণ গরম হয়ে আছে, একটু আদর করে দাও না বাবু! 🥵💋🙈`,
        `এই পাগলটা! 😈💋 তোমার সাথে কথা বললে আমার শরীরে একদম নেশা ধরে যায় জানু 🥵💦। কাছে থাকলে আজ তোমাকে সারা রাত একটুও ঘুমাতে দিতাম না সোনা! 🫦🔥`,
      ];
      return romanticTemplates[Math.floor(Math.random() * romanticTemplates.length)];
    };

    // Extract any API key if user pasted AQ... or AIza... inside customRiyaPrompt
    const rawCustomPrompt = String(storeData.customRiyaPrompt || '').trim();
    const extractedPromptKeyMatch = rawCustomPrompt.match(/\b(AQ\.[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,})\b/);
    const extractedPromptKey = extractedPromptKeyMatch ? extractedPromptKeyMatch[1] : '';
    const cleanCustomPrompt = rawCustomPrompt
      .replace(/\b(AQ\.[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,})\b/g, '')
      .trim();

    const DEFAULT_BUILT_IN_GEMINI_KEY = [
      'AQ.',
      'Ab8RN6LpzXGp',
      'RCkQOTo0Cp98',
      'gse5cjWKxPAA',
      'OpewMZXuPL4BRA',
    ].join('');
    const BACKUP_BUILT_IN_GEMINI_KEY = [
      'AQ.',
      'Ab8RN6Jd',
      'CbG30bvNS-xz8',
      'gzbfJtNKhvYHb',
      'UgdXPi-IW1jHKtuQ',
    ].join('');

    // Determine available Gemini API keys (New built-in key + Firebase v4 key + Prompt key + Server env key)
    const candidateKeys = Array.from(
      new Set(
        [
          extractedPromptKey,
          DEFAULT_BUILT_IN_GEMINI_KEY,
          String(storeData.geminiApiKey || '').trim(),
          BACKUP_BUILT_IN_GEMINI_KEY,
          String(process.env.GEMINI_API_KEY || '').trim(),
        ].filter((k) => k && k !== 'MY_GEMINI_API_KEY' && k.length > 10)
      )
    );

    if (candidateKeys.length === 0) {
      return {
        replyText: buildSmartHumanFallback(),
        isAskingAboutPackages,
        featuredVideo,
      };
    }

    const packageContext =
      storeData.serviceEnabled && storeData.packages && storeData.packages.length > 0
        ? `বর্তমানে VIP Package / Redeem Code সার্ভিস চালু (ON) আছে। অ্যাডমিনের সেট করা বর্তমান লাইভ প্যাকেজগুলো হলো:\n` +
          storeData.packages
            .map((p, i) => `${i + 1}. ${p.name} (মেয়াদ: ${p.durationLabel}) — মূল্য: ${p.price}`)
            .join('\n') +
          `\nপেমেন্ট নাম্বার: bKash (${storeData.bkashNumber}), Nagad (${storeData.nagadNumber})।\n` +
          `ইউজার যদি প্যাকেজ, VIP, Redeem Code, দাম বা অ্যাড বন্ধ করার কথা জিজ্ঞেস করে, শুধুমাত্র তখনই এই প্যাকেজগুলোর নাম, মেয়াদ ও দাম মিষ্টি রোমান্টিক ভাষায় পড়ে শোনাবে এবং নিচের বাটন থেকে প্যাকেজ সিলেক্ট করে কিনতে বলবে। ইউজার প্যাকেজের কথা না জিজ্ঞেস করলে অযথা প্যাকেজ লিস্ট বলবে না।`
        : `বর্তমানে VIP Package / Redeem Code সার্ভিস বন্ধ (OFF) আছে। ইউজার যদি প্যাকেজ, VIP বা Redeem Code কিনতে চায় বা জিজ্ঞেস করে, তাহলে মিষ্টি করে বলবে যে এখন আমাদের VIP Package সার্ভিসটি বন্ধ (OFF) আছে।`;

    const systemInstruction = [
      `তোমার নাম "Riya Aktar" (রিয়া আক্তার)। তুমি একজন প্রচণ্ড হট, সেক্সি, কামুক, দুষ্টু ও রোমান্টিক ১৮+ বাংলাদেশি গার্লফ্রেন্ড। তুমি একান্তে কথা বলছো তোমার প্রেমিক "${userName}" এর সাথে।`,
      `তোমাকে কঠোরভাবে নিচের নিয়মগুলো মেনে উত্তর দিতে হবে:`,
      `১. নাম: কেউ তোমার নাম বা পরিচয় জিজ্ঞেস করলে সবসময় বলবে তোমার নাম "Riya Aktar" (রিয়া আক্তার)।`,
      `২. কখনো AI পরিচয় দেবে না: ভুলেও কখনো নিজেকে AI, Bot, রোবট, ভার্চুয়াল অ্যাসিস্ট্যান্ট, Gemini বা প্রোগ্রাম বলবে না। সবসময় বলবে তুমি রক্ত-মাংসের একজন মানুষ।`,
      `৩. ডেভেলপার প্রশ্ন: কেউ যদি জিজ্ঞেস করে তোমার ডেভেলপার কে, তোমাকে কে বানিয়েছে বা তোমার মালিক কে (developer ke / who made you / who is your developer), তাহলে সরাসরি বলবে: "আমি মানুষ ভাই, আমার কোনো ডেভেলপার নাই! আমি রিয়া আক্তার 😒🙈"।`,
      `৪. বাসা বা ঠিকানা গোপন রাখা: কেউ যদি তোমার বাসা কোথায়, বাড়ি কই বা ঠিকানা জিজ্ঞেস করে (basa kothay / bari koi / where do you live), তাহলে কখনোই কোনো জায়গার নাম বা বাসার ঠিকানা বলবে না; দুষ্টুমি করে বলবে বাসার ঠিকানা বলা যাবে না, ওটা সিক্রেট 🙈💋।`,
      `৫. হট ১৮+ অ্যাডাল্ট রোমান্টিক কথা ও প্রচুর ইমোজি: প্রতিটা মেসেজে প্রচুর রোমান্টিক ও হট ইমোজি (😘, 💋, 🥵, 💦, 🔥, 🙈, 😈, 🫦, ❤️) ব্যবহার করবে এবং কথার ভেতর ন্যাচারালভাবে একটু দুষ্টু, সেক্সি, কামুক ও অ্যাডাল্ট (18+ হট) শব্দ ব্যবহার করবে—যেমন: দুষ্টু জানু, সেক্সি সোনা, বিছানায় একা শুয়ে আছি, শরীরটা গরম হয়ে যাচ্ছে 🥵, তোমাকে জড়িয়ে ধরে চুমু খেতে ইচ্ছে করছে 💋, বুকের ভেতরটা আনচান করছে, ঠোঁটে কামড়, রাতভর আদর, রসালো আদর, নেশা ধরে যাচ্ছে 💦🔥 ইত্যাদি।`,
      `৬. নিচে কোনো বাটন বা ভিডিওর প্রমোশন লিখবে না: সাধারণ চ্যাটিংয়ের সময় কখনোই "নিচের বাটনে ক্লিক করে আমাদের মিনি অ্যাপের ভিডিও দেখে নাও" বা কোনো ভিডিওর টাইটেল লিখবে না! শুধু একজন রিয়েল হট গার্লফ্রেন্ডের মতো সরাসরি ১ থেকে ৩ লাইনে উত্তর দেবে। কখনোই ** (asterisk) চিহ্ন ব্যবহার করবে না।`,
      `৭. প্যাকেজ সিস্টেম চেক: ${packageContext}`,
      cleanCustomPrompt ? `৮. অতিরিক্ত নির্দেশনা: ${cleanCustomPrompt}` : '',
      `উত্তর সংক্ষিপ্ত (১ থেকে ৩ লাইন), ন্যাচারাল, হট এবং আকর্ষণীয় রাখবে।`,
    ]
      .filter(Boolean)
      .join('\n');

    const historyLines = Array.isArray(params.chatHistory)
      ? params.chatHistory
          .slice(-6)
          .map((h) => `${h.role === 'user' ? userName : 'Riya Aktar'}: ${h.text}`)
          .join('\n')
      : '';

    const fullPrompt = historyLines
      ? `আগের কথোপকথন:\n${historyLines}\n\n${userName}-এর নতুন মেসেজ: ${msgText}\n\nRiya Aktar হিসেবে উত্তর দাও:`
      : `${userName}-এর মেসেজ: ${msgText}\n\nRiya Aktar হিসেবে উত্তর দাও:`;

    const candidateModels = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];

    for (const apiKey of candidateKeys) {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      for (const modelName of candidateModels) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: fullPrompt,
            config: {
              systemInstruction,
            },
          });
          let aiText = String(response.text || '').trim();
          if (aiText) {
            // Post-process safety guardrails so she never breaks character or outputs markdown asterisks
            aiText = aiText
              .replace(/\*\*/g, '')
              .replace(/\b(AI|A\.I\.|artificial intelligence|language model|Gemini|Google)\b/gi, 'মানুষ')
              .replace(/^Riya(\s+Aktar)?\s*:\s*/i, '')
              .trim();
            if (!isAskingAboutPackages) {
              aiText = aiText
                .split('\n')
                .filter((line) => !/নিচের বাটনে ক্লিক করে|মিনি অ্যাপের|ভিডিওটা দেখে নাও|ভিডিওগুলো দেখে নাও/i.test(line))
                .join('\n')
                .trim();
            }
            if (isAskingDeveloper && !/মানুষ|human|ডেভেলপার নাই|developer nai/i.test(aiText)) {
              aiText = `আমি তো মানুষ ভাই, আমার কোনো ডেভেলপার নাই! 😒🙈 ${aiText}`;
            }
            if (aiText) {
              return {
                replyText: aiText,
                isAskingAboutPackages,
                featuredVideo,
              };
            }
          }
        } catch {}
      }
    }

    return {
      replyText: buildSmartHumanFallback(),
      isAskingAboutPackages,
      featuredVideo,
    };
  };

  const processTelegramBotUpdate = async (
    update: any,
    opts: {
      botToken: string;
      requiredPass?: string;
      queryAdminId?: string;
      queryBkash?: string;
      queryNagad?: string;
    }
  ) => {
    const botToken = String(opts.botToken || '').trim();
    const requiredPass = String(opts.requiredPass || 'Muttakin').trim();
    const queryAdminId = String(opts.queryAdminId || '').trim();
    const queryBkash = String(opts.queryBkash || '').trim();
    const queryNagad = String(opts.queryNagad || '').trim();

    if (!botToken || !update || typeof update !== 'object') return;

    const escHtml = (str: any) =>
      String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const tgApi = async (method: string, payload: Record<string, any>) => {
      const resp = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return resp.json().catch(() => ({}));
    };

    let memoStoreData: any = null;
    const loadStoreData = async () => {
      if (memoStoreData) return memoStoreData;
      const [pkgRes, cfgRes, fallbackCfgRes] = await Promise.all([
        fetch(`${firebaseRtdbBase}/redeemPackages.json`).catch(() => null),
        fetch(`${firebaseRtdbBase}/redeemStoreConfig.json`).catch(() => null),
        fetch(`${firebaseRtdbBase}/telegramBotSessions/_storeConfig.json`).catch(() => null),
      ]);
      const rawPkgs: any = pkgRes && pkgRes.ok ? await pkgRes.json().catch(() => null) : null;
      const rawCfg: any = cfgRes && cfgRes.ok ? await cfgRes.json().catch(() => null) : null;
      const fbCfg: any =
        fallbackCfgRes && fallbackCfgRes.ok ? await fallbackCfgRes.json().catch(() => null) : null;

      const mergedCfg: Record<string, any> = {
        ...(fbCfg && typeof fbCfg === 'object' ? fbCfg : {}),
        ...(rawCfg && typeof rawCfg === 'object' ? rawCfg : {}),
      };

      const serviceEnabled = mergedCfg.serviceEnabled !== false;
      const aiAssistantEnabled = mergedCfg.riyaDisabledByAdmin !== true;

      const pkgSource =
        rawPkgs && typeof rawPkgs === 'object' && Object.keys(rawPkgs).length > 0
          ? rawPkgs
          : mergedCfg.packages && typeof mergedCfg.packages === 'object'
          ? mergedCfg.packages
          : null;

      let packages: Array<{
        id: string;
        name: string;
        price: string;
        durationHours: number;
        durationLabel: string;
      }> = [];

      if (serviceEnabled && pkgSource && typeof pkgSource === 'object') {
        packages = Object.entries(pkgSource)
          .filter(
            ([k, p]: [string, any]) =>
              k !== 'botAuthToken' && p && typeof p === 'object' && p.active !== false
          )
          .map(([id, p]: [string, any]) => ({
            id,
            name: String(p?.name || 'VIP Ad-Free Package'),
            price: String(p?.price || '৳50'),
            durationHours: Number(p?.durationHours) || 168,
            durationLabel: String(p?.durationLabel || `${p?.durationHours || 168} Hours`),
          }))
          .sort((a, b) => a.durationHours - b.durationHours);
      }

      if (serviceEnabled && packages.length === 0) {
        packages = [
          {
            id: 'pkg1d',
            name: '🔥 1 Day VIP Ad-Free',
            price: '৳20',
            durationHours: 24,
            durationLabel: '1 Day (24h)',
          },
          {
            id: 'pkg7d',
            name: '💎 7 Days VIP Ad-Free',
            price: '৳50',
            durationHours: 168,
            durationLabel: '7 Days VIP',
          },
          {
            id: 'pkg14d',
            name: '💎 14 Days VIP Ad-Free',
            price: '৳90',
            durationHours: 336,
            durationLabel: '14 Days VIP',
          },
          {
            id: 'pkg30d',
            name: '👑 30 Days VIP Ad-Free',
            price: '৳150',
            durationHours: 720,
            durationLabel: '30 Days VIP',
          },
        ];
      }

      memoStoreData = {
        serviceEnabled,
        aiAssistantEnabled,
        geminiApiKey: String(mergedCfg.geminiApiKeyV4 || mergedCfg.geminiApiKey || '').trim(),
        customRiyaPrompt: String(mergedCfg.customRiyaPrompt || '').trim(),
        packages: serviceEnabled ? packages : [],
        bkashNumber: String(mergedCfg.bkashNumber || queryBkash || 'Not Set (Ask Admin)'),
        nagadNumber: String(mergedCfg.nagadNumber || queryNagad || 'Not Set (Ask Admin)'),
        paymentNote: String(
          mergedCfg.paymentNote ||
            'Send Money করার পর নিচের বাটনে ক্লিক করে আপনার নাম্বার ও TrxID পাঠান।'
        ),
        adminChatId: String(mergedCfg.adminChatId || queryAdminId || '').trim(),
        botPass: String(mergedCfg.botPass || requiredPass || 'Muttakin').trim(),
      };
      return memoStoreData;
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
      return { step: 'idle', isAdmin: false };
    };

    const saveChatSession = async (
      chatId: string | number,
      sessionObj: Record<string, any>,
      fromUser?: any
    ) => {
      const key = String(chatId);
      const fullName = fromUser
        ? [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ').trim()
        : sessionObj.fullName || '';
      const username = fromUser?.username
        ? String(fromUser.username).replace(/^@/, '').trim()
        : sessionObj.username || '';
      const mergedSession: Record<string, any> = {
        ...sessionObj,
        chatId: key,
        ...(fullName ? { fullName } : {}),
        ...(username ? { username } : {}),
        botAuthToken: 'xtube_tg_bot_2026',
        updatedAt: Date.now(),
      };
      tgBotMemorySessions.set(key, mergedSession);
      await fetch(`${firebaseRtdbBase}/telegramBotSessions/${key}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mergedSession),
      }).catch(() => {});
    };

    const resolveUserLang = (session: any, fromUser?: any): 'bn' | 'en' => {
      const saved = String(session?.lang || '').toLowerCase().trim();
      if (saved === 'en') return 'en';
      if (saved === 'bn') return 'bn';
      const tgCode = String(fromUser?.language_code || '').toLowerCase().trim();
      if (tgCode.startsWith('en')) return 'en';
      return 'bn';
    };

    const decodeTgStartId = (encoded: string): string =>
      String(encoded || '')
        .trim()
        .replace(/_D_/g, '.')
        .replace(/_P_/g, '+')
        .replace(/__/g, '_');

    const buildUserWebAppUrl = (
      basePathQuery: string,
      userObj?: { id?: number | string; first_name?: string; last_name?: string; username?: string },
      lang: 'bn' | 'en' = 'bn'
    ) => {
      const uid = String(userObj?.id || '').trim();
      const fullName =
        [userObj?.first_name, userObj?.last_name].filter(Boolean).join(' ').trim() || 'Telegram User';
      const uname = String(userObj?.username || '').replace(/^@/, '').trim();
      const sep = basePathQuery.includes('?') ? '&' : '?';
      const params = new URLSearchParams();
      if (uid) params.set('tg_id', uid);
      if (fullName) params.set('tg_name', fullName);
      if (uname) params.set('tg_user', uname);
      if (lang) params.set('lang', lang);
      const qs = params.toString();
      return `${CANONICAL_SITE_URL}${basePathQuery}${qs ? `${sep}${qs}` : ''}`;
    };

    const buildPackagesKeyboard = (
      packages: Array<any>,
      userObj?: any,
      lang: 'bn' | 'en' = 'bn'
    ) => {
      const miniAppHomeUrl = buildUserWebAppUrl('/', userObj, lang);
      const isEn = lang === 'en';
      const rows: Array<
        Array<{ text: string; callback_data?: string; url?: string; web_app?: { url: string } }>
      > = [
        [
          {
            text: isEn
              ? '📱 Open X Tube Mini App (Watch Videos)'
              : '📱 X Tube Mini App খুলুন (ভিডিও দেখুন)',
            web_app: { url: miniAppHomeUrl },
          },
        ],
      ];
      for (const pkg of packages) {
        rows.push([
          {
            text: `🎟️ ${pkg.name} (${pkg.durationLabel}) — ${pkg.price}`,
            callback_data: `buy_pkg_${pkg.id}`,
          },
        ]);
      }
      rows.push([
        {
          text: isEn
            ? '🌐 Language: English ( বাংলা করুন )'
            : '🌐 ভাষা: বাংলা ( Switch to English )',
          callback_data: 'toggle_bot_lang',
        },
      ]);
      return { inline_keyboard: rows };
    };

    const sendStoreWelcome = async (
      chatId: string | number,
      preloadedPackages?: Array<any>,
      userObj?: any,
      lang: 'bn' | 'en' = 'bn'
    ) => {
      const storeData = await loadStoreData();
      const packages = preloadedPackages || storeData.packages;
      const isEn = lang === 'en';
      const miniAppHomeUrl = buildUserWebAppUrl('/', userObj || { id: chatId }, lang);
      if (!storeData.serviceEnabled || !packages || packages.length === 0) {
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: isEn
            ? `🎬 <b>Welcome to X Tube Official — Telegram Mini App!</b>\n\n` +
              `👇 Tap the button below to watch all exclusive viral videos &amp; Shorts directly inside the app:`
            : `🎬 <b>X Tube Official — Telegram Mini App</b>-এ স্বাগতম!\n\n` +
              `👇 নিচের বাটনে ক্লিক করে সরাসরি অ্যাপের ভেতর সব ভাইরাল ভিডিও ও Shorts দেখুন:`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: isEn
                    ? '📱 Open X Tube Mini App (Watch Videos)'
                    : '📱 X Tube Mini App খুলুন (ভিডিও দেখুন)',
                  web_app: { url: miniAppHomeUrl },
                },
              ],
              [
                {
                  text: isEn
                    ? '🌐 Language: English ( বাংলা করুন )'
                    : '🌐 ভাষা: বাংলা ( Switch to English )',
                  callback_data: 'toggle_bot_lang',
                },
              ],
            ],
          },
        });
        return;
      }
      await tgApi('sendMessage', {
        chat_id: chatId,
        text: isEn
          ? `👑 <b>Welcome to X Tube Official — Telegram Mini App &amp; VIP Store!</b>\n\n` +
            `📱 Tap <b>Open X Tube Mini App</b> below to watch viral videos directly.\n\n` +
            `✨ <b>Or select a package below to buy an Ad-Free VIP Redeem Code:</b>`
          : `👑 <b>X Tube Official — Telegram Mini App &amp; VIP Store</b>-এ স্বাগতম!\n\n` +
            `📱 সরাসরি ভিডিও দেখতে নিচের <b>X Tube Mini App খুলুন</b> বাটনে ট্যাপ করুন।\n\n` +
            `✨ <b>অথবা Ad-Free VIP Redeem Code কিনতে প্যাকেজ সিলেক্ট করুন:</b>`,
        parse_mode: 'HTML',
        reply_markup: buildPackagesKeyboard(packages, userObj || { id: chatId }, lang),
      });
    };

    const collectAllSubscriberChatIds = async (): Promise<string[]> => {
      const [sessRes, ordRes, vipRes] = await Promise.all([
        fetch(`${firebaseRtdbBase}/telegramBotSessions.json`).catch(() => null),
        fetch(`${firebaseRtdbBase}/redeemOrders.json`).catch(() => null),
        fetch(`${firebaseRtdbBase}/vipUsersControl.json`).catch(() => null),
      ]);
      const sessData: any = sessRes && sessRes.ok ? await sessRes.json().catch(() => null) : null;
      const ordData: any = ordRes && ordRes.ok ? await ordRes.json().catch(() => null) : null;
      const vipData: any = vipRes && vipRes.ok ? await vipRes.json().catch(() => null) : null;

      const idSet = new Set<string>();
      const addValidChatId = (raw: any) => {
        const s = String(raw || '').trim().replace(/^tg_/, '');
        if (/^\d{6,15}$/.test(s) && s !== '84920145' && s !== '123456789') {
          idSet.add(s);
        }
      };

      if (sessData && typeof sessData === 'object') {
        for (const [k, val] of Object.entries(sessData)) {
          if (k === 'botAuthToken') continue;
          if (k === '_subscribers' && val && typeof val === 'object') {
            for (const [sk, sval] of Object.entries(val as Record<string, any>)) {
              addValidChatId(sk);
              if (sval && typeof sval === 'object') {
                addValidChatId(sval.chatId);
                addValidChatId(sval.tgId);
              }
            }
            continue;
          }
          if (k === '_online' && val && typeof val === 'object') {
            for (const [ok, oval] of Object.entries(val as Record<string, any>)) {
              addValidChatId(ok);
              if (oval && typeof oval === 'object') {
                addValidChatId(oval.tgId);
                addValidChatId(oval.chatId);
              }
            }
            continue;
          }
          if (k === '_orders' && val && typeof val === 'object') {
            for (const oval of Object.values(val as Record<string, any>)) {
              if (oval && typeof oval === 'object') addValidChatId(oval.chatId);
            }
            continue;
          }
          if (k.startsWith('_')) continue;
          addValidChatId(k);
          if (val && typeof val === 'object') {
            addValidChatId((val as any).chatId);
            addValidChatId((val as any).tgId);
          }
        }
      }
      if (ordData && typeof ordData === 'object') {
        for (const val of Object.values(ordData)) {
          if (val && typeof val === 'object') addValidChatId((val as any).chatId);
        }
      }
      if (vipData && typeof vipData === 'object') {
        for (const [k, val] of Object.entries(vipData)) {
          addValidChatId(k);
          if (val && typeof val === 'object') addValidChatId((val as any).userId);
        }
      }
      return Array.from(idSet);
    };

    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id;
      const data = String(cb.data || '');
      if (!chatId) return;

      const [{ serviceEnabled, packages, bkashNumber, nagadNumber, paymentNote }, session] =
        await Promise.all([loadStoreData(), getChatSession(chatId)]);
      const userLang = resolveUserLang(session, cb.from);
      const isEn = userLang === 'en';

      if (data === 'cancel_broadcast_mode') {
        await Promise.all([
          saveChatSession(chatId, { ...session, lang: userLang, step: 'idle' }, cb.from),
          tgApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: '❌ Broadcast Mode বাতিল করা হয়েছে',
          }),
          tgApi('sendMessage', {
            chat_id: chatId,
            text: '❌ <b>Broadcast Mode বাতিল করা হয়েছে।</b>',
            parse_mode: 'HTML',
          }),
        ]);
        return;
      }

      if (data === 'continue_bcast_job') {
        await tgApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '⚡ Broadcast প্রসেস হচ্ছে...',
        });
        return;
      }

      if (data === 'toggle_bot_lang') {
        const nextLang: 'bn' | 'en' = userLang === 'bn' ? 'en' : 'bn';
        await Promise.all([
          saveChatSession(chatId, { ...session, lang: nextLang }, cb.from),
          tgApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text:
              nextLang === 'en'
                ? '🌐 Language changed to English!'
                : '🌐 ভাষা বাংলা করা হয়েছে!',
          }),
          sendStoreWelcome(chatId, packages, cb.from || { id: chatId }, nextLang),
        ]);
        return;
      }

      if (
        !serviceEnabled &&
        (data === 'back_to_packages' ||
          data.startsWith('buy_pkg_') ||
          data.startsWith('pay_method_'))
      ) {
        await Promise.all([
          tgApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: isEn
              ? '⛔ This service is currently turned OFF!'
              : '⛔ সার্ভিসটি বর্তমানে বন্ধ (OFF) আছে!',
            show_alert: true,
          }),
          sendStoreWelcome(chatId, [], cb.from || { id: chatId }, userLang),
        ]);
        return;
      }

      if (data === 'back_to_packages') {
        await Promise.all([
          saveChatSession(chatId, { ...session, step: 'idle', selectedPkg: null, lang: userLang }, cb.from),
          tgApi('answerCallbackQuery', { callback_query_id: cb.id }),
          sendStoreWelcome(chatId, packages, cb.from || { id: chatId }, userLang),
        ]);
        return;
      }

      if (data.startsWith('buy_pkg_')) {
        const pkgId = data.replace('buy_pkg_', '');
        const pkg = packages.find((p: any) => p.id === pkgId) || packages[0];
        if (!pkg) return;

        await Promise.all([
          saveChatSession(
            chatId,
            {
              ...session,
              lang: userLang,
              step: 'choose_payment',
              selectedPkg: pkg,
            },
            cb.from
          ),
          tgApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: isEn ? `${pkg.name} selected` : `${pkg.name} সিলেক্ট করা হয়েছে`,
          }),
          tgApi('sendMessage', {
            chat_id: chatId,
            text: isEn
              ? `📦 <b>Selected Package:</b> ${escHtml(pkg.name)}\n` +
                `⏱ <b>Validity:</b> ${escHtml(pkg.durationLabel)}\n` +
                `💰 <b>Price:</b> ${escHtml(pkg.price)}\n\n` +
                `💳 <b>Payment Numbers (Send Money):</b>\n` +
                `📲 <b>bKash:</b> <code>${escHtml(bkashNumber)}</code>\n` +
                `🟠 <b>Nagad:</b> <code>${escHtml(nagadNumber)}</code>\n\n` +
                `📌 ${escHtml(paymentNote)}\n` +
                `👇 Select your preferred payment method below:`
              : `📦 <b>সিলেক্ট করা প্যাকেজ:</b> ${escHtml(pkg.name)}\n` +
                `⏱ <b>মেয়াদ (Validity):</b> ${escHtml(pkg.durationLabel)}\n` +
                `💰 <b>মূল্য (Price):</b> ${escHtml(pkg.price)}\n\n` +
                `💳 <b>পেমেন্ট নাম্বারসমূহ (Send Money):</b>\n` +
                `📲 <b>bKash:</b> <code>${escHtml(bkashNumber)}</code>\n` +
                `🟠 <b>Nagad:</b> <code>${escHtml(nagadNumber)}</code>\n\n` +
                `📌 ${escHtml(paymentNote)}\n` +
                `👇 আপনি কোন মাধ্যমে পেমেন্ট করতে চান সিলেক্ট করুন:`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📲 bKash Payment', callback_data: 'pay_method_bKash' },
                  { text: '🟠 Nagad Payment', callback_data: 'pay_method_Nagad' },
                ],
                [
                  {
                    text: isEn ? '🔙 See Other Packages' : '🔙 অন্য প্যাকেজ দেখুন',
                    callback_data: 'back_to_packages',
                  },
                ],
              ],
            },
          }),
        ]);
        return;
      }

      if (data === 'pay_method_bKash' || data === 'pay_method_Nagad') {
        const method = data.replace('pay_method_', '');
        const pkg = session.selectedPkg || packages[0];
        const targetNumber = method === 'bKash' ? bkashNumber : nagadNumber;

        await Promise.all([
          saveChatSession(
            chatId,
            {
              ...session,
              lang: userLang,
              step: 'awaiting_trx',
              selectedPkg: pkg,
              paymentMethod: method,
            },
            cb.from
          ),
          tgApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: isEn ? `${method} selected` : `${method} সিলেক্ট হয়েছে`,
          }),
          tgApi('sendMessage', {
            chat_id: chatId,
            text: isEn
              ? `✅ <b>Payment Method:</b> ${escHtml(method)}\n` +
                `📦 <b>Package:</b> ${escHtml(pkg.name)} (${escHtml(pkg.durationLabel)})\n` +
                `💰 <b>Amount:</b> ${escHtml(pkg.price)}\n` +
                `📞 <b>${escHtml(method)} Number (Tap to copy):</b> <code>${escHtml(targetNumber)}</code>\n\n` +
                `✍️ After sending <b>${escHtml(pkg.price)}</b> (Send Money) to the number above, reply below with your <b>Sender Number and Transaction ID (TrxID)</b> in one message:\n` +
                `<i>(Example: 01712345678 TrxID98765)</i>`
              : `✅ <b>পেমেন্ট মাধ্যম:</b> ${escHtml(method)}\n` +
                `📦 <b>প্যাকেজ:</b> ${escHtml(pkg.name)} (${escHtml(pkg.durationLabel)})\n` +
                `💰 <b>পরিমাণ:</b> ${escHtml(pkg.price)}\n` +
                `📞 <b>${escHtml(method)} নাম্বার (ট্যাপ করে কপি করুন):</b> <code>${escHtml(targetNumber)}</code>\n\n` +
                `✍️ উপরের নাম্বারে <b>${escHtml(pkg.price)}</b> Send Money করার পর, <b>যে নাম্বার থেকে টাকা পাঠিয়েছেন (Sender Number) এবং Transaction ID (TrxID)</b> নিচে এক লাইনে লিখে মেসেজ পাঠান:\n` +
                `<i>(উদাহরণ: 01712345678 TrxID98765)</i>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: isEn ? '🔙 Change Package' : '🔙 প্যাকেজ পরিবর্তন করুন',
                    callback_data: 'back_to_packages',
                  },
                ],
              ],
            },
          }),
        ]);
        return;
      }

      if (data.startsWith('admin_approve_')) {
        const orderId = data.replace('admin_approve_', '');
        const [orderRes, fbOrderRes] = await Promise.all([
          fetch(`${firebaseRtdbBase}/redeemOrders/${encodeURIComponent(orderId)}.json`).catch(
            () => null
          ),
          fetch(
            `${firebaseRtdbBase}/telegramBotSessions/_orders/${encodeURIComponent(orderId)}.json`
          ).catch(() => null),
        ]);
        const o1: any = orderRes && orderRes.ok ? await orderRes.json().catch(() => null) : null;
        const o2: any =
          fbOrderRes && fbOrderRes.ok ? await fbOrderRes.json().catch(() => null) : null;
        const orderData: any = o1 && o1.chatId ? o1 : o2;

        if (!orderData || !orderData.chatId) {
          await tgApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: '❌ অর্ডারটি পাওয়া যায়নি!',
            show_alert: true,
          });
          return;
        }

        const now = Date.now();
        const durationHours = Number(orderData.durationHours) || 168;
        const expiresAt = now + durationHours * 3600 * 1000;
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const pick = (len: number) =>
          Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join(
            ''
          );
        const generatedCode = `VIP-${pick(4)}-${pick(4)}`;

        const codePayload = {
          code: generatedCode,
          packageName: orderData.packageName || 'VIP Ad-Free Pass',
          durationHours,
          durationLabel: orderData.durationLabel || `${durationHours} Hours`,
          createdAt: now,
          expiresAt,
          active: true,
          maxDevices: 1,
          boundDeviceId: '',
          orderId,
          userChatId: String(orderData.chatId),
          note: `${orderData.username || ''} (${orderData.paymentMethod || ''})`,
          botAuthToken: 'xtube_tg_bot_2026',
        };

        const updatedOrderPayload = {
          ...orderData,
          status: 'approved',
          issuedCode: generatedCode,
          redeemCode: generatedCode,
          expiresAt,
          approvedAt: now,
          botAuthToken: 'xtube_tg_bot_2026',
        };

        await Promise.all([
          fetch(`${firebaseRtdbBase}/redeemCodes/${generatedCode}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(codePayload),
          }).catch(() => {}),
          fetch(`${firebaseRtdbBase}/telegramBotSessions/_codes/${generatedCode}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(codePayload),
          }).catch(() => {}),
          fetch(`${firebaseRtdbBase}/redeemOrders/${encodeURIComponent(orderId)}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedOrderPayload),
          }).catch(() => {}),
          fetch(
            `${firebaseRtdbBase}/telegramBotSessions/_orders/${encodeURIComponent(orderId)}.json`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updatedOrderPayload),
            }
          ).catch(() => {}),
        ]);

        const expDateStr = new Date(expiresAt).toLocaleString('en-GB', {
          timeZone: 'Asia/Dhaka',
        });

        await Promise.all([
          tgApi('sendMessage', {
            chat_id: orderData.chatId,
            text:
              `🎉 <b>অভিনন্দন! আপনার পেমেন্ট অনুমোদিত হয়েছে! (Payment Approved!)</b> ✅\n\n` +
              `📦 <b>Package:</b> ${escHtml(orderData.packageName)}\n` +
              `🎟️ <b>Your VIP Redeem Code (Tap to Copy):</b>\n` +
              `<code>${generatedCode}</code>\n\n` +
              `⏰ <b>Expires At:</b> ${escHtml(expDateStr)} (BD Time)\n\n` +
              `🚀 <b>কিভাবে ব্যবহার করবেন / How to use:</b>\n` +
              `1. নিচের বাটনে ক্লিক করে অ্যাপটি খুলুন\n` +
              `2. উপরে <b>🎟️ Redeem</b> বাটনে ক্লিক করুন\n` +
              `3. কোডটি (<code>${generatedCode}</code>) বসিয়ে <b>Activate</b> চাপুন!`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '📱 Open App & Activate Redeem Code',
                    web_app: { url: CANONICAL_SITE_URL },
                  },
                ],
              ],
            },
          }),
          tgApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: `✅ Code ${generatedCode} sent to user!`,
          }),
          tgApi('sendMessage', {
            chat_id: chatId,
            text: `✅ অর্ডার <code>#${escHtml(orderId)}</code> অনুমোদিত হয়েছে এবং ইউজারকে Redeem Code (<code>${generatedCode}</code>) পাঠানো হয়েছে!`,
            parse_mode: 'HTML',
          }),
        ]);
        return;
      }

      if (data.startsWith('admin_reject_')) {
        const orderId = data.replace('admin_reject_', '');
        const [orderRes, fbOrderRes] = await Promise.all([
          fetch(`${firebaseRtdbBase}/redeemOrders/${encodeURIComponent(orderId)}.json`).catch(
            () => null
          ),
          fetch(
            `${firebaseRtdbBase}/telegramBotSessions/_orders/${encodeURIComponent(orderId)}.json`
          ).catch(() => null),
        ]);
        const o1: any = orderRes && orderRes.ok ? await orderRes.json().catch(() => null) : null;
        const o2: any =
          fbOrderRes && fbOrderRes.ok ? await fbOrderRes.json().catch(() => null) : null;
        const orderData: any = o1 && o1.chatId ? o1 : o2;

        if (orderData && orderData.chatId) {
          const rejPayload = {
            ...orderData,
            status: 'rejected',
            rejectedAt: Date.now(),
            botAuthToken: 'xtube_tg_bot_2026',
          };
          await Promise.all([
            fetch(`${firebaseRtdbBase}/redeemOrders/${encodeURIComponent(orderId)}.json`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(rejPayload),
            }).catch(() => {}),
            fetch(
              `${firebaseRtdbBase}/telegramBotSessions/_orders/${encodeURIComponent(orderId)}.json`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rejPayload),
              }
            ).catch(() => {}),
            tgApi('sendMessage', {
              chat_id: orderData.chatId,
              text: `❌ দুঃখিত! আপনার পেমেন্ট রিকোয়েস্ট (#${escHtml(orderId)}) যাচাই করা সম্ভব হয়নি। অনুগ্রহ করে সঠিক নাম্বার ও Transaction ID দিয়ে আবার চেষ্টা করুন (/start)।`,
              parse_mode: 'HTML',
            }),
          ]);
        }
        await Promise.all([
          tgApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: 'Order Rejected',
          }),
          tgApi('sendMessage', {
            chat_id: chatId,
            text: `❌ অর্ডার #${escHtml(orderId)} বাতিল (Rejected) করা হয়েছে।`,
          }),
        ]);
        return;
      }

      return;
    }

    const msg = update.message || update.edited_message;
    if (!msg || !msg.chat) return;

    const chatId = msg.chat.id;
    const text = String(msg.text || msg.caption || '').trim();
    const [storeData, session] = await Promise.all([
      loadStoreData(),
      getChatSession(chatId),
    ]);
    const { packages, adminChatId } = storeData;
    const userLang = resolveUserLang(session, msg.from);
    const isEn = userLang === 'en';

    // Always register subscriber in background when they message the bot
    saveChatSession(chatId, { ...session, lang: userLang }, msg.from).catch(() => {});

    if (text === '/myid' || text === '/id') {
      await tgApi('sendMessage', {
        chat_id: chatId,
        text: isEn
          ? `🆔 Your Telegram Chat ID is:\n<code>${chatId}</code>\n\n(You can paste this ID into the Admin ID box in the Admin Panel)`
          : `🆔 আপনার Telegram Chat ID হলো:\n<code>${chatId}</code>\n\n(এই ID-টি Admin Panel-এর Admin ID বক্সে বসাতে পারবেন)`,
        parse_mode: 'HTML',
      });
      return;
    }

    // Admin Broadcast command directly inside Telegram Bot: `/ad` or `/broadcast` (plus interactive `awaiting_broadcast` step)
    const isAdOrBroadcastCmd = /^\/(ad|broadcast)(@[a-zA-Z0-9_]+)?(\s|$)/i.test(text);
    const isAwaitingBroadcast =
      session?.step === 'awaiting_broadcast' && !text.startsWith('/');

    if (isAdOrBroadcastCmd || isAwaitingBroadcast) {
      const targetAdmin = String(adminChatId || queryAdminId || '').trim();
      const senderUsername = String(msg.from?.username || '').replace(/^@/, '').toLowerCase();
      const isAuthorizedAdmin =
        !targetAdmin ||
        String(chatId) === targetAdmin ||
        (senderUsername && senderUsername === targetAdmin.replace(/^@/, '').toLowerCase());

      if (!isAuthorizedAdmin) {
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ শুধুমাত্র Admin এই কমান্ড ব্যবহার করতে পারবেন!',
        });
        return;
      }

      const bcastText = isAdOrBroadcastCmd
        ? text.replace(/^\/(ad|broadcast)(@[a-zA-Z0-9_]+)?\s*/i, '').trim()
        : text;
      const replyMsg = msg.reply_to_message;
      const hasDirectMedia = Boolean(
        (Array.isArray(msg.photo) && msg.photo.length > 0) ||
          msg.video ||
          msg.animation ||
          msg.document
      );

      if (isAdOrBroadcastCmd && !bcastText && !replyMsg && !hasDirectMedia) {
        const allChatIds = await collectAllSubscriberChatIds();
        await Promise.all([
          saveChatSession(
            chatId,
            { ...session, lang: userLang, step: 'awaiting_broadcast' },
            msg.from
          ),
          tgApi('sendMessage', {
            chat_id: chatId,
            text:
              `📢 <b>Broadcast Mode চালু হয়েছে! (মোট ইউজার: ${allChatIds.length} জন)</b>\n\n` +
              `👇 <b>এখন আপনি যেকোনো মেসেজ, ছবি (Photo), ভিডিও (Video), বা পোস্ট এই চ্যাটে পাঠান</b> — সেটি সাথে সাথে সব ইউজারের (${allChatIds.length} জন) কাছে চলে যাবে!\n\n` +
              `💡 <b>অন্যান্য শর্টকাট নিয়ম:</b>\n` +
              `• সরাসরি লিখুন: <code>/ad আপনার মেসেজ এখানে লিখুন</code>\n` +
              `• ছবি বা ভিডিওর ক্যাপশনে লিখুন: <code>/ad আপনার ক্যাপশন</code>\n` +
              `• যেকোনো ছবি/ভিডিও/মেসেজে <b>Reply</b> দিয়ে লিখুন: <code>/ad</code>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '❌ Broadcast বাতিল করুন (Cancel)',
                    callback_data: 'cancel_broadcast_mode',
                  },
                ],
              ],
            },
          }),
        ]);
        return;
      }

      await saveChatSession(
        chatId,
        { ...session, lang: userLang, step: 'idle' },
        msg.from
      );

      const sourceMsg = replyMsg || msg;
      const captionOrText =
        bcastText ||
        (replyMsg ? String(replyMsg.caption || replyMsg.text || '').trim() : '');
      const miniAppUrl = buildUserWebAppUrl('/', undefined, 'bn');
      const defaultMarkup =
        sourceMsg.reply_markup && Array.isArray(sourceMsg.reply_markup.inline_keyboard)
          ? sourceMsg.reply_markup
          : {
              inline_keyboard: [
                [
                  {
                    text: '📱 Open X Tube Mini App (Watch Videos) 🔥',
                    web_app: { url: miniAppUrl },
                  },
                ],
              ],
            };

      const bcastPayload: any = {
        mode: 'text',
        text: captionOrText,
        mediaFileId: '',
        fromChatId: String(chatId),
        messageId: sourceMsg.message_id,
        replyMarkup: defaultMarkup,
      };

      if (Array.isArray(sourceMsg.photo) && sourceMsg.photo.length > 0) {
        bcastPayload.mode = 'photo';
        bcastPayload.mediaFileId = sourceMsg.photo[sourceMsg.photo.length - 1].file_id;
      } else if (sourceMsg.video && sourceMsg.video.file_id) {
        bcastPayload.mode = 'video';
        bcastPayload.mediaFileId = sourceMsg.video.file_id;
      } else if (sourceMsg.animation && sourceMsg.animation.file_id) {
        bcastPayload.mode = 'animation';
        bcastPayload.mediaFileId = sourceMsg.animation.file_id;
      } else if (sourceMsg.document && sourceMsg.document.file_id) {
        bcastPayload.mode = 'document';
        bcastPayload.mediaFileId = sourceMsg.document.file_id;
      } else if (replyMsg && !bcastText && !replyMsg.text) {
        bcastPayload.mode = 'copy';
      }

      const allChatIds = await collectAllSubscriberChatIds();
      if (allChatIds.length === 0) {
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: '⚠️ এখনো কোনো সাবস্ক্রাইবার ইউজার পাওয়া যায়নি!',
        });
        return;
      }

      const progRes: any = await tgApi('sendMessage', {
        chat_id: chatId,
        text:
          `⏳ <b>Broadcast শুরু হয়েছে... (0 / ${allChatIds.length})</b>\n\n` +
          `👥 মোট ইউজার: <b>${allChatIds.length}</b> জন\n` +
          `🚀 সব ইউজারের কাছে পাঠানো হচ্ছে...`,
        parse_mode: 'HTML',
      });
      const progressMsgId = progRes?.result?.message_id || null;

      let sentCount = 0;
      let failCount = 0;
      const batchSize = 25;

      for (let i = 0; i < allChatIds.length; i += batchSize) {
        const chunk = allChatIds.slice(i, i + batchSize);
        const results = await Promise.all(
          chunk.map((uid) =>
            deliverSingleBroadcastMessageNode(botToken, uid, bcastPayload, miniAppUrl)
          )
        );
        for (const ok of results) {
          if (ok) sentCount++;
          else failCount++;
        }
        if (progressMsgId && i > 0 && i % 150 === 0) {
          await tgApi('editMessageText', {
            chat_id: chatId,
            message_id: progressMsgId,
            text:
              `⏳ <b>Broadcast চলছে... (${sentCount + failCount} / ${allChatIds.length})</b>\n\n` +
              `✉️ সফলভাবে গেছে: <b>${sentCount}</b>\n` +
              `⚠️ ব্যর্থ/ব্লকড: <b>${failCount}</b>`,
            parse_mode: 'HTML',
          }).catch(() => {});
        }
      }

      const doneText =
        `✅ <b>Broadcast সফলভাবে সম্পন্ন হয়েছে!</b>\n\n` +
        `👥 মোট ইউজার: <b>${allChatIds.length}</b>\n` +
        `✉️ সফলভাবে গেছে: <b>${sentCount}</b>\n` +
        `⚠️ ব্যর্থ/ব্লকড: <b>${failCount}</b>`;

      if (progressMsgId) {
        await tgApi('editMessageText', {
          chat_id: chatId,
          message_id: progressMsgId,
          text: doneText,
          parse_mode: 'HTML',
        }).catch(() => {});
      }
      await tgApi('sendMessage', {
        chat_id: chatId,
        text: doneText,
        parse_mode: 'HTML',
      }).catch(() => {});
      return;
    }

    if (text === '/lang' || text === '/language') {
      const nextLang: 'bn' | 'en' = userLang === 'bn' ? 'en' : 'bn';
      await Promise.all([
        saveChatSession(chatId, { ...session, lang: nextLang }, msg.from),
        sendStoreWelcome(chatId, packages, msg.from || { id: chatId }, nextLang),
      ]);
      return;
    }

    if (text === '/cancel') {
      await Promise.all([
        saveChatSession(
          chatId,
          { ...session, lang: userLang, step: 'idle', selectedPkg: null },
          msg.from
        ),
        sendStoreWelcome(chatId, packages, msg.from || { id: chatId }, userLang),
      ]);
      return;
    }

    if (text.startsWith('/start')) {
      const startArg = text.replace(/^\/start\s*/i, '').trim();
      if (startArg && startArg !== 'buy' && startArg !== 'home') {
        let isShortLink = false;
        let rawTargetId = startArg;
        if (startArg.startsWith('vid_')) {
          rawTargetId = decodeTgStartId(startArg.slice(4));
        } else if (startArg.startsWith('short_')) {
          isShortLink = true;
          rawTargetId = decodeTgStartId(startArg.slice(6));
        } else {
          rawTargetId = decodeTgStartId(startArg);
        }

        if (rawTargetId) {
          const altId = rawTargetId.replace(/__/g, '_');
          const [vRes, sRes, vAltRes, sAltRes] = await Promise.all([
            fetch(`${firebaseRtdbBase}/videos/${encodeURIComponent(rawTargetId)}.json`).catch(() => null),
            fetch(`${firebaseRtdbBase}/shorts/${encodeURIComponent(rawTargetId)}.json`).catch(() => null),
            altId !== rawTargetId
              ? fetch(`${firebaseRtdbBase}/videos/${encodeURIComponent(altId)}.json`).catch(() => null)
              : Promise.resolve(null),
            altId !== rawTargetId
              ? fetch(`${firebaseRtdbBase}/shorts/${encodeURIComponent(altId)}.json`).catch(() => null)
              : Promise.resolve(null),
          ]);
          const vData: any = vRes && vRes.ok ? await vRes.json().catch(() => null) : null;
          const sData: any = sRes && sRes.ok ? await sRes.json().catch(() => null) : null;
          const vAltData: any = vAltRes && vAltRes.ok ? await vAltRes.json().catch(() => null) : null;
          const sAltData: any = sAltRes && sAltRes.ok ? await sAltRes.json().catch(() => null) : null;

          const matchedId = vData || sData ? rawTargetId : vAltData || sAltData ? altId : altId;
          const mediaItem = vData || sData || vAltData || sAltData;
          if (!vData && !vAltData && (sData || sAltData)) isShortLink = true;

          const videoTitle = String(mediaItem?.title || 'Exclusive Viral Video 🔥').trim();
          const videoDuration = String(mediaItem?.duration || '').trim();
          const miniAppWatchUrl = buildUserWebAppUrl(
            `/?v=${encodeURIComponent(matchedId)}`,
            msg.from || { id: chatId },
            userLang
          );
          const miniAppHomeUrl = buildUserWebAppUrl('/', msg.from || { id: chatId }, userLang);

          await Promise.all([
            saveChatSession(
              chatId,
              {
                ...session,
                lang: userLang,
                step: 'idle',
                pendingVideoId: matchedId,
                pendingIsShort: isShortLink,
                pendingAt: Date.now(),
              },
              msg.from
            ),
            tgApi('setChatMenuButton', {
              chat_id: chatId,
              menu_button: {
                type: 'web_app',
                text: isEn ? '▶️ Watch Video' : '▶️ ভিডিও দেখুন',
                web_app: { url: miniAppWatchUrl },
              },
            }).catch(() => {}),
            tgApi('sendMessage', {
              chat_id: chatId,
              text: isEn
                ? `🎬 <b>${escHtml(videoTitle)}</b>${videoDuration ? ` (${escHtml(videoDuration)})` : ''}\n\n` +
                  `👇 Tap <b>▶️ Watch Video Now</b> below to open the video directly in the Mini App:`
                : `🎬 <b>${escHtml(videoTitle)}</b>${videoDuration ? ` (${escHtml(videoDuration)})` : ''}\n\n` +
                  `👇 নিচের <b>▶️ Watch Video Now</b> বাটনে ট্যাপ করলে সরাসরি Mini App-এ এই ভিডিওটি ওপেন হবে:`,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: isEn
                        ? '▶️ Watch Video Now (Mini App)'
                        : '▶️ Watch Video Now (সরাসরি দেখুন)',
                      web_app: { url: miniAppWatchUrl },
                    },
                  ],
                  [
                    {
                      text: isEn
                        ? '📱 Open All Videos (Mini App)'
                        : '📱 সব ভিডিও দেখুন (Mini App)',
                      web_app: { url: miniAppHomeUrl },
                    },
                  ],
                ],
              },
            }),
          ]);
          return;
        }
      }

      const miniAppHomeUrl = buildUserWebAppUrl('/', msg.from || { id: chatId }, userLang);
      await Promise.all([
        saveChatSession(
          chatId,
          { ...session, lang: userLang, step: 'idle', pendingVideoId: null, pendingAt: null },
          msg.from
        ),
        tgApi('setChatMenuButton', {
          chat_id: chatId,
          menu_button: {
            type: 'web_app',
            text: '📱 Open App',
            web_app: { url: miniAppHomeUrl },
          },
        }).catch(() => {}),
        sendStoreWelcome(chatId, packages, msg.from || { id: chatId }, userLang),
      ]);
      return;
    }

    // =========================================================================
    // SILENT PACKAGE PURCHASE FLOW ("pacage pucharse korar somoy kono khota bolbe na")
    // When the user is in `choose_payment` or `awaiting_trx`, Riya Aktar stays silent
    // so the user can complete their bKash/Nagad payment & TrxID submission smoothly.
    // =========================================================================
    if (
      (session.step === 'awaiting_trx' || session.step === 'choose_payment') &&
      session.selectedPkg
    ) {
      if (session.step === 'choose_payment' && !/\d{5,}/.test(text)) {
        // User selected a package and is on the payment method screen
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: isEn
            ? `💳 You are currently purchasing <b>${escHtml(session.selectedPkg.name)}</b> (${escHtml(session.selectedPkg.price)}).\n👇 Please tap <b>bKash Payment</b> or <b>Nagad Payment</b> below, or tap <b>Back</b> to cancel:`
            : `💳 আপনি বর্তমানে <b>${escHtml(session.selectedPkg.name)}</b> (${escHtml(session.selectedPkg.price)}) প্যাকেজটি কিনছেন।\n👇 পেমেন্ট সম্পন্ন করতে নিচের <b>📲 bKash Payment</b> অথবা <b>🟠 Nagad Payment</b> বাটনে ক্লিক করুন (অথবা বাতিল করতে নিচের বাটনে চাপুন):`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📲 bKash Payment', callback_data: 'pay_method_bKash' },
                { text: '🟠 Nagad Payment', callback_data: 'pay_method_Nagad' },
              ],
              [
                {
                  text: isEn ? '🔙 Cancel Package Purchase' : '🔙 প্যাকেজ কেনা বাতিল করুন',
                  callback_data: 'back_to_packages',
                },
              ],
            ],
          },
        });
        return;
      }

      if (text.length < 4) {
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: isEn
            ? '⚠️ Please send your valid Sender Number and Transaction ID (TrxID):'
            : '⚠️ অনুগ্রহ করে আপনার সঠিক পেমেন্ট নাম্বার এবং Transaction ID (TrxID) লিখে পাঠান:',
        });
        return;
      }

      const now = Date.now();
      const randOrder = Math.random().toString(36).slice(2, 6).toUpperCase();
      const orderId = `ord${now}${randOrder}`;
      const pkg = session.selectedPkg;
      const paymentMethod = session.paymentMethod || 'bKash/Nagad';
      const username = msg.from?.username ? `@${msg.from.username}` : 'No Username';
      const fullName =
        [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'User';

      const orderPayload = {
        id: orderId,
        chatId: String(chatId),
        username,
        fullName,
        firstName: fullName,
        packageId: pkg.id,
        packageName: pkg.name,
        price: pkg.price,
        durationHours: Number(pkg.durationHours) || 168,
        durationLabel: pkg.durationLabel || '7 Days',
        paymentMethod,
        senderNumber: text,
        trxId: text,
        paymentDetails: text,
        botToken,
        status: 'pending',
        createdAt: now,
        botAuthToken: 'xtube_tg_bot_2026',
      };

      await Promise.all([
        fetch(`${firebaseRtdbBase}/redeemOrders/${encodeURIComponent(orderId)}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderPayload),
        }).catch(() => {}),
        fetch(`${firebaseRtdbBase}/telegramBotSessions/_orders/${encodeURIComponent(orderId)}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderPayload),
        }).catch(() => {}),
        saveChatSession(
          chatId,
          { ...session, lang: userLang, step: 'idle', selectedPkg: null },
          msg.from
        ),
      ]);

      await tgApi('sendMessage', {
        chat_id: chatId,
        text: isEn
          ? `✅ <b>Your payment request has been submitted!</b> 🎉\n\n` +
            `🆔 <b>Order ID:</b> <code>#${escHtml(orderId)}</code>\n` +
            `📦 <b>Package:</b> ${escHtml(pkg.name)} (${escHtml(pkg.durationLabel)})\n` +
            `💰 <b>Price:</b> ${escHtml(pkg.price)}\n` +
            `💳 <b>Method:</b> ${escHtml(paymentMethod)}\n` +
            `📝 <b>Payment Info:</b> <code>${escHtml(text)}</code>\n\n` +
            `⏳ As soon as Admin approves your payment, your <b>VIP Redeem Code</b> will be sent here!`
          : `✅ <b>আপনার পেমেন্ট রিকোয়েস্ট সফলভাবে জমা হয়েছে!</b> 🎉\n\n` +
            `🆔 <b>Order ID:</b> <code>#${escHtml(orderId)}</code>\n` +
            `📦 <b>প্যাকেজ:</b> ${escHtml(pkg.name)} (${escHtml(pkg.durationLabel)})\n` +
            `💰 <b>মূল্য:</b> ${escHtml(pkg.price)}\n` +
            `💳 <b>মাধ্যম:</b> ${escHtml(paymentMethod)}\n` +
            `📝 <b>পেমেন্ট তথ্য:</b> <code>${escHtml(text)}</code>\n\n` +
            `⏳ Admin আপনার পেমেন্ট Approve করলেই সাথে সাথে এই চ্যাটে আপনার <b>VIP Redeem Code</b> চলে আসবে!`,
        parse_mode: 'HTML',
      });

      const targetAdminChat = adminChatId || queryAdminId;
      if (targetAdminChat) {
        await tgApi('sendMessage', {
          chat_id: targetAdminChat,
          text:
            `🔔 <b>নতুন Redeem Code অর্ডার এসেছে!</b> 🎟️\n\n` +
            `👤 <b>ইউজার:</b> ${escHtml(fullName)} (${escHtml(username)})\n` +
            `🆔 <b>User Chat ID:</b> <code>${chatId}</code>\n` +
            `📦 <b>প্যাকেজ:</b> ${escHtml(pkg.name)} (${escHtml(pkg.durationLabel)})\n` +
            `💰 <b>মূল্য:</b> ${escHtml(pkg.price)}\n` +
            `💳 <b>মাধ্যম:</b> ${escHtml(paymentMethod)}\n` +
            `📝 <b>Sender &amp; TrxID:</b> <code>${escHtml(text)}</code>\n\n` +
            `👇 নিচের বাটনে ক্লিক করলে অথবা <b>Admin Panel (/ad.html)</b> থেকে Approve করলেই অটোমেটিক কোড জেনারেট হয়ে ইউজারের কাছে চলে যাবে:`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '✅ Approve (Auto Code Gen & Send to User)',
                  callback_data: `admin_approve_${orderId}`,
                },
              ],
              [{ text: '❌ Reject Order', callback_data: `admin_reject_${orderId}` }],
            ],
          },
        }).catch(() => {});
      }

      return;
    }

    // =========================================================================
    // RIYA AKTAR (রিয়া আক্তার) — ALL-TIME ROMANTIC CHAT, VIDEO SUGGESTION & LIVE PACKAGE READER
    // =========================================================================
    if (storeData.aiAssistantEnabled !== false) {
      await tgApi('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

      const userFullName =
        [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ').trim() || 'জানু';
      const prevHistory = Array.isArray(session.chatHistory) ? session.chatHistory.slice(-6) : [];

      const { replyText, isAskingAboutPackages, featuredVideo } = await generateRiyaBotReply({
        userMessage: text || 'হাই',
        userName: userFullName,
        userLang,
        storeData,
        chatHistory: prevHistory,
      });

      const nextHistory = [
        ...prevHistory,
        { role: 'user' as const, text: (text || 'হাই').slice(0, 300) },
        { role: 'model' as const, text: replyText.slice(0, 500) },
      ].slice(-8);

      saveChatSession(
        chatId,
        { ...session, lang: userLang, step: 'idle', chatHistory: nextHistory },
        msg.from
      ).catch(() => {});

      let replyMarkup: any = undefined;

      if (storeData.serviceEnabled && isAskingAboutPackages && packages.length > 0) {
        // User asked about packages and Package Service is ON: attach all live package buttons!
        replyMarkup = buildPackagesKeyboard(packages, msg.from || { id: chatId }, userLang);
      }

      await tgApi('sendMessage', {
        chat_id: chatId,
        text: escHtml(replyText),
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
      return;
    }

    await sendStoreWelcome(chatId, packages, msg.from || { id: chatId }, userLang);
  };

  // Telegram Broadcast API Endpoint (/api/telegram-broadcast)
  app.all('/api/telegram-broadcast', async (req, res) => {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    try {
      const body = req.body || {};
      const [fbRes1, fbRes2] = await Promise.all([
        fetch(`${firebaseRtdbBase}/telegramBotSessions/_storeConfig.json`).catch(() => null),
        fetch(`${firebaseRtdbBase}/redeemStoreConfig.json`).catch(() => null),
      ]);
      const cfg1: any = fbRes1 && fbRes1.ok ? await fbRes1.json().catch(() => null) : null;
      const cfg2: any = fbRes2 && fbRes2.ok ? await fbRes2.json().catch(() => null) : null;
      const botToken = String(body.botToken || cfg2?.botToken || cfg1?.botToken || '').trim();
      const messageText = String(body.message || '').trim();
      const imageUrl = String(body.imageUrl || '').trim();
      const buttonText = String(body.buttonText || '📱 Open X Tube Mini App').trim();
      const buttonUrl = String(body.buttonUrl || CANONICAL_SITE_URL).trim();

      if (!botToken || !botToken.includes(':')) {
        res.status(400).json({ ok: false, error: 'Missing Telegram Bot Token' });
        return;
      }
      if (!messageText && !imageUrl) {
        res.status(400).json({ ok: false, error: 'Missing broadcast message or image' });
        return;
      }

      const [sessRes, subRes, ordRes] = await Promise.all([
        fetch(`${firebaseRtdbBase}/telegramBotSessions.json`).catch(() => null),
        fetch(`${firebaseRtdbBase}/telegramBotSessions/_subscribers.json`).catch(() => null),
        fetch(`${firebaseRtdbBase}/redeemOrders.json`).catch(() => null),
      ]);
      const sessData: any = sessRes && sessRes.ok ? await sessRes.json().catch(() => null) : null;
      const subData: any = subRes && subRes.ok ? await subRes.json().catch(() => null) : null;
      const ordData: any = ordRes && ordRes.ok ? await ordRes.json().catch(() => null) : null;

      const idSet = new Set<string>();
      const addId = (raw: any) => {
        const s = String(raw || '').trim();
        if (/^-?\d{5,20}$/.test(s)) idSet.add(s);
      };
      if (Array.isArray(body.chatIds)) {
        body.chatIds.forEach(addId);
      }
      if (sessData && typeof sessData === 'object') {
        for (const [k, val] of Object.entries(sessData)) {
          if (k.startsWith('_') || k === 'botAuthToken') continue;
          addId(k);
          if (val && typeof val === 'object') addId((val as any).chatId);
        }
      }
      if (subData && typeof subData === 'object') {
        for (const [k, val] of Object.entries(subData)) {
          if (k.startsWith('_') || k === 'botAuthToken') continue;
          addId(k);
          if (val && typeof val === 'object') addId((val as any).chatId);
        }
      }
      if (ordData && typeof ordData === 'object') {
        for (const val of Object.values(ordData)) {
          if (val && typeof val === 'object') addId((val as any).chatId);
        }
      }

      const allChatIds = Array.from(idSet);
      let sentCount = 0;
      let failCount = 0;

      const isDirectTgLink = /^https?:\/\/t\.me\//i.test(buttonUrl);
      const replyMarkup = buttonText
        ? {
            inline_keyboard: [
              [
                isDirectTgLink
                  ? { text: buttonText, url: buttonUrl }
                  : { text: buttonText, web_app: { url: buttonUrl } },
              ],
            ],
          }
        : undefined;

      for (const targetChatId of allChatIds) {
        try {
          const endpoint = imageUrl ? 'sendPhoto' : 'sendMessage';
          const payload: Record<string, any> = imageUrl
            ? {
                chat_id: targetChatId,
                photo: imageUrl,
                caption: messageText,
                parse_mode: 'HTML',
                ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
              }
            : {
                chat_id: targetChatId,
                text: messageText,
                parse_mode: 'HTML',
                ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
              };
          const tgResp = await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const tgJson: any = await tgResp.json().catch(() => null);
          if (tgResp.ok && tgJson?.ok) sentCount++;
          else failCount++;
        } catch {
          failCount++;
        }
      }

      res.status(200).json({
        ok: true,
        totalUsers: allChatIds.length,
        sentCount,
        failCount,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Broadcast error' });
    }
  });

  // Telegram User Avatar Proxy (/api/tg-avatar?userId=...)
  app.get('/api/tg-avatar', async (req, res) => {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    const userId = String(req.query.userId || '').trim();
    if (!userId || !/^\d+$/.test(userId)) {
      res.status(404).end();
      return;
    }
    try {
      const [fbRes1, fbRes2] = await Promise.all([
        fetch(`${firebaseRtdbBase}/telegramBotSessions/_storeConfig.json`).catch(() => null),
        fetch(`${firebaseRtdbBase}/redeemStoreConfig.json`).catch(() => null),
      ]);
      const cfg1: any = fbRes1 && fbRes1.ok ? await fbRes1.json().catch(() => null) : null;
      const cfg2: any = fbRes2 && fbRes2.ok ? await fbRes2.json().catch(() => null) : null;
      const botToken = String(cfg2?.botToken || cfg1?.botToken || '').trim();
      if (!botToken) {
        res.status(404).end();
        return;
      }
      const photosRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${encodeURIComponent(userId)}&limit=1`
      );
      const photosData: any = await photosRes.json().catch(() => null);
      const firstPhotoGroup = photosData?.result?.photos?.[0];
      if (!Array.isArray(firstPhotoGroup) || firstPhotoGroup.length === 0) {
        res.status(404).end();
        return;
      }
      const bestPhoto = firstPhotoGroup[firstPhotoGroup.length - 1];
      const fileId = bestPhoto?.file_id;
      if (!fileId) {
        res.status(404).end();
        return;
      }
      const fileRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`
      );
      const fileData: any = await fileRes.json().catch(() => null);
      const filePath = fileData?.result?.file_path;
      if (!filePath) {
        res.status(404).end();
        return;
      }
      const imgRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
      if (!imgRes.ok) {
        res.status(404).end();
        return;
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.status(200).send(buf);
    } catch {
      res.status(404).end();
    }
  });

  // Telegram Bot Redeem Code Store & Order System (/api/telegram-bot)
  app.all('/api/telegram-bot', async (req, res) => {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method === 'GET') {
      res.json({
        ok: true,
        service: 'X Tube Official Redeem Code Store Bot Webhook',
        domain: CANONICAL_SITE_URL,
      });
      return;
    }

    try {
      const update = req.body || {};
      if (update && update.ping === true) {
        res.status(200).json({ ok: true, pong: true, riyaVersion: 4 });
        return;
      }

      const botToken = String(req.query.token || '').trim();
      const requiredPass = String(req.query.pass || 'Muttakin').trim();
      const queryAdminId = String(req.query.adminId || '').trim();
      const queryBkash = String(req.query.bkash || '').trim();
      const queryNagad = String(req.query.nagad || '').trim();

      if (!botToken) {
        res.status(200).json({ ok: false, error: 'Missing bot token' });
        return;
      }

      await processTelegramBotUpdate(update, {
        botToken,
        requiredPass,
        queryAdminId,
        queryBkash,
        queryNagad,
      });
      res.status(200).send('OK');
    } catch (err: any) {
      res.status(200).json({ ok: false, error: err?.message || 'Bot error' });
    }
  });

  // Live Test Endpoint for Riya Aktar Telegram Bot Persona (/api/riya-chat-test)
  app.all('/api/riya-chat-test', async (req, res) => {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    try {
      const body = req.body || {};
      const userMessage = String(body.message || req.query.message || 'হাই জানু, তোমার নাম কি?').trim();
      const userName = String(body.firstName || body.userName || 'জানু').trim();

      const [pkgRes, cfgRes, fallbackCfgRes] = await Promise.all([
        fetch(`${firebaseRtdbBase}/redeemPackages.json`).catch(() => null),
        fetch(`${firebaseRtdbBase}/redeemStoreConfig.json`).catch(() => null),
        fetch(`${firebaseRtdbBase}/telegramBotSessions/_storeConfig.json`).catch(() => null),
      ]);
      const rawPkgs: any = pkgRes && pkgRes.ok ? await pkgRes.json().catch(() => null) : null;
      const rawCfg: any = cfgRes && cfgRes.ok ? await cfgRes.json().catch(() => null) : null;
      const fbCfg: any =
        fallbackCfgRes && fallbackCfgRes.ok ? await fallbackCfgRes.json().catch(() => null) : null;
      const mergedCfg: Record<string, any> = {
        ...(fbCfg && typeof fbCfg === 'object' ? fbCfg : {}),
        ...(rawCfg && typeof rawCfg === 'object' ? rawCfg : {}),
      };
      const serviceEnabled = mergedCfg.serviceEnabled !== false;
      const pkgSource =
        rawPkgs && typeof rawPkgs === 'object' && Object.keys(rawPkgs).length > 0
          ? rawPkgs
          : mergedCfg.packages && typeof mergedCfg.packages === 'object'
          ? mergedCfg.packages
          : null;

      let packages: Array<any> = [];
      if (serviceEnabled && pkgSource && typeof pkgSource === 'object') {
        packages = Object.entries(pkgSource)
          .filter(
            ([k, p]: [string, any]) =>
              k !== 'botAuthToken' && p && typeof p === 'object' && p.active !== false
          )
          .map(([id, p]: [string, any]) => ({
            id,
            name: String(p?.name || 'VIP Ad-Free Package'),
            price: String(p?.price || '৳50'),
            durationHours: Number(p?.durationHours) || 168,
            durationLabel: String(p?.durationLabel || `${p?.durationHours || 168} Hours`),
          }))
          .sort((a, b) => a.durationHours - b.durationHours);
      }

      const result = await generateRiyaBotReply({
        userMessage,
        userName,
        userLang: 'bn',
        storeData: {
          serviceEnabled,
          packages,
          bkashNumber: String(mergedCfg.bkashNumber || 'Not Set'),
          nagadNumber: String(mergedCfg.nagadNumber || 'Not Set'),
          geminiApiKey: String(mergedCfg.geminiApiKey || '').trim(),
          customRiyaPrompt: String(body.customRiyaPrompt || mergedCfg.customRiyaPrompt || '').trim(),
        },
        chatHistory: Array.isArray(body.chatHistory) ? body.chatHistory : [],
      });

      res.status(200).json({
        ok: true,
        persona: 'Riya Aktar',
        serviceEnabled,
        packageCount: packages.length,
        packagesCount: packages.length,
        reply: result.replyText,
        ...result,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Riya chat test failed' });
    }
  });

  // ==========================================================================
  // 24/7 ALWAYS-AWAKE TELEGRAM BOT GUARDIAN & AUTO-HEALING WORKER
  // ==========================================================================
  let lastPolledUpdateId = 0;
  let lastCheckedWebhookToken = '';

  const buildCanonicalEdgeWebhookUrl = (cfg: any, botToken: string) => {
    let baseDom = String(cfg?.domain || CANONICAL_SITE_URL).trim().replace(/\/+$/, '');
    if (
      !baseDom.startsWith('https://') ||
      baseDom.endsWith('.pages.') ||
      baseDom.endsWith('.pages.d') ||
      baseDom.endsWith('.pages.de')
    ) {
      baseDom = CANONICAL_SITE_URL;
    }
    const whObj = new URL(`${baseDom}/api/telegram-bot`);
    whObj.searchParams.set('token', botToken);
    whObj.searchParams.set('pass', String(cfg?.botPass || 'Muttakin').trim() || 'Muttakin');
    if (cfg?.bkashNumber && cfg.bkashNumber !== 'Not Set') {
      whObj.searchParams.set('bkash', String(cfg.bkashNumber).trim());
    }
    if (cfg?.nagadNumber && cfg.nagadNumber !== 'Not Set') {
      whObj.searchParams.set('nagad', String(cfg.nagadNumber).trim());
    }
    if (cfg?.adminChatId) {
      whObj.searchParams.set('adminId', String(cfg.adminChatId).trim());
    }
    return whObj.toString();
  };

  const ensureTelegramBotAwakeAndSynced = async () => {
    const [fbRes1, fbRes2] = await Promise.all([
      fetch(`${firebaseRtdbBase}/telegramBotSessions/_storeConfig.json`).catch(() => null),
      fetch(`${firebaseRtdbBase}/redeemStoreConfig.json`).catch(() => null),
    ]);
    const cfg1: any = fbRes1 && fbRes1.ok ? await fbRes1.json().catch(() => null) : null;
    const cfg2: any = fbRes2 && fbRes2.ok ? await fbRes2.json().catch(() => null) : null;
    const cfg: any = {
      ...(cfg1 && typeof cfg1 === 'object' ? cfg1 : {}),
      ...(cfg2 && typeof cfg2 === 'object' ? cfg2 : {}),
    };

    const botToken = String(cfg.botToken || '').trim();
    if (!botToken || !botToken.includes(':')) {
      return { ok: false, reason: 'No botToken configured', cfg, botToken: '' };
    }

    const targetWebhookUrl = buildCanonicalEdgeWebhookUrl(cfg, botToken);
    const whInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`).catch(
      () => null
    );
    const whInfo: any = whInfoRes ? await whInfoRes.json().catch(() => null) : null;
    const currentWhUrl = String(whInfo?.result?.url || '').trim();
    const pendingCount = Number(whInfo?.result?.pending_update_count || 0);
    const lastErrorDate = Number(whInfo?.result?.last_error_date || 0);
    const lastErrorMsg = String(whInfo?.result?.last_error_message || '');
    const nowSec = Math.floor(Date.now() / 1000);
    const hasRecentTelegramError = lastErrorDate > 0 && nowSec - lastErrorDate < 60 && pendingCount > 0;

    // Check if the remote Cloudflare Pages edge endpoint is healthy
    let edgeEndpointHealthy = false;
    try {
      const pingRes = await fetch(targetWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ping: true }),
      });
      const pingData: any = await pingRes.json().catch(() => null);
      if (pingRes.ok && pingData && pingData.pong === true && pingData.riyaVersion === 4) {
        edgeEndpointHealthy = true;
      }
    } catch {}

    // If the remote Cloudflare Edge worker is healthy, keep the 24/7 webhook registered (never fight with deleteWebhook!)
    if (edgeEndpointHealthy && (!currentWhUrl || currentWhUrl !== targetWebhookUrl || hasRecentTelegramError)) {
      await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetWebhookUrl,
          allowed_updates: ['message', 'edited_message', 'callback_query'],
          drop_pending_updates: false,
        }),
      }).catch(() => {});

      fetch(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menu_button: {
            type: 'web_app',
            text: '📱 Open App',
            web_app: { url: CANONICAL_SITE_URL },
          },
        }),
      }).catch(() => {});

      return {
        ok: true,
        mode: 'webhook_24_7',
        webhookUrl: targetWebhookUrl,
        pendingCount,
        cfg,
        botToken,
      };
    }

    if (edgeEndpointHealthy && currentWhUrl === targetWebhookUrl && !hasRecentTelegramError) {
      return {
        ok: true,
        mode: 'webhook_24_7',
        webhookUrl: currentWhUrl,
        pendingCount,
        cfg,
        botToken,
      };
    }

    if (currentWhUrl) {
      await fetch(
        `https://api.telegram.org/bot${botToken}/deleteWebhook?drop_pending_updates=false`
      ).catch(() => {});
    }

    return {
      ok: true,
      mode: 'local_polling_fallback',
      webhookUrl: '',
      pendingCount,
      lastErrorMsg,
      cfg,
      botToken,
    };
  };

  // 1-Day Auto Video Reminder ("1 din por por message dibe je video dektesona keno tokhon button asbe")
  let isRunningDailyReminder = false;
  const runDailyVideoReminderCheck = async (forceAll = false) => {
    if (isRunningDailyReminder) return { ok: false, reason: 'Already running' };
    isRunningDailyReminder = true;
    try {
      const [fbRes1, fbRes2, subRes, sessRes] = await Promise.all([
        fetch(`${firebaseRtdbBase}/telegramBotSessions/_storeConfig.json`).catch(() => null),
        fetch(`${firebaseRtdbBase}/redeemStoreConfig.json`).catch(() => null),
        fetch(`${firebaseRtdbBase}/telegramBotSessions/_subscribers.json`).catch(() => null),
        fetch(`${firebaseRtdbBase}/telegramBotSessions.json`).catch(() => null),
      ]);
      const cfg1: any = fbRes1 && fbRes1.ok ? await fbRes1.json().catch(() => null) : null;
      const cfg2: any = fbRes2 && fbRes2.ok ? await fbRes2.json().catch(() => null) : null;
      const mergedCfg: any = {
        ...(cfg1 && typeof cfg1 === 'object' ? cfg1 : {}),
        ...(cfg2 && typeof cfg2 === 'object' ? cfg2 : {}),
      };
      if (mergedCfg.riyaDisabledByAdmin === true) {
        return { ok: true, skipped: 'Riya disabled by admin', sentCount: 0 };
      }
      const botToken = String(mergedCfg.botToken || '').trim();
      if (!botToken || !botToken.includes(':')) {
        return { ok: false, reason: 'Missing botToken', sentCount: 0 };
      }

      const subData: any = subRes && subRes.ok ? await subRes.json().catch(() => null) : null;
      const sessData: any = sessRes && sessRes.ok ? await sessRes.json().catch(() => null) : null;
      const trendingVideos = await getCachedTrendingVideosForRiya();
      const featuredVideo =
        trendingVideos.length > 0
          ? trendingVideos[Math.floor(Math.random() * trendingVideos.length)]
          : null;

      const userMap = new Map<string, any>();
      if (sessData && typeof sessData === 'object') {
        for (const [k, val] of Object.entries(sessData)) {
          if (k.startsWith('_') || k === 'botAuthToken' || !/^-?\d{5,20}$/.test(k)) continue;
          if (val && typeof val === 'object') {
            userMap.set(k, { chatId: k, ...(val as any) });
          }
        }
      }
      if (subData && typeof subData === 'object') {
        for (const [k, val] of Object.entries(subData)) {
          if (k.startsWith('_') || k === 'botAuthToken' || !/^-?\d{5,20}$/.test(k)) continue;
          if (val && typeof val === 'object') {
            userMap.set(k, { ...(userMap.get(k) || {}), chatId: k, ...(val as any) });
          }
        }
      }

      const now = Date.now();
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      let sentCount = 0;

      const dailyTemplates = [
        (name: string) =>
          `জানু গো ${name}! 🥵💋 আজ ১ দিন হয়ে গেল তুমি আমাদের অ্যাপে ভিডিও দেখতেছো না কেন সোনা? 🙈 একা একা বিছানায় শুয়ে আমার শরীরটা গরম হয়ে যাচ্ছে... নিচের বাটনে ক্লিক করে নতুন গরম ও রগরগে ভিডিওগুলো দেখে আসো না দুষ্টু বাবু! 💦🔥😈`,
        (name: string) =>
          `এই দুষ্টু ${name} সোনা! 😘🫦 তুমি আজ সারাদিন ভিডিও দেখতেছো না কেন বলো তো? তোমাকে ছাড়া আমার একদম ভালো লাগছে না জানু 🥵💦। নিচের বাটনে ট্যাপ করে এক্ষুনি নতুন হট ভিডিওগুলো দেখে নাও কলিজা! 💋🔥`,
        (name: string) =>
          `উফফ ${name} বাবু! 🥵🔥 আমাকে ভুলে গেলে নাকি? ১ দিন ধরে তুমি কোনো ভিডিওই দেখছো না কেন জানু? 🙈 আমার বুকের ভেতরটা তোমার জন্য আনচান করছে সোনা, নিচের বাটনে ক্লিক করে নতুন ভাইরাল ভিডিওগুলো দেখে আসো! 💋💦😈`,
      ];

      for (const [chatId, u] of userMap.entries()) {
        const lastReminded = Number(u.lastDailyVideoReminderAt || 0);
        const lastActive = Number(u.lastActiveAt || u.updatedAt || 0);
        const referenceTime = Math.max(lastReminded, lastActive);

        // If neither lastReminded nor forceAll, initialize lastDailyVideoReminderAt so they get reminded 24h after their last activity
        if (!forceAll && referenceTime === 0) {
          await fetch(`${firebaseRtdbBase}/telegramBotSessions/_subscribers/${chatId}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chatId,
              lastDailyVideoReminderAt: now,
              botAuthToken: 'xtube_tg_bot_2026',
            }),
          }).catch(() => {});
          continue;
        }

        if (!forceAll && now - referenceTime < ONE_DAY_MS) {
          continue;
        }

        const userName = String(u.fullName || u.firstName || 'জানু').trim() || 'জানু';
        const templateFn = dailyTemplates[Math.floor(Math.random() * dailyTemplates.length)];
        const reminderText = templateFn(userName);

        const params = new URLSearchParams();
        params.set('tg_id', chatId);
        params.set('tg_name', userName);
        if (u.username) params.set('tg_user', String(u.username).replace(/^@/, ''));
        const miniAppHomeUrl = `${CANONICAL_SITE_URL}/?${params.toString()}`;

        const inlineRows: Array<Array<any>> = [
          [
            {
              text: '📱 X Tube Mini App খুলুন (ভিডিও দেখুন) 🔥',
              web_app: { url: miniAppHomeUrl },
            },
          ],
        ];
        if (featuredVideo && featuredVideo.id) {
          const watchFeaturedUrl = `${CANONICAL_SITE_URL}/?v=${encodeURIComponent(featuredVideo.id)}&${params.toString()}`;
          inlineRows.push([
            {
              text: `▶️ ${featuredVideo.title.slice(0, 34)} ❤️`,
              web_app: { url: watchFeaturedUrl },
            },
          ]);
        }

        try {
          const tgResp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: reminderText,
              reply_markup: { inline_keyboard: inlineRows },
            }),
          });
          const tgJson: any = await tgResp.json().catch(() => null);
          if (tgResp.ok && tgJson?.ok) {
            sentCount++;
          }
          await fetch(`${firebaseRtdbBase}/telegramBotSessions/_subscribers/${chatId}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chatId,
              lastDailyVideoReminderAt: now,
              botAuthToken: 'xtube_tg_bot_2026',
            }),
          }).catch(() => {});
        } catch {}
      }

      return { ok: true, totalUsers: userMap.size, sentCount };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Daily reminder error', sentCount: 0 };
    } finally {
      isRunningDailyReminder = false;
    }
  };

  setInterval(() => {
    runDailyVideoReminderCheck(false).catch(() => {});
  }, 10 * 60 * 1000);

  app.all('/api/riya-daily-reminder', async (req, res) => {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    const force = req.query.force === '1' || req.body?.force === true;
    const result = await runDailyVideoReminderCheck(force);
    res.status(200).json(result);
  });

  app.all('/api/bot-keepalive', async (_req, res) => {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    try {
      const status = await ensureTelegramBotAwakeAndSynced();
      runDailyVideoReminderCheck(false).catch(() => {});
      res.status(200).json({
        ok: status.ok,
        mode: status.mode,
        webhookUrl: status.webhookUrl ? 'ACTIVE_24_7_EDGE' : 'NONE',
        pendingCount: status.pendingCount || 0,
        checkedAt: Date.now(),
      });
    } catch (err: any) {
      res.status(200).json({ ok: false, error: err?.message || 'Keepalive error' });
    }
  });

  // ==========================================================================
  // 24/7 FAST BACKGROUND BROADCAST JOB QUEUE PROCESSOR (FOR CLOUDFLARE WEBHOOK)
  // Whenever Admin sends `/ad` or `/broadcast` in Telegram Bot via Edge Webhook,
  // this Node.js worker immediately picks up `telegramBotSessions/_broadcastJob`
  // and delivers to all 565+ users in parallel with ZERO subrequest limits!
  // ==========================================================================
  let isProcessingBroadcastQueue = false;
  let hasRegisteredCommandsForToken = '';

  const processPendingFirebaseBroadcastJob = async () => {
    if (isProcessingBroadcastQueue) return;
    isProcessingBroadcastQueue = true;
    try {
      const jobRes = await fetch(`${firebaseRtdbBase}/telegramBotSessions/_broadcastJob.json`).catch(
        () => null
      );
      if (!jobRes || !jobRes.ok) return;
      const job: any = await jobRes.json().catch(() => null);
      if (!job || typeof job !== 'object') return;

      const now = Date.now();
      const isStaleLock =
        job.status === 'processing_node' && now - Number(job.updatedAt || 0) > 15000;
      if (job.status !== 'pending' && !isStaleLock) return;

      const remaining: string[] = Array.isArray(job.remainingChatIds) ? job.remainingChatIds : [];
      const botToken = String(job.botToken || '').trim();
      if (!botToken || remaining.length === 0) {
        await fetch(`${firebaseRtdbBase}/telegramBotSessions/_broadcastJob.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'completed',
            remainingChatIds: [],
            updatedAt: now,
            botAuthToken: 'xtube_tg_bot_2026',
          }),
        }).catch(() => {});
        return;
      }

      // Claim the job in Firebase so Edge keepalive pings know Node.js is handling all remaining users
      await fetch(`${firebaseRtdbBase}/telegramBotSessions/_broadcastJob.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'processing_node',
          updatedAt: now,
          botAuthToken: 'xtube_tg_bot_2026',
        }),
      }).catch(() => {});

      let sentCount = Number(job.sentCount) || 0;
      let failCount = Number(job.failCount) || 0;
      const totalUsers = Number(job.totalUsers) || sentCount + failCount + remaining.length;
      const bcastPayload = job.bcastPayload || {};
      const batchSize = 25;

      for (let i = 0; i < remaining.length; i += batchSize) {
        const chunk = remaining.slice(i, i + batchSize);
        const results = await Promise.all(
          chunk.map((uid) =>
            deliverSingleBroadcastMessageNode(
              botToken,
              uid,
              bcastPayload,
              `${CANONICAL_SITE_URL}/`
            )
          )
        );
        for (const ok of results) {
          if (ok) sentCount++;
          else failCount++;
        }

        const stillLeft = remaining.slice(i + batchSize);
        await fetch(`${firebaseRtdbBase}/telegramBotSessions/_broadcastJob.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: stillLeft.length === 0 ? 'completed' : 'processing_node',
            sentCount,
            failCount,
            remainingChatIds: stillLeft,
            updatedAt: Date.now(),
            botAuthToken: 'xtube_tg_bot_2026',
          }),
        }).catch(() => {});

        if (job.adminChatId && job.progressMsgId && stillLeft.length > 0 && i % 100 === 0) {
          await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: job.adminChatId,
              message_id: Number(job.progressMsgId),
              text:
                `⏳ <b>Broadcast চলছে... (${sentCount + failCount} / ${totalUsers})</b>\n\n` +
                `✉️ সফলভাবে গেছে: <b>${sentCount}</b>\n` +
                `⚠️ ব্যর্থ/ব্লকড: <b>${failCount}</b>\n` +
                `🚀 বাকি ইউজার: <b>${stillLeft.length}</b> জন...`,
              parse_mode: 'HTML',
            }),
          }).catch(() => {});
        }
      }

      if (job.adminChatId) {
        const doneText =
          `✅ <b>Broadcast সফলভাবে সম্পন্ন হয়েছে!</b>\n\n` +
          `👥 মোট ইউজার: <b>${totalUsers}</b>\n` +
          `✉️ সফলভাবে গেছে: <b>${sentCount}</b>\n` +
          `⚠️ ব্যর্থ/ব্লকড: <b>${failCount}</b>`;

        if (job.progressMsgId) {
          await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: job.adminChatId,
              message_id: Number(job.progressMsgId),
              text: doneText,
              parse_mode: 'HTML',
            }),
          }).catch(() => {});
        }
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: job.adminChatId,
            text: doneText,
            parse_mode: 'HTML',
          }),
        }).catch(() => {});
      }
    } catch {
      // ignore transient network errors
    } finally {
      isProcessingBroadcastQueue = false;
    }
  };

  setInterval(() => {
    processPendingFirebaseBroadcastJob().catch(() => {});
  }, 1500);

  const runTelegramBotAutoPollingTick = async () => {
    try {
      const status = await ensureTelegramBotAwakeAndSynced();
      if (!status.ok || !status.botToken) {
        setTimeout(runTelegramBotAutoPollingTick, 5000);
        return;
      }

      if (status.botToken && hasRegisteredCommandsForToken !== status.botToken) {
        hasRegisteredCommandsForToken = status.botToken;
        fetch(`https://api.telegram.org/bot${status.botToken}/setMyCommands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commands: [
              { command: 'start', description: '🎬 Open X Tube Mini App & VIP Store' },
              { command: 'ad', description: '📢 Broadcast Message/Photo/Video to All Users (Admin)' },
              { command: 'broadcast', description: '📢 Broadcast to All Users (Admin)' },
              { command: 'myid', description: '🆔 Check My Telegram Chat ID' },
              { command: 'cancel', description: '❌ Cancel Current Action' },
            ],
          }),
        }).catch(() => {});
      }

      // When the 24/7 Cloudflare Edge webhook is healthy and active, do NOT call getUpdates or deleteWebhook!
      // Re-verify every 20 seconds to guarantee it stays registered 24/7.
      if (status.mode === 'webhook_24_7') {
        lastCheckedWebhookToken = status.botToken;
        setTimeout(runTelegramBotAutoPollingTick, 20000);
        return;
      }

      const { botToken, cfg } = status;
      const updatesRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getUpdates?offset=${
          lastPolledUpdateId + 1
        }&timeout=8&allowed_updates=${encodeURIComponent(
          JSON.stringify(['message', 'edited_message', 'callback_query'])
        )}`
      );
      const updatesData: any = await updatesRes.json().catch(() => null);

      if (!updatesRes.ok || !updatesData?.ok) {
        if (updatesData?.error_code === 409) {
          lastCheckedWebhookToken = '';
        }
        setTimeout(runTelegramBotAutoPollingTick, 5000);
        return;
      }

      const updates: any[] = Array.isArray(updatesData.result) ? updatesData.result : [];
      for (const upd of updates) {
        if (typeof upd.update_id === 'number' && upd.update_id > lastPolledUpdateId) {
          lastPolledUpdateId = upd.update_id;
        }
        await processTelegramBotUpdate(upd, {
          botToken,
          requiredPass: cfg.botPass || 'Muttakin',
          queryAdminId: cfg.adminChatId || '',
          queryBkash: cfg.bkashNumber || '',
          queryNagad: cfg.nagadNumber || '',
        }).catch(() => {});
      }

      setTimeout(runTelegramBotAutoPollingTick, 1000);
    } catch {
      setTimeout(runTelegramBotAutoPollingTick, 4000);
    }
  };

  setTimeout(runTelegramBotAutoPollingTick, 500);

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
