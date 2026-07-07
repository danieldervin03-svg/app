"""Bodypilot backend – FastAPI + MongoDB + JWT auth + Emergent LLM."""

from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
from datetime import datetime, timezone, timedelta
from pathlib import Path
import os
import uuid
import json
import logging
import bcrypt
import jwt

from google import genai
from google.genai import types as genai_types

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ["JWT_ALGORITHM"]
JWT_EXPIRATION_HOURS = int(os.environ["JWT_EXPIRATION_HOURS"])
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
gemini_client = genai.Client(api_key=GEMINI_API_KEY)

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Bodypilot API")
api = APIRouter(prefix="/api")
security = HTTPBearer()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bodypilot")


# ============================================================================
# Models
# ============================================================================

def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


class RegisterInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1, max_length=80)


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    name: str
    calorie_goal: int = 2000
    calorie_goal_auto: bool = True
    calorie_last_adjust_at: Optional[str] = None
    calorie_last_adjust_reason: Optional[str] = None
    meals_per_day: int = 4
    sex: Optional[Literal["homme", "femme"]] = None
    age: Optional[int] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    activity_level: Optional[Literal["sédentaire", "léger", "modéré", "actif", "très actif"]] = None
    fitness_goal: Optional[Literal["prise de masse", "sèche", "maintien"]] = None
    created_at: str


class MealsPerDayUpdate(BaseModel):
    meals_per_day: int = Field(ge=2, le=8)


class ProfileUpdate(BaseModel):
    sex: Literal["homme", "femme"]
    age: int = Field(ge=10, le=100)
    height_cm: float = Field(ge=120, le=230)
    weight_kg: float = Field(ge=30, le=250)
    activity_level: Literal["sédentaire", "léger", "modéré", "actif", "très actif"]
    fitness_goal: Literal["prise de masse", "sèche", "maintien"]


ACTIVITY_FACTORS = {
    "sédentaire": 1.2,
    "léger": 1.375,
    "modéré": 1.55,
    "actif": 1.725,
    "très actif": 1.9,
}

GOAL_ADJUSTMENTS = {
    "prise de masse": 400,
    "sèche": -400,
    "maintien": 0,
}


def compute_calorie_goal(sex: str, age: int, height_cm: float, weight_kg: float, activity_level: str, goal: str) -> int:
    """Mifflin-St Jeor BMR × activity factor + goal adjustment."""
    if sex == "homme":
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
    else:
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age - 161
    tdee = bmr * ACTIVITY_FACTORS.get(activity_level, 1.375)
    total = tdee + GOAL_ADJUSTMENTS.get(goal, 0)
    return max(1000, int(round(total / 10) * 10))


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


