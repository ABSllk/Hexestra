export class AgentStreamScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastEmittedAt = 0;

  constructor(private readonly intervalMs = 100) {}

  schedule(emit: () => void) {
    const remaining = this.intervalMs - (Date.now() - this.lastEmittedAt);
    if (remaining <= 0 && !this.timer) {
      this.lastEmittedAt = Date.now();
      emit();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.lastEmittedAt = Date.now();
      emit();
    }, Math.max(0, remaining));
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
