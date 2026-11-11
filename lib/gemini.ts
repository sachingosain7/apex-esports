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
