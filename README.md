# Bose Academy

Master every skill. Understand every concept. A free learning site for Pre-K through college, with lessons, unlimited practice, a knowledge map, classes for teachers, a moderated community, and certificates anyone can verify.

## What's here

| Path | What it is |
| --- | --- |
| `public/index.html` | Landing page (`/`) |
| `public/app.html` | The learning app (`/app`): sign-in, Learn, Courses, classes, Community, Downloads, Library, Certificates, Impact, Owner console |
| `server/server.js` | The server: accounts, saved progress, classes, community, certificates, owner tools. No dependencies. |
| `server/curriculum.json` | Courses and milestone badges the server checks before issuing certificates |
| `tools/` | Sources for `public/app.html`: `base.html` (the prototype), `firebase.html` (Firebase accounts), `bridge.html` (server connection), `ui.html` (design layer), `features.html` (Find my level, Mastery Challenge, worked examples), `video.html` (lesson videos). Edit these, then run `python3 tools/build.py`. `tools/e2e.cjs` is a full browser test. |
| `prototype/` | The earlier single-file prototype, kept for reference |

Data is stored in a SQLite file (`lumen.db`) inside `DATA_DIR`. Back that folder up.

## Run it on your computer

Needs Node.js 22.5 or newer.

```sh
OWNER_USERNAME=yourname OWNER_PASSWORD='a-long-password-12+' npm start
```

Open http://localhost:3000. The Owner account is created the first time the server starts with those two variables. After that, remove `OWNER_PASSWORD`. You can also create it with `npm run create-owner -- yourname 'a-long-password'`.

## GitHub Pages (demo mode)

GitHub Pages can't run the server, so `index.html` and `app.html` at the repo root are copies made by `python3 tools/build.py`. On Pages the app runs in demo mode: Learn, Courses, the knowledge map, practice, Library, Downloads and Settings work, and progress is saved in the visitor's browser. Accounts, classes, community and certificates need the full site below.

## Accounts on GitHub Pages with Firebase (free)

With Firebase set up, the GitHub Pages site gets real accounts: sign-up, sign-in (username or "Continue with Google"), progress saved to the account, teacher classes, community, certificates and the owner console. Firebase's free plan covers it.

1. Create a project at console.firebase.google.com (Analytics not needed).
2. **Authentication → Sign-in method:** enable **Email/Password** and **Google**. Under **Settings → Authorized domains**, add `bose.academy` and `codea259-pixel.github.io`.
3. **Firestore Database → Create database** (production mode).
4. **Firestore → Rules:** paste `firestore.rules`, replace `PASTE_OWNER_GMAIL` with the owner's Gmail address, and publish. Keep the Gmail out of the repo.
5. **Project settings → Your apps → Web app:** copy the `firebaseConfig` object into `firebase-config.js` at the repo root (these values are public).

The owner signs in with "Continue with Google" using that Gmail. `tools/e2e-firebase.cjs` tests all of this against the Firebase emulators. Not available in this mode: password resets for teacher-made student logins and the Claude-powered Ask Lumi (it uses built-in guiding questions instead).

## Put it on the internet

Any host that runs a Docker container with a persistent disk works (Render, Railway, Fly.io, a VPS):

1. Deploy this repo with the included `Dockerfile`.
2. Attach a persistent disk/volume at `/data`.
3. Set `OWNER_USERNAME` and `OWNER_PASSWORD` for the first start, then remove the password.
4. Optionally set `SESSION_SECRET` to a long random string (otherwise one is generated and kept in `/data`).
5. Serve it over HTTPS (the hosts above do this for you). Sign-in cookies are marked secure in production.

## Ask Lumi (AI tutor)

Practice questions have an **Ask Lumi** button. With `ANTHROPIC_API_KEY` set on the server, Lumi uses Claude as a Socratic tutor that asks guiding questions and is instructed never to reveal or confirm answers (model: `LUMEN_TUTOR_MODEL`, default `claude-haiku-5-5`; limited to 30 messages per student per 10 minutes). Without a key, or with the "AI tutor feedback" flag off in the Owner console, it falls back to built-in guiding questions from each problem's hint ladder.

## Accounts

- **Learners of any age** sign up themselves. Under 13, a parent or guardian gives their email and ticks a permission box (COPPA), and the account can read but not post in the Community.
- **Classes**: a teacher can also create logins from the Teacher tab (type the names, Bose Academy makes usernames and passwords, no email needed).
- **Teachers and parents** sign up with an email. The Owner can mark teachers as verified, which lets them moderate the community.
- **Owner**: created on the server only, never through the website.
