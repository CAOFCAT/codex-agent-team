import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamState, saveTeam, teamRoot } from '../src/state.js';
import { startDashboardServer } from '../src/dashboard.js';

async function createWorkspace() {
  const workspace = await mkdtemp(join(tmpdir(), 'codex-agent-team-dashboard-'));
  const state = createTeamState('Render live progress', {
    members: [{ name: 'researcher', role: 'Find facts' }],
    tasks: [{
      id: 'research', subject: 'Research pricing', description: 'Use official sources', assignee: 'researcher',
      dependencies: [], acceptance: ['Find the price'], verify: ['Check the source'],
    }],
  });
  const root = join(teamRoot(workspace), 'teams', state.id);
  await saveTeam(root, state);
  return { workspace, teamId: state.id, root };
}

test('dashboard serves its UI and a read-only snapshot for the selected team', async () => {
  const { workspace, teamId } = await createWorkspace();
  const openedUrls = [];
  const dashboard = await startDashboardServer({
    workspace,
    teamId,
    browserOpener: async (url) => { openedUrls.push(url); },
  });
  try {
    assert.match(dashboard.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.deepEqual(openedUrls, [dashboard.url]);

    const page = await fetch(dashboard.url);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /任务依赖/);
    assert.match(html, /队长收件箱/);
    assert.match(html, /api\/status/);

    const response = await fetch(new URL('/api/status', dashboard.url));
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.team.id, teamId);
    assert.equal(status.team.goal, 'Render live progress');
    assert.equal(status.team.tasks[0].subject, 'Research pricing');
    assert.equal(status.team.members[0].name, 'researcher');
  } finally {
    await dashboard.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('dashboard remains usable without a desktop browser and reports missing team state', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'codex-agent-team-dashboard-empty-'));
  const dashboard = await startDashboardServer({
    workspace,
    teamId: 'missing-team',
    browserOpener: async () => { throw new Error('no desktop browser'); },
  });
  try {
    assert.equal(dashboard.browserError, 'no desktop browser');
    const response = await fetch(new URL('/api/status', dashboard.url));
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'Team state not found');
  } finally {
    await dashboard.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('dashboard rejects team identifiers that could escape the local state directory', async () => {
  await assert.rejects(
    startDashboardServer({
      workspace: tmpdir(),
      teamId: '../package.json',
      browserOpener: async () => {},
    }),
    /Invalid team id/,
  );
});
