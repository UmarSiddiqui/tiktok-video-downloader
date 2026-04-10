#!/usr/bin/env node
/**
 * Runs before server.js: ensures bin/yt-dlp exists (retries for free-tier cold starts / flaky CI).
 */
const { ensureYtdlp } = require('./download-ytdlp');

(async () => {
  const r = await ensureYtdlp({ retries: 4, delayMs: 3000 });
  if (!r.ok) {
    console.error(
      'WARNING: yt-dlp is still missing. Video download will rely on Cobalt only until the binary installs.',
    );
  }
})();
