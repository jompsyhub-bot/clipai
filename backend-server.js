// Fixed server.js for clipai-backend — works on both Windows and Railway/Linux
const express = require('express');
const cors = require('cors');
const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Auto-detect yt-dlp path
function getYtDlp() {
  if (process.platform === 'win32') {
    const winPath = 'C:\\Users\\USER\\AppData\\Local\\Programs\\Python\\Python313\\Scripts\\yt-dlp.exe';
    if (fs.existsSync(winPath)) return winPath;
  }
  try {
    const p = execSync('which yt-dlp', { encoding: 'utf8' }).trim();
    if (p) return p;
  } catch(e) {}
  return 'yt-dlp';
}

const YTDLP = getYtDlp();
console.log('Using yt-dlp:', YTDLP);

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DOWNLOAD_DIR = path.join(os.tmpdir(), 'clipai_downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'public', 'clipaidownloader.html');
  if (fs.existsSync(htmlPath)) return res.sendFile(htmlPath);
  res.send('ClipAI Backend running');
});

app.post('/api/convert', (req, res) => {
  const { url, format, quality } = req.body;
  if (!url) return res.status(400).json({ message: 'No URL provided' });

  const filename = 'download_' + Date.now();
  let outputPath, cmd;

  if (format === 'mp3') {
    const bitrate = quality ? quality.replace(' kbps', '') : '192';
    outputPath = path.join(DOWNLOAD_DIR, filename + '.mp3');
    cmd = '"' + YTDLP + '" -x --audio-format mp3 --audio-quality ' + bitrate + 'K -o "' + outputPath + '" "' + url + '"';
  } else {
    const heights = { '480p': 480, '720p': 720, '1080p': 1080, '4K': 2160 };
    const h = heights[quality] || 720;
    outputPath = path.join(DOWNLOAD_DIR, filename + '.mp4');
    cmd = '"' + YTDLP + '" -f "bestvideo[height<=' + h + ']+bestaudio/best[height<=' + h + ']" --merge-output-format mp4 -o "' + outputPath + '" "' + url + '"';
  }

  // Get video info first
  exec('"' + YTDLP + '" --print "%(title)s|||%(thumbnail)s|||%(duration_string)s" "' + url + '"', (err, stdout) => {
    const parts = (stdout || '').trim().split('|||');
    const title = parts[0] || 'Video';
    const thumbnail = parts[1] || null;
    const duration = parts[2] || '';

    exec(cmd, { timeout: 300000 }, (err2, stdout2, stderr2) => {
      if (err2) {
        console.error('Conversion error:', stderr2);
        return res.status(500).json({ message: 'Conversion failed: ' + (stderr2 || '').slice(0, 200) });
      }

      // Find the actual output file
      let actualPath = outputPath;
      if (!fs.existsSync(actualPath)) {
        const files = fs.readdirSync(DOWNLOAD_DIR)
          .filter(f => f.startsWith('download_' + path.basename(filename)))
          .map(f => path.join(DOWNLOAD_DIR, f));
        if (files.length > 0) actualPath = files[0];
      }

      const downloadUrl = '/downloads/' + path.basename(actualPath);
      res.json({ title, thumbnail, duration, downloadUrl });

      // Clean up after 30 mins
      setTimeout(() => {
        try { fs.unlinkSync(actualPath); } catch(e) {}
      }, 30 * 60 * 1000);
    });
  });
});

// Serve downloads from temp dir
app.use('/downloads', (req, res) => {
  const filename = path.basename(req.path);
  const filePath = path.join(DOWNLOAD_DIR, filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ message: 'File not found' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('ClipAI Backend running at http://localhost:' + PORT));
