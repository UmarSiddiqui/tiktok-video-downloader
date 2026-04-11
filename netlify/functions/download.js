// Netlify serverless function — uses TikWM API (free, no key required).

const TIKTOK_URL_RE = /^https?:\/\/(www\.|vm\.|vt\.|m\.)?tiktok\.com\//;

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

  const url = (body.url || '').trim();
  if (!url || !TIKTOK_URL_RE.test(url)) {
    return json(400, { error: 'Please provide a valid TikTok URL.' });
  }

  try {
    const result = await tikwmDownload(url);
    return json(200, result);
  } catch (e) {
    console.error('Download failed:', e.message);
    return json(502, {
      error: 'Could not download this video. It may be private or deleted.',
    });
  }
};

async function tikwmDownload(tiktokUrl) {
  // TikWM works best with GET + url as query param
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}&hd=1`;

  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.tikwm.com/',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) throw new Error(`TikWM HTTP ${res.status}`);

  const data = await res.json();

  if (data.code !== 0 || !data.data) {
    throw new Error(`TikWM: ${data.msg || 'unknown error'}`);
  }

  const { play, hdplay, wmplay, title } = data.data;

  // Prefer HD no-watermark → SD no-watermark → watermarked
  const downloadUrl = hdplay || play || wmplay;
  if (!downloadUrl) throw new Error('No download URL in TikWM response');

  return {
    downloadUrl,
    title: title || 'tiktok-video',
    source: 'tikwm',
  };
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
