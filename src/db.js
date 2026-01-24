const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function loadDatabase(SQL, dbPath) {
  if (!dbPath || dbPath === ":memory:") {
    return new SQL.Database();
  }
  ensureDir(dbPath);
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    return new SQL.Database(fileBuffer);
  }
  return new SQL.Database();
}

function createDbWrapper(db, dbPath) {
  let dirty = false;

  function save() {
    if (!dirty || !dbPath || dbPath === ":memory:") {
      return;
    }
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    dirty = false;
  }

  function markDirty() {
    if (dbPath && dbPath !== ":memory:") {
      dirty = true;
    }
  }

  function prepare(sql) {
    // Create fresh statement for each operation and free after use
    // to avoid "Statement closed" errors from stale WASM references
    return {
      get: (...params) => {
        let stmt;
        try {
          stmt = db.prepare(sql);
          stmt.bind(params);
          const hasRow = stmt.step();
          const row = hasRow ? stmt.getAsObject() : undefined;
          return row;
        } catch (err) {
          console.error(`[DB] Query error in get():`, sql.slice(0, 100), err.message);
          throw err;
        } finally {
          if (stmt) stmt.free();
        }
      },
      all: (...params) => {
        let stmt;
        try {
          stmt = db.prepare(sql);
          stmt.bind(params);
          const rows = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          return rows;
        } catch (err) {
          console.error(`[DB] Query error in all():`, sql.slice(0, 100), err.message);
          throw err;
        } finally {
          if (stmt) stmt.free();
        }
      },
      run: (...params) => {
        let stmt;
        try {
          stmt = db.prepare(sql);
          stmt.bind(params);
          stmt.step();
          markDirty();
          // Return changes count for atomic operations
          return { changes: db.getRowsModified() };
        } catch (err) {
          console.error(`[DB] Query error in run():`, sql.slice(0, 100), err.message);
          throw err;
        } finally {
          if (stmt) stmt.free();
        }
      },
    };
  }

  function runSql(sql) {
    db.exec(sql);
    markDirty();
  }

  function close() {
    save();
    db.close();
  }

  /**
   * Run a function within a database transaction.
   * Automatically commits on success, rolls back on error.
   * Supports both sync and async callbacks.
   * @param {Function} fn - Function to run within transaction (can be async)
   * @returns {Promise<*>} Result of the function
   * @throws {Error} Re-throws any error after rollback
   */
  async function transaction(fn) {
    runSql("BEGIN TRANSACTION");
    try {
      const result = await fn();
      runSql("COMMIT");
      return result;
    } catch (err) {
      runSql("ROLLBACK");
      throw err;
    }
  }

  return {
    prepare,
    exec: runSql,
    save,
    close,
    transaction,
  };
}

function runMigrations(db, migrationsDir) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
  );
  const applied = db.prepare("SELECT id FROM schema_migrations").all().map((row) => row.id);
  const appliedSet = new Set(applied);
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
      file,
      new Date().toISOString()
    );
  }
}

async function initDb({ dbPath, migrationsDir }) {
  const SQL = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
  });
  const rawDb = loadDatabase(SQL, dbPath);

  // CRITICAL: Enable foreign key enforcement
  // SQLite foreign keys are decorative without this PRAGMA
  // Must be set before any operations that depend on FK constraints
  rawDb.run("PRAGMA foreign_keys = ON");

  const db = createDbWrapper(rawDb, dbPath);
  runMigrations(db, migrationsDir);
  db.save();
  return db;
}

module.exports = {
  initDb,
};
