// api/upload-local.js
// Accepts raw binary video upload, saves locally for FFmpeg + uploads to AssemblyAI

const fs = require('fs');
const path = require('path');
const os = require('os');

const UPLOAD_DIR = path.join(os.tmpdir(), 'clipai_uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_API_KEY;
  if (!ASSEMBLYAI_KEY) return res.status(500).json({ error: 'AssemblyAI key not configured' });

  try {
    // Get filename from header
    const rawFilename = req.headers['x-filename'];
    const originalName = rawFilename ? decodeURIComponent(rawFilename) : 'upload.mp4';
    const ext = path.extname(originalName) || '.mp4';
    const localFilename = 'clipai_' + Date.now() + ext;
    const localPath = path.join(UPLOAD_DIR, localFilename);

    console.log('[ClipAI] Receiving upload:', originalName, 'content-type:', req.headers['content-type']);

    // Read raw binary body from stream
    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', resolve);
      req.on('error', reject);
    });

    const buffer = Buffer.concat(chunks);
    console.log('[ClipAI] Received:', (buffer.length / 1024 / 1024).toFixed(1), 'MB');

    if (buffer.length < 1000) {
      return res.status(400).json({ error: 'File too small or empty (' + buffer.length + ' bytes). Please try again.' });
    }

    // Save locally for FFmpeg
    fs.writeFileSync(localPath, buffer);
    console.log('[ClipAI] Saved locally:', localPath);

    // Upload to AssemblyAI for transcription
    console.log('[ClipAI] Uploading to AssemblyAI...');
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        'authorization': ASSEMBLYAI_KEY,
        'content-type': 'application/octet-stream'
      },
      body: buffer
    });

    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(uploadData.error || 'AssemblyAI upload failed');

    console.log('[ClipAI] AssemblyAI URL ready');

    return res.status(200).json({
      uploadUrl: uploadData.upload_url,
      localFileId: localFilename,
      filename: originalName
    });

  } catch (err) {
    console.error('[ClipAI] upload-local error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
