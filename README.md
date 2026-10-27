# TriSuivi

Appli mobile (PWA) pour suivre son entraînement en **natation, vélo et course à pied** à partir des données Strava.

- **Semaine** : temps total, volume par discipline, comparaison avec la moyenne des 4 dernières semaines, charge d'entraînement (effort relatif Strava), graphique des 12 dernières semaines.
- **Progrès** : meilleure allure, plus longue sortie, cumul annuel, tendance et courbe d'allure par sortie.
- **Sorties** : liste des activités par semaine, filtrable par sport.
- **Coach** : chat avec Claude (Anthropic), qui reçoit le résumé de tes semaines et de tes sorties pour analyser ton entraînement et proposer des séances. Nécessite une clé API Anthropic (Réglages → Coach), facturée à l'usage sur console.anthropic.com.
- **Montre Garmin** : les séances proposées par le coach (une seule ou toute la semaine) sont découpées en étapes (échauffement, répétitions, cibles d'allure ou de zone FC, repos en natation) et envoyées sur Intervals.icu, qui les transmet à Garmin Connect puis à la montre. Nécessite un compte Intervals.icu relié à Garmin et sa clé API (Réglages → Montre Garmin). Si l'envoi direct est bloqué, l'appli affiche les séances prêtes à coller dans Intervals.icu.
- **Mode démo** pour tester sans compte Strava.

Seules les activités à partir du **1er septembre 2026** sont prises en compte (constante `START_DATE` dans `js/app.js`).

Pas de serveur : l'appli tourne dans le navigateur du téléphone et parle directement à l'API Strava. Les activités sont enregistrées sur le téléphone et seules les nouvelles sont téléchargées à chaque synchronisation.

## Mise en ligne (GitHub Pages)

1. Sur GitHub : **Settings → Pages → Source : Deploy from a branch**, choisir la branche et le dossier `/ (root)`.
   (GitHub Pages gratuit nécessite un dépôt public. Sinon, Netlify ou Vercel marchent aussi en glissant le dossier.)
2. L'appli est disponible sur `https://<utilisateur>.github.io/<depot>/`.

## Connexion à Strava

1. Aller sur <https://www.strava.com/settings/api> et créer une application.
   - **Authorization Callback Domain** : le domaine de l'appli, par ex. `j4w4knqt9j-hash.github.io`.
2. Ouvrir l'appli sur le téléphone → **Réglages** → coller le *Client ID* et le *Client Secret* → **Se connecter avec Strava**.
3. Ajouter l'appli à l'écran d'accueil :
   - iPhone (Safari) : bouton Partager → *Sur l'écran d'accueil* ;
   - Android (Chrome) : menu ⋮ → *Installer l'application*.

Le Client ID et le Client Secret restent uniquement dans le stockage du téléphone, ils ne sont jamais dans le code.

> Sur iPhone, l'appli installée sur l'écran d'accueil a un stockage séparé de Safari : faire la connexion Strava depuis l'appli installée.

## Développement local

```bash
python3 -m http.server 8000
```

Puis ouvrir <http://localhost:8000>. Pour se connecter à Strava en local, mettre `localhost` comme Callback Domain.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Page principale et barre d'onglets |
| `css/style.css` | Styles (thème sombre / clair automatique) |
| `js/app.js` | Vues, navigation, synchronisation |
| `js/strava.js` | OAuth et appels à l'API Strava |
| `js/stats.js` | Calculs : volumes hebdo, allures, records, charge |
| `js/demo.js` | Données fictives du mode démo |
| `sw.js`, `manifest.webmanifest` | Installation sur le téléphone et fonctionnement hors ligne |
