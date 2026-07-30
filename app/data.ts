export type WorkoutSet = {
  id: string;
  weight: number;
  reps: number;
  createdAt: string;
};

export type WorkoutExercise = {
  id: string;
  exerciseId: string;
  name: string;
  category: string;
  goal?: { weight: number; sets: number; reps: number };
  completed: boolean;
  sets: WorkoutSet[];
};

export type WorkoutSession = {
  id: string;
  templateId?: string;
  name: string;
  startedAt: string;
  completedAt?: string;
  status: "active" | "completed";
  exercises: WorkoutExercise[];
};

export type Exercise = {
  id: string;
  name: string;
  category: string;
  note?: string;
  archived?: boolean;
};

export type TemplateExercise = {
  id: string;
  exerciseId: string;
  goal?: { weight: number; sets: number; reps: number };
};

export type WorkoutTemplate = {
  id: string;
  name: string;
  day?: string;
  exercises: TemplateExercise[];
};

export type Program = {
  id: string;
  name: string;
  active: boolean;
  templates: WorkoutTemplate[];
};

export type BodyWeightEntry = { id: string; date: string; weight: number };
export type CardioEntry = {
  id: string;
  date: string;
  activity: string;
  minutes: number;
  distance?: number;
};

export type AppState = {
  version: number;
  profile: { name: string; email: string };
  exercises: Exercise[];
  programs: Program[];
  sessions: WorkoutSession[];
  activeSession: WorkoutSession | null;
  bodyWeights: BodyWeightEntry[];
  cardio: CardioEntry[];
  dismissedHints: string[];
};

const at = (daysAgo: number, hour = 18) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

const completedSession = (
  id: string,
  name: string,
  daysAgo: number,
  source: Array<{
    id: string;
    name: string;
    category: string;
    sets: Array<[number, number]>;
  }>,
): WorkoutSession => ({
  id,
  name,
  status: "completed",
  startedAt: at(daysAgo, 18),
  completedAt: at(daysAgo, 19),
  exercises: source.map((exercise) => ({
    id: `${id}-${exercise.id}`,
    exerciseId: exercise.id,
    name: exercise.name,
    category: exercise.category,
    completed: true,
    sets: exercise.sets.map(([weight, reps], index) => ({
      id: `${id}-${exercise.id}-${index}`,
      weight,
      reps,
      createdAt: at(daysAgo, 18),
    })),
  })),
});

export function createSeedState(
  name = "Дмитрий",
  email = "demo@local",
): AppState {
  const exercises: Exercise[] = [
    { id: "bench", name: "Жим штанги лёжа", category: "Грудь" },
    { id: "incline", name: "Жим гантелей на наклонной", category: "Грудь" },
    { id: "curls", name: "Сгибание рук с гантелями", category: "Руки" },
    { id: "squat", name: "Присед со штангой", category: "Ноги" },
    { id: "legpress", name: "Жим ногами", category: "Ноги" },
    { id: "pulldown", name: "Тяга верхнего блока", category: "Спина" },
    { id: "row", name: "Горизонтальная тяга", category: "Спина" },
  ];

  return {
    version: 1,
    profile: { name, email },
    exercises,
    programs: [
      {
        id: "main",
        name: "Основная программа",
        active: true,
        templates: [
          {
            id: "chest",
            name: "Грудь и бицепс",
            day: "Пятница",
            exercises: [
              {
                id: "te-bench",
                exerciseId: "bench",
                goal: { weight: 60, sets: 3, reps: 10 },
              },
              {
                id: "te-incline",
                exerciseId: "incline",
                goal: { weight: 22.5, sets: 3, reps: 10 },
              },
              {
                id: "te-curls",
                exerciseId: "curls",
                goal: { weight: 14, sets: 3, reps: 12 },
              },
            ],
          },
          {
            id: "legs",
            name: "Ноги",
            day: "Понедельник",
            exercises: [
              {
                id: "te-squat",
                exerciseId: "squat",
                goal: { weight: 80, sets: 3, reps: 8 },
              },
              {
                id: "te-legpress",
                exerciseId: "legpress",
                goal: { weight: 120, sets: 3, reps: 10 },
              },
            ],
          },
          {
            id: "back",
            name: "Спина и плечи",
            day: "Среда",
            exercises: [
              {
                id: "te-pulldown",
                exerciseId: "pulldown",
                goal: { weight: 55, sets: 3, reps: 10 },
              },
              {
                id: "te-row",
                exerciseId: "row",
                goal: { weight: 50, sets: 3, reps: 10 },
              },
            ],
          },
        ],
      },
    ],
    sessions: [
      completedSession("s1", "Грудь и бицепс", 4, [
        {
          id: "bench",
          name: "Жим штанги лёжа",
          category: "Грудь",
          sets: [
            [57.5, 10],
            [57.5, 10],
            [57.5, 9],
          ],
        },
        {
          id: "incline",
          name: "Жим гантелей на наклонной",
          category: "Грудь",
          sets: [
            [20, 10],
            [20, 10],
            [20, 9],
          ],
        },
      ]),
      completedSession("s2", "Спина и плечи", 11, [
        {
          id: "pulldown",
          name: "Тяга верхнего блока",
          category: "Спина",
          sets: [
            [52.5, 10],
            [52.5, 10],
            [52.5, 9],
          ],
        },
      ]),
      completedSession("s3", "Грудь и бицепс", 18, [
        {
          id: "bench",
          name: "Жим штанги лёжа",
          category: "Грудь",
          sets: [
            [55, 10],
            [55, 10],
            [55, 10],
          ],
        },
      ]),
      completedSession("s4", "Грудь и бицепс", 25, [
        {
          id: "bench",
          name: "Жим штанги лёжа",
          category: "Грудь",
          sets: [
            [52.5, 10],
            [52.5, 10],
            [52.5, 9],
          ],
        },
      ]),
    ],
    activeSession: null,
    bodyWeights: [
      { id: "w1", date: at(35), weight: 82.4 },
      { id: "w2", date: at(21), weight: 81.6 },
      { id: "w3", date: at(7), weight: 80.9 },
      { id: "w4", date: at(0), weight: 80.4 },
    ],
    cardio: [
      {
        id: "c1",
        date: at(3),
        activity: "Беговая дорожка",
        minutes: 24,
        distance: 3.2,
      },
      {
        id: "c2",
        date: at(10),
        activity: "Велотренажёр",
        minutes: 30,
        distance: 8.4,
      },
    ],
    dismissedHints: [],
  };
}

export function createStarterState(
  name: string,
  email = "local@device",
): AppState {
  const seed = createSeedState(name, email);
  return {
    ...seed,
    version: 2,
    sessions: [],
    activeSession: null,
    bodyWeights: [],
    cardio: [],
    dismissedHints: [],
  };
}

export const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const formatWeight = (value: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);

export const formatDate = (value: string, full = false) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: full ? "long" : "short",
    ...(full ? { year: "numeric" } : {}),
  }).format(new Date(value));
