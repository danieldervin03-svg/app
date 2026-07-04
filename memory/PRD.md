# Bodypilot – Product Requirements

## Vision
Coach fitness IA mobile en français. L'utilisateur peut générer des programmes d'entraînement personnalisés, modifier ses exercices, suivre ses calories quotidiennes avec suggestions IA de repas, et suivre sa progression corporelle.

## Auth
- JWT + bcrypt (custom auth)
- Endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- Persisted via expo-secure-store

## Core Features
1. **Home Dashboard** – Résumé du jour: calories restantes, prochain entraînement, séances de la semaine.
2. **Workouts** – Liste des programmes, génération IA (`POST /api/workouts/generate` – model: openai gpt-5.4 via Emergent LLM key), CRUD complet.
   - Ajouter / modifier / supprimer chaque exercice au sein d'un workout (`PUT /api/workouts/:id`).
   - Marquer terminé (`POST /api/workouts/:id/complete`).
3. **Nutrition** – Log manuel de repas (nom, calories, type), objectif quotidien, suggestions IA de repas (`POST /api/meals/suggest`) selon calories restantes et préférences.
4. **Progress** – Mesures (poids, poitrine, taille, hanches, bras, cuisse) + graphe barres poids.
5. **Profile** – Modifier objectif calorique, déconnexion.

## Design
- Palette blanc + vert menthe (#10B981, #059669, #D1FAE5)
- iOS-native clean, `1 iOS-Native Clean` personality
- Bottom tabs: Accueil, Entraînements, Nutrition, Progrès, Profil
- French only

## LLM
- `EMERGENT_LLM_KEY` via `emergentintegrations`
- Model: `openai / gpt-5.4` (JSON response mode)

## Future Enhancements
- Push notifications reminders (deploy build required)
- Photo progress
- Social sharing
