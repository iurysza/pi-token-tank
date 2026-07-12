import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { getAuthStorage, type AuthStorageLike } from "./auth.js";
import { formatFooter, formatWidget } from "./format.js";
import { loadFooterMode, saveFooterMode, type FooterMode } from "./preferences.js";
import { providerForModel as findProviderForModel, providers } from "./providers.js";
import type { ProviderId, ProviderQuota, QuotaProvider, QuotaSnapshot } from "./types.js";

const STATUS_KEY = "pi-model-quotas";
const WIDGET_KEY = "pi-model-quotas";
const FRESHNESS_MS = 5 * 60 * 1000;

interface CacheEntry {
  data?: ProviderQuota;
  inflight?: Promise<ProviderQuota>;
}

export function createCoordinator(storage: AuthStorageLike, registry: readonly QuotaProvider[]) {
  const caches = new Map<ProviderId, CacheEntry>(registry.map((provider) => [provider.id, {}]));
  const providerById = new Map(registry.map((provider) => [provider.id, provider]));

  async function refresh(providerId: ProviderId, force: boolean): Promise<ProviderQuota> {
    const provider = providerById.get(providerId);
    const cache = caches.get(providerId);
    if (!provider || !cache) throw new Error(`Unknown quota provider: ${providerId}`);
    if (!force && cache.data?.fetchedAt && Date.now() - cache.data.fetchedAt < FRESHNESS_MS) {
      return cache.data;
    }
    if (cache.inflight) return cache.inflight;

    cache.inflight = provider.fetch(storage)
      .then((quota) => {
        const previous = cache.data;
        if (
          (quota.state === "error" || quota.state === "missing") &&
          previous &&
          (previous.state === "live" || previous.state === "stale")
        ) {
          cache.data = { ...previous, state: "stale", error: quota.error };
        } else {
          cache.data = quota;
        }
        cache.inflight = undefined;
        return cache.data;
      })
      .catch(() => {
        const previous = cache.data;
        cache.data = previous && (previous.state === "live" || previous.state === "stale")
          ? { ...previous, state: "stale", error: "Unexpected quota refresh failure." }
          : { provider: providerId, state: "error", windows: [], error: "Unexpected quota refresh failure." };
        cache.inflight = undefined;
        return cache.data;
      });
    return cache.inflight;
  }

  async function refreshAll(force: boolean): Promise<QuotaSnapshot> {
    await Promise.all(registry.map((provider) => refresh(provider.id, force)));
    return getSnapshot();
  }

  function getSnapshot(): QuotaSnapshot {
    return Object.fromEntries(registry.map((provider) => [
      provider.id,
      caches.get(provider.id)?.data ?? { provider: provider.id, state: "missing", windows: [] },
    ]));
  }

  function clear(): void {
    for (const cache of caches.values()) {
      cache.data = undefined;
      cache.inflight = undefined;
    }
  }

  return { refresh, refreshAll, getSnapshot, clear };
}

function makeThemeLike(ctx: ExtensionContext["ui"]) {
  return {
    fg: (color: Parameters<typeof ctx.theme.fg>[0], text: string) => ctx.theme.fg(color, text),
  };
}

export function providerForModel(model: ExtensionContext["model"]): ProviderId | undefined {
  return findProviderForModel(model)?.id;
}

export function createPiModelQuotas(
  pi: ExtensionAPI,
  storageOverride?: AuthStorageLike,
  preferenceFile?: string,
  registry: readonly QuotaProvider[] = providers,
) {
  const storage = storageOverride ?? getAuthStorage();
  const coordinator = createCoordinator(storage, registry);
  let widgetVisible = false;
  let footerMode: FooterMode = "minimal";

  function updateFooter(ctx: ExtensionContext) {
    const provider = findProviderForModel(ctx.model, registry);
    if (!provider) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    const quota = coordinator.getSnapshot()[provider.id];
    ctx.ui.setStatus(
      STATUS_KEY,
      formatFooter(quota, footerMode, makeThemeLike(ctx.ui), provider.footerWindows[footerMode]),
    );
  }

  function updateWidget(ctx: ExtensionContext["ui"]) {
    if (!widgetVisible) {
      ctx.setWidget(WIDGET_KEY, undefined);
      return;
    }
    ctx.setWidget(WIDGET_KEY, formatWidget(coordinator.getSnapshot(), registry, makeThemeLike(ctx), Date.now()));
  }

  async function refreshAndRender(ctx: ExtensionContext, force: boolean) {
    const provider = findProviderForModel(ctx.model, registry);
    updateFooter(ctx);
    if (provider) await coordinator.refresh(provider.id, force);
    updateFooter(ctx);
    if (widgetVisible) updateWidget(ctx.ui);
  }

  pi.on("session_start", async (_event, ctx) => {
    footerMode = await loadFooterMode(preferenceFile);
    await refreshAndRender(ctx, true);
  });
  pi.on("turn_end", async (_event, ctx) => refreshAndRender(ctx, false));
  pi.on("model_select", async (event, ctx) => {
    await refreshAndRender({ ...ctx, model: event.model } as ExtensionContext, false);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    coordinator.clear();
  });

  pi.registerCommand("quotas", {
    description: "Toggle details or set footer mode: minimal | full",
    getArgumentCompletions: (prefix) => ["minimal", "full"]
      .filter((value) => value.startsWith(prefix.trim()))
      .map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const argument = args.trim();
      if (argument === "minimal" || argument === "full") {
        footerMode = argument;
        updateFooter(ctx);
        await saveFooterMode(footerMode, preferenceFile);
        return;
      }
      if (argument) {
        ctx.ui.notify("Usage: /quotas [minimal|full]", "warning");
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/quotas requires TUI mode", "warning");
        return;
      }
      widgetVisible = !widgetVisible;
      if (widgetVisible) await coordinator.refreshAll(true);
      updateFooter(ctx);
      updateWidget(ctx.ui);
    },
  });
}

export { providers } from "./providers.js";
export type { QuotaProvider } from "./types.js";

export default function piCodexKimiUsage(pi: ExtensionAPI) {
  return createPiModelQuotas(pi);
}
