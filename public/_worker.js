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
  async fetch(request, env) {
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

    // 3B. Telegram Bot Video Upload Webhook (/api/telegram-bot)
    // Flow: /start -> Password ("Muttakin") -> Select Category (Shorts / Long / Both) -> Send Video -> Auto Upload to R2 + Firebase -> Reply with Share Link!
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
            service: 'X Tube Official Telegram Upload Bot Webhook',
            domain: CANONICAL_SITE_URL,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      try {
        const update = await request.json();
        const botToken = (url.searchParams.get('token') || '').trim();
        const workerUrl = (url.searchParams.get('worker') || '').trim().replace(/\/+$/, '');
        const publicUrl = (url.searchParams.get('pub') || '').trim().replace(/\/+$/, '');
        const adminKey = (url.searchParams.get('key') || '').trim();
        const requiredPass = (url.searchParams.get('pass') || 'Muttakin').trim();
        const fbEmail = (url.searchParams.get('fbEmail') || '').trim();
        const fbPass = (url.searchParams.get('fbPass') || '').trim();
        const firebaseWebApiKey = 'AIzaSyBPrgfeMTuy3GI1nb2jgw-qqQn6wPvH-0w';

        if (!botToken) {
          return new Response(JSON.stringify({ ok: false, error: 'Missing bot token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const tgApi = async (method, payload) => {
          const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          return res.json().catch(() => ({}));
        };

        const getFirebaseAuthQuery = async () => {
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
            const authData = await authRes.json();
            if (authData && authData.idToken) {
              return `?auth=${encodeURIComponent(authData.idToken)}`;
            }
          } catch {}
          return '';
        };

        const getChatSession = async (chatId) => {
          const cacheKeyUrl = `${CANONICAL_SITE_URL}/__tg_bot_session_${chatId}`;
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
          return { unlocked: false, mode: '' };
        };

        const saveChatSession = async (chatId, sessionObj) => {
          const cacheKeyUrl = `${CANONICAL_SITE_URL}/__tg_bot_session_${chatId}`;
          const payload = {
            ...sessionObj,
            botAuthToken: 'xtube_tg_bot_2026',
            updatedAt: Date.now(),
          };
          try {
            await caches.default.put(
              cacheKeyUrl,
              new Response(JSON.stringify(payload), {
                headers: {
                  'Content-Type': 'application/json',
                  'Cache-Control': 'public, max-age=604800',
                },
              })
            );
          } catch {}
          try {
            const authQ = await getFirebaseAuthQuery();
            await fetch(
              `${FIREBASE_RTDB_BASE}/telegramBotSessions/${chatId}.json${authQ}`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              }
            );
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

        const modeLabel = (m) =>
          m === 'shorts'
            ? '📱 Shorts Only'
            : m === 'long'
            ? '🎬 Long Video Only'
            : '🚀 Both (Shorts + Long)';

        // Handle Callback Query (Category Selection Buttons)
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
              return new Response('OK', { status: 200 });
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
          return new Response('OK', { status: 200 });
        }

        const msg = update.message || update.edited_message;
        if (!msg || !msg.chat) {
          return new Response('OK', { status: 200 });
        }

        const chatId = msg.chat.id;
        const text = String(msg.text || '').trim();
        const session = await getChatSession(chatId);

        // 1. /start or /logout command
        if (text === '/start' || text === '/login') {
          await saveChatSession(chatId, { unlocked: false, mode: '' });
          await tgApi('sendMessage', {
            chat_id: chatId,
            text:
              `🎬 *X Tube Official Video Upload Bot*-এ স্বাগতম!\n\n` +
              `🔐 ভিডিও আপলোড শুরু করতে অনুগ্রহ করে আপনার পাসওয়ার্ড দিন:`,
            parse_mode: 'Markdown',
          });
          return new Response('OK', { status: 200 });
        }

        if (text === '/logout') {
          await saveChatSession(chatId, { unlocked: false, mode: '' });
          await tgApi('sendMessage', {
            chat_id: chatId,
            text: '🔒 বট লক করা হয়েছে। আবার শুরু করতে /start লিখুন।',
          });
          return new Response('OK', { status: 200 });
        }

        // 2. If not unlocked yet, check password ("Muttakin")
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
          return new Response('OK', { status: 200 });
        }

        // 3. Allow text shortcuts to switch mode when unlocked
        if (text.toLowerCase() === 'shorts' || text === '/shorts') {
          await saveChatSession(chatId, { unlocked: true, mode: 'shorts' });
          await tgApi('sendMessage', {
            chat_id: chatId,
            text: `✅ ক্যাটাগরি: *📱 Shorts Only* সিলেক্ট হয়েছে! এখন ভিডিও পাঠান:`,
            parse_mode: 'Markdown',
            reply_markup: categoryKeyboard,
          });
          return new Response('OK', { status: 200 });
        }
        if (text.toLowerCase() === 'long' || text === '/long') {
          await saveChatSession(chatId, { unlocked: true, mode: 'long' });
          await tgApi('sendMessage', {
            chat_id: chatId,
            text: `✅ ক্যাটাগরি: *🎬 Long Video Only* সিলেক্ট হয়েছে! এখন ভিডিও পাঠান:`,
            parse_mode: 'Markdown',
            reply_markup: categoryKeyboard,
          });
          return new Response('OK', { status: 200 });
        }
        if (text.toLowerCase() === 'both' || text === '/both') {
          await saveChatSession(chatId, { unlocked: true, mode: 'both' });
          await tgApi('sendMessage', {
            chat_id: chatId,
            text: `✅ ক্যাটাগরি: *🚀 Both (Shorts + Long)* সিলেক্ট হয়েছে! এখন ভিডিও পাঠান:`,
            parse_mode: 'Markdown',
            reply_markup: categoryKeyboard,
          });
          return new Response('OK', { status: 200 });
        }

        // 4. Handle Video File Upload (or Video Document / Animation / Direct .mp4 URL)
        const videoMedia =
          msg.video ||
          msg.animation ||
          (msg.document &&
          String(msg.document.mime_type || '').startsWith('video/')
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
          return new Response('OK', { status: 200 });
        }

        const activeMode = session.mode || 'both';
        const statusMsg = await tgApi('sendMessage', {
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

          // Check Telegram 20MB Bot API file download limit
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
            return new Response('OK', { status: 200 });
          }

          const fileInfoRes = await fetch(
            `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(
              videoMedia.file_id
            )}`
          );
          const fileInfo = await fileInfoRes.json();
          if (!fileInfo.ok || !fileInfo.result?.file_path) {
            await tgApi('sendMessage', {
              chat_id: chatId,
              text: `❌ Telegram থেকে ভিডিও ফাইল ডাউনলোড করা যায়নি: ${
                fileInfo.description || 'Unknown error'
              }`,
            });
            return new Response('OK', { status: 200 });
          }

          const tgFileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
          const fileDownloadRes = await fetch(tgFileUrl);
          if (!fileDownloadRes.ok) {
            await tgApi('sendMessage', {
              chat_id: chatId,
              text: '❌ Telegram সার্ভার থেকে ভিডিও স্ট্রিম পাওয়া যায়নি।',
            });
            return new Response('OK', { status: 200 });
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
            return new Response('OK', { status: 200 });
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
          const r2Data = await r2UploadRes.json().catch(() => ({}));
          if (!r2UploadRes.ok || !r2Data.key) {
            await tgApi('sendMessage', {
              chat_id: chatId,
              text: `❌ Cloudflare R2 সার্ভারে আপলোড ব্যর্থ হয়েছে: ${
                r2Data.error || r2UploadRes.status
              }`,
            });
            return new Response('OK', { status: 200 });
          }

          r2KeySaved = r2Data.key;
          const encodedKey = r2KeySaved
            .split('/')
            .map((part) => encodeURIComponent(part))
            .join('/');
          finalStreamUrl = `${publicUrl}/${encodedKey}`;
        }

        // 5. Save Video Metadata to Firebase Realtime Database (`videos` and/or `shorts` + `notices`)
        // Use clean alphanumeric IDs WITHOUT underscores so Telegram never strips characters as Markdown italics
        const now = Date.now();
        const randSuffix = Math.random().toString(36).slice(2, 7).replace(/[^a-z0-9]/gi, '');
        const authQuery = await getFirebaseAuthQuery();
        const shareLinks = [];
        let createdVideoId = '';
        let createdShortId = '';

        if (activeMode === 'long' || activeMode === 'both') {
          createdVideoId = `v${now}${randSuffix}`;
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
          const vidFbRes = await fetch(
            `${FIREBASE_RTDB_BASE}/videos/${encodeURIComponent(createdVideoId)}.json${authQuery}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(videoPayload),
            }
          );
          if (!vidFbRes.ok) {
            const errTxt = await vidFbRes.text().catch(() => '');
            await tgApi('sendMessage', {
              chat_id: chatId,
              text: `❌ Firebase Database-এ ভিডিও সেভ করা যায়নি (${vidFbRes.status}): ${errTxt}\n\nঅনুগ্রহ করে Admin Panel (/ad.html) থেকে "Copy Updated Firebase Rules (For Bot)" বাটনে ক্লিক করে Firebase Console-এ Rules Publish করুন।`,
            });
            return new Response('OK', { status: 200 });
          }
          shareLinks.push({
            label: '🎬 Direct Video Share Link',
            url: `${CANONICAL_SITE_URL}/?v=${encodeURIComponent(createdVideoId)}`,
          });
        }

        if (activeMode === 'shorts' || activeMode === 'both') {
          createdShortId = `s${now}${randSuffix}`;
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
          const shortFbRes = await fetch(
            `${FIREBASE_RTDB_BASE}/shorts/${encodeURIComponent(createdShortId)}.json${authQuery}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(shortPayload),
            }
          );
          if (!shortFbRes.ok) {
            const errTxt = await shortFbRes.text().catch(() => '');
            await tgApi('sendMessage', {
              chat_id: chatId,
              text: `❌ Firebase Database-এ Short ভিডিও সেভ করা যায়নি (${shortFbRes.status}): ${errTxt}\n\nঅনুগ্রহ করে Admin Panel (/ad.html) থেকে "Copy Updated Firebase Rules (For Bot)" বাটনে ক্লিক করে Firebase Console-এ Rules Publish করুন।`,
            });
            return new Response('OK', { status: 200 });
          }
          shareLinks.push({
            label: '📱 Short Video Share Link',
            url: `${CANONICAL_SITE_URL}/?short=${encodeURIComponent(createdShortId)}`,
          });
          if (activeMode === 'shorts') {
            shareLinks.push({
              label: '🎬 Watch Player Share Link',
              url: `${CANONICAL_SITE_URL}/?v=${encodeURIComponent(createdShortId)}`,
            });
          }
        }

        // Auto-post Notice to Index Notice Board
        const noticeId = `n${now}${randSuffix}`;
        await fetch(
          `${FIREBASE_RTDB_BASE}/notices/${encodeURIComponent(noticeId)}.json${authQuery}`,
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

        // Refresh live Sitemap & ping IndexNow
        await generateLiveSitemapXml('all').catch(() => {});

        const primaryShareUrl = shareLinks[0]?.url || CANONICAL_SITE_URL;
        const linksBlock = shareLinks
          .map((item) => `${item.label}:\n${item.url}`)
          .join('\n\n');

        await tgApi('sendMessage', {
          chat_id: chatId,
          text:
            `✅ ভিডিও সফলভাবে আপলোড ও ওয়েবসাইটে পাবলিশ হয়েছে! 🎉\n\n` +
            `📌 টাইটেল: ${finalTitle}\n` +
            `📂 ক্যাটাগরি: ${modeLabel(activeMode)}\n` +
            `⏱ ডিউরেশন: ${durationFormatted}\n\n` +
            `🔗 ডিরেক্ট শেয়ার লিংক (ক্লিক করে কপি বা শেয়ার করুন):\n` +
            `${linksBlock}\n\n` +
            `📤 আরেকটি ভিডিও আপলোড করতে সরাসরি ভিডিও পাঠান:`,
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

        return new Response('OK', { status: 200 });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
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

      const vidParam = url.searchParams.get('v');
      const shortParam = url.searchParams.get('short');

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
