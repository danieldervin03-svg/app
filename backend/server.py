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
import base64
import logging
import bcrypt
import jwt

from anthropic import AsyncAnthropic
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ["JWT_ALGORITHM"]
JWT_EXPIRATION_HOURS = int(os.environ["JWT_EXPIRATION_HOURS"])
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
ANTHROPIC_MODEL_TEXT = os.environ.get("ANTHROPIC_MODEL_TEXT", "claude-haiku-4-5-20251001")
ANTHROPIC_MODEL_VISION = os.environ.get("ANTHROPIC_MODEL_VISION", "claude-sonnet-5")
anthropic_client = AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

WORKOUTX_API_KEY = os.environ.get("WORKOUTX_API_KEY", "")
WORKOUTX_BASE = "https://api.workoutxapp.com"

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
    protein_goal_g: Optional[float] = None
    carbs_goal_g: Optional[float] = None
    fat_goal_g: Optional[float] = None
    fiber_goal_g: Optional[float] = None
    created_at: str


class MacroGoalsUpdate(BaseModel):
    # Send null/None for a field to reset it back to automatic calculation
    protein_goal_g: Optional[float] = Field(default=None, ge=0, le=500)
    carbs_goal_g: Optional[float] = Field(default=None, ge=0, le=900)
    fat_goal_g: Optional[float] = Field(default=None, ge=0, le=400)
    fiber_goal_g: Optional[float] = Field(default=None, ge=0, le=150)
    use_auto: bool = False  # if true, clears all custom macro goals regardless of the fields above


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


# Macro split (protein / carbs / fat as % of total calories) per fitness goal
MACRO_SPLITS = {
    "sèche": (0.35, 0.35, 0.30),          # weight loss: higher protein for satiety + muscle retention
    "prise de masse": (0.30, 0.45, 0.25),  # muscle gain: more carbs to fuel training/recovery
    "maintien": (0.25, 0.45, 0.30),        # maintenance: balanced
}


def compute_macro_goals(calorie_goal: int, fitness_goal: Optional[str], user: dict) -> dict:
    """Compute daily macro targets (g). Custom user overrides always win; otherwise derive
    from the calorie goal using a split appropriate to the user's fitness goal."""
    protein_pct, carbs_pct, fat_pct = MACRO_SPLITS.get(fitness_goal, MACRO_SPLITS["maintien"])
    auto_protein = round((calorie_goal * protein_pct) / 4)
    auto_carbs = round((calorie_goal * carbs_pct) / 4)
    auto_fat = round((calorie_goal * fat_pct) / 9)
    auto_fiber = round(14 * calorie_goal / 1000)  # ~14g fiber per 1000 kcal (standard guideline)

    protein_goal = user.get("protein_goal_g") if user.get("protein_goal_g") is not None else auto_protein
    carbs_goal = user.get("carbs_goal_g") if user.get("carbs_goal_g") is not None else auto_carbs
    fat_goal = user.get("fat_goal_g") if user.get("fat_goal_g") is not None else auto_fat
    fiber_goal = user.get("fiber_goal_g") if user.get("fiber_goal_g") is not None else auto_fiber

    return {
        "protein_goal_g": round(protein_goal),
        "carbs_goal_g": round(carbs_goal),
        "fat_goal_g": round(fat_goal),
        "fiber_goal_g": round(fiber_goal),
        "protein_goal_auto_g": auto_protein,
        "carbs_goal_auto_g": auto_carbs,
        "fat_goal_auto_g": auto_fat,
        "fiber_goal_auto_g": auto_fiber,
        "is_custom": any(
            user.get(k) is not None
            for k in ("protein_goal_g", "carbs_goal_g", "fat_goal_g", "fiber_goal_g")
        ),
    }


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
    protein_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fat_g: Optional[float] = None
    fiber_g: Optional[float] = None
    is_favorite: bool = False
    meal_type: Literal["petit-déjeuner", "déjeuner", "dîner", "collation"]
    date: str  # YYYY-MM-DD
    created_at: str = Field(default_factory=now_utc)


