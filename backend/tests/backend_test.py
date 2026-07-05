"""Bodypilot backend regression tests (pytest).

Covers: health, auth (register/login/me), calorie-goal update,
workouts CRUD + complete + AI generate, meals CRUD + AI suggest,
measurements CRUD, summary/today.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://smart-fitness-hub-27.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SEED_EMAIL = "test@bp.com"
SEED_PASSWORD = "secret123"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session")
def token(s):
    r = s.post(f"{API}/auth/login", json={"email": SEED_EMAIL, "password": SEED_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Seed login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------- Health ----------------
def test_root_health(s):
    r = s.get(f"{API}/", timeout=10)
    assert r.status_code == 200
    assert r.json().get("ok") is True


# ---------------- Auth ----------------
class TestAuth:
    def test_register_new_user(self, s):
        email = f"TEST_{uuid.uuid4().hex[:8]}@bp.com"
        r = s.post(f"{API}/auth/register", json={"email": email, "password": "abcdef", "name": "TEST User"}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data and "user" in data
        assert data["user"]["email"] == email.lower()
        assert data["user"]["calorie_goal"] == 2000

    def test_register_duplicate(self, s):
        r = s.post(f"{API}/auth/register", json={"email": SEED_EMAIL, "password": "secret123", "name": "dup"}, timeout=15)
        assert r.status_code == 400

    def test_register_short_password(self, s):
        r = s.post(f"{API}/auth/register", json={"email": f"TEST_{uuid.uuid4().hex[:6]}@bp.com", "password": "123", "name": "x"}, timeout=15)
        assert r.status_code == 422

    def test_login_bad_password(self, s):
        r = s.post(f"{API}/auth/login", json={"email": SEED_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_login_success(self, s):
        r = s.post(f"{API}/auth/login", json={"email": SEED_EMAIL, "password": SEED_PASSWORD}, timeout=15)
        assert r.status_code == 200
        assert r.json()["user"]["email"] == SEED_EMAIL

    def test_me(self, s, auth):
        r = s.get(f"{API}/auth/me", headers=auth, timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == SEED_EMAIL

    def test_me_no_token(self, s):
        r = s.get(f"{API}/auth/me", timeout=15)
        assert r.status_code in (401, 403)

    def test_update_calorie_goal(self, s, auth):
        r = s.put(f"{API}/user/calorie-goal", headers=auth, json={"calorie_goal": 2300}, timeout=15)
        assert r.status_code == 200
        assert r.json()["calorie_goal"] == 2300
        # revert
        s.put(f"{API}/user/calorie-goal", headers=auth, json={"calorie_goal": 2000}, timeout=15)

    def test_update_calorie_goal_out_of_range(self, s, auth):
        r = s.put(f"{API}/user/calorie-goal", headers=auth, json={"calorie_goal": 100}, timeout=15)
        assert r.status_code == 422


# ---------------- Workouts CRUD ----------------
class TestWorkouts:
    def test_workout_crud_flow(self, s, auth):
        # Create
        payload = {
            "title": "TEST Programme",
            "description": "Test description",
            "exercises": [
                {"id": str(uuid.uuid4()), "name": "Pompes", "sets": 3, "reps": "10", "rest_seconds": 60, "notes": "gainage"}
            ],
        }
        r = s.post(f"{API}/workouts", headers=auth, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        wk = r.json()
        wid = wk["id"]
        assert wk["title"] == "TEST Programme"
        assert len(wk["exercises"]) == 1

        # Get
        r = s.get(f"{API}/workouts/{wid}", headers=auth, timeout=15)
        assert r.status_code == 200 and r.json()["id"] == wid

        # List includes it
        r = s.get(f"{API}/workouts", headers=auth, timeout=15)
        assert r.status_code == 200
        assert any(w["id"] == wid for w in r.json())

        # Update: add exercise
        new_ex = payload["exercises"] + [{"id": str(uuid.uuid4()), "name": "Squats", "sets": 4, "reps": "12", "rest_seconds": 90, "notes": ""}]
        r = s.put(f"{API}/workouts/{wid}", headers=auth, json={"title": "TEST Updated", "exercises": new_ex}, timeout=15)
        assert r.status_code == 200
        assert r.json()["title"] == "TEST Updated"
        assert len(r.json()["exercises"]) == 2

        # Complete
        r = s.post(f"{API}/workouts/{wid}/complete", headers=auth, timeout=15)
        assert r.status_code == 200
        assert r.json()["performed_at"] is not None

        # Delete
        r = s.delete(f"{API}/workouts/{wid}", headers=auth, timeout=15)
        assert r.status_code == 200
        # Verify 404
        r = s.get(f"{API}/workouts/{wid}", headers=auth, timeout=15)
        assert r.status_code == 404

    def test_workout_not_found(self, s, auth):
        r = s.get(f"{API}/workouts/nonexistent-id", headers=auth, timeout=15)
        assert r.status_code == 404


# ---------------- AI generate ----------------
class TestAI:
    def test_generate_workout(self, s, auth):
        body = {"goal": "prise de masse", "level": "intermédiaire", "duration_minutes": 45, "equipment": "salle de sport", "focus": "haut du corps"}
        r = s.post(f"{API}/workouts/generate", headers=auth, json=body, timeout=90)
        assert r.status_code == 200, r.text
        wk = r.json()
        assert wk["title"]
        assert 3 <= len(wk["exercises"]) <= 12, f"expected 5-8 (allow slack), got {len(wk['exercises'])}"
        # cleanup
        s.delete(f"{API}/workouts/{wk['id']}", headers=auth, timeout=15)

    def test_suggest_meals(self, s, auth):
        body = {"remaining_calories": 600, "meal_type": "déjeuner", "preferences": "végétarien"}
        r = s.post(f"{API}/meals/suggest", headers=auth, json=body, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "suggestions" in data
        assert 1 <= len(data["suggestions"]) <= 3
        for sug in data["suggestions"]:
            assert sug["name"] and isinstance(sug["calories"], int)


# ---------------- Meals ----------------
class TestMeals:
    def test_meal_crud(self, s, auth):
        r = s.post(f"{API}/meals", headers=auth, json={"name": "TEST Salade", "calories": 350, "meal_type": "déjeuner"}, timeout=15)
        assert r.status_code == 200
        meal = r.json()
        mid = meal["id"]
        assert meal["calories"] == 350

        # List
        r = s.get(f"{API}/meals", headers=auth, timeout=15)
        assert r.status_code == 200
        assert any(m["id"] == mid for m in r.json())

        # List with date filter
        r = s.get(f"{API}/meals?date={meal['date']}", headers=auth, timeout=15)
        assert r.status_code == 200 and any(m["id"] == mid for m in r.json())

        # Delete
        r = s.delete(f"{API}/meals/{mid}", headers=auth, timeout=15)
        assert r.status_code == 200

    def test_meal_invalid_type(self, s, auth):
        r = s.post(f"{API}/meals", headers=auth, json={"name": "x", "calories": 100, "meal_type": "brunch"}, timeout=15)
        assert r.status_code == 422


# ---------------- Measurements ----------------
class TestMeasurements:
    def test_measurement_partial_crud(self, s, auth):
        r = s.post(f"{API}/measurements", headers=auth, json={"weight_kg": 75.5, "note": "TEST"}, timeout=15)
        assert r.status_code == 200
        m = r.json()
        mid = m["id"]
        assert m["weight_kg"] == 75.5
        assert m["chest_cm"] is None

        r = s.get(f"{API}/measurements", headers=auth, timeout=15)
        assert r.status_code == 200
        assert any(x["id"] == mid for x in r.json())

        r = s.delete(f"{API}/measurements/{mid}", headers=auth, timeout=15)
        assert r.status_code == 200


# ---------------- Summary ----------------
class TestSummary:
    def test_summary_today(self, s, auth):
        r = s.get(f"{API}/summary/today", headers=auth, timeout=15)
        assert r.status_code == 200
        data = r.json()
        for k in ["calorie_goal", "calories_consumed", "calories_remaining", "meals_today", "workouts_done_this_week"]:
            assert k in data
        assert isinstance(data["calorie_goal"], int)
        assert data["calories_remaining"] == data["calorie_goal"] - data["calories_consumed"]



# ---------------- History & Stats (NEW iteration 2) ----------------
class TestHistoryStats:
    def test_history_stats_shape(self, s, auth):
        r = s.get(f"{API}/workouts/history/stats", headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["total_completed", "current_streak_weeks", "best_streak_weeks", "weekly", "recent"]:
            assert k in d, f"missing key {k}"
        assert isinstance(d["total_completed"], int)
        assert isinstance(d["current_streak_weeks"], int)
        assert isinstance(d["best_streak_weeks"], int)
        assert isinstance(d["weekly"], list) and len(d["weekly"]) == 8, f"expected 8 weeks, got {len(d['weekly'])}"
        for w in d["weekly"]:
            assert set(["week", "count", "label"]).issubset(w.keys())
            assert isinstance(w["count"], int)
        assert isinstance(d["recent"], list)

    def test_history_increment_on_complete(self, s, auth):
        before = s.get(f"{API}/workouts/history/stats", headers=auth, timeout=15).json()
        prev_total = before["total_completed"]
        # Create and complete a workout
        create = s.post(f"{API}/workouts", headers=auth, json={"title": "TEST HistIncr", "description": "", "exercises": []}, timeout=15)
        assert create.status_code == 200
        wid = create.json()["id"]
        comp = s.post(f"{API}/workouts/{wid}/complete", headers=auth, timeout=15)
        assert comp.status_code == 200
        after = s.get(f"{API}/workouts/history/stats", headers=auth, timeout=15).json()
        assert after["total_completed"] == prev_total + 1
        # current streak must be >= 1 (this week has at least one)
        assert after["current_streak_weeks"] >= 1
        # Recent contains our workout
        assert any(x["id"] == wid for x in after["recent"])
        # cleanup
        s.delete(f"{API}/workouts/{wid}", headers=auth, timeout=15)


# ---------------- Coach IA chat (NEW iteration 2) ----------------
class TestCoachChat:
    def test_coach_chat_general_and_persistence(self, s, auth):
        # Clear scope first
        s.delete(f"{API}/coach/messages", headers=auth, timeout=15)
        r = s.post(f"{API}/coach/chat", headers=auth, json={"message": "Bonjour coach, un conseil rapide ?"}, timeout=90)
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["role"] == "assistant"
        assert m["workout_id"] is None
        assert isinstance(m["content"], str) and len(m["content"]) > 0
        # Persistence: list should return >= 2 (user + assistant)
        r2 = s.get(f"{API}/coach/messages", headers=auth, timeout=15)
        assert r2.status_code == 200
        msgs = r2.json()
        roles = [x["role"] for x in msgs]
        assert "user" in roles and "assistant" in roles
        # Chronological order
        ts = [x["created_at"] for x in msgs]
        assert ts == sorted(ts)
        # cleanup
        s.delete(f"{API}/coach/messages", headers=auth, timeout=15)
        assert s.get(f"{API}/coach/messages", headers=auth, timeout=15).json() == []

    def test_coach_chat_scoped_to_workout(self, s, auth):
        # Create workout
        create = s.post(f"{API}/workouts", headers=auth, json={
            "title": "TEST Coach Scope",
            "description": "haut du corps",
            "exercises": [{"id": str(uuid.uuid4()), "name": "Pompes", "sets": 3, "reps": "10", "rest_seconds": 60, "notes": ""}],
        }, timeout=15)
        wid = create.json()["id"]
        # Clear scoped
        s.delete(f"{API}/coach/messages?workout_id={wid}", headers=auth, timeout=15)
        s.delete(f"{API}/coach/messages", headers=auth, timeout=15)
        # Post scoped message
        r = s.post(f"{API}/coach/chat", headers=auth, json={"message": "Comment améliorer ma forme ?", "workout_id": wid}, timeout=90)
        assert r.status_code == 200, r.text
        assert r.json()["workout_id"] == wid
        # Scoped list has messages
        scoped = s.get(f"{API}/coach/messages?workout_id={wid}", headers=auth, timeout=15).json()
        assert len(scoped) >= 2
        assert all(x["workout_id"] == wid for x in scoped)
        # General list must NOT include the scoped messages
        general = s.get(f"{API}/coach/messages", headers=auth, timeout=15).json()
        assert all(x["workout_id"] is None for x in general)
        assert not any(x["id"] in [m["id"] for m in scoped] for x in general)
        # Delete scoped clears only that scope
        s.delete(f"{API}/coach/messages?workout_id={wid}", headers=auth, timeout=15)
        assert s.get(f"{API}/coach/messages?workout_id={wid}", headers=auth, timeout=15).json() == []
        # cleanup workout
        s.delete(f"{API}/workouts/{wid}", headers=auth, timeout=15)

    def test_coach_chat_validation(self, s, auth):
        r = s.post(f"{API}/coach/chat", headers=auth, json={"message": ""}, timeout=15)
        assert r.status_code == 422



# ---------------- Profile (NEW iteration 3) ----------------
class TestProfile:
    def _register(self, s):
        email = f"TEST_{uuid.uuid4().hex[:8]}@bp.com"
        r = s.post(f"{API}/auth/register", json={"email": email, "password": "abcdef", "name": "TEST U"}, timeout=15)
        assert r.status_code == 200
        return r.json()["token"], r.json()["user"], email

    def _auth(self, token):
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def test_new_user_has_default_profile_fields(self, s):
        token, u, _ = self._register(s)
        # /auth/me returns new fields
        r = s.get(f"{API}/auth/me", headers=self._auth(token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        for k in ["sex", "age", "height_cm", "weight_kg", "activity_level", "fitness_goal", "calorie_goal_auto"]:
            assert k in data, f"missing {k}"
        assert data["sex"] is None
        assert data["age"] is None
        assert data["calorie_goal_auto"] is True
        assert data["calorie_goal"] == 2000

    def test_profile_update_computes_male(self, s):
        token, _, _ = self._register(s)
        body = {"sex": "homme", "age": 30, "height_cm": 180, "weight_kg": 75,
                "activity_level": "modéré", "fitness_goal": "prise de masse"}
        r = s.put(f"{API}/user/profile", headers=self._auth(token), json=body, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # BMR = 10*75 + 6.25*180 - 5*30 + 5 = 1730 ; TDEE = 1730*1.55 = 2681.5 ; +400 = 3081.5 → 3080
        assert data["calorie_goal"] == 3080, f"expected 3080, got {data['calorie_goal']}"
        assert data["calorie_goal_auto"] is True
        assert data["sex"] == "homme"
        assert data["age"] == 30
        assert data["height_cm"] == 180
        assert data["weight_kg"] == 75
        assert data["activity_level"] == "modéré"
        assert data["fitness_goal"] == "prise de masse"

    def test_profile_update_computes_female(self, s):
        token, _, _ = self._register(s)
        body = {"sex": "femme", "age": 25, "height_cm": 165, "weight_kg": 60,
                "activity_level": "léger", "fitness_goal": "sèche"}
        r = s.put(f"{API}/user/profile", headers=self._auth(token), json=body, timeout=15)
        assert r.status_code == 200, r.text
        # BMR = 10*60 + 6.25*165 - 5*25 - 161 = 1345.25 ; *1.375 = 1849.72 ; -400 = 1449.72 → 1450
        assert r.json()["calorie_goal"] == 1450, r.json()

    def test_profile_persists_via_me(self, s):
        token, _, _ = self._register(s)
        body = {"sex": "femme", "age": 40, "height_cm": 170, "weight_kg": 65,
                "activity_level": "actif", "fitness_goal": "maintien"}
        s.put(f"{API}/user/profile", headers=self._auth(token), json=body, timeout=15)
        r = s.get(f"{API}/auth/me", headers=self._auth(token), timeout=15)
        data = r.json()
        assert data["sex"] == "femme"
        assert data["fitness_goal"] == "maintien"
        assert data["calorie_goal_auto"] is True
        # 10*65 + 6.25*170 - 5*40 - 161 = 650+1062.5-200-161 = 1351.5 ; *1.725 = 2331.34 ; +0 → 2330
        assert data["calorie_goal"] == 2330

    def test_profile_validation_errors(self, s):
        token, _, _ = self._register(s)
        h = self._auth(token)
        base = {"sex": "homme", "age": 30, "height_cm": 180, "weight_kg": 75,
                "activity_level": "modéré", "fitness_goal": "prise de masse"}

        cases = [
            {**base, "sex": "autre"},                     # invalid sex
            {**base, "age": 5},                            # under min
            {**base, "age": 150},                          # above max
            {**base, "activity_level": "hyperactif"},      # invalid activity
            {**base, "fitness_goal": "tonification"},      # invalid goal
            {**base, "height_cm": 100},                    # under min
            {**base, "height_cm": 300},                    # above max
            {**base, "weight_kg": 20},                     # under min
            {**base, "weight_kg": 400},                    # above max
        ]
        for c in cases:
            r = s.put(f"{API}/user/profile", headers=h, json=c, timeout=15)
            assert r.status_code == 422, f"case {c} should 422, got {r.status_code} {r.text}"

    def test_manual_calorie_goal_flips_auto_and_persists(self, s):
        token, _, _ = self._register(s)
        h = self._auth(token)
        # First set profile → auto = true
        s.put(f"{API}/user/profile", headers=h, json={"sex": "homme", "age": 30, "height_cm": 180,
             "weight_kg": 75, "activity_level": "modéré", "fitness_goal": "prise de masse"}, timeout=15)
        # Manual override
        r = s.put(f"{API}/user/calorie-goal", headers=h, json={"calorie_goal": 2500}, timeout=15)
        assert r.status_code == 200
        assert r.json()["calorie_goal"] == 2500
        assert r.json()["calorie_goal_auto"] is False
        # Verify via /me
        r2 = s.get(f"{API}/auth/me", headers=h, timeout=15)
        assert r2.json()["calorie_goal"] == 2500
        assert r2.json()["calorie_goal_auto"] is False

    def test_profile_update_flips_auto_back_true(self, s):
        token, _, _ = self._register(s)
        h = self._auth(token)
        s.put(f"{API}/user/calorie-goal", headers=h, json={"calorie_goal": 2500}, timeout=15)
        assert s.get(f"{API}/auth/me", headers=h, timeout=15).json()["calorie_goal_auto"] is False
        # Now profile PUT should recompute and mark auto=true
        r = s.put(f"{API}/user/profile", headers=h, json={"sex": "homme", "age": 30, "height_cm": 180,
             "weight_kg": 75, "activity_level": "modéré", "fitness_goal": "prise de masse"}, timeout=15)
        assert r.json()["calorie_goal_auto"] is True
        assert r.json()["calorie_goal"] == 3080

    def test_profile_requires_auth(self, s):
        r = s.put(f"{API}/user/profile", json={"sex": "homme", "age": 30, "height_cm": 180,
             "weight_kg": 75, "activity_level": "modéré", "fitness_goal": "prise de masse"}, timeout=15)
        assert r.status_code in (401, 403)


# ---------------- Adaptive calorie adjustment (NEW iteration 4) ----------------
# These tests use a direct MongoDB connection to backdate measurements
# (the API always inserts with server-side created_at = now).
from datetime import datetime, timezone, timedelta  # noqa: E402
from pymongo import MongoClient  # noqa: E402
from dotenv import load_dotenv  # noqa: E402
from pathlib import Path  # noqa: E402

load_dotenv(Path(__file__).parent.parent / ".env")
_MONGO = MongoClient(os.environ["MONGO_URL"])
_DB = _MONGO[os.environ["DB_NAME"]]


def _register_user(s):
    email = f"TEST_iter4_{uuid.uuid4().hex[:8]}@bp.com"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "abcdef", "name": "TEST iter4"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"], r.json()["user"], email


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _set_profile(s, token, goal="prise de masse", weight_kg=75.0):
    body = {"sex": "homme", "age": 30, "height_cm": 180, "weight_kg": weight_kg,
            "activity_level": "modéré", "fitness_goal": goal}
    r = s.put(f"{API}/user/profile", headers=_h(token), json=body, timeout=15)
    assert r.status_code == 200
    return r.json()


def _insert_measurement_backdated(user_id: str, weight_kg: float, days_ago: float):
    """Insert a measurement bypassing the API so we can backdate created_at."""
    ts = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
    _DB.measurements.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "weight_kg": weight_kg,
        "chest_cm": None, "waist_cm": None, "hips_cm": None,
        "arm_cm": None, "thigh_cm": None, "note": "TEST_iter4",
        "created_at": ts,
    })


class TestCalorieRecommendation:
    def test_me_exposes_new_adjust_fields(self, s, auth):
        r = s.get(f"{API}/auth/me", headers=auth, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "calorie_last_adjust_at" in data
        assert "calorie_last_adjust_reason" in data

    def test_reco_no_profile(self, s):
        token, _, _ = _register_user(s)
        r = s.get(f"{API}/user/calorie-recommendation", headers=_h(token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["applicable"] is False
        assert d["status"] == "no_profile"
        assert d["current_goal"] == 2000
        assert d["suggested_goal"] == 2000
        assert d["weekly_change_kg"] is None
        assert d["span_days"] is None

    def test_reco_insufficient_data_no_measurement(self, s):
        token, _, _ = _register_user(s)
        _set_profile(s, token)
        r = s.get(f"{API}/user/calorie-recommendation", headers=_h(token), timeout=15)
        d = r.json()
        assert d["applicable"] is False
        assert d["status"] == "insufficient_data"

    def test_reco_insufficient_data_span_less_than_7_days(self, s):
        token, u, _ = _register_user(s)
        _set_profile(s, token)
        # Two measurements only 3 days apart via backdating
        _insert_measurement_backdated(u["id"], 75.0, days_ago=3)
        _insert_measurement_backdated(u["id"], 75.3, days_ago=0)
        r = s.get(f"{API}/user/calorie-recommendation", headers=_h(token), timeout=15)
        d = r.json()
        assert d["applicable"] is False
        assert d["status"] == "insufficient_data"

    def test_reco_seed_user_prise_de_masse_below(self, s, auth):
        """Seed user has 2 measurements 14d apart (75.0 → 75.1) = ~0.05 kg/week < 0.2 (below range)."""
        r = s.get(f"{API}/user/calorie-recommendation", headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["applicable"] is True
        assert d["status"] == "below"
        assert d["should_adjust"] is True
        assert d["delta_kcal"] == 150
        assert d["weekly_change_kg"] == 0.05
        assert 13.5 <= d["span_days"] <= 14.5
        assert d["target_range_kg_per_week"] == [0.2, 0.5]
        assert d["suggested_goal"] == d["current_goal"] + 150
        assert "Progression trop lente" in d["reason"]

    def test_reco_prise_de_masse_on_track(self, s):
        """Weekly gain within [0.2, 0.5] → on_track, should_adjust=false."""
        token, u, _ = _register_user(s)
        _set_profile(s, token)  # base 3080 for prise de masse
        _insert_measurement_backdated(u["id"], 75.0, days_ago=14)
        _insert_measurement_backdated(u["id"], 75.6, days_ago=0)  # +0.6 in 14d = +0.3/w
        r = s.get(f"{API}/user/calorie-recommendation", headers=_h(token), timeout=15)
        d = r.json()
        assert d["applicable"] is True
        assert d["status"] == "on_track"
        assert d["should_adjust"] is False
        assert d["delta_kcal"] == 0
        assert d["suggested_goal"] == d["current_goal"]

    def test_reco_prise_de_masse_above(self, s):
        """Weekly gain > 0.5 → above, delta -150."""
        token, u, _ = _register_user(s)
        _set_profile(s, token)
        _insert_measurement_backdated(u["id"], 75.0, days_ago=14)
        _insert_measurement_backdated(u["id"], 77.0, days_ago=0)  # +2 kg in 14d = +1/w
        r = s.get(f"{API}/user/calorie-recommendation", headers=_h(token), timeout=15)
        d = r.json()
        assert d["status"] == "above"
        assert d["delta_kcal"] == -150
        assert d["should_adjust"] is True

    def test_reco_seche_losing_too_fast_protects_muscle(self, s):
        """Sèche: weekly change < -0.7 (too fast) → +150 (protect muscle mass)."""
        token, u, _ = _register_user(s)
        _set_profile(s, token, goal="sèche")
        _insert_measurement_backdated(u["id"], 75.0, days_ago=14)
        _insert_measurement_backdated(u["id"], 73.0, days_ago=0)  # -2 kg in 14d = -1/w
        r = s.get(f"{API}/user/calorie-recommendation", headers=_h(token), timeout=15)
        d = r.json()
        assert d["status"] == "above"  # backend labels 'too fast loss' as 'above' target severity
        assert d["delta_kcal"] == 150
        assert "protéger la masse musculaire" in d["reason"]

    def test_reco_seche_not_losing_enough(self, s):
        """Sèche: weekly change > -0.4 (too slow loss) → -150."""
        token, u, _ = _register_user(s)
        _set_profile(s, token, goal="sèche")
        _insert_measurement_backdated(u["id"], 75.0, days_ago=14)
        _insert_measurement_backdated(u["id"], 74.9, days_ago=0)  # -0.05/w only
        r = s.get(f"{API}/user/calorie-recommendation", headers=_h(token), timeout=15)
        d = r.json()
        assert d["status"] == "below"
        assert d["delta_kcal"] == -150

    def test_reco_maintien_stable(self, s):
        token, u, _ = _register_user(s)
        _set_profile(s, token, goal="maintien")
        _insert_measurement_backdated(u["id"], 75.0, days_ago=14)
        _insert_measurement_backdated(u["id"], 75.1, days_ago=0)  # +0.05/w within [-0.2, +0.2]
        r = s.get(f"{API}/user/calorie-recommendation", headers=_h(token), timeout=15)
        d = r.json()
        assert d["status"] == "on_track"
        assert d["should_adjust"] is False

    def test_apply_reco_updates_user_goal_and_reason(self, s):
        token, u, _ = _register_user(s)
        _set_profile(s, token)  # 3080
        _insert_measurement_backdated(u["id"], 75.0, days_ago=14)
        _insert_measurement_backdated(u["id"], 75.05, days_ago=0)  # very slow ~0.025/w
        # Apply
        r = s.post(f"{API}/user/calorie-recommendation/apply", headers=_h(token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["applied"] is True
        assert d["new_goal"] == 3080 + 150
        assert d["delta_kcal"] == 150
        # /me now returns updated goal + reason + timestamp
        me = s.get(f"{API}/auth/me", headers=_h(token), timeout=15).json()
        assert me["calorie_goal"] == 3230
        assert me["calorie_last_adjust_reason"] is not None
        assert me["calorie_last_adjust_at"] is not None

    def test_apply_reco_no_adjustment_needed(self, s):
        token, u, _ = _register_user(s)
        _set_profile(s, token)
        _insert_measurement_backdated(u["id"], 75.0, days_ago=14)
        _insert_measurement_backdated(u["id"], 75.6, days_ago=0)  # on_track
        r = s.post(f"{API}/user/calorie-recommendation/apply", headers=_h(token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["applied"] is False
        assert "current_goal" in d

    def test_apply_reco_no_profile(self, s):
        token, _, _ = _register_user(s)
        r = s.post(f"{API}/user/calorie-recommendation/apply", headers=_h(token), timeout=15)
        assert r.status_code == 400

    def test_apply_reco_insufficient_data(self, s):
        token, _, _ = _register_user(s)
        _set_profile(s, token)
        r = s.post(f"{API}/user/calorie-recommendation/apply", headers=_h(token), timeout=15)
        assert r.status_code == 400

    def test_auto_adjust_on_new_weight_measurement(self, s):
        """POST /api/measurements with weight_kg triggers adaptive adjust if enough history."""
        token, u, _ = _register_user(s)
        _set_profile(s, token)  # 3080 kcal
        # Backdate 1 old measurement (14 days ago), then post a new one via API → should trigger auto-adjust
        _insert_measurement_backdated(u["id"], 75.0, days_ago=14)
        me_before = s.get(f"{API}/auth/me", headers=_h(token), timeout=15).json()
        assert me_before["calorie_goal"] == 3080
        assert me_before["calorie_last_adjust_at"] is None

        r = s.post(f"{API}/measurements", headers=_h(token), json={"weight_kg": 75.05}, timeout=15)
        assert r.status_code == 200
        me_after = s.get(f"{API}/auth/me", headers=_h(token), timeout=15).json()
        assert me_after["calorie_goal"] == 3230, f"expected 3230 (+150), got {me_after['calorie_goal']}"
        assert me_after["calorie_last_adjust_at"] is not None
        assert me_after["calorie_last_adjust_reason"] is not None

    def test_auto_adjust_cooldown_blocks_second_within_7_days(self, s):
        token, u, _ = _register_user(s)
        _set_profile(s, token)
        _insert_measurement_backdated(u["id"], 75.0, days_ago=14)
        # First weight via API: triggers auto-adjust
        s.post(f"{API}/measurements", headers=_h(token), json={"weight_kg": 75.05}, timeout=15)
        goal_after_first = s.get(f"{API}/auth/me", headers=_h(token), timeout=15).json()["calorie_goal"]
        assert goal_after_first == 3230
        # Second weight via API: cooldown 7 days should block adjustment
        s.post(f"{API}/measurements", headers=_h(token), json={"weight_kg": 75.1}, timeout=15)
        goal_after_second = s.get(f"{API}/auth/me", headers=_h(token), timeout=15).json()["calorie_goal"]
        assert goal_after_second == goal_after_first, "cooldown should prevent second auto-adjust within 7 days"

    def test_profile_update_resets_adjust_fields(self, s):
        """PUT /api/user/profile must reset calorie_last_adjust_at and calorie_last_adjust_reason."""
        token, u, _ = _register_user(s)
        _set_profile(s, token)
        # Directly set adjust fields via DB
        _DB.users.update_one(
            {"id": u["id"]},
            {"$set": {"calorie_last_adjust_at": datetime.now(timezone.utc).isoformat(),
                      "calorie_last_adjust_reason": "TEST_iter4_reason"}}
        )
        # PUT profile
        r = s.put(f"{API}/user/profile", headers=_h(token), json={
            "sex": "homme", "age": 30, "height_cm": 180, "weight_kg": 75,
            "activity_level": "modéré", "fitness_goal": "prise de masse"
        }, timeout=15)
        d = r.json()
        assert d["calorie_last_adjust_at"] is None
        assert d["calorie_last_adjust_reason"] is None

    def test_auto_adjust_bounds_max_5000(self, s):
        """calorie_goal cannot exceed 5000 via adaptive adjust."""
        token, u, _ = _register_user(s)
        _set_profile(s, token)
        # Directly bump calorie_goal near max
        _DB.users.update_one({"id": u["id"]}, {"$set": {"calorie_goal": 4950}})
        _insert_measurement_backdated(u["id"], 75.0, days_ago=14)
        _insert_measurement_backdated(u["id"], 75.05, days_ago=0)  # below → +150 would exceed 5000
        r = s.get(f"{API}/user/calorie-recommendation", headers=_h(token), timeout=15)
        d = r.json()
        # Suggested goal must be capped at 5000
        assert d["suggested_goal"] == 5000
        # Because clamped delta becomes +50 not +150; server sets delta=0 (should_adjust false when new==current)
        # Apply then: check nothing exceeds 5000
        _DB.users.update_one({"id": u["id"]}, {"$set": {"calorie_goal": 5000}})
        r2 = s.post(f"{API}/user/calorie-recommendation/apply", headers=_h(token), timeout=15)
        assert r2.status_code == 200
        d2 = r2.json()
        # applied False since already at max
        assert d2["applied"] is False

    def test_auto_adjust_bounds_min_1200(self, s):
        """calorie_goal cannot go below 1200 via adaptive adjust (sèche too slow → -150)."""
        token, u, _ = _register_user(s)
        _set_profile(s, token, goal="sèche")
        _DB.users.update_one({"id": u["id"]}, {"$set": {"calorie_goal": 1250}})
        _insert_measurement_backdated(u["id"], 75.0, days_ago=14)
        _insert_measurement_backdated(u["id"], 74.95, days_ago=0)  # too slow → -150 wanted
        r = s.get(f"{API}/user/calorie-recommendation", headers=_h(token), timeout=15)
        d = r.json()
        assert d["suggested_goal"] == 1200

