import { spawn } from 'node:child_process';

export function buildCodexExecArgs(workspace, outputPath, schemaPath) {
  return [
    'exec', '--json', '--sandbox', 'workspace-write', '--cd', workspace,
    '--output-schema', schemaPath, '--output-last-message', outputPath, '-',
  ];
}

export function buildMemberPrompt({ state, member, task, workspace, attemptId }) {
  return [
    `You are ${member.name}, a Codex Agent Team member.`,
    `Team goal: ${state.goal}`,
    `Your role: ${member.role}`,
    `Task: ${task.subject}`,
    `Task description: ${task.description}`,
    `Acceptance criteria: ${task.acceptance.join('; ')}`,
    `Verification expectations: ${task.verify.join('; ')}`,
    `Attempt id: ${attemptId}`,
    `Work only on this task in ${workspace}. Do not create or manage teams. Do not claim success for checks you did not run.`,
    'Return JSON matching the provided output schema with status, summary, commandsRun, and changedPaths. Set status to completed only if the acceptance criteria are met; otherwise set failed and explain the blocker in summary.',
  ].join('\n');
}

export function parseMemberResult(text) {
  let value;
  try {
    value = JSON.parse(text.trim());
  } catch {
    throw new Error('member final response is not valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('member result must be a JSON object');
  }
  if (!['completed', 'failed'].includes(value.status)) {
    throw new Error('member result status must be completed or failed');
  }
  if (typeof value.summary !== 'string' || value.summary.trim() === '') {
    throw new Error('member result summary must be a non-empty string');
  }
  if (!Array.isArray(value.commandsRun) || !value.commandsRun.every((item) => typeof item === 'string')) {
    throw new Error('member result commandsRun must be an array of strings');
  }
  if (!Array.isArray(value.changedPaths) || !value.changedPaths.every((item) => typeof item === 'string')) {
    throw new Error('member result changedPaths must be an array of strings');
  }
  return value;
}

export function startCodexExec({ workspace, outputPath, schemaPath, prompt, binary = process.env.CODEX_BIN || 'codex' }) {
  const child = spawn(binary, buildCodexExecArgs(workspace, outputPath, schemaPath), {
    cwd: workspace,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end(prompt);
  return child;
}
