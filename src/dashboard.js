import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTeam, teamRoot } from './state.js';

const dashboardHtmlPath = fileURLToPath(new URL('./dashboard.html', import.meta.url));

export function openDashboardInBrowser(url, platform = process.platform) {
  const command = platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function projectTeam(state) {
  return {
    id: state.id,
    goal: state.goal,
    phase: state.phase,
    updatedAt: state.updatedAt,
    members: state.members.map(({ name, role, status, currentTaskId, runId }) => ({
      name, role, status, currentTaskId, runId,
    })),
    tasks: state.tasks.map(({ id, subject, description, assignee, dependencies, status, output, updatedAt }) => ({
      id, subject, description, assignee, dependencies, status, output, updatedAt,
    })),
    failures: state.failures ?? [],
  };
}

export async function startDashboardServer({ workspace, teamId, browserOpener = openDashboardInBrowser }) {
  if (typeof teamId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(teamId)) {
    throw new Error('Invalid team id');
  }
  const html = await readFile(dashboardHtmlPath, 'utf8');
  const teamDir = join(teamRoot(workspace), 'teams', teamId);
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' });
      response.end('Method not allowed');
      return;
    }
    if (request.url === '/api/status') {
      try {
        const team = projectTeam(await loadTeam(teamDir));
        sendJson(response, 200, { team });
      } catch (error) {
        if (error.code === 'ENOENT') sendJson(response, 404, { error: 'Team state not found' });
        else sendJson(response, 500, { error: 'Unable to read team state' });
      }
      return;
    }
    if (request.url === '/' || request.url === '/index.html') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      response.end(html);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  let browserError = null;
  try {
    await browserOpener(url);
  } catch (error) {
    browserError = error.message;
  }

  let closed = false;
  return {
    url,
    browserError,
    async close({ finalRefreshGraceMs = 1100 } = {}) {
      if (closed) return;
      closed = true;
      if (finalRefreshGraceMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, finalRefreshGraceMs));
      }
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}
