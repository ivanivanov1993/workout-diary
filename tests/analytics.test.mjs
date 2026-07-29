import assert from "node:assert/strict";
import test from "node:test";
import {
  exerciseMetrics,
  mergeQueuedOperations,
  personalRecords,
  qualifiesForThreeWeekHint,
} from "../lib/analytics.mjs";
import { canAccessState } from "../lib/access.mjs";

test("calculates sets, repetitions, maximum weight and volume", () => {
  const result = exerciseMetrics([
    { weight: 50, reps: 10 },
    { weight: 50, reps: 9 },
    { weight: 55, reps: 6 },
  ]);
  assert.deepEqual(result, {
    sets: 3,
    reps: 25,
    maxWeight: 55,
    volume: 1280,
  });
});

test("recalculates personal records from completed sessions only", () => {
  const records = personalRecords(
    [
      {
        status: "completed",
        exercises: [
          {
            exerciseId: "bench",
            sets: [
              { weight: 50, reps: 10 },
              { weight: 55, reps: 6 },
            ],
          },
        ],
      },
      {
        status: "active",
        exercises: [
          { exerciseId: "bench", sets: [{ weight: 90, reps: 1 }] },
        ],
      },
    ],
    "bench",
  );
  assert.deepEqual(records, {
    maxWeight: 55,
    maxReps: 16,
    maxVolume: 830,
  });
});

test("three-week hint requires three consecutive successful weeks", () => {
  const target = { weight: 60, sets: 3, reps: 10 };
  const performance = (weekKey) => ({
    weekKey,
    targetWeight: 60,
    completed: true,
    sets: [
      { weight: 60, reps: 10 },
      { weight: 60, reps: 11 },
      { weight: 62.5, reps: 10 },
    ],
  });
  assert.equal(
    qualifiesForThreeWeekHint(
      [performance("2026-W28"), performance("2026-W29"), performance("2026-W30")],
      target,
    ),
    true,
  );
  assert.equal(
    qualifiesForThreeWeekHint(
      [performance("2026-W27"), performance("2026-W29"), performance("2026-W30")],
      target,
    ),
    false,
  );
});

test("offline queue is idempotent by operation id", () => {
  assert.deepEqual(
    mergeQueuedOperations([
      { id: "b", createdAt: 2 },
      { id: "a", createdAt: 1 },
      { id: "a", createdAt: 3 },
    ]).map((item) => item.id),
    ["a", "b"],
  );
});

test("owner can write, partner can only read, outsider has no access", () => {
  assert.equal(
    canAccessState({
      requesterId: "owner",
      ownerId: "owner",
      write: true,
    }),
    true,
  );
  assert.equal(
    canAccessState({
      requesterId: "partner",
      ownerId: "owner",
      linkedPartnerId: "owner",
      write: false,
    }),
    true,
  );
  assert.equal(
    canAccessState({
      requesterId: "partner",
      ownerId: "owner",
      linkedPartnerId: "owner",
      write: true,
    }),
    false,
  );
  assert.equal(
    canAccessState({
      requesterId: "outsider",
      ownerId: "owner",
      linkedPartnerId: null,
      write: false,
    }),
    false,
  );
});
