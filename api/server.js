const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const multer = require("multer");
const { Pool } = require("pg");
const pgSession = require("connect-pg-simple")(session);

const app = express();

/* --------------------------------------------------
   CONFIG
-------------------------------------------------- */

const SESSION_SECRET = process.env.SESSION_SECRET || "dev-change-me";

const ROOT_DIR = __dirname;
const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.join(ROOT_DIR, "uploads");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/* --------------------------------------------------
   DATABASE
-------------------------------------------------- */

const pool = new Pool({
  connectionString:
    process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected error", err);
});

/* ---------- Lazy DB Init (SERVERLESS SAFE) ---------- */

let dbInitialized = false;

async function initDb() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
    `);

    console.log("[DB] Initialized");
  } finally {
    client.release();
  }
}

async function ensureDb() {
  if (!dbInitialized) {
    await initDb();
    dbInitialized = true;
  }
}

/* --------------------------------------------------
   MIDDLEWARE
-------------------------------------------------- */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* DB init middleware */
app.use(async (req, res, next) => {
  try {
    await ensureDb();
    next();
  } catch (err) {
    console.error("DB init failed:", err);
    res.status(500).json({ error: "Database initialization failed" });
  }
});

/* Sessions */

const sessionStore = new pgSession({
  pool,
  tableName: "session",
  createTableIfMissing: true,
});

app.use(
  session({
    store:
      process.env.NODE_ENV === "production"
        ? sessionStore
        : undefined,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })
);

app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(path.join(ROOT_DIR, "public")));

/* --------------------------------------------------
   HELPERS
-------------------------------------------------- */

function randomId() {
  return crypto.randomBytes(16).toString("hex");
}

function requireUser(req, res, next) {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  next();
}

/* --------------------------------------------------
   HEALTH CHECK (IMPORTANT)
-------------------------------------------------- */

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "db-error" });
  }
});

/* --------------------------------------------------
   AUTH ROUTES
-------------------------------------------------- */

app.post("/api/auth/register", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase();
    const password = String(req.body.password || "");
    const displayName = String(req.body.displayName || "");

    if (!email || !password || !displayName)
      return res.status(400).json({ error: "Missing fields" });

    const existing = await pool.query(
      "SELECT id FROM users WHERE email=$1",
      [email]
    );

    if (existing.rows.length)
      return res.status(409).json({ error: "User exists" });

    const id = randomId();
    const password_hash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users
       (id,email,password_hash,display_name,created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, email, password_hash, displayName, Date.now()]
    );

    req.session.userId = id;

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase();
    const password = String(req.body.password || "");

    const result = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    if (!result.rows.length)
      return res.status(401).json({ error: "Invalid credentials" });

    const user = result.rows[0];

    const ok = await bcrypt.compare(password, user.password_hash);

    if (!ok)
      return res.status(401).json({ error: "Invalid credentials" });

    req.session.userId = user.id;

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* --------------------------------------------------
   SAMPLE PROTECTED ROUTE
-------------------------------------------------- */

app.get("/api/me", requireUser, async (req, res) => {
  const result = await pool.query(
    "SELECT id,email,display_name FROM users WHERE id=$1",
    [req.session.userId]
  );

  res.json(result.rows[0]);
});

/* --------------------------------------------------
   EXPORT (CRITICAL FOR VERCEL)
-------------------------------------------------- */

module.exports = app;