// Anonymous failures get at most one audit row per IP per minute, capped at 60
// globally per minute per backend process. Rotating source addresses cannot grow
// either the in-memory map or audit storage without bound in a time window.
// Rows the budget drops are counted, and each window with drops is reported
// once (via onWindowClosed) when the next window starts.
export interface DroppedRejections {
  windowStart: Date;
  dropped: number;
}

export class RejectionAuditBudget {
  private window = -1;
  private sources = new Set<string>();
  private dropped = 0;
  constructor(private readonly onWindowClosed: (summary: DroppedRejections) => void = () => {}) {}

  allow(ip: string, now = Date.now()): boolean {
    this.roll(now);
    if (this.sources.has(ip) || this.sources.size >= 60) {
      this.dropped++;
      return false;
    }
    this.sources.add(ip);
    return true;
  }

  // Closes the window if `now` is past it. Called by allow() and by a timer, so
  // the last window with drops is reported even if no request follows it.
  roll(now = Date.now()): void {
    const window = Math.floor(now / 60_000);
    if (window === this.window) return;
    if (this.dropped > 0) this.onWindowClosed({ windowStart: new Date(this.window * 60_000), dropped: this.dropped });
    this.window = window;
    this.sources.clear();
    this.dropped = 0;
  }
}
