# pi-codex-kimi-usage

A Pi extension that shows the active model family's subscription quota in the footer. OpenAI/OpenAI-Codex models show Codex quota; `kimi-coding` models show Kimi quota. Unsupported providers show no quota status.

## Footer

The default `minimal` mode shows the 5-hour window:

```text
▰▱▱▱  24%  ↻  3:25
```

`full` mode adds the weekly window:

```text
5h  ▰▱▱▱  24%  ↻ 3:25   ·   7d  ▰▱▱▱  15%  ↻ Sun 9:00
```

The four-cell gauge represents quota pressure in 25-point buckets. Percentages stay exact and alone receive threshold color: green below 70%, yellow at 70–89%, red at 90%+. A trailing `~` marks stale last-good data. Reset timestamps use local wall-clock time.

## Installation

```sh
pi install git:github.com/iurysza/pi-codex-kimi-usage
```

## Prerequisites

- `/login openai-codex` for Codex quota.
- `/login kimi-coding` (or `KIMI_API_KEY`) for Kimi quota.

## Commands

- `/quotas` — toggle the detailed widget showing both providers.
- `/quotas minimal` — use the compact 5-hour footer.
- `/quotas full` — show 5-hour and weekly footer windows.

Footer mode defaults to `minimal` and is stored globally in `pi-codex-kimi-usage.json` under Pi's agent directory. This file contains only the display preference, never quota data or credentials.

## Refresh behavior

Quota refreshes on session start and after each turn or model switch when its cache is older than five minutes. Model switches immediately route the footer to the selected provider. Opening bare `/quotas` forces both providers to refresh.

## Adding providers

Providers are registered in `src/providers.ts` through the exported `QuotaProvider` contract. An adapter supplies its ID and label, active-model matcher, quota fetcher, credential hint, and the window IDs used by minimal/full footer modes. The coordinator, cache, stale-data handling, model routing, and `/quotas` widget derive from that registry.

Provider fetchers normalize API responses into labeled `QuotaWindow` values, so new window types such as monthly limits require no formatter changes.

### OpenCode Go

OpenCode Go support is waiting for an official API-key-authenticated usage endpoint. The proposed `/zen/go/v1/usage` endpoint is not merged upstream; current alternatives require scraping console HTML with an expiring browser cookie. Once the official endpoint ships, Go can be added as one adapter with 5-hour, weekly, and monthly windows.

## Privacy and security

- Only direct read-only quota endpoints are used.
- No browser cookies, dashboard scraping, model probes, or subprocesses.
- Tokens, JWTs, account IDs, raw provider responses, and quota data are never persisted by this extension.

## Troubleshooting

- If the footer shows `—`, log in to the active model's provider.
- If it shows `!`, check network and credentials.
- Full custom footers created with `ctx.ui.setFooter()` must render Pi extension statuses or they can hide this footer segment; `/quotas` still works.
- The Codex and Kimi endpoints are internal/provider surfaces and may change.
