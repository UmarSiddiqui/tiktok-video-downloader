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

// Browsers request /favicon.ico by default; avoid noisy 404s in DevTools
app.get('/favicon.ico', (_req, res) => {
  res.type('image/svg+xml').send(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#f43f5e"/></svg>',
  );
});

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

// Strip tracking params (free reliability: cleaner URLs parse more consistently)
function normalizeTikTokUrl(url) {
  try {
    const u = new URL(String(url).trim());
    ['_r', '_t', 'is_from_webapp', 'is_copy_url', 'sender_device', 'sender_web_id'].forEach(k =>
      u.searchParams.delete(k),
    );
    u.hash = '';
    return u.href;
  } catch {
    return String(url).trim();
  }
}

// Whitelist for yt-dlp format strings — only allow safe characters
const SAFE_FORMAT_RE = /^[a-zA-Z0-9\[\]+=<>\/.,_\-*]+$/;

// Best quality format: prefer h264 mp4 with separate audio, fall back gracefully
const BEST_FORMAT = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/bestvideo+bestaudio/best';

// Extra resilience on slow / flaky networks (no cost)
const YTDLP_NETWORK_FLAGS = ['--retries', '5', '--fragment-retries', '15', '--extractor-retries', '5', '--socket-timeout', '30'];

// Base flags applied to every yt-dlp call:
//   --xff US              → spoof US IP to unlock full 1080p format list from TikTok's API
//   --extractor-args      → fallback API hostname in case the default is rate-limited
//   --proxy               → optional paid/residential proxy (YTDLP_PROXY)
const TIKTOK_BASE_FLAGS = [
  '--xff', 'US',
  '--extractor-args', 'tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com',
  ...(process.env.YTDLP_PROXY ? ['--proxy', process.env.YTDLP_PROXY] : []),
];

function runYtdlp(flagArgs, url, timeoutMs = 60000) {
  const args = [...flagArgs, ...YTDLP_NETWORK_FLAGS, ...TIKTOK_BASE_FLAGS, url];
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

// Cobalt API fallback — free tier: try several bases (comma-separated in COBALT_API_URLS).
// COBALT_API_URL (single) still supported for backwards compatibility.
const COBALT_BASES = (() => {
  const raw = process.env.COBALT_API_URLS || process.env.COBALT_API_URL || 'https://api.cobalt.tools';
  const parts = raw.split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  return [...new Set(parts)];
})();

function stderrText(stderr) {
  if (stderr == null) return '';
  const raw = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr);
  return raw.trim();
}

