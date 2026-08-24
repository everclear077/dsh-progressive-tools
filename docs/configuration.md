# Configuration reference

Configuration is validated when the plugin loads. Invalid limits, duplicate
family IDs, empty patterns, and skill bindings to unknown families fail loudly.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `toolName` | string | `tool_search` | Discovery tool name. Change it only to avoid a registry collision. |
| `alwaysVisible` | string[] | `skill`, `ask_user_question` | Exact names or `*` wildcard patterns that bypass progressive activation. |
| `groups` | group[] | built-in rules | Ordered family rules; first match wins. |
| `skillBindings` | binding[] | `[]` | Successful skill calls that activate named families. |
| `maxResults` | integer | `5` | Maximum ranked matches returned by one search. |
| `activationGroupLimit` | integer | `1` | Highest-ranked families activated by one search. |
| `maxActiveGroups` | integer | `3` | Maximum retained active families. |
| `maxActiveToolTokens` | integer | `6000` | Approximate schema-token budget for active managed tools. |
| `retentionTurns` | integer | `6` | Inactive turns before expiry; `0` disables TTL expiry. |
| `charactersPerToken` | integer | `4` | Compact schema characters represented by one estimated token. |

`activationGroupLimit` cannot exceed `maxActiveGroups`.

## Wildcards

`alwaysVisible`, `groups[].include`, and `groups[].exclude` use anchored `*`
wildcards over complete tool names. Every other character is matched literally.
Matching is case-insensitive.

```yaml
alwaysVisible:
  - skill
  - approval_*
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
when at least two unmatched tools share it; otherwise each tool receives a
singleton family.

The built-in order covers browser, vision, image generation, filesystem,
terminal, web, database, remote operations, memory, workbench, teams,
subagents, workflows, and generated interfaces. Explicit deployment rules are
recommended when third-party packages use unrelated names for one tool family.

## Skill bindings

Bindings use the `name` or `skill` argument of a successful tool named `skill`.
All referenced family IDs must exist in `groups`.

```yaml
skillBindings:
  - skill: browser-automation
    groups: [browser]
  - skill: database-operations
    groups: [database]
```

The activation follows the same family cap, token budget, and LRU eviction as a
search activation.

## Budget behavior

The estimate for one tool is:

```text
ceil(JSON.stringify(schema).length / charactersPerToken)
```

When an activation exceeds `maxActiveGroups` or `maxActiveToolTokens`, the
least recently used unprotected family is removed first. Families activated by
the current search are protected for that operation. A requested family that
alone exceeds the budget remains active and reports the over-budget estimate.

## Full example

```yaml
- id: progressive-tools
  config:
    toolName: tool_search
    alwaysVisible: [skill, ask_user_question]
    maxResults: 5
    activationGroupLimit: 1
    maxActiveGroups: 2
    maxActiveToolTokens: 4000
    retentionTurns: 4
    charactersPerToken: 4
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
