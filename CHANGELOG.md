# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-08-25

### Added

- Cache-stable `stable-proxy` mode as the new default.
- Fixed first-request surface with `tool_search`, `tool_dispatch`, and
  configurable common direct tools.
- Exact definition search with BM25-style lexical ranking over nested schema
  text and multilingual family aliases.
- Nested real-tool dispatch through the complete DSH execution pipeline.
- Monotonic routing guard for direct-call and Code Mode bypass prevention.
- Stable Code Mode SDK projection and conservative tool-guidance deferral.
- Real AgentLoop request regression test for first-request and prefix stability.

### Fixed

- First request no longer sends the full tool catalog before progressive state
  takes effect.
- Dynamic-mode search and Skill activation now affect the immediately following
  request instead of lagging one request boundary.
- Request lifecycle documentation now matches the official assembly order.

### Changed

- Search returns exact tool definitions in stable mode instead of activating a
  whole family.
- Agent-scoped tools can be deferred in stable mode.
- `dynamic` is now an explicit compatibility mode.

## [0.1.0] - 2026-08-25

### Added

- Per-agent progressive tool discovery through the official scoped restriction
  API.
- Configurable family rules, multilingual aliases, and automatic fallback
  grouping.
- Token-budget, LRU, family-cap, and turn-TTL retention controls.
- Optional skill-to-family activation bindings.
- Dynamic registry refresh and reversible lifecycle cleanup.
- Resume restoration for top-level and nested discovery calls.
- Bundle manifest, GitHub source-install build path, documentation, tests, and
  continuous integration.

[Unreleased]: https://github.com/everclear077/dsh-progressive-tools/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/everclear077/dsh-progressive-tools/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/everclear077/dsh-progressive-tools/releases/tag/v0.1.0
