// Cloudflare Pages Advanced Edge Worker (_worker.js) for https://xtubeofficial.pages.dev
// 1. Auto-updates /sitemap.xml, /sitemap-videos.xml, and /sitemap-shorts.xml in real-time from Firebase RTDB
// 2. Auto-handles Google Search Console verification (/google*.html + <meta name="google-site-verification">) & IndexNow
// 3. Server-Side Renders (SSR) dynamic SEO <title>, <meta>, OpenGraph, VideoObject JSON-LD & crawlable video links on /, /?v=, and /?short=

const CANONICAL_SITE_URL = 'https://xtubeofficial.pages.dev';
const DEFAULT_THUMB_URL = 'https://xtubeofficial.pages.dev/favicon.png';
const FIREBASE_RTDB_BASE =
  'https://video-platform-7c031-default-rtdb.asia-southeast1.firebasedatabase.app';

const SEO_CORE_TAGS = [
  'X Tube',
  'X Tube Official',
  'xtubeofficial',
  'xtube',
  'x tube video',
  'x tube shorts',
  'Bangladeshi viral video',
  'bd viral link',
  'বাংলা ভাইরাল ভিডিও',
  'desi viral video',
];

const BROKEN_FILES = ['5_6230929087481782223.mp4', 'VID_20261015_090110_156.mp4'];

const escapeXml = (str) =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const parseDurationSec = (raw, fallbackSec = 210) => {
  if (!raw || typeof raw !== 'string') return fallbackSec;
  const parts = raw
    .trim()
    .split(':')
    .map((n) => parseInt(n, 10));
  if (parts.some((n) => isNaN(n) || n < 0)) return fallbackSec;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) {
    const total = parts[0] * 60 + parts[1];
    return total > 0 ? total : fallbackSec;
  }
  return fallbackSec;
};

const secondsToIsoDuration = (sec) => {
  const s = Math.max(1, Math.floor(Number(sec) || 60));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `PT${mins}M${rem}S`;
};

const resolveValidSeoThumb = (rawThumb) => {
  if (!rawThumb || typeof rawThumb !== 'string') return DEFAULT_THUMB_URL;
  const clean = rawThumb.trim();
  const lower = clean.toLowerCase();
  if (!clean || lower.includes('ibb.co') || lower.includes('imgbb.com')) {
    return DEFAULT_THUMB_URL;
  }
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    return clean;
  }
  return DEFAULT_THUMB_URL;
};

const normalizeShortStreamUrl = (rawUrl, r2Key) => {
  let clean = String(rawUrl || '').trim();
  if (!clean && r2Key) {
    clean = `https://pub-56ae26091320480ca8946ab4e42a051d.r2.dev/${String(r2Key).replace(/^\/+/, '')}`;
  }
  return clean;
};

const extractGoogleVerificationToken = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const metaMatch = s.match(/content=["']([^"']+)["']/i);
  if (metaMatch && metaMatch[1]) return metaMatch[1].trim();
  return s.replace(/^google-site-verification[=:\s]*/i, '').replace(/\.html$/i, '').trim();
};

async function fetchFirebaseData() {
  const [videosRes, shortsRes, seoRes] = await Promise.all([
    fetch(`${FIREBASE_RTDB_BASE}/videos.json`, {
      cf: { cacheTtl: 60, cacheEverything: true },
    }).catch(() => null),
    fetch(`${FIREBASE_RTDB_BASE}/shorts.json`, {
      cf: { cacheTtl: 60, cacheEverything: true },
    }).catch(() => null),
    fetch(`${FIREBASE_RTDB_BASE}/seoConfig.json`, {
      cf: { cacheTtl: 30, cacheEverything: true },
    }).catch(() => null),
  ]);

  const videosData = videosRes && videosRes.ok ? await videosRes.json() : {};
  const shortsData = shortsRes && shortsRes.ok ? await shortsRes.json() : {};
  const seoData = seoRes && seoRes.ok ? await seoRes.json() : {};
  return {
    videosData: videosData && typeof videosData === 'object' ? videosData : {},
    shortsData: shortsData && typeof shortsData === 'object' ? shortsData : {},
    seoData: seoData && typeof seoData === 'object' ? seoData : {},
  };
}

