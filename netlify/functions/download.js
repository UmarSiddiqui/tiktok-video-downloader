// Netlify serverless function — extracts TikTok video URL for direct browser download.
// No API key required.

const TIKTOK_URL_RE = /^https?:\/\/(www\.|vm\.|vt\.|m\.)?tiktok\.com\//;

// User agents to rotate (helps bypass blocks)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  let url = (body.url || '').trim();
  if (!url || !TIKTOK_URL_RE.test(url)) {
    return json(400, { error: 'Please provide a valid TikTok URL.' });
  }

  // Normalize URL to web version
  url = url.replace(/^https?:\/\/(m\.|vm\.|vt\.)?tiktok\.com/, 'https://www.tiktok.com');

  try {
    const videoUrl = await extractVideoUrl(url);
    if (!videoUrl) {
      throw new Error('Could not extract video URL');
    }
    return json(200, { downloadUrl: videoUrl, source: 'tiktok' });
  } catch (e) {
    console.error('Video extraction failed:', e.message);
    return json(502, {
      error: 'Could not download this video. The video may be private, deleted, or TikTok is blocking requests.',
      detail: e.message,
    });
  }
};

async function extractVideoUrl(tiktokUrl) {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  const response = await fetch(tiktokUrl, {
    headers: {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();

  // Pattern 1: Look for __NEXT_DATA__
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const videoUrl = findVideoUrl(data);
      if (videoUrl) {
        console.log('Found video URL in __NEXT_DATA__');
        return videoUrl;
      }
    } catch (e) {
      console.warn('__NEXT_DATA__ parse error:', e.message);
    }
  }

  // Pattern 2: Look for direct video URLs
  const videoUrlMatch = html.match(/https?:\/\/[^\s"'<>]+\.tiktokv\.com\/[^\s"'<>]+/);
  if (videoUrlMatch) {
    console.log('Found direct video URL in HTML');
    return videoUrlMatch[0];
  }

  // Pattern 3: Look for escaped URLs
  const escapedMatch = html.match(/"(?:downloadAddr|playAddr)":"([^"\\]+(?:\\u002F[^"\\]+)*)"/);
  if (escapedMatch) {
    const url = escapedMatch[1].replace(/\\\//g, '/');
    if (url.startsWith('http')) {
      console.log('Found escaped video URL');
      return url;
    }
  }

  throw new Error('Video URL not found in page - TikTok may be blocking this request');
}

function findVideoUrl(obj, depth = 0) {
  if (depth > 15) return null;
  if (!obj || typeof obj !== 'object') return null;

  if (obj.downloadAddr && typeof obj.downloadAddr === 'string' && obj.downloadAddr.includes('tiktokv.com')) {
    return obj.downloadAddr;
  }
  if (obj.playAddr && typeof obj.playAddr === 'string' && obj.playAddr.includes('tiktokv.com')) {
    return obj.playAddr;
  }

  for (const key in obj) {
    const result = findVideoUrl(obj[key], depth + 1);
    if (result) return result;
  }
  return null;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
