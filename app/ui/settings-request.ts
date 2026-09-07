/** Keep settings failures visible even when a proxy returns HTML instead of JSON. */
export async function settingsRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(65_000) });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`The server returned an unexpected response (HTTP ${response.status}). Check the connection and try again.`);
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
  }
  return data;
}
