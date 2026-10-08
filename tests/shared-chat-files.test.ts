import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeSharedChatFiles, sharedChatFiles } from "../lib/shared-chat-files";

// In-memory stand-in for the storage API: list() returns folders (id null) and files under a prefix, paged.
function fakeStorage(paths: string[]) {
  const removed: string[][] = [];
  const admin = {
    storage: {
      from: (bucket: string) => {
        assert.equal(bucket, "shared-chat");
        return {
          list: async (prefix: string, { limit, offset }: { limit: number; offset: number }) => {
            const names = new Map<string, boolean>();
            for (const p of paths) {
              if (!p.startsWith(prefix + "/")) continue;
              const rest = p.slice(prefix.length + 1).split("/");
              names.set(rest[0], rest.length > 1);
            }
            const all = [...names].map(([name, folder]) => ({ name, id: folder ? null : name }));
            return { data: all.slice(offset, offset + limit), error: null };
          },
          remove: async (batch: string[]) => {
            removed.push(batch);
            return { data: [], error: null };
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  return { admin, removed };
}

const PLAN = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const YOU = "33333333-3333-4333-8333-333333333333";

test("a plan's chat files are found across every sender's folder, and only that plan's", async () => {
  const { admin } = fakeStorage([`${PLAN}/${ME}/a.png`, `${PLAN}/${YOU}/b.m4a`, `other/${ME}/c.png`]);
  assert.deepEqual((await sharedChatFiles(admin, PLAN)).sort(), [`${PLAN}/${ME}/a.png`, `${PLAN}/${YOU}/b.m4a`]);
});

test("a member's chat files are limited to their own folder in that plan", async () => {
  const { admin } = fakeStorage([`${PLAN}/${ME}/a.png`, `${PLAN}/${YOU}/b.m4a`]);
  assert.deepEqual(await sharedChatFiles(admin, PLAN, ME), [`${PLAN}/${ME}/a.png`]);
});

test("listing and removal page through more than 1000 files", async () => {
  const files = Array.from({ length: 2500 }, (_, i) => `${PLAN}/${ME}/f${i}.png`);
  const { admin, removed } = fakeStorage(files);
  const found = await sharedChatFiles(admin, PLAN);
  assert.equal(found.length, 2500);
  await removeSharedChatFiles(admin, found);
  assert.deepEqual(removed.map((b) => b.length), [1000, 1000, 500]);
  await removeSharedChatFiles(admin, []);
  assert.equal(removed.length, 3);
});
