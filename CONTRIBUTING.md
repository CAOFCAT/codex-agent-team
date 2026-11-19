# Contributing

Thanks for helping improve Codex Agent Team.

## Before opening a pull request

1. Keep changes focused and explain the behavior they affect.
2. Add or update tests for runtime and CLI behavior.
3. Run `npm test` with Node.js 22 or newer.
4. Run `node src/cli.js doctor --json` when your change affects startup or environment checks.
5. Do not commit `.codex-team/`, credentials, personal prompts, or task logs.

Live Codex integration tests are opt-in because they start real Codex processes. Do not enable them in CI unless the runner is trusted and the test repository is explicitly configured.

## Pull request notes

Describe the user-visible behavior, list relevant tests, and note any compatibility changes. Avoid committing generated output or unrelated workspace files.
