export function exerciseMetrics(sets = []) {
  if (!sets.length) {
    return { sets: 0, reps: 0, maxWeight: 0, volume: 0 };
  }

  return sets.reduce(
    (result, set) => ({
      sets: result.sets + 1,
      reps: result.reps + Number(set.reps || 0),
      maxWeight: Math.max(result.maxWeight, Number(set.weight || 0)),
      volume:
        result.volume + Number(set.weight || 0) * Number(set.reps || 0),
    }),
    { sets: 0, reps: 0, maxWeight: 0, volume: 0 },
  );
}

export function personalRecords(sessions = [], exerciseId) {
  return sessions
    .filter((session) => session.status === "completed")
    .flatMap((session) =>
      session.exercises
        .filter((exercise) => exercise.exerciseId === exerciseId)
        .map((exercise) => exerciseMetrics(exercise.sets)),
    )
    .reduce(
      (records, metrics) => ({
        maxWeight: Math.max(records.maxWeight, metrics.maxWeight),
        maxReps: Math.max(records.maxReps, metrics.reps),
        maxVolume: Math.max(records.maxVolume, metrics.volume),
      }),
      { maxWeight: 0, maxReps: 0, maxVolume: 0 },
    );
}

export function qualifiesForThreeWeekHint(performances = [], target) {
  if (
    !target ||
    !Number.isFinite(target.weight) ||
    !Number.isFinite(target.sets) ||
    !Number.isFinite(target.reps)
  ) {
    return false;
  }

  const successfulWeeks = new Map();
  for (const item of performances) {
    if (item.targetWeight !== target.weight || !item.completed) continue;
    const qualifying = item.sets.filter(
      (set) => set.weight >= target.weight && set.reps >= target.reps,
    );
    if (qualifying.length >= target.sets) {
      successfulWeeks.set(item.weekKey, true);
    }
  }

  const weeks = [...successfulWeeks.keys()].sort();
  if (weeks.length < 3) return false;

  const recent = weeks.slice(-3).map((key) => {
    const [year, week] = key.split("-W").map(Number);
    return year * 53 + week;
  });

  return recent[1] - recent[0] === 1 && recent[2] - recent[1] === 1;
}

export function mergeQueuedOperations(operations = []) {
  const unique = new Map();
  for (const operation of operations) {
    if (!unique.has(operation.id)) unique.set(operation.id, operation);
  }
  return [...unique.values()].sort((a, b) => a.createdAt - b.createdAt);
}
