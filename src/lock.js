import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function withFileLock(lockPath, fn, { staleMs = 5 * 60 * 1000 } = {}) {
  await mkdir(dirname(lockPath), { recursive: true });
  let handle;

  try {
    handle = await open(lockPath, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf8');
  } catch (error) {
    if (error?.code === 'EEXIST') {
      let stale = false;
      try {
        const info = await stat(lockPath);
        stale = Date.now() - info.mtimeMs > staleMs;
      } catch {
        stale = false;
      }
      if (stale) {
        await unlink(lockPath).catch(() => undefined);
        return withFileLock(lockPath, fn, { staleMs });
      }
      let owner = '';
      try {
        owner = await readFile(lockPath, 'utf8');
      } catch {
        owner = 'unknown owner';
      }
      throw new Error(`team runtime is locked by another process (${owner})`);
    }
    throw error;
  }

  try {
    return await fn();
  } finally {
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
}
