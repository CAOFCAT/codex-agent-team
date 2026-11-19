import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const STATE_DIR = '.codex-team';
export const SCHEMA_VERSION = 1;
const TASK_STATUSES = new Set(['pending', 'claimed', 'in_progress', 'completed', 'failed', 'cancelled']);
const writeQueues = new Map();

function timestamp() {
  return new Date().toISOString();
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function createDefaultPlan(goal) {
  const cleanGoal = nonEmpty(goal, 'goal');
  return {
    members: [
      { name: 'researcher', role: 'Inspect the repository and identify an implementation path.' },
      { name: 'implementer', role: 'Implement the approved change in the assigned scope.' },
      { name: 'reviewer', role: 'Review the resulting change and run focused verification.' },
    ],
    tasks: [
      {
        id: 'research',
        subject: 'Research the requested change',
        description: cleanGoal,
        assignee: 'researcher',
        dependencies: [],
        acceptance: ['Return the relevant files, constraints, and an implementation recommendation.'],
        verify: ['Inspect the repository and cite the files or commands used.'],
      },
      {
        id: 'implement',
        subject: 'Implement the requested change',
        description: cleanGoal,
        assignee: 'implementer',
        dependencies: ['research'],
        acceptance: ['Implement the requested behavior without changing unrelated files.'],
        verify: ['Run the most focused applicable checks and report their results.'],
      },
      {
        id: 'review',
        subject: 'Review and verify the implementation',
        description: cleanGoal,
        assignee: 'reviewer',
        dependencies: ['implement'],
        acceptance: ['Report whether the implementation is ready and list any blocking findings.'],
        verify: ['Inspect the final diff and run focused verification.'],
      },
    ],
  };
}

export function validatePlan(plan) {
  if (!plan || !Array.isArray(plan.members) || plan.members.length === 0) {
    throw new Error('plan.members must contain at least one member');
  }
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    throw new Error('plan.tasks must contain at least one task');
  }

  const members = new Set();
  for (const member of plan.members) {
    const name = nonEmpty(member?.name, 'member.name');
    if (members.has(name)) throw new Error(`duplicate member name: ${name}`);
    members.add(name);
  }

  const tasks = new Map();
  for (const task of plan.tasks) {
    const id = nonEmpty(task?.id, 'task.id');
    if (tasks.has(id)) throw new Error(`duplicate task id: ${id}`);
    const assignee = nonEmpty(task?.assignee, `task ${id}.assignee`);
    if (!members.has(assignee)) throw new Error(`task ${id} has unknown assignee: ${assignee}`);
    const dependencies = task.dependencies ?? [];
    if (!Array.isArray(dependencies)) throw new Error(`task ${id}.dependencies must be an array`);
    tasks.set(id, { ...task, id, assignee, dependencies });
  }

  for (const task of tasks.values()) {
    for (const dependency of task.dependencies) {
      if (!tasks.has(dependency)) throw new Error(`task ${task.id} has unknown dependency: ${dependency}`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error(`task dependency cycle includes: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of tasks.get(id).dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of tasks.keys()) visit(id);
  return true;
}

export function createTeamState(goal, plan = createDefaultPlan(goal)) {
  const cleanGoal = nonEmpty(goal, 'goal');
  validatePlan(plan);
  const now = timestamp();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `team-${Date.now()}-${randomUUID().slice(0, 8)}`,
    goal: cleanGoal,
    phase: 'staged',
    createdAt: now,
    updatedAt: now,
    members: plan.members.map((member) => ({
      id: member.name,
      name: member.name,
      role: member.role ?? '',
      status: 'staged',
      currentTaskId: null,
      pid: null,
      runId: null,
    })),
    tasks: plan.tasks.map((task) => ({
      id: task.id,
      subject: nonEmpty(task.subject, `task ${task.id}.subject`),
      description: task.description ?? '',
      assignee: task.assignee,
      dependencies: [...(task.dependencies ?? [])],
      acceptance: [...(task.acceptance ?? [])],
      verify: [...(task.verify ?? [])],
      status: 'pending',
      attempt: 0,
      attemptId: null,
      output: null,
      createdAt: now,
      updatedAt: now,
    })),
  };
}

export function findReadyTasks(state) {
  if (state.phase !== 'running') return [];
  const byId = new Map(state.tasks.map((task) => [task.id, task]));
  const members = new Map(state.members.map((member) => [member.name, member]));
  return state.tasks.filter((task) => {
    if (task.status !== 'pending') return false;
    const member = members.get(task.assignee);
    if (!member || !['idle', 'staged'].includes(member.status)) return false;
    return task.dependencies.every((dependency) => byId.get(dependency)?.status === 'completed');
  });
}

export function transitionTask(state, taskId, nextStatus, options = {}) {
  if (!TASK_STATUSES.has(nextStatus)) throw new Error(`invalid task status: ${nextStatus}`);
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`unknown task: ${taskId}`);
  if (options.attemptId !== undefined && task.attemptId !== null && task.attemptId !== options.attemptId) {
    throw new Error(`stale attempt for task ${taskId}`);
  }
  if (nextStatus === 'completed' && task.status !== 'in_progress') {
    throw new Error(`task ${taskId} must be in_progress before completed`);
  }
  task.status = nextStatus;
  if (options.attemptId !== undefined) task.attemptId = options.attemptId;
  if (options.output !== undefined) task.output = options.output;
  task.updatedAt = timestamp();
  state.updatedAt = task.updatedAt;
  return task;
}

export function teamRoot(workspace) {
  return join(workspace, STATE_DIR);
}

async function writeJsonAtomic(path, serialized) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, serialized, 'utf8');
  await rename(temporary, path);
}

export async function saveTeam(root, state) {
  const teamSnapshot = JSON.stringify(state, null, 2);
  const taskSnapshot = JSON.stringify({ schemaVersion: SCHEMA_VERSION, tasks: state.tasks }, null, 2);
  const previous = writeQueues.get(root) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    await mkdir(root, { recursive: true });
    await writeJsonAtomic(join(root, 'team.json'), `${teamSnapshot}\n`);
    await writeJsonAtomic(join(root, 'tasks.json'), `${taskSnapshot}\n`);
  });
  writeQueues.set(root, current);
  try {
    await current;
  } finally {
    if (writeQueues.get(root) === current) writeQueues.delete(root);
  }
}

export async function loadTeam(root) {
  const state = JSON.parse(await readFile(join(root, 'team.json'), 'utf8'));
  if (state.schemaVersion !== SCHEMA_VERSION) throw new Error(`unsupported team schema: ${state.schemaVersion}`);
  validatePlan({ members: state.members, tasks: state.tasks });
  return state;
}
