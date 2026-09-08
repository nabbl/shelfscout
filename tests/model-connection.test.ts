import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testModelConnection } from '../src/lib/model-connection';

beforeEach(() => {
  vi.stubEnv('MODEL_BASE_URL', 'http://model.test/v1');
  vi.stubEnv('MODEL_NAME', 'test-model');
  vi.stubEnv('MODEL_API_KEY', 'private-key');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('makes a fresh authenticated JSON completion on every test and returns the model and timing', async () => {
  const fetchMock = vi.fn().mockImplementation(async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(testModelConnection()).resolves.toEqual({ model: 'test-model', elapsedMs: expect.any(Number) });
  await testModelConnection();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const [url, options] = fetchMock.mock.calls[0];
  expect(String(url)).toBe('http://model.test/v1/chat/completions');
  expect(options).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store', headers: { Authorization: 'Bearer private-key' } });
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(options.body)).toMatchObject({ model: 'test-model', response_format: { type: 'json_object' }, max_tokens: 256 });
  expect(JSON.parse(options.body).messages).toHaveLength(2);
});

it('allows local models without an API key', async () => {
  vi.stubEnv('MODEL_API_KEY', '');
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }));
  vi.stubGlobal('fetch', fetchMock);
  await testModelConnection();
  expect(new Headers(fetchMock.mock.calls[0][1].headers).has('authorization')).toBe(false);
});

it.each(['', 'not a URL', 'ftp://model.test', 'http://user:private-key@model.test', 'https://model.test/?token=private-key'])('rejects missing or invalid configuration before contacting %s', async url => {
  vi.stubEnv('MODEL_BASE_URL', url);
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  await expect(testModelConnection()).rejects.toThrow(/not configured|Invalid AI endpoint/);
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([[401, 'MODEL_API_KEY'], [403, 'MODEL_API_KEY'], [404, 'MODEL_NAME'], [429, 'quota'], [400, 'JSON'], [502, 'model server']])('explains HTTP %s without exposing provider output', async (status, advice) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private-key and upstream details', { status: Number(status) })));
  const error = await testModelConnection().catch(error => error);
  expect(error.message).toContain(String(advice));
  expect(error.message).not.toContain('private-key');
});

it.each(['<html>Login</html>', '{}', '{"choices":[{"message":{"content":"not JSON"}}]}', '{"choices":[{"message":{"content":"{\\"ok\\":false}"}}]}'])('does not confuse a reachable server with a working model: %s', async body => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  await expect(testModelConnection()).rejects.toThrow('did not return the expected JSON');
});

it.each([[new DOMException('private-key', 'TimeoutError'), 'within 45 seconds'], [new TypeError('private-key'), 'Could not reach']])('reports network failures safely', async (error, message) => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
  await expect(testModelConnection()).rejects.toThrow(String(message));
});
