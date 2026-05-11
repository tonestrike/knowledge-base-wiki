/**
 * Truncate prompt / completion previews to keep span payloads small.
 * 500 chars is enough to recognize "is this the system prompt I expect"
 * without blowing past Langfuse's per-attribute size budget.
 */
export const previewText = (text: string | undefined | null, max = 500): string | undefined => {
  if (!text) return undefined;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
};
