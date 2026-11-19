# Codex Agent Team

[简体中文](README.zh-CN.md)

Make Codex CLI work like a small engineering team.

Codex Agent Team turns a complex goal into a reviewable plan, assigns owned tasks to independent Codex members, tracks dependencies and results, and lets the Captain verify the final outcome. It is useful for implementation, research, testing, documentation, and other multi-step work.

![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

## What it does

- Creates a reviewable staged plan before any member starts.
- Runs independent Codex CLI members with explicit task ownership and dependency scheduling.
- Stores team state and run logs locally under the target workspace's `.codex-team/` directory.
- Resumes interrupted work without rerunning completed tasks.
- Offers an optional local dashboard for progress, members, task dependencies, details, and reports.
- Uses the active Codex profile and its normal approval and sandbox behavior.

## Workflow

```text
Captain creates a plan
          |
          v
User reviews members, tasks, and dependencies
          |
          v
User approves the plan
          |
          v
Independent Codex members run their assigned tasks
          |
          v
Team Runtime records results and unlocks dependent tasks
          |
          v
Captain reviews the final reports
```

The runtime keeps task state in `.codex-team/`, including attempts, member reports, process output, and events. A failed or interrupted task can be resumed without rerunning completed tasks.

## Highlights

- **Explicit ownership**. Each task has one member, acceptance criteria, and verification expectations.
- **Dependency scheduling**. A task starts only after its prerequisites complete.
- **Recoverable execution**. Interrupted and failed tasks can be resumed with a new attempt.
- **Approval-aware execution**. Members use the active Codex profile and workspace-write sandbox.
- **Optional live dashboard**. Opt in per execution to view progress, members, dependencies, task details, and reports in a local browser panel.
- **No runtime dependencies**. The CLI uses Node.js built-in modules and the built-in test runner.

## Requirements

- Codex CLI installed and authenticated.
- Node.js 22 or newer.
- Windows, macOS, or Linux.

## Install from GitHub

Clone this repository, then link the local CLI:

```powershell
git clone https://github.com/CAOFCAT/codex-agent-team.git
cd codex-agent-team
npm link
agent-team doctor
```

In Codex's Plugins panel, add the cloned repository's `.agents/plugins/marketplace.json` as a local marketplace and install **Codex Agent Team**. Restart the Codex session so its skill is available. The skill provides the `$agent-team` entry point; the linked CLI runs the local team runtime.

## Quick start

In Codex, invoke the skill and describe the goal:

```text
$agent-team Add password reset to the login flow. Have a separate reviewer check the security-sensitive paths.
```

The Captain creates a staged plan and shows its members, tasks, dependencies, and verification criteria. Review and approve that plan before any member runs. Immediately before each execution, the skill asks whether to open the dashboard for that run; the answer is not reused on a later resume.

```powershell
# Run without the dashboard
agent-team approve <team-id>

# Opt into the local dashboard for this execution
agent-team approve <team-id> --dashboard

# Inspect status or resume an interrupted run
agent-team status <team-id>
agent-team resume <team-id>
agent-team resume <team-id> --dashboard
```

The dashboard binds to `127.0.0.1`, reads only the selected team's local state, and refreshes once per second. It does not accept browser writes or load external scripts, fonts, or images. If the browser cannot be launched, the Team CLI continues and reports the browser error; monitor the run with `agent-team status <team-id>`.

## Example plan

Use a custom plan when the default researcher, implementer, and reviewer roles do not match the work:

```json
{
  "members": [
    { "name": "researcher", "role": "Gather official technical references" },
    { "name": "reviewer", "role": "Check the result and report blockers" }
  ],
  "tasks": [
    {
      "id": "research",
      "subject": "Gather official references",
      "description": "Find and verify the relevant documentation.",
      "assignee": "researcher",
      "dependencies": [],
      "acceptance": ["Return sources and verified facts."],
      "verify": ["Check every source URL."]
    },
    {
      "id": "review",
      "subject": "Review the research",
      "description": "Check the research report for gaps.",
      "assignee": "reviewer",
      "dependencies": ["research"],
      "acceptance": ["List blockers and confirm readiness."],
      "verify": ["Read the completed report."]
    }
  ]
}
```

## CLI reference

```text
agent-team create --goal "..." [--plan plan.json] [--workspace path] [--json]
agent-team approve <team-id> [--dashboard] [--json]
agent-team status [team-id] [--json]
agent-team resume <team-id> [--dashboard] [--json]
agent-team stop <team-id>
agent-team archive <team-id>
agent-team doctor [--json]
```

`create` only writes a staged plan. `approve` is required before any member process starts. Members use `--sandbox workspace-write`; the runtime never adds `--full-auto` or `--dangerously-bypass-approvals-and-sandbox`.

## Current scope

The current release targets local Codex CLI workflows. It includes the runtime, the `$agent-team` skill, a local read-only dashboard, resumable state, diagnostics, tests, and a GitHub Actions test workflow.

Remote workers, nested teams, automatic commits, automatic merges, and deployment workflows are outside the current release.

## Roadmap

- Team templates for common research and implementation workflows.
- More detailed retry and cancellation controls.
- Per-task cost and token reporting when the active provider exposes usage data.
- More dashboard views for event history and member output.

## Development

```powershell
npm test
node .\src\cli.js doctor --json
```

The test suite uses only Node's built-in test runner and has no runtime package dependencies. A live Codex smoke test is opt-in with `RUN_CODEX_INTEGRATION_TESTS=1` and `CODEX_AGENT_TEAM_TEST_REPO` pointing to a trusted Git repository.

## Local data and permissions

Team state and run logs may contain prompts, file paths, process output, and task summaries. Keep `.codex-team/` out of shared commits. The plugin does not change the target project's `.gitignore` automatically. Review what a task will do before approving its plan.

The runtime targets Codex CLI. It does not add remote workers, nested teams, automatic commits, merges, or deployments. Tool access, model selection, network access, approvals, and sandboxing follow the active Codex profile.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and pull requests are welcome.
