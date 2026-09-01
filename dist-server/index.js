import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './app.js';
import { Scheduler } from './scheduler.js';
const port = Number(process.env.PORT || 3123);
const databasePath = path.resolve(process.env.DATABASE_PATH || './data/igraonica.db');
mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
const scheduler = new Scheduler(database);
const { app, broadcast } = createApp(scheduler);
const tick = setInterval(() => {
    try {
        if (scheduler.reconcile())
            broadcast();
    }
    catch (error) {
        console.error(JSON.stringify({ level: 'error', event: 'reconcile_failed', error: String(error) }));
    }
}, 1_000);
const server = app.listen(port, () => {
    console.log(JSON.stringify({ level: 'info', event: 'server_started', port, databasePath }));
});
function shutdown(signal) {
    console.log(JSON.stringify({ level: 'info', event: 'shutdown', signal }));
    clearInterval(tick);
    server.close(() => {
        database.close();
        process.exit(0);
    });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
