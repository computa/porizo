"use strict";

async function dbQuery(db, sql, params = []) {
  if (typeof db === "function") {
    return db(sql, params);
  }
  if (db && typeof db.query === "function") {
    return db.query(sql, params);
  }
  if (db && typeof db.prepare === "function") {
    const stmt = db.prepare(sql);
    const upper = sql.trim().toUpperCase();
    if (upper.startsWith("SELECT")) {
      const rows = await stmt.all(...params);
      return { rows };
    }
    const result = await stmt.run(...params);
    const changes = Number(result?.changes || 0);
    return { rows: [], changes, rowCount: changes };
  }
  throw new Error("INVALID_DB_ADAPTER");
}

async function dbGet(db, sql, params = []) {
  const result = await dbQuery(db, sql, params);
  return result?.rows?.[0] || null;
}

async function dbAll(db, sql, params = []) {
  const result = await dbQuery(db, sql, params);
  return result?.rows || [];
}

async function dbRun(db, sql, params = []) {
  const result = await dbQuery(db, sql, params);
  const changes = Number(result?.changes ?? result?.rowCount ?? 0);
  return {
    changes,
    rowCount: changes,
  };
}

module.exports = {
  dbQuery,
  dbGet,
  dbAll,
  dbRun,
};
