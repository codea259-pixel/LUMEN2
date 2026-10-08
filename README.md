# Lumen

Master every skill. Understand every concept. A free learning site for Pre-K through college, with lessons, unlimited practice, a knowledge map, classes for teachers, a moderated community, and certificates anyone can verify.

## What's here

| Path | What it is |
| --- | --- |
| `public/index.html` | Landing page (`/`) |
| `public/app.html` | The learning app (`/app`): sign-in, Learn, Courses, classes, Community, Downloads, Library, Certificates, Impact, Owner console |
| `server/server.js` | The server: accounts, saved progress, classes, community, certificates, owner tools. No dependencies. |
| `server/curriculum.json` | Courses and milestone badges the server checks before issuing certificates |
| `prototype/` | The earlier single-file prototype, kept for reference |

Data is stored in a SQLite file (`lumen.db`) inside `DATA_DIR`. Back that folder up.

## Run it on your computer

Needs Node.js 22.5 or newer.

```sh
OWNER_USERNAME=yourname OWNER_PASSWORD='a-long-password-12+' npm start
```

Open http://localhost:3000. The Owner account is created the first time the server starts with those two variables. After that, remove `OWNER_PASSWORD`. You can also create it with `npm run create-owner -- yourname 'a-long-password'`.

## Put it on the internet

Any host that runs a Docker container with a persistent disk works (Render, Railway, Fly.io, a VPS):

1. Deploy this repo with the included `Dockerfile`.
2. Attach a persistent disk/volume at `/data`.
3. Set `OWNER_USERNAME` and `OWNER_PASSWORD` for the first start, then remove the password.
4. Optionally set `SESSION_SECRET` to a long random string (otherwise one is generated and kept in `/data`).
5. Serve it over HTTPS (the hosts above do this for you). Sign-in cookies are marked secure in production.

## Accounts

- **Learners 13+** sign up themselves.
- **Under 13**: a teacher creates logins from the Teacher tab (type the names, Lumen makes usernames and passwords, no email needed).
- **Teachers and parents** sign up with an email. The Owner can mark teachers as verified, which lets them moderate the community.
- **Owner**: created on the server only, never through the website.
