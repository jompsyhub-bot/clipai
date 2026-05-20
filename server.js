// server.js — local dev server (no Vercel CLI needed)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const axios = require('axios');
const { execFile } = require('child_process');
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
const UPLOAD_DIR = process.env.CLIPAI_UPLOAD_DIR || path.join(os.tmpdir(), 'clipai_uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readJson(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function safeName(name) {
  const ext = path.extname(name || '').toLowerCase().slice(0, 10);
  const base = path.basename(name || 'video', ext).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60) || 'video';
  return base + ext;
}

function getLocalFilePath(localFileId) {
  const cleaned = path.basename(String(localFileId || ''));
  const fullPath = path.resolve(UPLOAD_DIR, cleaned);
  if (!fullPath.startsWith(path.resolve(UPLOAD_DIR))) throw new Error('Invalid file id');
  return fullPath;
}

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const YTDLP = process.env.YTDLP_PATH ||
  (process.platform === 'win32' && fs.existsSync('C:\\Users\\USER\\AppData\\Local\\Programs\\Python\\Python313\\Scripts\\yt-dlp.exe')
    ? 'C:\\Users\\USER\\AppData\\Local\\Programs\\Python\\Python313\\Scripts\\yt-dlp.exe'
    : 'yt-dlp');

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 * 4, ...options }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function uploadToAssemblyAI(filePath) {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error('AssemblyAI key not configured');

  const response = await axios.post('https://api.assemblyai.com/v2/upload', fs.createReadStream(filePath), {
    headers: {
      authorization: key,
      'content-type': 'application/octet-stream'
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 10 * 60 * 1000
  });

  if (!response.data?.upload_url) throw new Error('AssemblyAI upload did not return a URL');
  return response.data.upload_url;
}

async function handleUploadLocal(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const originalName = decodeURIComponent(req.headers['x-filename'] || 'video.mp4');
  const localFileId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName(originalName)}`;
  const filePath = getLocalFilePath(localFileId);
  const maxBytes = Number(process.env.CLIPAI_MAX_UPLOAD_BYTES || 500 * 1024 * 1024);
  let received = 0;

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);
    req.on('data', chunk => {
      received += chunk.length;
      if (received > maxBytes) {
        out.destroy();
        req.destroy();
        reject(new Error('File too large'));
      }
    });
    req.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    req.on('error', reject);
  });

  const uploadUrl = await uploadToAssemblyAI(filePath);
  return sendJson(res, 200, { localFileId, uploadUrl, size: received });
}

async function handleYoutubeUpload(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const { url } = await readJson(req);
  if (!url || !/^https?:\/\//i.test(url)) return sendJson(res, 400, { error: 'Valid url is required' });

  const localFileId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-youtube.mp3`;
  const filePath = getLocalFilePath(localFileId);
  await execFileAsync(YTDLP, [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '192K',
    '--no-playlist',
    '-o', filePath,
    url
  ]);

  const uploadUrl = await uploadToAssemblyAI(filePath);
  return sendJson(res, 200, { localFileId, uploadUrl });
}

async function handleCutClip(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const body = await readJson(req, 1024 * 1024 * 2);
  const inputPath = getLocalFilePath(body.localFileId);
  if (!fs.existsSync(inputPath)) return sendJson(res, 404, { error: 'Local video file not found. Please re-upload your video.' });

  const startSec = Math.max(0, Number(body.startMs || 0) / 1000);
  const endSec = Math.max(startSec + 1, Number(body.endMs || 0) / 1000);
  const durationSec = Math.min(90, Math.max(1, endSec - startSec));
  const safeTitle = safeName(body.clipTitle || `clip-${Date.now()}`).replace(/\.[^.]+$/, '');
  const outputPath = path.join(UPLOAD_DIR, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeTitle}.mp4`);

  await execFileAsync(FFMPEG, [
    '-y',
    '-ss', String(startSec),
    '-t', String(durationSec),
    '-i', inputPath,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath
  ]);

  const downloadName = `${safeTitle || 'clip'}_9x16.mp4`;
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Content-Disposition': `attachment; filename="${downloadName.replace(/"/g, '')}"`
  });
  fs.createReadStream(outputPath)
    .on('close', () => setTimeout(() => fs.unlink(outputPath, () => {}), 5000))
    .pipe(res);
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // CORS — allow Vercel frontend and local dev
  const origin = req.headers.origin || '';
  const allowed = (process.env.CORS_ORIGINS || 'https://clipai-ten.vercel.app,http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const allowOrigin = !origin || allowed.includes(origin) ? (origin || allowed[0]) : origin;
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-filename');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── API ROUTES ──
  try {
    if (pathname === '/api/upload-local') return await handleUploadLocal(req, res);
    if (pathname === '/api/youtube-upload') return await handleYoutubeUpload(req, res);
    if (pathname === '/api/cut-clip') return await handleCutClip(req, res);
  } catch (err) {
    console.error('[ClipAI video] Error:', err.stderr || err.message);
    if (!res.headersSent) return sendJson(res, 500, { error: err.message || 'Video processing failed' });
    return;
  }

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
