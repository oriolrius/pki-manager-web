// Anonymous failures get at most one audit row per IP per minute, capped at 60
// globally per minute per backend process. Rotating source addresses cannot grow
// either the in-memory map or audit storage without bound in a time window.
export class RejectionAuditBudget {
  private window = -1;
  private sources = new Set<string>();
  allow(ip: string, now = Date.now()): boolean {
    const window = Math.floor(now / 60_000);
    if (window !== this.window) { this.window = window; this.sources.clear(); }
    if (this.sources.has(ip) || this.sources.size >= 60) return false;
    this.sources.add(ip); return true;
  }
}
