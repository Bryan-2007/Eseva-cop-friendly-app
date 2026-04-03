const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const multer = require('multer');
const { Pool } = require('pg');
const { put, del } = require('@vercel/blob');
const pgSession = require('connect-pg-simple')(session);

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-change-me';

const COMPLAINT_REWARD_AMOUNT = process.env.COMPLAINT_REWARD_AMOUNT
  ? Number(process.env.COMPLAINT_REWARD_AMOUNT)
  : 1000;
const REFERRAL_REWARD_AMOUNT = process.env.REFERRAL_REWARD_AMOUNT
  ? Number(process.env.REFERRAL_REWARD_AMOUNT)
  : 500;
const CURRENCY = process.env.CURRENCY || 'INR';

const ROOT_DIR = __dirname;
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(ROOT_DIR, 'uploads');

// Create uploads directory for local development
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------- Database Connection ----------
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client', err);
});

// Session store for production
const sessionStore = new pgSession({
  pool: pool,
  tableName: 'session',
  createTableIfMissing: false,
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create session table for connect-pg-simple
    await client.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        PRIMARY KEY ("sid")
      ) WITH (OIDS=FALSE);
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" on "session" ("expire");
    `);

    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        referral_code TEXT UNIQUE NOT NULL,
        referrer_user_id TEXT NULL REFERENCES users(id),
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS police_users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS complaints (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        location_tag TEXT NOT NULL,
        description TEXT NOT NULL,
        identity_text TEXT NULL,
        crime_type TEXT NULL,
        reporter_name TEXT NULL,
        reporter_phone TEXT NULL,
        status TEXT NOT NULL DEFAULT 'submitted',
        police_notes TEXT NULL,
        verified_at BIGINT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS complaint_images (
        id TEXT PRIMARY KEY,
        complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS referrals (
        id TEXT PRIMARY KEY,
        referrer_user_id TEXT NOT NULL REFERENCES users(id),
        referred_user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
        reward_amount INTEGER NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rewards (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        source_type TEXT NOT NULL,
        source_id TEXT NULL,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        message TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rewards_user_id ON rewards(user_id);
      CREATE INDEX IF NOT EXISTS idx_complaints_user_id ON complaints(user_id);
      CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
      CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
    `);

    // Seed police user if needed
    const policeCount = await client.query('SELECT COUNT(*) as c FROM police_users');
    if (policeCount.rows[0].c === '0' || policeCount.rows[0].c === 0) {
      const username = process.env.POLICE_USERNAME || 'admin';
      const password = process.env.POLICE_PASSWORD || 'admin123';
      const id = randomId();
      const password_hash = bcrypt.hashSync(password, 10);
      
      await client.query(
        'INSERT INTO police_users (id, username, password_hash, created_at) VALUES ($1, $2, $3, $4)',
        [id, username, password_hash, Date.now()]
      );
      console.log(`[TNPOL] Seeded police login: ${username} / ${password}`);
    }

    await client.query('COMMIT');
    console.log('[TNPOL] Database initialized successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DB] Initialization error:', err);
    throw err;
  } finally {
    client.release();
  }
}

function randomId() {
  return crypto.randomBytes(16).toString('hex');
}

function randomReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function ensureUniqueReferralCode() {
  for (let i = 0; i < 10; i++) {
    const code = randomReferralCode();
    const result = await pool.query('SELECT id FROM users WHERE referral_code = $1', [code]);
    if (result.rows.length === 0) return code;
  }
  return `${randomReferralCode()}${randomReferralCode().slice(0, 2)}`;
}

// Initialize database on startup
initDb().catch(err => {
  console.error('[TNPOL] Failed to initialize database:', err);
  process.exit(1);
});

// ---------- Middleware ----------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session configuration - use database store in production, memory in development
const sessionConfig = {
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  },
};

// Use PostgreSQL session store in production
if (process.env.NODE_ENV === 'production') {
  sessionConfig.store = sessionStore;
}

