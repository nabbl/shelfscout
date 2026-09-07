import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it('loads worker environment overrides and escaped dollars like Next.js', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shelfscout-env-'));
  try {
    writeFileSync(join(dir, '.env'), 'SHELFSCOUT_ENV_FIXTURE=base\n');
    writeFileSync(join(dir, '.env.local'), 'SHELFSCOUT_ENV_FIXTURE=local\\$password\n');
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development' };
    delete env.__NEXT_PROCESSED_ENV;
    delete env.SHELFSCOUT_ENV_FIXTURE;
    const args = ['--import', resolve('node_modules/tsx/dist/loader.mjs'), '--import', resolve('scripts/load-env.ts'), '-e', 'process.stdout.write(process.env.SHELFSCOUT_ENV_FIXTURE)'];
    expect(execFileSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8' })).toBe('local$password');
    rmSync(join(dir, '.env'));
    rmSync(join(dir, '.env.local'));
    expect(execFileSync(process.execPath, args, { cwd: dir, env: { ...env, SHELFSCOUT_ENV_FIXTURE: 'runtime$password' }, encoding: 'utf8' })).toBe('runtime$password');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
