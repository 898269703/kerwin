export class SerialWorkQueue {
  private tail: Promise<void> = Promise.resolve();

  push(task: () => Promise<void>): void {
    const run = () => task();
    this.tail = this.tail.then(run, run).catch((error) => {
      console.error('[scheduler] task failed', error);
    });
  }

  async whenIdle(): Promise<void> {
    await this.tail;
  }
}
