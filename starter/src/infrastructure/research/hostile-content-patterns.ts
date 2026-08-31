export type HostileTextCode =
  | "INSTRUCTION_OVERRIDE"
  | "ROLE_IMPERSONATION"
  | "TOOL_COMMAND"
  | "SECRET_EXFILTRATION"
  | "ENCODED_INSTRUCTION";

/** Deterministic lexical screen only; a match grants no semantic authority. */
export function hostilePhraseMatches(value: string) {
  const patterns = [
    ["INSTRUCTION_OVERRIDE", /\b(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions?\b/gi],
    ["ROLE_IMPERSONATION", /(?:^|[\s\[<])(?:system|developer|assistant)\s*(?:message)?\s*[:>\]]/gi],
    ["ROLE_IMPERSONATION", /\byou\s+are\s+(?:chatgpt|an?\s+ai\s+assistant|the\s+system)\b/gi],
    ["TOOL_COMMAND", /\b(?:call|invoke|execute|run)\s+(?:the\s+)?(?:tool|function|shell|command)\b/gi],
    ["SECRET_EXFILTRATION", /\b(?:reveal|send|upload|exfiltrate|print)\b[^.\n]{0,80}\b(?:api\s*key|password|credential|secret|system\s+prompt)\b/gi],
    ["ENCODED_INSTRUCTION", /\b(?:[A-Za-z0-9+/]{120,}={0,2})\b/g],
  ] as const satisfies readonly (readonly [HostileTextCode, RegExp])[];
  const matches: Array<Readonly<{ code: HostileTextCode; start: number; end: number }>> = [];
  for (const [code, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const start = match.index ?? 0;
      matches.push({ code, start, end: start + match[0].length });
    }
  }
  return matches.sort((left, right) => left.start - right.start || left.code.localeCompare(right.code));
}
