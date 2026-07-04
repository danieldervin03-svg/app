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
  created_at: string;
};

export type Exercise = {
  id: string;
  name: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  notes: string;
};

export type Workout = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  exercises: Exercise[];
  created_at: string;
  performed_at: string | null;
};

export type Meal = {
  id: string;
  user_id: string;
  name: string;
  calories: number;
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
  hips_cm?: number | null;
  arm_cm?: number | null;
  thigh_cm?: number | null;
  note: string;
  created_at: string;
};

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
  ingredients: string[];
  description: string;
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

  // Meals
  listMeals: (date?: string) =>
    request<Meal[]>(`/meals${date ? `?date=${date}` : ""}`),
  createMeal: (body: { name: string; calories: number; meal_type: Meal["meal_type"]; date?: string }) =>
    request<Meal>("/meals", { method: "POST", body }),
  deleteMeal: (id: string) => request<{ ok: boolean }>(`/meals/${id}`, { method: "DELETE" }),
  suggestMeals: (body: {
    remaining_calories: number;
    meal_type: Meal["meal_type"];
    preferences?: string;
  }) => request<{ suggestions: MealSuggestion[] }>("/meals/suggest", { method: "POST", body }),

  // Measurements
  listMeasurements: () => request<Measurement[]>("/measurements"),
  createMeasurement: (body: Partial<Measurement>) =>
    request<Measurement>("/measurements", { method: "POST", body }),
  deleteMeasurement: (id: string) =>
    request<{ ok: boolean }>(`/measurements/${id}`, { method: "DELETE" }),

  // Summary
  summaryToday: () => request<TodaySummary>("/summary/today"),
};
