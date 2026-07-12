# pi-model-quotas

Provider-aware subscription quota status for [Pi](https://github.com/badlogic/pi-mono). It follows the active model, fetches only that provider’s quota, and keeps the footer quiet for unsupported providers.

```text
▰▱▱▱  24%  ↻  3:25
```

## Supported providers

| Active model provider | Subscription | Authentication | Quota windows |
| --- | --- | --- | --- |
| `openai`, `openai-codex` | OpenAI Codex | Pi `/login openai-codex` | 5 hour, weekly |
| `kimi-coding` | Kimi Coding | Pi `/login kimi-coding` or `KIMI_API_KEY` | 5 hour, weekly |

Unsupported model providers produce no footer status.

OpenCode Go is intentionally not supported yet. Its proposed API-key-authenticated usage endpoint is still unmerged upstream; current alternatives require scraping console HTML with an expiring browser cookie. Once an official endpoint ships, its 5-hour, weekly, and monthly limits can be added as a normal provider adapter.

## Install

```sh
pi install git:github.com/iurysza/pi-model-quotas
```

Then authenticate the provider you use:

```text
/login openai-codex
/login kimi-coding
```

Reload Pi after installation.

## Footer modes

Minimal mode is the default and shows the provider’s primary window:

```text
▰▱▱▱  24%  ↻  3:25
```

Full mode adds the configured secondary window:

```text
5h  ▰▱▱▱  24%  ↻ 3:25   ·   7d  ▰▱▱▱  15%  ↻ Sun 9:00
```

- Four gauge cells represent 25-point usage buckets.
- Only the percentage receives threshold color: green below 70%, yellow from 70–89%, red at 90% or higher.
- `~` after a percentage means the extension is showing stale last-good data.
- Reset timestamps use local time.

## Commands

| Command | Action |
| --- | --- |
| `/quotas` | Toggle detailed quota data for every configured provider |
| `/quotas minimal` | Show only the active provider’s primary window |
| `/quotas full` | Show the active provider’s configured full window set |

The selected mode is stored in `pi-model-quotas.json` under Pi’s agent directory. The file contains only `{ "footerMode": "minimal" | "full" }`—never credentials or quota data.

## Refresh and failure behavior

- Fetches the active provider on session start.
- Refreshes after turns and model switches when cached data is older than five minutes.
- Routes immediately when the active model changes.
- Opening `/quotas` forces all registered providers to refresh independently.
- Keeps last-good data and marks it stale if a later request fails.
- Shows `—` when credentials are missing and `!` when a request fails without cached data.

## Privacy

- Uses direct, read-only provider quota endpoints.
- Reuses Pi’s `AuthStorage`; no separate login flow.
- Does not read browser cookies, scrape dashboards, probe models, or spawn subprocesses.
- Never persists tokens, account IDs, raw responses, or quota data.

Current data sources:

- Codex: `https://chatgpt.com/backend-api/wham/usage`
- Kimi: `https://api.kimi.com/coding/v1/usages`

These are provider-controlled surfaces and may change.

## Development

```sh
npm install
npm run check
npm test
npm pack --dry-run
```

Tests cover response parsing, credential refresh, dynamic provider registration, cache isolation, formatting, preference persistence, and extension lifecycle behavior.

## Troubleshooting

- `—`: authenticate the active model provider.
- `!`: verify credentials and network access.
- Missing footer segment with a custom footer: the custom `ctx.ui.setFooter()` implementation must render extension statuses. `/quotas` remains available.
