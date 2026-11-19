import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexExecArgs, buildMemberPrompt, parseMemberResult } from '../src/codex-runner.js';

test('Codex member arguments preserve the approval sandbox and workspace', () => {
  assert.deepEqual(buildCodexExecArgs('C:\\repo', 'C:\\runs\\result.txt', 'C:\\runs\\result.schema.json'), [
    'exec', '--json', '--sandbox', 'workspace-write', '--cd', 'C:\\repo',
    '--output-schema', 'C:\\runs\\result.schema.json', '--output-last-message', 'C:\\runs\\result.txt', '-',
  ]);
});

test('member prompt contains assigned task, attempt identity, and reporting contract', () => {
  const prompt = buildMemberPrompt({
    state: { goal: 'Ship login' },
    member: { name: 'reviewer', role: 'Review the change' },
    task: {
      subject: 'Security review',
      description: 'Inspect auth paths',
      acceptance: ['Report blockers'],
      verify: ['Inspect final diff'],
    },
    workspace: 'C:\\repo',
    attemptId: 'attempt-123',
  });

  assert.match(prompt, /Security review/);
  assert.match(prompt, /attempt-123/);
  assert.match(prompt, /Do not create or manage teams/);
  assert.match(prompt, /commandsRun/);
});

test('member result must be a valid structured completion report', () => {
  const result = parseMemberResult(JSON.stringify({
    status: 'completed',
    summary: 'Reviewed the requested paths.',
    commandsRun: ['git diff --check'],
    changedPaths: [],
  }));
  assert.equal(result.status, 'completed');
  assert.throws(() => parseMemberResult('plain text'), /not valid JSON/);
  assert.throws(() => parseMemberResult(JSON.stringify({
    status: 'completed', summary: 'Done', commandsRun: 'none', changedPaths: [],
  })), /commandsRun/);
});
