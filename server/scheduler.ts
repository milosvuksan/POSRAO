import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const RESOURCE_IDS = ['billiards', 'table-tennis'] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];
export type EntryState = 'queued' | 'active' | 'completed' | 'cancelled' | 'expired';

export interface PublicEntry {
  entryId: string;
  displayName: string;
  durationMinutes: number;
  position?: number;
  estimatedStartAt?: number;
  startedAt?: number;
  endsAt?: number;
}

export interface ResourceState {
  id: ResourceId;
  label: string;
  active: PublicEntry | null;
  queue: PublicEntry[];
}

export interface PublicState {
  serverTime: number;
  resources: ResourceState[];
}

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type EntryRow = {
  seq: number;
  id: string;
  resource_id: ResourceId;
  display_name: string;
  normalized_name: string;
  pin_salt: string;
  pin_hash: string;
  control_token_hash: string;
  state: EntryState;
  duration_minutes: number;
  created_at: number;
  started_at: number | null;
  ends_at: number | null;
  finished_at: number | null;
};

const labels: Record<ResourceId, string> = {
  billiards: 'Bilijar',
  'table-tennis': 'Stoni tenis',
};

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const makeToken = () => randomBytes(32).toString('base64url');
const normalizeName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('sr-Latn');

function hashPin(pin: string, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(pin, salt, 32).toString('hex') };
}

function verifyPin(pin: string, salt: string, expected: string) {
  const actual = Buffer.from(hashPin(pin, salt).hash, 'hex');
  const target = Buffer.from(expected, 'hex');
  return actual.length === target.length && timingSafeEqual(actual, target);
}

