import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, Scheduler } from './scheduler.js';

describe('Scheduler', () => {
  let database: DatabaseSync;
  let scheduler: Scheduler;
  let currentTime: number;

  beforeEach(() => {
    currentTime = Date.UTC(2026, 8, 1, 12, 0, 0);
    database = new DatabaseSync(':memory:');
    scheduler = new Scheduler(database, () => currentTime);
  });

  afterEach(() => database.close());

  const create = (resourceId: string, name: string, durationMinutes = 15, pin = '1234') =>
    scheduler.create(resourceId, { name, pin, durationMinutes });

  it('dodeljuje sto prvom korisniku, a sledećeg stavlja u FIFO red', () => {
    const first = create('billiards', 'Ana');
    const second = create('billiards', 'Bojan', 25);
    const state = scheduler.getState().resources[0];

    expect(first.state).toBe('active');
    expect(second.state).toBe('queued');
    expect(state.active?.displayName).toBe('Ana');
    expect(state.queue.map(item => item.displayName)).toEqual(['Bojan']);
    expect(state.queue[0].estimatedStartAt).toBe(currentTime + 15 * 60_000);
  });

  it('automatski završava sesiju i pokreće sledeću sa izabranim trajanjem', () => {
    create('billiards', 'Ana');
    create('billiards', 'Bojan', 25);
    currentTime += 15 * 60_000;

    const active = scheduler.getState().resources[0].active;
    expect(active?.displayName).toBe('Bojan');
    expect(active?.durationMinutes).toBe(25);
    expect(active?.startedAt).toBe(currentTime);
    expect(active?.endsAt).toBe(currentTime + 25 * 60_000);
  });

  it('obrađuje više propuštenih isteka nakon restarta ili dužeg prekida', () => {
    create('billiards', 'Ana', 5);
    create('billiards', 'Bojan', 5);
    create('billiards', 'Ceca', 15);
    currentTime += 12 * 60_000;

    const state = scheduler.getState().resources[0];
    expect(state.active?.displayName).toBe('Ceca');
    expect(state.active?.startedAt).toBe(currentTime - 2 * 60_000);
    expect(state.queue).toHaveLength(0);
  });

  it('ručni završetak odmah predaje sto prvom u redu', () => {
    const first = create('table-tennis', 'Ana', 30);
    create('table-tennis', 'Bojan', 15);
    currentTime += 2 * 60_000;

    scheduler.finish(first.entryId, first.token);
    const active = scheduler.getState().resources[1].active;
    expect(active?.displayName).toBe('Bojan');
    expect(active?.startedAt).toBe(currentTime);
  });

  it('dozvoljava produženje samo kada niko ne čeka', () => {
    const first = create('billiards', 'Ana');
    scheduler.extend(first.entryId, first.token);
    expect(scheduler.getState().resources[0].active?.durationMinutes).toBe(30);

    create('billiards', 'Bojan');
    expect(() => scheduler.extend(first.entryId, first.token)).toThrowError(AppError);
    try { scheduler.extend(first.entryId, first.token); } catch (error) {
      expect((error as AppError).code).toBe('QUEUE_EXISTS');
    }
  });

  it('ograničava normalizovano ime na jednu poziciju preko oba stola', () => {
    create('billiards', '  Mila   Petrović ');
    expect(() => create('table-tennis', 'mila petrović')).toThrowError(/već ima aktivnu prijavu/i);
  });

  it('odbija pogrešan token, a vraća kontrolu sa ispravnim PIN-om', () => {
    const entry = create('billiards', 'Ana', 15, '4826');
    expect(() => scheduler.finish(entry.entryId, 'pogresan-token')).toThrowError(AppError);
    expect(() => scheduler.recover({ name: 'ANA', pin: '0000' })).toThrowError(/nisu ispravni/i);

    const recovered = scheduler.recover({ name: ' ana ', pin: '4826' });
    expect(recovered.entryId).toBe(entry.entryId);
    expect(recovered.token).not.toBe(entry.token);
    expect(() => scheduler.extend(entry.entryId, entry.token)).toThrowError(AppError);
    expect(() => scheduler.extend(entry.entryId, recovered.token)).not.toThrow();
  });

  it('validira PIN, ime i trajanje', () => {
    expect(() => create('billiards', 'A')).toThrowError(/2 i 30/);
    expect(() => create('billiards', 'Ana', 7)).toThrowError(/5 do 60/);
    expect(() => create('billiards', 'Ana', 15, '12ab')).toThrowError(/četiri cifre/);
    expect(() => create('nepoznato', 'Ana')).toThrowError(/ne postoji/);
  });
});