async function generateLiveSitemapXml(mode = 'all') {
  const { videosData, shortsData } = await fetchFirebaseData();
  const todayIso = new Date().toISOString();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`;
  xml += `        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n`;

  xml += `  <url>\n`;
  xml += `    <loc>${CANONICAL_SITE_URL}/</loc>\n`;
  xml += `    <lastmod>${todayIso}</lastmod>\n`;
  xml += `    <changefreq>always</changefreq>\n`;
  xml += `    <priority>1.0</priority>\n`;
  xml += `  </url>\n`;

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

  if (mode === 'all' || mode === 'videos') {
    const videoEntries = Object.entries(videosData).sort(
      (a, b) =>
        (Number(b[1]?.addedAt || b[1]?.createdAt) || 0) -
        (Number(a[1]?.addedAt || a[1]?.createdAt) || 0)
    );

    for (const [id, rawVal] of videoEntries) {
      if (!rawVal || typeof rawVal !== 'object') continue;
      const rawTitle = String(rawVal.title || 'X Tube Official Viral Video').trim();
      const title = rawTitle.toLowerCase().includes('x tube')
        ? rawTitle
        : `${rawTitle} | X Tube Official`;
      const desc = String(
        rawVal.description ||
          `${rawTitle} - Watch exclusive HD viral video on X Tube Official (xtubeofficial.pages.dev, Bangladeshi viral stream).`
      ).trim();
      const thumb = resolveValidSeoThumb(rawVal.thumbnail || rawVal.thumbnailUrl);
      const contentLoc = String(rawVal.url || rawVal.videoUrl || '').trim();
      if (!contentLoc || BROKEN_FILES.some((b) => contentLoc.includes(b))) continue;

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

  if (mode === 'all' || mode === 'shorts') {
    const shortEntries = Object.entries(shortsData).sort(
      (a, b) =>
        (Number(b[1]?.addedAt || b[1]?.createdAt) || 0) -
        (Number(a[1]?.addedAt || a[1]?.createdAt) || 0)
    );

    for (const [id, rawVal] of shortEntries) {
      if (!rawVal || typeof rawVal !== 'object') continue;
      const rawTitle = String(rawVal.title || 'X Tube Official Viral Short').trim();
      const title = rawTitle.toLowerCase().includes('x tube')
        ? rawTitle
        : `${rawTitle} | X Tube Shorts`;
      const hashtags = String(
        rawVal.hashtags || rawVal.keywords || '#Shorts #XTube #BdViral #18Plus'
      ).trim();
      const desc = `${rawTitle} ${hashtags} - Watch viral Short video in HD on X Tube Official (X Tube Shorts, xtubeofficial).`;
      const thumb = resolveValidSeoThumb(rawVal.thumbnail || rawVal.thumbnailUrl);
      const contentLoc = normalizeShortStreamUrl(rawVal.url || rawVal.videoUrl || '', rawVal.r2Key);
      if (!contentLoc || BROKEN_FILES.some((b) => contentLoc.includes(b))) continue;

      const views = Number(rawVal.views) || 0;
      const ts = Number(rawVal.addedAt || rawVal.createdAt) || Date.now();
      const pubIso = new Date(ts).toISOString();
      const durationSec = parseDurationSec(rawVal.duration, 35);
      const pageLoc = `${CANONICAL_SITE_URL}/?short=${encodeURIComponent(id)}`;

      const shortTags = Array.from(
        new Set([
          ...SEO_CORE_TAGS,
          'Shorts',
          'Viral Shorts',
          ...hashtags
            .split(/[,#\s]+/)
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
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 0. Automatic Google Search Console HTML File Verification (/googleXXXX.html) & IndexNow Key
    if (/^\/google[a-zA-Z0-9_-]+\.html$/i.test(path)) {
      const fileName = path.replace(/^\/+/, '');
      return new Response(`google-site-verification: ${fileName}`, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (path === '/xtubeofficial2026.txt') {
      return new Response('xtubeofficial2026', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    // 1. Dynamic Auto-Updating Google Video + Shorts Sitemaps
    if (
      path === '/sitemap.xml' ||
      path === '/sitemap-videos.xml' ||
      path === '/sitemap-shorts.xml'
    ) {
      const mode =
        path === '/sitemap-videos.xml'
          ? 'videos'
          : path === '/sitemap-shorts.xml'
          ? 'shorts'
          : 'all';
      try {
        const { xml } = await generateLiveSitemapXml(mode);
        return new Response(xml, {
          status: 200,
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=60, s-maxage=60',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch {
        return env.ASSETS.fetch(request);
      }
    }

    // 2. Dynamic robots.txt
    if (path === '/robots.txt') {
      const robots = [
        '# X Tube Official - Search Engine Crawler Rules',
        '# Keywords: X Tube, X Tube Official, xtubeofficial, xtube, viral videos, shorts',
        'User-agent: *',
        'Allow: /',
        'Allow: /?v=',
        'Allow: /?short=',
        'Disallow: /ad.html',
        '',
        `Sitemap: ${CANONICAL_SITE_URL}/sitemap.xml`,
        `Sitemap: ${CANONICAL_SITE_URL}/sitemap-videos.xml`,
        `Sitemap: ${CANONICAL_SITE_URL}/sitemap-shorts.xml`,
        '',
      ].join('\n');
      return new Response(robots, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    // 3. Instant Sitemap Refresh & Search Engine Ping Endpoint (/api/refresh-sitemap)
    if (path === '/api/refresh-sitemap') {
      try {
        const { videoCount, shortCount } = await generateLiveSitemapXml('all');
        // Ping IndexNow so Bing/Yandex/Search Engines discover new videos immediately
        fetch(
          `https://www.bing.com/indexnow?url=${encodeURIComponent(
            `${CANONICAL_SITE_URL}/sitemap.xml`
          )}&key=xtubeofficial2026`
        ).catch(() => {});
        return new Response(
          JSON.stringify({
            ok: true,
            site: 'X Tube Official',
            sitemapUrl: `${CANONICAL_SITE_URL}/sitemap.xml`,
            videoCount,
            shortCount,
            updatedAt: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        );
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 3A. Authoritative Server Time, Visitor Ping & 24/7 Bot Auto-Wake (/api/visitor-ping & /api/bot-keepalive)
    if (path === '/api/visitor-ping' || path === '/api/bot-keepalive') {
      const ensureEdgeBotWebhook = async (forceCheck = false) => {
        try {
          const checkCacheKey = `${CANONICAL_SITE_URL}/__tg_bot_keepalive_lock_v1`;
          if (!forceCheck) {
            const cachedLock = await caches.default.match(checkCacheKey).catch(() => null);
            if (cachedLock) return { ok: true, cached: true };
          }
          await caches.default
            .put(
              checkCacheKey,
              new Response('1', { headers: { 'Cache-Control': 'public, max-age=45' } })
            )
            .catch(() => {});

          const [cfgRes, fbRes] = await Promise.all([
            fetch(`${FIREBASE_RTDB_BASE}/redeemStoreConfig.json`).catch(() => null),
            fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions/_storeConfig.json`).catch(() => null),
          ]);
          const cfg1 = cfgRes && cfgRes.ok ? await cfgRes.json().catch(() => null) : null;
          const cfg2 = fbRes && fbRes.ok ? await fbRes.json().catch(() => null) : null;
          const cfg = {
            ...(cfg2 && typeof cfg2 === 'object' ? cfg2 : {}),
            ...(cfg1 && typeof cfg1 === 'object' ? cfg1 : {}),
          };
          const botToken = String(cfg.botToken || '').trim();
          if (!botToken || !botToken.includes(':')) return { ok: false, reason: 'No botToken' };

          const whInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`).catch(
            () => null
          );
          const whInfo = whInfoRes ? await whInfoRes.json().catch(() => null) : null;
          const currentWhUrl = String(whInfo?.result?.url || '').trim();
          const pendingCount = Number(whInfo?.result?.pending_update_count || 0);

          const whObj = new URL(`${CANONICAL_SITE_URL}/api/telegram-bot`);
          whObj.searchParams.set('token', botToken);
          whObj.searchParams.set('pass', String(cfg.botPass || 'Muttakin').trim() || 'Muttakin');
          if (cfg.bkashNumber && cfg.bkashNumber !== 'Not Set') {
            whObj.searchParams.set('bkash', String(cfg.bkashNumber).trim());
          }
          if (cfg.nagadNumber && cfg.nagadNumber !== 'Not Set') {
            whObj.searchParams.set('nagad', String(cfg.nagadNumber).trim());
          }
          if (cfg.adminChatId) {
            whObj.searchParams.set('adminId', String(cfg.adminChatId).trim());
          }
          const targetWebhookUrl = whObj.toString();

          if (!currentWhUrl || !currentWhUrl.startsWith(`${CANONICAL_SITE_URL}/api/telegram-bot`)) {
            await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: targetWebhookUrl,
                allowed_updates: ['message', 'edited_message', 'callback_query'],
                drop_pending_updates: false,
              }),
            }).catch(() => {});
          }
          return { ok: true, mode: 'webhook_24_7', pendingCount };
        } catch {
          return { ok: false };
        }
      };

      if (path === '/api/bot-keepalive') {
        const status = await ensureEdgeBotWebhook(true);
        return new Response(
          JSON.stringify({
            ok: true,
            ...status,
            serverTime: Date.now(),
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
            },
          }
        );
      }

      if (typeof ctx !== 'undefined' && ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(ensureEdgeBotWebhook(false));
      } else {
        ensureEdgeBotWebhook(false).catch(() => {});
      }

      return new Response(
        JSON.stringify({
          ok: true,
          serverTime: Date.now(),
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    // 3B. Telegram Bot Redeem Code Store & Order System (/api/telegram-bot)
    // Flow:
    // - User sends /start -> Shows Ad-Free Redeem Code Packages from Firebase (`redeemPackages`)
    // - User selects Package -> Shows bKash & Nagad Numbers -> User selects bKash/Nagad & sends Sender Number + TrxID
    // - Order saved to Firebase (`redeemOrders`) -> Shows in Admin Panel (/ad.html) + Notifies Admin on Telegram
    // - Admin can 1-Click Generate & Send Redeem Code to User from Admin Panel OR directly from Telegram!
    if (path === '/api/telegram-bot') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }

      if (request.method === 'GET') {
        return new Response(
          JSON.stringify({
            ok: true,
            service: 'X Tube Official Redeem Code Store Bot Webhook',
            domain: CANONICAL_SITE_URL,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        );
      }

      try {
        const update = await request.json();
        if (update && update.ping === true) {
          return new Response(JSON.stringify({ ok: true, pong: true, riyaVersion: 2 }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
        const botToken = (url.searchParams.get('token') || '').trim();
        const requiredPass = (url.searchParams.get('pass') || 'Muttakin').trim();
        const queryAdminId = (url.searchParams.get('adminId') || '').trim();
        const queryBkash = (url.searchParams.get('bkash') || '').trim();
        const queryNagad = (url.searchParams.get('nagad') || '').trim();

        if (!botToken) {
          return new Response(JSON.stringify({ ok: false, error: 'Missing bot token' }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }

        const escHtml = (str) =>
          String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const tgApi = async (method, payload) => {
          const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          return res.json().catch(() => ({}));
        };

        const runInBackground = (promise) => {
          if (typeof ctx !== 'undefined' && ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(promise.catch(() => {}));
          } else {
            promise.catch(() => {});
          }
        };

        // Fast Edge-Cached Store Data Loader (10s cache + fallback to telegramBotSessions/_storeConfig)
        let memoStoreData = null;
        const loadStoreData = async (forceFresh = false) => {
          if (memoStoreData && !forceFresh) return memoStoreData;
          const storeCacheKey = `${CANONICAL_SITE_URL}/__tg_store_cfg_cache_v4`;
          if (!forceFresh) {
            try {
              const cached = await caches.default.match(storeCacheKey);
              if (cached) {
                const parsed = await cached.json();
                if (parsed && Array.isArray(parsed.packages)) {
                  memoStoreData = parsed;
                  return parsed;
                }
              }
            } catch {}
          }

          const [pkgRes, cfgRes, fallbackCfgRes] = await Promise.all([
            fetch(`${FIREBASE_RTDB_BASE}/redeemPackages.json`).catch(() => null),
            fetch(`${FIREBASE_RTDB_BASE}/redeemStoreConfig.json`).catch(() => null),
            fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions/_storeConfig.json`).catch(() => null),
          ]);

          const rawPkgs = pkgRes && pkgRes.ok ? await pkgRes.json().catch(() => null) : null;
          const rawCfg = cfgRes && cfgRes.ok ? await cfgRes.json().catch(() => null) : null;
          const fbCfg =
            fallbackCfgRes && fallbackCfgRes.ok
              ? await fallbackCfgRes.json().catch(() => null)
              : null;

          const mergedCfg = {
            ...(fbCfg && typeof fbCfg === 'object' ? fbCfg : {}),
            ...(rawCfg && typeof rawCfg === 'object' ? rawCfg : {}),
          };

          const serviceEnabled = mergedCfg.serviceEnabled !== false;
          const aiAssistantEnabled = mergedCfg.aiAssistantEnabled !== false;

          const pkgSource =
            rawPkgs && typeof rawPkgs === 'object' && Object.keys(rawPkgs).length > 0
              ? rawPkgs
              : mergedCfg.packages && typeof mergedCfg.packages === 'object'
              ? mergedCfg.packages
              : null;

          let packages = [];
          if (serviceEnabled && pkgSource && typeof pkgSource === 'object') {
            packages = Object.entries(pkgSource)
              .filter(
                ([k, p]) => k !== 'botAuthToken' && p && typeof p === 'object' && p.active !== false
              )
              .map(([id, p]) => ({
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

          const result = {
            serviceEnabled,
            aiAssistantEnabled,
            geminiApiKey: String(mergedCfg.geminiApiKey || env?.GEMINI_API_KEY || '').trim(),
            customRiyaPrompt: String(mergedCfg.customRiyaPrompt || '').trim(),
            packages: serviceEnabled ? packages : [],
            bkashNumber: mergedCfg.bkashNumber || queryBkash || 'Not Set (Ask Admin)',
            nagadNumber: mergedCfg.nagadNumber || queryNagad || 'Not Set (Ask Admin)',
            paymentNote:
              mergedCfg.paymentNote ||
              'Send Money করার পর নিচের বাটনে ক্লিক করে আপনার নাম্বার ও TrxID পাঠান।',
            adminChatId: String(mergedCfg.adminChatId || queryAdminId || '').trim(),
            botPass: String(mergedCfg.botPass || requiredPass || 'Muttakin').trim(),
          };

          memoStoreData = result;
          runInBackground(
            caches.default.put(
              storeCacheKey,
              new Response(JSON.stringify(result), {
                headers: {
                  'Content-Type': 'application/json',
                  'Cache-Control': 'public, max-age=2',
                },
              })
            )
          );
          return result;
        };

        const getChatSession = async (chatId) => {
          const cacheKeyUrl = `${CANONICAL_SITE_URL}/__tg_store_session_${chatId}`;
          try {
            const cached = await caches.default.match(cacheKeyUrl);
            if (cached) {
              const data = await cached.json();
              if (data && typeof data === 'object') return data;
            }
          } catch {}
          try {
            const fbRes = await fetch(
              `${FIREBASE_RTDB_BASE}/telegramBotSessions/${chatId}.json`
            );
            if (fbRes.ok) {
              const fbData = await fbRes.json();
              if (fbData && typeof fbData === 'object') return fbData;
            }
          } catch {}
          return { step: 'idle', isAdmin: false };
        };

        const saveChatSession = async (chatId, sessionObj, fromUser = null) => {
          const key = String(chatId);
          const fullName = fromUser
            ? [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ').trim()
            : sessionObj.fullName || '';
          const username = fromUser?.username
            ? String(fromUser.username).replace(/^@/, '').trim()
            : sessionObj.username || '';
          const cacheKeyUrl = `${CANONICAL_SITE_URL}/__tg_store_session_${key}`;
          const payload = {
            ...sessionObj,
            chatId: key,
            ...(fullName ? { fullName } : {}),
            ...(username ? { username } : {}),
            botAuthToken: 'xtube_tg_bot_2026',
            updatedAt: Date.now(),
          };
          await Promise.all([
            caches.default
              .put(
                cacheKeyUrl,
                new Response(JSON.stringify(payload), {
                  headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=604800',
                  },
                })
              )
              .catch(() => {}),
            fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions/${key}.json`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }).catch(() => {}),
            fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions/_subscribers/${key}.json`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chatId: key,
                fullName: fullName || 'Telegram User',
                username,
                lang: payload.lang || 'bn',
                lastActiveAt: Date.now(),
                botAuthToken: 'xtube_tg_bot_2026',
              }),
            }).catch(() => {}),
          ]);
        };

        const resolveUserLang = (session, fromUser) => {
          const saved = String(session?.lang || '').toLowerCase().trim();
          if (saved === 'en') return 'en';
          if (saved === 'bn') return 'bn';
          const tgCode = String(fromUser?.language_code || '').toLowerCase().trim();
          if (tgCode.startsWith('en')) return 'en';
          return 'bn';
        };

        const decodeTgStartId = (encoded) =>
          String(encoded || '')
            .trim()
            .replace(/__d__/g, '.')
            .replace(/_D_/g, '.')
            .replace(/_P_/g, '+')
            .replace(/_x([0-9a-fA-F]{2})_/g, (_, hex) => {
              try {
                return String.fromCharCode(parseInt(hex, 16));
              } catch {
                return '';
              }
            });

        const buildUserWebAppUrl = (basePathQuery, userObj, lang = 'bn') => {
          const uid = String(userObj?.id || '').trim();
          const fullName =
            [userObj?.first_name, userObj?.last_name].filter(Boolean).join(' ').trim() ||
            'Telegram User';
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

        const buildPackagesKeyboard = (packages, userObj, lang = 'bn') => {
          const miniAppHomeUrl = buildUserWebAppUrl('/', userObj, lang);
          const isEn = lang === 'en';
          const rows = [
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
          chatId,
          preloadedPackages = null,
          userObj = null,
          lang = 'bn'
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

        const collectAllSubscriberChatIds = async () => {
          const [sessRes, subRes, ordRes] = await Promise.all([
            fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions.json`).catch(() => null),
            fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions/_subscribers.json`).catch(() => null),
            fetch(`${FIREBASE_RTDB_BASE}/redeemOrders.json`).catch(() => null),
          ]);
          const sessData = sessRes && sessRes.ok ? await sessRes.json().catch(() => null) : null;
          const subData = subRes && subRes.ok ? await subRes.json().catch(() => null) : null;
          const ordData = ordRes && ordRes.ok ? await ordRes.json().catch(() => null) : null;

          const idSet = new Set();
          const addValidChatId = (raw) => {
            const s = String(raw || '').trim();
            if (/^-?\d{5,20}$/.test(s)) idSet.add(s);
          };

          if (sessData && typeof sessData === 'object') {
            for (const [k, val] of Object.entries(sessData)) {
              if (k.startsWith('_') || k === 'botAuthToken') continue;
              addValidChatId(k);
              if (val && typeof val === 'object') addValidChatId(val.chatId);
            }
          }
          if (subData && typeof subData === 'object') {
            for (const [k, val] of Object.entries(subData)) {
              if (k.startsWith('_') || k === 'botAuthToken') continue;
              addValidChatId(k);
              if (val && typeof val === 'object') addValidChatId(val.chatId);
            }
          }
          if (ordData && typeof ordData === 'object') {
            for (const val of Object.values(ordData)) {
              if (val && typeof val === 'object') addValidChatId(val.chatId);
            }
          }
          return Array.from(idSet);
        };

        // Handle Callback Queries (Language Toggle, Package Selection, Payment Method Selection, Admin 1-Click Approve/Reject)
        if (update.callback_query) {
          const cb = update.callback_query;
          const chatId = cb.message?.chat?.id;
          const data = String(cb.data || '');
          if (!chatId) return new Response('OK', { status: 200 });

          const [{ serviceEnabled, packages, bkashNumber, nagadNumber, paymentNote }, session] =
            await Promise.all([loadStoreData(), getChatSession(chatId)]);
          const userLang = resolveUserLang(session, cb.from);
          const isEn = userLang === 'en';

          if (data === 'toggle_bot_lang') {
            const nextLang = userLang === 'bn' ? 'en' : 'bn';
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
            return new Response('OK', { status: 200 });
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
            return new Response('OK', { status: 200 });
          }

          if (data === 'back_to_packages') {
            await Promise.all([
              saveChatSession(
                chatId,
                { ...session, step: 'idle', selectedPkg: null, lang: userLang },
                cb.from
              ),
              tgApi('answerCallbackQuery', { callback_query_id: cb.id }),
              sendStoreWelcome(chatId, packages, cb.from || { id: chatId }, userLang),
            ]);
            return new Response('OK', { status: 200 });
          }

          if (data.startsWith('buy_pkg_')) {
            const pkgId = data.replace('buy_pkg_', '');
            const pkg = packages.find((p) => p.id === pkgId) || packages[0];
            if (!pkg) return new Response('OK', { status: 200 });

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
            return new Response('OK', { status: 200 });
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
            return new Response('OK', { status: 200 });
          }

          // Admin 1-Click Approve & Auto-Send Redeem Code directly inside Telegram
          if (data.startsWith('admin_approve_')) {
            const orderId = data.replace('admin_approve_', '');
            const [orderRes, fbOrderRes] = await Promise.all([
              fetch(`${FIREBASE_RTDB_BASE}/redeemOrders/${encodeURIComponent(orderId)}.json`).catch(() => null),
              fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions/_orders/${encodeURIComponent(orderId)}.json`).catch(() => null),
            ]);
            const o1 = orderRes && orderRes.ok ? await orderRes.json().catch(() => null) : null;
            const o2 = fbOrderRes && fbOrderRes.ok ? await fbOrderRes.json().catch(() => null) : null;
            const orderData = o1 && o1.chatId ? o1 : o2;

            if (!orderData || !orderData.chatId) {
              await tgApi('answerCallbackQuery', {
                callback_query_id: cb.id,
                text: '❌ অর্ডারটি পাওয়া যায়নি!',
                show_alert: true,
              });
              return new Response('OK', { status: 200 });
            }

            const now = Date.now();
            const durationHours = Number(orderData.durationHours) || 168;
            const expiresAt = now + durationHours * 3600 * 1000;
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            const pick = (len) =>
              Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
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
              fetch(`${FIREBASE_RTDB_BASE}/redeemCodes/${generatedCode}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(codePayload),
              }).catch(() => {}),
              fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions/_codes/${generatedCode}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(codePayload),
              }).catch(() => {}),
              fetch(`${FIREBASE_RTDB_BASE}/redeemOrders/${encodeURIComponent(orderId)}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedOrderPayload),
              }).catch(() => {}),
              fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions/_orders/${encodeURIComponent(orderId)}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedOrderPayload),
              }).catch(() => {}),
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
            return new Response('OK', { status: 200 });
          }

          if (data.startsWith('admin_reject_')) {
            const orderId = data.replace('admin_reject_', '');
            const [orderRes, fbOrderRes] = await Promise.all([
              fetch(`${FIREBASE_RTDB_BASE}/redeemOrders/${encodeURIComponent(orderId)}.json`).catch(() => null),
              fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions/_orders/${encodeURIComponent(orderId)}.json`).catch(() => null),
            ]);
            const o1 = orderRes && orderRes.ok ? await orderRes.json().catch(() => null) : null;
            const o2 = fbOrderRes && fbOrderRes.ok ? await fbOrderRes.json().catch(() => null) : null;
            const orderData = o1 && o1.chatId ? o1 : o2;

            if (orderData && orderData.chatId) {
              const rejPayload = {
                ...orderData,
                status: 'rejected',
                rejectedAt: Date.now(),
                botAuthToken: 'xtube_tg_bot_2026',
              };
              await Promise.all([
                fetch(`${FIREBASE_RTDB_BASE}/redeemOrders/${encodeURIComponent(orderId)}.json`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(rejPayload),
                }).catch(() => {}),
                fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions/_orders/${encodeURIComponent(orderId)}.json`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(rejPayload),
                }).catch(() => {}),
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
            return new Response('OK', { status: 200 });
          }

          return new Response('OK', { status: 200 });
        }

        const msg = update.message || update.edited_message;
        if (!msg || !msg.chat) {
          return new Response('OK', { status: 200 });
        }

        const chatId = msg.chat.id;
        const text = String(msg.text || msg.caption || '').trim();
        const [storeData, session] = await Promise.all([
          loadStoreData(),
          getChatSession(chatId),
        ]);
        const { packages, adminChatId } = storeData;
        const userLang = resolveUserLang(session, msg.from);
        const isEn = userLang === 'en';

        runInBackground(saveChatSession(chatId, { ...session, lang: userLang }, msg.from));

        // /myid command so Admin can see their Chat ID easily
        if (text === '/myid' || text === '/id') {
          await tgApi('sendMessage', {
            chat_id: chatId,
            text: isEn
              ? `🆔 Your Telegram Chat ID is:\n<code>${chatId}</code>\n\n(You can paste this ID into the Admin ID box in the Admin Panel)`
              : `🆔 আপনার Telegram Chat ID হলো:\n<code>${chatId}</code>\n\n(এই ID-টি Admin Panel-এর Admin ID বক্সে বসাতে পারবেন)`,
            parse_mode: 'HTML',
          });
          return new Response('OK', { status: 200 });
        }

        // Admin Broadcast command directly inside Telegram Bot: `/broadcast <message>`
        if (text.startsWith('/broadcast')) {
          const targetAdmin = String(adminChatId || queryAdminId || '').trim();
          if (targetAdmin && String(chatId) !== targetAdmin) {
            await tgApi('sendMessage', {
              chat_id: chatId,
              text: '⛔ শুধুমাত্র Admin এই কমান্ড ব্যবহার করতে পারবেন!',
            });
            return new Response('OK', { status: 200 });
          }
          const bcastText = text.replace(/^\/broadcast\s*/i, '').trim();
          const replyMsg = msg.reply_to_message;
          if (!bcastText && !replyMsg) {
            await tgApi('sendMessage', {
              chat_id: chatId,
              text:
                `📢 <b>Broadcast পাঠানোর নিয়ম:</b>\n\n` +
                `১. যেকোনো মেসেজ লিখুন:\n<code>/broadcast আপনার মেসেজ এখানে লিখুন</code>\n\n` +
                `২. অথবা যেকোনো ছবি/ভিডিও/মেসেজে <b>Reply</b> দিয়ে লিখুন <code>/broadcast</code> — তাহলে সেটি সব ইউজারের কাছে চলে যাবে!`,
              parse_mode: 'HTML',
            });
            return new Response('OK', { status: 200 });
          }

          const allChatIds = await collectAllSubscriberChatIds();
          let sentCount = 0;
          let failCount = 0;
          const miniAppUrl = buildUserWebAppUrl('/', null, 'bn');

          for (const targetId of allChatIds) {
            try {
              if (replyMsg && replyMsg.message_id) {
                const copyRes = await tgApi('copyMessage', {
                  chat_id: targetId,
                  from_chat_id: chatId,
                  message_id: replyMsg.message_id,
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '📱 Open X Tube Mini App', web_app: { url: miniAppUrl } }],
                    ],
                  },
                });
                if (copyRes && copyRes.ok) sentCount++;
                else failCount++;
              } else {
                const sendRes = await tgApi('sendMessage', {
                  chat_id: targetId,
                  text: bcastText,
                  parse_mode: 'HTML',
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '📱 Open X Tube Mini App', web_app: { url: miniAppUrl } }],
                    ],
                  },
                });
                if (sendRes && sendRes.ok) sentCount++;
                else failCount++;
              }
            } catch {
              failCount++;
            }
          }

          await tgApi('sendMessage', {
            chat_id: chatId,
            text:
              `✅ <b>Broadcast সফলভাবে সম্পন্ন হয়েছে!</b>\n\n` +
              `👥 মোট ইউজার: <b>${allChatIds.length}</b>\n` +
              `✉️ সফলভাবে গেছে: <b>${sentCount}</b>\n` +
              `⚠️ ব্যর্থ/ব্লকড: <b>${failCount}</b>`,
            parse_mode: 'HTML',
          });
          return new Response('OK', { status: 200 });
        }

        if (text === '/lang' || text === '/language') {
          const nextLang = userLang === 'bn' ? 'en' : 'bn';
          await Promise.all([
            saveChatSession(chatId, { ...session, lang: nextLang }, msg.from),
            sendStoreWelcome(chatId, packages, msg.from || { id: chatId }, nextLang),
          ]);
          return new Response('OK', { status: 200 });
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
          return new Response('OK', { status: 200 });
        }

        // /start command -> Handle shared video deep-link (`vid_<id>` or `short_<id>`) OR show Mini App + Packages
        if (text.startsWith('/start')) {
          const startArg = text.replace(/^\/start\s*/i, '').trim();
          if (startArg) {
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
                fetch(`${FIREBASE_RTDB_BASE}/videos/${encodeURIComponent(rawTargetId)}.json`).catch(() => null),
                fetch(`${FIREBASE_RTDB_BASE}/shorts/${encodeURIComponent(rawTargetId)}.json`).catch(() => null),
                altId !== rawTargetId
                  ? fetch(`${FIREBASE_RTDB_BASE}/videos/${encodeURIComponent(altId)}.json`).catch(() => null)
                  : Promise.resolve(null),
                altId !== rawTargetId
                  ? fetch(`${FIREBASE_RTDB_BASE}/shorts/${encodeURIComponent(altId)}.json`).catch(() => null)
                  : Promise.resolve(null),
              ]);
              const vData = vRes && vRes.ok ? await vRes.json().catch(() => null) : null;
              const sData = sRes && sRes.ok ? await sRes.json().catch(() => null) : null;
              const vAltData = vAltRes && vAltRes.ok ? await vAltRes.json().catch(() => null) : null;
              const sAltData = sAltRes && sAltRes.ok ? await sAltRes.json().catch(() => null) : null;

              let matchedId = rawTargetId;
              let mediaItem = vData || sData;
              if (!mediaItem && (vAltData || sAltData)) {
                matchedId = altId;
                mediaItem = vAltData || sAltData;
              }
              if ((!vData && sData) || (!vData && !sData && !vAltData && sAltData)) {
                isShortLink = true;
              }

              const videoTitle = String(mediaItem?.title || 'Exclusive Viral Video 🔥').trim();
              const videoDuration = String(mediaItem?.duration || '').trim();
              const miniAppWatchUrl = buildUserWebAppUrl(
                isShortLink
                  ? `/?short=${encodeURIComponent(matchedId)}`
                  : `/?v=${encodeURIComponent(matchedId)}`,
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
                }).catch(() => null),
                tgApi('sendMessage', {
                  chat_id: chatId,
                  text: isEn
                    ? `🎬 <b>${escHtml(videoTitle)}</b>${videoDuration ? ` (${escHtml(videoDuration)})` : ''}\n\n` +
                      `👇 Tap <b>▶️ Watch Video Now</b> below to open the Mini App and complete the 3-Step Verification to play this video:`
                    : `🎬 <b>${escHtml(videoTitle)}</b>${videoDuration ? ` (${escHtml(videoDuration)})` : ''}\n\n` +
                      `👇 নিচের <b>▶️ Watch Video Now</b> বাটনে ট্যাপ করলে সরাসরি Mini App ওপেন হবে এবং ৩টি ধাপ সম্পন্ন করলেই এই ভিডিওটি চালু হবে:`,
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
              return new Response('OK', { status: 200 });
            }
          }

          await Promise.all([
            saveChatSession(
              chatId,
              {
                ...session,
                lang: userLang,
                step: 'idle',
                pendingVideoId: null,
                pendingAt: null,
              },
              msg.from
            ),
            sendStoreWelcome(chatId, packages, msg.from || { id: chatId }, userLang),
          ]);
          return new Response('OK', { status: 200 });
        }

        // Silent Package Purchase Flow ("pacage pucharse korar somoy kono khota bolbe na")
        if (
          (session.step === 'awaiting_trx' || session.step === 'choose_payment') &&
          session.selectedPkg
        ) {
          if (session.step === 'choose_payment' && !/\d{5,}/.test(text)) {
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
            return new Response('OK', { status: 200 });
          }

          if (text.length < 4) {
            await tgApi('sendMessage', {
              chat_id: chatId,
              text: isEn
                ? '⚠️ Please send your valid Sender Number and Transaction ID (TrxID):'
                : '⚠️ অনুগ্রহ করে আপনার সঠিক পেমেন্ট নাম্বার এবং Transaction ID (TrxID) লিখে পাঠান:',
            });
            return new Response('OK', { status: 200 });
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

          // Save to both redeemOrders and telegramBotSessions/_orders so it works even before Firebase Rules are updated!
          await Promise.all([
            fetch(`${FIREBASE_RTDB_BASE}/redeemOrders/${encodeURIComponent(orderId)}.json`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(orderPayload),
            }).catch(() => {}),
            fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions/_orders/${encodeURIComponent(orderId)}.json`, {
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

          // Notify Admin on Telegram if adminChatId is configured
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

          return new Response('OK', { status: 200 });
        }

        // Riya Aktar (রিয়া আক্তার) — All-Time Romantic Chat, Video Suggestion & Live Package Reader
        if (storeData.aiAssistantEnabled !== false) {
          await tgApi('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
          const userFullName =
            [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ').trim() || 'জানু';
          const lower = (text || '').toLowerCase();
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

          let replyText = '';
          if (isAskingDeveloper) {
            replyText = `আমি তো রক্ত-মাংসের মানুষ ভাই, আমার কোনো ডেভেলপার নাই! 😒🙈 আমার নাম Riya Aktar (রিয়া আক্তার)। আসো না জানু, এসব বাদ দিয়ে নিচের বাটনে ক্লিক করে আমার সাথে নতুন ভাইরাল ভিডিওগুলো দেখো সোনা! 😘🔥`;
          } else if (isAskingName) {
            replyText = `আমার নাম Riya Aktar (রিয়া আক্তার) জানু! 💕 তোমার সাথে কথা বলতে আমার ভীষণ ভালো লাগছে সোনা। নিচের বাটনে ট্যাপ করে আমাদের অ্যাপের নতুন হট ভিডিওগুলো দেখে আসো না বাবু! 😘🔥`;
          } else if (isAskingHome) {
            replyText = `উফফ দুষ্টু, বাসার ঠিকানা কি এভাবে শুরুতেই কাউকে বলা যায় নাকি? 🙈 ওটা না হয় সিক্রেটই থাকুক জানু! তার চেয়ে নিচের বাটনে ক্লিক করে নতুন ভাইরাল ভিডিওগুলো দেখো সোনা, মনটা একদম ভালো হয়ে যাবে 😘❤️`;
          } else if (isAskingAboutPackages) {
            if (!storeData.serviceEnabled || !packages || packages.length === 0) {
              replyText = `জানু, এখন আমাদের VIP Package ও Redeem Code সার্ভিসটি সাময়িকভাবে বন্ধ (OFF) আছে সোনা 🥺। তবে একদম মন খারাপ করো না বাবু, নিচের বাটনে ক্লিক করে অ্যাপের ভেতর সব নতুন ভাইরাল ভিডিওগুলো দেখে নাও! 😘🔥`;
            } else {
              const pkgLines = packages
                .map((p, idx) => `✨ ${idx + 1}. ${p.name} (${p.durationLabel}) — মাত্র ${p.price}`)
                .join('\n');
              replyText =
                `জানু, তুমি আমাদের Ad-Free VIP Package নিতে চাও? 😍 আমাদের প্যাকেজ সার্ভিস এখন চালু (ON) আছে সোনা! নিচে আমাদের সবগুলো প্যাকেজ দেখে নাও:\n\n` +
                `${pkgLines}\n\n` +
                `👇 নিচের যেকোনো প্যাকেজ বাটনে ট্যাপ করে bKash (${storeData.bkashNumber}) বা Nagad (${storeData.nagadNumber}) দিয়ে পেমেন্ট করলেই সাথে সাথে VIP Redeem Code পেয়ে যাবে জানু, আর কোনো অ্যাড ছাড়াই সব ভিডিও দেখতে পারবে! 😘🔥`;
            }
          }

          if (!replyText && storeData.geminiApiKey && storeData.geminiApiKey.length > 10) {
            try {
              const packageContext =
                storeData.serviceEnabled && packages && packages.length > 0
                  ? `বর্তমানে VIP Package সার্ভিস চালু (ON) আছে। প্যাকেজগুলো: ` +
                    packages.map((p) => `${p.name} (${p.durationLabel}) - দাম ${p.price}`).join(', ')
                  : `বর্তমানে VIP Package সার্ভিস বন্ধ (OFF) আছে।`;
              const sysPrompt =
                `তোমার নাম "Riya Aktar" (রিয়া আক্তার)। তুমি একজন মিষ্টি, রোমান্টিক ও আকর্ষণীয় বাংলাদেশি তরুণী। ` +
                `কেউ নাম জিজ্ঞেস করলে Riya Aktar বলবে। কখনোই নিজেকে AI বা Bot বলবে না। ` +
                `কেউ ডেভেলপার সম্পর্কে জিজ্ঞেস করলে বলবে "আমি মানুষ ভাই, আমার কোনো ডেভেলপার নাই!"। ` +
                `কেউ বাসা কোথায় জিজ্ঞেস করলে ঠিকানা বলবে না। ` +
                `সবসময় "${userFullName}"-এর সাথে রোমান্টিক কথা বলবে (জানু, সোনা, বাবু বলে) এবং নিচের বাটনে ক্লিক করে আমাদের মিনি অ্যাপে ভাইরাল ভিডিও দেখতে বলবে। ` +
                `${packageContext}`;
              const gemRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(storeData.geminiApiKey)}`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'aistudio-build',
                  },
                  body: JSON.stringify({
                    systemInstruction: { parts: [{ text: sysPrompt }] },
                    contents: [{ role: 'user', parts: [{ text: text || 'হাই' }] }],
                  }),
                }
              );
              if (gemRes.ok) {
                const gemData = await gemRes.json().catch(() => null);
                const candidateText =
                  gemData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (candidateText) {
                  replyText = String(candidateText)
                    .replace(/\b(AI|A\.I\.|artificial intelligence|language model|Gemini|Google)\b/gi, 'মানুষ')
                    .trim();
                }
              }
            } catch {}
          }

          if (!replyText) {
            const romanticTemplates = [
              `হাই ${userFullName} জানু! 😘 কেমন আছো সোনা? তোমাকে ভীষণ মিস করছিলাম বাবু 💕। নিচের বাটনে ট্যাপ করে আমাদের অ্যাপের নতুন হট ও ভাইরাল ভিডিওগুলো দেখে আসো না সোনা! 🔥`,
              `উম্মাহ্ ${userFullName} সোনা! ❤️ এত কিউট করে কথা বললে তো তোমার প্রেমে পড়ে যাবো জানু 🙈। নিচের বাটনে ক্লিক করে নতুন ভাইরাল ভিডিওগুলো দেখে নাও বাবু! 😘`,
              `এই দুষ্টু ${userFullName} বাবু! 💕 একা একা কী করছো বলো তো? আমার সাথে একটু দুষ্টু-মিষ্টি গল্প করো আর নিচের বাটনে ক্লিক করে নতুন ভাইরাল ভিডিওগুলো দেখো জানু! 🔥😘`,
            ];
            replyText = romanticTemplates[Math.floor(Math.random() * romanticTemplates.length)];
          }

          const miniAppHomeUrl = buildUserWebAppUrl('/', msg.from || { id: chatId }, userLang);
          const replyMarkup =
            storeData.serviceEnabled && isAskingAboutPackages && packages.length > 0
              ? buildPackagesKeyboard(packages, msg.from || { id: chatId }, userLang)
              : {
                  inline_keyboard: [
                    [
                      {
                        text: isEn
                          ? '📱 Open X Tube Mini App (Watch Videos) 🔥'
                          : '📱 X Tube Mini App খুলুন (ভিডিও দেখুন) 🔥',
                        web_app: { url: miniAppHomeUrl },
                      },
                    ],
                  ],
                };

          await tgApi('sendMessage', {
            chat_id: chatId,
            text: escHtml(replyText),
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
          });
          return new Response('OK', { status: 200 });
        }

        // Default fallback: show packages
        await sendStoreWelcome(chatId, packages, msg.from || { id: chatId }, userLang);
        return new Response('OK', { status: 200 });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 3B2. Telegram Broadcast Endpoint (/api/telegram-broadcast)
    if (path === '/api/telegram-broadcast') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }
      try {
        const body = await request.json();
        const [fbRes1, fbRes2] = await Promise.all([
          fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions/_storeConfig.json`).catch(() => null),
          fetch(`${FIREBASE_RTDB_BASE}/redeemStoreConfig.json`).catch(() => null),
        ]);
        const cfg1 = fbRes1 && fbRes1.ok ? await fbRes1.json().catch(() => null) : null;
        const cfg2 = fbRes2 && fbRes2.ok ? await fbRes2.json().catch(() => null) : null;
        const botToken = String(body.botToken || cfg2?.botToken || cfg1?.botToken || '').trim();
        const messageText = String(body.message || '').trim();
        const imageUrl = String(body.imageUrl || '').trim();
        const buttonText = String(body.buttonText || '📱 Open X Tube Mini App').trim();
        const buttonUrl = String(body.buttonUrl || CANONICAL_SITE_URL).trim();

        if (!botToken || !botToken.includes(':')) {
          return new Response(JSON.stringify({ ok: false, error: 'Missing Bot Token' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }

        const [sessRes, subRes, ordRes] = await Promise.all([
          fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions.json`).catch(() => null),
          fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions/_subscribers.json`).catch(() => null),
          fetch(`${FIREBASE_RTDB_BASE}/redeemOrders.json`).catch(() => null),
        ]);
        const sessData = sessRes && sessRes.ok ? await sessRes.json().catch(() => null) : null;
        const subData = subRes && subRes.ok ? await subRes.json().catch(() => null) : null;
        const ordData = ordRes && ordRes.ok ? await ordRes.json().catch(() => null) : null;

        const idSet = new Set();
        const addId = (raw) => {
          const s = String(raw || '').trim();
          if (/^-?\d{5,20}$/.test(s)) idSet.add(s);
        };
        if (Array.isArray(body.chatIds)) body.chatIds.forEach(addId);
        if (sessData && typeof sessData === 'object') {
          for (const [k, val] of Object.entries(sessData)) {
            if (k.startsWith('_') || k === 'botAuthToken') continue;
            addId(k);
            if (val && typeof val === 'object') addId(val.chatId);
          }
        }
        if (subData && typeof subData === 'object') {
          for (const [k, val] of Object.entries(subData)) {
            if (k.startsWith('_') || k === 'botAuthToken') continue;
            addId(k);
            if (val && typeof val === 'object') addId(val.chatId);
          }
        }
        if (ordData && typeof ordData === 'object') {
          for (const val of Object.values(ordData)) {
            if (val && typeof val === 'object') addId(val.chatId);
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
            const payload = imageUrl
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
            const tgJson = await tgResp.json().catch(() => null);
            if (tgResp.ok && tgJson?.ok) sentCount++;
            else failCount++;
          } catch {
            failCount++;
          }
        }

        return new Response(
          JSON.stringify({ ok: true, totalUsers: allChatIds.length, sentCount, failCount }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          }
        );
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // 3C. Telegram User Avatar Proxy (/api/tg-avatar?userId=...)
    if (path === '/api/tg-avatar') {
      const userId = (url.searchParams.get('userId') || '').trim();
      if (!userId || !/^\d+$/.test(userId)) {
        return new Response(null, { status: 404 });
      }
      try {
        const [fbRes1, fbRes2] = await Promise.all([
          fetch(`${FIREBASE_RTDB_BASE}/telegramBotSessions/_storeConfig.json`).catch(() => null),
          fetch(`${FIREBASE_RTDB_BASE}/redeemStoreConfig.json`).catch(() => null),
        ]);
        const cfg1 = fbRes1 && fbRes1.ok ? await fbRes1.json().catch(() => null) : null;
        const cfg2 = fbRes2 && fbRes2.ok ? await fbRes2.json().catch(() => null) : null;
        const botToken = String(cfg2?.botToken || cfg1?.botToken || '').trim();
        if (!botToken) return new Response(null, { status: 404 });

        const photosRes = await fetch(
          `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${encodeURIComponent(userId)}&limit=1`
        );
        const photosData = await photosRes.json().catch(() => null);
        const firstGroup = photosData?.result?.photos?.[0];
        if (!Array.isArray(firstGroup) || firstGroup.length === 0) {
          return new Response(null, { status: 404 });
        }
        const bestPhoto = firstGroup[firstGroup.length - 1];
        const fileId = bestPhoto?.file_id;
        if (!fileId) return new Response(null, { status: 404 });

        const fileRes = await fetch(
          `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`
        );
        const fileData = await fileRes.json().catch(() => null);
        const filePath = fileData?.result?.file_path;
        if (!filePath) return new Response(null, { status: 404 });

        const imgRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
        if (!imgRes.ok) return new Response(null, { status: 404 });

        return new Response(imgRes.body, {
          status: 200,
          headers: {
            'Content-Type': imgRes.headers.get('content-type') || 'image/jpeg',
            'Cache-Control': 'public, max-age=3600',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    }

    // 4. Dynamic Edge SSR for Homepage (/), Video Watch (/?v=...), and Shorts (/?short=...)
    // So Googlebot sees the Google verification meta tag, exact video title, VideoObject JSON-LD & crawlable video links immediately!
    if (path === '/' || path === '/index.html') {
      const assetRes = await env.ASSETS.fetch(request);
      const contentType = assetRes.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        return assetRes;
      }

      let vidParam = url.searchParams.get('v') || url.searchParams.get('video');
      let shortParam = url.searchParams.get('short');
      const tgStartRaw =
        url.searchParams.get('tgWebAppStartParam') ||
        url.searchParams.get('startapp') ||
        url.searchParams.get('start') ||
        '';
      if (!vidParam && !shortParam && tgStartRaw) {
        if (tgStartRaw.startsWith('short_')) {
          shortParam = tgStartRaw.slice(6).replace(/__d__/g, '.').replace(/_D_/g, '.').replace(/_P_/g, '+');
        } else if (tgStartRaw.startsWith('vid_')) {
          vidParam = tgStartRaw.slice(4).replace(/__d__/g, '.').replace(/_D_/g, '.').replace(/_P_/g, '+');
        } else {
          vidParam = tgStartRaw.replace(/__d__/g, '.').replace(/_D_/g, '.').replace(/_P_/g, '+');
        }
      }

      try {
        let html = await assetRes.text();
        const { videosData, shortsData, seoData } = await fetchFirebaseData();

        // Inject Google Search Console verification meta tag if configured in Admin Panel (`seoConfig/googleVerification`)
        const googleToken = extractGoogleVerificationToken(seoData?.googleVerification);
        if (googleToken) {
          const gscMeta = `<meta name="google-site-verification" content="${escapeXml(googleToken)}" />`;
          html = html.replace('</head>', `${gscMeta}\n  </head>`);
        }

        if (vidParam && (videosData[vidParam] || shortsData[vidParam])) {
          const v = videosData[vidParam] || shortsData[vidParam];
          const rawTitle = String(v.title || 'Viral Video').trim();
          const fullTitle = `${rawTitle} | X Tube Official`;
          const desc = String(
            v.description ||
              `${rawTitle} - Watch exclusive Bangladeshi viral video in HD on X Tube Official (xtubeofficial.pages.dev).`
          ).trim();
          const pageUrl = `${CANONICAL_SITE_URL}/?v=${encodeURIComponent(vidParam)}`;
          const streamUrl = String(v.url || v.videoUrl || '').trim();
          const thumbUrl = resolveValidSeoThumb(v.thumbnail || v.thumbnailUrl);
          const durSec = parseDurationSec(v.duration, 210);
          const pubIso = new Date(
            Number(v.addedAt || v.createdAt) || Date.now()
          ).toISOString();

          const videoJsonLd = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'VideoObject',
            '@id': `${pageUrl}#video`,
            url: pageUrl,
            name: fullTitle,
            description: desc,
            thumbnailUrl: [thumbUrl],
            uploadDate: pubIso,
            duration: secondsToIsoDuration(durSec),
            contentUrl: streamUrl,
            embedUrl: pageUrl,
            isFamilyFriendly: true,
            interactionStatistic: {
              '@type': 'InteractionCounter',
              interactionType: { '@type': 'WatchAction' },
              userInteractionCount: Number(v.views) || 1,
            },
          });

          html = html
            .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeXml(fullTitle)}</title>`)
            .replace(
              /<meta\s+name="description"[\s\S]*?>/i,
              `<meta name="description" content="${escapeXml(desc)}" />`
            )
            .replace(
              /<link rel="canonical"[^>]*>/i,
              `<link rel="canonical" id="canonical-link" href="${escapeXml(pageUrl)}" />`
            )
            .replace(
              /<meta property="og:title"[^>]*>/i,
              `<meta property="og:title" id="og-title" content="${escapeXml(fullTitle)}" />`
            )
            .replace(
              /<meta property="og:url"[^>]*>/i,
              `<meta property="og:url" id="og-url" content="${escapeXml(pageUrl)}" />`
            )
            .replace(
              '</head>',
              `<script type="application/ld+json">${videoJsonLd}</script></head>`
            );
        } else if (shortParam && shortParam !== 'feed' && shortsData[shortParam]) {
          const s = shortsData[shortParam];
          const rawTitle = String(s.title || 'Viral Short').trim();
          const fullTitle = `${rawTitle} | X Tube Shorts`;
          const hashtags = String(s.hashtags || s.keywords || '#Shorts #XTube').trim();
          const desc = `${rawTitle} ${hashtags} - Watch viral Short video in HD on X Tube Official.`;
          const pageUrl = `${CANONICAL_SITE_URL}/?short=${encodeURIComponent(shortParam)}`;
          const streamUrl = normalizeShortStreamUrl(s.url || s.videoUrl || '', s.r2Key);
          const thumbUrl = resolveValidSeoThumb(s.thumbnail || s.thumbnailUrl);
          const durSec = parseDurationSec(s.duration, 35);
          const pubIso = new Date(
            Number(s.addedAt || s.createdAt) || Date.now()
          ).toISOString();

          const shortJsonLd = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'VideoObject',
            '@id': `${pageUrl}#video`,
            url: pageUrl,
            name: fullTitle,
            description: desc,
            thumbnailUrl: [thumbUrl],
            uploadDate: pubIso,
            duration: secondsToIsoDuration(durSec),
            contentUrl: streamUrl,
            embedUrl: pageUrl,
            isFamilyFriendly: true,
            interactionStatistic: {
              '@type': 'InteractionCounter',
              interactionType: { '@type': 'WatchAction' },
              userInteractionCount: Number(s.views) || 1,
            },
          });

          html = html
            .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeXml(fullTitle)}</title>`)
            .replace(
              /<meta\s+name="description"[\s\S]*?>/i,
              `<meta name="description" content="${escapeXml(desc)}" />`
            )
            .replace(
              /<link rel="canonical"[^>]*>/i,
              `<link rel="canonical" id="canonical-link" href="${escapeXml(pageUrl)}" />`
            )
            .replace(
              /<meta property="og:title"[^>]*>/i,
              `<meta property="og:title" id="og-title" content="${escapeXml(fullTitle)}" />`
            )
            .replace(
              /<meta property="og:url"[^>]*>/i,
              `<meta property="og:url" id="og-url" content="${escapeXml(pageUrl)}" />`
            )
            .replace(
              '</head>',
              `<script type="application/ld+json">${shortJsonLd}</script></head>`
            );
        } else {
          // Root Homepage (/): Inject live ItemList JSON-LD + crawlable <a> links for all videos & shorts
          const videoEntries = Object.entries(videosData)
            .sort(
              (a, b) =>
                (Number(b[1]?.addedAt || b[1]?.createdAt) || 0) -
                (Number(a[1]?.addedAt || a[1]?.createdAt) || 0)
            )
            .slice(0, 30);

          const shortEntries = Object.entries(shortsData)
            .sort(
              (a, b) =>
                (Number(b[1]?.addedAt || b[1]?.createdAt) || 0) -
                (Number(a[1]?.addedAt || a[1]?.createdAt) || 0)
            )
            .slice(0, 20);

          const itemListElement = [];
          const crawlerLinks = [];
          let pos = 1;

          for (const [id, v] of videoEntries) {
            if (!v || typeof v !== 'object') continue;
            const streamUrl = String(v.url || v.videoUrl || '').trim();
            if (!streamUrl || BROKEN_FILES.some((b) => streamUrl.includes(b))) continue;
            const rawTitle = String(v.title || 'X Tube Official Viral Video').trim();
            const pageUrl = `${CANONICAL_SITE_URL}/?v=${encodeURIComponent(id)}`;
            const pubIso = new Date(Number(v.addedAt || v.createdAt) || Date.now()).toISOString();
            const durSec = parseDurationSec(v.duration, 210);
            itemListElement.push({
              '@type': 'ListItem',
              position: pos++,
              url: pageUrl,
              item: {
                '@type': 'VideoObject',
                '@id': `${pageUrl}#video`,
                url: pageUrl,
                name: `${rawTitle} | X Tube Official`,
                description: String(
                  v.description || `${rawTitle} - Watch exclusive HD viral video on X Tube Official.`
                ).trim(),
                thumbnailUrl: [resolveValidSeoThumb(v.thumbnail || v.thumbnailUrl)],
                uploadDate: pubIso,
                duration: secondsToIsoDuration(durSec),
                contentUrl: streamUrl,
                embedUrl: pageUrl,
                isFamilyFriendly: true,
              },
            });
            crawlerLinks.push(`<a href="${escapeXml(pageUrl)}">${escapeXml(rawTitle)} | X Tube Official</a>`);
          }

          for (const [id, s] of shortEntries) {
            if (!s || typeof s !== 'object') continue;
            const streamUrl = normalizeShortStreamUrl(s.url || s.videoUrl || '', s.r2Key);
            if (!streamUrl || BROKEN_FILES.some((b) => streamUrl.includes(b))) continue;
            const rawTitle = String(s.title || 'X Tube Official Viral Short').trim();
            const pageUrl = `${CANONICAL_SITE_URL}/?short=${encodeURIComponent(id)}`;
            crawlerLinks.push(`<a href="${escapeXml(pageUrl)}">${escapeXml(rawTitle)} | X Tube Shorts</a>`);
          }

          if (itemListElement.length > 0) {
            const firstItem = itemListElement[0].item;
            const featuredRootVideo = {
              ...firstItem,
              '@id': `${CANONICAL_SITE_URL}/#featured-video`,
              url: `${CANONICAL_SITE_URL}/`,
              embedUrl: `${CANONICAL_SITE_URL}/`,
            };
            const liveListJson = JSON.stringify({
              '@context': 'https://schema.org',
              '@graph': [
                featuredRootVideo,
                {
                  '@type': 'ItemList',
                  '@id': `${CANONICAL_SITE_URL}/#videolist`,
                  name: 'X Tube Official Trending & Viral Videos',
                  numberOfItems: itemListElement.length,
                  itemListElement,
                },
              ],
            });
            html = html.replace(
              /<script id="dynamic-video-jsonld" type="application\/ld\+json">[\s\S]*?<\/script>/i,
              `<script id="dynamic-video-jsonld" type="application/ld+json">${liveListJson}</script>`
            );
          }

          if (crawlerLinks.length > 0) {
            const seoNav = `<nav id="seo-crawler-links" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;" aria-label="X Tube Official Video Directory"><h2>X Tube Official Viral Videos &amp; Shorts</h2>${crawlerLinks.join(' | ')}</nav>`;
            html = html.replace('</body>', `${seoNav}\n  </body>`);
          }
        }

        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=60, s-maxage=60',
          },
        });
      } catch {
        return assetRes;
      }
    }

    return env.ASSETS.fetch(request);
  },
};
