# Provider Adapters

## Architecture

`src/providers.ts` is the registry. Each `QuotaProvider` supplies:

- stable `id` and user-facing `label`
- `matchesModel()` for active-model routing
- `fetch()` for authentication, request, validation, and normalization
- a safe credential hint
- ordered window IDs for minimal and full footer modes

The generic coordinator derives per-provider caches from the registry. It handles freshness, in-flight deduplication, independent refreshes, stale last-good fallback, snapshots, and cleanup. Formatting consumes normalized window metadata; it must not branch on provider IDs.

## Normalized data

A fetcher returns `ProviderQuota`. Every `QuotaWindow` carries its own stable ID, short and long labels, reset display style, percentage, optional raw usage/limit, and optional reset timestamp. This allows hourly, weekly, monthly, or provider-specific windows without formatter changes.

## Adding a provider

1. Add the provider-specific auth/fetch/parser module under `src/`.
2. Validate external response fields before constructing normalized quota data.
3. Sanitize errors; never include tokens, account IDs, or response bodies.
4. Add one `QuotaProvider` entry to `src/providers.ts`.
5. Add response fixtures and parser tests.
6. Add registry-routing, cache-isolation, footer, and widget tests where relevant.
7. Update the README supported-provider table and authentication instructions only.
8. Run `npm run check`, `npm test`, and `npm pack --dry-run`.

Example:

```ts
const provider: QuotaProvider = {
  id: "provider-id",
  label: "Provider",
  matchesModel: (model) => model?.provider === "provider-id",
  fetch: fetchProviderQuota,
  credentialsHint: "Run /login provider-id.",
  footerWindows: {
    minimal: ["five-hour"],
    full: ["five-hour", "weekly"],
  },
};
```

## Security boundary

- Use direct, read-only quota endpoints.
- Resolve keys through `ctx.modelRegistry`; use exported `readStoredCredential` only for read-only credential metadata, except for the explicitly approved Copilot case below.
- Let the registered provider own OAuth refresh. A forced 401 refresh may be cached in process, but Token Tank never writes Pi credentials.
- Do not add a separate login flow, read browser cookies, scrape dashboards, probe models, or spawn subprocess fallbacks.
- Never persist tokens, account IDs, raw provider responses, or normalized quota. Tokens and raw responses are never cached; normalized quota intentionally uses the coordinator's in-memory five-minute/stale cache.

Current provider-controlled data sources:

- Codex: `https://chatgpt.com/backend-api/wham/usage`
- Kimi: `https://api.kimi.com/coding/v1/usages`
- GitHub Copilot: `https://api.github.com/copilot_internal/user`

Copilot is the only approved exception to metadata-only stored-credential access. Pi's public model registry exposes the short-lived Copilot session token, but GitHub's quota endpoint requires the stored GitHub OAuth token. The adapter may read the OAuth `refresh` field in memory solely for that direct GET. It must never log, return, refresh, mutate, cache, or persist the token or raw response. The fixed endpoint supports GitHub.com, including Enterprise Cloud seats hosted there; stored custom GitHub Enterprise Server domains are rejected before any request. The endpoint is undocumented and may change without notice.

Cursor remains outside the boundary: Pi has no core Cursor provider, and Cursor has no safe official individual-plan quota API. Do not read browser sessions or scrape Cursor dashboards.

These surfaces may change. Any further expansion of this boundary requires an explicit product decision.

## OpenCode Go

Do not implement the current cookie-scraping workaround. Track [anomalyco/opencode#16513](https://github.com/anomalyco/opencode/pull/16513). When an official API-key-authenticated endpoint ships, add a standard adapter with 5-hour, weekly, and monthly normalized windows.
