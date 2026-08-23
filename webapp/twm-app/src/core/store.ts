/**
 * A store small enough to read in one sitting.
 *
 * The map and the register are the same data on two surfaces (doc 3 §8), so
 * they must not be able to disagree. One state object, one notify, and every
 * surface subscribes. No framework: the hot path is marking, and the whole
 * budget for it is 100 ms (doc 4 §11) — a re-render pass is a cost this
 * product cannot spend there.
 */
export type Unsub = () => void;

export class Store<T extends object> {
  private listeners = new Set<(s: T, changed: Set<keyof T>) => void>();
  private queued: Set<keyof T> | null = null;

  constructor(public state: T) {}

  /** Merge a patch and notify once per frame. Marking touches several keys;
   *  the register should repaint for all of them together, not three times. */
  set(patch: Partial<T>) {
    const changed = new Set<keyof T>();
    for (const k of Object.keys(patch) as (keyof T)[]) {
      if (this.state[k] !== patch[k]) {
        this.state[k] = patch[k] as T[keyof T];
        changed.add(k);
      }
    }
    if (changed.size) this.schedule(changed);
  }

  /** For state mutated in place — a Set of visited ids, say, where copying
   *  eleven thousand entries on every tap is the expensive way to be pure. */
  touch(...keys: (keyof T)[]) {
    this.schedule(new Set(keys));
  }

  private schedule(changed: Set<keyof T>) {
    if (this.queued) {
      for (const k of changed) this.queued.add(k);
      return;
    }
    this.queued = changed;
    queueMicrotask(() => {
      const c = this.queued!;
      this.queued = null;
      for (const fn of this.listeners) fn(this.state, c);
    });
  }

  subscribe(fn: (s: T, changed: Set<keyof T>) => void): Unsub {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Subscribe only to the keys a surface actually cares about. */
  on(keys: (keyof T)[], fn: (s: T) => void): Unsub {
    return this.subscribe((s, changed) => {
      for (const k of keys) if (changed.has(k)) return fn(s);
    });
  }
}
