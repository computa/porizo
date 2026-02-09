const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function toPlainRow(row) {
  if (!row) {
    return row;
  }
  return { ...row };
}

function toPlainRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((row) => toPlainRow(row));
}

function convertPgPlaceholders(sql, params = []) {
  if (typeof sql !== "string" || !sql.includes("$")) {
    return { sql, params };
  }

  const mappedParams = [];
  const convertedSql = sql.replace(/\$(\d+)/g, (_, indexText) => {
    const index = Number(indexText) - 1;
    mappedParams.push(params[index]);
    return "?";
  });

  return {
    sql: convertedSql,
    params: mappedParams.length > 0 ? mappedParams : params,
  };
}

function isReadQuery(sql) {
  return /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql);
}

function createSqliteAdapter({ dbPath = ":memory:" } = {}) {
  const resolvedDbPath = dbPath === ":memory:"
    ? ":memory:"
    : path.resolve(dbPath);

  if (resolvedDbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
  }

  const rawDb = new DatabaseSync(resolvedDbPath);
  rawDb.exec("PRAGMA foreign_keys = ON");

  async function query(sql, params = []) {
    const converted = convertPgPlaceholders(sql, params);
    const statement = rawDb.prepare(converted.sql);

    if (isReadQuery(converted.sql)) {
      const rows = toPlainRows(statement.all(...converted.params));
      rows.rows = rows;
      rows.rowCount = rows.length;
      return rows;
    }

    const result = statement.run(...converted.params);
    return {
      rows: [],
      rowCount: Number(result.changes || 0),
      lastInsertRowid: Number(result.lastInsertRowid || 0),
    };
  }

  function prepare(sql) {
    return {
      get: (...params) => {
        const converted = convertPgPlaceholders(sql, params);
        const statement = rawDb.prepare(converted.sql);
        return toPlainRow(statement.get(...converted.params));
      },

      all: (...params) => {
        const converted = convertPgPlaceholders(sql, params);
        const statement = rawDb.prepare(converted.sql);
        return toPlainRows(statement.all(...converted.params));
      },

      run: (...params) => {
        const converted = convertPgPlaceholders(sql, params);
        const statement = rawDb.prepare(converted.sql);
        const result = statement.run(...converted.params);
        return {
          changes: Number(result.changes || 0),
          lastInsertRowid: Number(result.lastInsertRowid || 0),
        };
      },
    };
  }

  async function transaction(fn) {
    rawDb.exec("BEGIN");
    try {
      const result = await fn(query);
      rawDb.exec("COMMIT");
      return result;
    } catch (error) {
      rawDb.exec("ROLLBACK");
      throw error;
    }
  }

  async function close() {
    rawDb.close();
  }

  function stats() {
    return {
      provider: "sqlite",
      dbPath: resolvedDbPath,
    };
  }

  async function healthCheck() {
    const start = Date.now();
    try {
      rawDb.prepare("SELECT 1 as ok").get();
      return {
        healthy: true,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: error.message,
      };
    }
  }

  function exec(sql) {
    rawDb.exec(sql);
  }

  function save() {
    // no-op for sqlite sync adapter
  }

  return {
    query,
    prepare,
    transaction,
    close,
    stats,
    healthCheck,
    exec,
    save,
    isPostgres: false,
    _rawDb: rawDb,
  };
}

async function runSqliteMigrations(db, migrationsDir) {
  if (!migrationsDir || !fs.existsSync(migrationsDir)) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

  const appliedRows = db.prepare("SELECT id FROM schema_migrations").all();
  const applied = new Set(appliedRows.map((row) => row.id));

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, CURRENT_TIMESTAMP)").run(file);
  }
}

async function initDb({ dbPath = ":memory:", migrationsDir } = {}) {
  const db = createSqliteAdapter({ dbPath });

  if (migrationsDir) {
    await runSqliteMigrations(db, migrationsDir);
  }

  return db;
}

module.exports = {
  createSqliteAdapter,
  runSqliteMigrations,
  initDb,
};
