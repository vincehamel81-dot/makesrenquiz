import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// One call site (tools/seedDb.js's upsertSong) uses named params — a single
// object arg matching @name placeholders — rather than positional `?`s.
// libSQL's `args` needs to be that object directly, not an array wrapping
// it, so detect that shape here rather than always spreading into an array.
function toLibsqlArgs(callArgs) {
  if (callArgs.length === 1 && callArgs[0] !== null && typeof callArgs[0] === 'object' && !Array.isArray(callArgs[0])) {
    return callArgs[0];
  }
  return callArgs;
}

// Wraps a libSQL executor (the top-level client, or an interactive
// transaction) in the same db.prepare(sql).get/all/run(...args) shape the
// codebase already uses everywhere — the only real change at each call
// site is adding `await` and marking the enclosing function async, not
// rewriting how queries are called. lastInsertRowid comes back as a bigint
// from libSQL; converted to a Number since it flows straight into
// res.json() responses elsewhere, which can't serialize bigint.
function wrap(executor) {
  return {
    prepare(sql) {
      return {
        async get(...callArgs) {
          const r = await executor.execute({ sql, args: toLibsqlArgs(callArgs) });
          return r.rows[0];
        },
        async all(...callArgs) {
          const r = await executor.execute({ sql, args: toLibsqlArgs(callArgs) });
          return r.rows;
        },
        async run(...callArgs) {
          const r = await executor.execute({ sql, args: toLibsqlArgs(callArgs) });
          return {
            lastInsertRowid: r.lastInsertRowid !== undefined ? Number(r.lastInsertRowid) : undefined,
            changes: r.rowsAffected,
          };
        },
      };
    },
    // Single-statement raw exec (server/lyricQuestions.js's bulk UPDATE).
    // Not for multi-statement scripts — see executeMultiple below for that.
    async exec(sql) {
      await executor.execute(sql);
    },
  };
}

export const db = wrap(client);

// For routes that need real atomicity across several statements (the
// song-delete cascade in server/index.js) — same prepare().get/all/run()
// shape as `db`, just scoped to one interactive transaction.
export async function withTransaction(fn) {
  const tx = await client.transaction('write');
  try {
    const result = await fn(wrap(tx));
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

// Top-level await — every file just does `import { db } from './db.js'`
// exactly like before; Node defers their module evaluation until this
// resolves, so the schema is guaranteed applied before any of them run,
// same guarantee the old synchronous node:sqlite version gave for free.
await client.execute('PRAGMA foreign_keys = ON');
const schema = readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
await client.executeMultiple(schema);
