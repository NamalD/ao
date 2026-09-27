let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Shows a short-lived message in the status bar, even in ambient mode where
 * ordinary status text is hidden. It clears itself unless replaced meanwhile.
 */
export function flashStatus(status: HTMLElement, message: string, ms = 2500): void {
  status.textContent = message;
  status.classList.remove("error");
  status.classList.add("flash");
  clearTimeout(timer);
  timer = setTimeout(() => {
    status.classList.remove("flash");
    if (status.textContent === message) status.textContent = "";
  }, ms);
}
