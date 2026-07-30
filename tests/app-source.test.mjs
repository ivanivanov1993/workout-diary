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

test("personal workout flow, onboarding and hybrid storage are present", async () => {
  const [app, page, stateRoute] = await Promise.all([
    readFile(new URL("app/WorkoutApp.tsx", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/state/route.ts", root), "utf8"),
  ]);
  assert.doesNotMatch(app, /Анна|partnerMode|\/api\/partner/);
  assert.match(app, /indexedDB\.open/);
  assert.match(app, /Как к вам обращаться\?/);
  assert.match(app, /latest-state:local/);
  assert.match(app, /latest-state:\$\{storageScope\}/);
  assert.match(app, /\/signin-with-chatgpt\?return_to=\//);
  assert.match(app, /Текущие данные перенесутся автоматически/);
  assert.match(app, /Без сети — сохраним позже/);
  assert.match(app, /Повторить прошлый подход/);
  assert.match(app, /Следующее упражнение/);
  assert.match(app, /Удалить упражнение/);
  assert.match(app, /setDraftWeight\(event\.target\.value\)/);
  assert.match(app, /setDraftReps\(event\.target\.value\)/);
  assert.match(page, /local@device/);
  assert.doesNotMatch(page, /Дмитрий|demo@local/);
  assert.match(stateRoute, /const state = stored \? JSON\.parse\(stored\.payload\) : null/);
});
