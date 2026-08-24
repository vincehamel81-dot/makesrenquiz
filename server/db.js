import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DB_PATH lets a host with a persistent disk (e.g. Render) point this at a
// mounted volume instead of the local repo checkout; unset in dev, so
// nothing changes locally.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'renquiz.db');

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

const schema = readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);
