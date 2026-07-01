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

function rowsFromQueryResult(result) {
  if (Array.isArray(result)) {
    return result;
  }
  return Array.isArray(result?.rows) ? result.rows : [];
}

function createPreparedDbFromQuery(query, parentDb) {
  return {
    isPostgres: Boolean(parentDb?.isPostgres),
    prepare(sql) {
      return {
        async get(...params) {
          const result = await query(sql, params);
          return rowsFromQueryResult(result)[0];
        },
        async all(...params) {
          const result = await query(sql, params);
          return rowsFromQueryResult(result);
        },
        async run(...params) {
          const result = await query(sql, params);
          const changes = Number(result?.rowCount ?? result?.changes ?? 0);
          return { changes, rowCount: changes };
        },
      };
    },
  };
}

module.exports = {
  createPreparedDbFromQuery,
  dbQuery,
  dbGet,
  dbAll,
  dbRun,
};
