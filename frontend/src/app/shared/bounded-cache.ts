/** Small FIFO memoization; no retained messages from an unbounded chat history. */
export class BoundedCache<T> {
  private readonly values = new Map<string, T>();
  constructor(private readonly capacity = 256) {}
  get(key: string, calculate: () => T): T {
    if (this.values.has(key)) return this.values.get(key)!;
    const value = calculate();
    if (this.values.size >= this.capacity) this.values.delete(this.values.keys().next().value!);
    this.values.set(key, value);
    return value;
  }
  clear() {this.values.clear();}
}
