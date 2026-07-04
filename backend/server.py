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

from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ["JWT_ALGORITHM"]
JWT_EXPIRATION_HOURS = int(os.environ["JWT_EXPIRATION_HOURS"])
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]

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
    created_at: str


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


class Workout(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id: str
    title: str
    description: str = ""
    exercises: List[Exercise] = []
    created_at: str = Field(default_factory=now_utc)
    performed_at: Optional[str] = None


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
    goal: str  # "prise de masse", "perte de poids", "endurance", ...
    level: Literal["débutant", "intermédiaire", "avancé"] = "intermédiaire"
    duration_minutes: int = 45
    equipment: str = "salle de sport"
    focus: str = ""  # optional focus zone


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


class Measurement(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id: str
    weight_kg: Optional[float] = None
    chest_cm: Optional[float] = None
    waist_cm: Optional[float] = None
    hips_cm: Optional[float] = None
    arm_cm: Optional[float] = None
    thigh_cm: Optional[float] = None
    note: str = ""
    created_at: str = Field(default_factory=now_utc)


class MeasurementCreate(BaseModel):
    weight_kg: Optional[float] = None
    chest_cm: Optional[float] = None
    waist_cm: Optional[float] = None
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
    await db.users.update_one({"id": user["id"]}, {"$set": {"calorie_goal": body.calorie_goal}})
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return public_user(updated)


# ============================================================================
# LLM helper
# ============================================================================

async def ask_llm_json(system: str, user_prompt: str, session_id: str) -> dict:
    """Ask Claude for a JSON response. Robust to code fences."""
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system,
    ).with_model("openai", "gpt-5.4")

    reply = await chat.send_message(UserMessage(text=user_prompt))
    text = reply.strip() if isinstance(reply, str) else str(reply).strip()

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


# ============================================================================
# Measurements
# ============================================================================

@api.get("/measurements", response_model=List[Measurement])
async def list_measurements(user: dict = Depends(get_current_user)):
    items = await db.measurements.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return [Measurement(**it) for it in items]


@api.post("/measurements", response_model=Measurement)
async def create_measurement(body: MeasurementCreate, user: dict = Depends(get_current_user)):
    m = Measurement(user_id=user["id"], **body.model_dump())
    await db.measurements.insert_one(m.model_dump())
    return m


@api.delete("/measurements/{mid}")
async def delete_measurement(mid: str, user: dict = Depends(get_current_user)):
    res = await db.measurements.delete_one({"id": mid, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Mesure introuvable")
    return {"ok": True}


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