class MealCreate(BaseModel):
    name: str
    calories: int = Field(ge=0, le=5000)
    protein_g: Optional[float] = Field(default=None, ge=0, le=500)
    carbs_g: Optional[float] = Field(default=None, ge=0, le=900)
    fat_g: Optional[float] = Field(default=None, ge=0, le=400)
    fiber_g: Optional[float] = Field(default=None, ge=0, le=150)
    meal_type: Literal["petit-déjeuner", "déjeuner", "dîner", "collation"]
    date: Optional[str] = None


class MealUpdate(BaseModel):
    name: Optional[str] = None
    calories: Optional[int] = Field(default=None, ge=0, le=5000)
    protein_g: Optional[float] = Field(default=None, ge=0, le=500)
    carbs_g: Optional[float] = Field(default=None, ge=0, le=900)
    fat_g: Optional[float] = Field(default=None, ge=0, le=400)
    fiber_g: Optional[float] = Field(default=None, ge=0, le=150)
    meal_type: Optional[Literal["petit-déjeuner", "déjeuner", "dîner", "collation"]] = None


class MealSuggestInput(BaseModel):
    remaining_calories: int
    meal_type: Literal["petit-déjeuner", "déjeuner", "dîner", "collation"]
    preferences: str = ""


class MealEstimateInput(BaseModel):
    description: str = Field(min_length=2, max_length=500)


class MenuScanInput(BaseModel):
    image_base64: str
    mime_type: str = "image/jpeg"


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
        protein_goal_g=u.get("protein_goal_g"),
        carbs_goal_g=u.get("carbs_goal_g"),
        fat_goal_g=u.get("fat_goal_g"),
        fiber_goal_g=u.get("fiber_goal_g"),
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


@api.put("/user/macro-goals", response_model=UserPublic)
async def update_macro_goals(body: MacroGoalsUpdate, user: dict = Depends(get_current_user)):
    """Set custom daily macro targets, or reset to automatic calculation (use_auto=true).
    Only fields actually present in the request are touched — any macro goal not
    included stays exactly as it was (whether auto or previously customized)."""
    raw = body.model_dump(exclude_unset=True)
    raw.pop("use_auto", None)
    if body.use_auto:
        updates = {
            "protein_goal_g": None, "carbs_goal_g": None,
            "fat_goal_g": None, "fiber_goal_g": None,
        }
    else:
        updates = raw  # only the keys the client actually sent get changed
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
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

async def ask_llm_json(
    system: str,
    user_prompt: str,
    session_id: str,
    image_bytes: Optional[bytes] = None,
    image_mime: str = "image/jpeg",
    max_tokens: int = 1500,
) -> dict:
    """Ask Claude for a JSON response. Robust to code fences. Optionally attach an image (vision)."""
    try:
        if image_bytes:
            image_b64 = base64.b64encode(image_bytes).decode("utf-8")
            content = [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": image_mime, "data": image_b64},
                },
                {"type": "text", "text": user_prompt},
            ]
            model = ANTHROPIC_MODEL_VISION
        else:
            content = user_prompt
            model = ANTHROPIC_MODEL_TEXT
        response = await anthropic_client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": content}],
        )
        reply = "".join(b.text for b in response.content if getattr(b, "type", None) == "text")
        if response.stop_reason == "max_tokens":
            logger.warning("Claude response truncated by max_tokens (%s tokens, session=%s)", max_tokens, session_id)
    except Exception as e:
        logger.error("Claude call error (%s): %s", session_id, e)
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
    data = await ask_llm_json(system, prompt, f"gen-workout-{user['id']}-{uuid.uuid4()}", max_tokens=2500)

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
    data = await ask_llm_json(system, prompt, f"gen-program-{user['id']}-{uuid.uuid4()}", max_tokens=4096)

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
# Exercise demonstration GIFs (WorkoutX, cached globally per exercise name)
# ============================================================================

