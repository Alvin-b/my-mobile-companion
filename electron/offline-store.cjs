const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const ALLOWED_PACKAGE_FIELDS = new Set([
  "location",
  "commission_employee_id",
  "is_international_forwarding",
  "forward_destination_country",
]);

class OfflineStore {
  constructor({ SQL, dbPath, safeStorage }) {
    this.SQL = SQL;
    this.dbPath = dbPath;
    this.safeStorage = safeStorage;
    this.db = null;
  }

  open() {
    if (!this.safeStorage?.isEncryptionAvailable()) {
      throw new Error("Secure Windows storage is unavailable; encrypted offline data cannot be opened.");
    }
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.dbPath)) {
      const existingBytes = fs.readFileSync(this.dbPath);
      try {
        this.db = new this.SQL.Database(existingBytes);
        const integrity = this.db.exec("PRAGMA quick_check");
        if (integrity[0]?.values?.[0]?.[0] !== "ok") {
          throw new Error("Offline database integrity check failed.");
        }
      } catch (error) {
        try { this.db?.close(); } catch {}
        this.db = null;
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = `${this.dbPath}.corrupt-${timestamp}`;
        fs.renameSync(this.dbPath, backupPath);
        this.db = new this.SQL.Database();
      }
    } else {
      this.db = new this.SQL.Database();
    }
    this.db.run(`
      CREATE TABLE IF NOT EXISTS secure_values (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cache_snapshots (
        user_id TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        table_name TEXT NOT NULL,
        payload TEXT NOT NULL,
        stored_at TEXT NOT NULL,
        PRIMARY KEY (user_id, cache_key)
      );
      CREATE INDEX IF NOT EXISTS cache_snapshots_by_table
        ON cache_snapshots (user_id, table_name);
      CREATE TABLE IF NOT EXISTS sync_outbox (
        operation_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        error_code TEXT
      );
      CREATE INDEX IF NOT EXISTS sync_outbox_by_user_status
        ON sync_outbox (user_id, status, created_at);
    `);
    const version = this.db.exec("PRAGMA user_version")[0]?.values?.[0]?.[0] ?? 0;
    if (version > 1) throw new Error(`Offline database version ${version} is newer than this app.`);
    this.db.run("PRAGMA user_version = 1");
    this.db.run("UPDATE sync_outbox SET status = 'queued', updated_at = ? WHERE status = 'syncing'", [new Date().toISOString()]);
    this.persist();
    return this;
  }

  ensureOpen() {
    if (!this.db) throw new Error("Offline database is not open.");
  }

  encrypt(value) {
    this.ensureOpen();
    const plaintext = JSON.stringify(value);
    return this.safeStorage.encryptString(plaintext).toString("base64");
  }

  decrypt(value) {
    this.ensureOpen();
    if (value == null) return null;
    return JSON.parse(this.safeStorage.decryptString(Buffer.from(value, "base64")));
  }

  persist() {
    this.ensureOpen();
    const bytes = Buffer.from(this.db.export());
    const temporary = `${this.dbPath}.tmp`;
    fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    fs.renameSync(temporary, this.dbPath);
  }

  statement(sql, params = []) {
    this.ensureOpen();
    const statement = this.db.prepare(sql, params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    statement.free();
    return rows;
  }

  setSecureValue(key, value) {
    this.ensureOpen();
    this.db.run(
      "INSERT INTO secure_values (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, this.encrypt(value)],
    );
    this.persist();
  }

  getSecureValue(key) {
    const row = this.statement("SELECT value FROM secure_values WHERE key = ?", [key])[0];
    return row ? this.decrypt(row.value) : null;
  }

  deleteSecureValue(key) {
    this.ensureOpen();
    this.db.run("DELETE FROM secure_values WHERE key = ?", [key]);
    this.persist();
  }

  cacheHash(url) {
    return createHash("sha256").update(String(url)).digest("hex");
  }

  putSnapshot(userId, url, tableName, value) {
    if (!userId) return;
    this.ensureOpen();
    this.db.run(
      `INSERT INTO cache_snapshots (user_id, cache_key, table_name, payload, stored_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, cache_key) DO UPDATE SET
         table_name = excluded.table_name, payload = excluded.payload, stored_at = excluded.stored_at`,
      [userId, this.cacheHash(url), tableName, this.encrypt(value), new Date().toISOString()],
    );
    this.persist();
  }

  getSnapshot(userId, url) {
    if (!userId) return null;
    const row = this.statement(
      "SELECT payload FROM cache_snapshots WHERE user_id = ? AND cache_key = ?",
      [userId, this.cacheHash(url)],
    )[0];
    return row ? this.decrypt(row.payload) : null;
  }

  getTableSnapshots(userId, tableName) {
    const rows = this.statement(
      "SELECT cache_key, payload FROM cache_snapshots WHERE user_id = ? AND table_name = ?",
      [userId, tableName],
    );
    return rows.map((row) => ({ cacheKey: row.cache_key, value: this.decrypt(row.payload) }));
  }

  invalidateTable(userId, tableName) {
    this.ensureOpen();
    this.db.run("DELETE FROM cache_snapshots WHERE user_id = ? AND table_name = ?", [userId, tableName]);
    this.persist();
  }

  findCachedPackage(userId, packageId) {
    for (const snapshot of this.getTableSnapshots(userId, "cargo_packages")) {
      const raw = snapshot.value?.body;
      let value = raw;
      if (typeof raw === "string") {
        try { value = JSON.parse(raw); } catch { value = null; }
      }
      const rows = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
      const found = rows.find((row) => String(row?.id ?? "") === String(packageId));
      if (found) return found;
    }
    return null;
  }

  updateCachedPackage(userId, packageId, patch, syncStatus) {
    for (const snapshot of this.getTableSnapshots(userId, "cargo_packages")) {
      const current = snapshot.value;
      let rows = current?.body;
      if (typeof rows === "string") {
        try { rows = JSON.parse(rows); } catch { rows = null; }
      }
      if (!Array.isArray(rows)) continue;
      let changed = false;
      const nextRows = rows.map((row) => {
        if (String(row?.id ?? "") !== String(packageId)) return row;
        changed = true;
        const next = { ...row, ...patch };
        if (syncStatus) next._dex_sync_status = syncStatus;
        else delete next._dex_sync_status;
        return next;
      });
      if (!changed) continue;
      const payload = { ...current, body: JSON.stringify(nextRows) };
      this.db.run("UPDATE cache_snapshots SET payload = ?, stored_at = ? WHERE user_id = ? AND cache_key = ?", [
        this.encrypt(payload),
        new Date().toISOString(),
        userId,
        snapshot.cacheKey,
      ]);
    }
    this.persist();
  }

  normalizePackageMutation({ url, method, body }) {
    const parsedUrl = new URL(url);
    const match = parsedUrl.pathname.match(/^\/api\/public\/packages\/([^/]+)\/(location|operations)$/);
    if (method !== "PUT" || !match) throw new Error("This operation needs an internet connection and cannot be queued safely.");
    const packageId = decodeURIComponent(match[1]);
    if (!packageId || packageId.length > 200) throw new Error("Invalid package identifier.");
    let patch;
    try {
      patch = typeof body === "string" ? JSON.parse(body) : body;
    } catch {
      throw new Error("Only JSON package edits can be queued offline.");
    }
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Invalid offline package edit.");
    const endpoint = match[2];
    const fields = Object.keys(patch);
    if (!fields.length || fields.some((field) => !ALLOWED_PACKAGE_FIELDS.has(field))) {
      throw new Error("This package action is not eligible for offline sync.");
    }
    if (endpoint === "location" && fields.some((field) => field !== "location")) {
      throw new Error("Only package location changes can be queued offline.");
    }
    if (endpoint === "operations" && fields.includes("location")) {
      throw new Error("Only package assignment and forwarding edits can be queued here.");
    }
    if (Object.hasOwn(patch, "location") && String(patch.location ?? "").length > 100) {
      throw new Error("Location must be 100 characters or fewer.");
    }
    if (Object.hasOwn(patch, "forward_destination_country") && String(patch.forward_destination_country ?? "").length > 80) {
      throw new Error("Destination country must be 80 characters or fewer.");
    }
    return { packageId, endpoint, patch };
  }

  queuePackageMutation(userId, request) {
    if (!userId) throw new Error("Sign in once while online before queueing offline edits.");
    const { packageId, endpoint, patch } = this.normalizePackageMutation(request);
    const existingPackage = this.findCachedPackage(userId, packageId);
    if (!existingPackage) throw new Error("This package is not in the offline cache. Reconnect and refresh it before editing offline.");
    const baseFields = {};
    for (const key of Object.keys(patch)) baseFields[key] = existingPackage[key] ?? null;
    const now = new Date().toISOString();
    const existing = this.statement(
      "SELECT operation_id, payload FROM sync_outbox WHERE user_id = ? AND status = 'queued'",
      [userId],
    ).map((row) => ({ id: row.operation_id, payload: this.decrypt(row.payload) }))
      .find((row) => row.payload?.packageId === packageId && row.payload?.endpoint === endpoint);

    const id = existing?.id || randomUUID();
    const operation = {
      kind: "package-set",
      packageId,
      endpoint,
      patch: { ...(existing?.payload.patch || {}), ...patch },
      baseFields: existing?.payload.baseFields || baseFields,
      createdAt: existing?.payload.createdAt || now,
    };
    const encrypted = this.encrypt(operation);
    this.db.run(
      `INSERT INTO sync_outbox (operation_id, user_id, status, created_at, updated_at, payload, error_code)
       VALUES (?, ?, 'queued', ?, ?, ?, NULL)
       ON CONFLICT(operation_id) DO UPDATE SET status = 'queued', updated_at = excluded.updated_at, payload = excluded.payload, error_code = NULL`,
      [id, userId, operation.createdAt, now, encrypted],
    );
    this.updateCachedPackage(userId, packageId, operation.patch, "queued");
    return {
      operationId: id,
      operation,
      optimistic: { id: packageId, ...existingPackage, ...operation.patch, _dex_sync_status: "queued" },
      merged: Boolean(existing),
    };
  }

  listOutbox(userId, statuses = ["queued", "conflict"]) {
    if (!userId) return [];
    const placeholders = statuses.map(() => "?").join(",");
    const rows = this.statement(
      `SELECT operation_id, status, created_at, payload, error_code FROM sync_outbox
       WHERE user_id = ? AND status IN (${placeholders}) ORDER BY created_at, operation_id`,
      [userId, ...statuses],
    );
    return rows.map((row) => ({
      operationId: row.operation_id,
      status: row.status,
      createdAt: row.created_at,
      errorCode: row.error_code,
      payload: this.decrypt(row.payload),
    }));
  }

  setOutboxStatus(operationId, status, errorCode = null) {
    this.ensureOpen();
    this.db.run("UPDATE sync_outbox SET status = ?, error_code = ?, updated_at = ? WHERE operation_id = ?", [
      status,
      errorCode,
      new Date().toISOString(),
      operationId,
    ]);
    this.persist();
  }

  finishOutboxOperation(operationId, userId, packageId) {
    this.ensureOpen();
    this.db.run("UPDATE sync_outbox SET status = 'synced', error_code = NULL, updated_at = ? WHERE operation_id = ?", [
      new Date().toISOString(),
      operationId,
    ]);
    this.updateCachedPackage(userId, packageId, {}, null);
    const finished = this.statement(
      "SELECT operation_id FROM sync_outbox WHERE user_id = ? AND status = 'synced' ORDER BY updated_at DESC LIMIT -1 OFFSET 200",
      [userId],
    );
    for (const row of finished) this.db.run("DELETE FROM sync_outbox WHERE operation_id = ?", [row.operation_id]);
    this.persist();
  }

  syncStatus(userId, online) {
    const counts = { queued: 0, conflict: 0, syncing: 0, synced: 0 };
    if (userId) {
      for (const row of this.statement("SELECT status, COUNT(*) AS count FROM sync_outbox WHERE user_id = ? GROUP BY status", [userId])) {
        counts[row.status] = Number(row.count || 0);
      }
    }
    return { online: Boolean(online), ...counts };
  }

  close() {
    if (!this.db) return;
    this.persist();
    this.db.close();
    this.db = null;
  }
}

module.exports = { OfflineStore };
