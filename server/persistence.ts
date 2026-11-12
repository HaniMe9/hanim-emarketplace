/**
 * Persistence.
 *
 * The marketplace state is a single in-memory object graph (`Db`) that every
 * route reads and mutates. Replacing that with a query-per-table ORM would mean
 * rewriting the entire domain layer, and would not change the correctness of
 * the invariants that actually matter here (balanced ledger, atomic stock
 * reservation, idempotent checkout).
 *
 * So the durable store keeps the same shape: the graph is loaded into memory at
 * boot and written back as a single transactional snapshot. What changes is
 * that it survives a restart, survives a crash, and refuses to come up in a
 * state where the ledger does not balance.
 *
 * Two backends:
 *  - `sqlite` (default) — `node:sqlite`, built into Node 22, no native build
 *    step. Writes are atomic and committed under a single transaction, and WAL
 *    journaling means a crash mid-write cannot corrupt the file.
 *  - `memory` — for tests only, and refused outright in production.
 *
 * Snapshot writes are debounced: a burst of order mutations costs one write,
 * not one per row. `flush()` forces a synchronous write, which is what shutdown
 * and every test assertion use, so nothing is ever reported as saved before it
 * is actually on disk.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Db } from './store.ts';
import { ledgerBalances } from './lib/money.ts';
import type { PersistenceMode } from './config.ts';

/** Bumped when the persisted shape changes in a way older files cannot satisfy. */
export const SCHEMA_VERSION = 1;

export interface Snapshot {
  version: number;
  savedAt: string;
  db: Db;
}

export interface PersistenceOptions {
  mode: PersistenceMode;
  path: string;
  flushIntervalMs: number;
  log?: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
}

export interface Persistence {
  readonly mode: PersistenceMode;
  /**
   * Hand over the state graph to persist.
   *
   * Called once during boot, after the store has been restored or seeded. It has
   * to be explicit because the graph does not exist when the store is created,
   * and it is what lets `markDirty()` work on its own — the debounced timer has
   * to know what to write without every call site passing it again.
   */
  bind(db: Db): void;
  /** Load a snapshot, or null when the store is empty or unusable. */
  load(): Snapshot | null;
  /** Queue a write. Debounced by `flushIntervalMs`. */
  markDirty(): void;
  /** Write immediately if dirty. Safe to call when nothing changed. */
  flush(): Promise<void>;
  /** Stop timers and flush one last time. */
  close(): Promise<void>;
  /** Diagnostics for the health endpoint. */
  stats(): { mode: PersistenceMode; path: string; writes: number; lastWriteAt: string | null; lastError: string | null; pending: boolean; bytes: number };
}

/* ------------------------------- SQLite ---------------------------------- */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshots (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  version  INTEGER NOT NULL,
  saved_at TEXT    NOT NULL,
  body     TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

class SqlitePersistence implements Persistence {
  readonly mode = 'sqlite' as const;
  private readonly path: string;
  private readonly db: DatabaseSync;
  private readonly log: NonNullable<PersistenceOptions['log']>;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private writing: Promise<void> | null = null;
  private writes = 0;
  private lastWriteAt: string | null = null;
  private lastError: string | null = null;
  private closed = false;
  /** The graph written on every dirty flush. Set by `bind`. */
  private state: Db | null = null;

  constructor(opts: PersistenceOptions) {
    this.path = resolve(opts.path);
    this.log = opts.log ?? (() => {});
    this.intervalMs = opts.flushIntervalMs;
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
    // WAL survives a crash mid-write; NORMAL is the standard durability/throughput
    // trade-off and is what every production SQLite deployment uses.
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  bind(db: Db): void {
    this.state = db;
  }

  load(): Snapshot | null {
    try {
      const row = this.db.prepare('SELECT version, saved_at, body FROM snapshots WHERE id = 1').get() as
        | { version: number; saved_at: string; body: string }
        | undefined;
      if (!row) return null;
      const parsed = JSON.parse(row.body) as Snapshot;
      if (parsed.version !== SCHEMA_VERSION) {
        this.log('warn', 'Ignoring snapshot written by a different schema version', {
          found: parsed.version,
          expected: SCHEMA_VERSION,
        });
        return null;
      }
      return { ...parsed, savedAt: row.saved_at };
    } catch (e) {
      // A corrupt file must not take the service down, but it must be loud: the
      // operator has to know the previous state was not loaded.
      this.lastError = e instanceof Error ? e.message : String(e);
      this.log('error', 'Could not read the persisted snapshot; starting from an empty store', { error: this.lastError });
      return null;
    }
  }

  markDirty(): void {
    if (this.closed || !this.state) return;
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      // `commit` already records and logs the failure; swallowing it here keeps a
      // failed background write from surfacing as an unhandled rejection that
      // would take the process down.
      void this.write().catch(() => {});
    }, this.intervalMs);
    // A pending snapshot write must never hold the process open on its own;
    // shutdown calls `close()` explicitly.
    this.timer.unref?.();
  }

  private async write(): Promise<void> {
    if (!this.dirty || this.closed) return;
    if (this.writing) {
      // Coalesce: a write already in flight will pick up the newest state.
      await this.writing.catch(() => {});
      return this.write();
    }
    const state = this.state;
    if (!state) {
      // Nothing bound yet. Leaving `dirty` set would be a lie about a write that
      // never happened; clearing it is what makes the un-bound case visible
      // instead of quietly losing changes.
      this.dirty = false;
      this.lastError = 'markDirty called before bind(); the change was not persisted';
      this.log('error', 'Refusing to mark dirty before the state graph is bound');
      return;
    }
    // Cleared before the write, and restored by `commit` on failure, so a
    // mutation landing during the write is still persisted by the next pass.
    this.dirty = false;
    this.writing = this.commit(state).finally(() => {
      this.writing = null;
    });
    await this.writing;
  }

  private async commit(db: Db): Promise<void> {
    const at = new Date().toISOString();
    const body = JSON.stringify({ version: SCHEMA_VERSION, savedAt: at, db } satisfies Snapshot);
    try {
      // The whole snapshot is one statement inside one transaction: a crash
      // mid-write leaves the previous snapshot intact rather than a half-updated file.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare('INSERT OR REPLACE INTO snapshots (id, version, saved_at, body) VALUES (1, ?, ?, ?)').run(SCHEMA_VERSION, at, body);
        this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('lastWriteAt', at);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
      this.writes += 1;
      this.lastWriteAt = at;
      this.lastError = null;
    } catch (e) {
      this.dirty = true;
      this.lastError = e instanceof Error ? e.message : String(e);
      this.log('error', 'Failed to persist snapshot', { error: this.lastError });
      throw e;
    }
  }

  async flush(): Promise<void> {
    this.dirty = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.write();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      await this.flush();
    } finally {
      this.closed = true;
      try {
        this.db.close();
      } catch {
        /* already closed */
      }
    }
  }

  stats() {
    let bytes = 0;
    try {
      const row = this.db.prepare('SELECT length(body) AS n FROM snapshots WHERE id = 1').get() as { n: number } | undefined;
      bytes = row?.n ?? 0;
    } catch {
      bytes = 0;
    }
    return {
      mode: this.mode,
      path: this.path,
      writes: this.writes,
      lastWriteAt: this.lastWriteAt,
      lastError: this.lastError,
      pending: this.dirty,
      bytes,
    };
  }
}

