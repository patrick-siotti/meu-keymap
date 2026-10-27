import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request } from "node:http";
import { ProfileStore, createApiHandler } from "../server.ts";
import { defaultDocument } from "../lib/model.ts";

test("atomic local saves survive reopening, preserve prior copy, reject concurrent stale writers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meu-keymap-test-"));
  try {
    const store = new ProfileStore(directory);
    const first = defaultDocument();
    first.profiles[0]!.name = "Persistência";
    await store.save(first, 0);
    assert.equal(
      (await new ProfileStore(directory).load()).document.profiles[0]!.name,
      "Persistência",
    );
    const results = await Promise.allSettled([
      store.save(first, 1),
      store.save(first, 1),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await store.load()).revision, 2);
    const backup = JSON.parse(
      await readFile(join(directory, "profiles.previous.json"), "utf8"),
    ) as { revision: number };
    assert.equal(backup.revision, 1);
    await writeFile(join(directory, "profiles.json"), "broken json", "utf8");
    await assert.rejects(store.save(first, 2));
    assert.equal(
      await readFile(join(directory, "profiles.json"), "utf8"),
      "broken json",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("HTTP contract validates data and rejects foreign origins/hosts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meu-keymap-http-"));
  const handler = createApiHandler(new ProfileStore(directory));
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/api/profiles`)).status, 200);
    assert.equal(
      (
        await fetch(`${base}/api/profiles`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://example.com",
          },
          body: JSON.stringify({ revision: 0, document: defaultDocument() }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/api/profiles`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: 0, document: {} }),
        })
      ).status,
      400,
    );
    const save = () =>
      fetch(`${base}/api/profiles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: 0, document: defaultDocument() }),
      });
    assert.equal((await save()).status, 200);
    assert.equal((await save()).status, 409);
    const badHostStatus = await new Promise<number>((resolve) => {
      const req = request(
        `${base}/api/health`,
        { headers: { Host: "evil.example:4173" } },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      req.end();
    });
    assert.equal(badHostStatus, 403);
    const reread = (await (await fetch(`${base}/api/profiles`)).json()) as {
      revision: number;
    };
    assert.equal(reread.revision, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
