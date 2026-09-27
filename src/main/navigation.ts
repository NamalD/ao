/**
 * Whether the app window may navigate from `current` to `target`: only to the
 * same page (a reload, possibly with a new query or hash). Anything else would
 * hand the preload bridge to a page that isn't Ao.
 */
export function isAppNavigation(target: string, current: string): boolean {
  try {
    const to = new URL(target), from = new URL(current);
    return to.protocol === from.protocol && to.host === from.host && to.pathname === from.pathname;
  } catch {
    return false;
  }
}
