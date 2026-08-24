# Architecture

## Contract

The plugin is a standard Cordis function plugin with named `name`, `inject`,
`Config`, and `apply` exports. The installable package declares `dsh.bundle`
and contributes one `cordis.patch.yml` layer.

It depends only on public Harness services and events:

- `ctx.tools.register()` for the discovery tool.
- `ctx.tools.schemas(scope)` for the model-facing schema projection.
- `agent.ctx.tools.restrict()` for per-agent inherited visibility.
- `agent/pre-step` for request-boundary reconciliation.
- `tools/result` for authoritative successful activation and usage updates.
- `tools/change` for dynamic catalog invalidation.
- `agent/disposed` and Cordis effects for cleanup.

## Request lifecycle

```text
agent/pre-step
    │
    ├── lift this plugin's previous restriction
    ├── refresh catalog when registry state changed
    ├── restore durable activation on first use
    ├── expire inactive families
    └── install the next scoped allow-list
             │
             ▼
      prompt and tool assembly
             │
             ▼
        tool execution
             │
             └── tools/result commits successful state
```

Applying the restriction before delegating through the pre-step waterfall lets
later listeners observe the reduced view. Prompt assembly happens after the
waterfall settles, so the same restriction is already active for schema
projection and execution lookup.

## Inherited and agent-owned tools

A scoped restriction filters inherited layers but intentionally does not filter
tools registered by the same agent scope. The public schema projection does not
expose registration-layer provenance.

Catalog refresh therefore uses a reversible probe:

1. Lift only this plugin's previous restriction.
2. Snapshot `schemas(agent)` as the unrestricted externally accessible view.
3. Temporarily apply `restrict({ allow: [] })`.
4. Snapshot the remaining names as agent-owned or reserved tools.
5. Lift the temporary restriction.
6. Manage only the difference between the two snapshots.

The probe uses the public restriction contract and occurs synchronously inside
pre-step, before prompt assembly. Restriction-generated `tools/change` events
are suppressed from this plugin's own invalidation flag; external changes still
mark every live catalog dirty.

## Catalog and search

Configured family rules are ordered and exclusive. Unmatched names receive an
automatic prefix family when possible or a singleton family otherwise. Search
normalizes case, camel-case boundaries, underscores, hyphens, Unicode letters,
and numbers. Ranking rewards exact family aliases, exact tool names, family
tokens, tool-name tokens, and description or parameter matches in that order.

The complete catalog remains in process memory. Only the discovery schema and
the compact search result enter request history.

## Activation state

Each live Agent has an independent state record:

- current catalog and tool-to-family index;
- active family IDs;
- activation and last-use turns;
- current restriction disposer;
- catalog invalidation and restoration flags.

Search execution computes a proposal without mutating live state. The proposal
is committed only from a successful authoritative `tools/result`. The discovery
tool does not opt into concurrent execution, so two searches cannot race their
state proposals.

## Resume behavior

The discovery tool projects a compact state snapshot through
`output.presentationMeta`. Top-level calls persist that projection on the
ordinary `tool/result` event.

Nested Code Mode calls do not carry top-level presentation metadata. Their
canonical JSON rendering is already recorded by the standard
`tool/code-dispatch` event, so the same state snapshot is parsed from that
record during resume. Skill bindings and last-use turns are folded from
successful top-level results and nested dispatches.

No custom session event type is introduced. Older runtimes and persistence
readers therefore encounter only the standard event vocabulary.

## Dynamic registry changes

Any external `tools/change` invalidates all live catalogs because the event is
deliberately unfiltered and carries no scope identity. On the next pre-step the
plugin lifts its allow-list, re-reads the view under every other active
restriction, rebuilds groups, drops unavailable active families, and applies a
new allow-list.

This plugin never widens another layer's restriction. Multiple restrictions
continue to intersect according to the tool subsystem contract.

## Cleanup

The discovery registration and event listeners are ordinary Cordis effects.
Agent disposal lifts the exact restriction owned by that state. Plugin unload
iterates every remaining live state, lifts each restriction, and clears the
state set before its global tool registration disappears.

## Security boundary

Visibility restriction aligns presentation, lookup, and execution but is not a
security authorization mechanism. Approval services, sandbox policies, and
monotonic guards remain responsible for security enforcement.
