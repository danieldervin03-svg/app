# Bodypilot – Product Requirements

## Vision
Coach fitness IA mobile en français. L'utilisateur peut générer des programmes d'entraînement personnalisés, modifier ses exercices, suivre ses calories quotidiennes avec suggestions IA de repas, suivre sa progression corporelle et discuter avec un Coach IA conversationnel.

## Auth
- JWT + bcrypt (custom auth)
- Endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- Persisted via expo-secure-store

## Core Features
1. **Home Dashboard** – Résumé du jour: calories restantes, prochain entraînement, séances de la semaine, quick actions (Générer IA, Logger repas, Parler au Coach IA).
2. **Workouts** – Liste des programmes, génération IA (`POST /api/workouts/generate` – model: openai gpt-5.4 via Emergent LLM key), CRUD complet.
   - Ajouter / modifier / supprimer chaque exercice au sein d'un workout (`PUT /api/workouts/:id`).
   - Marquer terminé (`POST /api/workouts/:id/complete`).
   - Coach IA scopé au programme (`POST /api/coach/chat` avec workout_id).
3. **Nutrition** – Log manuel de repas (nom, calories, type), objectif quotidien, suggestions IA de repas (`POST /api/meals/suggest`) selon calories restantes et préférences.
4. **Progress** – Historique séances : total terminées, streak hebdomadaire actuel + meilleur, graphique 8 dernières semaines, historique récent des séances (`GET /api/workouts/history/stats`). Mesures (poids, poitrine, taille, hanches, bras, cuisse) + graphe barres poids.
5. **Coach IA conversationnel** – `POST /api/coach/chat`, `GET /api/coach/messages`, `DELETE /api/coach/messages`. Contexte enrichi automatiquement avec le programme en cours (exercices, description). Historique persisté par utilisateur + workout.
6. **Profile** – Modifier objectif calorique, déconnexion.

## Design
- Palette blanc + vert menthe (#10B981, #059669, #D1FAE5)
- iOS-native clean, `1 iOS-Native Clean` personality
- Bottom tabs: Accueil, Entraînements, Nutrition, Progrès, Profil
- French only

## LLM
- `EMERGENT_LLM_KEY` via `emergentintegrations`
- Model: `openai / gpt-5.4` (JSON response mode pour génération, prose pour coach)

## Future Enhancements
- Monétisation (Stripe, à voir plus tard)
- Photos avant/après pour la progression
- Push notifications reminders (deploy build required)
- Social sharing