class Exercise(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    sets: int = 3
    reps: str = "10"
    rest_seconds: int = 60
    notes: str = ""
    # Progressive overload targets
    target_weight_kg: Optional[float] = None
    last_difficulty: Optional[Literal["facile", "reussi", "echec"]] = None
    last_weight_kg: Optional[float] = None
    last_reps_done: Optional[int] = None


class Workout(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id: str
    title: str
    description: str = ""
    exercises: List[Exercise] = []
    created_at: str = Field(default_factory=now_utc)
    performed_at: Optional[str] = None
    # Program grouping
    program_id: Optional[str] = None
    program_type: Optional[Literal["full_body", "split"]] = None
    sessions_per_week: Optional[int] = None
    week_day: Optional[str] = None  # "lundi", "mardi", ... for splits
    session_index: Optional[int] = None  # 1..N in the weekly plan


class WorkoutCreate(BaseModel):
    title: str
    description: str = ""
    exercises: List[Exercise] = []


class WorkoutUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    exercises: Optional[List[Exercise]] = None
    performed_at: Optional[str] = None


class WorkoutGenerateInput(BaseModel):
    goal: str
    level: Literal["débutant", "intermédiaire", "avancé"] = "intermédiaire"
    duration_minutes: int = 45
    equipment: str = "salle de sport"
    focus: str = ""


class ProgramGenerateInput(BaseModel):
    goal: str
    level: Literal["débutant", "intermédiaire", "avancé"] = "intermédiaire"
    program_type: Literal["full_body", "split"] = "full_body"
    sessions_per_week: int = Field(ge=2, le=6, default=3)
    duration_minutes: int = 45
    equipment: str = "salle de sport"


class LogEntry(BaseModel):
    exercise_id: str
    difficulty: Literal["facile", "reussi", "echec"]
    weight_kg: Optional[float] = None
    reps_done: Optional[int] = None


class SessionLogInput(BaseModel):
    entries: List[LogEntry]


class Meal(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id: str
    name: str
    calories: int
    meal_type: Literal["petit-déjeuner", "déjeuner", "dîner", "collation"]
    date: str  # YYYY-MM-DD
    created_at: str = Field(default_factory=now_utc)


class MealCreate(BaseModel):
    name: str
    calories: int = Field(ge=0, le=5000)
    meal_type: Literal["petit-déjeuner", "déjeuner", "dîner", "collation"]
    date: Optional[str] = None


class MealSuggestInput(BaseModel):
    remaining_calories: int
    meal_type: Literal["petit-déjeuner", "déjeuner", "dîner", "collation"]
    preferences: str = ""


class MealEstimateInput(BaseModel):
    description: str = Field(min_length=2, max_length=500)


class Measurement(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id: str
    weight_kg: Optional[float] = None
    chest_cm: Optional[float] = None
    waist_cm: Optional[float] = None
    belly_cm: Optional[float] = None
    hips_cm: Optional[float] = None
    arm_cm: Optional[float] = None
    thigh_cm: Optional[float] = None
    note: str = ""
    created_at: str = Field(default_factory=now_utc)


class MeasurementCreate(BaseModel):
    weight_kg: Optional[float] = None
    chest_cm: Optional[float] = None
    waist_cm: Optional[float] = None
    belly_cm: Optional[float] = None
    hips_cm: Optional[float] = None
    arm_cm: Optional[float] = None
    thigh_cm: Optional[float] = None
    note: str = ""


class CalorieGoalUpdate(BaseModel):
    calorie_goal: int = Field(ge=800, le=8000)


# ============================================================================
# Auth helpers
# ============================================================================

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(401, "Token invalide")
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expiré")
    except jwt.PyJWTError:
        raise HTTPException(401, "Token invalide")

    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "Utilisateur introuvable")
    return user


def public_user(u: dict) -> UserPublic:
    return UserPublic(
        id=u["id"],
        email=u["email"],
        name=u["name"],
        calorie_goal=u.get("calorie_goal", 2000),
        calorie_goal_auto=u.get("calorie_goal_auto", True),
        calorie_last_adjust_at=u.get("calorie_last_adjust_at"),
        calorie_last_adjust_reason=u.get("calorie_last_adjust_reason"),
        meals_per_day=u.get("meals_per_day", 4),
        sex=u.get("sex"),
        age=u.get("age"),
        height_cm=u.get("height_cm"),
        weight_kg=u.get("weight_kg"),
        activity_level=u.get("activity_level"),
        fitness_goal=u.get("fitness_goal"),
        created_at=u["created_at"],
    )


# ============================================================================
# Auth endpoints
# ============================================================================

@api.post("/auth/register", response_model=AuthResponse)
async def register(body: RegisterInput):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(400, "Un compte existe déjà avec cet email")
    user = {
        "id": new_id(),
        "email": body.email.lower(),
        "name": body.name.strip(),
        "password_hash": hash_password(body.password),
        "calorie_goal": 2000,
        "calorie_goal_auto": True,
        "meals_per_day": 4,
        "sex": None,
        "age": None,
        "height_cm": None,
        "weight_kg": None,
        "activity_level": None,
        "fitness_goal": None,
        "created_at": now_utc(),
    }
    await db.users.insert_one(user)
    token = create_token(user["id"])
    return AuthResponse(token=token, user=public_user(user))


@api.post("/auth/login", response_model=AuthResponse)
async def login(body: LoginInput):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Email ou mot de passe incorrect")
    token = create_token(user["id"])
    return AuthResponse(token=token, user=public_user(user))


@api.get("/auth/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    return public_user(user)


@api.put("/user/calorie-goal", response_model=UserPublic)
async def update_calorie_goal(body: CalorieGoalUpdate, user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"calorie_goal": body.calorie_goal, "calorie_goal_auto": False}},
    )
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return public_user(updated)


@api.put("/user/meals-per-day", response_model=UserPublic)
async def update_meals_per_day(body: MealsPerDayUpdate, user: dict = Depends(get_current_user)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"meals_per_day": body.meals_per_day}})
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return public_user(updated)


@api.put("/user/profile", response_model=UserPublic)
async def update_profile(body: ProfileUpdate, user: dict = Depends(get_current_user)):
    """Update health profile and auto-recompute daily calorie goal (unless previously overridden manually)."""
    computed = compute_calorie_goal(
        body.sex, body.age, body.height_cm, body.weight_kg, body.activity_level, body.fitness_goal
    )
    updates = {
        "sex": body.sex,
        "age": body.age,
        "height_cm": body.height_cm,
        "weight_kg": body.weight_kg,
        "activity_level": body.activity_level,
        "fitness_goal": body.fitness_goal,
    }
    # Always recompute when profile changes; user can still override afterwards via /calorie-goal
    updates["calorie_goal"] = computed
    updates["calorie_goal_auto"] = True
    updates["calorie_last_adjust_at"] = None
    updates["calorie_last_adjust_reason"] = None
    await db.users.update_one({"id": user["id"]}, {"$set": updates})
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return public_user(updated)


# ============================================================================
# LLM helper
# ============================================================================

async def ask_llm_json(system: str, user_prompt: str, session_id: str) -> dict:
    """Ask Gemini for a JSON response. Robust to code fences."""
    try:
        response = await gemini_client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=user_prompt,
            config=genai_types.GenerateContentConfig(system_instruction=system),
        )
        reply = response.text or ""
    except Exception as e:
        logger.error("Gemini call error (%s): %s", session_id, e)
        raise HTTPException(502, "Réponse IA indisponible, veuillez réessayer")
    text = reply.strip()

    # strip code fences
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip()
    # find first { .. last }
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start : end + 1]
    try:
        return json.loads(text)
    except Exception as e:
        logger.error("LLM parse error: %s | raw=%s", e, text[:500])
        raise HTTPException(502, "Réponse IA invalide, veuillez réessayer")