// Ask Cobalt for a download URL then stream the file to outPath (tries each base in COBALT_BASES).
async function cobaltDownload(tiktokUrl, outPath) {
  let lastErr;
  for (const base of COBALT_BASES) {
    try {
      const apiResp = await fetch(`${base}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ url: tiktokUrl }),
        signal: AbortSignal.timeout(22000),
      });
      const rawText = await apiResp.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(`Cobalt: non-JSON response (${apiResp.status})`);
      }
      if (!data.url) {
        throw new Error(`Cobalt: ${data.error?.code || data.status || 'no download URL'}`);
      }

      const fileResp = await fetch(data.url, { signal: AbortSignal.timeout(180000) });
      if (!fileResp.ok) throw new Error(`Cobalt stream failed: ${fileResp.status}`);

      await pipeline(Readable.fromWeb(fileResp.body), fs.createWriteStream(outPath));
      return;
    } catch (e) {
      lastErr = e;
      console.warn('cobalt endpoint failed:', base, e.message);
    }
  }
  throw lastErr || new Error('Cobalt: all endpoints failed');
}

const COBALT_QUALITIES_RESPONSE = Object.freeze({
  qualities: [{ label: 'Best quality', formatId: 'cobalt:best' }],
  title: null,
  via: 'cobalt',
});

// POST /api/formats — fetch available quality options for a URL
// Always responds 200 with either yt-dlp-derived qualities or a Cobalt single option so the UI never
// breaks on datacenter IP blocks, empty stderr, or flaky yt-dlp exits (common on Render).
app.post('/api/formats', async (req, res) => {
  const url = normalizeTikTokUrl(req.body?.url || '');
  if (!url || !TIKTOK_URL_RE.test(url)) {
    return res.status(400).json({ error: 'Please provide a valid TikTok URL.' });
  }

  try {
    const { stdout } = await runYtdlp(['-J', '--no-playlist'], url, 45000);
    const trimmed = (stdout || '').trim();
    if (!trimmed) {
      return res.json(COBALT_QUALITIES_RESPONSE);
    }

    let info;
    try {
      info = JSON.parse(trimmed);
    } catch {
      console.warn('formats: could not parse yt-dlp JSON, using Cobalt');
      return res.json(COBALT_QUALITIES_RESPONSE);
    }

    // yt-dlp prints JSON `null` when a post is blocked/unavailable but still exits 0 in some cases
    if (info == null || typeof info !== 'object') {
      return res.json(COBALT_QUALITIES_RESPONSE);
    }

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

    return res.json({ qualities, title: info.title || null });
  } catch (e) {
    const errLog = stderrText(e?.stderr).slice(0, 800);
    console.warn(
      'formats: yt-dlp error, using Cobalt',
      e?.err?.code,
      e?.err?.message || e?.message,
      errLog || '(no stderr)',
    );
    return res.json(COBALT_QUALITIES_RESPONSE);
  }
});

function probeBinary(bin, args, timeoutMs = 12000) {
  return new Promise(resolve => {
    execFile(bin, args, { timeout: timeoutMs }, (err, stdout) => {
      if (err) return resolve({ ok: false, path: bin, error: err.message });
      const line = (stdout || '').trim().split('\n')[0] || 'unknown';
      resolve({ ok: true, path: bin, version: line });
    });
  });
}

// GET /api/health — liveness + free-tier diagnostics (HTTP 200 unless process is broken)
app.get('/api/health', async (_req, res) => {
  const ytdlp = await probeBinary(YTDLP_BIN, ['--version']);
  const ffmpeg = await probeBinary(FFMPEG_BIN, ['-version']);
  const ready = ytdlp.ok && ffmpeg.ok;
  res.json({
    ok: true,
    ready,
    ytdlp,
    ffmpeg,
    cobaltEndpoints: COBALT_BASES.length,
    hint: ready
      ? 'Free tier: TikTok may still block datacenter IPs; Cobalt multi-endpoint + retries help.'
      : 'yt-dlp or ffmpeg not executable — check build logs and bin/ path.',
  });
});

// GET /render-workflows — basic backend healthcheck at a stable path
// (useful even when /api/* is proxied by a static host)
app.get('/render-workflows', (_req, res) => {
  res.json({ ok: true, service: 'tiktok-video-downloader' });
});

// POST /api/download — download TikTok video via yt-dlp
app.post('/api/download', async (req, res) => {
  const url = normalizeTikTokUrl(req.body?.url || '');
  const { formatId } = req.body;

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
      return res.status(500).json({
        error:
          'Could not download this clip. TikTok often blocks cloud servers even when the video is public. Try again later, another network, or a desktop VPN.',
      });
    }
  }

  const fmt = formatId || BEST_FORMAT;
  const outPath = path.join(TMP_DIR, `${id}.%(ext)s`);
  const cobaltOut = path.join(TMP_DIR, `${id}.mp4`);

  try {
    await runYtdlp(['-f', fmt, '--merge-output-format', 'mp4', '--no-playlist', '-o', outPath], url, 180000);
    const files = fs.readdirSync(TMP_DIR).filter(f => f.startsWith(id));
    if (!files.length) {
      throw new Error('yt-dlp produced no output file');
    }
    return res.json({ downloadUrl: `/api/files/${files[0]}` });
  } catch (e) {
    console.error('yt-dlp download failed:', stderrText(e?.stderr).slice(0, 2000) || e?.message || e);
    try {
      await cobaltDownload(url, cobaltOut);
      return res.json({ downloadUrl: `/api/files/${id}.mp4` });
    } catch (cobaltErr) {
      console.error('Cobalt error:', cobaltErr.message);
      return res.status(500).json({
        error:
          'Could not download this clip. TikTok often blocks cloud servers even when the video is public. Try again later, another network, or a desktop VPN.',
      });
    }
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
