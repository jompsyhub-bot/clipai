// api/resolve-url.js
// Detects YouTube URLs and extracts audio using yt-dlp, then uploads to AssemblyAI
// For non-YouTube URLs, passes through directly to AssemblyAI


function isYouTubeUrl(url) {
  return /youtube\.com|youtu\.be/.test(url);
}

function isDirectVideoUrl(url) {
  return /\.(mp4|mov|mkv|webm|avi|mp3|m4a|wav|ogg)(\?|$)/i.test(url);
}

async function uploadBufferToAssemblyAI(buffer, apiKey) {
  const res = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      'authorization': apiKey,
      'content-type': 'application/octet-stream'
    },
    body: buffer
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'AssemblyAI upload failed');
  return data.upload_url;
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_API_KEY;
  if (!ASSEMBLYAI_KEY) return res.status(500).json({ error: 'AssemblyAI key not configured' });

  // If it's already a direct video URL, pass through
  if (isDirectVideoUrl(url)) {
    return res.status(200).json({ resolvedUrl: url, source: 'direct' });
  }

  // For YouTube URLs, use yt-dlp to download audio
  if (isYouTubeUrl(url)) {
    // Check if yt-dlp is available
    try {
      execSync('yt-dlp --version', { stdio: 'pipe' });
    } catch {
      // yt-dlp not installed — return helpful error
      return res.status(422).json({
        error: 'youtube_not_supported',
        message: 'YouTube links require yt-dlp to be installed on the server. For local testing, download the video as MP4 and upload the file directly instead.'
      });
    }

    try {
      const outPath = join(tmpdir(), `clipai_${Date.now()}.m4a`);
      
      // Download audio only (much faster than full video)
      execSync(
        `yt-dlp -f "bestaudio[ext=m4a]/bestaudio" --no-playlist -o "${outPath}" "${url}"`,
        { stdio: 'pipe', timeout: 120000 }
      );

      if (!existsSync(outPath)) throw new Error('Download failed — file not created');

      const buffer = readFileSync(outPath);
      unlinkSync(outPath); // clean up

      // Upload to AssemblyAI
      const uploadUrl = await uploadBufferToAssemblyAI(buffer, ASSEMBLYAI_KEY);
      return res.status(200).json({ resolvedUrl: uploadUrl, source: 'youtube' });
    } catch (err) {
      return res.status(500).json({ error: 'YouTube download failed: ' + err.message });
    }
  }

  // For any other URL, try passing directly (works for Loom, Dropbox, Drive direct links, etc.)
  return res.status(200).json({ resolvedUrl: url, source: 'passthrough' });
}


export default handler;
if (typeof module !== "undefined") module.exports = handler;
