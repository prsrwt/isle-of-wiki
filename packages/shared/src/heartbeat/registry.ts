/** An entity is just an id; what it *is* comes from the components attached to it. */
export type Entity = number;

/**
 * Heartbeat's entity registry. `C` maps component names to their data types, e.g.
 * `Registry<{ transform: Transform; pod: PodState }>`, so lookups are fully typed.
 */
export class Registry<C extends Record<string, unknown>> {
  private nextId = 1;
  private readonly alive = new Set<Entity>();
  private readonly stores = new Map<keyof C, Map<Entity, unknown>>();

  create(): Entity {
    const e = this.nextId++;
    this.alive.add(e);
    return e;
  }

  destroy(e: Entity): void {
    this.alive.delete(e);
    for (const store of this.stores.values()) store.delete(e);
  }

  isAlive(e: Entity): boolean {
    return this.alive.has(e);
  }

  set<K extends keyof C>(e: Entity, key: K, value: C[K]): void {
    if (!this.alive.has(e)) throw new Error(`Entity ${e} does not exist`);
    let store = this.stores.get(key);
    if (!store) {
      store = new Map();
      this.stores.set(key, store);
    }
    store.set(e, value);
  }

  get<K extends keyof C>(e: Entity, key: K): C[K] | undefined {
    return this.stores.get(key)?.get(e) as C[K] | undefined;
  }

  remove<K extends keyof C>(e: Entity, key: K): void {
    this.stores.get(key)?.delete(e);
  }

  /** Every entity that has all of `keys`, with those components. */
  *query<K extends keyof C>(...keys: K[]): IterableIterator<[Entity, Pick<C, K>]> {
    if (!keys.length) return;
    const stores = keys.map((k) => this.stores.get(k));
    if (stores.some((s) => !s)) return;
    const present = stores as Map<Entity, unknown>[];
    // Walk the smallest store; check the rest.
    const smallest = present.reduce((a, b) => (b.size < a.size ? b : a));
    for (const e of smallest.keys()) {
      if (!present.every((s) => s.has(e))) continue;
      const row = {} as Pick<C, K>;
      keys.forEach((k, i) => {
        row[k] = present[i].get(e) as C[K];
      });
      yield [e, row];
    }
  }
}
