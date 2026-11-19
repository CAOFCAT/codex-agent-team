import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDashboardServer } from './dashboard.js';
import { withFileLock } from './lock.js';
import { buildMemberPrompt, parseMemberResult, startCodexExec } from './codex-runner.js';
import {
  createDefaultPlan,
  createTeamState,
  findReadyTasks,
  loadTeam,
  saveTeam,
  teamRoot,
  transitionTask,
} from './state.js';

function parseArgs(args) {
  const [command, ...rest] = args;
  const values = { command, positional: [], json: false, dashboard: false };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--json') values.json = true;
    else if (token === '--dashboard') values.dashboard = true;
    else if (token === '--goal' || token === '--plan' || token === '--workspace') {
      values[token.slice(2)] = rest[++index];
      if (values[token.slice(2)] === undefined) throw new Error(`${token} requires a value`);
    } else values.positional.push(token);
  }
  return values;
}

function print(value, json) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

function event(state, type, data = {}) {
  return { id: randomUUID(), ts: new Date().toISOString(), type, data };
}

async function appendEvent(root, value) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'events.jsonl'), `${JSON.stringify(value)}\n`, { flag: 'a', encoding: 'utf8' });
}

function renderStatus(state) {
  return {
    id: state.id,
    goal: state.goal,
    phase: state.phase,
    members: state.members.map(({ name, role, status, currentTaskId }) => ({ name, role, status, currentTaskId })),
    tasks: state.tasks.map(({ id, subject, assignee, dependencies, status, output }) => ({
      id, subject, assignee, dependencies, status, output,
    })),
  };
}

async function findTeamDir(workspace, id) {
  const root = teamRoot(workspace);
  if (id) return join(root, 'teams', id);
  const entries = await readdir(join(root, 'teams'), { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const state = await loadTeam(join(root, 'teams', entry.name));
      if (state.phase !== 'completed' && state.phase !== 'archived') candidates.push(join(root, 'teams', entry.name));
    } catch {
      // Invalid directories are diagnosed explicitly by doctor.
    }
  }
  if (candidates.length === 0) throw new Error('no active team found');
  if (candidates.length > 1) throw new Error('multiple active teams found; provide a team id');
  return candidates[0];
}

