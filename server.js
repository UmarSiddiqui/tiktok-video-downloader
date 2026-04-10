const express = require('express');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const ffmpeg = require('fluent-ffmpeg');
const { randomUUID: uuidv4 } = require('crypto');
const { execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const TMP_DIR = path.join(__dirname, 'tmp');

// Render/Netlify sit behind proxies; trust X-Forwarded-* headers
app.set('trust proxy', 1);

// Binaries:
// - Prefer env overrides (advanced)
// - Prefer project-local yt-dlp downloaded during install
// - Prefer ffmpeg-static when installed
function resolveYtdlpBin() {
  if (process.env.YTDLP_BIN) return process.env.YTDLP_BIN;
  const local = path.join(__dirname, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(local)) return local;
  return 'yt-dlp';
}

function resolveFfmpegBin() {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  try {
    // ffmpeg-static returns an absolute path to ffmpeg binary for the current platform
    // eslint-disable-next-line global-require
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) return ffmpegStatic;
  } catch (_) {}
  return 'ffmpeg';
}

const YTDLP_BIN = resolveYtdlpBin();
const FFMPEG_BIN = resolveFfmpegBin();

// Ensure tmp dir exists
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// Tell fluent-ffmpeg where ffmpeg lives
ffmpeg.setFfmpegPath(FFMPEG_BIN);

// Optional: auto-update yt-dlp on startup (off by default in production)
if (process.env.YTDLP_AUTO_UPDATE === '1') {
  execFile(YTDLP_BIN, ['-U'], (err, stdout) => {
    if (err) console.log('yt-dlp update skipped:', err.message);
    else console.log('yt-dlp:', stdout.trim().split('\n').pop());
  });
}

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "blob:", "data:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
    },
  },
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' },
});
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
  'video/x-matroska', 'video/mpeg', 'video/ogg', 'video/3gpp',
]);

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_VIDEO_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed.'));
    }
  },
});

const TIKTOK_URL_RE = /^https?:\/\/(www\.|vm\.|vt\.)?tiktok\.com\//;

// Whitelist for yt-dlp format strings — only allow safe characters
const SAFE_FORMAT_RE = /^[a-zA-Z0-9\[\]+=<>\/.,_\-*]+$/;

// Best quality format: prefer h264 mp4 with separate audio, fall back gracefully
const BEST_FORMAT = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/bestvideo+bestaudio/best';

// Base flags applied to every yt-dlp call:
//   --xff US              → spoof US IP to unlock full 1080p format list from TikTok's API
//   --extractor-args      → fallback API hostname in case the default is rate-limited
//   --proxy               → route through a residential/SOCKS proxy to avoid cloud IP bans
const TIKTOK_BASE_FLAGS = [
  '--xff', 'US',
  '--extractor-args', 'tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com',
  ...(process.env.YTDLP_PROXY ? ['--proxy', process.env.YTDLP_PROXY] : []),
];

function runYtdlp(flagArgs, url, timeoutMs = 60000) {
  const args = [...flagArgs, ...TIKTOK_BASE_FLAGS, url];
  return new Promise((resolve, reject) => {
    execFile(YTDLP_BIN, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout, stderr });
      reject({ err, stderr });
    });
  });
}

// Cleanup: delete tmp files older than 10 minutes
function cleanupTmp() {
  const now = Date.now();
  try {
    for (const entry of fs.readdirSync(TMP_DIR)) {
      const fullPath = path.join(TMP_DIR, entry);
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > 10 * 60 * 1000) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }
  } catch (_) {}
}
cleanupTmp();
setInterval(cleanupTmp, 5 * 60 * 1000);

// Cobalt API fallback — free public instance, no key required.
// Override with COBALT_API_URL to point at a self-hosted Cobalt instance.
const COBALT_API = (process.env.COBALT_API_URL || 'https://api.cobalt.tools').replace(/\/$/, '');

function isIpBlocked(stderr) {
  return !!stderr && stderr.includes('IP address is blocked');
}

