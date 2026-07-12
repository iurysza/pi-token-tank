# Implementation Plan: `pi-codex-kimi-usage`

## Goal

Build a standalone public Pi extension that reliably shows OpenAI Codex and Kimi Coding subscription quota in one compact footer status and exposes `/quotas` for a detailed view.

## Decisions

- One extension, one footer slot: `pi-codex-kimi-usage`.
- Direct read-only quota endpoints only.
  - Codex: `GET https://chatgpt.com/backend-api/wham/usage`.
  - Kimi: `GET https://api.kimi.com/coding/v1/usages`.
- No Codex app-server fallback: it may use a different account than Pi OAuth.
- Reuse Pi `AuthStorage`; no login flow.
- Kimi 401 recovery: force one OAuth refresh using the registered `kimi-coding` OAuth provider, persist through `AuthStorage`, retry once.
- In-memory last-good cache only.
- Refresh on startup and only when cache is older than five minutes on `turn_end` or `model_select`; `/quotas` forces refresh when opening.
- No background timer.
- `/quotas` toggles a static detail widget above the editor. Opening refreshes; invoking again hides it.
- Keep `/usage` untouched.
- Display **used percentages** consistently.

## V1 Scope

### Footer

Compact single line:

```text
CX 5h 24% · 7d 61% | KM 5h 18% · 7d 43%
```

Rules:

- Green below 70%, yellow at 70–89%, red at 90%+.
- `~` after provider code means last-good data is stale: `KM~`.
- `—` means credentials are absent: `KM —`.
- `!` means fetch failed and no last-good value exists: `KM !`.
- Do not attempt custom width detection. `setStatus` owns a compact footer segment; Pi handles footer layout.

### `/quotas` widget

Static, theme-aware text above the editor:

```text
Quota usage

Codex · Plus · live
  5h      24% used   resets 2h 13m
  Weekly  61% used   resets 3d 8h

Kimi · Allegro · live
  5h      18% used   resets 4h 02m
  Weekly  43% used   resets 5d 11h

Updated 10:42
Run /quotas again to hide.
```

Show provider-specific errors below that provider. Never show token, JWT, account id, email, raw response, or response body.

## Non-goals

- Codex CLI/app-server fallback.
- Browser cookies, dashboard scraping, model probes, or API-key balance endpoints.
- Persistent cache or usage history.
- Code-review/Spark/additional Codex windows.
- Codex credits/spend control.
- Kimi Extra Usage/booster wallet.
- Per-provider settings, display modes, custom width breakpoints, or LLM tools.
- Full custom footer replacement or modal overlay.
- Multi-account support.

## Data Model

`src/types.ts`:

```ts
export type ProviderName = "codex" | "kimi";
export type QuotaState = "live" | "stale" | "missing" | "error";

export interface QuotaWindow {
  kind: "five-hour" | "weekly";
  usedPercent: number;
  used?: number;
  limit?: number;
  resetsAt?: number; // Unix milliseconds
}

export interface ProviderQuota {
  provider: ProviderName;
  state: QuotaState;
  fetchedAt?: number;
  plan?: string;
  windows: QuotaWindow[];
  error?: string; // sanitized, user-facing only
}

export interface QuotaSnapshot {
  codex: ProviderQuota;
  kimi: ProviderQuota;
}
```

Parsers clamp percentages to `0..100` for rendering. They must reject payloads without the expected 5-hour and weekly data rather than silently reporting zero.

## Auth

### Codex

1. `AuthStorage.create().getApiKey("openai-codex")` gets/refreshed access token.
2. `storage.get("openai-codex")` supplies `accountId` when present.
3. If absent, decode only the JWT middle segment in memory and read `https://api.openai.com/auth.chatgpt_account_id`.
4. If no account id exists, return a sanitized auth error.
5. On 401/403, `storage.reload()` and retry once only if the access token changed. Do not force Codex refresh or call its token endpoint.

### Kimi

1. `AuthStorage.create().getApiKey("kimi-coding")` supports Pi OAuth or stored API key; fall back to `KIMI_API_KEY` only if Pi returns nothing.
2. Call `/coding/v1/usages` with `Authorization: Bearer`; no spoofed device headers are required.
3. On 401:
   - reload storage;
   - if disk now contains a different access token, retry it;
   - otherwise find the registered `kimi-coding` provider through `storage.getOAuthProviders()`;
   - call its `refreshToken()` with the current OAuth credential;
   - reload and avoid overwriting a newer token if another process already refreshed;
   - otherwise persist with `storage.set()` and retry once.
4. API-key credentials never attempt OAuth refresh.
5. Refresh failures become sanitized auth errors.

This mirrors the installed Kimi provider’s forced-refresh behavior while using Pi’s registered OAuth implementation instead of duplicating Kimi OAuth endpoints/client constants.

## Fetching and Parsing

### Codex

Request headers:

```text
Authorization: Bearer <token>
ChatGPT-Account-Id: <account id>
Accept: application/json
```

Parse:

- `rate_limit.primary_window` → five-hour.
- `rate_limit.secondary_window` → weekly.
- `used_percent` → `usedPercent`.
- `reset_at` Unix seconds → milliseconds.
- `plan_type` → plan.

Use a 10-second timeout. Categorize missing credentials, auth, timeout/network, HTTP, and invalid schema without including response bodies.

### Kimi

Parse:

