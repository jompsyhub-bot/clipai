// api/youtube-upload.js
// Downloads YouTube audio using the clipai-backend service, then uploads to AssemblyAI

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

const UPLOAD_DIR = path.join(os.tmpdir(), 'clipai_uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const BACKEND_URL = 'https://clipai-backend-production-db09.up.railway.app';

function downloadFileFromUrl(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const options = { rejectUnauthorized: false };
    const file = fs.createWriteStream(destPath);
    proto.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        file.close();
        fs.unlink(destPath, () => {});
        return downloadFileFromUrl(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('Download failed with status ' + res.statusCode));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_API_KEY;
  if (!ASSEMBLYAI_KEY) return res.status(500).json({ error: 'AssemblyAI key not configured' });

  try {
    console.log('[ClipAI] Requesting YouTube download from backend:', url.substring(0, 60));

    // Step 1: Ask clipai-backend to download the video as MP4
    const convertRes = await fetch(BACKEND_URL + '/api/convert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, format: 'mp4', quality: '720p' })
    });

    const convertData = await convertRes.json();
    if (!convertRes.ok) throw new Error(convertData.message || 'Backend conversion failed');
    if (!convertData.downloadUrl) throw new Error('No download URL returned from backend');

    console.log('[ClipAI] Backend returned download URL:', convertData.downloadUrl);

    // Step 2: Download the file from the backend
    const ts = Date.now();
    const localFilename = 'yt_' + ts + '.mp4';
    const localPath = path.join(UPLOAD_DIR, localFilename);
    const fileUrl = convertData.downloadUrl.startsWith('http')
      ? convertData.downloadUrl
      : BACKEND_URL + convertData.downloadUrl;

    console.log('[ClipAI] Downloading file from:', fileUrl);
    await downloadFileFromUrl(fileUrl, localPath);

    const fileSize = fs.statSync(localPath).size;
    console.log('[ClipAI] Downloaded:', (fileSize / 1024 / 1024).toFixed(1), 'MB');

    // Step 3: Upload to AssemblyAI for transcription
    const buffer = fs.readFileSync(localPath);
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

    console.log('[ClipAI] AssemblyAI upload ready');

    return res.status(200).json({
      uploadUrl: uploadData.upload_url,
      localFileId: localFilename,
      title: convertData.title || 'YouTube Video',
      source: 'youtube'
    });

  } catch (err) {
    console.error('[ClipAI] youtube-upload error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
