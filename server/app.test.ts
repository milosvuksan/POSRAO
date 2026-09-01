import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { Scheduler } from './scheduler.js';

describe('HTTP API', () => {
  let database: DatabaseSync;
  let app: ReturnType<typeof createApp>['app'];

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    app = createApp(new Scheduler(database), false).app;
  });

  afterEach(() => database.close());

  it('vraća javno stanje bez tajnih podataka', async () => {
    const created = await request(app).post('/api/resources/billiards/entries').send({
      name: 'Mila', pin: '4826', durationMinutes: 15,
    }).expect(201);
    expect(created.body.token).toBeTypeOf('string');

    const response = await request(app).get('/api/state').expect(200);
    expect(response.body.resources[0].active.displayName).toBe('Mila');
    expect(JSON.stringify(response.body)).not.toContain('4826');
    expect(response.body.resources[0].active).not.toHaveProperty('pin_hash');
    expect(response.body.resources[0].active).not.toHaveProperty('control_token_hash');
  });

  it('zahteva vlasnički token za izmenu sesije', async () => {
    const created = await request(app).post('/api/resources/table-tennis/entries').send({
      name: 'Luka', pin: '1234', durationMinutes: 15,
    }).expect(201);

    await request(app).post(`/api/entries/${created.body.entryId}/extend`).expect(403);
    const extended = await request(app)
      .post(`/api/entries/${created.body.entryId}/extend`)
      .set('Authorization', `Bearer ${created.body.token}`)
      .expect(200);
    expect(extended.body.stateSnapshot.resources[1].active.durationMinutes).toBe(30);
  });
});