async function doctor(workspace) {
  const checks = [];
  checks.push({ name: 'node-version', ok: Number(process.versions.node.split('.')[0]) >= 22, detail: process.versions.node });
  const bin = process.env.CODEX_BIN || 'codex';
  const help = await new Promise((resolveResult) => {
    const child = spawn(bin, ['exec', '--help'], { cwd: workspace, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => resolveResult({ ok: false, detail: error.message }));
    child.once('close', (code) => resolveResult({ ok: code === 0, detail: code === 0 ? 'codex exec is available' : stderr.trim() || `exit ${code}` }));
  });
  checks.push({ name: 'codex-exec', ...help });
  const root = teamRoot(workspace);
  try {
    await mkdir(root, { recursive: true });
    await access(root, constants.R_OK | constants.W_OK);
    checks.push({ name: 'workspace-state', ok: true, detail: root });
  } catch (error) {
    checks.push({ name: 'workspace-state', ok: false, detail: error.message });
  }
  const activeRoot = join(root, 'teams');
  const entries = await readdir(activeRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.filter((item) => item.isDirectory())) {
    try {
      const state = await loadTeam(join(activeRoot, entry.name));
      checks.push({ name: `team:${entry.name}`, ok: true, detail: state.phase });
    } catch (error) {
      checks.push({ name: `team:${entry.name}`, ok: false, detail: error.message });
    }
  }
  return { ok: checks.every((check) => check.ok), checks };
}

async function create(values, workspace) {
  const goal = values.goal;
  if (!goal) throw new Error('create requires --goal <text>');
  const plan = values.plan
    ? JSON.parse(await readFile(resolve(workspace, values.plan), 'utf8'))
    : createDefaultPlan(goal);
  const state = createTeamState(goal, plan);
  const root = join(teamRoot(workspace), 'teams', state.id);
  await mkdir(root, { recursive: true });
  await withFileLock(join(teamRoot(workspace), 'runtime.lock'), async () => {
    await saveTeam(root, state);
    await appendEvent(root, event(state, 'team/staged'));
  });
  return { message: 'Plan created. Review it, then run agent-team approve <team-id>. No members were started.', team: renderStatus(state) };
}

async function stopTeam(state, root) {
  await writeFile(join(root, 'control.json'), JSON.stringify({ action: 'stop', requestedAt: new Date().toISOString() }), 'utf8');
  state.phase = 'halted';
  state.haltedAt = new Date().toISOString();
  for (const member of state.members) {
    if (member.pid) {
      try { process.kill(member.pid, 'SIGTERM'); } catch { /* already exited */ }
    }
    member.status = member.status === 'completed' ? 'completed' : 'idle';
    member.pid = null;
    member.currentTaskId = null;
  }
  await saveTeam(root, state);
  await appendEvent(root, event(state, 'team/halted'));
  return state;
}

async function stopRequested(root) {
  try {
    const control = JSON.parse(await readFile(join(root, 'control.json'), 'utf8'));
    return control.action === 'stop';
  } catch {
    return false;
  }
}

async function runMember({ workspace, state, root, task, member }) {
  const runId = randomUUID();
  const runRoot = join(root, 'runs', runId);
  await mkdir(runRoot, { recursive: true });
  const attemptId = randomUUID();
  const schemaPath = join(runRoot, 'result.schema.json');
  await writeFile(schemaPath, `${JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required: ['status', 'summary', 'commandsRun', 'changedPaths'],
    properties: {
      status: { type: 'string', enum: ['completed', 'failed'] },
      summary: { type: 'string' },
      commandsRun: { type: 'array', items: { type: 'string' } },
      changedPaths: { type: 'array', items: { type: 'string' } },
    },
  }, null, 2)}\n`, 'utf8');
  task.attempt += 1;
  task.attemptId = attemptId;
  transitionTask(state, task.id, 'claimed', { attemptId });
  transitionTask(state, task.id, 'in_progress', { attemptId });
  member.status = 'running';
  member.currentTaskId = task.id;
  member.runId = runId;

  const prompt = buildMemberPrompt({ state, member, task, workspace, attemptId });
  await writeFile(join(runRoot, 'prompt.md'), prompt, 'utf8');
  const outputPath = join(runRoot, 'result.txt');
  const child = startCodexExec({ workspace, outputPath, schemaPath, prompt });
  member.pid = child.pid ?? null;
  await saveTeam(root, state);
  await appendEvent(root, event(state, 'member/start', { member: member.name, taskId: task.id, runId, attemptId, pid: child.pid }));

  const stdoutPath = join(runRoot, 'stdout.log');
  const stderrPath = join(runRoot, 'stderr.log');
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const exitCode = await new Promise((resolveResult, reject) => {
    child.once('error', reject);
    child.once('close', resolveResult);
  }).catch(async (error) => {
    transitionTask(state, task.id, 'failed', { attemptId, output: error.message });
    member.status = 'failed';
    member.currentTaskId = null;
    member.pid = null;
    await saveTeam(root, state);
    await appendEvent(root, event(state, 'task/failed', { member: member.name, taskId: task.id, runId, attemptId, error: error.message }));
    throw error;
  });
  await Promise.all([
    writeFile(stdoutPath, stdout, 'utf8'),
    writeFile(stderrPath, stderr, 'utf8'),
  ]);
  let finalMessage = '';
  try { finalMessage = await readFile(outputPath, 'utf8'); } catch { /* command may exit before creating its last-message file */ }
  let memberResult;
  let resultError;
  try { memberResult = parseMemberResult(finalMessage); } catch (error) { resultError = error.message; }
  const completed = exitCode === 0 && memberResult?.status === 'completed';
  const output = memberResult
    ? JSON.stringify(memberResult)
    : (stderr.trim() || resultError || `codex exec exited with ${exitCode}`);
  transitionTask(state, task.id, completed ? 'completed' : 'failed', {
    attemptId,
    output,
  });
  member.status = completed ? 'idle' : 'failed';
  member.currentTaskId = null;
  member.pid = null;
  await saveTeam(root, state);
  await appendEvent(root, event(state, completed ? 'task/completed' : 'task/failed', { member: member.name, taskId: task.id, runId, attemptId, exitCode }));
  return completed;
}

async function schedule(state, root, workspace) {
  await unlink(join(root, 'control.json')).catch(() => undefined);
  state.phase = 'running';
  for (const member of state.members) member.status = 'idle';
  await saveTeam(root, state);
  const failures = [];
  while (state.phase === 'running') {
    if (await stopRequested(root)) {
      state.phase = 'halted';
      break;
    }
    const ready = findReadyTasks(state);
    if (ready.length === 0) break;
    const assigned = [];
    const usedMembers = new Set();
    for (const task of ready) {
      const member = state.members.find((candidate) => candidate.name === task.assignee && !usedMembers.has(candidate.name));
      if (!member) continue;
      usedMembers.add(member.name);
      assigned.push(runMember({ workspace, state, root, task, member }));
    }
    if (assigned.length === 0) break;
    const results = await Promise.allSettled(assigned);
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason.message);
    if (await stopRequested(root)) {
      state.phase = 'halted';
      break;
    }
    if (failures.length > 0) break;
  }
  const allCompleted = state.tasks.every((task) => task.status === 'completed' || task.status === 'cancelled');
  if (state.phase !== 'halted') state.phase = allCompleted ? 'completed' : 'halted';
  state.updatedAt = new Date().toISOString();
  if (failures.length) state.failures = failures;
  await saveTeam(root, state);
  await appendEvent(root, event(state, allCompleted ? 'team/completed' : 'team/halted', { failures }));
  return { team: renderStatus(state), failures };
}

