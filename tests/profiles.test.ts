import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultDocument, makeProfile, documentSchema } from "../lib/model.ts";
import { removeProfile } from "../lib/profiles.ts";

test("deleting a profile preserves the other mappings and always leaves a valid active profile", () => {
  const document = defaultDocument();
  document.profiles.push(
    makeProfile("work", "Trabalho"),
    makeProfile("games", "Jogos"),
  );
  document.activeProfile = "work";
  const original = JSON.stringify(document);
  const removedActive = removeProfile(document, "work");
  assert.equal(removedActive.activeProfile, "principal");
  assert.deepEqual(removedActive.profiles, [
    document.profiles[0],
    document.profiles[2],
  ]);
  assert.ok(documentSchema.safeParse(removedActive).success);
  assert.equal(JSON.stringify(document), original);
  const removedOther = removeProfile(document, "principal");
  assert.equal(removedOther.activeProfile, "work");
  document.activeProfile = "principal";
  assert.equal(removeProfile(document, "principal").activeProfile, "work");
  assert.equal(removeProfile(document, "absent"), document);
  const last = defaultDocument();
  assert.equal(removeProfile(last, "principal"), last);
});
