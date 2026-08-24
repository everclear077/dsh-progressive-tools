# DSH Progressive Tools

[![CI](https://github.com/everclear077/dsh-progressive-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/everclear077/dsh-progressive-tools/actions/workflows/ci.yml)
[![version](https://img.shields.io/badge/version-0.1.0-blue.svg)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Progressive tool discovery and scoped activation for DeepSeek Harness. The
plugin keeps a small discovery surface visible, stores the complete tool catalog
outside request context, and exposes relevant tool families only after a search.

[中文文档](./README.zh-CN.md)

## Why

Every visible tool schema consumes request tokens even when the task never uses
that capability. A profile with many bundles can therefore spend a large part
of every request repeating tool names, descriptions, and parameter schemas.

This plugin applies progressive disclosure through the official scoped tool
registry:

```text
registered tools
      │
      ├── in-memory searchable catalog
      │
      └── tool_search + eager tools ──► request
                    │
                    └── matching family ──► next request
```

The same scoped view drives schema presentation, lookup, native execution, and
the generated Code Mode SDK. No prompt-only filtering is used.

## Features

- Per-agent isolation through `agent.ctx.tools.restrict()`.
- Search and activation in one `tool_search` call.
- Configurable tool-family rules with automatic prefix and singleton fallbacks.
- Approximate schema-token budget, LRU eviction, family cap, and turn TTL.
- Dynamic catalog refresh after tool registration, removal, or restriction
  changes.
- Agent-owned tools remain visible, including reporting and structured-output
  tools created for delegated work.
- Optional skill-to-family bindings.
- Resume reconstruction from durable top-level result metadata and nested Code
  Mode dispatch records.
- Reversible Cordis effects for clean plugin unload and configuration reload.

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- DeepSeek Harness `0.1.1-rc.2` or a compatible `0.1.x` release
- pnpm for source installation and development

## Install

Install the tagged GitHub release into a profile:

```sh
dsh plugin --profile desktop add github:everclear077/dsh-progressive-tools#v0.1.0
```

Source installs run the package `prepare` script. With pnpm 10 or newer, add the
exact package key printed by pnpm to the profile's `pnpm-workspace.yaml` before
retrying:

```yaml
allowBuilds:
  dsh-progressive-tools: true
```

Pinning the tag or a commit keeps the installed source reproducible. A packed
artifact can be installed without source-build permission:

```sh
pnpm pack
dsh plugin --profile desktop add ./dsh-progressive-tools-0.1.0.tgz
```

Verify the composed layer before starting the profile:

```sh
dsh --profile desktop --dump-config
```

The dump should contain a `progressive-tools` row contributed by this bundle.

## Use

The default visible surface includes:

- `tool_search`
- `skill`, when registered
- `ask_user_question`, when registered
- tools owned by the current agent scope
- reserved presentation transports managed by the Harness

`tool_search` supports three actions:

```json
{"query":"browser navigation"}
{"action":"status"}
{"action":"reset"}
```

`search` returns ranked matches and activates the highest-ranked family for the
next step. `status` reports the current catalog and activation estimates.
`reset` releases every activated family while keeping eager and agent-owned
tools visible.

## Configure

Bundle configuration can be overridden in the profile's `cordis.patch.yml`,
which is applied after bundle layers:

```yaml
- id: progressive-tools
  config:
    maxActiveToolTokens: 4000
    maxActiveGroups: 2
    retentionTurns: 4
    alwaysVisible:
      - skill
      - ask_user_question
    groups:
      - id: browser
        description: Browser navigation and page interaction
        aliases: [browser, web page, 浏览器]
        include: [browser_*]
      - id: database
        description: Database inspection and queries
        aliases: [database, sql, 数据库]
        include: [db_*, sql_*]
    skillBindings:
      - skill: database-operations
        groups: [database]
```

An aggressive low-context profile can use one active family, a short TTL, and a
smaller estimated schema budget:

```yaml
- id: progressive-tools
  config:
    maxActiveToolTokens: 2000
    maxActiveGroups: 1
    retentionTurns: 2
```

See [configuration](./docs/configuration.md) for every option and the built-in
family rules.

## Semantics

The plugin snapshots the unrestricted view at an `agent/pre-step` boundary,
separates agent-owned tools from inherited tools, rebuilds the hidden catalog
when necessary, and installs one scoped allow-list. Activations committed by a
successful `tool_search` result take effect at the next pre-step.

Token values are deterministic estimates, not provider billing values. The
default estimate divides compact JSON schema characters by four. It excludes
eager, reserved, and agent-owned tools because the plugin does not manage those
schemas.

Tool visibility is a composition mechanism, not an authorization boundary.
Security-sensitive deployments should keep their normal approval, sandbox, and
guard policies enabled.

## Known limitations

- The public tool schema does not expose the package that registered a tool.
  Family ownership is therefore derived from ordered name rules and automatic
  fallbacks. Deployments with custom naming should define explicit groups.
- Search is deterministic lexical matching, not semantic embedding search.
- Requested families larger than the configured token budget are retained for
  that activation; otherwise the requested capability would remain
  unusable. The result reports the over-budget estimate.
- Agent-owned tools cannot be hidden by that agent's own restriction and are
  intentionally outside the managed budget.
- Another scoped restriction can further reduce the visible surface. This
  plugin never widens capabilities removed by another layer.

## Development

```sh
pnpm install
pnpm run check
```

The test suite covers catalog grouping and ranking, budget and TTL behavior,
scoped visibility, execution alignment, unload cleanup, and resume restoration.

The implementation follows the official references for
[architecture](https://deepseek-harness.github.io/deepseek-harness/reference/),
[tool restrictions](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/tools),
[progressive disclosure](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/extension-cookbook),
and [plugin packaging](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish).

## License

[MIT](./LICENSE)
