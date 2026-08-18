// Pure markdown-formatting transforms for the structured SectionEditor's toolbar. Each
// function takes a value + selection and returns the new value plus the selection to
// restore in the textarea afterwards — no DOM, no Vue, so these are trivial to unit
// test in isolation from the focus/selection wiring that calls them.

export type FormatResult = { value: string; selStart: number; selEnd: number };

/**
 * Wraps the selection in `marker` on both sides (`**bold**`, `*italic*`, `` `code` ``).
 * With no selection (s === e), inserts an empty `markermarker` pair and places the
 * (collapsed) cursor between them, ready to type.
 */
export function wrapInline(value: string, s: number, e: number, marker: string): FormatResult {
  if (s === e) {
    const newValue = value.slice(0, s) + marker + marker + value.slice(e);
    const pos = s + marker.length;
    return { value: newValue, selStart: pos, selEnd: pos };
  }
  const selected = value.slice(s, e);
  const newValue = value.slice(0, s) + marker + selected + marker + value.slice(e);
  return { value: newValue, selStart: s + marker.length, selEnd: e + marker.length };
}

/**
 * Prepends a prefix to every line touched by the selection (bullets `- `, quote `> `,
 * or a numbered list via a `(lineIndexWithinSelection) => "1. "`-style function). A
 * collapsed cursor (s === e) touches just the line it sits in. Returns a selection
 * spanning the whole modified block, so the caller can see the result highlighted.
 */
export function prefixLines(
  value: string,
  s: number,
  e: number,
  makePrefix: string | ((lineIndex: number) => string),
): FormatResult {
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const nextNewline = value.indexOf('\n', e);
  const lineEnd = nextNewline === -1 ? value.length : nextNewline;

  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const prefixed = lines
    .map((line, i) => `${typeof makePrefix === 'function' ? makePrefix(i) : makePrefix}${line}`)
    .join('\n');

  const newValue = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
  return { value: newValue, selStart: lineStart, selEnd: lineStart + prefixed.length };
}

/**
 * Inserts a markdown link. The selection (or "text" if none) becomes the link text; the
 * returned selection covers the `https://` URL placeholder so the user can type the
 * real URL immediately without touching the mouse or keyboard navigation.
 */
export function insertLink(value: string, s: number, e: number): FormatResult {
  const selected = value.slice(s, e);
  const text = selected || 'text';
  const url = 'https://';
  const segment = `[${text}](${url})`;
  const newValue = value.slice(0, s) + segment + value.slice(e);
  const urlStart = s + `[${text}](`.length;
  const urlEnd = urlStart + url.length;
  return { value: newValue, selStart: urlStart, selEnd: urlEnd };
}
