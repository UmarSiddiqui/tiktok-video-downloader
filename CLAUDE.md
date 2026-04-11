# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A TikTok video downloader and frame extraction tool with a dual deployment model:
- **Express server** (`server.js`) for local development and Render deployment
- **Netlify serverless functions** (`netlify/functions/`) for serverless deployment
- **Static frontend** (`public/`) with vanilla JavaScript

## Development Commands

```bash
# Install dependencies and download yt-dlp binary
npm install

# Start the Express server (runs ensure-ytdlp.js then server.js)
npm start

# Server runs on PORT env var or defaults to 3000
PORT=8080 npm start
```

## Architecture

### Dual Backend Strategy

The codebase supports two deployment targets with different capabilities:

**Express Server (`server.js`)**
- Full-featured local/Render deployment
- Video download via yt-dlp with Cobalt fallback
- Frame extraction via ffmpeg (`/api/extract-frames`)
- File upload handling with multer (200MB limit)
- Temporary file storage in `tmp/` with auto-cleanup (10min expiry)
- Rate limiting: 15 requests/minute per IP

**Netlify Serverless Functions (`netlify/functions/`)**
- Lightweight serverless alternative
- Uses TikWM API for downloads (no yt-dlp dependency)
- No frame extraction support (requires ffmpeg/yt-dlp)
- Configured via `netlify.toml` with redirects from `/api/*`

### Download Pipeline

1. **Primary**: yt-dlp with US IP spoofing (`--xff US`) and TikTok API hostname fallback
2. **Secondary**: Cobalt API (multi-endpoint support via `COBALT_API_URLS` comma-separated)
3. **Tertiary** (Netlify): TikWM public API

### Binary Resolution

- **yt-dlp**: `bin/yt-dlp` (downloaded by `scripts/download-ytdlp.js` on postinstall)
- **ffmpeg**: Uses `ffmpeg-static` npm package
- Both can be overridden via env vars: `YTDLP_BIN`, `FFMPEG_BIN`

### Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `YTDLP_BIN` | Override yt-dlp binary path |
| `FFMPEG_BIN` | Override ffmpeg binary path |
| `YTDLP_PROXY` | HTTP proxy for yt-dlp requests |
| `COBALT_API_URLS` | Comma-separated Cobalt endpoints (fallback) |
| `PORT` | Server port (default: 3000) |
| `YTDLP_AUTO_UPDATE` | Set to `1` to auto-update yt-dlp on startup |

## File Structure

```
server.js              # Express server - video download, frame extraction
netlify/functions/     # Serverless functions (download.js, health.js)
public/                # Static frontend (vanilla JS, no build step)
scripts/               # Setup scripts for yt-dlp binary
tmp/                   # Runtime temp files (gitignored)
bin/                   # Downloaded yt-dlp binary (gitignored)
```

## Important Implementation Details

- **Format selection**: yt-dlp format strings are whitelisted via `SAFE_FORMAT_RE` (alphanumeric, brackets, operators)
- **TikTok URL normalization**: Tracking params stripped (`_r`, `_t`, `is_from_webapp`, etc.)
- **Network resilience**: yt-dlp runs with `--retries 5 --fragment-retries 15 --socket-timeout 30`
- **File serving**: Videos served from `/api/files/:id` with auto-cleanup
- **CSP headers**: Configured in Express to allow blob: and data: URLs for video preview

## Testing

```bash
# Health check
 curl http://localhost:3000/api/health

# Test download (requires valid TikTok URL)
curl -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.tiktok.com/@user/video/123"}'

# Test frame extraction (requires video file)
curl -X POST http://localhost:3000/api/extract-frames \
  -F "video=@test.mp4" \
  -F "frameCount=5"
```
