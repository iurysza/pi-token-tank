<p align="center">
  <img src="assets/token-tank-banner.png" width="720" alt="Token Tank fuel gauge banner">
</p>

<h1 align="center">pi-token-tank</h1>

<p align="center"><strong>Your token mileage at a glance.</strong></p>

Provider-aware subscription quota status for Pi. It follows the active model and fetches that provider’s quota.

```text
▰▱▱▱  24%  ↻  3:25
```

## Supported providers

| Active model provider | Subscription | Authentication | Quota windows |
| --- | --- | --- | --- |
| `openai`, `openai-codex` | OpenAI Codex | Pi `/login openai-codex` | 5 hour, weekly |
| `kimi-coding` | Kimi Coding | Pi `/login kimi-coding` or `KIMI_API_KEY` | 5 hour, weekly |
| `github-copilot` | GitHub Copilot | Pi `/login github-copilot` | Monthly AI credits/premium requests |

Unsupported model providers produce no footer status.

## Install

```sh
pi install git:github.com/iurysza/pi-token-tank
```

Then authenticate the provider you use:

```text
/login openai-codex
/login kimi-coding
/login github-copilot
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
- Percentage colors show urgency: green under 70%, yellow under 90%, red at 90%+.
- `~` after a percentage means the extension is showing stale last-good data.
- Reset timestamps use local time.

## Commands

| Command | Action |
| --- | --- |
| `/token-tank` | Toggle detailed quota data for every configured provider |
| `/token-tank minimal` | Use the compact footer with the primary quota window |
| `/token-tank full` | Use the bigger footer with every configured quota window |

The details panel also reminds you about `minimal` and `full`, so the larger view is easy to discover.

The selected mode is stored in `pi-token-tank.json` under Pi’s agent directory. The file contains only `{ "footerMode": "minimal" | "full" }`—never credentials or quota data.

## Refresh and failure behavior

- Fetches the active provider on session start.
- Refreshes after turns and model switches when cached data is older than five minutes.
- Routes immediately when the active model changes.
- Opening `/token-tank` forces all registered providers to refresh independently.
- Keeps last-good data and marks it stale if a later request fails.
- Shows `—` when credentials are missing and `!` when a request fails without cached data.

## Provider API notes

GitHub Copilot quota uses the read-only, undocumented `https://api.github.com/copilot_internal/user` endpoint. It supports GitHub.com, including Enterprise Cloud seats hosted on GitHub.com; custom GitHub Enterprise Server domains are rejected before any request. Token Tank reads Pi's stored GitHub OAuth token only in memory for that request. Tokens and raw responses are never logged, cached, or persisted. Normalized quota uses the existing in-memory five-minute/stale cache and is never persisted. The endpoint may change without notice.

Cursor is not supported. Pi has no core Cursor provider, and Cursor does not expose a safe official individual-plan quota API. Token Tank will not read browser sessions or scrape Cursor dashboards.

## Development

```sh
npm install
npm run check
npm test
npm pack --dry-run
```

## Troubleshooting

- `—`: authenticate the active model provider.
- `!`: verify credentials and network access.
- Missing footer segment with a custom footer: the custom `ctx.ui.setFooter()` implementation must render extension statuses. `/token-tank` remains available.
