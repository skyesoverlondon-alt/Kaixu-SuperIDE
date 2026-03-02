const { TextEncoder } = require("util");
const cookie = require("cookie");
const { nanoid } = require("nanoid");
const { neon } = require("@neondatabase/serverless");
const { SignJWT, jwtVerify } = require("jose");

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "kxp_session";
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function jsonResponse(statusCode, body, extraHeaders){
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(extraHeaders || {})
    },
    body: JSON.stringify(body)
  };
}

function badRequest(msg){ return jsonResponse(400, { ok:false, error: msg || "Bad request" }); }
function unauthorized(msg){ return jsonResponse(401, { ok:false, error: msg || "Unauthorized" }); }

function parseBody(event){
  if(!event || !event.body) return {};
  try { return JSON.parse(event.body); } catch(e){ return {}; }
}

function getJwtSecret(){
  const s = process.env.CUSTOMER_JWT_SECRET || process.env.AUTH_SECRET || process.env.KAIXU_SERVICE_SECRET || "";
  if(!s || s.length < 24) throw new Error("Missing CUSTOMER_JWT_SECRET (or AUTH_SECRET) env var.");
  return new TextEncoder().encode(s);
}

async function signSession(payload){
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_AGE_SECONDS}s`)
    .sign(getJwtSecret());
}

async function verifySession(token){
  const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms:["HS256"] });
  return payload;
}

function isHttps(event){
  const proto = (event.headers && (event.headers["x-forwarded-proto"] || event.headers["X-Forwarded-Proto"])) || "";
  return proto.toLowerCase() === "https";
}

function sessionCookie(token, secure){
  return cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: !!secure,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_AGE_SECONDS
  });
}

function clearSessionCookie(){
  return cookie.serialize(COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    expires: new Date(0)
  });
}

async function getDb(){
  const dsn = process.env.NEON_DATABASE_URL;
  if(!dsn) throw new Error("Missing NEON_DATABASE_URL env var.");
  return neon(dsn);
}

async function ensureAuthTables(sql){
  await sql`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users (email)`;
}

async function findUserByEmail(sql, email){
  await ensureAuthTables(sql);
  const rows = await sql`SELECT id, email, password_hash, role, created_at, updated_at, last_login_at FROM auth_users WHERE email = ${email} LIMIT 1`;
  return rows[0] || null;
}

async function createUser(sql, email, passwordHash, role){
  await ensureAuthTables(sql);
  const id = "u_" + nanoid(18);
  const rows = await sql`
    INSERT INTO auth_users (id, email, password_hash, role)
    VALUES (${id}, ${email}, ${passwordHash}, ${role})
    RETURNING id, email, role, created_at
  `;
  return rows[0];
}

async function touchLogin(sql, userId){
  try{ await sql`UPDATE auth_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = ${userId}`; }catch(_){ /* best effort */ }
}

function isAdminEmail(email){
  const list = (process.env.ADMIN_EMAILS || "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
  return list.includes((email||"").trim().toLowerCase());
}

module.exports = {
  jsonResponse,
  badRequest,
  unauthorized,
  parseBody,
  signSession,
  verifySession,
  sessionCookie,
  clearSessionCookie,
  isHttps,
  getDb,
  findUserByEmail,
  createUser,
  touchLogin,
  isAdminEmail,
  COOKIE_NAME
};
