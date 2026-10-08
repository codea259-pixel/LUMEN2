// Lumen server: accounts, database, community, classes, certificates, impact, owner tools.
// Zero dependencies. Needs Node 22+ (uses the built-in node:sqlite).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const PORT = +process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const PROD = process.env.NODE_ENV === 'production';
const CUR = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'curriculum.json'), 'utf8'));
fs.mkdirSync(DATA, { recursive: true });

let SECRET = process.env.SESSION_SECRET;
if (!SECRET) { // generated once and kept on the data disk
  const f = path.join(DATA, 'secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  SECRET = fs.readFileSync(f, 'utf8');
}

const db = new DatabaseSync(path.join(DATA, 'lumen.db'));
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, display TEXT UNIQUE COLLATE NOCASE, email TEXT, role TEXT NOT NULL, verified INTEGER DEFAULT 0, locked INTEGER DEFAULT 0, hash TEXT, salt TEXT, created INTEGER, last_seen INTEGER);
CREATE TABLE IF NOT EXISTS state(user_id INTEGER PRIMARY KEY REFERENCES users(id), json TEXT, updated INTEGER);
CREATE TABLE IF NOT EXISTS certs(id TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), name TEXT, course TEXT, kind TEXT, key TEXT, date TEXT, UNIQUE(user_id,key));
CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY, name TEXT, subject TEXT, grade INTEGER, members TEXT);
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, grp INTEGER, type TEXT, subject TEXT, grade INTEGER, title TEXT, body TEXT, author_id INTEGER, ts INTEGER, hidden INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0, locked INTEGER DEFAULT 0, reports TEXT DEFAULT '[]', votes TEXT DEFAULT '[]');
CREATE TABLE IF NOT EXISTS replies(id INTEGER PRIMARY KEY, post_id INTEGER, author_id INTEGER, body TEXT, ts INTEGER, hidden INTEGER DEFAULT 0, reports TEXT DEFAULT '[]');
CREATE TABLE IF NOT EXISTS classes(id INTEGER PRIMARY KEY, teacher_id INTEGER, name TEXT, grade INTEGER, region TEXT, code TEXT UNIQUE, challenge TEXT);
CREATE TABLE IF NOT EXISTS class_members(class_id INTEGER, user_id INTEGER, grades TEXT DEFAULT '[]', PRIMARY KEY(class_id,user_id));
CREATE TABLE IF NOT EXISTS assignments(id INTEGER PRIMARY KEY, class_id INTEGER, title TEXT, skills TEXT, target INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
`);
const Q = (sql, ...p) => db.prepare(sql).all(...p);
const Q1 = (sql, ...p) => db.prepare(sql).get(...p);
const X = (sql, ...p) => db.prepare(sql).run(...p);
const getS = (k, d) => { const r = Q1('SELECT value FROM settings WHERE key=?', k); return r ? JSON.parse(r.value) : d; };
const setS = (k, v) => X('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(v));
const DEF = {
  block: ['stupid', 'idiot', 'dumb', 'hate you', 'shut up'],
  flags: { 'AI tutor feedback': true, 'Live Classroom': true, 'Gem Challenges': true, 'Offline mode': false },
  retDays: 3, gr: {},
  impact: { mission: 'Lumen gives every learner, everywhere, free access to clear lessons, unlimited practice and a patient tutor, so that no student is held back by cost or connection.', team: [], partners: [], funds: [['Content creation', 40], ['Hosting and infrastructure', 25], ['Accessibility and translation', 20], ['Reserve', 15]], raised: 0, goal: 0 },
};
const S = k => getS(k, DEF[k]);

class E extends Error { constructor(c, m) { super(m); this.c = c; } }
const ROLES = ['student', 'parent', 'teacher', 'school_admin'];
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = t => { const l = t.toLowerCase(); if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t) || /\+?\d[\d\s().-]{8,}\d/.test(t)) return "Posts can't include emails or phone numbers."; return S('block').some(b => b && l.includes(b)) ? "That includes language we don't allow here." : ''; };

// ---- passwords and sessions
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const mkTok = id => { const p = Buffer.from(JSON.stringify({ u: id, e: Date.now() + 30 * 864e5 })).toString('base64url'); return p + '.' + sign(p); };
const readTok = t => { if (!t) return null; const [p, s] = t.split('.'); if (!s || s.length !== sign(p).length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(p)))) return null; try { const o = JSON.parse(Buffer.from(p, 'base64url')); return o.e > Date.now() ? o.u : null; } catch { return null; } };
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]));
const userOut = u => ({ id: u.id, username: u.username, display: u.display, role: u.role, verified: !!u.verified });
function createUser({ username, display, email, role, password, verified = 0 }) {
  const salt = crypto.randomBytes(16).toString('hex');
  const r = X('INSERT INTO users(username,display,email,role,verified,hash,salt,created) VALUES(?,?,?,?,?,?,?,?)', username, display, email || null, role, verified, hashPw(password, salt), salt, Date.now());
  return Q1('SELECT * FROM users WHERE id=?', Number(r.lastInsertRowid));
}
const hits = new Map();
function limit(key, max, ms) { const n = Date.now(), a = (hits.get(key) || []).filter(t => n - t < ms); if (a.length >= max) throw new E(429, 'Too many attempts. Please wait a few minutes.'); a.push(n); hits.set(key, a); }
setInterval(() => hits.clear(), 3600e3).unref();

// ---- owner bootstrap: the Owner is created on the server, never through the public API
function ensureOwner(username, password) {
  if (Q1("SELECT id FROM users WHERE role='owner'")) return false;
  createUser({ username, display: username, role: 'owner', password, verified: 1 }); return true;
}
if (process.argv[2] === 'create-owner') {
  const [u, p] = process.argv.slice(3);
  if (!u || !p || p.length < 12) { console.error('Usage: node server/server.js create-owner <username> <password (12+ characters)>'); process.exit(1); }
  console.log(ensureOwner(u, p) ? 'Owner account created.' : 'An Owner account already exists.'); process.exit(0);
}
if (process.env.OWNER_USERNAME && process.env.OWNER_PASSWORD && ensureOwner(process.env.OWNER_USERNAME, process.env.OWNER_PASSWORD)) console.log('Owner account created from environment variables. Remove OWNER_PASSWORD now.');

// ---- helpers
const isMod = u => u.role === 'owner' || (u.role === 'teacher' && u.verified);
const isTeacher = u => ['teacher', 'owner', 'school_admin'].includes(u.role);
const lvl = s => !s || !s.att ? 0 : s.mastered ? 4 : (s.p >= .85 && s.att >= 6) ? 3 : s.p >= .55 ? 2 : 1;
const stateOf = id => { const r = Q1('SELECT json FROM state WHERE user_id=?', id); try { return r ? JSON.parse(r.json) : {}; } catch { return {}; } };
const nameOf = id => (Q1('SELECT display FROM users WHERE id=?', id) || {}).display || 'former member';
const int = (v, lo, hi) => { v = Math.trunc(+v); if (!Number.isFinite(v) || v < lo || v > hi) throw new E(400, 'Invalid number.'); return v; };
const str = (v, lo, hi) => { v = String(v ?? '').trim(); if (v.length < lo || v.length > hi) throw new E(400, `Text must be ${lo} to ${hi} characters.`); return v; };
const need = (c, ok = true) => { if (!c.u) throw new E(401, 'auth'); if (!ok) throw new E(403, 'Not allowed.'); };

function postOut(p, mod) {
  const rs = Q('SELECT * FROM replies WHERE post_id=? ORDER BY ts', p.id).filter(r => mod || !r.hidden);
  return { id: p.id, type: p.type, group: p.grp, subject: p.subject, grade: p.grade, title: p.title, body: p.body, author: nameOf(p.author_id), ts: p.ts, hidden: !!p.hidden, pinned: !!p.pinned, locked: !!p.locked,
    votes: JSON.parse(p.votes).map(nameOf), reports: mod ? JSON.parse(p.reports).map(nameOf) : [],
    replies: rs.map(r => ({ id: r.id, author: nameOf(r.author_id), body: r.body, hidden: !!r.hidden, reports: mod ? JSON.parse(r.reports).map(nameOf) : [] })) };
}
function classOut(c) {
  const mem = Q('SELECT u.id,u.display,u.username,m.grades FROM class_members m JOIN users u ON u.id=m.user_id WHERE m.class_id=? ORDER BY u.id', c.id);
  const asg = Q('SELECT * FROM assignments WHERE class_id=? ORDER BY ts', c.id);
  const sts = mem.map(m => stateOf(m.id));
  const pct = (st, skills) => Math.round(100 * skills.reduce((a, k) => { const s = (st.S || {})[k]; return a + (lvl(s) >= 3 ? 1 : s && s.att ? Math.min(.99, s.p / .85) : 0); }, 0) / Math.max(1, skills.length));
  const gems = sts.map(s => +s.gems || 0), ch = c.challenge ? JSON.parse(c.challenge) : null;
  return { id: c.id, name: c.name, grade: c.grade, region: c.region, code: c.code, ch,
    asg: asg.map(a => ({ id: a.id, title: a.title, skills: JSON.parse(a.skills), target: a.target == null ? 'all' : mem.findIndex(m => m.id === a.target) })),
    students: mem.map((m, i) => ({ uid: m.id, name: m.display, email: m.username, grades: JSON.parse(m.grades), gems: gems[i], q: Object.values(sts[i].S || {}).reduce((a, s) => a + (s.att || 0), 0),
      p: Object.fromEntries(asg.map(a => [a.id, pct(sts[i], JSON.parse(a.skills))])) })) };
}
const ownClass = (c, id) => { const k = Q1('SELECT * FROM classes WHERE id=?', int(id, 1, 1e12)); if (!k || (k.teacher_id !== c.u.id && c.u.role !== 'owner')) throw new E(404, 'Class not found.'); return k; };
const code = (n, alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') => Array.from(crypto.randomBytes(n), b => alpha[b % alpha.length]).join('');
const uniqueDisplay = base => { let d = base.slice(0, 20), i = 1; while (Q1('SELECT 1 FROM users WHERE display=?', d)) d = base.slice(0, 17) + (++i); return d; };

// ---- routes
const R = [];
const route = (m, p, fn) => R.push([m, new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn]);

route('POST', '/api/signup', (c, res) => {
  limit('su' + c.ip, 20, 3600e3);
  const b = c.body, role = b.role;
  if (!ROLES.includes(role) || role === 'school_admin') throw new E(400, 'Choose learner, parent or teacher.');
  const username = str(b.username, 3, 20).toLowerCase(); if (!/^[a-z0-9_]+$/.test(username)) throw new E(400, 'Usernames use letters, numbers and underscores only.');
  const password = String(b.password || ''); if (password.length < 8 || password.length > 100) throw new E(400, 'Passwords need at least 8 characters.');
  const display = str(b.display, 2, 20); const bad = clean(display); if (bad) throw new E(400, bad);
  if (role === 'student' && !b.age13) throw new E(400, 'Learners must be 13 or older, or ask a teacher or parent to set up the account.');
  let email = null; if (role === 'teacher' || role === 'parent') { email = str(b.email, 5, 100); if (!/^\S+@\S+\.\S+$/.test(email)) throw new E(400, 'Enter a valid email address.'); }
  if (Q1('SELECT 1 FROM users WHERE username=?', username) || Q1('SELECT 1 FROM users WHERE display=?', display)) throw new E(409, 'That username or display name is taken.');
  const u = createUser({ username, display, email, role, password });
  res.cookie = mkTok(u.id); return userOut(u);
});
route('POST', '/api/login', (c, res) => {
  const username = String(c.body.username || '').toLowerCase().slice(0, 40);
  limit('li' + c.ip + username, 10, 600e3);
  const u = Q1('SELECT * FROM users WHERE username=?', username);
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(c.body.password || ''), u.salt)), Buffer.from(u.hash));
  if (!ok) throw new E(401, 'Wrong username or password.'); if (u.locked) throw new E(403, 'This account is locked. Ask your teacher or the site Owner.');
  res.cookie = mkTok(u.id); return userOut(u);
});
route('POST', '/api/logout', (c, res) => { res.cookie = 'x'; res.clear = true; return { ok: true }; });
route('GET', '/api/me', c => { need(c); return { user: userOut(c.u) }; });
route('PATCH', '/api/me', c => { need(c); const d = str(c.body.display, 2, 20), bad = clean(d); if (bad) throw new E(400, bad); if (Q1('SELECT 1 FROM users WHERE display=? AND id<>?', d, c.u.id)) throw new E(409, 'That display name is taken.'); X('UPDATE users SET display=? WHERE id=?', d, c.u.id); return { display: d }; });
route('GET', '/api/settings', () => ({ flags: S('flags'), retDays: S('retDays'), gr: S('gr'), impact: S('impact') }));
route('GET', '/api/curriculum', () => ({ courses: CUR.courses, milestones: CUR.milestones }));
route('GET', '/api/state', c => { need(c); return stateOf(c.u.id); });
route('PUT', '/api/state', c => { need(c); const j = JSON.stringify(c.body); if (j.length > 400000) throw new E(413, 'Too large.'); X('INSERT INTO state(user_id,json,updated) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET json=excluded.json,updated=excluded.updated', c.u.id, j, Date.now()); return { ok: true }; });

// community
route('GET', '/api/community', c => { need(c); const m = isMod(c.u);
  return { posts: Q('SELECT * FROM posts ORDER BY ts DESC LIMIT 300').filter(p => m || !p.hidden).map(p => postOut(p, m)),
    groups: Q('SELECT * FROM groups ORDER BY id DESC LIMIT 200').map(g => ({ id: g.id, name: g.name, subject: g.subject, grade: g.grade, members: JSON.parse(g.members).map(nameOf) })) }; });
route('POST', '/api/posts', c => { need(c); limit('po' + c.u.id, 8, 60e3); const b = c.body, t = str(b.title, 5, 120), body = str(b.body, 10, 2000), bad = clean(t + ' ' + body); if (bad) throw new E(400, bad);
  const type = b.type === 'q' ? 'q' : 'd'; let grp = null, subject = str(b.subject || 'Math', 2, 40), grade = int(b.grade ?? 5, -1, 13);
  if (b.group) { const g = Q1('SELECT * FROM groups WHERE id=?', int(b.group, 1, 1e12)); if (!g || !JSON.parse(g.members).includes(c.u.id)) throw new E(403, 'Join the group to post.'); grp = g.id; subject = g.subject; grade = g.grade; }
  X('INSERT INTO posts(grp,type,subject,grade,title,body,author_id,ts) VALUES(?,?,?,?,?,?,?,?)', grp, type, subject, grade, t, body, c.u.id, Date.now()); return { ok: true }; });
route('POST', '/api/posts/:id/reply', c => { need(c); limit('rp' + c.u.id, 15, 60e3); const p = Q1('SELECT * FROM posts WHERE id=?', int(c.params.id, 1, 1e12)); if (!p || (p.hidden && !isMod(c.u))) throw new E(404, 'Post not found.'); if (p.locked) throw new E(403, 'This thread is locked.');
  const b = str(c.body.body, 2, 2000), bad = clean(b); if (bad) throw new E(400, bad); X('INSERT INTO replies(post_id,author_id,body,ts) VALUES(?,?,?,?)', p.id, c.u.id, b, Date.now()); return { ok: true }; });
route('POST', '/api/posts/:id/vote', c => { need(c); const p = Q1('SELECT * FROM posts WHERE id=?', int(c.params.id, 1, 1e12)); if (!p || p.hidden) throw new E(404, 'Post not found.'); const v = JSON.parse(p.votes), i = v.indexOf(c.u.id); i < 0 ? v.push(c.u.id) : v.splice(i, 1); X('UPDATE posts SET votes=? WHERE id=?', JSON.stringify(v), p.id); return { ok: true }; });
route('POST', '/api/posts/:id/report', c => { need(c); const rid = c.body.rid; const tbl = rid && rid !== 'p' ? 'replies' : 'posts', id = tbl === 'replies' ? int(rid, 1, 1e12) : int(c.params.id, 1, 1e12);
  const row = Q1(`SELECT * FROM ${tbl} WHERE id=?`, id); if (!row) throw new E(404, 'Not found.'); const r = JSON.parse(row.reports); if (!r.includes(c.u.id)) r.push(c.u.id);
  X(`UPDATE ${tbl} SET reports=?, hidden=? WHERE id=?`, JSON.stringify(r), r.length >= 3 ? 1 : row.hidden, id); return { ok: true }; });
route('PATCH', '/api/posts/:id', c => { need(c, isMod(c.u)); const p = Q1('SELECT * FROM posts WHERE id=?', int(c.params.id, 1, 1e12)); if (!p) throw new E(404, 'Not found.'); const a = c.body.action;
  const col = { hide: 'hidden', pin: 'pinned', lock: 'locked' }[a]; if (!col) throw new E(400, 'Unknown action.'); X(`UPDATE posts SET ${col}=? WHERE id=?`, p[col] ? 0 : 1, p.id); return { ok: true }; });
route('POST', '/api/posts/:id/keep', c => { need(c, c.u.role === 'owner'); const id = int(c.params.id, 1, 1e12); X("UPDATE posts SET hidden=0, reports='[]' WHERE id=?", id); return { ok: true }; });
route('DELETE', '/api/posts/:id', c => { need(c, isMod(c.u)); const id = int(c.params.id, 1, 1e12); X('DELETE FROM replies WHERE post_id=?', id); X('DELETE FROM posts WHERE id=?', id); return { ok: true }; });
route('PATCH', '/api/replies/:id', c => { need(c, isMod(c.u)); const r = Q1('SELECT * FROM replies WHERE id=?', int(c.params.id, 1, 1e12)); if (!r) throw new E(404, 'Not found.'); X('UPDATE replies SET hidden=? WHERE id=?', r.hidden ? 0 : 1, r.id); return { ok: true }; });
route('POST', '/api/groups', c => { need(c); limit('gr' + c.u.id, 5, 3600e3); const n = str(c.body.name, 3, 40), bad = clean(n); if (bad) throw new E(400, bad); X('INSERT INTO groups(name,subject,grade,members) VALUES(?,?,?,?)', n, str(c.body.subject, 2, 40), int(c.body.grade, -1, 13), JSON.stringify([c.u.id])); return { ok: true }; });
route('POST', '/api/groups/:id/join', c => { need(c); const g = Q1('SELECT * FROM groups WHERE id=?', int(c.params.id, 1, 1e12)); if (!g) throw new E(404, 'Not found.'); const m = JSON.parse(g.members), i = m.indexOf(c.u.id); i < 0 ? m.push(c.u.id) : m.splice(i, 1); X('UPDATE groups SET members=? WHERE id=?', JSON.stringify(m), g.id); return { ok: true }; });

// classes
route('GET', '/api/classes', c => { need(c);
  if (isTeacher(c.u)) return { classes: Q(c.u.role === 'owner' ? 'SELECT * FROM classes ORDER BY id' : 'SELECT * FROM classes WHERE teacher_id=? ORDER BY id', ...(c.u.role === 'owner' ? [] : [c.u.id])).map(classOut) };
  const mine = Q('SELECT c.*,m.user_id FROM class_members m JOIN classes c ON c.id=m.class_id WHERE m.user_id=?', c.u.id);
  return { joined: mine.map(k => ({ id: k.id, name: k.name, teacher: nameOf(k.teacher_id), assigned: Q('SELECT * FROM assignments WHERE class_id=? AND (target IS NULL OR target=?) ORDER BY ts DESC', k.id, c.u.id).map(a => ({ id: a.id, title: a.title, skills: JSON.parse(a.skills) })) })) }; });
route('POST', '/api/classes', c => { need(c, isTeacher(c.u)); if (Q1('SELECT COUNT(*) n FROM classes WHERE teacher_id=?', c.u.id).n >= 20) throw new E(400, 'Class limit reached.');
  for (let i = 0; i < 5; i++) { try { X('INSERT INTO classes(teacher_id,name,grade,region,code) VALUES(?,?,?,?,?)', c.u.id, str(c.body.name, 2, 60), int(c.body.grade, -1, 13), String(c.body.region || '').trim().slice(0, 60), code(6)); return { ok: true }; } catch (e) { if (!/UNIQUE/.test(e.message)) throw e; } } throw new E(500, 'Try again.'); });
route('POST', '/api/classes/join', c => { need(c, c.u.role === 'student'); limit('jc' + c.u.id, 10, 600e3); const k = Q1('SELECT * FROM classes WHERE code=?', String(c.body.code || '').trim().toUpperCase()); if (!k) throw new E(404, 'No class has that code.'); X('INSERT OR IGNORE INTO class_members(class_id,user_id,grades) VALUES(?,?,?)', k.id, c.u.id, JSON.stringify([k.grade])); return { ok: true, name: k.name }; });
route('POST', '/api/classes/:id/students', c => { need(c, isTeacher(c.u)); const k = ownClass(c, c.params.id); const names = (Array.isArray(c.body.names) ? c.body.names : []).map(n => String(n).trim()).filter(Boolean).slice(0, 60); if (!names.length) throw new E(400, 'Enter at least one student name.');
  return { created: names.map(n => { const first = n.split(/\s+/)[0].replace(/[^\p{L}\p{N}]/gu, '').slice(0, 14) || 'Student', base = first.toLowerCase().replace(/[^a-z0-9]/g, '') || 'student'; let un; do un = base + code(3, '23456789'); while (Q1('SELECT 1 FROM users WHERE username=?', un));
    const pw = code(8, 'abcdefghjkmnpqrstuvwxyz23456789'), u = createUser({ username: un, display: uniqueDisplay(first), role: 'student', password: pw }); X('INSERT INTO class_members(class_id,user_id,grades) VALUES(?,?,?)', k.id, u.id, JSON.stringify([k.grade])); return { name: u.display, username: un, password: pw }; }) }; });
route('PATCH', '/api/classes/:id/students/:uid', c => { need(c, isTeacher(c.u)); const k = ownClass(c, c.params.id); const g = (Array.isArray(c.body.grades) ? c.body.grades : []).map(x => int(x, -1, 13)).slice(0, 6); if (!g.length) throw new E(400, 'Pick a grade.'); X('UPDATE class_members SET grades=? WHERE class_id=? AND user_id=?', JSON.stringify(g), k.id, int(c.params.uid, 1, 1e12)); return { ok: true }; });
route('POST', '/api/classes/:id/assign', c => { need(c, isTeacher(c.u)); const k = ownClass(c, c.params.id); const skills = (Array.isArray(c.body.skills) ? c.body.skills : []).map(String).slice(0, 40); if (!skills.length) throw new E(400, 'Nothing to assign.');
  let target = null; if (c.body.target != null && c.body.target !== 'all') { target = int(c.body.target, 1, 1e12); if (!Q1('SELECT 1 FROM class_members WHERE class_id=? AND user_id=?', k.id, target)) throw new E(400, 'That student is not in this class.'); }
  X('INSERT INTO assignments(class_id,title,skills,target,ts) VALUES(?,?,?,?,?)', k.id, str(c.body.title, 2, 120), JSON.stringify(skills), target, Date.now()); return { ok: true }; });
route('POST', '/api/classes/:id/challenge', c => { need(c, isTeacher(c.u)); const k = ownClass(c, c.params.id); const base = Q('SELECT user_id FROM class_members WHERE class_id=?', k.id).reduce((a, m) => a + (+stateOf(m.user_id).gems || 0), 0);
  X('UPDATE classes SET challenge=? WHERE id=?', JSON.stringify({ goal: int(c.body.goal, 10, 1e6), reward: str(c.body.reward || 'Class celebration', 1, 80), base }), k.id); return { ok: true }; });

route('POST', '/api/users/:id/reset-password', c => { need(c, isTeacher(c.u)); const t = Q1('SELECT * FROM users WHERE id=?', int(c.params.id, 1, 1e12)); if (!t || t.role === 'owner') throw new E(404, 'Not found.');
  const ok = c.u.role === 'owner' || (t.role === 'student' && Q1('SELECT 1 FROM class_members m JOIN classes k ON k.id=m.class_id WHERE m.user_id=? AND k.teacher_id=?', t.id, c.u.id)); if (!ok) throw new E(403, 'Not allowed.');
  const pw = code(8, 'abcdefghjkmnpqrstuvwxyz23456789'), salt = crypto.randomBytes(16).toString('hex'); X('UPDATE users SET hash=?, salt=? WHERE id=?', hashPw(pw, salt), salt, t.id); return { created: [{ name: t.display, username: t.username, password: pw }] }; });

// certificates
route('GET', '/api/certs', c => { need(c); return { certs: Q('SELECT * FROM certs WHERE user_id=? ORDER BY date', c.u.id) }; });
route('POST', '/api/certs/claim', c => { need(c); limit('cc' + c.u.id, 20, 600e3); const key = String(c.body.key || ''), full = str(c.body.full, 2, 40), st = stateOf(c.u.id), Sx = st.S || {};
  const course = CUR.courses.find(x => x.id === key), mil = CUR.milestones.find(x => x.id === key); let ok = false, label, kind = 'course';
  if (course) { ok = course.skills.every(k => lvl(Sx[k]) >= 3); label = course.name; }
  else if (mil) { const q = Object.values(Sx).reduce((a, s) => a + (s.att || 0), 0); ok = { m10: q >= 10, m100: q >= 100, m500: q >= 500, m1: Object.values(Sx).some(s => lvl(s) === 4), m5: (st.days || []).length >= 5 }[key]; label = mil.label; kind = 'badge'; }
  else throw new E(400, 'Unknown certificate.'); if (!ok) throw new E(403, 'You have not earned this yet.');
  const have = Q1('SELECT * FROM certs WHERE user_id=? AND key=?', c.u.id, key); if (have) return have;
  const id = 'LUM-' + code(4) + '-' + code(4) + '-' + code(4), date = new Date().toISOString().slice(0, 10); X('INSERT INTO certs(id,user_id,name,course,kind,key,date) VALUES(?,?,?,?,?,?,?)', id, c.u.id, full, label, kind, key, date); return { id, name: full, course: label, kind, key, date }; });
route('GET', '/api/certs/:id', c => { const r = Q1('SELECT id,name,course,kind,date FROM certs WHERE id=?', String(c.params.id).toUpperCase()); if (!r) throw new E(404, 'No certificate has that ID.'); return { valid: true, ...r }; });

// impact (public)
route('GET', '/api/impact', () => {
  const rows = Q("SELECT u.id,s.json FROM users u JOIN state s ON s.user_id=u.id WHERE u.role IN ('student','parent')");
  let learners = 0, secs = 0, answered = 0; rows.forEach(r => { let j = {}; try { j = JSON.parse(r.json); } catch {} const a = Object.values(j.S || {}).reduce((x, s) => x + (s.att || 0), 0); if (a > 0) learners++; answered += a; secs += +j.secs || 0; });
  const regions = new Set(Q("SELECT region FROM classes WHERE region<>''").map(r => r.region.toLowerCase().trim())).size;
  const stu = new Set(Q('SELECT user_id FROM class_members').map(r => 'u' + r.user_id)); Q("SELECT p.author_id FROM posts p WHERE p.type='q' AND EXISTS(SELECT 1 FROM replies r WHERE r.post_id=p.id AND r.author_id<>p.author_id)").forEach(r => stu.add('u' + r.author_id));
  return { stats: { learners, hours: +(secs / 3600).toFixed(1), regions, helped: stu.size, answered }, content: S('impact') }; });

// owner
route('GET', '/api/owner/users', c => { need(c, c.u.role === 'owner'); return { users: Q('SELECT id,username,display,email,role,verified,locked,created FROM users ORDER BY id DESC LIMIT 500') }; });
route('PATCH', '/api/owner/users/:id', c => { need(c, c.u.role === 'owner'); const t = Q1('SELECT * FROM users WHERE id=?', int(c.params.id, 1, 1e12)); if (!t) throw new E(404, 'Not found.');
  if (t.role === 'owner') throw new E(403, 'The Owner account is protected and cannot be changed.');
  if (c.body.role !== undefined) { if (!ROLES.includes(c.body.role)) throw new E(400, 'Invalid role.'); X('UPDATE users SET role=? WHERE id=?', c.body.role, t.id); }
  if (typeof c.body.locked === 'boolean') X('UPDATE users SET locked=? WHERE id=?', c.body.locked ? 1 : 0, t.id);
  if (typeof c.body.verified === 'boolean') X('UPDATE users SET verified=? WHERE id=?', c.body.verified ? 1 : 0, t.id); return { ok: true }; });
route('GET', '/api/owner/settings', c => { need(c, c.u.role === 'owner'); return { block: S('block'), flags: S('flags'), retDays: S('retDays'), gr: S('gr'), impact: S('impact') }; });
route('PUT', '/api/owner/settings', c => { need(c, c.u.role === 'owner'); const b = c.body;
  if (b.block) setS('block', b.block.map(x => String(x).toLowerCase().trim().slice(0, 40)).filter(Boolean).slice(0, 500));
  if (b.flags) setS('flags', Object.fromEntries(Object.entries(b.flags).slice(0, 30).map(([k, v]) => [String(k).slice(0, 40), !!v])));
  if (b.retDays !== undefined) setS('retDays', int(b.retDays, 0, 60));
  if (b.gr) setS('gr', Object.fromEntries(Object.entries(b.gr).slice(0, 1000).map(([k, v]) => [String(k).slice(0, 60), int(v, -1, 13)])));
  if (b.impact) { const i = b.impact; setS('impact', { mission: str(i.mission, 0, 1000), team: (i.team || []).slice(0, 50).map(t => [String(t[0]).slice(0, 80), String(t[1] || '').slice(0, 80)]), partners: (i.partners || []).slice(0, 50).map(x => String(x).slice(0, 100)),
    funds: (i.funds || []).slice(0, 20).map(f => [String(f[0]).slice(0, 60), int(f[1], 0, 100)]), raised: Math.max(0, +i.raised || 0), goal: Math.max(0, +i.goal || 0) }); }
  return { ok: true }; });

// ---- public certificate page
function certPage(id) {
  const r = Q1('SELECT * FROM certs WHERE id=?', id.toUpperCase());
  const body = r ? `<p class="k">${r.kind === 'badge' ? 'Milestone badge' : 'Certificate of completion'}</p><div class="n">${esc(r.name)}</div><p>${r.kind === 'badge' ? 'earned' : 'completed'}</p><h2>${esc(r.course)}</h2><p class="k">${esc(r.date)} &middot; Verification ID <b>${esc(r.id)}</b></p><p class="ok">Verified: issued by Lumen to this account.</p>` : `<h2>Certificate not found</h2><p class="k">No certificate has the ID ${esc(id)}.</p>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Lumen certificate</title><style>body{margin:0;background:#EEF3F8;color:#1B2A41;font:18px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:20px}.c{max-width:640px;width:100%;border:8px double #F2A900;border-radius:14px;background:#fff;padding:36px;text-align:center}.n{font:800 34px system-ui;margin:8px 0}.k{color:#546580}h2{margin:6px 0}.ok{color:#0F8B8D;font-weight:700}a{color:#0F8B8D}@media print{body{background:#fff}}</style><div class="c"><b>LUMEN</b>${body}<p><a href="/">lumen</a></p></div></html>`;
}

// ---- server
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
const send = (res, code, body, type = 'application/json', extra = {}) => { res.writeHead(code, { 'Content-Type': type, ...SEC, ...extra }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = decodeURIComponent(url.pathname);
  const ip = (process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress;
  try {
    if (p.startsWith('/api/')) {
      let body = {};
      if (req.method !== 'GET') {
        const o = req.headers.origin; if (o && new URL(o).host !== req.headers.host) throw new E(403, 'Bad origin.');
        if (!/application\/json/.test(req.headers['content-type'] || '')) throw new E(415, 'JSON only.');
        const chunks = []; let n = 0; for await (const ch of req) { n += ch.length; if (n > 450000) throw new E(413, 'Too large.'); chunks.push(ch); }
        try { body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}; } catch { throw new E(400, 'Bad JSON.'); }
      }
      const uid = readTok(cookies(req).lumen_s); let u = uid ? Q1('SELECT * FROM users WHERE id=?', uid) : null; if (u && u.locked) u = null;
      if (u && Date.now() - (u.last_seen || 0) > 600e3) X('UPDATE users SET last_seen=? WHERE id=?', Date.now(), u.id);
      for (const [m, re, fn] of R) { if (m !== req.method) continue; const mt = re.exec(p); if (!mt) continue;
        const out = {}; const result = fn({ req, u, body, params: mt.groups || {}, ip }, out);
        const ck = out.cookie ? `lumen_s=${out.clear ? '' : out.cookie}; Path=/; HttpOnly; SameSite=Lax; ${PROD ? 'Secure; ' : ''}${out.clear ? 'Max-Age=0' : 'Max-Age=2592000'}` : null;
        return send(res, 200, result, 'application/json', { 'Cache-Control': 'no-store', ...(ck ? { 'Set-Cookie': ck } : {}) }); }
      throw new E(404, 'Not found.');
    }
    const cm = /^\/c\/([A-Za-z0-9-]{8,30})$/.exec(p); if (cm) return send(res, 200, certPage(cm[1]), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
    const file = p === '/' ? 'index.html' : p === '/app' ? 'app.html' : p.slice(1);
    const fp = path.normalize(path.join(PUB, file)); if (!fp.startsWith(PUB + path.sep) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return send(res, 404, '<h1>Not found</h1>', 'text/html; charset=utf-8');
    send(res, 200, fs.readFileSync(fp), MIME[path.extname(fp)] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
  } catch (e) {
    if (e instanceof E) return send(res, e.c, { error: e.message });
    console.error(e); send(res, 500, { error: 'Something went wrong on our side.' });
  }
}).listen(PORT, () => console.log(`Lumen running on http://localhost:${PORT}`));
