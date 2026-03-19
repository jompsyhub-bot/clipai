// api/upload.js
// Accepts video file upload via multipart form, streams directly to AssemblyAI

const Busboy = require('busboy');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_API_KEY;
  if (!ASSEMBLYAI_KEY) return res.status(500).json({ error: 'AssemblyAI key not configured' });

  return new Promise((resolve) => {
    let bb;
    try {
      bb = Busboy({ headers: req.headers, limits: { fileSize: 500 * 1024 * 1024 } });
    } catch (err) {
      res.status(400).json({ error: 'Invalid multipart request: ' + err.message });
      return resolve();
    }

    const chunks = [];
    let filename = 'upload';
    let fileReceived = false;

    bb.on('file', (fieldname, file, info) => {
      fileReceived = true;
      filename = info.filename || 'upload';

      file.on('data', chunk => chunks.push(chunk));

      file.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          console.log(`Uploading ${filename} (${(buffer.length / 1024 / 1024).toFixed(1)} MB) to AssemblyAI...`);

          const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
            method: 'POST',
            headers: {
              'authorization': ASSEMBLYAI_KEY,
              'content-type': 'application/octet-stream'
            },
            body: buffer
          });

          const uploadData = await uploadRes.json();

          if (!uploadRes.ok) {
            res.status(500).json({ error: uploadData.error || 'AssemblyAI upload failed' });
            return resolve();
          }

          console.log('Upload successful:', uploadData.upload_url);
          res.status(200).json({ uploadUrl: uploadData.upload_url, filename });
          resolve();
        } catch (err) {
          console.error('Upload error:', err.message);
          res.status(500).json({ error: 'Upload failed: ' + err.message });
          resolve();
        }
      });

      file.on('error', (err) => {
        res.status(500).json({ error: 'File stream error: ' + err.message });
        resolve();
      });
    });

    bb.on('error', (err) => {
      res.status(500).json({ error: 'Multipart error: ' + err.message });
      resolve();
    });

    bb.on('finish', () => {
      if (!fileReceived) {
        res.status(400).json({ error: 'No file received in request' });
        resolve();
      }
    });

    req.pipe(bb);
  });
};
