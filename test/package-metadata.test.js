import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('GitHub marketplace points to this standalone plugin and versions agree', async () => {
  const [marketplace, plugin, packageJson, license, gitignore] = await Promise.all([
    readFile(join(root, '.agents', 'plugins', 'marketplace.json'), 'utf8').then(JSON.parse),
    readFile(join(root, '.codex-plugin', 'plugin.json'), 'utf8').then(JSON.parse),
    readFile(join(root, 'package.json'), 'utf8').then(JSON.parse),
    readFile(join(root, 'LICENSE'), 'utf8'),
    readFile(join(root, '.gitignore'), 'utf8'),
  ]);
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].source.path, '.');
  assert.equal(marketplace.plugins[0].source.source, 'local');
  assert.equal(marketplace.plugins[0].name, plugin.name);
  assert.equal(packageJson.name, plugin.name);
  assert.equal(packageJson.version, plugin.version);
  assert.equal(plugin.license, 'MIT');
  assert.match(license, /MIT License/);
  assert.match(gitignore, /^\.codex-team\/$/m);
});
