# Codex Agent Team

[English](README.md)

让 Codex CLI 像一个小型工程团队一样协作。

Codex Agent Team 会把复杂目标整理成可审阅的计划，将任务分配给独立的 Codex 成员，跟踪任务依赖和执行结果，并由 Captain 审查最终产出。它适合代码开发、资料调研、测试验证、文档整理和其他多步骤工作。

## 功能

- 先生成待审阅的计划，明确成员、任务、依赖和验收标准。
- 由 Captain 批准后才启动成员。
- 调度独立 Codex CLI 成员，并按任务依赖推进。
- 将团队状态和运行日志保存在目标工作区的 `.codex-team/`。
- 支持恢复中断的团队，不会重跑已完成任务。
- 提供可选的本地实时仪表盘，展示成员、进度、任务依赖和成员报告。
- 遵循当前 Codex 配置中的模型、审批、工具访问和沙箱策略。

## 工作流程

```text
Captain 创建计划
          |
          v
用户审阅成员、任务和依赖关系
          |
          v
用户批准计划
          |
          v
独立 Codex 成员执行分配的任务
          |
          v
Team Runtime 记录结果并解锁后续任务
          |
          v
Captain 审阅最终报告
```

运行时会把任务状态保存在 `.codex-team/`，其中包括尝试记录、成员报告、进程输出和事件。任务失败或中断后，可以从未完成的位置继续，不会重新执行已经完成的任务。

## 主要特点

- **任务归属清晰**。每个任务都有明确成员、验收标准和验证要求。
- **依赖调度**。前置任务完成后，后续任务才会启动。
- **支持恢复**。失败或中断的任务可以创建新的尝试继续执行。
- **遵循审批策略**。成员使用当前 Codex 配置和 `workspace-write` 沙箱。
- **可选实时面板**。每次执行可以单独选择是否打开本地浏览器面板。
- **无需运行时依赖**。CLI 使用 Node.js 内置模块和内置测试运行器。

## 环境要求

- 已安装并完成登录的 Codex CLI。
- Node.js 22 或更新版本。
- Windows、macOS 或 Linux。

## 从 GitHub 安装

先克隆仓库并把本地 CLI 链接到 PATH：

```powershell
git clone https://github.com/CAOFCAT/codex-agent-team.git
cd codex-agent-team
npm link
agent-team doctor
```

然后在 Codex 的 Plugins 面板中，将仓库内的 `.agents/plugins/marketplace.json` 添加为本地 Marketplace，并安装 **Codex Agent Team**。重启 Codex 会话后即可使用 `$agent-team`。插件提供工作流技能，本地 `agent-team` 命令运行实际团队调度器。

## 快速开始

在 Codex 中调用技能并描述目标：

```text
$agent-team 给登录流程添加密码重置功能，并安排独立成员审查安全敏感路径。
```

Captain 会先生成待确认计划。计划批准后，每次执行前都会单独询问是否打开实时仪表盘；这个选择只适用于本次执行，中断后恢复时会重新询问。

```powershell
# 不打开仪表盘
agent-team approve <team-id>

# 本次执行打开仪表盘
agent-team approve <team-id> --dashboard

# 查看状态或恢复中断的团队
agent-team status <team-id>
agent-team resume <team-id>
agent-team resume <team-id> --dashboard
```

仪表盘只监听 `127.0.0.1`，只读当前团队的本地状态，每秒刷新一次；不会接受网页写入，也不加载外部脚本、字体或图片。如果系统无法自动打开浏览器，团队执行仍会继续；之后用 `agent-team status <team-id>` 查看运行状态。

## 自定义计划示例

当默认的 researcher、implementer、reviewer 角色不适合任务时，可以使用自定义 JSON 计划：

```json
{
  "members": [
    { "name": "researcher", "role": "收集官方技术资料" },
    { "name": "reviewer", "role": "检查结果并报告阻塞项" }
  ],
  "tasks": [
    {
      "id": "research",
      "subject": "收集官方资料",
      "description": "查找并核对相关文档。",
      "assignee": "researcher",
      "dependencies": [],
      "acceptance": ["返回来源和核实后的事实。"],
      "verify": ["检查每个来源地址。"]
    },
    {
      "id": "review",
      "subject": "审阅调研结果",
      "description": "检查调研报告是否有遗漏。",
      "assignee": "reviewer",
      "dependencies": ["research"],
      "acceptance": ["列出阻塞项并确认是否可以继续。"],
      "verify": ["阅读已完成的调研报告。"]
    }
  ]
}
```

## 命令参考

```text
agent-team create --goal "..." [--plan plan.json] [--workspace path] [--json]
agent-team approve <team-id> [--dashboard] [--json]
agent-team status [team-id] [--json]
agent-team resume <team-id> [--dashboard] [--json]
agent-team stop <team-id>
agent-team archive <team-id>
agent-team doctor [--json]
```

`create` 只创建计划；任何成员进程启动前都必须运行 `approve`。成员使用 `--sandbox workspace-write`。运行时不会自动添加 `--full-auto` 或 `--dangerously-bypass-approvals-and-sandbox`。

## 当前范围

当前版本面向本地 Codex CLI 工作流，包含运行时、`$agent-team` 技能、本地只读仪表盘、可恢复状态、诊断命令、测试和 GitHub Actions 测试流程。

远程成员、嵌套团队、自动提交、自动合并和部署流程暂不在当前版本范围内。

## 后续计划

- 为常见调研和开发流程提供团队模板。
- 增加更细致的重试和取消控制。
- 当服务商提供用量数据时，显示任务级成本和 Token 统计。
- 为仪表盘增加事件历史和成员输出视图。

## 开发和验证

```powershell
npm test
node .\src\cli.js doctor --json
```

项目仅使用 Node.js 内置测试运行器，没有运行时 npm 依赖。真实 Codex 集成测试默认跳过；只有对可信 Git 仓库明确设置 `RUN_CODEX_INTEGRATION_TESTS=1` 和 `CODEX_AGENT_TEAM_TEST_REPO` 后才会运行。

## 本地数据与权限

团队状态和运行日志可能包含提示词、文件路径、进程输出和任务摘要。不要提交 `.codex-team/`。插件不会自动修改目标项目的 `.gitignore`。批准计划前请先审阅成员任务。

当前版本面向 Codex CLI，不包含远程成员、嵌套团队、自动提交、合并或部署。工具访问、模型选择、网络访问、审批和沙箱都遵循当前 Codex 配置。

## 参与贡献

请查看 [CONTRIBUTING.md](CONTRIBUTING.md)。欢迎提交问题和 Pull Request。
