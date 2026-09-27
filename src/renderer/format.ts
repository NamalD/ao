import type { ChangeSpec } from "@codemirror/state";
import { formatWithCursor } from "prettier/standalone";
import * as babel from "prettier/plugins/babel";
import * as estree from "prettier/plugins/estree";

/** How sketches are formatted: Prettier's defaults, without semicolons. */
const options = { parser: "babel", plugins: [babel, estree], semi: false, printWidth: 100 };

/**
 * `code` formatted, with `cursor` (an offset into `code`) carried to the same
 * place in the result. Null when the code doesn't parse, such as a block cut
 * out of the middle of a scene string: it is left as written.
 */
export async function formatCode(code: string, cursor = 0): Promise<{ code: string; cursor: number } | null> {
  try {
    const result = await formatWithCursor(code, { ...options, cursorOffset: Math.min(cursor, code.length) });
    // Runs are whole lines with no trailing newline; keep it that way.
    const formatted = result.formatted.replace(/\n+$/, "");
    return { code: formatted, cursor: Math.min(result.cursorOffset, formatted.length) };
  } catch {
    return null;
  }
}

/**
 * The smallest single change turning `before` into `after`, placed at `from`
 * in the document: the common start and end stay untouched, so marks and
 * positions outside the reformatted part keep their place.
 */
export function minimalChange(before: string, after: string, from = 0): ChangeSpec | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start
    && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { from: from + start, to: from + before.length - end, insert: after.slice(start, after.length - end) };
}
