import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;
const TOKEN_KEY = "bp_token";

export type ApiError = { message: string; status: number };

async function getToken(): Promise<string | null> {
  const t = await storage.secureGet<string>(TOKEN_KEY, "");
  return t && t.length > 0 ? t : null;
}

export async function setToken(token: string | null) {
  if (token) await storage.secureSet(TOKEN_KEY, token);
  else await storage.secureRemove(TOKEN_KEY);
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message =
      (data && (data.detail || data.message)) || `Erreur ${res.status}`;
    const err: ApiError = { message: String(message), status: res.status };
    throw err;
  }
  return data as T;
}

// ============ Types ============
export type User = {
  id: string;
  email: string;
  name: string;
  calorie_goal: number;
  calorie_goal_auto: boolean;
  calorie_last_adjust_at: string | null;
  calorie_last_adjust_reason: string | null;
  meals_per_day: number;
  sex: "homme" | "femme" | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  activity_level: "sédentaire" | "léger" | "modéré" | "actif" | "très actif" | null;
  fitness_goal: "prise de masse" | "sèche" | "maintien" | null;
  created_at: string;
};

export type ExerciseHistoryPoint = {
  performed_at: string;
  weight_kg: number | null;
  difficulty: "facile" | "reussi" | "echec" | null;
  reps_done: number | null;
};

export type CalorieRecommendation = {
  applicable: boolean;
  reason?: string;
  current_goal: number;
  suggested_goal: number;
  delta_kcal?: number;
  weekly_change_kg: number | null;
  span_days: number | null;
  status: string;
  should_adjust?: boolean;
  target_range_kg_per_week?: [number, number];
  last_adjusted_at: string | null;
};

export type ProfileInput = {
  sex: "homme" | "femme";
  age: number;
  height_cm: number;
  weight_kg: number;
  activity_level: "sédentaire" | "léger" | "modéré" | "actif" | "très actif";
  fitness_goal: "prise de masse" | "sèche" | "maintien";
};

export type Exercise = {
  id: string;
  name: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  notes: string;
  target_weight_kg?: number | null;
  last_difficulty?: "facile" | "reussi" | "echec" | null;
  last_weight_kg?: number | null;
  last_reps_done?: number | null;
};

export type Workout = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  exercises: Exercise[];
  created_at: string;
  performed_at: string | null;
  program_id?: string | null;
  program_type?: "full_body" | "split" | null;
  sessions_per_week?: number | null;
  week_day?: string | null;
  session_index?: number | null;
};

export type LogEntry = {
  exercise_id: string;
  difficulty: "facile" | "reussi" | "echec";
  weight_kg?: number | null;
  reps_done?: number | null;
};

export type Meal = {
  id: string;
  user_id: string;
  name: string;
  calories: number;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  meal_type: "petit-déjeuner" | "déjeuner" | "dîner" | "collation";
  date: string;
  created_at: string;
};

export type Measurement = {
  id: string;
  user_id: string;
  weight_kg?: number | null;
  chest_cm?: number | null;
  waist_cm?: number | null;
  belly_cm?: number | null;
  hips_cm?: number | null;
  arm_cm?: number | null;
  thigh_cm?: number | null;
  note: string;
  created_at: string;
};

export type BodyField =
  | "weight_kg" | "chest_cm" | "waist_cm" | "belly_cm" | "hips_cm" | "arm_cm" | "thigh_cm";

export type LatestMeasurements = Record<BodyField, { value: number; created_at: string } | null>;

export type TodaySummary = {
  calorie_goal: number;
  calories_consumed: number;
  calories_remaining: number;
  meals_today: number;
  next_workout: Workout | null;
  workouts_done_this_week: number;
};

export type MealSuggestion = {
  name: string;
  calories: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  ingredients: string[];
  description: string;
};

export type MenuScanResult = {
  menu_lisible: boolean;
  plat_recommande: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  raison: string;
  autres_options: string[];
  remaining_calories: number;
};

export type HistoryStats = {
  total_completed: number;
  current_streak_weeks: number;
  best_streak_weeks: number;
  weekly: { week: string; count: number; label: string }[];
  recent: Workout[];
};

