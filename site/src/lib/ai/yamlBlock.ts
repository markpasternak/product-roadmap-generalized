// Shared "just enough yaml" scan for a leading fenced ```yaml block in an AI response —
// used by both `draftItem.ts` (new-item drafting) and `rewrite.ts` (rewrite-with-AI),
// which both prompt the AI for the same "optional fenced yaml block of suggested
// metadata, then the body" shape (KTD1: no new yaml-parser dependency, just a minimal
// `key: value` line scan).
export const YAML_BLOCK_RE = /^```ya?ml\s*\n([\s\S]*?)\n```[ \t]*\n?/;

/** Parses simple `key: value` lines out of a fenced yaml block's inner text (deliberately
 * not a real yaml parser — see KTD1). Quoted scalar values have their quotes stripped;
 * blank/comment lines are skipped. */
export function parseYamlBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    let val = m[2]!.trim();
    if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
      val = val.slice(1, -1);
    }
    if (val) out[key] = val;
  }
  return out;
}
