const fs = require('fs');
const path = require('path');
const https = require('https');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const OUT = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function download(url, outPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath, { mode: 0o755 });
    const req = https.get(url, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(() => fs.rmSync(outPath, { force: true }));
        return resolve(download(res.headers.location, outPath));
      }
      if (res.statusCode !== 200) {
        file.close(() => fs.rmSync(outPath, { force: true }));
        return reject(new Error(`Download failed: ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', err => {
      file.close(() => fs.rmSync(outPath, { force: true }));
      reject(err);
    });
  });
}

/**
 * Download project-local yt-dlp with retries (free hosting: flaky GitHub / build networks).
 * @param {{ retries?: number, delayMs?: number }} opts
 * @returns {Promise<{ ok: boolean, path: string, cached?: boolean }>}
 */
async function ensureYtdlp(opts = {}) {
  const retries = opts.retries ?? 3;
  const delayMs = opts.delayMs ?? 2000;

  if (fs.existsSync(OUT)) {
    return { ok: true, path: OUT, cached: true };
  }

  ensureDir(BIN_DIR);

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await download(RELEASE_URL, OUT);
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(OUT, 0o755);
        } catch (_) {}
      }
      console.log(`yt-dlp downloaded to ${path.relative(process.cwd(), OUT)}`);
      return { ok: true, path: OUT };
    } catch (err) {
      lastErr = err;
      console.error(`yt-dlp download attempt ${attempt}/${retries} failed:`, err.message);
      if (attempt < retries) await sleep(delayMs * attempt);
    }
  }

  return { ok: false, path: OUT, error: lastErr?.message };
}

async function postinstallMain() {
  const r = await ensureYtdlp({ retries: 5, delayMs: 2500 });
  if (!r.ok) {
    console.error('Failed to download yt-dlp after retries:', r.error);
    console.error('The server will try again on startup (scripts/ensure-ytdlp.js).');
  }
  process.exitCode = 0;
}

if (require.main === module) {
  postinstallMain().catch(err => {
    console.error('postinstall yt-dlp:', err.message);
    process.exitCode = 0;
  });
}

module.exports = { ensureYtdlp, OUT, BIN_DIR };
