const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const UPLOAD_DIR = path.join(os.tmpdir(), 'clipai_uploads');

function getFFmpegPath() {
  if (process.platform === 'win32') {
    return 'C:\\ffmpeg\\bin\\ffmpeg.exe';
  }
  try {
    const p = execSync('which ffmpeg', { encoding: 'utf8' }).trim();
    if (p) return p;
  } catch(e) {}
  return 'ffmpeg';
}

function msToSeconds(ms) {
  return (ms / 1000).toFixed(3);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { localFileId, startMs, endMs, clipTitle } = req.body;
  if (!localFileId) return res.status(400).json({ error: 'localFileId is required' });
  if (startMs === undefined || endMs === undefined) return res.status(400).json({ error: 'startMs and endMs required' });

  const FFMPEG = getFFmpegPath();
  console.log('[ClipAI] Using FFmpeg:', FFMPEG);

  const safeFileId = path.basename(localFileId);
  const inputPath = path.join(UPLOAD_DIR, safeFileId);

  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: 'Source video not found. Please re-upload your video.' });
  }

  const ts = Date.now();
  const safeTitle = (clipTitle || 'clip').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const outputPath = path.join(os.tmpdir(), 'clipai_out_' + ts + '.mp4');

  const cleanup = () => {
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch(e) {}
  };

  try {
    const startSec = msToSeconds(startMs);
    const endSec = msToSeconds(endMs);
    console.log('[ClipAI] Cutting:', safeFileId, 'from', startSec, 'to', endSec);

    const ffmpegArgs = [
      '-y',
      '-ss', startSec,
      '-to', endSec,
      '-i', inputPath,
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      '-threads', '1',
      outputPath
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn(FFMPEG, ffmpegArgs);
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error('FFmpeg failed (code ' + code + '): ' + stderr.slice(-400)));
      });
      proc.on('error', err => reject(new Error('FFmpeg spawn error: ' + err.message)));
    });

    if (!fs.existsSync(outputPath)) throw new Error('Output file not created');

    const outSize = fs.statSync(outputPath).size;
    console.log('[ClipAI] Clip ready:', (outSize / 1024 / 1024).toFixed(1), 'MB');

    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Disposition': 'attachment; filename="' + safeTitle + '_9x16.mp4"',
      'Content-Length': outSize,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);
    stream.on('end', cleanup);
    stream.on('error', cleanup);

  } catch (err) {
    cleanup();
    console.error('[ClipAI] cut-clip error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
};
