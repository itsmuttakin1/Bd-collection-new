const corsHeaders = {
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

    // 1. Preflight OPTIONS handler with proper CORS headers (not "null")
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // Optional public GET handler to stream uploaded video files directly by key
    if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
      const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      if (!key) {
        return json({ status: "ok", message: "Cloudflare R2 Worker Active" }, 200);
      }
      if (!env.BUCKET) {
        return json({ error: "R2 bucket binding missing" }, 500);
      }
      const object = await env.BUCKET.get(key);
      if (!object) {
        return json({ error: "File not found" }, 404);
      }
      const headers = new Headers(corsHeaders);
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("Accept-Ranges", "bytes");
      return new Response(object.body, {
        status: 200,
        headers
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
          .replace(/^\/+|\/+$/g, "");

        if (!file || typeof file === "string") {
          return json({ error: "Select a file" }, 400);
        }

        const safeName = file.name.replace(/[\\/\r\n]/g, "_");

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
};
