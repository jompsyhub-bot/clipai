const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const UPLOAD_DIR = path.join(os.tmpdir(), 'clipai_uploads');

function getFFmpegPath() {
  if (process.platform === 'win32') return 'C:\\ffmpeg\\bin\\ffmpeg.exe';
  try {
    const p = execSync('which ffmpeg', { encoding: 'utf8' }).trim();
    if (p) return p;
  } catch(e) {}
  return 'ffmpeg';
}

function msToSeconds(ms) { return (ms / 1000).toFixed(3); }

function toSRTTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') + ',' + String(ms).padStart(3,'0');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { localFileId, startMs, endMs, clipTitle, captionLines, words } = req.body;
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
  const srtPath = path.join(os.tmpdir(), 'clipai_subs_' + ts + '.srt');
  let srtCreated = false;

  const cleanup = () => {
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch(e) {}
    try { if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath); } catch(e) {}
  };

  try {
    const startSec = msToSeconds(startMs);
    const endSec = msToSeconds(endMs);
    const durationSec = ((endMs - startMs) / 1000).toFixed(3);
    console.log('[ClipAI] Cutting:', safeFileId, 'from', startSec, 'to', endSec);

    // Build SRT subtitle file
    const wordList = (words || []).filter(w => w.start >= startMs && w.start <= endMs);

    if (wordList.length > 0) {
      // Word-level karaoke captions — 3 words per subtitle chunk
      const chunks = [];
      for (let i = 0; i < wordList.length; i += 3) {
        const group = wordList.slice(i, i + 3);
        const text = group.map(w => w.text).join(' ');
        const chunkStart = (group[0].start - startMs) / 1000;
        const chunkEnd = (group[group.length - 1].end - startMs) / 1000 + 0.1;
        chunks.push({ text, start: Math.max(0, chunkStart), end: chunkEnd });
      }
      const srtContent = chunks.map((c, i) =>
        (i + 1) + '\n' + toSRTTime(c.start) + ' --> ' + toSRTTime(c.end) + '\n' + c.text + '\n'
      ).join('\n');
      fs.writeFileSync(srtPath, srtContent);
      srtCreated = true;
      console.log('[ClipAI] SRT created with', chunks.length, 'word chunks');
    } else if ((captionLines || []).length > 0) {
      // Fallback: split AI caption lines evenly across duration
      const totalDur = parseFloat(durationSec);
      const segDur = totalDur / captionLines.length;
      const srtContent = captionLines.map((line, i) => {
        const segStart = i * segDur;
        const segEnd = Math.min((i + 1) * segDur, totalDur);
        return (i + 1) + '\n' + toSRTTime(segStart) + ' --> ' + toSRTTime(segEnd) + '\n' + line + '\n';
      }).join('\n');
      fs.writeFileSync(srtPath, srtContent);
      srtCreated = true;
      console.log('[ClipAI] SRT created from caption lines');
    }

    // Build FFmpeg video filter
    let vfFilter = 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black';
    if (srtCreated) {
      const srtEscaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      vfFilter += ',subtitles=' + srtEscaped + ':force_style=\'FontName=Arial,FontSize=16,PrimaryColour=&H00ffffff,OutlineColour=&H00000000,Outline=2,Bold=1,Alignment=2,MarginV=50\'';
    }

    const ffmpegArgs = [
      '-y', '-ss', startSec, '-to', endSec, '-i', inputPath,
      '-vf', vfFilter,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+faststart', '-threads', '1',
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