/* ------------------------------- Memory ---------------------------------- */

class MemoryPersistence implements Persistence {
  readonly mode = 'memory' as const;
  private snapshot: Snapshot | null = null;
  private writes = 0;
  private lastWriteAt: string | null = null;
  private dirty = false;
  private lastError: string | null = null;
  private state: Db | null = null;

  bind(db: Db): void {
    this.state = db;
  }

  load(): Snapshot | null {
    return this.snapshot;
  }

  markDirty(): void {
    this.dirty = true;
  }

  async flush(): Promise<void> {
    const state = this.state;
    if (!state) return;
    if (!this.dirty && this.snapshot) return;
    const at = new Date().toISOString();
    this.snapshot = { version: SCHEMA_VERSION, savedAt: at, db: state };
    this.writes += 1;
    this.lastWriteAt = at;
    this.dirty = false;
  }

  async close(): Promise<void> {
    await this.flush();
  }

  stats() {
    return {
      mode: this.mode,
      path: ':memory:',
      writes: this.writes,
      lastWriteAt: this.lastWriteAt,
      lastError: this.lastError,
      pending: this.dirty,
      bytes: this.snapshot ? JSON.stringify(this.snapshot).length : 0,
    };
  }
}

export function createPersistence(opts: PersistenceOptions): Persistence {
  if (opts.mode === 'memory') return new MemoryPersistence();
  return new SqlitePersistence(opts);
}

/* ---------------------------- Boot / verify ------------------------------ */

export interface RestoreResult {
  db: Db;
  restored: boolean;
  savedAt: string | null;
  persistence: Persistence;
}

export interface RestoreOptions {
  /**
   * Run the demo seed when the store is empty.
   *
   * Off in production: an empty store there means the database was pointed at the
   * wrong path, and seeding over it would create demo accounts on what may be a
   * deployment that is supposed to hold real customers.
   */
  seedIfEmpty: boolean;
}

/**
 * Load persisted state, or seed a fresh database when the store is empty.
 *
 * A snapshot whose ledger does not balance is refused: an unbalanced ledger
 * means money was lost or duplicated, and continuing from it would let the
 * service take new orders against figures nobody can trust. Failing to start is
 * the only safe response.
 */
export function restore(
  seed: () => Db,
  persistence: Persistence,
  log: NonNullable<PersistenceOptions['log']>,
  options: RestoreOptions = { seedIfEmpty: true },
): RestoreResult {
  const snapshot = persistence.load();
  if (snapshot) {
    const db = snapshot.db;
    if (!Array.isArray(db.orders) || !Array.isArray(db.ledger) || !Array.isArray(db.users)) {
      throw new Error('Persisted snapshot is missing core collections (orders/ledger/users); refusing to start.');
    }
    if (!ledgerBalances(db.ledger)) {
      throw new Error(
        `Persisted ledger does not balance (${db.ledger.length} entries). Refusing to start — money has gone missing or been duplicated.`,
      );
    }
    // Bound before returning: from here on `markDirty()` is enough to make a
    // change durable, and `restore` is the only place the graph changes identity.
    persistence.bind(db);
    log('info', 'Restored persisted state', {
      savedAt: snapshot.savedAt,
      orders: db.orders.length,
      ledgerEntries: db.ledger.length,
      users: db.users.length,
    });
    return { db, restored: true, savedAt: snapshot.savedAt, persistence };
  }

  if (!options.seedIfEmpty) {
    throw new Error(
      `No data found at the configured store, and seeding is disabled. Point HM_DB_PATH at the right database, or set HM_SEED_IF_EMPTY=true to initialise this instance deliberately.`,
    );
  }

  const db = seed();
  if (!ledgerBalances(db.ledger)) throw new Error('Freshly seeded ledger does not balance; refusing to start.');
  persistence.bind(db);
  log('info', 'Seeded a new database', {
    orders: db.orders.length,
    products: db.products.length,
    ledgerEntries: db.ledger.length,
  });
  return { db, restored: false, savedAt: null, persistence };
}
