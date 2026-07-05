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
