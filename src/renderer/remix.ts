/**
 * Remix (Alt+R): randomly perturb the numbers in the block under the cursor.
 * The whole remix is one transaction and one undo step, isolated from the
 * edits around it, so a single `u` or Ctrl+Z restores the exact original.
 */
import { isolateHistory } from "@codemirror/commands";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { blockAt } from "./blocks";
import { remixChanges, runRangeAt } from "./numbers";

export interface Remix {
  /** The transaction to dispatch. */
  spec: TransactionSpec;
  /** How many literals changed. */
  count: number;
}

/**
 * A remix of the block around the cursor, or null when there is nothing to
 * change: a blank line, or a block without numbers.
 */
export function remix(state: EditorState, random: () => number = Math.random): Remix | null {
  const block = blockAt(state.doc.toString(), state.selection.main.head);
  if (!block) return null;
  const changes = remixChanges(state, block.from, block.to, random);
  if (!changes.length) return null;
  return {
    spec: { changes, userEvent: "input.remix", annotations: isolateHistory.of("full"), scrollIntoView: false },
    count: changes.length,
  };
}

/** The code to re-run after a remix, from the state it produced. */
export function remixRunRange(state: EditorState): { from: number; to: number } | null {
  return runRangeAt(state, state.selection.main.head);
}
