// api/cut-clip.js
// Cuts a clip from a locally stored video file using FFmpeg

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Use Windows path locally, system ffmpeg on Railway/Linux
const FFMPEG = process.platform === 'win32'
  ? 'C:\\ffmpeg\\bin\\ffmpeg.exe'
  : 'ffmpeg';
const UPLOAD_DIR = path.join(os.tmpdir(), 'clipai_uploads');

function msToSeconds(ms) {
  return (ms / 1000).toFixed(3);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { localFileId, startMs, endMs, clipTitle } = req.body;
  if (!localFileId) return res.status(400).json({ error: 'localFileId is required' });
  if (startMs === undefined || endMs === undefined) return res.status(400).json({ error: 'startMs and endMs required' });

  if (!fs.existsSync(FFMPEG)) {
    return res.status(500).json({ error: 'FFmpeg not found at ' + FFMPEG });
  }

  // Security: prevent path traversal
  const safeFileId = path.basename(localFileId);
  const inputPath = path.join(UPLOAD_DIR, safeFileId);

  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({
      error: 'Source video not found locally. Please re-upload your video — the session may have expired.'
    });
  }

  const ts = Date.now();
  const safeTitle = (clipTitle || 'clip').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const outputPath = path.join(os.tmpdir(), 'clipai_cut_' + ts + '.mp4');

  const cleanup = () => {
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch(e) {}
  };

  try {
    const startSec = msToSeconds(startMs);
    const endSec = msToSeconds(endMs);
    const inputSize = (fs.statSync(inputPath).size / 1024 / 1024).toFixed(1);
    console.log('[ClipAI] Cutting local file:', safeFileId, '(' + inputSize + ' MB)', 'from', startSec, 'to', endSec);

    const ffmpegArgs = [
      '-y',
      '-ss', startSec,
      '-to', endSec,
      '-i', inputPath,
      // Convert to 9:16 vertical — pad with blurred background
      '-vf', [
        'split=2[a][b]',
        '[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:20[bg]',
        '[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg]',
        '[bg][fg]overlay=(W-w)/2:(H-h)/2'
      ].join(';'),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn(FFMPEG, ffmpegArgs);
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error('FFmpeg failed (code ' + code + '): ' + stderr.slice(-500)));
      });
      proc.on('error', err => reject(new Error('FFmpeg spawn error: ' + err.message)));
    });

    if (!fs.existsSync(outputPath)) throw new Error('Output file not created by FFmpeg');

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
