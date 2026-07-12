# pi-codex-kimi-usage

A Pi extension that shows OpenAI Codex and Kimi Coding subscription quota in one compact footer status, with a `/quotas` command for the detailed view.

## Footer

```text
CX 5h 24% · 7d 61% | KM 5h 18% · 7d 43%
```

Colors: green below 70%, yellow at 70–89%, red at 90%+. A trailing `~` means the data is stale, `—` means credentials are missing, and `!` means the last fetch failed.

## Installation

```sh
pi install git:github.com/iurysza/pi-codex-kimi-usage
```

## Prerequisites

- `/login openai-codex` for Codex quota.
- `/login kimi-coding` (or `KIMI_API_KEY`) for Kimi quota.

## Commands

- `/quotas` — toggle the detailed quota widget above the editor.

## Refresh behavior

Quota refreshes on session start and again after each turn or model switch only when the cache is older than five minutes. Opening `/quotas` always forces a refresh.

## Privacy and security

- Only direct read-only quota endpoints are used.
- No browser cookies, dashboard scraping, model probes, or subprocesses.
- Tokens, JWTs, account IDs, and raw provider responses are never logged, displayed, or persisted outside Pi’s existing credential storage.

## Troubleshooting

- If a provider shows `—`, run `/login` for that provider.
- If a provider shows `!`, check your network and credentials.
- Full custom footers created with `ctx.ui.setFooter()` must render Pi extension statuses or they can hide this footer segment; `/quotas` still works.
- The Codex and Kimi endpoints are internal/provider surfaces and may change.
