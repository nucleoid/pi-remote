export type CursorItem = { cursor: number };
export class ReplaySubscription<T extends CursorItem = CursorItem> {
  #head = 0;
  #started = false;
  #last = 0;
  #buffer = new Map<number,T>();
  #deliver?: (item:T)=>void|Promise<void>;
  constructor(readonly maxBufferedItems: number, readonly onOverflow: () => void = () => {}) {}
  buffer(item: T): void {
    if (item.cursor <= this.#last) return;
    if (this.#started) { this.#last=item.cursor; void this.#deliver?.(item); return; }
    if (this.#buffer.size >= this.maxBufferedItems) { this.onOverflow(); throw new Error("replay_backpressure"); }
    this.#buffer.set(item.cursor,item);
  }
  async start(afterCursor: number, capturedHead: number, replay: (after: number, head: number) => Promise<T[]>, deliver: (item: T) => void | Promise<void>): Promise<void> {
    this.#head = capturedHead; this.#deliver=deliver;
    for (const item of await replay(afterCursor,capturedHead)) if (item.cursor > this.#last && item.cursor <= capturedHead) { await deliver(item); this.#last=item.cursor; }
    for (const item of [...this.#buffer.values()].sort((a,b)=>a.cursor-b.cursor)) if (item.cursor > capturedHead && item.cursor > this.#last) { await deliver(item); this.#last=item.cursor; }
    this.#buffer.clear(); this.#started=true;
  }
  get lastDeliveredCursor(): number { return this.#last; }
}
