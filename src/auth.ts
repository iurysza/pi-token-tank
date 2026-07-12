import { AuthStorage } from "@earendil-works/pi-coding-agent";
import type { AuthCredential } from "@earendil-works/pi-coding-agent";

export type AuthStorageLike = Pick<
  AuthStorage,
  "get" | "getApiKey" | "reload" | "getOAuthProviders" | "set"
>;

export function getAuthStorage(): AuthStorage {
  return AuthStorage.create();
}

interface OAuthLikeCredential {
  type?: string;
  accountId?: string;
  access?: string;
  refresh?: string;
  expires?: number;
}

function toOAuthLike(cred: unknown): OAuthLikeCredential | undefined {
  if (!cred || typeof cred !== "object" || Array.isArray(cred)) return undefined;
  return cred as OAuthLikeCredential;
}

function extractAccountId(cred: unknown): string | undefined {
  const o = toOAuthLike(cred);
  if (o?.accountId && typeof o.accountId === "string" && o.accountId.length > 0) {
    return o.accountId;
  }
  return undefined;
}

function extractAccountIdFromJwt(token: string): string | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    const auth = payload["https://api.openai.com/auth"];
    const accountId = auth?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
  } catch {
    return undefined;
  }
}

export type CodexAuthResult =
  | { token: string; accountId: string }
  | { error: string };

export async function getCodexAuth(
  storage: AuthStorageLike,
): Promise<CodexAuthResult> {
  const token = await storage.getApiKey("openai-codex", { includeFallback: false });
  if (!token) {
    return { error: "Codex credentials missing. Run /login openai-codex." };
  }
  const cred = storage.get("openai-codex");
  let accountId = extractAccountId(cred);
  if (!accountId) {
    accountId = extractAccountIdFromJwt(token);
  }
  if (!accountId) {
    return { error: "Codex account id missing. Run /login openai-codex again." };
  }
  return { token, accountId };
}

export type KimiCredentialType = "oauth" | "api_key";

export type KimiAuthResult =
  | { token: string; type: KimiCredentialType }
  | { error: string };

export async function getKimiAuth(
  storage: AuthStorageLike,
): Promise<KimiAuthResult> {
  const token = await storage.getApiKey("kimi-coding");
  if (!token) {
    const envKey = process.env.KIMI_API_KEY?.trim();
    if (envKey) {
      return { token: envKey, type: "api_key" };
    }
    return { error: "Kimi credentials missing. Run /login kimi-coding or set KIMI_API_KEY." };
  }
  const cred = storage.get("kimi-coding");
  return { token, type: toOAuthLike(cred)?.type === "oauth" ? "oauth" : "api_key" };
}

export async function refreshKimiToken(
  storage: AuthStorageLike,
  currentKey: string,
): Promise<string | null> {
  storage.reload();
  const cred = storage.get("kimi-coding");
  if (!cred || toOAuthLike(cred)?.type !== "oauth") {
    return null;
  }
  const oauth = toOAuthLike(cred)!;
  if (oauth.access && oauth.access !== currentKey && oauth.expires && Date.now() < oauth.expires) {
    return oauth.access;
  }
  if (!oauth.refresh) return null;

  const providers = storage.getOAuthProviders();
  const provider = providers.find((p) => p.id === "kimi-coding");
  if (!provider) return null;

  try {
    const refreshed = await provider.refreshToken({
      access: oauth.access ?? currentKey,
      refresh: oauth.refresh,
      expires: oauth.expires ?? 0,
    });
    storage.reload();
    const after = storage.get("kimi-coding");
    const afterOAuth = toOAuthLike(after);
    if (afterOAuth?.access && afterOAuth.access !== currentKey) {
      return afterOAuth.access;
    }
    if (!refreshed.access || !refreshed.refresh || !Number.isFinite(refreshed.expires)) {
      return null;
    }
    const newCred = {
      ...cred,
      type: "oauth" as const,
      access: refreshed.access,
      refresh: refreshed.refresh,
      expires: refreshed.expires,
    };
    storage.set("kimi-coding", newCred as AuthCredential);
    return refreshed.access;
  } catch {
    return null;
  }
}