def _normalize_exercise_key(name: str) -> str:
    return " ".join(name.strip().lower().split())


@api.get("/exercises/gif")
async def get_exercise_gif(name: str, user: dict = Depends(get_current_user)):
    """Return a demonstration GIF for a (French) exercise name, translating and
    looking it up against the WorkoutX exercise database on first request, then
    caching the result globally so future lookups for the same exercise are instant."""
    key = _normalize_exercise_key(name)
    if not key:
        raise HTTPException(400, "Nom d'exercice manquant")

    cached = await db.exercise_gifs.find_one({"key": key}, {"_id": 0})
    if cached:
        return cached

    result = {"key": key, "name_fr": name, "found": False, "gif_url": None, "name_en": None}

    if not WORKOUTX_API_KEY:
        logger.warning("WORKOUTX_API_KEY not set — skipping exercise GIF lookup")
        await db.exercise_gifs.insert_one(result)
        return result

    try:
        # 1. Translate/normalize the French exercise name to a standard English search term
        translate_system = (
            "Tu traduis des noms d'exercices de musculation du français vers l'anglais, "
            "en utilisant le nom standard le plus courant (celui qu'on trouverait dans une "
            "base de données d'exercices anglophone). Réponds STRICTEMENT en JSON valide, "
            "sans texte hors JSON."
        )
        translate_prompt = (
            f'Nom de l\'exercice en français : "{name}"\n\n'
            'Réponds avec ce schéma JSON exact: {"name_en": "string, nom standard en anglais"}'
        )
        translated = await ask_llm_json(
            translate_system, translate_prompt, f"translate-ex-{user['id']}-{uuid.uuid4()}",
            max_tokens=200,
        )
        name_en = str(translated.get("name_en", "")).strip()
        if not name_en:
            await db.exercise_gifs.insert_one(result)
            return result
        result["name_en"] = name_en

        # 2. Search WorkoutX for a matching exercise
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{WORKOUTX_BASE}/v1/exercises/name/{name_en}",
                headers={"X-WorkoutX-Key": WORKOUTX_API_KEY},
            )
        if resp.status_code == 200:
            payload = resp.json()
            items = payload.get("data") if isinstance(payload, dict) else payload
            if items:
                best = items[0]
                result["found"] = True
                result["gif_url"] = best.get("gifUrl")
                result["body_part"] = best.get("bodyPart")
                result["target"] = best.get("target")
        else:
            logger.warning("WorkoutX lookup failed (%s): %s", resp.status_code, resp.text[:200])
    except Exception as e:
        logger.error("Exercise GIF lookup error for '%s': %s", name, e)

    await db.exercise_gifs.insert_one(result)
    return result


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
        protein_g=body.protein_g,
        carbs_g=body.carbs_g,
        fat_g=body.fat_g,
        fiber_g=body.fiber_g,
        meal_type=body.meal_type,
        date=body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    )
    await db.meals.insert_one(m.model_dump())
    return m


@api.get("/meals/quick-add")
async def quick_add_meals(user: dict = Depends(get_current_user)):
    """Favorited meals + recently used distinct meals, for one-tap re-adding."""
    favorites = await db.meals.find(
        {"user_id": user["id"], "is_favorite": True}, {"_id": 0}
    ).sort("created_at", -1).to_list(30)

    recent_all = await db.meals.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(150)

    seen_names = {m["name"].strip().lower() for m in favorites}
    recent: List[dict] = []
    for m in recent_all:
        key = m["name"].strip().lower()
        if key in seen_names:
            continue
        seen_names.add(key)
        recent.append(m)
        if len(recent) >= 15:
            break

    return {"favorites": favorites, "recent": recent}


