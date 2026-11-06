const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const initSqlJs = require("sql.js");
const { OfflineStore } = require("./offline-store.cjs");

async function makeStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dex-offline-test-"));
  const SQL = await initSqlJs({ locateFile: (file) => path.join(path.dirname(require.resolve("sql.js")), file) });
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, "utf8").map((byte) => byte ^ 0x5a),
    decryptString: (value) => Buffer.from(value).map((byte) => byte ^ 0x5a).toString("utf8"),
  };
  const store = new OfflineStore({ SQL, dbPath: path.join(directory, "cache.sqlite"), safeStorage }).open();
  return { store, directory };
}

test("SQLite snapshots are user-scoped and secure values survive reopening", async () => {
  const { store, directory } = await makeStore();
  try {
    const url = "https://supabase.example/rest/v1/cargo_packages?select=*&limit=10";
    const snapshot = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify([{ id: "PK-1", location: "Shelf 1" }]), savedAt: new Date().toISOString() };
    store.putSnapshot("employee-a", url, "cargo_packages", snapshot);
    store.setSecureValue("session", { access_token: "access", refresh_token: "refresh" });
    assert.deepEqual(store.getSnapshot("employee-a", url), snapshot);
    assert.equal(store.getSnapshot("employee-b", url), null);
    store.close();

    const SQL = await initSqlJs({ locateFile: (file) => path.join(path.dirname(require.resolve("sql.js")), file) });
    const reopened = new OfflineStore({
      SQL,
      dbPath: path.join(directory, "cache.sqlite"),
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value, "utf8").map((byte) => byte ^ 0x5a),
        decryptString: (value) => Buffer.from(value).map((byte) => byte ^ 0x5a).toString("utf8"),
      },
    }).open();
    assert.equal(reopened.getSecureValue("session").refresh_token, "refresh");
    reopened.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("location edits queue optimistically and merge repeated edits without changing the base version", async () => {
  const { store, directory } = await makeStore();
  try {
    const listUrl = "https://supabase.example/rest/v1/cargo_packages?select=*&order=registered_at.desc&limit=500";
    const savedAt = new Date().toISOString();
    store.putSnapshot("employee-a", listUrl, "cargo_packages", {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ id: "PK-1", location: "Shelf 1", commission_employee_id: null, status: "paid" }]),
      savedAt,
    });
    const first = store.queuePackageMutation("employee-a", {
      url: "https://api.example/api/public/packages/PK-1/location",
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: "Shelf 2" }),
    });
    const second = store.queuePackageMutation("employee-a", {
      url: "https://api.example/api/public/packages/PK-1/location",
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: "Rack A" }),
    });
    assert.equal(first.operationId, second.operationId);
    assert.equal(second.operation.baseFields.location, "Shelf 1");
    assert.equal(second.operation.patch.location, "Rack A");
    const cached = JSON.parse(store.getSnapshot("employee-a", listUrl).body)[0];
    assert.equal(cached.location, "Rack A");
    assert.equal(cached._dex_sync_status, "queued");
    assert.equal(store.syncStatus("employee-a", false).queued, 1);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("offline queue rejects finance, release, arbitrary table writes, and uncached records", async () => {
  const { store, directory } = await makeStore();
  try {
    const listUrl = "https://supabase.example/rest/v1/cargo_packages?select=*&limit=10";
    store.putSnapshot("employee-a", listUrl, "cargo_packages", {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ id: "PK-1", location: "Shelf 1" }]),
      savedAt: new Date().toISOString(),
    });
    assert.throws(() => store.queuePackageMutation("employee-a", {
      url: "https://api.example/api/public/admin/payment-control",
      method: "PATCH",
      body: JSON.stringify({ amount: 5 }),
    }), /cannot be queued safely/);
    assert.throws(() => store.queuePackageMutation("employee-a", {
      url: "https://api.example/api/public/packages/PK-1/release",
      method: "POST",
      body: "{}",
    }), /cannot be queued safely/);
    assert.throws(() => store.queuePackageMutation("employee-a", {
      url: "https://supabase.example/rest/v1/cargo_packages?id=eq.PK-1",
      method: "PATCH",
      body: JSON.stringify({ status: "paid" }),
    }), /cannot be queued safely/);
    assert.throws(() => store.queuePackageMutation("employee-a", {
      url: "https://api.example/api/public/packages/PK-2/location",
      method: "PUT",
      body: JSON.stringify({ location: "Shelf 2" }),
    }), /not in the offline cache/);
    assert.equal(store.syncStatus("employee-a", false).queued, 0);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
