import { fetchCodexQuota } from "./codex.js";
import { fetchKimiQuota } from "./kimi.js";
import type { QuotaProvider } from "./types.js";

export const providers: readonly QuotaProvider[] = [
  {
    id: "codex",
    label: "Codex",
    matchesModel: (model) => {
      const provider = model?.provider.toLowerCase();
      return provider === "openai" || provider === "openai-codex";
    },
    fetch: fetchCodexQuota,
    credentialsHint: "Run /login openai-codex.",
    footerWindows: { minimal: ["five-hour"], full: ["five-hour", "weekly"] },
  },
  {
    id: "kimi",
    label: "Kimi",
    matchesModel: (model) => model?.provider.toLowerCase() === "kimi-coding",
    fetch: fetchKimiQuota,
    credentialsHint: "Run /login kimi-coding or set KIMI_API_KEY.",
    footerWindows: { minimal: ["five-hour"], full: ["five-hour", "weekly"] },
  },
];

export function providerForModel(
  model: Parameters<QuotaProvider["matchesModel"]>[0],
  registry: readonly QuotaProvider[] = providers,
): QuotaProvider | undefined {
  return registry.find((provider) => provider.matchesModel(model));
}
