import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};

async function startServer() {
  const app = express();
  const PORT = 3000;

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
      const rawWorkerUrl =
        (req.headers['x-worker-url'] as string) ||
        'https://mrghost-storage.djsungroup.workers.dev';
      const baseUrl = rawWorkerUrl.trim().replace(/\/+$/, '');
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
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
