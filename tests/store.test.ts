import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContentStore } from "../src/content";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "docfold-store-"));
  await Bun.write(join(root, "a.md"), "# A");
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe("ContentStore", () => {
  test("reads the folder once and re-reads it after invalidate()", async () => {
    const store = new ContentStore(root, { debounce: 0 });
    try {
      const first = await store.library();
      expect(await store.library()).toBe(first); // cached

      await Bun.write(join(root, "b.md"), "# B");
      expect((await store.library()).docs).toHaveLength(1); // still the cached copy

      store.invalidate();
      const second = await store.library();
      expect(second).not.toBe(first);
      expect(second.docs.map((doc) => doc.title)).toEqual(["A", "B"]);
    } finally {
      store.close();
      await rm(join(root, "b.md"), { force: true });
    }
  });

  test("tells listeners once per burst of changes, until they unsubscribe", async () => {
    const store = new ContentStore(root, { debounce: 20 });
    let calls = 0;
    const unsubscribe = store.onChange(() => calls++);
    try {
      store.notify();
      store.notify();
      store.invalidate();
      await Bun.sleep(60);
      expect(calls).toBe(1);

      unsubscribe();
      store.notify();
      await Bun.sleep(60);
      expect(calls).toBe(1);
    } finally {
      store.close();
    }
  });

  test("close() drops pending notifications", async () => {
    const store = new ContentStore(root, { debounce: 20 });
    let calls = 0;
    store.onChange(() => calls++);
    store.notify();
    store.close();
    await Bun.sleep(60);
    expect(calls).toBe(0);
  });

  test("watch() can be called more than once and close() stops it", () => {
    const store = new ContentStore(root);
    expect(store.watch().watch()).toBe(store);
    store.close();
    store.close();
  });
});
