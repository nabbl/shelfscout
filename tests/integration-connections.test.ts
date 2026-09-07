import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookOrbitClient } from '../src/lib/bookorbit';
import { ShelfmarkClient } from '../src/lib/shelfmark';
import { settingsRequest } from '../app/ui/settings-request';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('integration connection diagnostics', () => {
  it('retries the encoded saved Shelfmark task through its retry endpoint', async () => {
    const id = 'saved/task';
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'queued', book_id: id }));
    vi.stubGlobal('fetch', fetchMock);
    await new ShelfmarkClient('http://shelfmark.test/base', '').retryDownload(id);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://shelfmark.test/base/api/download/saved%2Ftask/retry');
    expect(options.method).toBe('POST');
    expect(options.body).toBeUndefined();
    expect(options.redirect).toBe('error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([{ status: 'queued', book_id: 'another-task' }, { status: 'error', book_id: 'saved-task' }])('does not treat an incompatible retry response as confirmation', async response => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new ShelfmarkClient('http://shelfmark.test', '').retryDownload('saved-task')).rejects.toThrow('retry outcome is unknown');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('tests Shelfmark without a cookie when authentication is disabled', async () => {
    vi.stubEnv('SHELFMARK_COOKIE', '');
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new ShelfmarkClient('http://shelfmark.test').test()).resolves.toEqual({ activityAccessible: true });
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://shelfmark.test/api/activity/snapshot');
    expect(new Headers(options.headers).has('cookie')).toBe(false);
    expect(options.redirect).toBe('error');
  });
  it('keeps configured Shelfmark sessions and reports expired authentication', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('private upstream body', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new ShelfmarkClient('http://shelfmark.test', 'session=secret').test()).rejects.toThrow('SHELFMARK_COOKIE');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('cookie')).toBe('session=secret');
  });
  it('rejects a successful but incompatible Shelfmark response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ login: true })));
    await expect(new ShelfmarkClient('http://shelfmark.test').test()).rejects.toThrow('activity contract');
  });
  it.each([401, 403, 404, 502])('explains BookOrbit HTTP %s without leaking upstream details', async status => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('private token=secret', { status }));
    vi.stubGlobal('fetch', fetchMock);
    const error = await new BookOrbitClient('secret', 'http://bookorbit.test/base').test().catch(error => error);
    if (!(error instanceof Error)) throw new Error('Expected a connection error');
    expect(error.message).toContain(`BookOrbit HTTP ${status} at /book-dock/summary`);
    expect(error.message).not.toContain('secret');
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://bookorbit.test/base/api/v1/book-dock/summary');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('authorization')).toBe('Bearer secret');
  });
  it.each([['ENOTFOUND', 'hostname could not be resolved'], ['ECONNREFUSED', 'connection was refused']])('explains %s safely', async (code, message) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('secret upstream details', { cause: { code } })));
    await expect(new BookOrbitClient('secret', 'http://bookorbit.test').test()).rejects.toThrow(message);
  });
  it('handles non-JSON gateway errors in Settings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<h1>Bad Gateway</h1>', { status: 502 })));
    await expect(settingsRequest('/api/integrations/bookorbit')).rejects.toThrow('HTTP 502');
  });
});
