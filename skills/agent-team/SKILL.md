---
name: agent-team
description: Create and coordinate a local Codex CLI team with staged plans, task dependencies, independent members, and resumable state. Use when a user asks for parallel agents, an agent team, delegated implementation and review, or multi-agent task coordination.
---

# Agent Team

Use the local `agent-team` CLI as the durable runtime. The current Codex session is the Captain and remains responsible for the final result.

## Workflow

1. Clarify the goal, boundaries, deliverables, and verification expectations.
2. Create a staged plan with `agent-team create --goal "..." --json`.
3. Show the member roles and task dependencies to the user.
4. Ask the user to approve the staged plan; do not run `approve` before they do.
5. After approval, ask whether to open the local live dashboard for this execution. This is a separate choice from approving the plan. Do not infer consent from a previous run or remember the last answer. Then run `agent-team approve <team-id> --dashboard` for yes or `agent-team approve <team-id>` for no.
6. Monitor with `agent-team status <team-id>`. After an interrupted run, ask again whether to show the dashboard before each `agent-team resume`; use `--dashboard` only if the user opts in for that resume.
7. Read member artifacts and verify the final result in the Captain session.

## Rules

- Keep tasks narrowly owned by one member.
- Put shared decisions and final acceptance in the Captain session.
- Do not invent project-specific test commands; inspect the repository first.
- Never use `--dangerously-bypass-approvals-and-sandbox` for members by default.
- Treat `.codex-team/` as local state that may contain prompts, logs, paths, and code summaries.
- The dashboard is opt-in per execution. `--dashboard` starts a read-only HTTP view bound to `127.0.0.1`; without it, no dashboard server or browser window is opened. If the browser cannot open automatically, report that error and monitor with `agent-team status`; do not present the returned URL as a live page after the execution command exits.