# ============================================================================
# Workouts
# ============================================================================

@api.get("/workouts", response_model=List[Workout])
async def list_workouts(user: dict = Depends(get_current_user)):
    items = await db.workouts.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [Workout(**it) for it in items]


@api.post("/workouts", response_model=Workout)
async def create_workout(body: WorkoutCreate, user: dict = Depends(get_current_user)):
    wk = Workout(user_id=user["id"], **body.model_dump())
    await db.workouts.insert_one(wk.model_dump())
    return wk


@api.get("/workouts/{workout_id}", response_model=Workout)
async def get_workout(workout_id: str, user: dict = Depends(get_current_user)):
    doc = await db.workouts.find_one({"id": workout_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Entraînement introuvable")
    return Workout(**doc)


@api.put("/workouts/{workout_id}", response_model=Workout)
async def update_workout(workout_id: str, body: WorkoutUpdate, user: dict = Depends(get_current_user)):
    doc = await db.workouts.find_one({"id": workout_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Entraînement introuvable")
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if "exercises" in updates:
        updates["exercises"] = [Exercise(**e).model_dump() if isinstance(e, dict) else e.model_dump() for e in updates["exercises"]]
    if updates:
        await db.workouts.update_one({"id": workout_id}, {"$set": updates})
    updated = await db.workouts.find_one({"id": workout_id}, {"_id": 0})
    return Workout(**updated)


@api.delete("/workouts/{workout_id}")
async def delete_workout(workout_id: str, user: dict = Depends(get_current_user)):
    res = await db.workouts.delete_one({"id": workout_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Entraînement introuvable")
    return {"ok": True}


@api.post("/workouts/{workout_id}/complete", response_model=Workout)
async def complete_workout(workout_id: str, user: dict = Depends(get_current_user)):
    doc = await db.workouts.find_one({"id": workout_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Entraînement introuvable")
    await db.workouts.update_one({"id": workout_id}, {"$set": {"performed_at": now_utc()}})
    updated = await db.workouts.find_one({"id": workout_id}, {"_id": 0})
    return Workout(**updated)


@api.post("/workouts/generate", response_model=Workout)
async def generate_workout(body: WorkoutGenerateInput, user: dict = Depends(get_current_user)):
    system = (
        "Tu es un coach sportif expert. Tu réponds STRICTEMENT en JSON valide, "
        "sans texte hors JSON, sans code fences. Toutes les valeurs textuelles sont en français."
    )
    prompt = (
        f"Génère un programme d'entraînement personnalisé.\n"
        f"Objectif: {body.goal}\n"
        f"Niveau: {body.level}\n"
        f"Durée: {body.duration_minutes} minutes\n"
        f"Équipement disponible: {body.equipment}\n"
        f"Focus: {body.focus or 'complet'}\n\n"
        "Réponds avec cet exact schéma JSON:\n"
        '{"title": "string court", "description": "string court explicatif", '
        '"exercises": [{"name": "string", "sets": int, "reps": "string ex: 10 ou 30s", '
        '"rest_seconds": int, "notes": "string court conseil forme"}]}\n\n'
        "Inclus 5 à 8 exercices adaptés. Reps peut être un nombre ou une durée. "
        "Notes = conseil bref sur la forme."
    )
    data = await ask_llm_json(system, prompt, f"gen-workout-{user['id']}-{uuid.uuid4()}")

    exercises = []
    for ex in data.get("exercises", []):
        try:
            exercises.append(Exercise(
                name=str(ex.get("name", "Exercice")),
                sets=int(ex.get("sets", 3)),
                reps=str(ex.get("reps", "10")),
                rest_seconds=int(ex.get("rest_seconds", 60)),
                notes=str(ex.get("notes", "")),
            ))
        except Exception:
            continue

    wk = Workout(
        user_id=user["id"],
        title=str(data.get("title", f"Programme {body.goal}"))[:80],
        description=str(data.get("description", ""))[:400],
        exercises=exercises,
    )
    await db.workouts.insert_one(wk.model_dump())
    return wk


# ============================================================================
# Program generation (multi-session)
# ============================================================================

WEEK_DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]


@api.post("/workouts/generate-program", response_model=List[Workout])
async def generate_program(body: ProgramGenerateInput, user: dict = Depends(get_current_user)):
    """Generate N workouts for a full weekly program (full body or classic split)."""
    system = (
        "Tu es un coach sportif expert. Tu réponds STRICTEMENT en JSON valide, "
        "sans texte hors JSON ni code fence. Toutes les valeurs textuelles sont en français."
    )
    if body.program_type == "full_body":
        style = (
            f"Génère {body.sessions_per_week} séances FULL BODY identiques dans leur structure mais "
            "avec exercices variés (rotation d'exercices sollicitant tout le corps à chaque séance)."
        )
    else:
        style = (
            f"Génère {body.sessions_per_week} séances de SPLIT CLASSIQUE. "
            "Réparts les groupes musculaires sur la semaine (ex: 'Pecs + Biceps', 'Dos + Triceps', "
            "'Jambes', 'Épaules + Abdos'). Chaque séance cible 1 à 2 groupes majeurs."
        )
    prompt = (
        f"{style}\n"
        f"Objectif: {body.goal}\n"
        f"Niveau: {body.level}\n"
        f"Durée par séance: {body.duration_minutes} min\n"
        f"Équipement: {body.equipment}\n\n"
        'Réponds avec ce schéma JSON exact:\n'
        '{"program_name": "string court", '
        '"sessions": [{"title": "string court (ex: Séance A - Full body / Lundi: Pecs + Biceps)", '
        '"week_day": "lundi|mardi|mercredi|jeudi|vendredi|samedi", '
        '"description": "string court", '
        '"exercises": [{"name": "string", "sets": int, "reps": "string ex: 10 ou 30s", '
        '"target_weight_kg": number ou null, "rest_seconds": int, "notes": "string bref"}]}]}\n\n'
        f"IMPORTANT: exactement {body.sessions_per_week} séances. 5 à 8 exercices par séance. "
        "Pour target_weight_kg indique un poids de départ raisonnable pour un pratiquant "
        f"{body.level} (peut être null si poids du corps)."
    )
    data = await ask_llm_json(system, prompt, f"gen-program-{user['id']}-{uuid.uuid4()}")

    program_id = new_id()
    sessions = data.get("sessions") or []
    workouts: List[Workout] = []
    for i, s in enumerate(sessions[: body.sessions_per_week], start=1):
        exs = []
        for ex in s.get("exercises", []):
            try:
                tw = ex.get("target_weight_kg")
                exs.append(Exercise(
                    name=str(ex.get("name", "Exercice"))[:80],
                    sets=int(ex.get("sets", 3)),
                    reps=str(ex.get("reps", "10")),
                    rest_seconds=int(ex.get("rest_seconds", 60)),
                    notes=str(ex.get("notes", ""))[:200],
                    target_weight_kg=float(tw) if tw not in (None, "", "null") else None,
                ))
            except Exception:
                continue
        wk = Workout(
            user_id=user["id"],
            title=str(s.get("title", f"Séance {i}"))[:80],
            description=str(s.get("description", ""))[:400],
            exercises=exs,
            program_id=program_id,
            program_type=body.program_type,
            sessions_per_week=body.sessions_per_week,
            week_day=str(s.get("week_day", ""))[:20] or (WEEK_DAYS[i - 1] if body.program_type == "split" else None),
            session_index=i,
        )
        await db.workouts.insert_one(wk.model_dump())
        workouts.append(wk)

    return workouts


# ============================================================================
# Session logging + progressive overload
# ============================================================================

@api.post("/workouts/{workout_id}/log")
async def log_session(workout_id: str, body: SessionLogInput, user: dict = Depends(get_current_user)):
    doc = await db.workouts.find_one({"id": workout_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Entraînement introuvable")

    exercises = doc.get("exercises", [])
    ex_by_id = {e["id"]: e for e in exercises}

    for entry in body.entries:
        ex = ex_by_id.get(entry.exercise_id)
        if not ex:
            continue
        ex["last_difficulty"] = entry.difficulty
        if entry.weight_kg is not None:
            ex["last_weight_kg"] = entry.weight_kg
        if entry.reps_done is not None:
            ex["last_reps_done"] = entry.reps_done

    # Save log doc + mark performed
    log_doc = {
        "id": new_id(),
        "user_id": user["id"],
        "workout_id": workout_id,
        "entries": [e.model_dump() for e in body.entries],
        "performed_at": now_utc(),
    }
    await db.session_logs.insert_one(log_doc)
    await db.workouts.update_one(
        {"id": workout_id},
        {"$set": {"exercises": exercises, "performed_at": now_utc()}},
    )

    updated = await db.workouts.find_one({"id": workout_id}, {"_id": 0})
    return {"workout": Workout(**updated).model_dump()}


@api.get("/workouts/{workout_id}/logs")
async def workout_logs(workout_id: str, user: dict = Depends(get_current_user)):
    items = await db.session_logs.find(
        {"user_id": user["id"], "workout_id": workout_id}, {"_id": 0}
    ).sort("performed_at", -1).to_list(200)
    return items


@api.get("/exercises/history")
async def exercise_history(name: str, user: dict = Depends(get_current_user)):
    """Return chronological history for a given exercise name across all workouts."""
    workouts = await db.workouts.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    # map exercise_id -> exercise info (name)
    ex_id_map: dict = {}
    for w in workouts:
        for e in w.get("exercises", []):
            if e.get("name", "").strip().lower() == name.strip().lower():
                ex_id_map[e["id"]] = e["name"]
    if not ex_id_map:
        return {"exercise_name": name, "points": []}

    logs = await db.session_logs.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("performed_at", 1).to_list(1000)
    points = []
    for lg in logs:
        for entry in lg.get("entries", []):
            if entry.get("exercise_id") in ex_id_map:
                points.append({
                    "performed_at": lg["performed_at"],
                    "weight_kg": entry.get("weight_kg"),
                    "difficulty": entry.get("difficulty"),
                    "reps_done": entry.get("reps_done"),
                })
                break
    return {"exercise_name": name, "points": points}


# ============================================================================
# Meals / Nutrition
# ============================================================================

@api.get("/meals", response_model=List[Meal])
async def list_meals(date: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"user_id": user["id"]}
    if date:
        query["date"] = date
    items = await db.meals.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [Meal(**it) for it in items]


@api.post("/meals", response_model=Meal)
async def create_meal(body: MealCreate, user: dict = Depends(get_current_user)):
    m = Meal(
        user_id=user["id"],
        name=body.name.strip(),
        calories=body.calories,
        meal_type=body.meal_type,
        date=body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    )
    await db.meals.insert_one(m.model_dump())
    return m


@api.delete("/meals/{meal_id}")
async def delete_meal(meal_id: str, user: dict = Depends(get_current_user)):
    res = await db.meals.delete_one({"id": meal_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Repas introuvable")
    return {"ok": True}


@api.post("/meals/suggest")
async def suggest_meals(body: MealSuggestInput, user: dict = Depends(get_current_user)):
    system = (
        "Tu es un nutritionniste sportif. Tu réponds STRICTEMENT en JSON valide, "
        "sans texte hors JSON, sans code fences. Toutes les valeurs textuelles sont en français."
    )
    prompt = (
        f"Propose 3 idées de {body.meal_type} adaptées.\n"
        f"Calories cibles totales par repas: environ {max(150, body.remaining_calories)} kcal.\n"
        f"Préférences/contraintes: {body.preferences or 'aucune'}.\n\n"
        "Réponds avec ce schéma JSON exact:\n"
        '{"suggestions": [{"name": "string", "calories": int, "ingredients": ["string", ...], '
        '"description": "string court"}]}'
    )
    data = await ask_llm_json(system, prompt, f"gen-meal-{user['id']}-{uuid.uuid4()}")
    suggestions = data.get("suggestions", [])[:3]
    cleaned = []
    for s in suggestions:
        cleaned.append({
            "name": str(s.get("name", "Repas"))[:80],
            "calories": int(s.get("calories", 0)),
            "ingredients": [str(i)[:60] for i in s.get("ingredients", [])][:10],
            "description": str(s.get("description", ""))[:280],
        })
    return {"suggestions": cleaned}


@api.post("/meals/estimate")
async def estimate_meal(body: MealEstimateInput, user: dict = Depends(get_current_user)):
    """Estimate calories + guess a short name for a meal from a free-form French description."""
    system = (
        "Tu es un nutritionniste. Tu réponds STRICTEMENT en JSON valide, sans texte hors JSON, "
        "sans code fences. Toutes les valeurs textuelles sont en français."
    )
    prompt = (
        f"Description du repas: « {body.description.strip()} »\n\n"
        "Estime les calories totales de ce repas. Sois réaliste, en tenant compte des quantités "
        "mentionnées. Si aucune quantité n'est donnée, estime pour une portion adulte moyenne.\n\n"
        'Réponds avec ce schéma JSON exact:\n'
        '{"name": "string court 3-6 mots", '
        '"calories": int, '
        '"meal_type": "petit-déjeuner|déjeuner|dîner|collation", '
        '"breakdown": "string très court expliquant l\'estimation"}'
    )
    data = await ask_llm_json(system, prompt, f"est-meal-{user['id']}-{uuid.uuid4()}")
    mt = str(data.get("meal_type", "déjeuner")).lower()
    if mt not in ("petit-déjeuner", "déjeuner", "dîner", "collation"):
        mt = "déjeuner"
    return {
        "name": str(data.get("name", "Repas"))[:80],
        "calories": max(0, int(data.get("calories", 0))),
        "meal_type": mt,
        "breakdown": str(data.get("breakdown", ""))[:200],
    }


# ============================================================================
# Measurements
# ============================================================================

@api.get("/measurements", response_model=List[Measurement])
async def list_measurements(user: dict = Depends(get_current_user)):
    items = await db.measurements.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return [Measurement(**it) for it in items]


@api.get("/measurements/latest")
async def latest_measurements(user: dict = Depends(get_current_user)):
    """Return the most recent value per body part along with its date."""
    fields = ["weight_kg", "chest_cm", "waist_cm", "belly_cm", "hips_cm", "arm_cm", "thigh_cm"]
    docs = await db.measurements.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    result: dict = {}
    for f in fields:
        for d in docs:
            v = d.get(f)
            if v is not None:
                result[f] = {"value": v, "created_at": d["created_at"]}
                break
        if f not in result:
            result[f] = None
    return result


@api.post("/measurements", response_model=Measurement)
async def create_measurement(body: MeasurementCreate, user: dict = Depends(get_current_user)):
    m = Measurement(user_id=user["id"], **body.model_dump())
    await db.measurements.insert_one(m.model_dump())
    # Trigger adaptive calorie adjustment if a weight was provided
    if body.weight_kg is not None:
        try:
            await _maybe_apply_adaptive_calories(user["id"])
        except Exception as e:
            logger.warning("adaptive calorie adjust failed: %s", e)
    return m


@api.delete("/measurements/{mid}")
async def delete_measurement(mid: str, user: dict = Depends(get_current_user)):
    res = await db.measurements.delete_one({"id": mid, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Mesure introuvable")
    return {"ok": True}


# ============================================================================
# Adaptive calorie recommendation (based on weekly weight progress)
# ============================================================================

# Expected weekly weight change per goal (kg/week)
GOAL_TARGET_KG_PER_WEEK = {
    "prise de masse": (0.2, 0.5),     # min, max healthy range
    "sèche": (-0.7, -0.4),
    "maintien": (-0.2, 0.2),
}

CAL_ADJUST_STEP = 150  # kcal adjustment per re-evaluation
CAL_MIN = 1200
CAL_MAX = 5000
ADJUST_COOLDOWN_DAYS = 7  # do not auto-adjust more often than this


async def _weekly_weight_change(user_id: str) -> Optional[dict]:
    """Return {change_kg_per_week, span_days, first_weight, last_weight, points} or None if insufficient data.
    Uses weight measurements from last 28 days, requires at least 2 spanning >= 7 days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=28)
    docs = await db.measurements.find(
        {"user_id": user_id, "weight_kg": {"$ne": None}},
        {"_id": 0},
    ).sort("created_at", 1).to_list(200)

    weighed = []
    for d in docs:
        try:
            dt = datetime.fromisoformat(d["created_at"].replace("Z", "+00:00"))
        except Exception:
            continue
        if dt >= cutoff and d.get("weight_kg") is not None:
            weighed.append((dt, float(d["weight_kg"])))

    if len(weighed) < 2:
        return None

    first_dt, first_w = weighed[0]
    last_dt, last_w = weighed[-1]
    span_days = (last_dt - first_dt).total_seconds() / 86400.0
    if span_days < 7:
        return None

    change_per_week = (last_w - first_w) / span_days * 7.0
    return {
        "change_kg_per_week": round(change_per_week, 2),
        "span_days": round(span_days, 1),
        "first_weight": first_w,
        "last_weight": last_w,
        "points": len(weighed),
    }


def _decide_calorie_adjustment(fitness_goal: str, change_kg_per_week: float, current_goal: int) -> dict:
    """Return {should_adjust, delta_kcal, new_goal, reason, status}."""
    rng = GOAL_TARGET_KG_PER_WEEK.get(fitness_goal)
    if not rng:
        return {"should_adjust": False, "delta_kcal": 0, "new_goal": current_goal,
                "reason": "Objectif non défini", "status": "unknown"}
    lo, hi = rng
    delta = 0
    prog_status = "on_track"
    reason = "Vous progressez comme prévu. Continuez ainsi."

    if fitness_goal == "prise de masse":
        if change_kg_per_week < lo:
            delta = +CAL_ADJUST_STEP
            prog_status = "below"
            reason = f"Progression trop lente ({change_kg_per_week:+.2f} kg/sem). Ajout de {CAL_ADJUST_STEP} kcal pour relancer la prise."
        elif change_kg_per_week > hi:
            delta = -CAL_ADJUST_STEP
            prog_status = "above"
            reason = f"Prise trop rapide ({change_kg_per_week:+.2f} kg/sem). Réduction de {CAL_ADJUST_STEP} kcal pour limiter la prise de gras."
    elif fitness_goal == "sèche":
        # negative range: lo=-0.7 (fast), hi=-0.4 (slow)
        if change_kg_per_week > hi:  # not losing enough
            delta = -CAL_ADJUST_STEP
            prog_status = "below"  # goal progression below target
            reason = f"Perte insuffisante ({change_kg_per_week:+.2f} kg/sem). Réduction de {CAL_ADJUST_STEP} kcal."
        elif change_kg_per_week < lo:  # losing too fast
            delta = +CAL_ADJUST_STEP
            prog_status = "above"
            reason = f"Perte trop rapide ({change_kg_per_week:+.2f} kg/sem). Ajout de {CAL_ADJUST_STEP} kcal pour protéger la masse musculaire."
    elif fitness_goal == "maintien":
        if change_kg_per_week > hi:
            delta = -CAL_ADJUST_STEP
            prog_status = "above"
            reason = f"Prise de poids inattendue ({change_kg_per_week:+.2f} kg/sem). Réduction de {CAL_ADJUST_STEP} kcal."
        elif change_kg_per_week < lo:
            delta = +CAL_ADJUST_STEP
            prog_status = "below"
            reason = f"Perte inattendue ({change_kg_per_week:+.2f} kg/sem). Ajout de {CAL_ADJUST_STEP} kcal."

    new_goal = max(CAL_MIN, min(CAL_MAX, current_goal + delta))
    if new_goal == current_goal:
        delta = 0
    return {
        "should_adjust": delta != 0,
        "delta_kcal": delta,
        "new_goal": new_goal,
        "reason": reason,
        "status": prog_status,
    }


async def _maybe_apply_adaptive_calories(user_id: str) -> Optional[dict]:
    """Apply calorie adjustment if user has auto-goal, fitness_goal set, enough data, and cooldown respected."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        return None
    if not user.get("calorie_goal_auto", True):
        return None
    fitness_goal = user.get("fitness_goal")
    if not fitness_goal:
        return None

    # cooldown
    last_ts = user.get("calorie_last_adjust_at")
    if last_ts:
        try:
            last_dt = datetime.fromisoformat(str(last_ts).replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - last_dt).days < ADJUST_COOLDOWN_DAYS:
                return None
        except Exception:
            pass

    stats = await _weekly_weight_change(user_id)
    if not stats:
        return None

    decision = _decide_calorie_adjustment(fitness_goal, stats["change_kg_per_week"], int(user.get("calorie_goal", 2000)))
    if not decision["should_adjust"]:
        return None

    await db.users.update_one(
        {"id": user_id},
        {"$set": {
            "calorie_goal": decision["new_goal"],
            "calorie_goal_auto": True,
            "calorie_last_adjust_at": now_utc(),
            "calorie_last_adjust_reason": decision["reason"],
        }},
    )
    return {**decision, "weekly_change_kg": stats["change_kg_per_week"]}


@api.get("/user/calorie-recommendation")
async def calorie_recommendation(user: dict = Depends(get_current_user)):
    """Preview the adaptive recommendation without applying it."""
    fitness_goal = user.get("fitness_goal")
    current_goal = int(user.get("calorie_goal", 2000))
    stats = await _weekly_weight_change(user["id"])
    if not fitness_goal:
        return {
            "applicable": False,
            "reason": "Renseignez votre profil santé pour activer les ajustements adaptatifs.",
            "current_goal": current_goal,
            "suggested_goal": current_goal,
            "weekly_change_kg": None,
            "span_days": None,
            "status": "no_profile",
            "last_adjusted_at": user.get("calorie_last_adjust_at"),
        }
    if not stats:
        return {
            "applicable": False,
            "reason": "Ajoutez au moins 2 mesures de poids séparées d'au moins 7 jours.",
            "current_goal": current_goal,
            "suggested_goal": current_goal,
            "weekly_change_kg": None,
            "span_days": None,
            "status": "insufficient_data",
            "last_adjusted_at": user.get("calorie_last_adjust_at"),
        }
    decision = _decide_calorie_adjustment(fitness_goal, stats["change_kg_per_week"], current_goal)
    return {
        "applicable": True,
        "current_goal": current_goal,
        "suggested_goal": decision["new_goal"],
        "delta_kcal": decision["delta_kcal"],
        "weekly_change_kg": stats["change_kg_per_week"],
        "span_days": stats["span_days"],
        "reason": decision["reason"],
        "status": decision["status"],
        "should_adjust": decision["should_adjust"],
        "target_range_kg_per_week": GOAL_TARGET_KG_PER_WEEK[fitness_goal],
        "last_adjusted_at": user.get("calorie_last_adjust_at"),
    }


@api.post("/user/calorie-recommendation/apply")
async def apply_calorie_recommendation(user: dict = Depends(get_current_user)):
    """Force-apply the current adaptive recommendation (bypasses cooldown)."""
    fitness_goal = user.get("fitness_goal")
    if not fitness_goal:
        raise HTTPException(400, "Profil santé incomplet")
    stats = await _weekly_weight_change(user["id"])
    if not stats:
        raise HTTPException(400, "Pas assez de mesures de poids")
    decision = _decide_calorie_adjustment(fitness_goal, stats["change_kg_per_week"], int(user.get("calorie_goal", 2000)))
    if not decision["should_adjust"]:
        return {"applied": False, "reason": decision["reason"], "current_goal": user.get("calorie_goal")}
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "calorie_goal": decision["new_goal"],
            "calorie_goal_auto": True,
            "calorie_last_adjust_at": now_utc(),
            "calorie_last_adjust_reason": decision["reason"],
        }},
    )
    return {"applied": True, "new_goal": decision["new_goal"], "delta_kcal": decision["delta_kcal"],
            "reason": decision["reason"], "weekly_change_kg": stats["change_kg_per_week"]}


# ============================================================================
# Health + stats
# ============================================================================

@api.get("/")
async def root():
    return {"app": "Bodypilot", "ok": True}


@api.get("/summary/today")
async def summary_today(user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    meals = await db.meals.find({"user_id": user["id"], "date": today}, {"_id": 0}).to_list(200)
    consumed = sum(int(m.get("calories", 0)) for m in meals)
    goal = int(user.get("calorie_goal", 2000))
    # next workout = latest not performed
    next_wk_doc = await db.workouts.find_one(
        {"user_id": user["id"], "performed_at": None},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    # workouts this week
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    done_this_week = await db.workouts.count_documents({
        "user_id": user["id"],
        "performed_at": {"$ne": None, "$gte": week_ago},
    })
    return {
        "calorie_goal": goal,
        "calories_consumed": consumed,
        "calories_remaining": goal - consumed,
        "meals_today": len(meals),
        "next_workout": Workout(**next_wk_doc).model_dump() if next_wk_doc else None,
        "workouts_done_this_week": done_this_week,
    }


# ============================================================================
# History & Stats
# ============================================================================

def _iso_week(dt: datetime) -> str:
    iso = dt.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


@api.get("/workouts/history/stats")
async def workouts_history(user: dict = Depends(get_current_user)):
    """Return completed workouts + weekly counts (last 8 weeks) + current streak."""
    done_docs = await db.workouts.find(
        {"user_id": user["id"], "performed_at": {"$ne": None}},
        {"_id": 0},
    ).sort("performed_at", -1).to_list(500)

    completed = [Workout(**d).model_dump() for d in done_docs]

    # Weekly counts – last 8 iso weeks including current
    now = datetime.now(timezone.utc)
    weeks: List[dict] = []
    week_labels: List[str] = []
    for i in range(7, -1, -1):
        d = now - timedelta(weeks=i)
        label = _iso_week(d)
        week_labels.append(label)
        weeks.append({"week": label, "count": 0, "label": d.strftime("%d/%m")})

    for w in completed:
        try:
            dt = datetime.fromisoformat(w["performed_at"].replace("Z", "+00:00"))
            key = _iso_week(dt)
            for entry in weeks:
                if entry["week"] == key:
                    entry["count"] += 1
                    break
        except Exception:
            continue

    # Current streak in consecutive weeks with >= 1 workout (from most recent)
    current_streak = 0
    for entry in reversed(weeks):
        if entry["count"] > 0:
            current_streak += 1
        else:
            break

    # Best streak overall
    best = 0
    run = 0
    for entry in weeks:
        if entry["count"] > 0:
            run += 1
            best = max(best, run)
        else:
            run = 0

    return {
        "total_completed": len(completed),
        "current_streak_weeks": current_streak,
        "best_streak_weeks": best,
        "weekly": weeks,
        "recent": completed[:20],
    }


# ============================================================================
# AI Coach chat
# ============================================================================

class CoachMessage(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id: str
    workout_id: Optional[str] = None
    role: Literal["user", "assistant"]
    content: str
    created_at: str = Field(default_factory=now_utc)


class CoachChatInput(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    workout_id: Optional[str] = None


@api.get("/coach/messages", response_model=List[CoachMessage])
async def list_coach_messages(
    workout_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    query: dict = {"user_id": user["id"]}
    if workout_id:
        query["workout_id"] = workout_id
    else:
        query["workout_id"] = None
    items = await db.coach_messages.find(query, {"_id": 0}).sort("created_at", 1).to_list(500)
    return [CoachMessage(**it) for it in items]


@api.delete("/coach/messages")
async def clear_coach_messages(
    workout_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    query: dict = {"user_id": user["id"]}
    if workout_id:
        query["workout_id"] = workout_id
    else:
        query["workout_id"] = None
    await db.coach_messages.delete_many(query)
    return {"ok": True}


@api.post("/coach/chat", response_model=CoachMessage)
async def coach_chat(body: CoachChatInput, user: dict = Depends(get_current_user)):
    # Persist user message
    user_msg = CoachMessage(
        user_id=user["id"],
        workout_id=body.workout_id,
        role="user",
        content=body.message.strip(),
    )
    await db.coach_messages.insert_one(user_msg.model_dump())

    # Build context
    default_name = user.get("name") or "l'athlète"
    context = f"L'utilisateur s'appelle {default_name}."
    if body.workout_id:
        wk = await db.workouts.find_one(
            {"id": body.workout_id, "user_id": user["id"]}, {"_id": 0}
        )
        if wk:
            ex_lines = "\n".join(
                f"- {e['name']} : {e['sets']}x{e['reps']}, repos {e['rest_seconds']}s"
                for e in wk.get("exercises", [])
            )
            context += (
                f"\nProgramme actuel : « {wk['title']} »\n"
                f"Description : {wk.get('description', '')}\n"
                f"Exercices :\n{ex_lines or '(aucun)'}"
            )

    # Recent history for the same session
    hist_query: dict = {"user_id": user["id"], "workout_id": body.workout_id}
    hist_docs = await db.coach_messages.find(hist_query, {"_id": 0}).sort("created_at", -1).to_list(20)
    hist_docs.reverse()

    system = (
        "Tu es Coach IA, un entraîneur sportif francophone bienveillant et concis. "
        "Tu conseilles l'utilisateur sur son programme, la forme des exercices, la récupération, "
        "les substitutions possibles et la progression. Tu réponds en français, en 3 à 6 phrases maximum, "
        "sans utiliser de listes à puces sauf si l'utilisateur le demande, et sans markdown."
        f"\n\nContexte :\n{context}"
    )

    convo_lines = []
    for m in hist_docs[:-1]:  # exclude the just-inserted user msg
        prefix = "Utilisateur" if m["role"] == "user" else "Coach"
        convo_lines.append(f"{prefix} : {m['content']}")
    convo_lines.append(f"Utilisateur : {body.message.strip()}")
    prompt = "\n".join(convo_lines)

    try:
        response = await gemini_client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=genai_types.GenerateContentConfig(system_instruction=system),
        )
        reply_text = (response.text or "").strip()
    except Exception as e:
        logger.error("Coach chat error: %s", e)
        raise HTTPException(502, "Le coach IA est momentanément indisponible")

    assistant_msg = CoachMessage(
        user_id=user["id"],
        workout_id=body.workout_id,
        role="assistant",
        content=reply_text[:4000] or "…",
    )
    await db.coach_messages.insert_one(assistant_msg.model_dump())
    return assistant_msg


# ============================================================================
# App wiring
# ============================================================================

app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def _close():
    client.close()
