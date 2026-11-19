import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withFileLock } from '../src/lock.js';

test('withFileLock serializes a critical section and removes the lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-agent-team-lock-'));
  const lockPath = join(root, 'team.lock');
  const result = await withFileLock(lockPath, async () => 'locked');

  assert.equal(result, 'locked');
  await assert.rejects(readFile(lockPath), { code: 'ENOENT' });
});

test('withFileLock rejects an active lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-agent-team-lock-'));
  const lockPath = join(root, 'team.lock');
  await withFileLock(lockPath, async () => {
    await assert.rejects(withFileLock(lockPath, async () => undefined), /locked by another process/);
  });
});