export type CoachMessage = {
  id: string;
  user_id: string;
  workout_id: string | null;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

// ============ Auth ============
export const api = {
  register: (body: { email: string; password: string; name: string }) =>
    request<{ token: string; user: User }>("/auth/register", { method: "POST", body, auth: false }),
  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: User }>("/auth/login", { method: "POST", body, auth: false }),
  me: () => request<User>("/auth/me"),
  updateCalorieGoal: (calorie_goal: number) =>
    request<User>("/user/calorie-goal", { method: "PUT", body: { calorie_goal } }),
  updateProfile: (body: ProfileInput) =>
    request<User>("/user/profile", { method: "PUT", body }),
  updateMealsPerDay: (meals_per_day: number) =>
    request<User>("/user/meals-per-day", { method: "PUT", body: { meals_per_day } }),
  calorieRecommendation: () =>
    request<CalorieRecommendation>("/user/calorie-recommendation"),
  applyCalorieRecommendation: () =>
    request<{ applied: boolean; new_goal?: number; delta_kcal?: number; reason: string; weekly_change_kg?: number }>(
      "/user/calorie-recommendation/apply",
      { method: "POST" },
    ),

  // Workouts
  listWorkouts: () => request<Workout[]>("/workouts"),
  getWorkout: (id: string) => request<Workout>(`/workouts/${id}`),
  createWorkout: (body: { title: string; description?: string; exercises?: Exercise[] }) =>
    request<Workout>("/workouts", { method: "POST", body }),
  updateWorkout: (id: string, body: Partial<Workout>) =>
    request<Workout>(`/workouts/${id}`, { method: "PUT", body }),
  deleteWorkout: (id: string) => request<{ ok: boolean }>(`/workouts/${id}`, { method: "DELETE" }),
  completeWorkout: (id: string) =>
    request<Workout>(`/workouts/${id}/complete`, { method: "POST" }),
  generateWorkout: (body: {
    goal: string;
    level: "débutant" | "intermédiaire" | "avancé";
    duration_minutes: number;
    equipment: string;
    focus?: string;
  }) => request<Workout>("/workouts/generate", { method: "POST", body }),
  generateProgram: (body: {
    goal: string;
    level: "débutant" | "intermédiaire" | "avancé";
    program_type: "full_body" | "split";
    sessions_per_week: number;
    duration_minutes: number;
    equipment: string;
  }) => request<Workout[]>("/workouts/generate-program", { method: "POST", body }),
  logSession: (id: string, entries: LogEntry[]) =>
    request<{ workout: Workout }>(`/workouts/${id}/log`, { method: "POST", body: { entries } }),

  // Meals
  listMeals: (date?: string) =>
    request<Meal[]>(`/meals${date ? `?date=${date}` : ""}`),
  createMeal: (body: {
    name: string;
    calories: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
    meal_type: Meal["meal_type"];
    date?: string;
  }) => request<Meal>("/meals", { method: "POST", body }),
  deleteMeal: (id: string) => request<{ ok: boolean }>(`/meals/${id}`, { method: "DELETE" }),
  suggestMeals: (body: {
    remaining_calories: number;
    meal_type: Meal["meal_type"];
    preferences?: string;
  }) => request<{ suggestions: MealSuggestion[] }>("/meals/suggest", { method: "POST", body }),
  estimateMeal: (description: string) =>
    request<{
      name: string;
      calories: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      meal_type: Meal["meal_type"];
      breakdown: string;
    }>("/meals/estimate", { method: "POST", body: { description } }),
  scanMenu: (image_base64: string, mime_type: string) =>
    request<MenuScanResult>("/meals/scan-menu", { method: "POST", body: { image_base64, mime_type } }),

  // Measurements
  listMeasurements: () => request<Measurement[]>("/measurements"),
  latestMeasurements: () => request<LatestMeasurements>("/measurements/latest"),
  createMeasurement: (body: Partial<Measurement>) =>
    request<Measurement>("/measurements", { method: "POST", body }),
  deleteMeasurement: (id: string) =>
    request<{ ok: boolean }>(`/measurements/${id}`, { method: "DELETE" }),

  // Summary
  summaryToday: () => request<TodaySummary>("/summary/today"),

  // History & Stats
  historyStats: () => request<HistoryStats>("/workouts/history/stats"),
  exerciseHistory: (name: string) =>
    request<{ exercise_name: string; points: ExerciseHistoryPoint[] }>(
      `/exercises/history?name=${encodeURIComponent(name)}`,
    ),

  // Coach
  coachMessages: (workoutId?: string) =>
    request<CoachMessage[]>(`/coach/messages${workoutId ? `?workout_id=${workoutId}` : ""}`),
  coachChat: (message: string, workoutId?: string) =>
    request<CoachMessage>("/coach/chat", {
      method: "POST",
      body: { message, workout_id: workoutId ?? null },
    }),
  coachClear: (workoutId?: string) =>
    request<{ ok: boolean }>(`/coach/messages${workoutId ? `?workout_id=${workoutId}` : ""}`, { method: "DELETE" }),
};
