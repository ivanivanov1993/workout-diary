"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AppState,
  CardioEntry,
  createStarterState,
  formatDate,
  formatWeight,
  makeId,
  WorkoutExercise,
  WorkoutSession,
} from "./data";
import {
  exerciseIdsFromPrograms,
  exerciseMetrics,
  personalRecords,
} from "@/lib/analytics.mjs";

type MainView = "home" | "programs" | "progress" | "profile";
type Overlay =
  | null
  | { type: "templates" }
  | { type: "history"; session: WorkoutSession }
  | { type: "exercise-menu" }
  | { type: "add-weight" }
  | { type: "add-cardio" }
  | {
      type: "confirm";
      title: string;
      text: string;
      action: () => void;
      confirmLabel?: string;
      danger?: boolean;
    };
type SyncStatus = "saved" | "saving" | "offline" | "error";

type Props = {
  viewer: { name: string; email: string; authenticated: boolean };
};

const DB_NAME = "training-diary";
const LEGACY_STATE_KEY = "latest-state";
const LOCAL_STATE_KEY = "latest-state:local";
const WEEKDAYS = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];

async function openLocalDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("cache")) {
        db.createObjectStore("cache");
      }
      if (!db.objectStoreNames.contains("queue")) {
        db.createObjectStore("queue", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function cacheState(state: AppState, key: string) {
  const db = await openLocalDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("cache", "readwrite");
    transaction.objectStore("cache").put(state, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function readCachedState(key: string) {
  const db = await openLocalDb();
  const state = await new Promise<AppState | undefined>((resolve, reject) => {
    const request = db.transaction("cache").objectStore("cache").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return state;
}

async function queueState(
  state: AppState,
  operationId: string,
  scope: string,
) {
  const db = await openLocalDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("queue", "readwrite");
    transaction.objectStore("queue").put({
      id: operationId,
      scope,
      state,
      createdAt: Date.now(),
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function clearQueue(scope: string) {
  const db = await openLocalDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("queue", "readwrite");
    const request = transaction.objectStore("queue").openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const queued = cursor.value as { scope?: string };
      if (!queued.scope || queued.scope === scope) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

const categoryClass = (category: string) => {
  const normalized = category.toLowerCase();
  if (normalized.includes("груд")) return "coral";
  if (normalized.includes("ног")) return "yellow";
  if (normalized.includes("спин")) return "blue";
  if (normalized.includes("рук")) return "mint";
  return "violet";
};

const categoryMark = (category: string) => {
  const normalized = category.toLowerCase();
  if (normalized.includes("груд")) return "Г";
  if (normalized.includes("ног")) return "Н";
  if (normalized.includes("спин")) return "С";
  if (normalized.includes("рук")) return "Р";
  return "У";
};

function getExercise(state: AppState, id: string) {
  return state.exercises.find((exercise) => exercise.id === id);
}

function startSession(state: AppState, templateId?: string) {
  const template = state.programs
    .flatMap((program) => program.templates)
    .find((item) => item.id === templateId);
  const exercises: WorkoutExercise[] = (template?.exercises ?? []).map(
    (item) => {
      const exercise = getExercise(state, item.exerciseId);
      return {
        id: makeId("we"),
        exerciseId: item.exerciseId,
        name: exercise?.name ?? "Упражнение",
        category: exercise?.category ?? "Универсальное",
        goal: item.goal,
        completed: false,
        sets: [],
      };
    },
  );

  return {
    id: makeId("session"),
    templateId,
    name: template?.name ?? "Свободная тренировка",
    startedAt: new Date().toISOString(),
    status: "active" as const,
    exercises,
  };
}

function workoutExerciseHistory(
  state: AppState,
  exerciseId: string,
  excludeId?: string,
) {
  return state.sessions
    .filter(
      (session) =>
        session.status === "completed" && session.id !== excludeId,
    )
    .sort(
      (a, b) =>
        new Date(b.completedAt ?? b.startedAt).getTime() -
        new Date(a.completedAt ?? a.startedAt).getTime(),
    )
    .flatMap((session) =>
      session.exercises.filter(
        (exercise) => exercise.exerciseId === exerciseId,
      ),
    )[0];
}

function MetricIcon({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: string;
}) {
  return <span className={`metric-icon ${tone}`}>{children}</span>;
}

function SyncBadge({ status }: { status: SyncStatus }) {
  const labels = {
    saved: "Сохранено",
    saving: "Сохраняем…",
    offline: "Без сети — сохраним позже",
    error: "Не удалось синхронизировать",
  };
  return (
    <span className={`sync-badge ${status}`} role="status">
      <span aria-hidden="true">
        {status === "saved" ? "✓" : status === "offline" ? "↻" : "·"}
      </span>
      {labels[status]}
    </span>
  );
}

function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-graph" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

function OnboardingScreen({
  defaultName,
  authenticated,
  onComplete,
}: {
  defaultName: string;
  authenticated: boolean;
  onComplete: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState("");

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card">
        <div className="onboarding-mark" aria-hidden="true">Ж</div>
        <span className="eyebrow">Личный дневник тренировок</span>
        <h1>Как к вам обращаться?</h1>
        <p>
          Имя появится в вашем дневнике. Результаты каждого человека хранятся
          отдельно.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = name.trim();
            if (!normalized) {
              setError("Укажите имя");
              return;
            }
            onComplete(normalized);
          }}
        >
          <label className="form-field">
            <span>Ваше имя</span>
            <input
              autoComplete="name"
              autoFocus
              maxLength={50}
              placeholder="Например, Алексей"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError("");
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "name-error" : "storage-note"}
            />
          </label>
          {error && (
            <small className="field-error" id="name-error" role="alert">
              {error}
            </small>
          )}
          <button className="primary-button" type="submit">
            Начать <span aria-hidden="true">→</span>
          </button>
        </form>
        <div className="onboarding-note" id="storage-note">
          <span className="status-check">✓</span>
          <p>
            <strong>
              {authenticated
                ? "Сохранение на телефоне и резервная копия"
                : "Сохранение на этом телефоне"}
            </strong>
            <small>
              {authenticated
                ? "Данные доступны после входа и не смешиваются с чужими."
                : "Войти для резервной копии можно позже в профиле."}
            </small>
          </p>
        </div>
      </section>
    </main>
  );
}

function Chart({
  values,
  color,
  kind = "line",
  label,
}: {
  values: number[];
  color: string;
  kind?: "line" | "bars";
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, rect.width * ratio);
      canvas.height = Math.max(1, rect.height * ratio);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      const width = rect.width;
      const height = rect.height;
      const padding = 18;
      context.clearRect(0, 0, width, height);
      context.strokeStyle = "#e5e7e1";
      context.lineWidth = 1;
      for (let row = 1; row <= 3; row += 1) {
        const y = padding + ((height - padding * 2) * row) / 4;
        context.beginPath();
        context.moveTo(padding, y);
        context.lineTo(width - padding, y);
        context.stroke();
      }
      if (!values.length) return;
      const max = Math.max(...values, 1);
      const min = Math.min(...values, 0);
      const range = Math.max(1, max - min);
      const xFor = (index: number) =>
        values.length === 1
          ? width / 2
          : padding +
            ((width - padding * 2) * index) / (values.length - 1);
      const yFor = (value: number) =>
        height -
        padding -
        ((value - min) / range) * (height - padding * 2);

      if (kind === "bars") {
        const barWidth = Math.min(
          34,
          (width - padding * 2) / Math.max(values.length * 1.7, 2),
        );
        context.fillStyle = color;
        values.forEach((value, index) => {
          const y = yFor(value);
          context.beginPath();
          context.roundRect(
            xFor(index) - barWidth / 2,
            y,
            barWidth,
            height - padding - y,
            [6, 6, 2, 2],
          );
          context.fill();
        });
        return;
      }

      context.strokeStyle = color;
      context.lineWidth = 3;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.beginPath();
      values.forEach((value, index) => {
        const x = xFor(index);
        const y = yFor(value);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      context.fillStyle = color;
      values.forEach((value, index) => {
        context.beginPath();
        context.arc(xFor(index), yFor(value), 4, 0, Math.PI * 2);
        context.fill();
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [values, color, kind]);

  return <canvas ref={ref} className="chart-canvas" aria-label={label} />;
}

export default function WorkoutApp({ viewer }: Props) {
  const [state, setState] = useState<AppState>(() =>
    createStarterState(viewer.name, viewer.email),
  );
  const [view, setView] = useState<MainView>("home");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [workoutIndex, setWorkoutIndex] = useState(0);
  const [workoutOpen, setWorkoutOpen] = useState(false);
  const [summary, setSummary] = useState<WorkoutSession | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    typeof navigator === "undefined" || navigator.onLine ? "saved" : "offline",
  );
  const [hydrated, setHydrated] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [period, setPeriod] = useState<"7" | "30" | "all">("30");
  const [selectedExercise, setSelectedExercise] = useState("bench");
  const [draftWeight, setDraftWeight] = useState("60");
  const [draftReps, setDraftReps] = useState("10");
  const [notice, setNotice] = useState<string | null>(null);
  const [referenceNow] = useState(() => Date.now());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchDrag = useRef<{ templateId: string; index: number } | null>(null);
  const storageScope = viewer.authenticated
    ? `account:${viewer.email.toLowerCase()}`
    : "local";
  const cacheKey = viewer.authenticated
    ? `latest-state:${storageScope}`
    : LOCAL_STATE_KEY;

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  }, []);

  const syncNow = useCallback(
    async (next: AppState, operationId: string) => {
      if (!navigator.onLine) {
        setSyncStatus("offline");
        return;
      }
      setSyncStatus("saving");
      try {
        const response = await fetch("/api/state", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            state: next,
            operationId,
            version: next.version,
          }),
        });
        if (response.status === 401 && !viewer.authenticated) {
          setSyncStatus("saved");
          await clearQueue(storageScope);
          return;
        }
        if (!response.ok) throw new Error("sync failed");
        await clearQueue(storageScope);
        setSyncStatus("saved");
      } catch {
        setSyncStatus(navigator.onLine ? "error" : "offline");
      }
    },
    [storageScope, viewer.authenticated],
  );

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        let cached = await readCachedState(cacheKey);
        if (!cached && viewer.authenticated) {
          cached = await readCachedState(LOCAL_STATE_KEY);
        }
        if (!cached) cached = await readCachedState(LEGACY_STATE_KEY);

        let nextState = cached;
        if (viewer.authenticated) {
          const response = await fetch("/api/state");
          if (response.ok) {
            const data = (await response.json()) as {
              state?: AppState | null;
            };
            if (data.state) {
              nextState = data.state;
            } else if (nextState) {
              nextState = {
                ...nextState,
                profile: {
                  ...nextState.profile,
                  email: viewer.email.toLowerCase(),
                },
              };
            }
          }
        }

        if (!cancelled && nextState) {
          setState(nextState);
          setProfileReady(true);
          await cacheState(nextState, cacheKey);
        }
      } catch {
        setSyncStatus(navigator.onLine ? "error" : "offline");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };
    hydrate();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, viewer.authenticated, viewer.email]);

  useEffect(() => {
    if (!hydrated || !profileReady) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const operationId = makeId("op");
    cacheState(state, cacheKey).catch(() => setSyncStatus("error"));
    if (viewer.authenticated) {
      queueState(state, operationId, storageScope).catch(() =>
        setSyncStatus("error"),
      );
      saveTimer.current = setTimeout(() => syncNow(state, operationId), 500);
    }
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [
    cacheKey,
    hydrated,
    profileReady,
    state,
    storageScope,
    syncNow,
    viewer.authenticated,
  ]);

  useEffect(() => {
    const online = () => {
      if (viewer.authenticated && profileReady) {
        setSyncStatus("saving");
        syncNow(state, makeId("op-online"));
      } else {
        setSyncStatus("saved");
      }
    };
    const offline = () => setSyncStatus("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [profileReady, state, syncNow, viewer.authenticated]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  if (!hydrated) {
    return (
      <main className="onboarding-shell" aria-busy="true">
        <section className="onboarding-card loading-card">
          <div className="onboarding-mark" aria-hidden="true">Ж</div>
          <span className="eyebrow">Личный дневник тренировок</span>
          <h1>Загружаем ваши данные…</h1>
          <p>Это займёт всего несколько секунд.</p>
        </section>
      </main>
    );
  }

  if (!profileReady) {
    return (
      <OnboardingScreen
        authenticated={viewer.authenticated}
        defaultName={viewer.name}
        onComplete={(name) => {
          setState(createStarterState(name, viewer.email));
          setProfileReady(true);
        }}
      />
    );
  }

  const activeTemplate = state.programs
    .find((program) => program.active)
    ?.templates[0];
  const weekSessions = state.sessions.filter(
    (session) =>
      referenceNow -
        new Date(session.completedAt ?? session.startedAt).getTime() <
      7 * 86400000,
  );

  const prepareDraft = (exercise?: WorkoutExercise) => {
    if (!exercise) return;
    const previous = workoutExerciseHistory(state, exercise.exerciseId);
    const last = exercise.sets.at(-1) ?? previous?.sets.at(-1);
    setDraftWeight(String(last?.weight ?? exercise.goal?.weight ?? 20));
    setDraftReps(String(last?.reps ?? exercise.goal?.reps ?? 10));
  };

  const beginWorkout = (templateId?: string) => {
    if (state.activeSession) {
      setWorkoutIndex(
        Math.max(
          0,
          state.activeSession.exercises.findIndex(
            (exercise) => !exercise.completed,
          ),
        ),
      );
      const nextIndex = Math.max(
        0,
        state.activeSession.exercises.findIndex(
          (exercise) => !exercise.completed,
        ),
      );
      prepareDraft(state.activeSession.exercises[nextIndex]);
      setOverlay(null);
      setWorkoutOpen(true);
      return;
    }
    const session = startSession(state, templateId);
    if (!session.exercises.length) {
      const first = state.exercises[0];
      session.exercises.push({
        id: makeId("we"),
        exerciseId: first.id,
        name: first.name,
        category: first.category,
        completed: false,
        sets: [],
      });
    }
    setState((current) => ({ ...current, activeSession: session }));
    setWorkoutIndex(0);
    prepareDraft(session.exercises[0]);
    setWorkoutOpen(true);
    setOverlay(null);
  };

  const updateActiveSession = (updater: (session: WorkoutSession) => WorkoutSession) =>
    setState((current) =>
      current.activeSession
        ? { ...current, activeSession: updater(current.activeSession) }
        : current,
    );

  const currentWorkoutExercise = state.activeSession?.exercises[workoutIndex];

  const addSet = (weightValue?: number, repsValue?: number) => {
    const weight =
      weightValue ?? Number(draftWeight.trim().replace(",", "."));
    const reps = repsValue ?? Number(draftReps.trim());
    const hasEmptyDraft =
      weightValue === undefined &&
      repsValue === undefined &&
      (!draftWeight.trim() || !draftReps.trim());
    if (
      !currentWorkoutExercise ||
      hasEmptyDraft ||
      !Number.isFinite(weight) ||
      !Number.isFinite(reps) ||
      weight <= 0 ||
      reps < 0
    ) {
      showNotice("Проверьте вес и количество повторений");
      return;
    }
    updateActiveSession((session) => ({
      ...session,
      exercises: session.exercises.map((exercise, index) =>
        index === workoutIndex
          ? {
              ...exercise,
              sets: [
                ...exercise.sets,
                {
                  id: makeId("set"),
                  weight,
                  reps: Math.round(reps),
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : exercise,
      ),
    }));
    showNotice("Подход сохранён");
  };

  const removeSet = (setId: string) =>
    setOverlay({
      type: "confirm",
      title: "Удалить подход?",
      text: "Подход исчезнет из текущей тренировки.",
      confirmLabel: "Удалить подход",
      danger: true,
      action: () => {
        updateActiveSession((session) => ({
          ...session,
          exercises: session.exercises.map((exercise, index) =>
            index === workoutIndex
              ? {
                  ...exercise,
                  sets: exercise.sets.filter((set) => set.id !== setId),
                }
              : exercise,
          ),
        }));
        setOverlay(null);
      },
    });

  const toggleExerciseDone = () =>
    updateActiveSession((session) => ({
      ...session,
      exercises: session.exercises.map((exercise, index) =>
        index === workoutIndex
          ? { ...exercise, completed: !exercise.completed }
          : exercise,
      ),
    }));

  const finishWorkout = () => {
    const session = state.activeSession;
    if (!session) return;
    const unfinished = session.exercises.filter(
      (exercise) => !exercise.completed,
    );
    if (unfinished.length) {
      setOverlay({
        type: "confirm",
        title: "Есть незавершённые упражнения",
        text: `${unfinished.map((item) => item.name).join(", ")}. Можно завершить тренировку как есть.`,
        action: () => completeWorkout(session),
      });
      return;
    }
    completeWorkout(session);
  };

  const completeWorkout = (session: WorkoutSession) => {
    const completed: WorkoutSession = {
      ...session,
      status: "completed",
      completedAt: new Date().toISOString(),
    };
    setState((current) => ({
      ...current,
      activeSession: null,
      sessions: [completed, ...current.sessions],
    }));
    setOverlay(null);
    setWorkoutOpen(false);
    setSummary(completed);
  };

  const goNext = () => {
    const session = state.activeSession;
    const exercise = session?.exercises[workoutIndex];
    if (!session || !exercise) return;
    if (workoutIndex === session.exercises.length - 1) {
      finishWorkout();
      return;
    }
    const proceed = () => {
      prepareDraft(session.exercises[workoutIndex + 1]);
      setWorkoutIndex((index) => index + 1);
      setOverlay(null);
    };
    if (!exercise.completed) {
      setOverlay({
        type: "confirm",
        title: "Перейти дальше?",
        text: "Упражнение останется незавершённым, к нему можно вернуться позже.",
        action: proceed,
      });
      return;
    }
    proceed();
  };

  const deleteSession = (sessionId: string) =>
    setOverlay({
      type: "confirm",
      title: "Удалить тренировку?",
      text: "История и личные рекорды будут пересчитаны.",
      confirmLabel: "Удалить тренировку",
      danger: true,
      action: () => {
        setState((current) => ({
          ...current,
          sessions: current.sessions.filter(
            (session) => session.id !== sessionId,
          ),
        }));
        setOverlay(null);
      },
    });

  const reorderExercise = (
    templateId: string,
    from: number,
    to: number,
  ) => {
    if (to < 0) return;
    setState((current) => ({
      ...current,
      programs: current.programs.map((program) => ({
        ...program,
        templates: program.templates.map((template) => {
          if (template.id !== templateId || to >= template.exercises.length) {
            return template;
          }
          const exercises = [...template.exercises];
          const [moved] = exercises.splice(from, 1);
          exercises.splice(to, 0, moved);
          return { ...template, exercises };
        }),
      })),
    }));
  };

  const deleteTemplateExercise = (
    templateId: string,
    templateExerciseId: string,
    exerciseName: string,
  ) =>
    setOverlay({
      type: "confirm",
      title: `Удалить «${exerciseName}»?`,
      text: "Упражнение исчезнет из этого шаблона. Уже сохранённые тренировки и статистика останутся без изменений.",
      confirmLabel: "Удалить упражнение",
      danger: true,
      action: () => {
        setState((current) => ({
          ...current,
          programs: current.programs.map((program) => ({
            ...program,
            templates: program.templates.map((template) =>
              template.id === templateId
                ? {
                    ...template,
                    exercises: template.exercises.filter(
                      (item) => item.id !== templateExerciseId,
                    ),
                  }
                : template,
            ),
          })),
        }));
        setOverlay(null);
        showNotice("Упражнение удалено из программы");
      },
    });

  const updateTemplateDay = (templateId: string, day: string) => {
    setState((current) => ({
      ...current,
      programs: current.programs.map((program) => ({
        ...program,
        templates: program.templates.map((template) =>
          template.id === templateId
            ? { ...template, day: day || undefined }
            : template,
        ),
      })),
    }));
  };

  const deleteTemplate = (
    programId: string,
    templateId: string,
    templateName: string,
  ) =>
    setOverlay({
      type: "confirm",
      title: `Удалить шаблон «${templateName}»?`,
      text: "Шаблон исчезнет из программы. Активная тренировка, история и статистика останутся без изменений.",
      confirmLabel: "Удалить шаблон",
      danger: true,
      action: () => {
        setState((current) => ({
          ...current,
          programs: current.programs.map((program) =>
            program.id === programId
              ? {
                  ...program,
                  templates: program.templates.filter(
                    (template) => template.id !== templateId,
                  ),
                }
              : program,
          ),
        }));
        setOverlay(null);
        showNotice("Шаблон удалён");
      },
    });

  const addBodyWeight = (weight: number, date: string) => {
    if (weight <= 0 || weight > 500) {
      showNotice("Укажите корректную массу");
      return;
    }
    setState((current) => ({
      ...current,
      bodyWeights: [
        { id: makeId("weight"), weight, date: new Date(date).toISOString() },
        ...current.bodyWeights.filter(
          (entry) =>
            new Date(entry.date).toDateString() !== new Date(date).toDateString(),
        ),
      ],
    }));
    setOverlay(null);
  };

  const addCardio = (entry: Omit<CardioEntry, "id">) => {
    if (entry.minutes < 0 || (entry.distance ?? 0) < 0) {
      showNotice("Проверьте значения кардио");
      return;
    }
    setState((current) => ({
      ...current,
      cardio: [{ ...entry, id: makeId("cardio") }, ...current.cardio],
    }));
    setOverlay(null);
  };

  if (state.activeSession && workoutOpen && !summary) {
    const session = state.activeSession;
    const exercise = session.exercises[workoutIndex] ?? session.exercises[0];
    const done = session.exercises.filter((item) => item.completed).length;
    const previous = workoutExerciseHistory(state, exercise.exerciseId);
    const previousMetrics = exerciseMetrics(previous?.sets ?? []);
    return (
      <div className="app-shell workout-shell">
        <header className="workout-header">
          <button
            className="round-button"
            onClick={() => {
              setState((current) => ({ ...current }));
              setWorkoutOpen(false);
              setSummary(null);
              window.history.replaceState(null, "", "/");
              showNotice("Тренировка сохранена, можно продолжить позже");
            }}
            aria-label="Выйти с сохранением"
          >
            ←
          </button>
          <div>
            <span className="eyebrow">Текущая тренировка</span>
            <h1>{session.name}</h1>
          </div>
          <SyncBadge status={syncStatus} />
        </header>

        <main className="workout-content">
          <button
            className="progress-panel"
            onClick={() => setOverlay({ type: "exercise-menu" })}
          >
            <span>
              <strong>
                {done} из {session.exercises.length} выполнено
              </strong>
              <span className="progress-track">
                <i
                  style={{
                    width: `${(done / Math.max(1, session.exercises.length)) * 100}%`,
                  }}
                />
              </span>
            </span>
            <span
              className="progress-ring"
              style={
                {
                  "--progress": `${(done / Math.max(1, session.exercises.length)) * 360}deg`,
                } as React.CSSProperties
              }
            >
              <b>{done}</b>
            </span>
          </button>

          <section className="exercise-heading">
            <span className={`exercise-avatar ${categoryClass(exercise.category)}`}>
              {categoryMark(exercise.category)}
            </span>
            <div>
              <h2>{exercise.name}</h2>
              <p>
                Упражнение {workoutIndex + 1} из {session.exercises.length}
              </p>
            </div>
          </section>

          <div className="goal-grid">
            {exercise.goal && (
              <article className="soft-card yellow">
                <span>Цель</span>
                <strong>
                  {formatWeight(exercise.goal.weight)} кг × {exercise.goal.reps}
                </strong>
                <small>{exercise.goal.sets} подхода</small>
              </article>
            )}
            <article className="soft-card blue">
              <span>В прошлый раз</span>
              {previous ? (
                <>
                  <strong>
                    {formatWeight(previousMetrics.maxWeight)} кг ·{" "}
                    {previousMetrics.reps} повт.
                  </strong>
                  <small>{previousMetrics.sets} подхода</small>
                </>
              ) : (
                <>
                  <strong>Нет данных</strong>
                  <small>Это первое выполнение</small>
                </>
              )}
            </article>
          </div>

          <section className="sets-section">
            <div className="section-title-row">
              <h3>Подходы</h3>
              <SyncBadge status={syncStatus} />
            </div>
            {exercise.sets.length === 0 ? (
              <div className="sets-empty">
                Первый подход займёт несколько секунд
              </div>
            ) : (
              <div className="set-list">
                {exercise.sets.map((set, index) => (
                  <article className="set-row" key={set.id}>
                    <span className="set-number">{index + 1}</span>
                    <strong>{formatWeight(set.weight)} кг</strong>
                    <span aria-hidden="true">×</span>
                    <strong>{set.reps}</strong>
                    <span className="set-unit">повт.</span>
                    <button
                      className="icon-text-button danger-text"
                      onClick={() => removeSet(set.id)}
                      aria-label={`Удалить подход ${index + 1}`}
                    >
                      ×
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="set-composer">
            <div className="input-row">
              <label>
                <span>Вес</span>
                <span className="number-input">
                  <input
                    value={draftWeight}
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="0.5"
                    onChange={(event) => setDraftWeight(event.target.value)}
                  />
                  <i>кг</i>
                </span>
              </label>
              <span className="multiply" aria-hidden="true">
                ×
              </span>
              <label>
                <span>Повторы</span>
                <span className="number-input">
                  <input
                    value={draftReps}
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min="0"
                    onChange={(event) => setDraftReps(event.target.value)}
                  />
                  <i>раз</i>
                </span>
              </label>
            </div>
            <div>
              <span className="field-label">Изменить вес, кг</span>
              <div className="quick-grid">
                {[-5, -2.5, 2.5, 5].map((delta) => (
                  <button
                    key={delta}
                    onClick={() =>
                      setDraftWeight((current) => {
                        const parsed = Number(current.replace(",", "."));
                        const weight = Number.isFinite(parsed) ? parsed : 0;
                        return String(
                          Math.max(
                            0.5,
                            Math.round((weight + delta) * 2) / 2,
                          ),
                        );
                      })
                    }
                  >
                    {delta > 0 ? "+" : "−"}
                    {formatWeight(Math.abs(delta))}
                  </button>
                ))}
              </div>
            </div>
            <button className="primary-button" onClick={() => addSet()}>
              <span>Добавить подход</span>
              <span aria-hidden="true">+</span>
            </button>
            <button
              className="secondary-button"
              disabled={!exercise.sets.length && !previous?.sets.length}
              onClick={() => {
                const copied = exercise.sets.at(-1) ?? previous?.sets.at(-1);
                if (copied) addSet(copied.weight, copied.reps);
              }}
            >
              <span aria-hidden="true">□</span>
              Повторить прошлый подход
            </button>
          </section>

          <button
            className={`completion-toggle ${exercise.completed ? "done" : ""}`}
            onClick={toggleExerciseDone}
            aria-pressed={exercise.completed}
          >
            <span>{exercise.completed ? "✓" : ""}</span>
            {exercise.completed
              ? "Упражнение выполнено"
              : "Отметить упражнение выполненным"}
          </button>
        </main>

        <div className="sticky-workout-action">
          <button className="primary-button" onClick={goNext}>
            {workoutIndex === session.exercises.length - 1
              ? "Завершить тренировку"
              : "Следующее упражнение"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
        {overlay && renderOverlay()}
        {notice && <div className="toast">{notice}</div>}
      </div>
    );
  }

  if (summary) {
    const completedExercises = summary.exercises.filter(
      (exercise) => exercise.completed,
    );
    const totalSets = summary.exercises.reduce(
      (count, exercise) => count + exercise.sets.length,
      0,
    );
    const duration = Math.max(
      1,
      Math.round(
        (new Date(summary.completedAt ?? summary.startedAt).getTime() -
          new Date(summary.startedAt).getTime()) /
          60000,
      ),
    );
    return (
      <div className="app-shell summary-shell">
        <main>
          <div className="success-mark" aria-hidden="true">
            ✓
          </div>
          <span className="eyebrow">Тренировка сохранена</span>
          <h1>Отличная работа</h1>
          <p className="summary-date">{formatDate(summary.startedAt, true)}</p>
          <section className="summary-hero">
            <div>
              <span>Выполнено</span>
              <strong>
                {completedExercises.length} из {summary.exercises.length}
              </strong>
              <small>упражнений</small>
            </div>
            <div
              className="large-progress-ring"
              style={
                {
                  "--progress": `${(completedExercises.length / Math.max(1, summary.exercises.length)) * 360}deg`,
                } as React.CSSProperties
              }
            >
              <b>{completedExercises.length}</b>
            </div>
          </section>
          <div className="summary-grid">
            <article className="soft-card blue">
              <MetricIcon tone="blue">#</MetricIcon>
              <span>Подходов</span>
              <strong>{totalSets}</strong>
            </article>
            <article className="soft-card violet">
              <MetricIcon tone="violet">◷</MetricIcon>
              <span>Длительность</span>
              <strong>{duration} мин</strong>
            </article>
          </div>
          <section className="card">
            <div className="section-title-row">
              <h2>Результаты</h2>
              <span className="record-badge">Новые данные</span>
            </div>
            {summary.exercises.map((exercise) => {
              const metrics = exerciseMetrics(exercise.sets);
              return (
                <div className="result-row" key={exercise.id}>
                  <span
                    className={`exercise-avatar small ${categoryClass(exercise.category)}`}
                  >
                    {categoryMark(exercise.category)}
                  </span>
                  <div>
                    <strong>{exercise.name}</strong>
                    <small>
                      {metrics.sets} подх. · {metrics.reps} повт.
                    </small>
                  </div>
                  <div className="result-value">
                    <strong>{formatWeight(metrics.maxWeight)} кг</strong>
                    <small>{Math.round(metrics.volume)} кг объём</small>
                  </div>
                </div>
              );
            })}
          </section>
          <button
            className="primary-button"
            onClick={() => {
              setSummary(null);
              setView("home");
            }}
          >
            Готово
          </button>
        </main>
      </div>
    );
  }

  function renderHome() {
    const lastWeight = state.bodyWeights[0]?.weight;
    const firstWeight = state.bodyWeights.at(-1)?.weight;
    return (
      <>
        <header className="home-header">
          <div className="avatar">{state.profile.name.slice(0, 1)}</div>
          <div>
            <span>Доброе утро</span>
            <h1>{state.profile.name}</h1>
          </div>
          <button
            className="round-button"
            onClick={() => setView("profile")}
            aria-label="Открыть профиль"
          >
            ≡
          </button>
        </header>
        <section className="hero-card">
          <span>{state.activeSession ? "Продолжить" : "Сегодня"}</span>
          <h2>{state.activeSession?.name ?? activeTemplate?.name ?? "Тренировка"}</h2>
          <p>
            {state.activeSession
              ? `${state.activeSession.exercises.filter((item) => item.completed).length} из ${state.activeSession.exercises.length} выполнено`
              : `${activeTemplate?.exercises.length ?? 0} упражнений · около 60 мин`}
          </p>
          <div className="hero-mark" aria-hidden="true">
            Ж
          </div>
          <button
            className="hero-action"
            onClick={() =>
              state.activeSession
                ? beginWorkout(state.activeSession.templateId)
                : setOverlay({ type: "templates" })
            }
          >
            {state.activeSession ? "Продолжить тренировку" : "Начать тренировку"}
            <span aria-hidden="true">→</span>
          </button>
        </section>

        <div className="dashboard-grid">
          <article className="metric-card blue-card">
            <div>
              <span>Тренировок за неделю</span>
              <strong>{weekSessions.length}</strong>
            </div>
            <div
              className="small-ring"
              style={
                {
                  "--progress": `${Math.min(weekSessions.length / 3, 1) * 360}deg`,
                } as React.CSSProperties
              }
            >
              <b>{weekSessions.length} из 3</b>
            </div>
          </article>
          <article className="metric-card violet-card">
            <span>Изменение массы</span>
            <strong>
              {lastWeight && firstWeight
                ? `${lastWeight - firstWeight > 0 ? "+" : "−"}${formatWeight(Math.abs(lastWeight - firstWeight))} кг`
                : "Нет данных"}
            </strong>
            <div className="sparkline" aria-hidden="true">
              {state.bodyWeights
                .slice(0, 5)
                .reverse()
                .map((item, index) => (
                  <i
                    key={item.id}
                    style={{ height: `${28 + ((item.weight + index) % 4) * 9}px` }}
                  />
                ))}
            </div>
          </article>
        </div>

        <section className="list-section">
          <div className="section-title-row">
            <h2>Последние тренировки</h2>
            <button
              className="text-button"
              onClick={() => setView("progress")}
            >
              Все
            </button>
          </div>
          {state.sessions.length ? (
            <div className="list-card">
              {state.sessions.slice(0, 3).map((session) => (
                <button
                  className="workout-list-row"
                  key={session.id}
                  onClick={() => setOverlay({ type: "history", session })}
                >
                  <span
                    className={`exercise-avatar small ${categoryClass(session.exercises[0]?.category ?? "")}`}
                  >
                    {categoryMark(session.exercises[0]?.category ?? "")}
                  </span>
                  <span>
                    <strong>{session.name}</strong>
                    <small>
                      {formatDate(session.completedAt ?? session.startedAt)} ·{" "}
                      {session.exercises.length} упражнений
                    </small>
                  </span>
                  <span className="chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Пока нет тренировок"
              text="Первая завершённая тренировка появится здесь."
            />
          )}
        </section>
      </>
    );
  }

  function renderPrograms() {
    return (
      <>
        <header className="page-header">
          <div>
            <span className="eyebrow">План тренировок</span>
            <h1>Программы</h1>
          </div>
          <button
            className="round-button accent"
            aria-label="Добавить программу"
            onClick={() => {
              const name = window.prompt("Название программы");
              if (!name?.trim()) return;
              setState((current) => ({
                ...current,
                programs: [
                  ...current.programs,
                  {
                    id: makeId("program"),
                    name: name.trim(),
                    active: false,
                    templates: [],
                  },
                ],
              }));
            }}
          >
            +
          </button>
        </header>
        {state.programs.map((program) => (
          <section className="program-card" key={program.id}>
            <div className="program-heading">
              <div>
                <span>{program.active ? "Активная программа" : "Программа"}</span>
                <h2>{program.name}</h2>
              </div>
              {!program.active && (
                <button
                  className="chip-button"
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      programs: current.programs.map((item) => ({
                        ...item,
                        active: item.id === program.id,
                      })),
                    }))
                  }
                >
                  Сделать активной
                </button>
              )}
            </div>
            {!program.templates.length && (
              <div className="program-empty-state">
                <strong>Шаблонов пока нет</strong>
                <span>Создайте шаблон и добавьте упражнения.</span>
              </div>
            )}
            {program.templates.map((template) => (
              <article className="template-card" key={template.id}>
                <div className="template-heading">
                  <div className="template-title">
                    <label className="template-day-field">
                      <span>День недели</span>
                      <select
                        aria-label={`День недели для шаблона «${template.name}»`}
                        value={template.day ?? ""}
                        onChange={(event) =>
                          updateTemplateDay(template.id, event.target.value)
                        }
                      >
                        <option value="">Без дня</option>
                        {WEEKDAYS.map((day) => (
                          <option key={day} value={day}>
                            {day}
                          </option>
                        ))}
                      </select>
                    </label>
                    <h3>{template.name}</h3>
                  </div>
                  <span className="count-badge">
                    {template.exercises.length} упр.
                  </span>
                </div>
                <div className="exercise-editor-list">
                  {template.exercises.map((item, index) => {
                    const exercise = getExercise(state, item.exerciseId);
                    return (
                      <div
                        className="exercise-editor-row"
                        key={item.id}
                        draggable
                        data-template={template.id}
                        data-index={index}
                        onDragStart={() => {
                          touchDrag.current = {
                            templateId: template.id,
                            index,
                          };
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          const dragging = touchDrag.current;
                          if (dragging?.templateId === template.id) {
                            reorderExercise(template.id, dragging.index, index);
                          }
                          touchDrag.current = null;
                        }}
                        onTouchStart={() => {
                          touchDrag.current = {
                            templateId: template.id,
                            index,
                          };
                        }}
                        onTouchMove={(event) => {
                          const touch = event.touches[0];
                          const target = document
                            .elementFromPoint(touch.clientX, touch.clientY)
                            ?.closest<HTMLElement>("[data-template][data-index]");
                          const dragging = touchDrag.current;
                          if (
                            target?.dataset.template === template.id &&
                            dragging?.templateId === template.id
                          ) {
                            const targetIndex = Number(target.dataset.index);
                            if (targetIndex !== dragging.index) {
                              reorderExercise(
                                template.id,
                                dragging.index,
                                targetIndex,
                              );
                              touchDrag.current = {
                                templateId: template.id,
                                index: targetIndex,
                              };
                            }
                          }
                        }}
                        onTouchEnd={() => {
                          touchDrag.current = null;
                        }}
                      >
                        <span className="drag-handle" aria-hidden="true">
                          ≡
                        </span>
                        <span
                          className={`exercise-avatar tiny ${categoryClass(exercise?.category ?? "")}`}
                        >
                          {categoryMark(exercise?.category ?? "")}
                        </span>
                        <span>
                          <strong>{exercise?.name ?? "Упражнение"}</strong>
                          <small>
                            {item.goal
                              ? `${formatWeight(item.goal.weight)} кг · ${item.goal.sets} × ${item.goal.reps}`
                              : "Цель не задана"}
                          </small>
                        </span>
                        <span className="move-actions">
                          <button
                            aria-label="Переместить выше"
                            disabled={index === 0}
                            onClick={() =>
                              reorderExercise(template.id, index, index - 1)
                            }
                          >
                            ↑
                          </button>
                          <button
                            aria-label="Переместить ниже"
                            disabled={index === template.exercises.length - 1}
                            onClick={() =>
                              reorderExercise(template.id, index, index + 1)
                            }
                          >
                            ↓
                          </button>
                          <button
                            className="delete-exercise-button"
                            aria-label={`Удалить упражнение «${exercise?.name ?? "Упражнение"}» из шаблона`}
                            onClick={() =>
                              deleteTemplateExercise(
                                template.id,
                                item.id,
                                exercise?.name ?? "Упражнение",
                              )
                            }
                          >
                            ×
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button
                  className="secondary-button compact"
                  onClick={() => {
                    const name = window.prompt("Название упражнения");
                    if (!name?.trim()) return;
                    const exerciseId = makeId("exercise");
                    setState((current) => ({
                      ...current,
                      exercises: [
                        ...current.exercises,
                        {
                          id: exerciseId,
                          name: name.trim(),
                          category: "Универсальное",
                        },
                      ],
                      programs: current.programs.map((itemProgram) => ({
                        ...itemProgram,
                        templates: itemProgram.templates.map((itemTemplate) =>
                          itemTemplate.id === template.id
                            ? {
                                ...itemTemplate,
                                exercises: [
                                  ...itemTemplate.exercises,
                                  {
                                    id: makeId("te"),
                                    exerciseId,
                                  },
                                ],
                              }
                            : itemTemplate,
                        ),
                      })),
                    }));
                  }}
                >
                  + Добавить упражнение
                </button>
                <button
                  className="template-delete-action"
                  aria-label={`Удалить шаблон «${template.name}»`}
                  onClick={() =>
                    deleteTemplate(program.id, template.id, template.name)
                  }
                >
                  <span aria-hidden="true">×</span>
                  Удалить шаблон
                </button>
              </article>
            ))}
            <button
              className="secondary-button"
              onClick={() => {
                const name = window.prompt("Название шаблона");
                if (!name?.trim()) return;
                setState((current) => ({
                  ...current,
                  programs: current.programs.map((item) =>
                    item.id === program.id
                      ? {
                          ...item,
                          templates: [
                            ...item.templates,
                            {
                              id: makeId("template"),
                              name: name.trim(),
                              exercises: [],
                            },
                          ],
                        }
                      : item,
                  ),
                }));
              }}
            >
              + Новый шаблон
            </button>
          </section>
        ))}
      </>
    );
  }

  function renderProgress() {
    const programExerciseIds = new Set(
      exerciseIdsFromPrograms(state.programs),
    );
    const progressExercises = state.exercises.filter(
      (item) => !item.archived && programExerciseIds.has(item.id),
    );
    const progressExerciseId = progressExercises.some(
      (item) => item.id === selectedExercise,
    )
      ? selectedExercise
      : (progressExercises[0]?.id ?? "");
    const exercise = state.exercises.find(
      (item) => item.id === progressExerciseId,
    );
    const days = period === "7" ? 7 : period === "30" ? 30 : Infinity;
    const points = state.sessions
      .filter(
        (session) =>
          referenceNow -
            new Date(session.completedAt ?? session.startedAt).getTime() <=
          days * 86400000,
      )
      .flatMap((session) =>
        session.exercises
          .filter((item) => item.exerciseId === progressExerciseId)
          .map((item) => ({
            date: session.completedAt ?? session.startedAt,
            metrics: exerciseMetrics(item.sets),
          })),
      )
      .sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
    const records = personalRecords(state.sessions, progressExerciseId);
    const currentWeight = state.bodyWeights[0];
    const cardioMinutes = state.cardio
      .filter(
        (entry) =>
          referenceNow - new Date(entry.date).getTime() < 30 * 86400000,
      )
      .reduce((sum, entry) => sum + entry.minutes, 0);
    return (
      <>
        <header className="page-header">
          <div>
            <span className="eyebrow">Ваши результаты</span>
            <h1>Прогресс</h1>
          </div>
        </header>
        {progressExercises.length ? (
          <>
            <label className="select-field">
              <span>Упражнение из программы</span>
              <select
                value={progressExerciseId}
                onChange={(event) => setSelectedExercise(event.target.value)}
              >
                {progressExercises.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="segmented period-switch">
              {[
                ["7", "7 дней"],
                ["30", "30 дней"],
                ["all", "Всё время"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={period === value ? "active" : ""}
                  onClick={() => setPeriod(value as typeof period)}
                >
                  {label}
                </button>
              ))}
            </div>

            {points.length ? (
              <>
            <div className="summary-grid">
              <article className="soft-card blue">
                <MetricIcon tone="blue">↑</MetricIcon>
                <span>Макс. вес</span>
                <strong>{formatWeight(records.maxWeight)} кг</strong>
              </article>
              <article className="soft-card yellow">
                <MetricIcon tone="yellow">#</MetricIcon>
                <span>Макс. повторов</span>
                <strong>{records.maxReps}</strong>
              </article>
            </div>
            <article className="chart-card">
              <div className="chart-heading">
                <div>
                  <span>Максимальный рабочий вес</span>
                  <strong>
                    {formatWeight(points.at(-1)?.metrics.maxWeight ?? 0)} кг
                  </strong>
                </div>
                <span className="data-dot blue" />
              </div>
              <Chart
                values={points.map((item) => item.metrics.maxWeight)}
                color="#279af1"
                label={`Динамика веса для упражнения ${exercise?.name ?? ""}`}
              />
              <p className="chart-summary">
                За период: от{" "}
                {formatWeight(points[0]?.metrics.maxWeight ?? 0)} до{" "}
                {formatWeight(points.at(-1)?.metrics.maxWeight ?? 0)} кг.
              </p>
            </article>
            <article className="chart-card">
              <div className="chart-heading">
                <div>
                  <span>Повторения за тренировку</span>
                  <strong>{points.at(-1)?.metrics.reps ?? 0}</strong>
                </div>
                <span className="data-dot yellow" />
              </div>
              <Chart
                values={points.map((item) => item.metrics.reps)}
                color="#ffd92f"
                kind="bars"
                label={`Повторения для упражнения ${exercise?.name ?? ""}`}
              />
            </article>
            <article className="chart-card">
              <div className="chart-heading">
                <div>
                  <span>Общий объём</span>
                  <strong>
                    {Math.round(points.at(-1)?.metrics.volume ?? 0)} кг
                  </strong>
                </div>
                <span className="data-dot violet" />
              </div>
              <Chart
                values={points.map((item) => item.metrics.volume)}
                color="#7865e8"
                label={`Объём для упражнения ${exercise?.name ?? ""}`}
              />
            </article>
              </>
            ) : (
              <EmptyState
                title="Пока недостаточно данных"
                text={`Завершите тренировку с упражнением «${exercise?.name ?? "Упражнение"}», чтобы увидеть динамику.`}
                action={
                  <button
                    className="secondary-button compact"
                    onClick={() => setOverlay({ type: "templates" })}
                  >
                    Начать тренировку
                  </button>
                }
              />
            )}
          </>
        ) : (
          <EmptyState
            title="В программах пока нет упражнений"
            text="Добавьте упражнение в шаблон программы — после этого оно появится в выборе статистики."
            action={
              <button
                className="secondary-button compact"
                onClick={() => setView("programs")}
              >
                Открыть программы
              </button>
            }
          />
        )}

        <section className="card health-card">
          <div className="section-title-row">
            <h2>Масса тела</h2>
            <button
              className="text-button"
              onClick={() => setOverlay({ type: "add-weight" })}
            >
              Добавить
            </button>
          </div>
          {currentWeight ? (
            <>
              <strong className="health-value">
                {formatWeight(currentWeight.weight)} кг
              </strong>
              <Chart
                values={state.bodyWeights
                  .slice(0, 8)
                  .reverse()
                  .map((entry) => entry.weight)}
                color="#279af1"
                label="Динамика массы тела"
              />
            </>
          ) : (
            <p>Записей пока нет.</p>
          )}
        </section>

        <section className="card health-card">
          <div className="section-title-row">
            <h2>Кардио</h2>
            <button
              className="text-button"
              onClick={() => setOverlay({ type: "add-cardio" })}
            >
              Добавить
            </button>
          </div>
          <strong className="health-value">{cardioMinutes} мин</strong>
          <p>за последние 30 дней</p>
          <div className="compact-history">
            {state.cardio.slice(0, 3).map((entry) => (
              <div key={entry.id}>
                <MetricIcon tone="cyan">◷</MetricIcon>
                <span>
                  <strong>{entry.activity}</strong>
                  <small>{formatDate(entry.date)}</small>
                </span>
                <strong>
                  {entry.minutes} мин
                  {entry.distance ? ` · ${formatWeight(entry.distance)} км` : ""}
                </strong>
              </div>
            ))}
          </div>
        </section>
      </>
    );
  }

  function renderProfile() {
    return (
      <>
        <header className="page-header">
          <div>
            <span className="eyebrow">Личные данные</span>
            <h1>Профиль</h1>
          </div>
          <div className="avatar large">{state.profile.name.slice(0, 1)}</div>
        </header>
        <section className="profile-card">
          <div className="profile-line">
            <span>Имя</span>
            <strong>{state.profile.name}</strong>
          </div>
          <div className="profile-line">
            <span>Хранение</span>
            <strong>
              {viewer.authenticated
                ? "Телефон + резервная копия"
                : "Только этот телефон"}
            </strong>
          </div>
          <div className="profile-line">
            <span>Единицы</span>
            <strong>кг · км</strong>
          </div>
        </section>
        {viewer.authenticated ? (
          <section className="card sync-card">
            <span className="status-check">✓</span>
            <div>
              <h2>Резервная копия включена</h2>
              <p>
                Данные привязаны к {state.profile.email} и доступны после
                входа на другом устройстве.
              </p>
            </div>
          </section>
        ) : (
          <section className="card sync-promo-card">
            <MetricIcon tone="blue">↻</MetricIcon>
            <h2>Сохранить резервную копию</h2>
            <p>
              Необязательно. Войдите через ChatGPT, чтобы восстановить дневник
              на другом устройстве. Текущие данные перенесутся автоматически.
            </p>
            <a
              className="secondary-button"
              href="/signin-with-chatgpt?return_to=/"
            >
              Войти через ChatGPT
            </a>
          </section>
        )}
        <section className="card install-card">
          <MetricIcon tone="yellow">↗</MetricIcon>
          <h2>Добавить на экран «Домой»</h2>
          <ol>
            <li>Откройте приложение в Safari на iPhone.</li>
            <li>Нажмите «Поделиться» в нижней панели.</li>
            <li>Выберите «На экран “Домой”» и подтвердите.</li>
          </ol>
        </section>
        <section className="card">
          <h2>Надёжность данных</h2>
          <div className="status-list">
            <div>
              <span className="status-check">✓</span>
              <span>
                <strong>Автосохранение включено</strong>
                <small>Каждый подход сохраняется на устройстве сразу.</small>
              </span>
            </div>
            <div>
              <span className="status-check">✓</span>
              <span>
                <strong>Офлайн-режим готов</strong>
                <small>Изменения отправятся после восстановления сети.</small>
              </span>
            </div>
          </div>
        </section>
        {viewer.authenticated && (
          <a className="danger-button" href="/signout-with-chatgpt?return_to=/">
            Выйти из аккаунта
          </a>
        )}
      </>
    );
  }

  function renderOverlay() {
    if (!overlay) return null;
    if (overlay.type === "confirm") {
      return (
        <div className="modal-backdrop" role="presentation">
          <section className="bottom-sheet" role="dialog" aria-modal="true">
            <span className="sheet-handle" />
            <h2>{overlay.title}</h2>
            <p>{overlay.text}</p>
            <button
              className={overlay.danger ? "danger-button" : "primary-button"}
              onClick={overlay.action}
            >
              {overlay.confirmLabel ?? "Продолжить"}
            </button>
            <button
              className="secondary-button"
              onClick={() => setOverlay(null)}
            >
              Отмена
            </button>
          </section>
        </div>
      );
    }
    if (overlay.type === "templates") {
      const templates = state.programs.flatMap((program) => program.templates);
      return (
        <div className="modal-backdrop" role="presentation">
          <section
            className="bottom-sheet tall-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Выбор тренировки"
          >
            <span className="sheet-handle" />
            <div className="section-title-row">
              <div>
                <span className="eyebrow">Активная программа</span>
                <h2>Выберите тренировку</h2>
              </div>
              <button
                className="round-button"
                onClick={() => setOverlay(null)}
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>
            <div className="template-choice-list">
              {templates.map((template, index) => (
                <button
                  key={template.id}
                  className={index === 0 ? "selected" : ""}
                  onClick={() => beginWorkout(template.id)}
                >
                  <span
                    className={`exercise-avatar ${index === 0 ? "coral" : index === 1 ? "yellow" : "blue"}`}
                  >
                    {index + 1}
                  </span>
                  <span>
                    <strong>{template.name}</strong>
                    <small>
                      {template.day ?? "В любой день"} ·{" "}
                      {template.exercises.length} упражнений
                    </small>
                  </span>
                  <span className="select-dot">{index === 0 ? "✓" : ""}</span>
                </button>
              ))}
            </div>
            <button
              className="secondary-button dashed"
              onClick={() => beginWorkout()}
            >
              + Начать без шаблона
            </button>
          </section>
        </div>
      );
    }
    if (overlay.type === "exercise-menu" && state.activeSession) {
      return (
        <div className="modal-backdrop" role="presentation">
          <section className="bottom-sheet" role="dialog" aria-modal="true">
            <span className="sheet-handle" />
            <h2>Упражнения тренировки</h2>
            <div className="exercise-menu-list">
              {state.activeSession.exercises.map((exercise, index) => (
                <button
                  key={exercise.id}
                  className={index === workoutIndex ? "current" : ""}
                  onClick={() => {
                    prepareDraft(exercise);
                    setWorkoutIndex(index);
                    setOverlay(null);
                  }}
                >
                  <span>{exercise.completed ? "✓" : index + 1}</span>
                  <strong>{exercise.name}</strong>
                  <small>{exercise.sets.length} подх.</small>
                </button>
              ))}
            </div>
            <button
              className="secondary-button"
              onClick={() => setOverlay(null)}
            >
              Закрыть
            </button>
          </section>
        </div>
      );
    }
    if (overlay.type === "history") {
      const session = overlay.session;
      return (
        <div className="modal-backdrop" role="presentation">
          <section
            className="bottom-sheet tall-sheet"
            role="dialog"
            aria-modal="true"
          >
            <span className="sheet-handle" />
            <div className="section-title-row">
              <div>
                <span className="eyebrow">
                  {formatDate(session.completedAt ?? session.startedAt, true)}
                </span>
                <h2>{session.name}</h2>
              </div>
              <button
                className="round-button"
                onClick={() => setOverlay(null)}
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>
            {session.exercises.map((exercise) => {
              const metrics = exerciseMetrics(exercise.sets);
              return (
                <article className="history-exercise" key={exercise.id}>
                  <div className="section-title-row">
                    <strong>{exercise.name}</strong>
                    <span>{formatWeight(metrics.maxWeight)} кг макс.</span>
                  </div>
                  {exercise.sets.map((set, index) => (
                    <div key={set.id}>
                      <span>Подход {index + 1}</span>
                      <strong>
                        {formatWeight(set.weight)} кг × {set.reps}
                      </strong>
                    </div>
                  ))}
                  <small>
                    {metrics.reps} повторов · {Math.round(metrics.volume)} кг
                    объём
                  </small>
                </article>
              );
            })}
            <button
              className="danger-button"
              onClick={() => deleteSession(session.id)}
            >
              Удалить тренировку
            </button>
          </section>
        </div>
      );
    }
    if (overlay.type === "add-weight") {
      return <WeightForm onSubmit={addBodyWeight} onClose={() => setOverlay(null)} />;
    }
    if (overlay.type === "add-cardio") {
      return <CardioForm onSubmit={addCardio} onClose={() => setOverlay(null)} />;
    }
    return null;
  }

  return (
    <div className="app-shell">
      <main className="main-content">
        {view === "home" && renderHome()}
        {view === "programs" && renderPrograms()}
        {view === "progress" && renderProgress()}
        {view === "profile" && renderProfile()}
      </main>
      <nav className="bottom-nav" aria-label="Основная навигация">
        {[
          ["home", "⌂", "Главная"],
          ["programs", "▣", "Программы"],
          ["progress", "▥", "Прогресс"],
          ["profile", "○", "Профиль"],
        ].map(([value, icon, label]) => (
          <button
            key={value}
            className={view === value ? "active" : ""}
            onClick={() => setView(value as MainView)}
            aria-current={view === value ? "page" : undefined}
          >
            <span aria-hidden="true">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
      {overlay && renderOverlay()}
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

function WeightForm({
  onSubmit,
  onClose,
}: {
  onSubmit: (weight: number, date: string) => void;
  onClose: () => void;
}) {
  const [weight, setWeight] = useState(80);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="bottom-sheet"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(weight, date);
        }}
      >
        <span className="sheet-handle" />
        <h2>Масса тела</h2>
        <label className="form-field">
          <span>Масса</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="1"
            max="500"
            value={weight}
            onChange={(event) => setWeight(Number(event.target.value))}
            required
          />
          <i>кг</i>
        </label>
        <label className="form-field">
          <span>Дата</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </label>
        <button className="primary-button" type="submit">
          Сохранить
        </button>
        <button className="secondary-button" type="button" onClick={onClose}>
          Отмена
        </button>
      </form>
    </div>
  );
}

function CardioForm({
  onSubmit,
  onClose,
}: {
  onSubmit: (entry: Omit<CardioEntry, "id">) => void;
  onClose: () => void;
}) {
  const [activity, setActivity] = useState("Беговая дорожка");
  const [minutes, setMinutes] = useState(20);
  const [distance, setDistance] = useState(3);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="bottom-sheet"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            activity,
            minutes,
            distance,
            date: new Date(date).toISOString(),
          });
        }}
      >
        <span className="sheet-handle" />
        <h2>Добавить кардио</h2>
        <label className="form-field">
          <span>Активность</span>
          <select
            value={activity}
            onChange={(event) => setActivity(event.target.value)}
          >
            <option>Беговая дорожка</option>
            <option>Велотренажёр</option>
            <option>Эллипс</option>
            <option>Ходьба</option>
          </select>
        </label>
        <div className="input-row">
          <label className="form-field">
            <span>Минуты</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </label>
          <label className="form-field">
            <span>Километры</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={distance}
              onChange={(event) => setDistance(Number(event.target.value))}
            />
          </label>
        </div>
        <label className="form-field">
          <span>Дата</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <button className="primary-button" type="submit">
          Сохранить
        </button>
        <button className="secondary-button" type="button" onClick={onClose}>
          Отмена
        </button>
      </form>
    </div>
  );
}