export class Scheduler {
  constructor(
    private db: DatabaseSync,
    private now: () => number = Date.now,
  ) {
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS entries (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        resource_id TEXT NOT NULL CHECK(resource_id IN ('billiards', 'table-tennis')),
        display_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        pin_salt TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        control_token_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued', 'active', 'completed', 'cancelled', 'expired')),
        duration_minutes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        ends_at INTEGER,
        finished_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_live_name
        ON entries(normalized_name) WHERE state IN ('queued', 'active');
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_resource
        ON entries(resource_id) WHERE state = 'active';
      CREATE INDEX IF NOT EXISTS queue_order
        ON entries(resource_id, state, seq);
    `);
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = operation();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private getEntry(id: string): EntryRow | undefined {
    return this.db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as EntryRow | undefined;
  }

  private assertResource(value: string): asserts value is ResourceId {
    if (!RESOURCE_IDS.includes(value as ResourceId)) {
      throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Traženi sto ne postoji.');
    }
  }

  private validateInput(name: unknown, pin: unknown, duration: unknown) {
    if (typeof name !== 'string') throw new AppError(400, 'INVALID_NAME', 'Unesite ime.');
    const displayName = name.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (displayName.length < 2 || displayName.length > 30) {
      throw new AppError(400, 'INVALID_NAME', 'Ime mora imati između 2 i 30 znakova.');
    }
    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
      throw new AppError(400, 'INVALID_PIN', 'PIN mora imati tačno četiri cifre.');
    }
    if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 5 || duration > 60 || duration % 5 !== 0) {
      throw new AppError(400, 'INVALID_DURATION', 'Izaberite trajanje od 5 do 60 minuta, u koracima od 5.');
    }
    return { displayName, normalizedName: normalizeName(displayName), pin, duration };
  }

  private assertControl(row: EntryRow | undefined, token: string | undefined) {
    if (!row || !token || tokenHash(token) !== row.control_token_hash) {
      throw new AppError(403, 'NOT_AUTHORIZED', 'Nemate dozvolu za ovu prijavu. Povežite se ponovo pomoću PIN-a.');
    }
  }

  private promote(resourceId: ResourceId, startAt: number) {
    const next = this.db
      .prepare("SELECT * FROM entries WHERE resource_id = ? AND state = 'queued' ORDER BY seq LIMIT 1")
      .get(resourceId) as EntryRow | undefined;
    if (!next) return false;
    this.db.prepare("UPDATE entries SET state = 'active', started_at = ?, ends_at = ? WHERE id = ?")
      .run(startAt, startAt + next.duration_minutes * 60_000, next.id);
    return true;
  }

  private reconcileInTransaction(now: number) {
    let changed = false;
    for (const resourceId of RESOURCE_IDS) {
      while (true) {
        const active = this.db
          .prepare("SELECT * FROM entries WHERE resource_id = ? AND state = 'active'")
          .get(resourceId) as EntryRow | undefined;
        if (!active || active.ends_at === null || active.ends_at > now) break;
        const transitionAt = active.ends_at;
        this.db.prepare("UPDATE entries SET state = 'expired', finished_at = ? WHERE id = ?")
          .run(transitionAt, active.id);
        this.promote(resourceId, transitionAt);
        changed = true;
      }
    }
    return changed;
  }

  reconcile() {
    return this.transaction(() => this.reconcileInTransaction(this.now()));
  }

  create(resourceValue: string, input: { name?: unknown; pin?: unknown; durationMinutes?: unknown }) {
    this.assertResource(resourceValue);
    const resourceId = resourceValue;
    const valid = this.validateInput(input.name, input.pin, input.durationMinutes);
    return this.transaction(() => {
      const now = this.now();
      this.reconcileInTransaction(now);
      const existing = this.db
        .prepare("SELECT id FROM entries WHERE normalized_name = ? AND state IN ('queued', 'active')")
        .get(valid.normalizedName);
      if (existing) throw new AppError(409, 'NAME_BUSY', 'Ovo ime već ima aktivnu prijavu ili mesto u redu.');

      const active = this.db
        .prepare("SELECT id FROM entries WHERE resource_id = ? AND state = 'active'")
        .get(resourceId);
      const state: EntryState = active ? 'queued' : 'active';
      const startedAt = state === 'active' ? now : null;
      const endsAt = startedAt === null ? null : startedAt + valid.duration * 60_000;
      const id = randomUUID();
      const token = makeToken();
      const securedPin = hashPin(valid.pin);
      this.db.prepare(`
        INSERT INTO entries
          (id, resource_id, display_name, normalized_name, pin_salt, pin_hash, control_token_hash,
           state, duration_minutes, created_at, started_at, ends_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, resourceId, valid.displayName, valid.normalizedName, securedPin.salt, securedPin.hash,
        tokenHash(token), state, valid.duration, now, startedAt, endsAt,
      );
      return { entryId: id, token, state, stateSnapshot: this.stateInTransaction(now) };
    });
  }

  recover(input: { name?: unknown; pin?: unknown }) {
    if (typeof input.name !== 'string' || typeof input.pin !== 'string') {
      throw new AppError(400, 'INVALID_ACCESS', 'Unesite ime i četvorocifreni PIN.');
    }
    const name = input.name;
    const pin = input.pin;
    return this.transaction(() => {
      const now = this.now();
      this.reconcileInTransaction(now);
      const row = this.db
        .prepare("SELECT * FROM entries WHERE normalized_name = ? AND state IN ('queued', 'active')")
        .get(normalizeName(name)) as EntryRow | undefined;
      if (!row || !verifyPin(pin, row.pin_salt, row.pin_hash)) {
        throw new AppError(403, 'INVALID_ACCESS', 'Ime ili PIN nisu ispravni.');
      }
      const token = makeToken();
      this.db.prepare('UPDATE entries SET control_token_hash = ? WHERE id = ?').run(tokenHash(token), row.id);
      return { entryId: row.id, token, state: row.state, stateSnapshot: this.stateInTransaction(now) };
    });
  }

  extend(id: string, token?: string) {
    return this.transaction(() => {
      const now = this.now();
      this.reconcileInTransaction(now);
      const row = this.getEntry(id);
      this.assertControl(row, token);
      if (row!.state !== 'active' || row!.ends_at === null) {
        throw new AppError(409, 'NOT_ACTIVE', 'Samo aktivna sesija može da se produži.');
      }
      const waiting = this.db
        .prepare("SELECT 1 FROM entries WHERE resource_id = ? AND state = 'queued' LIMIT 1")
        .get(row!.resource_id);
      if (waiting) throw new AppError(409, 'QUEUE_EXISTS', 'Produženje nije dostupno dok neko čeka.');
      this.db.prepare('UPDATE entries SET duration_minutes = duration_minutes + 15, ends_at = ends_at + ? WHERE id = ?')
        .run(15 * 60_000, id);
      return { stateSnapshot: this.stateInTransaction(now) };
    });
  }

  finish(id: string, token?: string) {
    return this.transaction(() => {
      const now = this.now();
      this.reconcileInTransaction(now);
      const row = this.getEntry(id);
      this.assertControl(row, token);
      if (row!.state !== 'active') throw new AppError(409, 'NOT_ACTIVE', 'Ova sesija više nije aktivna.');
      this.db.prepare("UPDATE entries SET state = 'completed', finished_at = ?, ends_at = ? WHERE id = ?")
        .run(now, now, id);
      this.promote(row!.resource_id, now);
      return { stateSnapshot: this.stateInTransaction(now) };
    });
  }

  cancel(id: string, token?: string) {
    return this.transaction(() => {
      const now = this.now();
      this.reconcileInTransaction(now);
      const row = this.getEntry(id);
      this.assertControl(row, token);
      if (row!.state !== 'queued') throw new AppError(409, 'NOT_QUEUED', 'Ova prijava više nije u redu.');
      this.db.prepare("UPDATE entries SET state = 'cancelled', finished_at = ? WHERE id = ?").run(now, id);
      return { stateSnapshot: this.stateInTransaction(now) };
    });
  }

  getState() {
    return this.transaction(() => {
      const now = this.now();
      this.reconcileInTransaction(now);
      return this.stateInTransaction(now);
    });
  }

  private stateInTransaction(now: number): PublicState {
    const resources = RESOURCE_IDS.map((resourceId): ResourceState => {
      const active = this.db
        .prepare("SELECT * FROM entries WHERE resource_id = ? AND state = 'active'")
        .get(resourceId) as EntryRow | undefined;
      const queued = this.db
        .prepare("SELECT * FROM entries WHERE resource_id = ? AND state = 'queued' ORDER BY seq")
        .all(resourceId) as unknown as EntryRow[];
      let estimatedStart = active?.ends_at ?? now;
      const queue = queued.map((row, index) => {
        const item: PublicEntry = {
          entryId: row.id,
          displayName: row.display_name,
          durationMinutes: row.duration_minutes,
          position: index + 1,
          estimatedStartAt: estimatedStart,
        };
        estimatedStart += row.duration_minutes * 60_000;
        return item;
      });
      return {
        id: resourceId,
        label: labels[resourceId],
        active: active ? {
          entryId: active.id,
          displayName: active.display_name,
          durationMinutes: active.duration_minutes,
          startedAt: active.started_at ?? undefined,
          endsAt: active.ends_at ?? undefined,
        } : null,
        queue,
      };
    });
    return { serverTime: now, resources };
  }
}
