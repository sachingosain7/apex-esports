/**
 * Centralized Google Gemini Configuration & Fallbacks
 */
export const ACTIVE_GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
  "";

export function resolveGeminiKey(clientProvidedKey?: string | null): string {
  if (clientProvidedKey) {
    const trimmed = clientProvidedKey.trim();
    // Discard deleted project key that ended with 8GAcA
    if (trimmed.endsWith("8GAcA")) {
      return ACTIVE_GEMINI_API_KEY;
    }
    if (trimmed.length > 15) {
      return trimmed;
    }
  }
  return ACTIVE_GEMINI_API_KEY;
}

export interface GeminiExecutionResult {
  ok: boolean;
  status: number;
  text: string;
  data?: any;
}

/**
 * Dynamically queries Google's active model catalog and executes generateContent
 * with automated model failover (prevents 404 retired model errors).
 */
export async function executeGeminiGenerateContent(
  apiKey: string,
  payload: unknown
): Promise<GeminiExecutionResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };

  // 1. Discover active models dynamically from Google
  let activeModels: string[] = [];
  try {
    const listRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { headers }
    );
    if (listRes.ok) {
      const listData = await listRes.json();
      if (Array.isArray(listData?.models)) {
        activeModels = listData.models
          .filter((m: { supportedGenerationMethods?: string[] }) =>
            m.supportedGenerationMethods?.includes("generateContent")
          )
          .map((m: { name: string }) => m.name.replace(/^models\//, ""));
      }
    }
  } catch {}

  // 2. Candidate priority list (filtering out retired models like gemini-2.0-flash)
  const priorityList = [
    ...activeModels.filter((m) => m.includes("flash") && !m.includes("2.0")),
    ...activeModels,
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-2.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-2.5-pro",
    "gemini-1.5-pro-latest",
    "gemini-2.0-flash-exp",
  ].filter((m) => m && !m.includes("2.0-flash"));

  // Deduplicate while preserving order
  const modelQueue = Array.from(new Set(priorityList));

  let lastStatus = 500;
  let lastErrorText = "";

  for (const model of modelQueue) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      lastStatus = res.status;
      const responseText = await res.text();

      if (res.ok) {
        try {
          const data = JSON.parse(responseText);
          return { ok: true, status: 200, text: responseText, data };
        } catch {
          return { ok: true, status: 200, text: responseText };
        }
      }

      lastErrorText = responseText;

      // If error is 404 (model not found / retired), continue to next model
      if (res.status === 404) {
        continue;
      }

      // If auth or quota error, stop looping
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        break;
      }
    } catch (e: unknown) {
      lastErrorText = (e as Error).message || "Network request failed";
    }
  }

  return { ok: false, status: lastStatus, text: lastErrorText };
}
