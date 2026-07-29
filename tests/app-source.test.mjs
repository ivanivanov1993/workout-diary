import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("PWA metadata and offline shell are configured", async () => {
  const [manifest, serviceWorker, layout] = await Promise.all([
    readFile(new URL("public/manifest.webmanifest", root), "utf8"),
    readFile(new URL("public/sw.js", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
  ]);
  const parsed = JSON.parse(manifest);
  assert.equal(parsed.display, "standalone");
  assert.equal(parsed.lang, "ru");
  assert.match(serviceWorker, /caches\.open/);
  assert.match(layout, /viewportFit:\s*"cover"/);
  assert.match(layout, /appleWebApp/);
});

test("partner mode and workout autosave are present", async () => {
  const app = await readFile(new URL("app/WorkoutApp.tsx", root), "utf8");
  assert.match(app, /Только просмотр/);
  assert.match(app, /indexedDB\.open/);
  assert.match(app, /Без сети — сохраним позже/);
  assert.match(app, /Повторить прошлый подход/);
  assert.match(app, /Следующее упражнение/);
});
