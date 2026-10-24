# Bose Academy

Master every skill. Understand every concept. A free learning site for Pre-K through college, with lessons, unlimited practice, a knowledge map, classes for teachers, a moderated community, and certificates anyone can verify.

## What's here

| Path | What it is |
| --- | --- |
| `public/index.html` | Landing page (`/`) |
| `public/app.html` | The learning app (`/app`): sign-in, Learn, Courses, classes, Community, Downloads, Library, Certificates, Impact, Owner console |
| `server/server.js` | The server: accounts, saved progress, classes, community, certificates, owner tools. No dependencies. |
| `server/curriculum.json` | Courses and milestone badges the server checks before issuing certificates |
| `tools/` | Sources for `public/app.html`: `base.html` (the prototype), `firebase.html` (Firebase accounts), `bridge.html` (server connection), `ui.html` (design layer), `features.html` (Find my level, Mastery Challenge, worked examples), `video.html` (lesson videos), `printables.html` (designed worksheet and lesson packet PDFs), `vendor-qrcode.html` (QR code library, MIT). Edit these, then run `python3 tools/build.py`. `tools/e2e.cjs` is a full browser test. |
| `server/assessments.json` | Classwork, quizzes and unit tests with answer keys, TK to grade 12, for Math, ELA, Science and Social Studies. Built from `tools/assess-src/*.txt` by `tools/build_assess.py` (which `tools/build.py` runs). Only teachers can load it on the full site. |
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

## Teacher page and assessments

The Teacher tab has four sections:

- **Classes**: create classes, make student logins, assign practice, live view, Gem Challenges and parent reports.
- **Assessments**: pick a grade (TK to 12) and subject (Math, ELA, Science, Social Studies) to see its units. TK to grade 8 follow the district programs' units in order (Eureka Math and Eureka Math², Benchmark Advance for TK to 5 and Collections for 6 to 8, Mystery Science and Discovery Education topics, and the California History-Social Science framework). Each unit has lessons, and each lesson has classwork with hints and a 15-minute lesson quiz; each unit has a 20 to 28 question unit test with word problems, reading passages, short answers, and a CER, writing response or performance task scored with a 4-point rubric. Every question has a DOK level. Preview a version, download it as a PDF with the answer key, rubric and supports for English learners and students with IEPs, then assign it to a class or one student, with an optional timer. **Trimester benchmarks** mix questions from the units a class covered. **Versions**: each trimester gets a new set of unit tests and lesson quizzes, picked first during that trimester once the Owner sets the trimester dates ("Set trimester dates"); teachers can also copy and edit any test or quiz into their own version, private or shared.
- **Gradebook**: scores per student and assessment. Multiple choice and number answers score automatically; you score written answers with the sample answer or rubric beside them, add comments, then release scores to students. Download a CSV.
- **Grade guides**: for each grade and subject, the year's focus, priority California standards, units and supports. The Owner can type in the district's adopted program for each grade and subject.

Students find assigned work under **My classes**. Questions appear when they press Start, which also starts any timer; answers save as they go and are turned in automatically when time runs out. The answer key never reaches students' browsers, and they see scores only after the teacher releases them.

All questions are original, written to the California standards; they do not reproduce any publisher's materials. To add or edit content, change the files in `tools/assess-src/` (`v2/<subject>-<grade>.txt` for TK to 8, `<subject>.txt` for 9 to 12, `versions/` for trimester sets; the format is described at the top of `tools/build_assess.py`, with writing and review guides in `WRITING.md` and `REVIEW.md`) and run `python3 tools/build.py`. `node tools/validate-assess.cjs` builds, grades and prints every assessment to check it; `tools/e2e-assess.cjs` tests the whole flow against a running server.

On GitHub Pages with Firebase, the answer bank is a public file (`server/assessments.json`), so a determined student could find it, and students in a class can read an assigned test's questions before pressing Start; the full site keeps both behind sign-in. Firestore rules still stop students from reading keys stored with assigned tests, changing answers after turning them in, or setting their own scores.

## Game: levels, quests, the gem shop and Lumi's Realm

- **Levels and ranks:** learners earn XP only by learning (correct answers, missions, quests, and turning in classwork and lesson quizzes; unit tests and benchmarks give nothing). XP raises their hero's level and rank, from Apprentice to Legend.
- **Quests and treasures:** three daily quests and two weekly quests give gems and XP; finishing all three daily quests opens a treasure chest. Treasures (badges) mark milestones such as streaks, levels and mastered skills.
- **Gem shop:** gems come from correct answers, quests, classwork, battles and teachers' bonus gems. They buy hats, outfits, magic items, pets and backgrounds for the learner's hero avatar. Items are only for fun.
- **Lumi's Realm (the Play tab):** a fantasy world of seven lands that open as the hero levels up. In battle, every spell is a question from the learner's own grade-level skills; a wrong answer shows the worked solution. Learners get a daily play time (10 minutes, plus 5 minutes for every 10 minutes of learning, up to 30 minutes a day by default). The Owner changes these numbers, or turns the game off, in Owner console > Feature flags. Teachers, parents and the Owner can play without a limit to try it.
- **Class competitions:** in each class card the teacher can show a weekly leaderboard (XP from learning this week, never test scores), split the class into teams for a weekly team race with a prize, and give 1 to 20 bonus gems to a student, a team or the class with a reason.

XP, gems and play time are kept with each learner's own progress, so a determined student could change their own numbers; the game is for motivation, not grades. The Firestore rules let learners write only their own leaderboard row and claim only their own bonus gems, once. `tools/e2e-game.cjs` tests the game against a running server.

## Ask Lumi (AI tutor)

Practice questions have an **Ask Lumi** button. With `ANTHROPIC_API_KEY` set on the server, Lumi uses Claude as a Socratic tutor that asks guiding questions and is instructed never to reveal or confirm answers (model: `LUMEN_TUTOR_MODEL`, default `claude-haiku-5-5`; limited to 30 messages per student per 10 minutes). Without a key, or with the "AI tutor feedback" flag off in the Owner console, it falls back to built-in guiding questions from each problem's hint ladder.

## Accounts

- **Learners of any age** sign up themselves. Under 13, a parent or guardian gives their email and ticks a permission box (COPPA), and the account can read but not post in the Community.
- **Classes**: a teacher can also create logins from the Teacher tab (type the names, Bose Academy makes usernames and passwords, no email needed).
- **Teachers and parents** sign up with an email. The Owner can mark teachers as verified, which lets them moderate the community.
- **Owner**: created on the server only, never through the website.
