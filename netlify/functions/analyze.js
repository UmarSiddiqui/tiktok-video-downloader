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
    // For now, we'll analyze using a frame-based approach
    // NVIDIA's API works best with images, so we'll describe what the video is about
    // based on metadata or use a vision model if we can get a frame

    const analysis = await analyzeWithNVIDIA(videoUrl, videoData, apiKey);
    return json(200, analysis);
  } catch (e) {
    console.error('AI analysis failed:', e.message);
    return json(502, {
      error: 'AI analysis failed. Please try again.',
    });
  }
};

async function analyzeWithNVIDIA(videoUrl, videoData, apiKey) {
  // Using NVIDIA's LLM API for content analysis
  // You can use models like: meta/llama-3.1-405b-instruct, meta/llama-3.3-70b-instruct, etc.

  const nvidiApiUrl = 'https://integrate.api.nvidia.com/v1/chat/completions';

  const prompt = videoData?.title
    ? `Analyze this TikTok video titled "${videoData.title}". Provide a brief description of what the video likely contains, suggest 3-5 relevant hashtags, and categorize the content (e.g., Comedy, Dance, Educational, Gaming, etc.). Keep it concise.`
    : `Analyze a TikTok video from URL: ${videoUrl}. Provide a brief description of what the video likely contains, suggest 3-5 relevant hashtags, and categorize the content. Keep it concise.`;

  const response = await fetch(nvidiApiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'meta/llama-3.1-405b-instruct',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful AI assistant that analyzes TikTok videos. Provide concise, accurate descriptions and relevant hashtags.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 300,
      stream: false
    }),
    signal: AbortSignal.timeout(30_000),
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
