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
  if (clean.includes('pub-a89cc17745e446439972f8e3a1b3c661.r2.dev/shorts/')) {
    clean = clean.replace(
      'pub-a89cc17745e446439972f8e3a1b3c661.r2.dev/shorts/',
      'pub-56ae26091320480ca8946ab4e42a051d.r2.dev/shorts/'
    );
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

        if (vidParam && videosData[vidParam]) {
          const v = videosData[vidParam];
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
