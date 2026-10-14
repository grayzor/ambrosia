<div align="center">

<img src="assets/icon.png" width="112" alt="Gany">

# Ambrosia

**Une encoche façon MacBook, pour Windows.** Gany — Ganymède, l'échanson qui sert l'ambroisie aux dieux de l'Olympe — vit en haut au centre de ton écran, veille sur tes sessions Claude Code et ne te dérange que pour les mails qui comptent.

</div>

## Ce que fait Gany

- **Sessions Claude Code en direct** — chaque session (terminal, VS Code, app Claude) apparaît avec son état et l'étape en cours : il lit, modifie, exécute… Plusieurs sessions en parallèle.
- **Autoriser / Refuser / Toujours depuis l'encoche** — les demandes de permission s'affichent avec la commande exacte, le diff d'une modification ou le plan proposé. « Terminal » rend la main à la console.
- **Répondre aux questions de Claude** (`AskUserQuestion`) — choix simples ou multiples, ou réponse libre.
- **Fin de tâche** — Gany saute de joie et résume ce que Claude a répondu.
- **Courrier** — Gany parcourt ta boîte Gmail toutes les 10 minutes pendant tes heures de travail et ne fait remonter que les mails importants (sujet, expéditeur, pourquoi). Tu lui apprends en cliquant « Pas important ».
- **ClickUp** — même principe pour ta boîte de réception ClickUp : mentions qui attendent ta réponse, commentaires qui te sont assignés, approbations, blocages et tâches urgentes sur tes tickets. Gany lit les fils de réponses avant de juger (si tu as déjà répondu, il se tait).
- **Agenda** — Gany lit ton Google Calendar et ne te laisse plus rater un début de réunion : quelques minutes avant, au début, puis en retard, tant que tu n'es pas connecté au Meet (il le voit au micro tenu par ton navigateur). Alerte épinglée avec **Rejoindre** et **OK**, Gany avec un sablier, de doré à rouge. Seules les vraies réunions comptent : au moins 2 participants, pas les créneaux [Claude], ni le focus time, ni les invitations refusées.
- **La vie de Gany** — un mot le matin (tes réunions, mails et ClickUp du jour), un bilan le soir, un rappel quand ta pause déjeuner commence, des confettis après une longue tâche Claude, un clin d'œil quand tu sors d'une réunion commencée à l'heure, un trophée pour les séries, des petites animations au repos, une tenue de week-end, des cernes les jours chargés.
- **Demander à Gany** — un chat rapide (web et lecture de tes mails possibles).
- **Toute l'IA passe par ton abonnement Claude**, via la CLI Claude Code (`claude -p`), comme Claude Code lui-même. Aucune clé API.

