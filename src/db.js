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
    const stmt = db.prepare(sql);
    return {
      get: (...params) => {
        stmt.bind(params);
        const hasRow = stmt.step();
        const row = hasRow ? stmt.getAsObject() : undefined;
        stmt.reset();
        return row;
      },
      all: (...params) => {
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.reset();
        return rows;
      },
      run: (...params) => {
        stmt.bind(params);
        stmt.step();
        stmt.reset();
        markDirty();
      },
    };
  }

  function exec(sql) {
    db.exec(sql);
    markDirty();
  }

  function close() {
    save();
    db.close();
  }

  return {
    prepare,
    exec,
    save,
    close,
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
  const db = createDbWrapper(rawDb, dbPath);
  runMigrations(db, migrationsDir);
  db.save();
  return db;
}

module.exports = {
  initDb,
};
