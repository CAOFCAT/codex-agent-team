import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const enabled = process.env.RUN_CODEX_INTEGRATION_TESTS === '1';

function run(args, workspace) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)), ...args], {
      cwd: workspace,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => code === 0
      ? resolveResult(stdout)
      : reject(new Error(`command exited ${code}: ${stderr}`)));
  });
}

test('live Codex member completes a task in an isolated workspace', { skip: !enabled, timeout: 5 * 60 * 1000 }, async () => {
  const repoRoot = process.env.CODEX_AGENT_TEAM_TEST_REPO;
  if (!repoRoot) throw new Error('CODEX_AGENT_TEAM_TEST_REPO must point to a trusted Git repository');
  const workspace = await mkdtemp(join(repoRoot, '.codex-agent-team-live-'));
  try {
  const planPath = join(workspace, 'plan.json');
  await writeFile(planPath, JSON.stringify({
    members: [{ name: 'smoke', role: 'Return the requested smoke-test token.' }],
    tasks: [{
      id: 'smoke',
      subject: 'Codex CLI runtime smoke test',
      description: 'Return the exact text AGENT-TEAM-SMOKE-OK and do not modify files.',
      assignee: 'smoke',
      dependencies: [],
      acceptance: ['The final response contains AGENT-TEAM-SMOKE-OK.'],
      verify: ['Do not modify files.'],
    }],
  }), 'utf8');

  const created = JSON.parse(await run(['create', '--goal', 'Verify the Agent Team runtime.', '--plan', planPath, '--json'], workspace));
  const teamId = created.team.id;
  const approved = JSON.parse(await run(['approve', teamId, '--json'], workspace));
  assert.equal(approved.team.phase, 'completed');
  assert.match(approved.team.tasks[0].output, /AGENT-TEAM-SMOKE-OK/);
  const state = JSON.parse(await readFile(join(workspace, '.codex-team', 'teams', teamId, 'team.json'), 'utf8'));
  assert.equal(state.tasks[0].status, 'completed');
  assert.ok(state.members[0].runId);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