- top-level `usage` → weekly.
- `limits[]` item whose `window.duration` + `timeUnit` equals 300 minutes → five-hour.
- Numeric strings and numbers are both valid.
- Derive `used = limit - remaining` when needed.
- `usedPercent = used / limit * 100`.
- Accept documented reset aliases and ISO timestamps, including nanosecond precision.
- `user.membership.level` maps to the known Kimi plan names; preserve unknown enum text safely.

Use a 10-second timeout. Invalid/missing required windows is an invalid-schema failure.

## Cache and Refresh Semantics

Keep provider caches independently so one provider’s failure never discards the other.

- Freshness interval: five minutes.
- `session_start`: fetch both in parallel.
- `turn_end` / `model_select`: fetch only when the cache is older than five minutes.
- `/quotas` opening: force both fetches in parallel.
- Prevent overlapping refreshes with one in-flight promise.
- Success replaces that provider’s cache.
- Failure with last-good data retains it indefinitely for this Pi session, marks it stale, and stores a sanitized current error for the widget.
- Failure without last-good data produces missing/error state.
- Session shutdown clears footer/widget and releases references.

## Minimal File Tree

```text
├── .github/workflows/ci.yml
├── .gitignore
├── LICENSE
├── README.md
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts       # extension lifecycle, cache coordinator, /quotas
│   ├── types.ts
│   ├── auth.ts
│   ├── codex.ts       # fetch + parse
│   ├── kimi.ts        # fetch + parse
│   └── format.ts      # footer + widget strings
└── tests/
    ├── fixtures/
    │   ├── codex-usage.json
    │   ├── kimi-usage.json
    │   └── kimi-usage-numeric-strings.json
    ├── codex.test.ts
    ├── kimi.test.ts
    ├── format.test.ts
    └── coordinator.test.ts
```

Do not create one-file abstractions for config, errors, JWT, cache, commands, headers, or app-server.

## Implementation Phases

### 1. Scaffold

Create package metadata, strict TypeScript config, MIT license, README skeleton, and CI. Use:

- `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as peer dependencies.
- Matching current packages as dev dependencies.
- Node built-ins only at runtime.
- `node --test` for tests.

Gate: `npm install` and `npm run check` pass with a minimal extension entry.

### 2. Pure parsers and formatters

Implement normalized types, Codex parser, Kimi parser, percentage/reset formatting, footer, and widget text. Build fixture tests first; no auth/network yet.

Gate: parser/formatter tests cover numeric strings, derived Kimi usage, missing windows, malformed resets, thresholds, stale/missing/error footer states, and secret-like error redaction.

### 3. Auth and clients

Implement Pi AuthStorage access, Codex account-id extraction, direct endpoint clients, timeout handling, Codex changed-token retry, and Kimi forced refresh/retry.

Gate: mocked tests prove exactly one retry, no forced refresh for API keys, no raw body/token in errors, and provider failures remain independent.

### 4. Coordinator and Pi UI

Wire parallel refresh, in-flight deduplication, five-minute freshness, last-good stale fallback, footer `setStatus`, widget `setWidget`, `/quotas` toggle, and shutdown cleanup.

Gate: mock Pi context tests verify lifecycle calls, `/usage` is never registered, `/quotas` toggles correctly, and one provider failure preserves the other.

### 5. Live smoke test

Load with:

```sh
pi -e ./src/index.ts
```

Verify:

1. Footer shows both real quotas.
2. `/quotas` shows detail widget; second invocation hides it.
3. Existing `/usage` still opens its dashboard.
4. Switching models does not duplicate status/widget entries.
5. Pi logs contain no bearer tokens, JWTs, account IDs, or raw provider bodies.
6. `/reload` and exit clean up session resources.

Record only sanitized percentages/statuses in implementation notes.

## Validation

Required commands:

```sh
npm run check
npm test
npm pack --dry-run
```

CI runs the same checks on Node 22.

## Release Preparation

- README: purpose, screenshot/text example, installation via `pi install git:github.com/iurysza/pi-codex-kimi-usage`, `/login` prerequisites, `/quotas`, refresh behavior, privacy/security, troubleshooting, and internal-endpoint warning.
- Package keywords: `pi-package`, `pi-extension`, `codex`, `kimi`, `quota`, `usage`.
- Start at `0.1.0`; do not publish or tag until live smoke test passes and user approves release.

## Acceptance Criteria

- Footer shows both providers from one `setStatus` slot.
- Codex and Kimi quota percentages match their provider quota surfaces during live smoke test.
- `/quotas` toggles a detailed static widget.
- Existing `/usage` remains unchanged.
- Direct endpoints only; no model calls, cookies, or Codex subprocess.
- Kimi recovers once from a revoked-but-unexpired OAuth token.
- Missing/failing providers do not hide working providers.
- Last-good data is visibly stale after refresh failure.
- No secrets/account identifiers/raw bodies are logged, persisted, or displayed.
- Typecheck, tests, and package dry-run pass.

## Deviation Policy

The implementer may make small local changes that simplify code or satisfy current Pi types and must record them in `implementation-notes.md`.

Stop and report before changing:

- auth/storage strategy;
- endpoint choice;
- network destinations;
- disk persistence;
- command/footer UX;
- adding dependencies or subprocesses;
- expanding quota scope beyond 5-hour + weekly windows.

If live response schemas differ, save only a manually sanitized structural fixture—never the raw authenticated response—and update parser tests before continuing.

## Unresolved Questions

None blocking. Low-risk defaults are fixed above. Release publishing remains a separate approval.