@api.get("/meals/history")
async def meals_history(user: dict = Depends(get_current_user)):
    """Daily nutrition totals for past days (most recent first), like a journal."""
    all_meals = await db.meals.find({"user_id": user["id"]}, {"_id": 0}).to_list(2000)
    by_date: dict = {}
    for m in all_meals:
        d = m.get("date")
        if not d:
            continue
        agg = by_date.setdefault(d, {
            "date": d, "calories": 0, "protein_g": 0.0, "carbs_g": 0.0,
            "fat_g": 0.0, "fiber_g": 0.0, "meals_count": 0,
        })
        agg["calories"] += int(m.get("calories", 0))
        agg["protein_g"] += float(m.get("protein_g") or 0)
        agg["carbs_g"] += float(m.get("carbs_g") or 0)
        agg["fat_g"] += float(m.get("fat_g") or 0)
        agg["fiber_g"] += float(m.get("fiber_g") or 0)
        agg["meals_count"] += 1

    goal = int(user.get("calorie_goal", 2000))
    days = sorted(by_date.values(), key=lambda x: x["date"], reverse=True)
    for d in days:
        d["protein_g"] = round(d["protein_g"], 1)
        d["carbs_g"] = round(d["carbs_g"], 1)
        d["fat_g"] = round(d["fat_g"], 1)
        d["fiber_g"] = round(d["fiber_g"], 1)
        d["calorie_goal"] = goal
    return {"days": days[:60]}


