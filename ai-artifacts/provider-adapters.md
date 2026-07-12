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

Use direct read-only quota endpoints and Pi `AuthStorage`. Do not add browser-cookie extraction, dashboard scraping, model probes, subprocess fallbacks, credential persistence, or quota persistence without an explicit product decision.

## OpenCode Go

Do not implement the current cookie-scraping workaround. Track [anomalyco/opencode#16513](https://github.com/anomalyco/opencode/pull/16513). When an official API-key-authenticated endpoint ships, add a standard adapter with 5-hour, weekly, and monthly normalized windows.
