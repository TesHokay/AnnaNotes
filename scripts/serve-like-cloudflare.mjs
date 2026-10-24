// Static server for dist/ that mimics Cloudflare Workers/Pages asset handling, so E2E tests
// exercise the same behaviour as production:
//   - /index.html (and /foo.html) answer with 307 → pretty URL ("auto-trailing-slash" html handling)
//   - unknown paths without an extension fall back to index.html (single-page-application)
//   - unknown files return 404
// Usage: node scripts/serve-like-cloudflare.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = 'dist';
const port = Number(process.argv[2] ?? 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
};

async function file(p) {
  try {
    const s = await stat(p);
    return s.isFile() ? p : null;
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/index.html') || (path.endsWith('.html') && path !== '/')) {
    const target = path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path.slice(0, -'.html'.length);
    res.writeHead(307, { Location: target || '/', 'Cache-Control': 'no-cache' });
    return res.end();
  }
  const rel = normalize(path === '/' ? '/index.html' : path).replace(/^([/\\])+/, '');
  let p = await file(join(root, rel));
  if (!p && !extname(path)) p = join(root, 'index.html');
  if (!p) {
    res.writeHead(404);
    return res.end('not found');
  }
  const body = await readFile(p);
  res.writeHead(200, {
    'Content-Type': types[extname(p)] ?? 'application/octet-stream',
    'Cache-Control': p.endsWith('sw.js') || p.endsWith('.html') ? 'no-cache' : 'public, max-age=0',
  });
  res.end(body);
}).listen(port, '127.0.0.1', () => console.log(`serving dist/ like Cloudflare on http://127.0.0.1:${port}`));
