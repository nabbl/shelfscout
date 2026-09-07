import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { UpstreamAuthError } from './upstream-errors';

type Credentials = { username: string; password: string };
type Session = { accessToken?: string; refreshToken?: string; expiresAt: number; pending?: Promise<string>; error?: UpstreamAuthError; retryAt: number };
// Each process has its own refresh session. Web and worker never rotate the same cookie.
const sessions = new Map<string, Session>();

function credentials(): Credentials | null {
  const username = process.env.BOOKORBIT_USERNAME?.trim() || '';
  let password = process.env.BOOKORBIT_PASSWORD || '';
  if (process.env.BOOKORBIT_PASSWORD_FILE) {
    try {
      password = readFileSync(process.env.BOOKORBIT_PASSWORD_FILE, 'utf8').replace(/\r?\n$/, '');
    } catch { throw new UpstreamAuthError('Could not read BOOKORBIT_PASSWORD_FILE. Check the file and its permissions.'); }
  }
  if (!username && !password) return null;
  if (!username || !password) throw new UpstreamAuthError('Set both BOOKORBIT_USERNAME and BOOKORBIT_PASSWORD (or BOOKORBIT_PASSWORD_FILE).');
  if (username.length > 100 || password.length > 1024) throw new UpstreamAuthError('BookOrbit credentials exceed the supported length.');
  return { username, password };
}

export function bookOrbitAuthenticationMode() {
  return credentials() ? 'password' : process.env.BOOKORBIT_TOKEN ? 'token' : 'unconfigured';
}

type Authentication = { mode: 'token' | 'password'; token(rejectedToken?: string): Promise<string | undefined>; reject(): void };

export function bookOrbitAuth(base: URL, explicitToken?: string): Authentication {
  const login = explicitToken === undefined ? credentials() : null;
  const manualToken = explicitToken ?? process.env.BOOKORBIT_TOKEN;
  if (!login) return { mode: 'token' as const, token: async () => manualToken, reject: () => {} };
  const key = createHash('sha256').update(JSON.stringify([base.href, login.username, login.password])).digest('hex');
  let session = sessions.get(key);
  if (!session) {
    if (sessions.size >= 8) sessions.delete(sessions.keys().next().value!);
    session = { expiresAt: 0, retryAt: 0 }; sessions.set(key, session);
  }
  const state = session;
  const reject = () => {
    state.accessToken = undefined; state.refreshToken = undefined; state.expiresAt = 0;
    state.error = new UpstreamAuthError('BookOrbit rejected the renewed session. Check the account and login settings. Authentication retries are paused for 15 minutes.');
    state.retryAt = Date.now() + 15 * 60000;
  };
  async function exchange(refreshToken?: string): Promise<Response> {
    const path = refreshToken ? '/auth/refresh' : '/auth/login';
    try {
      return await fetch(new URL(`${base.pathname.replace(/\/$/, '')}/api/v1${path}`, base.origin), {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(refreshToken ? { Cookie: `refresh_token=${refreshToken}` } : {}) },
        body: JSON.stringify(refreshToken ? {} : login),
      });
    } catch { throw new UpstreamAuthError('BookOrbit authentication could not connect. Check the URL, TLS certificate and network.'); }
  }
  async function renew(): Promise<string> {
    try {
      let response: Response | undefined;
      if (state.refreshToken) {
        const refreshToken = state.refreshToken;
        // Never reuse a possibly rotated cookie after a lost response.
        state.refreshToken = undefined;
        response = await exchange(refreshToken);
        if (response.status === 401) { await response.body?.cancel(); response = undefined; }
      }
      response ??= await exchange();
      if (!response.ok) {
        state.retryAt = Date.now() + ([401,403,429].includes(response.status) ? 15 * 60000 : 30000);
        const message = response.status === 401 ? 'Check the username and password, or whether the account is locked.'
          : response.status === 403 ? 'Password login may be disabled or the account may be restricted. Check BookOrbit login settings.'
          : response.status === 429 ? 'BookOrbit is limiting login attempts. Wait before retrying.' : 'Check BookOrbit and its reverse proxy.';
        await response.body?.cancel();
        throw new UpstreamAuthError(`BookOrbit login/refresh failed (HTTP ${response.status}). ${message} Authentication retries are temporarily paused.`);
      }
      let data;
      try { data = await response.json(); } catch { throw new UpstreamAuthError('BookOrbit login returned an invalid response.'); }
      const token = data?.accessToken;
      let expiresAt = 0;
      try {
        if (typeof token !== 'string' || token.length > 8192 || token.split('.').length !== 3) throw new Error();
        // exp only schedules renewal; BookOrbit validates the actual token on requests.
        expiresAt = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp * 1000;
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error();
      } catch { throw new UpstreamAuthError('BookOrbit login did not return a valid, unexpired access token.'); }
      const cookie = response.headers.getSetCookie().find(value => value.startsWith('refresh_token='));
      const refreshToken = cookie?.split(';', 1)[0].slice('refresh_token='.length);
      if (refreshToken && /^[A-Za-z0-9._~%+/-]+$/.test(refreshToken) && refreshToken.length <= 8192) state.refreshToken = refreshToken;
      state.accessToken = token; state.expiresAt = expiresAt; state.error = undefined; state.retryAt = 0;
      return token;
    } catch (error) {
      state.accessToken = undefined; state.expiresAt = 0;
      state.error = error instanceof UpstreamAuthError ? error : new UpstreamAuthError('BookOrbit authentication failed. Check the credentials and login settings.');
      state.retryAt = Math.max(state.retryAt, Date.now() + 30000);
      throw state.error;
    }
  }
  return {
    mode: 'password' as const, reject,
    async token(rejectedToken?: string): Promise<string> {
      if (state.error && Date.now() < state.retryAt) throw state.error;
      if (state.pending) return state.pending;
      if (state.accessToken && state.accessToken !== rejectedToken && state.expiresAt > Date.now() + 30000) return state.accessToken;
      state.pending = renew();
      try { return await state.pending; } finally { state.pending = undefined; }
    },
  };
}
