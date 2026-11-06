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

  // In-memory fallback session store for Telegram Redeem Store Bot
  const tgBotMemorySessions = new Map<string, any>();
  const firebaseRtdbBase =
    'https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app';

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

      if (pkgSource && typeof pkgSource === 'object') {
        packages = Object.entries(pkgSource)
          .filter(([k, p]: [string, any]) => k !== 'botAuthToken' && p && typeof p === 'object')
          .map(([id, p]: [string, any]) => ({
            id,
            name: String(p?.name || 'VIP Ad-Free Package'),
            price: String(p?.price || '৳50'),
            durationHours: Number(p?.durationHours) || 168,
            durationLabel: String(p?.durationLabel || `${p?.durationHours || 168} Hours`),
          }))
          .sort((a, b) => a.durationHours - b.durationHours);
      }

      if (packages.length === 0) {
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
            id: 'pkg30d',
            name: '👑 30 Days VIP Ad-Free',
            price: '৳150',
            durationHours: 720,
            durationLabel: '30 Days VIP',
          },
        ];
      }

      memoStoreData = {
        packages,
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

    const saveChatSession = async (chatId: string | number, sessionObj: Record<string, any>) => {
      const key = String(chatId);
      tgBotMemorySessions.set(key, sessionObj);
      await fetch(`${firebaseRtdbBase}/telegramBotSessions/${key}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...sessionObj,
          botAuthToken: 'xtube_tg_bot_2026',
          updatedAt: Date.now(),
        }),
      }).catch(() => {});
    };

    const buildPackagesKeyboard = (packages: Array<any>) => {
      const rows: Array<Array<{ text: string; callback_data?: string; url?: string }>> =
        packages.map((pkg) => [
          {
            text: `🎟️ ${pkg.name} (${pkg.durationLabel}) — ${pkg.price}`,
            callback_data: `buy_pkg_${pkg.id}`,
          },
        ]);
      rows.push([{ text: '🌐 ভিজিট ওয়েবসাইট (X Tube Official)', url: CANONICAL_SITE_URL }]);
      return { inline_keyboard: rows };
    };

    const sendStoreWelcome = async (chatId: string | number, preloadedPackages?: Array<any>) => {
      const packages = preloadedPackages || (await loadStoreData()).packages;
      await tgApi('sendMessage', {
        chat_id: chatId,
        text:
          `👑 <b>X Tube Official — VIP Ad-Free Redeem Code Store</b>-এ স্বাগতম!\n\n` +
          `✨ <b>Redeem Code ব্যবহারের সুবিধা:</b>\n` +
          `• ওয়েবসাইটে কোনো প্রকার বিজ্ঞাপন (Ads / Popunder / Smartlink) আসবে না!\n` +
          `• ১ ক্লিকেই সব Full Video ও Shorts সরাসরি প্লে হবে!\n\n` +
          `👇 <b>নিচের তালিকা থেকে আপনার পছন্দের Ad-Free প্যাকেজটি সিলেক্ট করুন:</b>`,
        parse_mode: 'HTML',
        reply_markup: buildPackagesKeyboard(packages),
      });
    };

    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id;
      const data = String(cb.data || '');
      if (!chatId) return;

      const [{ packages, bkashNumber, nagadNumber, paymentNote }, session] = await Promise.all([
        loadStoreData(),
        getChatSession(chatId),
      ]);

      if (data === 'back_to_packages') {
        await Promise.all([
          saveChatSession(chatId, { ...session, step: 'idle', selectedPkg: null }),
          tgApi('answerCallbackQuery', { callback_query_id: cb.id }),
          sendStoreWelcome(chatId, packages),
        ]);
        return;
      }

      if (data.startsWith('buy_pkg_')) {
        const pkgId = data.replace('buy_pkg_', '');
        const pkg = packages.find((p: any) => p.id === pkgId) || packages[0];
        if (!pkg) return;

        await Promise.all([
          saveChatSession(chatId, {
            ...session,
            step: 'choose_payment',
            selectedPkg: pkg,
          }),
          tgApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: `${pkg.name} সিলেক্ট করা হয়েছে`,
          }),
          tgApi('sendMessage', {
            chat_id: chatId,
            text:
              `📦 <b>সিলেক্ট করা প্যাকেজ:</b> ${escHtml(pkg.name)}\n` +
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
                [{ text: '🔙 অন্য প্যাকেজ দেখুন', callback_data: 'back_to_packages' }],
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
          saveChatSession(chatId, {
            ...session,
            step: 'awaiting_trx',
            selectedPkg: pkg,
            paymentMethod: method,
          }),
          tgApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: `${method} সিলেক্ট হয়েছে`,
          }),
          tgApi('sendMessage', {
            chat_id: chatId,
            text:
              `✅ <b>পেমেন্ট মাধ্যম:</b> ${escHtml(method)}\n` +
              `📦 <b>প্যাকেজ:</b> ${escHtml(pkg.name)} (${escHtml(pkg.durationLabel)})\n` +
              `💰 <b>পরিমাণ:</b> ${escHtml(pkg.price)}\n` +
              `📞 <b>${escHtml(method)} নাম্বার (ট্যাপ করে কপি করুন):</b> <code>${escHtml(targetNumber)}</code>\n\n` +
              `✍️ উপরের নাম্বারে <b>${escHtml(pkg.price)}</b> Send Money করার পর, <b>যে নাম্বার থেকে টাকা পাঠিয়েছেন (Sender Number) এবং Transaction ID (TrxID)</b> নিচে এক লাইনে লিখে মেসেজ পাঠান:\n` +
              `<i>(উদাহরণ: 01712345678 TrxID98765)</i>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 প্যাকেজ পরিবর্তন করুন', callback_data: 'back_to_packages' }],
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
              `🎉 <b>অভিনন্দন! আপনার পেমেন্ট অনুমোদিত হয়েছে!</b> ✅\n\n` +
              `📦 <b>প্যাকেজ:</b> ${escHtml(orderData.packageName)}\n` +
              `🎟️ <b>আপনার VIP Redeem Code (ট্যাপ করে কপি করুন):</b>\n` +
              `<code>${generatedCode}</code>\n\n` +
              `⏰ <b>মেয়াদ শেষ হবে:</b> ${escHtml(expDateStr)} (BD Time)\n\n` +
              `🚀 <b>কিভাবে ব্যবহার করবেন:</b>\n` +
              `১. নিচের বাটনে ক্লিক করে ওয়েবসাইটে যান\n` +
              `২. উপরে <b>🎟️ Redeem Code</b> বাটনে ক্লিক করুন\n` +
              `৩. কোডটি (<code>${generatedCode}</code>) বসিয়ে <b>Activate</b> চাপুন!`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🌐 ওয়েবসাইটে গিয়ে Redeem Code বসান', url: CANONICAL_SITE_URL }],
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
    const text = String(msg.text || '').trim();
    const [{ packages, adminChatId }, session] = await Promise.all([
      loadStoreData(),
      getChatSession(chatId),
    ]);

    if (text === '/myid' || text === '/id') {
      await tgApi('sendMessage', {
        chat_id: chatId,
        text: `🆔 আপনার Telegram Chat ID হলো:\n<code>${chatId}</code>\n\n(এই ID-টি Admin Panel-এর Admin ID বক্সে বসাতে পারবেন)`,
        parse_mode: 'HTML',
      });
      return;
    }

    if (text.startsWith('/start')) {
      await Promise.all([
        saveChatSession(chatId, { ...session, step: 'idle' }),
        sendStoreWelcome(chatId, packages),
      ]);
      return;
    }

    if (session.step === 'awaiting_trx' && session.selectedPkg) {
      if (text.length < 4) {
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: '⚠️ অনুগ্রহ করে আপনার সঠিক পেমেন্ট নাম্বার এবং Transaction ID (TrxID) লিখে পাঠান:',
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
        saveChatSession(chatId, { ...session, step: 'idle', selectedPkg: null }),
      ]);

      await tgApi('sendMessage', {
        chat_id: chatId,
        text:
          `✅ <b>আপনার পেমেন্ট রিকোয়েস্ট সফলভাবে জমা হয়েছে!</b> 🎉\n\n` +
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

    await sendStoreWelcome(chatId);
  };

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
        res.status(200).json({ ok: true, pong: true });
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

  // ==========================================================================
  // 24/7 AUTO-HEALING TELEGRAM BOT POLLING WORKER
  // Automatically detects if the Cloudflare Pages webhook hasn't been deployed
  // yet (or is returning an error), clears the broken webhook, and processes
  // all Telegram Bot updates in real time with zero delay!
  // ==========================================================================
  let lastPolledUpdateId = 0;
  let lastCheckedWebhookToken = '';

  const runTelegramBotAutoPollingTick = async () => {
    try {
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
        setTimeout(runTelegramBotAutoPollingTick, 4000);
        return;
      }

      // Check if Telegram currently has a broken webhook set (e.g. old Cloudflare worker before redeploy)
      if (lastCheckedWebhookToken !== botToken) {
        try {
          const whInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
          const whInfo: any = await whInfoRes.json().catch(() => null);
          const currentWhUrl = String(whInfo?.result?.url || '').trim();
          if (currentWhUrl) {
            let webhookHealthy = false;
            try {
              const pingRes = await fetch(currentWhUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ping: true }),
              });
              const pingData: any = await pingRes.json().catch(() => null);
              if (pingRes.ok && pingData && pingData.pong === true) {
                webhookHealthy = true;
              }
            } catch {}

            if (!webhookHealthy) {
              // Remove broken webhook so getUpdates polling can process messages immediately!
              await fetch(
                `https://api.telegram.org/bot${botToken}/deleteWebhook?drop_pending_updates=false`
              ).catch(() => {});
            } else {
              // Webhook is healthy on Cloudflare Pages; re-check in 15s
              lastCheckedWebhookToken = botToken;
              setTimeout(() => {
                lastCheckedWebhookToken = '';
                runTelegramBotAutoPollingTick();
              }, 15000);
              return;
            }
          }
          lastCheckedWebhookToken = botToken;
        } catch {}
      }

      const updatesRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getUpdates?offset=${
          lastPolledUpdateId + 1
        }&timeout=8&allowed_updates=${encodeURIComponent(
          JSON.stringify(['message', 'edited_message', 'callback_query'])
        )}`
      );
      const updatesData: any = await updatesRes.json().catch(() => null);

      if (!updatesRes.ok || !updatesData?.ok) {
        // If 409 Conflict (webhook was re-set), reset webhook check on next tick
        if (updatesData?.error_code === 409) {
          lastCheckedWebhookToken = '';
        }
        setTimeout(runTelegramBotAutoPollingTick, 2500);
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

      setTimeout(runTelegramBotAutoPollingTick, 400);
    } catch {
      setTimeout(runTelegramBotAutoPollingTick, 3000);
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
