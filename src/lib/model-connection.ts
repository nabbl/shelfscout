/** Shared connection settings for recommendations and the uncached Settings probe. */
export function modelConnection() {
  const model = process.env.MODEL_NAME?.trim();
  const url = process.env.MODEL_BASE_URL?.trim();
  if (!model || !url) throw new Error('AI model is not configured. Set MODEL_BASE_URL and MODEL_NAME on the server.');
  let base: URL;
  try { base = new URL(url); } catch { throw new Error('Invalid AI endpoint. Check MODEL_BASE_URL on the server.'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error('Invalid AI endpoint. Use an HTTP or HTTPS base URL without credentials, query parameters or fragments.');
  return {
    model,
    endpoint: new URL('chat/completions', base.href.endsWith('/') ? base.href : `${base.href}/`),
    headers: { 'Content-Type': 'application/json', ...(process.env.MODEL_API_KEY ? { Authorization: `Bearer ${process.env.MODEL_API_KEY}` } : {}) },
  };
}

export async function testModelConnection() {
  const { model, endpoint, headers } = modelConnection();
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(45_000), headers,
      body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, max_tokens: 256, messages: [
        { role: 'system', content: 'This is a connection test. Return only the JSON object {"ok":true}.' },
        { role: 'user', content: 'Confirm that you can respond with JSON.' },
      ] }),
    });
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
      throw new Error('AI model did not respond within 45 seconds. Check that the model server is running and try again.');
    throw new Error('Could not reach the AI model. Check MODEL_BASE_URL and that the model server is reachable from ShelfScout.');
  }
  if (!response.ok) {
    const advice = response.status === 401 || response.status === 403 ? 'Check MODEL_API_KEY and access to the configured model.'
      : response.status === 404 ? 'Check MODEL_BASE_URL and MODEL_NAME.'
      : response.status === 429 ? 'The provider is rate limited or out of quota. Check your allowance and retry.'
      : response.status === 400 || response.status === 422 ? 'Check that the configured model supports chat completions and JSON responses.'
      : 'Check the model server and try again.';
    throw new Error(`AI connection failed (HTTP ${response.status}). ${advice}`);
  }
  try {
    const raw = await response.text();
    if (raw.length > 300_000) throw new Error('Oversized response');
    const content = JSON.parse(raw)?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || JSON.parse(content)?.ok !== true) throw new Error('Unexpected response');
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
      throw new Error('AI model did not finish responding within 45 seconds. Try again.');
    throw new Error('The AI server responded, but the model did not return the expected JSON. Check model compatibility with JSON responses.');
  }
  return { model, elapsedMs: Date.now() - started };
}