app.use(session(sessionConfig));

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(ROOT_DIR, 'public')));

function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  return next();
}

function requirePolice(req, res, next) {
  if (!req.session.policeUserId) return res.status(401).json({ error: 'Police login required' });
  return next();
}

function userPublicFields(userRow) {
  return {
    id: userRow.id,
    email: userRow.email,
    displayName: userRow.display_name,
    referralCode: userRow.referral_code,
    referrerUserId: userRow.referrer_user_id,
  };
}

// ---------- Auth ----------
app.post('/api/auth/register', async (req, res) => {
  try {
    const wantsJson = (req.headers['content-type'] || '').includes('application/json');
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const displayName = String(req.body.displayName || '').trim();
    const referralCode = req.body.referralCode ? String(req.body.referralCode).trim().toUpperCase() : null;

    if (!email || !password || !displayName) return res.status(400).json({ error: 'Missing fields' });
    if (password.length < 6) return res.status(400).json({ error: 'Password too short' });

    // Check if email exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });

    const id = randomId();
    const password_hash = bcrypt.hashSync(password, 10);
    const referral_unique = await ensureUniqueReferralCode();

    let referrer = null;
    if (referralCode) {
      const result = await pool.query('SELECT id FROM users WHERE referral_code = $1', [referralCode]);
      referrer = result.rows[0] || null;
    }

    const created_at = Date.now();

    // Insert user
    await pool.query(
      `INSERT INTO users (id, email, password_hash, display_name, referral_code, referrer_user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, email, password_hash, displayName, referral_unique, referrer ? referrer.id : null, created_at]
    );

    // Handle referral reward
    if (referrer) {
      const referralId = randomId();
      await pool.query(
        `INSERT INTO referrals (id, referrer_user_id, referred_user_id, reward_amount, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [referralId, referrer.id, id, REFERRAL_REWARD_AMOUNT, created_at]
      );

      const referralRow = await pool.query('SELECT id FROM referrals WHERE referred_user_id = $1', [id]);
      if (referralRow.rows.length > 0) {
        const rewardExists = await pool.query(
          `SELECT id FROM rewards WHERE source_type = 'referral' AND source_id = $1 AND user_id = $2`,
          [referralRow.rows[0].id, referrer.id]
        );
        if (rewardExists.rows.length === 0) {
          await pool.query(
            `INSERT INTO rewards (id, user_id, source_type, source_id, amount, status, created_at)
             VALUES ($1, $2, 'referral', $3, $4, 'pending', $5)`,
            [randomId(), referrer.id, referralRow.rows[0].id, REFERRAL_REWARD_AMOUNT, created_at]
          );
        }
      }
    }

    req.session.userId = id;
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    const payload = { ok: true, user: userPublicFields(userResult.rows[0]) };
    
    if (!wantsJson) return res.redirect('/');
    return res.json(payload);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const wantsJson = (req.headers['content-type'] || '').includes('application/json');
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Missing fields' });

    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = userResult.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.userId = user.id;
    const payload = { ok: true, user: userPublicFields(user) };
    if (!wantsJson) return res.redirect('/');
    return res.json(payload);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/me', requireUser, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: userPublicFields(userResult.rows[0]) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ---------- Logout / Feedback ----------
app.post('/api/auth/logout', requireUser, (req, res) => {
  req.session.destroy(() => {
    return res.json({ ok: true });
  });
});

app.post('/api/feedback', requireUser, async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message is required' });
    
    const id = randomId();
    await pool.query(
      'INSERT INTO feedback (id, user_id, message, created_at) VALUES ($1, $2, $3, $4)',
      [id, req.session.userId, message, Date.now()]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ---------- Police Auth ----------
app.post('/api/police/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

    const policeResult = await pool.query('SELECT * FROM police_users WHERE username = $1', [username]);
    if (policeResult.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const police = policeResult.rows[0];
    const ok = await bcrypt.compare(password, police.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.policeUserId = police.id;
    req.session.policeUsername = police.username;
    return res.json({ ok: true, username: police.username });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/police/me', requirePolice, (req, res) => {
  return res.json({ ok: true, username: req.session.policeUsername || 'police' });
});

// ---------- Complaints & File Upload ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB each
  },
});

app.post('/api/complaints', requireUser, upload.array('evidence', 10), async (req, res) => {
  try {
    const userId = req.session.userId;

    const locationTag = String(req.body.locationTag || '').trim();
    const description = String(req.body.description || '').trim();
    const crimeType = String(req.body.crimeType || '').trim();
    const reporterName = req.body.reporterName ? String(req.body.reporterName).trim() : null;
    const reporterPhone = req.body.reporterPhone ? String(req.body.reporterPhone).trim() : null;
    const identityTextRaw = req.body.identityText ? String(req.body.identityText).trim() : '';
    const identityText = identityTextRaw ? identityTextRaw : null;

    if (!locationTag || !description || !crimeType) {
      return res.status(400).json({ error: 'locationTag, description, and crimeType required' });
    }

    const complaintId = randomId();
    const created_at = Date.now();

    // Insert complaint
    await pool.query(
      `INSERT INTO complaints 
       (id, user_id, location_tag, description, identity_text, crime_type, reporter_name, reporter_phone, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'submitted', $9)`,
      [complaintId, userId, locationTag, description, identityText, crimeType, reporterName, reporterPhone, created_at]
    );

    // Upload files to Vercel Blob (if available) or local filesystem
    const files = Array.isArray(req.files) ? req.files : [];
    
    for (const f of files) {
      const ext = path.extname(f.originalname || '').toLowerCase() || '';
      const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
      const safeExt = allowed.includes(ext) ? ext : '.png';
      const filename = `${randomId()}${safeExt}`;
      const filepath = `/complaint-images/${complaintId}/${filename}`;

      // If BLOB_READ_WRITE_TOKEN is available (Vercel Blob), upload there
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        try {
          await put(`complaint-images/${complaintId}/${filename}`, f.buffer, {
            access: 'public',
            contentType: f.mimetype || 'image/png',
          });
          console.log(`[BLOB] Uploaded ${filename}`);
        } catch (blobErr) {
          console.error(`[BLOB] Upload failed for ${filename}:`, blobErr);
          // Fall through to local storage as fallback
        }
      }

      // Always save locally as fallback
      const complaintImagesDir = path.join(UPLOADS_DIR, 'complaint-images', complaintId);
      fs.mkdirSync(complaintImagesDir, { recursive: true });
      fs.writeFileSync(path.join(complaintImagesDir, filename), f.buffer);

      // Record in database
      await pool.query(
        `INSERT INTO complaint_images (id, complaint_id, file_path, created_at)
         VALUES ($1, $2, $3, $4)`,
        [randomId(), complaintId, filepath, created_at]
      );
    }

    return res.json({ ok: true, complaintId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/complaints/mine', requireUser, async (req, res) => {
  try {
    const userId = req.session.userId;
    const complaintsResult = await pool.query(
      `SELECT * FROM complaints WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    const withImages = await Promise.all(
      complaintsResult.rows.map(async (c) => {
        const imagesResult = await pool.query(
          'SELECT file_path FROM complaint_images WHERE complaint_id = $1 ORDER BY created_at DESC',
          [c.id]
        );
        return {
          id: c.id,
          locationTag: c.location_tag,
          description: c.description,
          identityText: c.identity_text,
          crimeType: c.crime_type,
          reporterName: c.reporter_name,
          reporterPhone: c.reporter_phone,
          status: c.status,
          policeNotes: c.police_notes,
          verifiedAt: c.verified_at,
          createdAt: c.created_at,
          images: imagesResult.rows.map((i) => `/uploads${i.file_path}`),
        };
      })
    );

    res.json({ complaints: withImages });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ---------- Police view / verify ----------
app.get('/api/police/complaints', requirePolice, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : 'submitted';
    const allowed = ['submitted', 'verified', 'rejected'];
    const safeStatus = allowed.includes(status) ? status : 'submitted';

    const rowsResult = await pool.query(
      `SELECT c.*, u.display_name, u.email
       FROM complaints c
       JOIN users u ON u.id = c.user_id
       WHERE c.status = $1
       ORDER BY c.created_at DESC`,
      [safeStatus]
    );

    const result = await Promise.all(
      rowsResult.rows.map(async (c) => {
        const imagesResult = await pool.query(
          'SELECT file_path FROM complaint_images WHERE complaint_id = $1 ORDER BY created_at DESC',
          [c.id]
        );
        return {
          id: c.id,
          locationTag: c.location_tag,
          description: c.description,
          identityText: c.identity_text,
          crimeType: c.crime_type,
          reporterName: c.reporter_name,
          reporterPhone: c.reporter_phone,
          reporter: {
            userId: c.user_id,
            displayName: c.display_name,
            email: c.email,
          },
          status: c.status,
          policeNotes: c.police_notes,
          verifiedAt: c.verified_at,
          createdAt: c.created_at,
          images: imagesResult.rows.map((i) => `/uploads${i.file_path}`),
        };
      })
    );

    res.json({ complaints: result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/police/complaints/:id/action', requirePolice, async (req, res) => {
  try {
    const complaintId = req.params.id;
    const action = String(req.body.action || '').trim(); // verify|reject
    const policeNotes = req.body.policeNotes ? String(req.body.policeNotes).trim() : null;
    const now = Date.now();

    const complaintResult = await pool.query('SELECT * FROM complaints WHERE id = $1', [complaintId]);
    if (complaintResult.rows.length === 0) return res.status(404).json({ error: 'Complaint not found' });

    const complaint = complaintResult.rows[0];

    if (!['verify', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

    if (action === 'reject') {
      await pool.query(
        `UPDATE complaints SET status = 'rejected', police_notes = $1 WHERE id = $2`,
        [policeNotes, complaintId]
      );
      return res.json({ ok: true });
    }

    // Verify action
    await pool.query(
      `UPDATE complaints SET status = 'verified', police_notes = $1, verified_at = $2 WHERE id = $3`,
      [policeNotes, now, complaintId]
    );

    // Create complaint reward
    const rewardExists = await pool.query(
      `SELECT id FROM rewards WHERE source_type = 'complaint' AND source_id = $1 AND user_id = $2`,
      [complaintId, complaint.user_id]
    );

    if (rewardExists.rows.length === 0) {
      await pool.query(
        `INSERT INTO rewards (id, user_id, source_type, source_id, amount, status, created_at)
         VALUES ($1, $2, 'complaint', $3, $4, 'pending', $5)`,
        [randomId(), complaint.user_id, complaintId, COMPLAINT_REWARD_AMOUNT, now]
      );
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ---------- Rewards ----------
app.get('/api/rewards/mine', requireUser, async (req, res) => {
  try {
    const userId = req.session.userId;
    const rowsResult = await pool.query(
      `SELECT id, source_type, source_id, amount, status, created_at
       FROM rewards
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    const formatted = rowsResult.rows.map((r) => ({
      id: r.id,
      sourceType: r.source_type,
      sourceId: r.source_id,
      amount: r.amount,
      currency: CURRENCY,
      status: r.status,
      createdAt: r.created_at,
    }));

    res.json({ rewards: formatted });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ---------- App pages ----------
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
});

app.get('/police', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'police.html'));
});

app.get('/rewards', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'rewards.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'register.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'login.html'));
});

app.use((req, res) => {
  res.status(404).send('Not found');
});

const server = app.listen(PORT, () => {
  console.log(`[TNPOL] Listening on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[TNPOL] SIGTERM received, shutting down gracefully');
  server.close(async () => {
    await pool.end();
    console.log('[TNPOL] Server closed');
    process.exit(0);
  });
});

