// server.js — local dev server (no Vercel CLI needed)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ── Load .env.local ──
function loadEnv() {
  const envPath = path.join(__dirname, '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (key) process.env[key.trim()] = rest.join('=').trim();
    }
    console.log('✓ Loaded .env.local');
  } else {
    console.warn('⚠  No .env.local found. Create one with your API keys.');
  }
}
loadEnv();

const MIME = {
  '.html': 'text/html', '.css': 'text/css',
  '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // CORS — allow Vercel frontend and local dev
  const origin = req.headers.origin || '';
  const allowed = ['https://clipai-ten.vercel.app', 'http://localhost:3000', 'http://127.0.0.1:3000'];
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-filename');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── API ROUTES ──
  if (pathname.startsWith('/api/')) {
    const routeName = pathname.replace('/api/', '').split('?')[0].split('/')[0];
    const routePath = path.join(__dirname, 'api', routeName + '.js');

    if (!fs.existsSync(routePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `API route not found: ${routeName}` }));
      return;
    }

    // Attach helpers that match Vercel's API signature
    req.query = Object.fromEntries(parsedUrl.searchParams.entries());
    req.body = {};

    // Only pre-parse JSON bodies — multipart is handled by the route (busboy)
    const contentType = req.headers['content-type'] || '';
    if (req.method === 'POST' && contentType.includes('application/json')) {
      let raw = '';
      req.on('data', chunk => raw += chunk);
      await new Promise(resolve => req.on('end', resolve));
      try { req.body = JSON.parse(raw); } catch { req.body = {}; }
    }

    // Vercel-compatible response helpers
    let _statusCode = 200;
    const _origSetHeader = res.setHeader.bind(res);

    res.status = (code) => { _statusCode = code; return res; };
    res.json = (data) => {
      if (!res.headersSent) {
        res.writeHead(_statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      }
    };
    // Keep native setHeader working AND allow overrides
    res.setHeader = (k, v) => _origSetHeader(k, v);

    try {
      // Support both CommonJS (upload-local, cut-clip) and ES modules (api routes)
      let fn;
      try {
        delete require.cache[require.resolve(routePath)];
        const handler = require(routePath);
        fn = handler.default || handler;
      } catch(requireErr) {
        // Fall back to dynamic import for ES modules
        const fileUrl = 'file:///' + routePath.replace(/\\/g, '/');
        const mod = await import(fileUrl + '?t=' + Date.now());
        fn = mod.default || mod;
      }
      await fn(req, res);
    } catch (err) {
      console.error('[' + routeName + '] Error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return;
  }

  // ── STATIC FILES ──
  let filePath = pathname === '/' || pathname === ''
    ? path.join(__dirname, 'public', 'index.html')
    : path.join(__dirname, 'public', pathname);

  const ext = path.extname(filePath);
  const mimeType = MIME[ext] || 'text/plain';

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { 'Content-Type': mimeType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(indexPath).pipe(res);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  }
});

// Large upload timeout — 20 minutes for big video files
server.timeout = 1200000;
server.requestTimeout = 1200000;
server.keepAliveTimeout = 1200000;

server.listen(PORT, () => {
  console.log(`\n🎬 ClipAI running at http://localhost:${PORT}\n`);
  console.log('  ASSEMBLYAI_API_KEY:', process.env.ASSEMBLYAI_API_KEY ? '✓ set' : '✗ missing');
  console.log('  GROQ_API_KEY:      ', process.env.GROQ_API_KEY ? '✓ set' : '✗ missing');
  console.log('');
});
