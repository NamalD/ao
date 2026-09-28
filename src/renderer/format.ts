import type { ChangeSpec } from "@codemirror/state";
import type { AstPath, Doc, Printer } from "prettier";
import { builders } from "prettier/doc";
import { formatWithCursor } from "prettier/standalone";
import * as babel from "prettier/plugins/babel";
import * as estree from "prettier/plugins/estree";

/** Where a method chain stands on its own, so it is always chopped one call per line. */
const CHOPPED_PARENTS = new Set(["ExpressionStatement", "VariableDeclarator", "AssignmentExpression", "ReturnStatement"]);

/**
 * Prettier's estree printer, except that a method chain standing as its own
 * statement or value is chopped one call per line even when it would fit on
 * one line. Prettier prints such a chain as a choice between its one-line and
 * chopped layouts, labelled `memberChain`; this keeps only the chopped one.
 * Chains nested in arguments, like `src(o0).scale(1.01)`, still fit to width.
 */
const estreePrinter = (estree as unknown as { printers: { estree: Printer } }).printers.estree;
const choppingPrinter: Printer = {
  ...estreePrinter,
  print(path: AstPath, options, print, args) {
    const printed = estreePrinter.print(path, options, print, args);
    return CHOPPED_PARENTS.has(path.parent?.type) ? chopped(printed) : printed;
  },
};


function chopped(doc: Doc): Doc {
  if (typeof doc !== "object" || Array.isArray(doc) || doc.type !== "label" || !doc.label?.memberChain) return doc;
  const choice = Array.isArray(doc.contents) ? doc.contents.find((part) => typeof part === "object" && "expandedStates" in part) : null;
  const expanded = choice && "expandedStates" in choice ? choice.expandedStates?.at(-1) : null;
  return expanded ? builders.label(doc.label, builders.group(expanded, { shouldBreak: true })) : doc;
}

/** How sketches are formatted: Prettier's defaults, without semicolons, chains chopped. */
const options = {
  parser: "babel",
  plugins: [babel, { ...estree, printers: { estree: choppingPrinter } }],
  semi: false,
  printWidth: 100,
};

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
