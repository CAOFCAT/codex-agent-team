import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDefaultPlan,
  createTeamState,
  findReadyTasks,
  transitionTask,
  validatePlan,
  saveTeam,
} from '../src/state.js';

test('default plan creates a dependency chain without cycles', () => {
  const plan = createDefaultPlan('Implement login');

  assert.deepEqual(plan.members.map((member) => member.name), [
    'researcher',
    'implementer',
    'reviewer',
  ]);
  assert.deepEqual(plan.tasks.map((task) => task.id), [
    'research',
    'implement',
    'review',
  ]);
  assert.deepEqual(plan.tasks[2].dependencies, ['implement']);
  assert.doesNotThrow(() => validatePlan(plan));
});

test('createTeamState starts staged with no ready work before approval', () => {
  const state = createTeamState('Implement login', createDefaultPlan('Implement login'));

  assert.equal(state.phase, 'staged');
  assert.equal(state.members.every((member) => member.status === 'staged'), true);
  assert.deepEqual(findReadyTasks(state), []);
});

test('findReadyTasks only returns tasks whose dependencies completed', () => {
  const state = createTeamState('Implement login', createDefaultPlan('Implement login'));
  state.phase = 'running';
  state.members[0].status = 'idle';

  assert.deepEqual(findReadyTasks(state).map((task) => task.id), ['research']);
  transitionTask(state, 'research', 'in_progress', { attemptId: 'research-attempt' });
  transitionTask(state, 'research', 'completed', {
    attemptId: 'research-attempt',
    output: 'Research done',
  });
  state.members[1].status = 'idle';

  assert.deepEqual(findReadyTasks(state).map((task) => task.id), ['implement']);
});

test('stale attempt updates are rejected', () => {
  const state = createTeamState('Implement login', createDefaultPlan('Implement login'));
  const task = state.tasks[0];
  task.status = 'in_progress';
  task.attempt = 2;
  task.attemptId = 'current-attempt';

  assert.throws(
    () => transitionTask(state, task.id, 'completed', { attemptId: 'old-attempt' }),
    /stale attempt/
  );
});

test('concurrent team snapshots are serialized without losing task updates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-agent-team-state-'));
  const state = createTeamState('Implement login', createDefaultPlan('Implement login'));
  state.phase = 'running';
  const first = saveTeam(root, state);
  state.tasks[0].status = 'in_progress';
  state.tasks[0].attemptId = 'attempt-one';
  const second = saveTeam(root, state);
  await Promise.all([first, second]);

  const saved = JSON.parse(await readFile(join(root, 'team.json'), 'utf8'));
  assert.equal(saved.tasks[0].status, 'in_progress');
  assert.equal(saved.tasks[0].attemptId, 'attempt-one');
});