| Tu fais | Gany fait |
|---|---|
| S'arrêter sur l'encoche | elle se déplie (la survoler en passant ne l'ouvre pas) |
| Quitter l'îlot | il se replie |
| Cliquer sur l'encoche repliée (à côté de Gany) | elle se déplie tout de suite, sans attendre |
| Clic maintenu sur l'encoche + glisser | elle se pousse de côté, et revient au centre après 1 min |
| Cliquer sur Gany replié | il sursaute ; double-clic : l'îlot se déplie |
| Cliquer sur Gany déplié | il est vexé ; trois fois, il a le tournis |
| Le caresser (aller-retours avec la souris) | il rougit, puis ronronne ; le secouer l'agace |
| Laisser la souris 2 s sur Gany | des cœurs |
| Clic droit sur Gany | menu rapide : Pause 1 h, sons, relire l'agenda, vérifier mails / ClickUp |
| Glisser un fichier sur l'îlot | Gany le boit et propose de le résumer |
| `Échap` | replier |
| Icône de la barre des tâches | Ouvrir, Réglages, Pause, Recharger, Quitter |

## Installation

Prérequis : Windows 10/11, Claude Code (la CLI fournie avec l'app Claude Desktop suffit), [Node.js](https://nodejs.org) pour le relais des hooks.

```powershell
irm https://github.com/grayzor/ambrosia/releases/latest/download/install.ps1 | iex
```

La dernière version publiée s'installe dans `%LOCALAPPDATA%\Ambrosia\app` (sans droits administrateur), avec un raccourci dans le menu Démarrer. Ensuite **Ambrosia se met à jour seule** : au démarrage, une nouvelle version s'installe avant que Gany n'arrive ; en journée, Gany la télécharge et affiche **Mettre à jour** en haut de l'îlot (et dans Réglages → Mises à jour) : rien ne s'installe sans ton clic. Chaque fusion dans `main` publie une version (GitHub Actions). Pour ne garder que le bouton : Réglages → Mises à jour → « Mise à jour automatique au démarrage ».

Depuis les sources (pour développer) :

```powershell
git clone https://github.com/grayzor/ambrosia.git
cd ambrosia
npm install
npm run deploy
```

Lancée depuis les sources, Ambrosia ne se remplace jamais d'elle-même ; Réglages → Mises à jour → « Installer la version publiée » bascule sur la version publiée.

Puis, une seule fois :

1. **Réglages → Claude (IA) → Se connecter** : connecte la CLI Claude à ton compte (abonnement).
2. **Réglages → Claude → Installer les hooks…** : relis le diff, valide. Relance les sessions Claude déjà ouvertes.
3. **Courrier** : connecte Gmail sur [claude.ai → Paramètres → Connecteurs](https://claude.ai/settings/connectors), puis **Réglages → Courrier → Détecter le connecteur Gmail**. Décris ce qui est important pour toi dans « Ce qui compte pour toi ».
4. **ClickUp** : même chose avec le connecteur ClickUp de claude.ai (Réglages → ClickUp).

## Ajouter une feature

Une feature = un dossier dans `src/modules/`. Le reste (onglet, pastilles de l'encoche, page de réglages, humeur de Gany) est automatique.

```powershell
npm run new-module -- agenda "Agenda" 📅
npm run dev
```

Toute l'API est décrite dans [CLAUDE.md](CLAUDE.md) — il suffit de demander à Claude Code « ajoute un module qui… ».

## Comment ça marche

- **Îlot** : une fenêtre Electron transparente, toujours au premier plan, qui laisse passer les clics hors de sa forme. Le process principal suit le curseur pour le survol et les yeux de Gany.
- **Gany** : dessiné en Canvas 2D, 15 humeurs, aucune image. **Sons** : une petite lyre synthétisée (Karplus-Strong), aucun fichier audio.
- **Claude Code** : `hook/ambrosia-hook.js` reçoit chaque événement de hook et le transmet par un named pipe protégé par un jeton. Si Ambrosia est fermée, lente ou en pause, le relais sort immédiatement : **Claude Code n'est jamais bloqué**.
- **Courrier** : un tour `claude -p` (Haiku) qui n'a le droit d'appeler que deux outils Gmail en lecture (`search_threads`, `get_thread`). Les mails sont traités comme des données, jamais comme des instructions.
- **Mises à jour** : `src/main/updater.js` lit `latest.json` sur les releases GitHub, télécharge seulement l'application (~500 Ko) quand Electron n'a pas changé, sinon la version complète, vérifie l'empreinte SHA-256, assemble la nouvelle version à côté de celle qui tourne, bascule la jonction `current` et redémarre. Si la nouvelle version ne démarre pas, la précédente revient d'elle-même.
- **Vie privée** : aucune télémétrie. Journal local : `%LOCALAPPDATA%\Ambrosia\ambrosia.log`.

## Crédits

La logique des hooks et de l'îlot vient de [coucou](https://github.com/Louis-CFM/coucou) de Louis Raillé (MIT). Gany, son nom, son dessin et ses sons sont propres à Ambrosia.
