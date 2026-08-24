# Contributing

Contributions are welcome through focused issues and pull requests.

## Development setup

Requirements:

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm 11

```sh
pnpm install
pnpm run check
```

## Change guidelines

- Keep runtime behavior on public DeepSeek Harness services and events.
- Preserve per-agent isolation and reversible Cordis cleanup.
- Do not add prompt-only visibility filters that diverge from execution lookup.
- Add tests for behavior changes, including resume or unload behavior when
  relevant.
- Update README, configuration reference, architecture notes, and changelog when
  public behavior changes.
- Keep commits focused and use Conventional Commit subjects.

## Pull requests

Describe the user-visible problem, the chosen behavior, compatibility impact,
and verification performed. Keep unrelated refactors out of the same change.
