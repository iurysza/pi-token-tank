import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { getAuthStorage, type AuthStorageLike } from "./auth.js";
import { fetchCodexQuota } from "./codex.js";
import { formatFooter, formatWidget } from "./format.js";
import { fetchKimiQuota } from "./kimi.js";
import { loadFooterMode, saveFooterMode, type FooterMode } from "./preferences.js";
import type { ProviderName, ProviderQuota, QuotaSnapshot } from "./types.js";

const STATUS_KEY = "pi-codex-kimi-usage";
const WIDGET_KEY = "pi-codex-kimi-usage";
const FRESHNESS_MS = 5 * 60 * 1000;

type Fetcher = (storage: AuthStorageLike) => Promise<ProviderQuota>;

interface CacheEntry {
  data?: ProviderQuota;
  inflight?: Promise<ProviderQuota>;
}

export function createCoordinator(storage: AuthStorageLike, fetchers: Record<ProviderName, Fetcher>) {
  const caches: Record<ProviderName, CacheEntry> = {
    codex: {},
    kimi: {},
  };

  async function refresh(provider: ProviderName, force: boolean): Promise<ProviderQuota> {
    const cache = caches[provider]!;
    if (!force && cache.data?.fetchedAt && Date.now() - cache.data.fetchedAt < FRESHNESS_MS) {
      return cache.data;
    }
    if (cache.inflight) {
      return cache.inflight;
    }

    cache.inflight = fetchers[provider]!(storage)
      .then((quota) => {
        const previous = cache.data;
        if (
          (quota.state === "error" || quota.state === "missing") &&
          previous &&
          (previous.state === "live" || previous.state === "stale")
        ) {
          cache.data = {
            ...previous,
            state: "stale",
            error: quota.error,
          };
        } else {
          cache.data = quota;
        }
        cache.inflight = undefined;
        return cache.data;
      })
      .catch(() => {
        const previous = cache.data;
        if (previous && (previous.state === "live" || previous.state === "stale")) {
          cache.data = {
            ...previous,
            state: "stale",
            error: "Unexpected quota refresh failure.",
          };
        } else {
          cache.data = {
            provider,
            state: "error",
            windows: [],
            error: "Unexpected quota refresh failure.",
          };
        }
        cache.inflight = undefined;
        return cache.data;
      });

    return cache.inflight;
  }

  async function refreshAll(force: boolean): Promise<QuotaSnapshot> {
    const [codex, kimi] = await Promise.all([
      refresh("codex", force),
      refresh("kimi", force),
    ]);
    return { codex, kimi };
  }

  function getSnapshot(): QuotaSnapshot {
    return {
      codex: caches.codex.data ?? { provider: "codex", state: "missing", windows: [] },
      kimi: caches.kimi.data ?? { provider: "kimi", state: "missing", windows: [] },
    };
  }

  function clear(): void {
    caches.codex.data = undefined;
    caches.codex.inflight = undefined;
    caches.kimi.data = undefined;
    caches.kimi.inflight = undefined;
  }

  return { refresh, refreshAll, getSnapshot, clear };
}

function makeThemeLike(ctx: ExtensionContext["ui"]) {
  return {
    fg: (color: Parameters<typeof ctx.theme.fg>[0], text: string) => ctx.theme.fg(color, text),
  };
}

export function providerForModel(model: ExtensionContext["model"]): ProviderName | undefined {
  const provider = model?.provider.toLowerCase();
  if (provider === "openai" || provider === "openai-codex") return "codex";
  if (provider === "kimi-coding") return "kimi";
  return undefined;
}

export function createPiCodexKimiUsage(
  pi: ExtensionAPI,
  storageOverride?: AuthStorageLike,
  preferenceFile?: string,
) {
  const storage = storageOverride ?? getAuthStorage();
  const coordinator = createCoordinator(storage, {
    codex: fetchCodexQuota,
    kimi: fetchKimiQuota,
  });

  let widgetVisible = false;
  let footerMode: FooterMode = "minimal";

  function updateFooter(ctx: ExtensionContext) {
    const provider = providerForModel(ctx.model);
    if (!provider) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    const quota = coordinator.getSnapshot()[provider];
    ctx.ui.setStatus(STATUS_KEY, formatFooter(quota, footerMode, makeThemeLike(ctx.ui)));
  }

  function updateWidget(ctx: ExtensionContext["ui"]) {
    if (!widgetVisible) {
      ctx.setWidget(WIDGET_KEY, undefined);
      return;
    }
    const snapshot = coordinator.getSnapshot();
    ctx.setWidget(WIDGET_KEY, formatWidget(snapshot, makeThemeLike(ctx), Date.now()));
  }

  async function refreshAndRender(ctx: ExtensionContext, force: boolean) {
    const provider = providerForModel(ctx.model);
    updateFooter(ctx);
    if (provider) await coordinator.refresh(provider, force);
    updateFooter(ctx);
    if (widgetVisible) updateWidget(ctx.ui);
  }

  pi.on("session_start", async (_event, ctx) => {
    footerMode = await loadFooterMode(preferenceFile);
    await refreshAndRender(ctx, true);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await refreshAndRender(ctx, false);
  });

  pi.on("model_select", async (event, ctx) => {
    const selectedContext = { ...ctx, model: event.model } as ExtensionContext;
    await refreshAndRender(selectedContext, false);
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

export default function piCodexKimiUsage(pi: ExtensionAPI) {
  return createPiCodexKimiUsage(pi);
}
