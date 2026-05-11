# ClipAI

AI-powered video clip generator for turning long videos, podcasts, Zoom calls, and YouTube videos into short vertical clips.

## Stack

- Plain HTML/CSS/JavaScript frontend
- Node.js API server
- AssemblyAI for upload hosting and transcription
- Groq for clip and caption intelligence
- Supabase for auth and saved projects
- FFmpeg for 9:16 clip export
- yt-dlp for YouTube ingestion

## Features

- Upload local video files up to 500MB
- Paste public video URLs
- Download YouTube audio for transcription
- Transcribe with speaker labels, highlights, sentiment, and word timing
- Generate AI clip suggestions with timestamps, hooks, captions, and platform fit
- Preview caption styles
- Save project history to Supabase
- Export selected clips as vertical MP4 files

## Project Structure

```text
clipai/
  api/
    auth.js
    caption-style.js
    projects.js
    suggest-clips.js
    transcribe.js
    transcript-status.js
  public/
    index.html
    login.html
  backend-server.js
  server.js
  package.json
  vercel.json
  railway.toml
  Dockerfile
```

`server.js` is the main entry point. It serves the frontend, runs the Vercel-style API route files, and owns the local video routes:

- `POST /api/upload-local`
- `POST /api/youtube-upload`
- `POST /api/cut-clip`

`backend-server.js` is now a compatibility shim for old deployment configs.

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```env
ASSEMBLYAI_API_KEY=your_assemblyai_api_key_here
GROQ_API_KEY=your_groq_api_key_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
CLIPAI_UPLOAD_DIR=
CLIPAI_MAX_UPLOAD_BYTES=524288000
FFMPEG_PATH=ffmpeg
YTDLP_PATH=yt-dlp
```

For local export and YouTube ingest, make sure `ffmpeg` and `yt-dlp` are installed and available on PATH, or set `FFMPEG_PATH` and `YTDLP_PATH`.

## Local Development

```bash
npm install
npm run dev
```

Visit:

```text
http://localhost:3000
```

## Supabase Setup

Create a `projects` table with columns matching the app payload:

- `id`
- `user_id`
- `title`
- `transcript`
- `clips`
- `utterances`
- `highlights`
- `video_filename`
- `duration`
- `created_at`

Enable Row Level Security and only allow users to read, insert, and delete their own rows.

## Production Notes

This repo now has a working first-pass FFmpeg export path. For a real public app, the next production upgrades should be:

- Move long FFmpeg jobs to a queue
- Store uploads and exports in object storage
- Add rate limits and abuse protection
- Add token refresh and better session handling
- Add progress polling for long exports
- Add automated tests for API routes and frontend flows

## Verification

Run:

```bash
npm run check
```

