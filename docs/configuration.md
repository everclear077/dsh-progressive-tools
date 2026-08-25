# Configuration reference

Configuration is validated when the plugin loads. Invalid modes, names,
limits, duplicate family IDs, empty patterns, and bindings to unknown families
fail loudly.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mode` | `stable-proxy` \| `dynamic` | `stable-proxy` | Cache-stable dispatch or changing native family activation. |
| `toolName` | string | `tool_search` | Discovery tool name. |
| `dispatchToolName` | string | `tool_dispatch` | Stable dispatcher name. Must differ from `toolName`. |
| `alwaysVisible` | string[] | essential direct tools | Exact names or `*` patterns kept on the fixed direct surface. |
| `groups` | group[] | built-in rules | Ordered search and dynamic activation families; first match wins. |
| `skillBindings` | binding[] | `[]` | Successful Skill calls that discover or activate named families. |
| `maxResults` | integer | `5` | Maximum exact definitions returned by stable search, or group matches in dynamic mode. |
| `requireDiscovery` | boolean | `true` | Require search or a Skill binding before stable dispatch. |
| `deferToolGuidance` | boolean | `true` | Remove exact hidden `tool:<name>` prompt sections. |
| `activationGroupLimit` | integer | `1` | Dynamic mode: highest-ranked families activated by one search. |
| `maxActiveGroups` | integer | `3` | Dynamic mode: maximum retained active families. |
| `maxActiveToolTokens` | integer | `6000` | Dynamic mode: approximate active-schema budget. |
| `retentionTurns` | integer | `6` | Dynamic mode: inactive turns before expiry; `0` disables expiry. |
| `charactersPerToken` | integer | `4` | Compact schema characters represented by one estimate token. |

`activationGroupLimit` cannot exceed `maxActiveGroups`. Dynamic-only fields are
still validated in stable mode so switching modes cannot reveal a latent bad
configuration.

## Stable direct tools

The default patterns are:

```yaml
alwaysVisible:
  - skill
  - ask_user_question
  - report
  - submit_*
  - structured_output*
```

`tool_search` and `tool_dispatch` are added automatically. A matching tool must
exist when the first assembly freezes the session surface. Tools registered
later enter the deferred catalog even when their names match an
`alwaysVisible` wildcard; this keeps the active session prefix stable. A new
session sees the new composition.

Keep this list small. Add only tools whose direct schema or completion role is
worth paying on every request.

## Wildcards

`alwaysVisible`, `groups[].include`, and `groups[].exclude` use anchored `*`
wildcards over complete tool names. Every other character is matched literally.
Matching is case-insensitive.

```yaml
alwaysVisible:
  - approval_*
  - submit_*
```

## Family rules

```yaml
groups:
  - id: browser
    description: Browser navigation and page interaction
    aliases: [browser, web page, 浏览器]
    include: [browser_*]
    exclude: [browser_experimental_*]
```

Rules are evaluated in list order. A tool belongs to at most one configured
family. Unmatched tools are grouped by the first underscore-delimited prefix
when at least two share it; otherwise each tool receives a singleton family.

In stable mode, family metadata improves exact-tool search but the result
contains only the highest-ranked individual definitions. In dynamic mode, the
highest-ranked whole family becomes natively visible.

The built-in order covers browser, vision, image generation, filesystem,
terminal, web, database, remote operations, memory, workbench, teams,
subagents, workflows, and generated interfaces. Explicit rules are recommended
when third-party packages use unrelated names for one capability.

## Skill bindings

Bindings inspect the `name` or `skill` argument of a successful tool named
`skill`:

```yaml
skillBindings:
  - skill: browser-automation
    groups: [browser]
  - skill: database-operations
    groups: [database]
```

Stable mode marks bound tools as dispatchable. The Skill instructions should
describe the tools and their arguments; otherwise call `tool_search` to load
the exact definitions into history. Dynamic mode activates the bound native
families under its normal cap, budget, and LRU rules.

## Discovery gate

With `requireDiscovery: true`, `tool_dispatch` accepts only names returned by a
successful search or introduced through a Skill binding. This catches guessed
or stale tool names before nested execution.

Set it to `false` only when another trusted catalog supplies exact names and
schemas. Direct calls to deferred names remain denied; they must still pass
through `tool_dispatch`.

## Guidance deferral

`deferToolGuidance: true` removes only sections whose names map exactly to a
deferred tool:

```text
tool:<deferred-name>
tool:<deferred-name>:<suffix>
```

It does not guess package ownership or delete general sections. This avoids
silently removing unrelated policy text. A tool package that registers one
shared family section should move large operational instructions into a Skill
or keep the section always visible.

## Token estimates

The estimate for one tool is:

```text
ceil(JSON.stringify(schema).length / charactersPerToken)
```

It is deterministic diagnostic data, not provider billing. In stable mode,
`estimatedSavedTokens` is the complete deferred catalog estimate because none
of those definitions appears in the top-level request. Search results add only
the matched definitions to history.

## Dynamic-mode budgets

When a dynamic activation exceeds `maxActiveGroups` or
`maxActiveToolTokens`, the least recently used unprotected family is removed
first. Families activated by the current search are protected for that
operation. A requested family that alone exceeds the budget remains active and
reports the over-budget estimate.

Dynamic mode changes the request tool set on activation, eviction, and expiry.
Prefer stable mode when context-cache reuse is important.

## Full stable example

```yaml
- id: progressive-tools
  config:
    mode: stable-proxy
    toolName: tool_search
    dispatchToolName: tool_dispatch
    maxResults: 5
    requireDiscovery: true
    deferToolGuidance: true
    alwaysVisible: [skill, ask_user_question, report, submit_*, structured_output*]
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
      - skill: browser-automation
        groups: [browser]
```

## v0.1 migration

Version 0.2 defaults to `stable-proxy`, so a prior configuration now returns
exact definitions and uses `tool_dispatch` instead of exposing a native family.

To retain v0.1 call semantics while taking the lifecycle fixes:

```yaml
- id: progressive-tools
  config:
    mode: dynamic
```

Dynamic mode now affects the first request and makes a successful search
visible on the immediately following request, but it remains intentionally
cache-hostile when the active family set changes.
