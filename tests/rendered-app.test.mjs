import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("deployment build contains the mobile application worker and metadata", async () => {
  const root = new URL("../", import.meta.url);
  await access(new URL("dist/server/index.js", root));
  await access(new URL("dist/.openai/hosting.json", root));
  const [page, layout, hosting] = await Promise.all([
    readFile(new URL("app/WorkoutApp.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("dist/.openai/hosting.json", root), "utf8"),
  ]);
  assert.match(page, /Начать тренировку/);
  assert.match(page, /Только просмотр/);
  assert.match(layout, /Дневник тренировок/);
  assert.match(layout, /manifest\.webmanifest/);
  assert.equal(JSON.parse(hosting).d1, "DB");
});
