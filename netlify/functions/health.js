export async function handler() {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      mode: 'serverless',
      cobaltEndpoints: (process.env.COBALT_API_URLS || process.env.COBALT_API_URL || 'https://api.cobalt.tools')
        .split(',').filter(Boolean).length,
    }),
  };
}