async function runWithOptionalDashboard({ workspace, id, enabled, dashboardFactory, run }) {
  let dashboard = null;
  let dashboardError = null;
  if (enabled) {
    try {
      dashboard = await dashboardFactory({ workspace, teamId: id });
    } catch (error) {
      dashboardError = error.message;
    }
  }
  try {
    const result = await run();
    if (!enabled) return result;
    return {
      ...result,
      dashboard: dashboard
        ? { url: dashboard.url, browserError: dashboard.browserError }
        : { error: dashboardError || 'Dashboard could not be started' },
    };
  } finally {
    if (dashboard) await dashboard.close().catch(() => undefined);
  }
}

async function approve(workspace, id, options = {}) {
  const dir = await findTeamDir(workspace, id);
  return runWithOptionalDashboard({
    workspace, id, enabled: options.dashboard, dashboardFactory: options.dashboardFactory ?? startDashboardServer,
    run: () => withFileLock(join(teamRoot(workspace), 'runtime.lock'), async () => {
      const state = await loadTeam(dir);
      if (state.phase !== 'staged' && state.phase !== 'halted') throw new Error(`team cannot be approved from phase ${state.phase}`);
      await appendEvent(dir, event(state, 'team/approved'));
      return schedule(state, dir, workspace);
    }),
  });
}

async function resume(workspace, id, options = {}) {
  const dir = await findTeamDir(workspace, id);
  return runWithOptionalDashboard({
    workspace, id, enabled: options.dashboard, dashboardFactory: options.dashboardFactory ?? startDashboardServer,
    run: () => withFileLock(join(teamRoot(workspace), 'runtime.lock'), async () => {
      const state = await loadTeam(dir);
      if (!['halted', 'running'].includes(state.phase)) throw new Error(`team cannot be resumed from phase ${state.phase}`);
      for (const task of state.tasks) {
        if (task.status === 'in_progress' || task.status === 'claimed' || task.status === 'failed') {
          task.status = 'pending';
          task.attemptId = null;
        }
      }
      await appendEvent(dir, event(state, 'team/resume'));
      return schedule(state, dir, workspace);
    }),
  });
}

export async function main(args, services = {}) {
  const values = parseArgs(args);
  const workspace = resolve(values.workspace || process.cwd());
  switch (values.command) {
    case 'create':
      return print(await create(values, workspace), values.json);
    case 'status': {
      const dir = await findTeamDir(workspace, values.positional[0]);
      return print(renderStatus(await loadTeam(dir)), values.json);
    }
    case 'approve':
      return print(await approve(workspace, values.positional[0], {
        dashboard: values.dashboard,
        dashboardFactory: services.startDashboardServer,
      }), values.json);
    case 'resume':
      return print(await resume(workspace, values.positional[0], {
        dashboard: values.dashboard,
        dashboardFactory: services.startDashboardServer,
      }), values.json);
    case 'stop': {
      const dir = await findTeamDir(workspace, values.positional[0]);
      const state = await stopTeam(await loadTeam(dir), dir);
      return print({ message: 'Team stopped; unfinished work can be resumed.', team: renderStatus(state) }, values.json);
    }
    case 'archive': {
      const dir = await findTeamDir(workspace, values.positional[0]);
      const state = await loadTeam(dir);
      if (!['halted', 'completed'].includes(state.phase)) throw new Error('stop or complete the team before archiving it');
      const destination = join(teamRoot(workspace), 'archives', state.id);
      await mkdir(join(teamRoot(workspace), 'archives'), { recursive: true });
      await rename(dir, destination);
      return print({ archived: state.id, path: destination }, values.json);
    }
    case 'doctor':
      return print(await doctor(workspace), values.json);
    default:
      throw new Error('usage: agent-team <create|approve|status|resume|stop|archive|doctor> [--dashboard] [options]');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`agent-team: ${error.message}`);
    process.exitCode = 1;
  });
}