// Ask Cobalt for a download URL then stream the file to outPath.
async function cobaltDownload(tiktokUrl, outPath) {
  const apiResp = await fetch(`${COBALT_API}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ url: tiktokUrl }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await apiResp.json();
  if (!data.url) throw new Error(`Cobalt: ${data.error?.code || data.status || 'no download URL'}`);

  const fileResp = await fetch(data.url, { signal: AbortSignal.timeout(120000) });
  if (!fileResp.ok) throw new Error(`Cobalt stream failed: ${fileResp.status}`);

  await pipeline(Readable.fromWeb(fileResp.body), fs.createWriteStream(outPath));
}

function parseYtdlpError(stderr) {
  if (!stderr) return 'Download failed.';
  if (stderr.includes('IP address is blocked')) return 'TikTok blocked this download (IP restricted). Try a VPN or a different network.';
  if (stderr.includes('Private video')) return 'This video is private and cannot be downloaded.';
  if (stderr.includes('This video is unavailable')) return 'This video is unavailable.';
  if (stderr.includes('Unable to extract')) return 'Could not extract video info. The URL may be invalid or the video may have been deleted.';
  // Surface the last ERROR line from yt-dlp output, stripped of paths
  const errorLine = stderr.split('\n').filter(l => l.includes('ERROR:')).pop();
  if (errorLine) {
    return errorLine
      .replace(/.*ERROR:\s*\[.*?\]\s*/, '')
      .replace(/\/[\w/.\-]+/g, '[path]')  // strip filesystem paths
      .trim();
  }
  return 'Failed to download video. Check the URL and try again.';
}

// POST /api/formats — fetch available quality options for a URL
app.post('/api/formats', async (req, res) => {
  const { url } = req.body;
  if (!url || !TIKTOK_URL_RE.test(url)) {
    return res.status(400).json({ error: 'Please provide a valid TikTok URL.' });
  }

  try {
    const { stdout } = await runYtdlp(['-J', '--no-playlist'], url, 30000);
    const info = JSON.parse(stdout);
    const formats = info.formats || [];

    const seen = new Set();
    const qualities = [{ label: 'Best quality', formatId: BEST_FORMAT }];

    formats
      .filter(f => f.height && f.vcodec && f.vcodec !== 'none')
      .sort((a, b) => b.height - a.height)
      .forEach(f => {
        if (!seen.has(f.height)) {
          seen.add(f.height);
          qualities.push({
            label: `${f.height}p`,
            formatId: `bestvideo[height<=${f.height}]+bestaudio/best[height<=${f.height}]/best`,
          });
        }
      });

    res.json({ qualities, title: info.title || null });
  } catch (e) {
    // If TikTok blocked the server's IP, fall back to Cobalt (best quality only)
    if (isIpBlocked(e.stderr)) {
      return res.json({
        qualities: [{ label: 'Best quality', formatId: 'cobalt:best' }],
        title: null,
        via: 'cobalt',
      });
    }
    res.status(500).json({ error: parseYtdlpError(e.stderr) });
  }
});

// GET /api/health — basic healthcheck for frontend/proxy debugging
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// GET /render-workflows — basic backend healthcheck at a stable path
// (useful even when /api/* is proxied by a static host)
app.get('/render-workflows', (_req, res) => {
  res.json({ ok: true, service: 'tiktok-video-downloader' });
});

// POST /api/download — download TikTok video via yt-dlp
app.post('/api/download', async (req, res) => {
  const { url, formatId } = req.body;

  if (!url || !TIKTOK_URL_RE.test(url)) {
    return res.status(400).json({ error: 'Please provide a valid TikTok URL.' });
  }

  const useCobalt = formatId === 'cobalt:best';

  if (!useCobalt && formatId && !SAFE_FORMAT_RE.test(formatId)) {
    return res.status(400).json({ error: 'Invalid format selection.' });
  }

  const id = uuidv4();

  // Direct Cobalt path (chosen by frontend when yt-dlp was already blocked at /api/formats)
  if (useCobalt) {
    const outPath = path.join(TMP_DIR, `${id}.mp4`);
    try {
      await cobaltDownload(url, outPath);
      return res.json({ downloadUrl: `/api/files/${id}.mp4` });
    } catch (err) {
      console.error('Cobalt error:', err.message);
      return res.status(500).json({ error: 'Download failed via fallback. The video may be private or unavailable.' });
    }
  }

  const fmt = formatId || BEST_FORMAT;
  const outPath = path.join(TMP_DIR, `${id}.%(ext)s`);

  try {
    await runYtdlp(['-f', fmt, '--merge-output-format', 'mp4', '--no-playlist', '-o', outPath], url, 120000);
    const files = fs.readdirSync(TMP_DIR).filter(f => f.startsWith(id));
    if (!files.length) return res.status(500).json({ error: 'Download failed — output file not found.' });
    res.json({ downloadUrl: `/api/files/${files[0]}` });
  } catch (e) {
    console.error('yt-dlp error:', e.stderr);
    // Cobalt fallback when yt-dlp gets IP-blocked mid-download
    if (isIpBlocked(e.stderr)) {
      const cobaltPath = path.join(TMP_DIR, `${id}.mp4`);
      try {
        await cobaltDownload(url, cobaltPath);
        return res.json({ downloadUrl: `/api/files/${id}.mp4` });
      } catch (cobaltErr) {
        console.error('Cobalt fallback error:', cobaltErr.message);
        return res.status(500).json({ error: 'Download failed via fallback. The video may be private or unavailable.' });
      }
    }
    res.status(500).json({ error: parseYtdlpError(e.stderr) });
  }
});

// POST /api/extract-frames — extract frames from uploaded video
app.post('/api/extract-frames', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded.' });
  }

  let frameCount = parseInt(req.body.frameCount, 10);
  let intervalMs = parseInt(req.body.intervalMs, 10);

  if (isNaN(frameCount) || frameCount < 1) frameCount = 5;
  if (isNaN(intervalMs) || intervalMs < 0) intervalMs = 1000;
  frameCount = Math.min(frameCount, 50);
  intervalMs = Math.min(intervalMs, 60000);

  const sessionId = uuidv4();
  const sessionDir = path.join(TMP_DIR, sessionId);
  fs.mkdirSync(sessionDir);

  const inputPath = req.file.path;

  // Build list of timestamps in seconds
  const timestamps = [];
  for (let i = 0; i < frameCount; i++) {
    timestamps.push((i * intervalMs) / 1000);
  }

  try {
    await extractFrames(inputPath, sessionDir, timestamps);
    // Clean up uploaded input file
    fs.unlink(inputPath, () => {});

    const frameFiles = fs.readdirSync(sessionDir).sort();
    const frameUrls = frameFiles.map(f => `/api/files/${sessionId}/${f}`);
    res.json({ frames: frameUrls });
  } catch (err) {
    console.error('Frame extraction error:', err);
    fs.unlink(inputPath, () => {});
    fs.rmSync(sessionDir, { recursive: true, force: true });
    res.status(500).json({ error: 'Failed to extract frames. Make sure ffmpeg is installed.' });
  }
});

function extractFrames(inputPath, outputDir, timestamps) {
  return new Promise((resolve, reject) => {
    const tasks = timestamps.map((ts, i) => {
      const outFile = path.join(outputDir, `frame_${String(i + 1).padStart(3, '0')}.png`);
      return new Promise((res, rej) => {
        ffmpeg(inputPath)
          .seekInput(ts)
          .frames(1)
          .output(outFile)
          .on('end', res)
          .on('error', rej)
          .run();
      });
    });

    Promise.all(tasks).then(resolve).catch(reject);
  });
}

// GET /api/files/:id — serve a file from tmp (flat)
app.get('/api/files/:id', (req, res) => {
  const id = path.basename(req.params.id);
  const filePath = path.join(TMP_DIR, id);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return res.status(404).json({ error: 'File not found.' });
  }
  res.download(filePath);
});

// GET /api/files/:sessionId/:filename — serve a frame from tmp/<sessionId>/
app.get('/api/files/:sessionId/:filename', (req, res) => {
  const sessionId = path.basename(req.params.sessionId);
  const filename = path.basename(req.params.filename);
  const filePath = path.join(TMP_DIR, sessionId, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }
  res.download(filePath);
});

// Handle multer errors (file too large, invalid type)
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err && err.message === 'Only video files are allowed.') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