@api.put("/meals/{meal_id}", response_model=Meal)
async def update_meal(meal_id: str, body: MealUpdate, user: dict = Depends(get_current_user)):
    doc = await db.meals.find_one({"id": meal_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Repas introuvable")
    updates = body.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"] is not None:
        updates["name"] = updates["name"].strip()
    if updates:
        await db.meals.update_one({"id": meal_id}, {"$set": updates})
    updated = await db.meals.find_one({"id": meal_id}, {"_id": 0})
    return Meal(**updated)


@api.delete("/meals/{meal_id}")
async def delete_meal(meal_id: str, user: dict = Depends(get_current_user)):
    res = await db.meals.delete_one({"id": meal_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Repas introuvable")
    return {"ok": True}


@api.patch("/meals/{meal_id}/favorite", response_model=Meal)
async def toggle_meal_favorite(meal_id: str, user: dict = Depends(get_current_user)):
    doc = await db.meals.find_one({"id": meal_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Repas introuvable")
    new_val = not doc.get("is_favorite", False)
    await db.meals.update_one({"id": meal_id}, {"$set": {"is_favorite": new_val}})
    updated = await db.meals.find_one({"id": meal_id}, {"_id": 0})
    return Meal(**updated)


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
        '{"suggestions": [{"name": "string", "calories": int, "protein_g": number, "carbs_g": number, '
        '"fat_g": number, "fiber_g": number, "ingredients": ["string", ...], "description": "string court"}]}'
    )
    data = await ask_llm_json(system, prompt, f"gen-meal-{user['id']}-{uuid.uuid4()}", max_tokens=2000)
    suggestions = data.get("suggestions", [])[:3]
    cleaned = []
    for s in suggestions:
        cleaned.append({
            "name": str(s.get("name", "Repas"))[:80],
            "calories": int(s.get("calories", 0)),
            "protein_g": round(max(0.0, float(s.get("protein_g", 0) or 0)), 1),
            "carbs_g": round(max(0.0, float(s.get("carbs_g", 0) or 0)), 1),
            "fat_g": round(max(0.0, float(s.get("fat_g", 0) or 0)), 1),
            "fiber_g": round(max(0.0, float(s.get("fiber_g", 0) or 0)), 1),
            "ingredients": [str(i)[:60] for i in s.get("ingredients", [])][:10],
            "description": str(s.get("description", ""))[:280],
        })
    return {"suggestions": cleaned}


@api.post("/meals/estimate")
async def estimate_meal(body: MealEstimateInput, user: dict = Depends(get_current_user)):
    """Estimate calories + macros + guess a short name for a meal from a free-form French description."""
    system = (
        "Tu es un nutritionniste. Tu réponds STRICTEMENT en JSON valide, sans texte hors JSON, "
        "sans code fences. Toutes les valeurs textuelles sont en français."
    )
    prompt = (
        f"Description du repas: « {body.description.strip()} »\n\n"
        "Estime les calories totales et les macronutriments (protéines, glucides, lipides, fibres en "
        "grammes) de ce repas. Sois réaliste, en tenant compte des quantités mentionnées. Si aucune "
        "quantité n'est donnée, estime pour une portion adulte moyenne. Les macronutriments doivent être "
        "cohérents avec les calories totales (protéines et glucides ≈4 kcal/g, lipides ≈9 kcal/g).\n\n"
        'Réponds avec ce schéma JSON exact:\n'
        '{"name": "string court 3-6 mots", '
        '"calories": int, '
        '"protein_g": number, '
        '"carbs_g": number, '
        '"fat_g": number, '
        '"fiber_g": number, '
        '"meal_type": "petit-déjeuner|déjeuner|dîner|collation", '
        '"breakdown": "string très court expliquant l\'estimation"}'
    )
    data = await ask_llm_json(system, prompt, f"est-meal-{user['id']}-{uuid.uuid4()}", max_tokens=1500)
    mt = str(data.get("meal_type", "déjeuner")).lower()
    if mt not in ("petit-déjeuner", "déjeuner", "dîner", "collation"):
        mt = "déjeuner"
    return {
        "name": str(data.get("name", "Repas"))[:80],
        "calories": max(0, int(data.get("calories", 0))),
        "protein_g": round(max(0.0, float(data.get("protein_g", 0) or 0)), 1),
        "carbs_g": round(max(0.0, float(data.get("carbs_g", 0) or 0)), 1),
        "fat_g": round(max(0.0, float(data.get("fat_g", 0) or 0)), 1),
        "fiber_g": round(max(0.0, float(data.get("fiber_g", 0) or 0)), 1),
        "meal_type": mt,
        "breakdown": str(data.get("breakdown", ""))[:200],
    }


@api.post("/meals/scan-food")
async def scan_food(body: MenuScanInput, user: dict = Depends(get_current_user)):
    """Analyze a photo of a single food/drink item and estimate its nutrition."""
    try:
        image_bytes = base64.b64decode(body.image_base64)
    except Exception:
        raise HTTPException(400, "Image invalide")
    if len(image_bytes) > 8_000_000:
        raise HTTPException(400, "Image trop volumineuse (8 Mo max)")

    system = (
        "Tu es un nutritionniste. Tu identifies l'aliment ou la boisson visible sur la photo et "
        "tu estimes ses calories et macronutriments pour la portion visible. Tu réponds STRICTEMENT "
        "en JSON valide, sans texte hors JSON, sans code fences. Toutes les valeurs textuelles sont "
        "en français."
    )
    prompt = (
        "Identifie l'aliment ou la boisson sur cette photo, et estime ses calories et macronutriments "
        "(protéines, glucides, lipides, fibres en grammes) pour la portion visible. Sois réaliste. "
        "Si plusieurs aliments sont visibles, additionne le tout comme un seul repas.\n\n"
        'Réponds avec ce schéma JSON exact:\n'
        '{"reconnu": true, '
        '"name": "string court 3-6 mots", '
        '"calories": int, '
        '"protein_g": number, '
        '"carbs_g": number, '
        '"fat_g": number, '
        '"fiber_g": number, '
        '"meal_type": "petit-déjeuner|déjeuner|dîner|collation", '
        '"breakdown": "string très court expliquant l\'estimation"}\n\n'
        "Si aucun aliment n'est identifiable sur la photo, réponds avec le même schéma mais "
        '"reconnu": false et explique le souci dans "breakdown" (les autres champs à 0 ou vides).'
    )
    data = await ask_llm_json(
        system, prompt, f"scan-food-{user['id']}-{uuid.uuid4()}",
        image_bytes=image_bytes, image_mime=body.mime_type, max_tokens=1500,
    )
    mt = str(data.get("meal_type", "collation")).lower()
    if mt not in ("petit-déjeuner", "déjeuner", "dîner", "collation"):
        mt = "collation"
    return {
        "reconnu": bool(data.get("reconnu", True)),
        "name": str(data.get("name", "Repas"))[:80],
        "calories": max(0, int(data.get("calories", 0) or 0)),
        "protein_g": round(max(0.0, float(data.get("protein_g", 0) or 0)), 1),
        "carbs_g": round(max(0.0, float(data.get("carbs_g", 0) or 0)), 1),
        "fat_g": round(max(0.0, float(data.get("fat_g", 0) or 0)), 1),
        "fiber_g": round(max(0.0, float(data.get("fiber_g", 0) or 0)), 1),
        "meal_type": mt,
        "breakdown": str(data.get("breakdown", ""))[:200],
    }


@api.post("/meals/scan-menu")
async def scan_menu(body: MenuScanInput, user: dict = Depends(get_current_user)):
    """Analyze a photo of a restaurant menu and recommend the best dish for the user's goals."""
    try:
        image_bytes = base64.b64decode(body.image_base64)
    except Exception:
        raise HTTPException(400, "Image invalide")
    if len(image_bytes) > 8_000_000:
        raise HTTPException(400, "Image trop volumineuse (8 Mo max)")

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    todays_meals = await db.meals.find(
        {"user_id": user["id"], "date": today_str}, {"_id": 0}
    ).to_list(50)
    consumed = sum(m.get("calories", 0) for m in todays_meals)
    goal = int(user.get("calorie_goal", 2000))
    remaining = max(0, goal - consumed)
    fitness_goal = user.get("fitness_goal") or user.get("goal") or "forme générale"

    system = (
        "Tu es un nutritionniste sportif francophone. Tu analyses la photo d'un menu de restaurant "
        "et tu recommandes UN SEUL plat, le plus adapté à l'utilisateur compte tenu de son objectif "
        "et de son budget calorique restant pour la journée. Tu réponds STRICTEMENT en JSON valide, "
        "sans texte hors JSON, sans code fences. Toutes les valeurs textuelles sont en français."
    )
    prompt = (
        f"Objectif de l'utilisateur : {fitness_goal}.\n"
        f"Calories restantes aujourd'hui : environ {remaining} kcal (objectif quotidien {goal} kcal).\n\n"
        "Lis les plats visibles sur cette photo de menu. Choisis le plat le plus avantageux pour "
        "l'utilisateur (bon équilibre nutritionnel, compatible avec son budget calorique restant, "
        "en priorisant les protéines si l'objectif est la prise de muscle, ou un déficit raisonnable "
        "si l'objectif est la perte de poids). Si le menu n'est pas lisible ou ne contient pas de "
        "plats identifiables, indique-le clairement.\n\n"
        "Réponds avec ce schéma JSON exact:\n"
        '{"menu_lisible": true, '
        '"plat_recommande": "string (nom exact du plat sur le menu)", '
        '"calories": int, '
        '"protein_g": number, '
        '"carbs_g": number, '
        '"fat_g": number, '
        '"fiber_g": number, '
        '"raison": "string 2-3 phrases expliquant pourquoi ce plat est le meilleur choix", '
        '"autres_options": ["string", "string"]}\n\n'
        "Si le menu n'est pas lisible, réponds avec le même schéma mais "
        '"menu_lisible": false et explique le souci dans "raison" (les autres champs à 0 ou vides).'
    )
    data = await ask_llm_json(
        system, prompt, f"scan-menu-{user['id']}-{uuid.uuid4()}",
        image_bytes=image_bytes, image_mime=body.mime_type, max_tokens=1500,
    )
    return {
        "menu_lisible": bool(data.get("menu_lisible", True)),
        "plat_recommande": str(data.get("plat_recommande", ""))[:120],
        "calories": max(0, int(data.get("calories", 0) or 0)),
        "protein_g": round(max(0.0, float(data.get("protein_g", 0) or 0)), 1),
        "carbs_g": round(max(0.0, float(data.get("carbs_g", 0) or 0)), 1),
        "fat_g": round(max(0.0, float(data.get("fat_g", 0) or 0)), 1),
        "fiber_g": round(max(0.0, float(data.get("fiber_g", 0) or 0)), 1),
        "raison": str(data.get("raison", ""))[:500],
        "autres_options": [str(o)[:100] for o in data.get("autres_options", [])][:3],
        "remaining_calories": remaining,
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
    today_str = datetime.now(timezone.utc).date().isoformat()
    existing = await db.measurements.find_one(
        {"user_id": user["id"], "created_at": {"$regex": f"^{today_str}"}},
        {"_id": 0},
    )
    if existing:
        updates = {k: v for k, v in body.model_dump(exclude_none=True).items() if v not in (None, "")}
        if updates:
            await db.measurements.update_one({"id": existing["id"]}, {"$set": updates})
        updated = await db.measurements.find_one({"id": existing["id"]}, {"_id": 0})
        m = Measurement(**updated)
    else:
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
    protein_consumed = sum(float(m.get("protein_g") or 0) for m in meals)
    carbs_consumed = sum(float(m.get("carbs_g") or 0) for m in meals)
    fat_consumed = sum(float(m.get("fat_g") or 0) for m in meals)
    fiber_consumed = sum(float(m.get("fiber_g") or 0) for m in meals)
    goal = int(user.get("calorie_goal", 2000))
    macros = compute_macro_goals(goal, user.get("fitness_goal"), user)
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
        "protein_goal_g": macros["protein_goal_g"],
        "protein_consumed_g": round(protein_consumed, 1),
        "protein_remaining_g": round(macros["protein_goal_g"] - protein_consumed, 1),
        "carbs_goal_g": macros["carbs_goal_g"],
        "carbs_consumed_g": round(carbs_consumed, 1),
        "carbs_remaining_g": round(macros["carbs_goal_g"] - carbs_consumed, 1),
        "fat_goal_g": macros["fat_goal_g"],
        "fat_consumed_g": round(fat_consumed, 1),
        "fat_remaining_g": round(macros["fat_goal_g"] - fat_consumed, 1),
        "fiber_goal_g": macros["fiber_goal_g"],
        "fiber_consumed_g": round(fiber_consumed, 1),
        "fiber_remaining_g": round(macros["fiber_goal_g"] - fiber_consumed, 1),
        "macro_goals_are_custom": macros["is_custom"],
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
        "sans utiliser de listes à puces sauf si l'utilisateur le demande, et sans markdown. "
        "Tu ne crées ni n'enregistres jamais de programme toi-même dans cette conversation : "
        "si l'utilisateur te demande de lui préparer, créer ou générer un programme d'entraînement, "
        "explique-lui simplement d'utiliser le bouton « Générer un programme IA » sur l'écran Entraînements, "
        "et propose-lui de discuter de ses objectifs pour l'aider à bien le remplir."
        f"\n\nContexte :\n{context}"
    )

    convo_lines = []
    for m in hist_docs[:-1]:  # exclude the just-inserted user msg
        prefix = "Utilisateur" if m["role"] == "user" else "Coach"
        convo_lines.append(f"{prefix} : {m['content']}")
    convo_lines.append(f"Utilisateur : {body.message.strip()}")
    prompt = "\n".join(convo_lines)

    try:
        response = await anthropic_client.messages.create(
            model=ANTHROPIC_MODEL_TEXT,
            max_tokens=800,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        reply_text = "".join(b.text for b in response.content if getattr(b, "type", None) == "text").strip()
        if not reply_text:
            logger.error("Coach chat: empty reply from Claude")
            raise HTTPException(422, "Cette demande n'a pas pu être traitée, essaie de la reformuler.")
    except HTTPException:
        raise
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
