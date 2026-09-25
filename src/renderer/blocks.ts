/**
 * The block around `pos`: the run of non-blank lines containing it, as in
 * Hydra's editor. Returns null when the cursor sits on a blank line.
 */
export function blockAt(text: string, pos: number): { from: number; to: number } | null {
  const lines = text.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  let index = starts.findLastIndex((start) => start <= pos);
  const blank = (i: number) => lines[i].trim() === "";
  if (index < 0 || blank(index)) return null;
  let first = index, last = index;
  while (first > 0 && !blank(first - 1)) first--;
  while (last < lines.length - 1 && !blank(last + 1)) last++;
  return { from: starts[first], to: starts[last] + lines[last].length };
}
