import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from '../src/state.js';

test('validatePlan rejects a dependency cycle', () => {
  const plan = {
    members: [{ name: 'worker' }],
    tasks: [
      { id: 'a', subject: 'A', assignee: 'worker', dependencies: ['b'] },
      { id: 'b', subject: 'B', assignee: 'worker', dependencies: ['a'] },
    ],
  };

  assert.throws(() => validatePlan(plan), /dependency cycle/);
});

test('validatePlan rejects an unknown assignee', () => {
  assert.throws(() => validatePlan({
    members: [{ name: 'worker' }],
    tasks: [{ id: 'a', subject: 'A', assignee: 'missing', dependencies: [] }],
  }), /unknown assignee/);
});
