import { expect,it,vi,afterEach } from 'vitest';
import { createSession,validSession } from '../src/lib/auth';
afterEach(()=>vi.unstubAllEnvs());
it('requires a real signing secret during local development too',async()=>{vi.stubEnv('NODE_ENV','development');vi.stubEnv('SESSION_SECRET','');await expect(createSession()).rejects.toThrow('SESSION_SECRET');expect(await validSession('forged')).toBe(false);vi.stubEnv('SESSION_SECRET','a-random-test-secret-with-at-least-32-characters');const session=await createSession();expect(await validSession(session)).toBe(true);vi.stubEnv('SESSION_SECRET','another-test-secret-with-at-least-32-characters');expect(await validSession(session)).toBe(false);});
