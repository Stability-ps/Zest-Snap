import { test } from "node:test";
import assert from "node:assert/strict";
import { CachedCloudProvider } from "../lib/data/cached";
import { LocalDataProvider } from "../lib/data/local";
import { emptyState } from "../lib/data/types";
function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) || null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] || null,
    get length() {
      return map.size;
    },
  } as Storage;
}
test("cloud cache retains failed writes and replays them after reconnect", async () => {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true },
    configurable: true,
  });
  const remote = new LocalDataProvider(storage()),
    device = storage();
  let fail = true;
  const original = remote.save.bind(remote);
  remote.save = async (next) => {
    if (fail) throw new Error("unavailable");
    await original(next);
  };
  const p = new CachedCloudProvider(remote, "account-1", device);
  await p.load();
  const next = { ...emptyState, firstCalendarRewarded: true };
  await assert.rejects(() => p.save(next, emptyState));
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: false },
    configurable: true,
  });
  assert.deepEqual(await p.load(), next);
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true },
    configurable: true,
  });
  fail = false;
  assert.deepEqual(await p.load(), next);
  assert.deepEqual(JSON.parse(device.getItem("account-1")!).pending, []);
});
