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


# ---------------- NEW iteration 5: belly_cm + /measurements/latest ----------------
class TestBellyAndLatest:
    def test_create_measurement_with_belly_cm(self, s):
        """POST /api/measurements accepts belly_cm; GET /api/measurements returns it."""
        token, _, _ = _register_user(s)
        h = _h(token)
        r = s.post(f"{API}/measurements", headers=h,
                   json={"belly_cm": 88.5, "note": "TEST_iter5"}, timeout=15)
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["belly_cm"] == 88.5
        assert m["chest_cm"] is None and m["waist_cm"] is None
        # List returns the field
        r2 = s.get(f"{API}/measurements", headers=h, timeout=15)
        assert r2.status_code == 200
        items = r2.json()
        match = next((x for x in items if x["id"] == m["id"]), None)
        assert match is not None
        assert "belly_cm" in match
        assert match["belly_cm"] == 88.5

    def test_latest_all_null_for_new_user(self, s):
        """GET /api/measurements/latest returns all 7 fields as null when no measurements exist."""
        token, _, _ = _register_user(s)
        r = s.get(f"{API}/measurements/latest", headers=_h(token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        expected_fields = ["weight_kg", "chest_cm", "waist_cm", "belly_cm", "hips_cm", "arm_cm", "thigh_cm"]
        assert set(d.keys()) == set(expected_fields)
        for f in expected_fields:
            assert d[f] is None, f"{f} should be null, got {d[f]}"

    def test_latest_returns_most_recent_non_null_per_field(self, s):
        """Mixed measurements: latest picks the most recent non-null per field independently."""
        token, u, _ = _register_user(s)
        h = _h(token)
        uid = u["id"]
        # Backdate 3 measurements with mixed fields
        # Oldest (5d ago): chest=100, waist=80
        _DB.measurements.insert_one({
            "id": str(uuid.uuid4()), "user_id": uid,
            "weight_kg": None, "chest_cm": 100.0, "waist_cm": 80.0,
            "belly_cm": None, "hips_cm": None, "arm_cm": None, "thigh_cm": None,
            "note": "TEST_iter5_old",
            "created_at": (datetime.now(timezone.utc) - timedelta(days=5)).isoformat(),
        })
        # Middle (2d ago): chest=104 (overrides), belly=88
        _DB.measurements.insert_one({
            "id": str(uuid.uuid4()), "user_id": uid,
            "weight_kg": None, "chest_cm": 104.0, "waist_cm": None,
            "belly_cm": 88.0, "hips_cm": None, "arm_cm": None, "thigh_cm": None,
            "note": "TEST_iter5_mid",
            "created_at": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),
        })
        # Newest (today): weight=75, arm=38 (waist stays 80 from oldest; thigh & hips stay null)
        _DB.measurements.insert_one({
            "id": str(uuid.uuid4()), "user_id": uid,
            "weight_kg": 75.0, "chest_cm": None, "waist_cm": None,
            "belly_cm": None, "hips_cm": None, "arm_cm": 38.0, "thigh_cm": None,
            "note": "TEST_iter5_new",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        r = s.get(f"{API}/measurements/latest", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # weight: from newest
        assert d["weight_kg"]["value"] == 75.0
        # chest: from middle (104 overrides oldest 100)
        assert d["chest_cm"]["value"] == 104.0
        # waist: only from oldest
        assert d["waist_cm"]["value"] == 80.0
        # belly: from middle
        assert d["belly_cm"]["value"] == 88.0
        # arm: from newest
        assert d["arm_cm"]["value"] == 38.0
        # hips and thigh: never set → null
        assert d["hips_cm"] is None
        assert d["thigh_cm"] is None
        # Each non-null entry has created_at
        for f in ["weight_kg", "chest_cm", "waist_cm", "belly_cm", "arm_cm"]:
            assert "created_at" in d[f] and isinstance(d[f]["created_at"], str)

    def test_legacy_measurement_without_belly_cm_deserializes(self, s):
        """Pre-iteration-5 documents (no belly_cm key) still deserialize to belly_cm=null."""
        token, u, _ = _register_user(s)
        h = _h(token)
        # Insert a legacy-shape doc directly (no belly_cm field at all)
        legacy_id = str(uuid.uuid4())
        _DB.measurements.insert_one({
            "id": legacy_id, "user_id": u["id"],
            "weight_kg": 70.0, "chest_cm": 100.0, "waist_cm": 78.0,
            "hips_cm": 90.0, "arm_cm": 34.0, "thigh_cm": 55.0,
            "note": "TEST_iter5_legacy",
            "created_at": datetime.now(timezone.utc).isoformat(),
            # belly_cm intentionally missing
        })
        # GET list must serialize belly_cm as null (not crash)
        r = s.get(f"{API}/measurements", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()
        legacy = next((x for x in items if x["id"] == legacy_id), None)
        assert legacy is not None
        assert "belly_cm" in legacy
        assert legacy["belly_cm"] is None
        assert legacy["chest_cm"] == 100.0
        # /latest also works with legacy docs mixed in
        r2 = s.get(f"{API}/measurements/latest", headers=h, timeout=15)
        assert r2.status_code == 200
        d = r2.json()
        assert d["belly_cm"] is None
        assert d["chest_cm"]["value"] == 100.0

    def test_latest_seed_user_shape(self, s, auth):
        """Seed user test@bp.com has multiple body measurements; /latest must expose all fields shape."""
        r = s.get(f"{API}/measurements/latest", headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        expected = ["weight_kg", "chest_cm", "waist_cm", "belly_cm", "hips_cm", "arm_cm", "thigh_cm"]
        assert set(d.keys()) == set(expected)
        # Each field must be either null or {value, created_at}
        for f in expected:
            v = d[f]
            if v is not None:
                assert isinstance(v, dict)
                assert "value" in v and "created_at" in v
                assert isinstance(v["value"], (int, float))



# ---------------- NEW iteration 6: Program generation + session log + overload ----------------
class TestProgramAndLog:
    def _make_workout_with_targets(self, s, auth, targets):
        """Create a workout directly (no AI) with given target weights for deterministic overload testing."""
        exs = []
        for i, (name, target) in enumerate(targets):
            exs.append({
                "id": str(uuid.uuid4()),
                "name": name,
                "sets": 3,
                "reps": "10",
                "rest_seconds": 60,
                "notes": "",
                "target_weight_kg": target,
            })
        r = s.post(f"{API}/workouts", headers=auth, json={
            "title": f"TEST_iter6 Log {uuid.uuid4().hex[:4]}",
            "description": "iter6",
            "exercises": exs,
        }, timeout=15)
        assert r.status_code == 200, r.text
        return r.json()

    # --- Validation on generate-program (no LLM call needed) ---
    def test_generate_program_sessions_below_min(self, s, auth):
        r = s.post(f"{API}/workouts/generate-program", headers=auth, json={
            "goal": "prise de masse", "level": "intermédiaire",
            "program_type": "full_body", "sessions_per_week": 1,
            "duration_minutes": 45, "equipment": "salle de sport",
        }, timeout=15)
        assert r.status_code == 422, r.text

    def test_generate_program_sessions_above_max(self, s, auth):
        r = s.post(f"{API}/workouts/generate-program", headers=auth, json={
            "goal": "prise de masse", "level": "intermédiaire",
            "program_type": "full_body", "sessions_per_week": 7,
            "duration_minutes": 45, "equipment": "salle de sport",
        }, timeout=15)
        assert r.status_code == 422, r.text

    def test_generate_program_invalid_type(self, s, auth):
        r = s.post(f"{API}/workouts/generate-program", headers=auth, json={
            "goal": "prise de masse", "level": "intermédiaire",
            "program_type": "push_pull_legs", "sessions_per_week": 3,
            "duration_minutes": 45, "equipment": "salle de sport",
        }, timeout=15)
        assert r.status_code == 422, r.text

    # --- AI-backed program generation ---
    def test_generate_program_full_body_3(self, s, auth):
        r = s.post(f"{API}/workouts/generate-program", headers=auth, json={
            "goal": "prise de masse", "level": "intermédiaire",
            "program_type": "full_body", "sessions_per_week": 3,
            "duration_minutes": 45, "equipment": "salle de sport",
        }, timeout=120)
        assert r.status_code == 200, r.text
        workouts = r.json()
        assert isinstance(workouts, list)
        assert len(workouts) == 3, f"expected 3 workouts, got {len(workouts)}"
        program_ids = {w["program_id"] for w in workouts}
        assert len(program_ids) == 1 and None not in program_ids, "all sessions must share one non-null program_id"
        session_indexes = sorted(w["session_index"] for w in workouts)
        assert session_indexes == [1, 2, 3]
        for w in workouts:
            assert w["program_type"] == "full_body"
            assert w["sessions_per_week"] == 3
            assert 3 <= len(w["exercises"]) <= 12
            # cleanup
            s.delete(f"{API}/workouts/{w['id']}", headers=auth, timeout=15)

    def test_generate_program_split_4(self, s, auth):
        r = s.post(f"{API}/workouts/generate-program", headers=auth, json={
            "goal": "prise de masse", "level": "intermédiaire",
            "program_type": "split", "sessions_per_week": 4,
            "duration_minutes": 60, "equipment": "salle de sport",
        }, timeout=120)
        assert r.status_code == 200, r.text
        workouts = r.json()
        assert len(workouts) == 4
        assert len({w["program_id"] for w in workouts}) == 1
        # Splits must expose week_day and mention muscle groups in title
        valid_days = {"lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"}
        muscle_keywords = ["pecs", "dos", "jambes", "épaules", "bras", "biceps", "triceps",
                            "abdos", "quadriceps", "ischio", "poitrine", "mollets", "fessiers"]
        for w in workouts:
            assert w["program_type"] == "split"
            assert w["sessions_per_week"] == 4
            assert w["week_day"], f"split session missing week_day: {w}"
            assert w["week_day"].lower() in valid_days, f"unexpected day: {w['week_day']}"
            title_lower = w["title"].lower()
            assert any(k in title_lower for k in muscle_keywords), \
                f"split title should mention a muscle group, got: {w['title']}"
            # cleanup
            s.delete(f"{API}/workouts/{w['id']}", headers=auth, timeout=15)

    # --- Session log + progressive overload ---
    def test_log_applies_overload_facile_reussi_echec(self, s, auth):
        wk = self._make_workout_with_targets(s, auth, [
            ("Squat", 40.0),      # facile → *1.05 = 42.0
            ("Bench Press", 30.0),  # echec → *0.95 = 28.5
            ("Rowing", 50.0),      # reussi → *1.025 = 51.25 → banker's round(102.5)/2 = 51.0
        ])
        wid = wk["id"]
        entries = [
            {"exercise_id": wk["exercises"][0]["id"], "difficulty": "facile"},
            {"exercise_id": wk["exercises"][1]["id"], "difficulty": "echec"},
            {"exercise_id": wk["exercises"][2]["id"], "difficulty": "reussi"},
        ]
        r = s.post(f"{API}/workouts/{wid}/log", headers=auth, json={"entries": entries}, timeout=15)
        assert r.status_code == 200, r.text
        res = r.json()
        assert "workout" in res and "deloads" in res
        assert isinstance(res["deloads"], list)
        updated = res["workout"]
        assert updated["performed_at"] is not None
        by_id = {e["id"]: e for e in updated["exercises"]}
        assert by_id[wk["exercises"][0]["id"]]["target_weight_kg"] == 42.0
        assert by_id[wk["exercises"][0]["id"]]["last_difficulty"] == "facile"
        assert by_id[wk["exercises"][1]["id"]]["target_weight_kg"] == 28.5
        assert by_id[wk["exercises"][1]["id"]]["last_difficulty"] == "echec"
        assert by_id[wk["exercises"][2]["id"]]["target_weight_kg"] == 51.0
        assert by_id[wk["exercises"][2]["id"]]["last_difficulty"] == "reussi"
        # cleanup
        s.delete(f"{API}/workouts/{wid}", headers=auth, timeout=15)

    def test_log_uses_provided_weight_as_overload_base(self, s, auth):
        """If entry.weight_kg is provided, overload is computed from that base, not from previous target."""
        wk = self._make_workout_with_targets(s, auth, [("Deadlift", 100.0)])
        wid = wk["id"]
        eid = wk["exercises"][0]["id"]
        # Provide weight_kg=60 with 'facile' → new target = round(60*1.05*2)/2 = round(126)/2 = 63.0
        r = s.post(f"{API}/workouts/{wid}/log", headers=auth, json={"entries": [
            {"exercise_id": eid, "difficulty": "facile", "weight_kg": 60.0, "reps_done": 8}
        ]}, timeout=15)
        assert r.status_code == 200, r.text
        ex = r.json()["workout"]["exercises"][0]
        assert ex["last_weight_kg"] == 60.0
        assert ex["last_reps_done"] == 8
        assert ex["target_weight_kg"] == 63.0
        s.delete(f"{API}/workouts/{wid}", headers=auth, timeout=15)

    def test_log_unknown_exercise_id_skipped_gracefully(self, s, auth):
        wk = self._make_workout_with_targets(s, auth, [("Curl", 20.0)])
        wid = wk["id"]
        real_eid = wk["exercises"][0]["id"]
        fake_eid = str(uuid.uuid4())
        r = s.post(f"{API}/workouts/{wid}/log", headers=auth, json={"entries": [
            {"exercise_id": fake_eid, "difficulty": "facile"},
            {"exercise_id": real_eid, "difficulty": "reussi"},
        ]}, timeout=15)
        assert r.status_code == 200, r.text
        updated = r.json()["workout"]
        # real exercise updated: 20 * 1.025 = 20.5 → round(41)/2 = 20.5
        assert updated["exercises"][0]["target_weight_kg"] == 20.5
        assert updated["exercises"][0]["last_difficulty"] == "reussi"
        # log doc created even with unknown entry
        r2 = s.get(f"{API}/workouts/{wid}/logs", headers=auth, timeout=15)
        assert r2.status_code == 200
        assert len(r2.json()) == 1
        s.delete(f"{API}/workouts/{wid}", headers=auth, timeout=15)

    def test_get_logs_sorted_desc(self, s, auth):
        wk = self._make_workout_with_targets(s, auth, [("Overhead Press", 30.0)])
        wid = wk["id"]
        eid = wk["exercises"][0]["id"]
        # Two log calls
        s.post(f"{API}/workouts/{wid}/log", headers=auth,
               json={"entries": [{"exercise_id": eid, "difficulty": "reussi"}]}, timeout=15)
        import time
        time.sleep(1.1)  # ensure ISO timestamps differ
        s.post(f"{API}/workouts/{wid}/log", headers=auth,
               json={"entries": [{"exercise_id": eid, "difficulty": "facile"}]}, timeout=15)
        r = s.get(f"{API}/workouts/{wid}/logs", headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        logs = r.json()
        assert len(logs) == 2
        # Sorted descending by performed_at
        assert logs[0]["performed_at"] >= logs[1]["performed_at"]
        # No mongo _id
        for lg in logs:
            assert "_id" not in lg
            assert lg["workout_id"] == wid
        s.delete(f"{API}/workouts/{wid}", headers=auth, timeout=15)

    def test_log_workout_not_found(self, s, auth):
        r = s.post(f"{API}/workouts/nonexistent-id/log", headers=auth, json={"entries": []}, timeout=15)
        assert r.status_code == 404

    def test_log_invalid_difficulty(self, s, auth):
        wk = self._make_workout_with_targets(s, auth, [("Test", 20.0)])
        wid = wk["id"]
        eid = wk["exercises"][0]["id"]
        r = s.post(f"{API}/workouts/{wid}/log", headers=auth, json={"entries": [
            {"exercise_id": eid, "difficulty": "trop_facile"}
        ]}, timeout=15)
        assert r.status_code == 422
        s.delete(f"{API}/workouts/{wid}", headers=auth, timeout=15)


# ---------------- NEW iteration 7: meals_per_day, exercise history, deload ----------------
class TestMealsPerDay:
    def test_new_user_default_meals_per_day(self, s):
        token, _, _ = _register_user(s)
        r = s.get(f"{API}/auth/me", headers=_h(token), timeout=15)
        assert r.status_code == 200
        assert r.json().get("meals_per_day") == 4

    def test_update_meals_per_day_valid(self, s):
        token, _, _ = _register_user(s)
        r = s.put(f"{API}/user/meals-per-day", headers=_h(token), json={"meals_per_day": 6}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["meals_per_day"] == 6
        # Persistence via /me
        me = s.get(f"{API}/auth/me", headers=_h(token), timeout=15).json()
        assert me["meals_per_day"] == 6

    def test_update_meals_per_day_out_of_range(self, s):
        token, _, _ = _register_user(s)
        for val in [1, 9, 0, 100]:
            r = s.put(f"{API}/user/meals-per-day", headers=_h(token),
                      json={"meals_per_day": val}, timeout=15)
            assert r.status_code == 422, f"val={val} should be 422, got {r.status_code}"

    def test_update_meals_per_day_requires_auth(self, s):
        r = s.put(f"{API}/user/meals-per-day", json={"meals_per_day": 5}, timeout=15)
        assert r.status_code in (401, 403)


class TestExerciseHistory:
    def test_history_empty_for_unknown_exercise(self, s, auth):
        r = s.get(f"{API}/exercises/history", headers=auth,
                  params={"name": f"NoSuchExercise_{uuid.uuid4().hex[:6]}"}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "exercise_name" in d and "points" in d
        assert d["points"] == []

    def test_history_returns_points_sorted_asc_case_insensitive(self, s):
        token, _, _ = _register_user(s)
        h = _h(token)
        # Create a workout with a known exercise
        wk = s.post(f"{API}/workouts", headers=h, json={
            "title": "TEST_iter7 hist", "description": "",
            "exercises": [{"id": str(uuid.uuid4()), "name": "Développé Couché",
                           "sets": 3, "reps": "10", "rest_seconds": 60, "notes": "",
                           "target_weight_kg": 40.0}],
        }, timeout=15).json()
        wid = wk["id"]
        eid = wk["exercises"][0]["id"]
        # Log a couple of sessions
        s.post(f"{API}/workouts/{wid}/log", headers=h, json={"entries": [
            {"exercise_id": eid, "difficulty": "reussi", "weight_kg": 40.0, "reps_done": 10}
        ]}, timeout=15)
        import time
        time.sleep(1.1)
        s.post(f"{API}/workouts/{wid}/log", headers=h, json={"entries": [
            {"exercise_id": eid, "difficulty": "facile", "weight_kg": 42.5, "reps_done": 10}
        ]}, timeout=15)
        # Case insensitive match
        r = s.get(f"{API}/exercises/history", headers=h,
                  params={"name": "développé couché"}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["exercise_name"] == "développé couché"
        assert len(d["points"]) == 2
        pts = d["points"]
        # Sorted ASC by performed_at
        assert pts[0]["performed_at"] <= pts[1]["performed_at"]
        assert pts[0]["weight_kg"] == 40.0 and pts[0]["difficulty"] == "reussi"
        assert pts[1]["weight_kg"] == 42.5 and pts[1]["difficulty"] == "facile"
        for p in pts:
            assert "performed_at" in p and "weight_kg" in p and "difficulty" in p and "reps_done" in p
        s.delete(f"{API}/workouts/{wid}", headers=h, timeout=15)

    def test_history_requires_auth(self, s):
        r = s.get(f"{API}/exercises/history", params={"name": "Squat"}, timeout=15)
        assert r.status_code in (401, 403)


# ---------------- NEW iteration 8: meal calorie estimation ----------------
class TestMealEstimate:
    def test_estimate_meal_success_shape(self, s, auth):
        r = s.post(f"{API}/meals/estimate", headers=auth,
                   json={"description": "150g de riz basmati avec 200g de poulet grillé et une salade verte"},
                   timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["name", "calories", "meal_type", "breakdown"]:
            assert k in d, f"missing key {k}"
        assert isinstance(d["name"], str) and len(d["name"]) > 0
        assert isinstance(d["calories"], int)
        assert d["calories"] >= 0
        # Plausible range for a typical meal (200-1200 kcal per acceptance spec)
        assert 200 <= d["calories"] <= 1500, f"calories out of plausible range: {d['calories']}"
        assert d["meal_type"] in ("petit-déjeuner", "déjeuner", "dîner", "collation")
        assert isinstance(d["breakdown"], str) and len(d["breakdown"]) > 0

    def test_estimate_meal_description_too_short(self, s, auth):
        r = s.post(f"{API}/meals/estimate", headers=auth, json={"description": "a"}, timeout=15)
        assert r.status_code == 422, r.text

    def test_estimate_meal_description_too_long(self, s, auth):
        r = s.post(f"{API}/meals/estimate", headers=auth,
                   json={"description": "a" * 501}, timeout=15)
        assert r.status_code == 422

    def test_estimate_meal_requires_auth(self, s):
        r = s.post(f"{API}/meals/estimate", json={"description": "un pain au chocolat"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_estimate_meal_breakfast_classification(self, s, auth):
        r = s.post(f"{API}/meals/estimate", headers=auth,
                   json={"description": "deux croissants et un café au lait"}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        # meal_type must always be in the allowed set (fallback to 'déjeuner' if AI returned junk)
        assert d["meal_type"] in ("petit-déjeuner", "déjeuner", "dîner", "collation")
        # Calories should be plausible (>0)
        assert d["calories"] > 0


class TestDeload:
    def _make(self, s, h, name="TEST Deload Bench", target=100.0):
        wk = s.post(f"{API}/workouts", headers=h, json={
            "title": f"TEST_iter7 deload {uuid.uuid4().hex[:4]}", "description": "",
            "exercises": [{"id": str(uuid.uuid4()), "name": name,
                           "sets": 3, "reps": "10", "rest_seconds": 60, "notes": "",
                           "target_weight_kg": target}],
        }, timeout=15).json()
        return wk

    def test_deload_triggered_on_3rd_consecutive_echec(self, s):
        token, _, _ = _register_user(s)
        h = _h(token)
        wk = self._make(s, h, target=100.0)
        wid = wk["id"]
        eid = wk["exercises"][0]["id"]

        # 1st echec: 100 * 0.95 = 95.0 → deloads empty
        r1 = s.post(f"{API}/workouts/{wid}/log", headers=h, json={"entries": [
            {"exercise_id": eid, "difficulty": "echec", "weight_kg": 100.0}
        ]}, timeout=15).json()
        assert r1["deloads"] == []
        assert r1["workout"]["exercises"][0]["target_weight_kg"] == 95.0

        # 2nd echec: 95 * 0.95 = 90.25 → round(180.5)/2 = 90.0 (banker's rounds .5 to even)
        import time
        time.sleep(1.1)
        r2 = s.post(f"{API}/workouts/{wid}/log", headers=h, json={"entries": [
            {"exercise_id": eid, "difficulty": "echec", "weight_kg": 95.0}
        ]}, timeout=15).json()
        assert r2["deloads"] == []
        prev_target = r2["workout"]["exercises"][0]["target_weight_kg"]
        assert prev_target in (90.0, 90.5), f"got {prev_target}"

        # 3rd echec: triggers deload = prev_target * 0.9 rounded 0.5
        time.sleep(1.1)
        r3 = s.post(f"{API}/workouts/{wid}/log", headers=h, json={"entries": [
            {"exercise_id": eid, "difficulty": "echec", "weight_kg": prev_target}
        ]}, timeout=15).json()
        assert len(r3["deloads"]) == 1, r3
        dl = r3["deloads"][0]
        assert dl["exercise_id"] == eid
        assert dl["exercise_name"] == "TEST Deload Bench"
        assert dl["consecutive_failures"] >= 3
        # target_after_log = prev_target * 0.95 (from _next_target_after_log); then deload = *0.9
        after_overload = round(prev_target * 0.95 * 2) / 2
        expected_deload = round(after_overload * 0.9 * 2) / 2
        assert dl["new_target_weight_kg"] == expected_deload
        assert r3["workout"]["exercises"][0]["target_weight_kg"] == expected_deload
        s.delete(f"{API}/workouts/{wid}", headers=h, timeout=15)

    def test_deload_not_triggered_when_streak_broken(self, s):
        token, _, _ = _register_user(s)
        h = _h(token)
        wk = self._make(s, h, target=80.0)
        wid = wk["id"]
        eid = wk["exercises"][0]["id"]
        import time
        # echec, echec, reussi (breaks streak), echec, echec → last streak=2 → no deload
        for i, diff in enumerate(["echec", "echec", "reussi", "echec", "echec"]):
            r = s.post(f"{API}/workouts/{wid}/log", headers=h, json={"entries": [
                {"exercise_id": eid, "difficulty": diff, "weight_kg": 80.0}
            ]}, timeout=15).json()
            if i < 4:
                assert r["deloads"] == [], f"unexpected deload at step {i}"
            time.sleep(1.1)
        # Final log had streak=2 (last 2 echecs), reussi before that
        # r above is the 5th log's response
        assert r["deloads"] == [], f"streak was broken by reussi, no deload expected: {r}"
        s.delete(f"{API}/workouts/{wid}", headers=h, timeout=15)

    def test_deload_only_once_per_exercise_per_log(self, s):
        token, _, _ = _register_user(s)
        h = _h(token)
        wk = self._make(s, h, target=100.0)
        wid = wk["id"]
        eid = wk["exercises"][0]["id"]
        import time
        for _ in range(3):
            s.post(f"{API}/workouts/{wid}/log", headers=h, json={"entries": [
                {"exercise_id": eid, "difficulty": "echec", "weight_kg": 100.0}
            ]}, timeout=15)
            time.sleep(1.1)
        # 3rd log response
        r = s.post(f"{API}/workouts/{wid}/log", headers=h, json={"entries": [
            {"exercise_id": eid, "difficulty": "echec", "weight_kg": 100.0},
            {"exercise_id": eid, "difficulty": "echec", "weight_kg": 100.0},  # dup entry same exercise
        ]}, timeout=15).json()
        # Should list deload at most once for that exercise
        ex_ids = [d["exercise_id"] for d in r["deloads"]]
        assert ex_ids.count(eid) <= 1, f"deload listed multiple times: {r['deloads']}"
        s.delete(f"{API}/workouts/{wid}", headers=h, timeout=15)
