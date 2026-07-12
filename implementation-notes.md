# Implementation Notes: `pi-codex-kimi-usage`

## Plan Snapshot

Build one Pi extension that fetches Codex and Kimi Coding quota from their direct read-only endpoints and shows both providers in a single footer status slot plus a `/quotas` detail widget.

## Decisions

- Use `AuthStorage.create()` for credentials; no custom login flow.
- Codex account id comes from stored credential `accountId` or JWT claim `https://api.openai.com/auth.chatgpt_account_id`.
- Kimi 401 recovery uses the registered `kimi-coding` OAuth provider returned by `storage.getOAuthProviders()`, matching `pi-provider-kimi-code` behavior.
- Runtime dependencies: Node built-ins only. Dev dependencies include TypeScript and the matching `@earendil-works/pi-coding-agent` / `pi-tui` packages for type checking.
- Tests use Node’s built-in test runner and `globalThis.fetch` mocking.

## Deviations

- Added a TUI-mode guard to `/quotas` so it warns instead of no-oping in print/RPC modes.
- Exported `createCoordinator` and `createPiCodexKimiUsage` so unit tests can inject a fake `AuthStorage` and avoid real network.
- Used `.js` extensions on local relative imports because TypeScript with `module: NodeNext` requires it for ESM emit.

## Parent Review Fixes

- Fixed the coordinator to retain last-good data when clients return explicit `error` or `missing` states; the original implementation only handled thrown failures and replaced good cache entries.
- Prevented unexpected thrown errors from reaching the widget/footer by replacing them with a fixed sanitized message.
- Classified environment/fallback Kimi credentials as API keys instead of OAuth when no stored OAuth credential exists.
- Required a real Kimi refresh token, contained provider refresh exceptions, and validated refreshed credentials before persistence.
- Contained second-attempt Codex/Kimi fetch failures so client functions always return sanitized provider states.
- Added tests for returned-error stale fallback, sanitized refresh failure, and the real `/quotas` widget toggle.

## New Unknowns

- Exact live Codex `wham/usage` JSON shape; plan describes `rate_limit.primary_window`, `rate_limit.secondary_window`, `used_percent`, `reset_at`, `plan_type`. If live differs, only sanitized structural fixtures will be saved.

## Validation

```sh
npm run check      # tsc --noEmit, exit 0
npm test           # 30 tests, 0 failures, exit 0
npm pack --dry-run # 9 files, 8.8 kB tarball, exit 0
```

## Smoke Test

- `pi -e ./src/index.ts --version` loads without errors (exit 0).
- `pi -e ./src/index.ts --list-models` loads and lists models without errors.
- `pi -e ./src/index.ts -p --no-session --provider openai --api-key fake-key "hello"` triggers `session_start`, the extension attempts quota fetches, and exits with only a sanitized credential-related message (`Failed to extract accountId from token`) and no leaked tokens/JWTs/account IDs/raw response bodies.
- Real TUI with the normal Pi environment fetched and rendered live Codex and Kimi quota in `/quotas`; no credentials or raw responses were exposed.
- Isolated default Pi TUI showed `CX — | KM —` in the footer and `/quotas` toggled a clean missing-credentials widget without duplicate messages.
- The normal local environment’s custom footer suppresses Pi’s built-in footer and does not render extension statuses, so it hides all `setStatus()` segments, including this extension. `/quotas` still works. That custom footer needs a separate compatibility fix before the quota segment appears in the user’s normal footer.
- Existing `/usage` coexistence is covered by registration tests (`quotas` registered, `usage` untouched); interactive `/usage` was not modified.
