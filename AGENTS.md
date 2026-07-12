# Agent Notes

Provider-neutral Pi quota extension. Keep the README user-facing.

Before changing provider contracts, routing, caching, or adding a provider, read [[ai-artifacts/MOC]] and [[ai-artifacts/provider-adapters]].

Rules:

- Use direct read-only quota endpoints.
- Reuse Pi `AuthStorage`; never persist credentials or quota data.
- Keep provider-specific auth and parsing inside its adapter/fetcher.
- Run `npm run check`, `npm test`, and `npm pack --dry-run` before shipping.
