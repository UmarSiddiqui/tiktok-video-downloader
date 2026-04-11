// Netlify function — AI video analysis using NVIDIA API

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'AI service not configured' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const { videoUrl, videoData } = body;

  try {
    const analysis = await analyzeWithNVIDIA(videoUrl, videoData, apiKey);
    return json(200, analysis);
  } catch (e) {
    console.error('AI analysis failed:', e.message);
    if (e.name === 'AbortError' || e.message?.includes('timeout')) {
      return json(504, {
        error: 'AI analysis timed out. The service may be busy. Please try again.',
      });
    }
    return json(502, {
      error: 'AI analysis failed. Please try again.',
    });
  }
};

async function analyzeWithNVIDIA(videoUrl, videoData, apiKey) {
  // Using NVIDIA's LLM API for content analysis
  // Using smaller/faster model to stay within Netlify's 10s timeout

  const nvidiApiUrl = 'https://integrate.api.nvidia.com/v1/chat/completions';

  // Build a concise prompt
  const title = videoData?.title || '';
  const prompt = title
    ? `TikTok video: "${title}". Give me: 1) Brief description 2) Category 3) 3-5 hashtags. Be concise.`
    : `TikTok video. Give me: 1) Brief description 2) Category 3) 3-5 hashtags. Be concise.`;

  const response = await fetch(nvidiApiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'meta/llama-3.3-70b-instruct', // Smaller, faster model
      messages: [
        {
          role: 'system',
          content: 'You analyze TikTok videos. Respond with description, category, and hashtags only. Keep under 100 words.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.5,
      top_p: 0.7,
      max_tokens: 150,
      stream: false
    }),
    signal: AbortSignal.timeout(8_000), // Stay under Netlify's 10s limit
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`NVIDIA API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const aiResponse = data.choices?.[0]?.message?.content || '';

  // Parse the response
  const lines = aiResponse.split('\n').filter(l => l.trim());
  const description = lines.find(l => !l.startsWith('#') && !l.toLowerCase().includes('category')) || aiResponse.slice(0, 200);

  const hashtags = lines
    .filter(l => l.includes('#'))
    .flatMap(l => l.match(/#[\w]+/g) || [])
    .slice(0, 5);

  const category = lines.find(l => l.toLowerCase().includes('category'))?.replace(/.*category[:\s]*/i, '') || 'General';

  return {
    description: description.trim(),
    hashtags: hashtags.length ? hashtags : ['#TikTok', '#Video'],
    category: category.trim(),
    rawResponse: aiResponse,
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
