import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/index.js';

test('create persists a staged plan without starting member processes', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'codex-agent-team-create-'));
  let output = '';
  const originalLog = console.log;
  console.log = (value) => { output += `${value}\n`; };
  try {
    await main(['create', '--goal', 'Implement login', '--workspace', workspace, '--json']);
  } finally {
    console.log = originalLog;
  }

  const response = JSON.parse(output);
  assert.match(response.message, /No members were started/);
  const teams = await readdir(join(workspace, '.codex-team', 'teams'));
  assert.equal(teams.length, 1);
  const state = JSON.parse(await readFile(join(workspace, '.codex-team', 'teams', teams[0], 'team.json'), 'utf8'));
  assert.equal(state.phase, 'staged');
  assert.equal(state.members.every((member) => member.pid === null), true);
});
