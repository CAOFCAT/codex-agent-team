import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamState, saveTeam, teamRoot } from '../src/state.js';
import { main } from '../src/index.js';

async function makeTeam(workspace, phase = 'staged') {
  const state = createTeamState('Check dashboard opt-in', {
    members: [{ name: 'researcher', role: 'Research' }],
    tasks: [{ id: 'research', subject: 'Research', description: '', assignee: 'researcher', dependencies: [], acceptance: [], verify: [] }],
  });
  state.phase = phase;
  state.tasks[0].status = 'cancelled';
  const root = join(teamRoot(workspace), 'teams', state.id);
  await saveTeam(root, state);
  return state.id;
}

async function captureMain(args, dependencies) {
  let output = '';
  const originalLog = console.log;
  console.log = (value) => { output += `${value}\n`; };
  try {
    await main(args, dependencies);
  } finally {
    console.log = originalLog;
  }
  return JSON.parse(output);
}

test('approve starts and closes a dashboard only when the per-run flag is selected', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'codex-agent-team-dashboard-cli-'));
  const teamId = await makeTeam(workspace);
  const starts = [];
  const dependencies = {
    startDashboardServer: async (options) => {
      starts.push(options.teamId);
      return { url: 'http://127.0.0.1:44444/', close: async () => { starts.push('closed'); } };
    },
  };
  try {
    const cli = await captureMain(['approve', teamId, '--workspace', workspace, '--json'], dependencies);
    assert.equal(cli.team.phase, 'completed');
    assert.deepEqual(starts, []);

    const approvedTeamId = await makeTeam(workspace);
    const approvedWithDashboard = await captureMain(['approve', approvedTeamId, '--dashboard', '--workspace', workspace, '--json'], dependencies);
    assert.equal(approvedWithDashboard.dashboard.url, 'http://127.0.0.1:44444/');
    assert.deepEqual(starts, [approvedTeamId, 'closed']);

    const resumedTeamId = await makeTeam(workspace, 'halted');
    const resumedWithoutDashboard = await captureMain(['resume', resumedTeamId, '--workspace', workspace, '--json'], dependencies);
    assert.equal(resumedWithoutDashboard.dashboard, undefined);
    assert.deepEqual(starts, [approvedTeamId, 'closed']);

    const dashboardResumeTeamId = await makeTeam(workspace, 'halted');
    const enabled = await captureMain(['resume', dashboardResumeTeamId, '--dashboard', '--workspace', workspace, '--json'], dependencies);
    assert.equal(enabled.team.phase, 'completed');
    assert.equal(enabled.dashboard.url, 'http://127.0.0.1:44444/');
    assert.deepEqual(starts, [approvedTeamId, 'closed', dashboardResumeTeamId, 'closed']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
