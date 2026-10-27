import type { ChildProcess } from "node:child_process";

// Retain exit promises even after stop() clears a worker reference or another
// subscriber starts a replacement. A graceful server close must await both.
export class ChildLifecycle {
  private pending = new Set<Promise<void>>();
  track(child: ChildProcess) {
    const exited = new Promise<void>(done => child.once("close", () => done()));
    this.pending.add(exited);
    void exited.then(() => this.pending.delete(exited));
  }
  async close() { await Promise.all([...this.pending]); }
}
