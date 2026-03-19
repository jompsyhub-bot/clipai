# ClipAI — AI Video Clip Generator

Turn long-form videos (podcasts, Zoom calls, YouTube recordings) into viral short-form clips automatically.

**Stack:** Plain HTML/JS frontend · Node.js serverless API · AssemblyAI transcription · Claude AI clip intelligence · Vercel hosting

---

## Features

- **Upload** video files (up to 500MB) or paste any public video URL
- **Auto-transcribe** with speaker detection via AssemblyAI
- **Key moment detection** — engagement scoring, sentiment analysis, auto-highlights
- **AI clip suggestions** — Claude generates 5 optimized 9:16 clips with hooks, captions, and platform fit
- **Caption style AI** — describe your style in plain English, get CSS + word-level timing
- **Export** — download MP4 or publish to TikTok / Reels / YouTube Shorts

---

## Project Structure

```
clipai/
├── public/
│   └── index.html          # Full frontend (single file)
├── api/
│   ├── upload.js           # File upload → AssemblyAI hosted URL
│   ├── transcribe.js       # Submit video URL to AssemblyAI
│   ├── transcript-status.js # Poll for completed transcript
│   ├── suggest-clips.js    # Claude AI clip suggestions
│   └── caption-style.js    # Claude AI caption designer
├── vercel.json             # Vercel routing config
├── package.json
└── .env.example
```

---

## Deploy to Vercel (10 minutes)

### Step 1 — Get API Keys

**AssemblyAI** (transcription):
1. Go to https://www.assemblyai.com
2. Sign up (free tier available)
3. Copy your API key from the dashboard

**Anthropic Claude** (AI intelligence):
1. Go to https://console.anthropic.com
2. Create an account and add a payment method
3. Go to API Keys → Create Key
4. Copy your API key

### Step 2 — Deploy

**Option A: Deploy via Vercel CLI**
```bash
npm install -g vercel
cd clipai
vercel
```

**Option B: Deploy via GitHub**
1. Push this folder to a GitHub repo
2. Go to https://vercel.com → New Project
3. Import your GitHub repo
4. Vercel auto-detects the config

### Step 3 — Add Environment Variables

In Vercel Dashboard → Your Project → Settings → Environment Variables, add:

| Key | Value |
|-----|-------|
| `ASSEMBLYAI_API_KEY` | Your AssemblyAI key |
| `ANTHROPIC_API_KEY` | Your Anthropic key |

Click **Save** then **Redeploy**.

### Step 4 — Done!

Your app is live at `https://your-project.vercel.app`

---

## Local Development

```bash
# Install dependencies
npm install

# Create local env file
cp .env.example .env.local
# Edit .env.local with your real API keys

# Run locally
npx vercel dev
```

Visit http://localhost:3000

---

## How It Works

### Upload Flow
1. User uploads file → `POST /api/upload` → AssemblyAI stores it → returns `uploadUrl`
2. OR user pastes a public URL directly

### Transcription Flow
1. `POST /api/transcribe` with `videoUrl` → AssemblyAI creates a transcript job
2. Frontend polls `GET /api/transcript-status?id=xxx` every 5 seconds
3. AssemblyAI returns: full transcript, speaker-labeled utterances, auto-highlights, sentiment analysis

### Clip AI Flow
1. `POST /api/suggest-clips` sends transcript + utterances to Claude
2. Claude returns 5 structured clip objects with timestamps, hooks, captions, viral reasoning
3. User can select/deselect clips and request custom clips via natural language

### Caption Flow
1. `POST /api/caption-style` sends clip text + style description to Claude
2. Claude returns CSS config + word-level timing with emphasis markers

---

## Adding Real Video Export (Phase 2)

The current MVP handles everything except the actual video cutting.
To add real export, you have two options:

### Option A: FFmpeg on a VPS
```
- Spin up a $5/mo Railway or Render server
- Install FFmpeg
- Add a POST /api/export endpoint that:
  1. Downloads the source video
  2. Cuts it with FFmpeg: ffmpeg -ss {start} -to {end} -i input.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" output.mp4
  3. Burns in captions with subtitles filter
  4. Returns download URL
```

### Option B: Use a Video API
- **Shotstack** (https://shotstack.io) — video editing API, pay per render
- **Remotion** (https://remotion.dev) — React-based video rendering
- **Creatomate** (https://creatomate.com) — template-based video API

---

## Roadmap (Phase 2+)

- [ ] Real FFmpeg video cutting + export
- [ ] Caption burn-in with word-level karaoke timing
- [ ] Direct TikTok / Instagram / YouTube API publishing
- [ ] User accounts + project history (add Supabase or PlanetScale)
- [ ] Custom branding overlays (logo, colors, fonts)
- [ ] Multi-language caption translation
- [ ] Music library + auto-matching
- [ ] B-roll suggestion AI
- [ ] Batch processing (upload multiple videos)

---

## Cost Estimates (at scale)

| Service | Free Tier | Paid |
|---------|-----------|------|
| AssemblyAI | 100 hours free | ~$0.65/hour |
| Anthropic Claude | Pay per token | ~$0.003 per clip suggestion |
| Vercel | Generous free tier | $20/mo pro |

A typical 1-hour podcast costs ~$0.65 to transcribe and ~$0.01 for AI clip suggestions.

---

## License

MIT — build freely, ship fast.
