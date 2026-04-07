const fs = require('fs');
const path = require('path');
const https = require('https');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const OUT = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

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

async function main() {
  // No-op if already present
  if (fs.existsSync(OUT)) return;

  ensureDir(BIN_DIR);

  // "latest" is fine here; you can pin later if needed.
  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
  await download(url, OUT);
  // Ensure executable bit on *nix
  try {
    if (process.platform !== 'win32') fs.chmodSync(OUT, 0o755);
  } catch (_) {}
  console.log(`yt-dlp downloaded to ${path.relative(process.cwd(), OUT)}`);
}

main().catch(err => {
  console.error('Failed to download yt-dlp:', err.message);
  process.exitCode = 0; // do not hard-fail installs; runtime will surface missing binary
});
