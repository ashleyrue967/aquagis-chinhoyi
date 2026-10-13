// AquaGIS Chinhoyi - backend API (Netlify Function + Netlify Blobs)
// Routes: /api/health /api/setup /api/login /api/me /api/password
//         /api/records  /api/records/:id/photos  /api/users
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
};
const J = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });
const fail = (s, m) => J({ error: m }, s);

const ROLES = ["admin", "supervisor", "officer"];
const TOKEN_DAYS = 30;
const MAX_BODY = 5.5 * 1024 * 1024;

const users = () => getStore({ name: "aquagis-users", consistency: "strong" });
const recs = () => getStore({ name: "aquagis-records", consistency: "strong" });
const pics = () => getStore({ name: "aquagis-photos", consistency: "strong" });

/* ---------- crypto helpers ---------- */
function secret() {
  const s = process.env.JWT_SECRET || "";
  if (s.length < 16) throw new Error("not_configured");
  return s;
}
const b64 = (x) => Buffer.from(x).toString("base64url");
function sign(p) {
  const body = b64(JSON.stringify(p));
  return body + "." + crypto.createHmac("sha256", secret()).update(body).digest("base64url");
}
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function verify(t) {
  if (!t || t.indexOf(".") < 0) return null;
  const [body, sig] = t.split(".");
  const good = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (!safeEq(sig, good)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString("hex");
function makeCred(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: hashPw(pw, salt) };
}
const pub = (u) => ({
  username: u.username, name: u.name, role: u.role, dept: u.dept || "",
  active: u.active !== false, created: u.created, lastLogin: u.lastLogin || null,
});
const issue = (u) =>
  sign({ u: u.username, pv: u.pv || 1, exp: Date.now() + TOKEN_DAYS * 864e5 });

/* ---------- validation ---------- */
const USER_RE = /^[a-z0-9._-]{3,32}$/;
const s = (v, n = 300) => (v == null ? "" : String(v)).slice(0, n);
const arr = (v) => (Array.isArray(v) ? v.slice(0, 20).map((x) => s(x, 200)) : []);
const STR = ["acc","stand","addr","ward","suburb","ptype","occ","parea","farea","ser","mtype","msize","mfr","inst","mcond","seal","acs","prev","cur","hrs","days","t1","t2","press","sup","wq","leak","glat","glon","gacc","gm","off","sv"];

function cleanRecord(r) {
  if (!r || typeof r !== "object") return [null, "invalid record"];
  const id = s(r.id, 64);
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return [null, "bad id"];
  const o = { id };
  for (const k of STR) o[k] = s(r[k]);
  o.cm = s(r.cm, 1000);
  if (!o.ser) return [null, "meter serial missing"];
  if (o.cur === "") return [null, "current reading missing"];
  if (o.glat !== "" && (isNaN(+o.glat) || Math.abs(+o.glat) > 90)) return [null, "bad latitude"];
  if (o.glon !== "" && (isNaN(+o.glon) || Math.abs(+o.glon) > 180)) return [null, "bad longitude"];
  const ts = new Date(r.ts);
  o.ts = isNaN(ts) ? new Date().toISOString() : ts.toISOString();
  o.use = r.use == null || r.use === "" || isNaN(+r.use) ? null : +r.use;
  o.alerts = arr(r.alerts); o.fac = arr(r.fac); o.iss = arr(r.iss);
  const ph = Array.isArray(r.photos) ? r.photos.slice(0, 6) : [];
  const photos = ph
    .filter((p) => p && typeof p.img === "string" && p.img.startsWith("data:image/") && p.img.length < 600000)
    .map((p) => ({ kind: s(p.kind, 40), img: p.img, ts: s(p.ts, 40) }));
  o.pc = photos.length;
  return [o, null, photos];
}

/* ---------- helpers ---------- */
async function body(req) {
  const t = await req.text();
  if (t.length > MAX_BODY) throw Object.assign(new Error("too_large"), { status: 413 });
  try { return t ? JSON.parse(t) : {}; } catch { throw Object.assign(new Error("bad_json"), { status: 400 }); }
}
async function auth(req) {
  const h = req.headers.get("authorization") || "";
  const p = verify(h.replace(/^Bearer\s+/i, ""));
  if (!p) return null;
  const u = await users().get(p.u, { type: "json" });
  if (!u || u.active === false || (u.pv || 1) !== p.pv) return null;
  return u;
}
async function chunked(keys, fn, size = 25) {
  const out = [];
  for (let i = 0; i < keys.length; i += size)
    out.push(...(await Promise.all(keys.slice(i, i + size).map(fn))));
  return out;
}

/* ---------- handlers ---------- */
async function setup(req) {
  const b = await body(req);
  const code = process.env.SETUP_CODE || "";
  if (code.length < 6) return fail(503, "Server is not configured: set SETUP_CODE in Netlify (at least 6 characters).");
  const { blobs } = await users().list();
  if (blobs.length) return fail(403, "Setup is already complete. Ask your administrator for an account.");
  if (!safeEq(b.code || "", code)) return fail(403, "Wrong setup code.");
  const username = s(b.username, 32).toLowerCase();
  if (!USER_RE.test(username)) return fail(400, "Username: 3-32 letters, numbers, dot, dash or underscore.");
  if (s(b.password, 100).length < 8) return fail(400, "Password must be at least 8 characters.");
  const u = { username, name: s(b.name, 80) || username, role: "admin", dept: s(b.dept, 80) || "Water & Sewerage",
    active: true, created: new Date().toISOString(), pv: 1, ...makeCred(b.password) };
  await users().setJSON(username, u);
  return J({ token: issue(u), user: pub(u) });
}

async function login(req) {
  const b = await body(req);
  const username = s(b.username, 32).toLowerCase();
  const u = USER_RE.test(username) ? await users().get(username, { type: "json" }) : null;
  if (!u) { hashPw("x", "dummysaltdummysalt"); return fail(401, "Wrong username or password."); }
  if (u.lockUntil && u.lockUntil > Date.now())
    return fail(429, "Too many failed attempts. Try again in a few minutes.");
  if (!safeEq(hashPw(String(b.password || ""), u.salt), u.hash)) {
    u.fails = (u.fails || 0) + 1;
    if (u.fails >= 5) { u.lockUntil = Date.now() + 10 * 60000; u.fails = 0; }
    await users().setJSON(username, u);
    return fail(401, "Wrong username or password.");
  }
  if (u.active === false) return fail(403, "This account has been disabled. Contact your administrator.");
  u.fails = 0; u.lockUntil = 0; u.lastLogin = new Date().toISOString();
  await users().setJSON(username, u);
  return J({ token: issue(u), user: pub(u) });
}

async function postRecords(req, me) {
  const b = await body(req);
  const list = Array.isArray(b.records) ? b.records.slice(0, 10) : [];
  const saved = [], rejected = [];
  for (const r of list) {
    const [o, err, photos] = cleanRecord(r);
    if (!o) { rejected.push({ id: s(r && r.id, 64), reason: err }); continue; }
    o.officerId = me.username;
    o.receivedAt = new Date().toISOString();
    if (!o.off) o.off = `${me.name} (${me.username})`;
    await recs().setJSON(`r/${me.username}/${o.id}`, o);
    if (photos.length) await pics().setJSON(`p/${me.username}/${o.id}`, { owner: me.username, photos });
    saved.push(o.id);
  }
  return J({ saved, rejected });
}

async function getRecords(me) {
  const prefix = me.role === "officer" ? `r/${me.username}/` : "r/";
  const { blobs } = await recs().list({ prefix });
  const out = (await chunked(blobs.map((x) => x.key), (k) => recs().get(k, { type: "json" }))).filter(Boolean);
  out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return J({ records: out, count: out.length });
}

async function getPhotos(id, url, me) {
  const owner = me.role === "officer" ? me.username : s(url.searchParams.get("officer"), 32).toLowerCase();
  if (!USER_RE.test(owner)) return fail(400, "officer is required");
  const d = await pics().get(`p/${owner}/${id}`, { type: "json" });
  return J({ photos: d ? d.photos : [] });
}

async function findKey(id, officer) {
  if (officer && USER_RE.test(officer)) return `r/${officer}/${id}`;
  const { blobs } = await recs().list({ prefix: "r/" });
  const k = blobs.map((x) => x.key).find((x) => x.endsWith("/" + id));
  return k || null;
}
async function delRecord(id, url, me) {
  if (me.role !== "admin") return fail(403, "Only an administrator can delete records on the server.");
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return fail(400, "bad id");
  const key = await findKey(id, s(url.searchParams.get("officer"), 32).toLowerCase());
  if (!key || !(await recs().get(key, { type: "json" }))) return fail(404, "Record not found on server.");
  await recs().delete(key);
  await pics().delete(key.replace(/^r\//, "p/"));
  return J({ deleted: id });
}

async function listUsers() {
  const { blobs } = await users().list();
  const all = (await chunked(blobs.map((x) => x.key), (k) => users().get(k, { type: "json" }))).filter(Boolean);
  return J({ users: all.map(pub).sort((a, b) => a.username.localeCompare(b.username)) });
}
async function createUser(req) {
  const b = await body(req);
  const username = s(b.username, 32).toLowerCase();
  if (!USER_RE.test(username)) return fail(400, "Username: 3-32 letters, numbers, dot, dash or underscore.");
  if (!ROLES.includes(b.role)) return fail(400, "Invalid role.");
  if (s(b.password, 100).length < 6) return fail(400, "Password must be at least 6 characters.");
  if (await users().get(username, { type: "json" })) return fail(409, "That username already exists.");
  const u = { username, name: s(b.name, 80) || username, role: b.role, dept: s(b.dept, 80),
    active: true, created: new Date().toISOString(), pv: 1, ...makeCred(b.password) };
  await users().setJSON(username, u);
  return J({ user: pub(u) }, 201);
}
async function updateUser(name, req, me) {
  const username = s(name, 32).toLowerCase();
  const u = USER_RE.test(username) ? await users().get(username, { type: "json" }) : null;
  if (!u) return fail(404, "User not found.");
  const b = await body(req);
  if (username === me.username && (b.active === false || (b.role && b.role !== "admin")))
    return fail(400, "You cannot disable or demote your own account.");
  if (b.name != null) u.name = s(b.name, 80) || u.name;
  if (b.dept != null) u.dept = s(b.dept, 80);
  if (b.role != null) { if (!ROLES.includes(b.role)) return fail(400, "Invalid role."); u.role = b.role; }
  if (b.active != null) u.active = !!b.active;
  if (b.password != null) {
    if (s(b.password, 100).length < 6) return fail(400, "Password must be at least 6 characters.");
    Object.assign(u, makeCred(b.password));
    u.pv = (u.pv || 1) + 1; u.fails = 0; u.lockUntil = 0;
  }
  if (b.active === false || b.role != null) u.pv = (u.pv || 1) + 1;
  await users().setJSON(username, u);
  return J({ user: pub(u) });
}
async function changePw(req, me) {
  const b = await body(req);
  if (!safeEq(hashPw(String(b.old || ""), me.salt), me.hash)) return fail(403, "Current password is wrong.");
  if (s(b.new, 100).length < 6) return fail(400, "New password must be at least 6 characters.");
  Object.assign(me, makeCred(b.new));
  me.pv = (me.pv || 1) + 1;
  await users().setJSON(me.username, me);
  return J({ token: issue(me), user: pub(me) });
}

/* ---------- router ---------- */
export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const m = req.method, [a, b, c] = parts;
  try {
    if (a === "health") return J({ ok: true, jwt: (process.env.JWT_SECRET || "").length >= 16, setupCode: (process.env.SETUP_CODE || "").length >= 6 });
    if (a === "setup" && m === "POST") return await setup(req);
    if (a === "login" && m === "POST") return await login(req);

    const me = await auth(req);
    if (!me) return fail(401, "Please sign in again.");
    const staff = me.role === "admin" || me.role === "supervisor";

    if (a === "me" && m === "GET") return J({ user: pub(me) });
    if (a === "password" && m === "POST") return await changePw(req, me);
    if (a === "records") {
      if (!b && m === "GET") return await getRecords(me);
      if (!b && m === "POST") return await postRecords(req, me);
      if (b && c === "photos" && m === "GET") return await getPhotos(b, url, me);
      if (b && !c && m === "DELETE") return await delRecord(b, url, me);
    }
    if (a === "users") {
      if (me.role !== "admin") return fail(403, "Administrators only.");
      if (!b && m === "GET") return await listUsers();
      if (!b && m === "POST") return await createUser(req);
      if (b && m === "PUT") return await updateUser(b, req, me);
    }
    void staff;
    return fail(404, "Not found.");
  } catch (e) {
    if (e.message === "not_configured") return fail(503, "Server is not configured: set JWT_SECRET in Netlify (at least 16 random characters).");
    if (e.status) return fail(e.status, e.message === "too_large" ? "Payload too large." : "Bad request.");
    console.error(e);
    return fail(500, "Server error.");
  }
};
