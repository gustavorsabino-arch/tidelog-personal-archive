/**
 * Tidelog API Server
 * Proxies requests to Birdeye, Helius, and QuickBooks
 * keeping all API keys securely in environment variables.
 *
 * Endpoints:
 *   GET  /health                    → uptime check
 *   GET  /auth/google               → redirect to Google login
 *   GET  /auth/google/callback      → Google OAuth callback
 *   GET  /auth/status               → check if session is authenticated
 *   GET  /auth/verify?token=...     → verify a login token (cross-site auth)
 *   GET  /auth/logout               → destroy session
 *   GET  /proxy/birdeye             → proxy to Birdeye API
 *   POST /proxy/helius/rpc          → proxy to Helius RPC
 *   POST /proxy/helius/transactions → proxy to Helius REST
 *   GET  /proxy/qb?path=...         → proxy to QB API (requires valid token)
 *   POST /auth/qb/token             → exchange/refresh QB OAuth tokens
 *   GET  /auth/qb/callback          → OAuth callback from Intuit
 *   GET  /auth/qb/connect           → redirect to Intuit OAuth
 *   POST /auth/qb/save_tokens       → save tokens server-side (per entity)
 *   GET  /auth/qb/load_tokens       → load tokens (per entity)
 *   GET  /budget/team               → load team tracker data
 *   POST /budget/team               → save full team tracker
 *   PATCH /budget/team/:id          → update one team member
 *   POST /budget/team/add           → add a new team member
 *   DELETE /budget/team/:id         → soft-terminate a team member
 *   GET  /api/access/me             → get current user permissions
 *   GET  /api/access/list           → list all users (admin only)
 *   POST /api/access/user           → create/update user permissions (admin only)
 *   DELETE /api/access/user/:email  → delete user permissions (admin only)
 *   POST /api/budget/import         → import budget from Excel (budget_admin only)
 *   POST /api/snapshot/upload       → upload transaction snapshot (admin only)
 *   GET  /api/snapshot/data         → retrieve transaction snapshot (authenticated)
 */

'use strict';

const express          = require('express');
const cors             = require('cors');
const fetch            = require('node-fetch');
const crypto           = require('crypto');
const cookieSession    = require('cookie-session');
const passport         = require('passport');
const GoogleStrategy   = require('passport-google-oauth20').Strategy;
const Database         = require('better-sqlite3');
const fs               = require('fs');
const path             = require('path');
const multer           = require('multer');
const XLSX             = require('xlsx');

// ── Budget Line Items Mapping ──────────────────────────────────────────────────
const CAT_LINES = [
  {cat:'Compensation & Benefits', line:'Salaries & Wages',        key:'salary'},
  {cat:'Compensation & Benefits', line:'Bonus',                   key:'bonus'},
  {cat:'Compensation & Benefits', line:'Commissions',             key:'commissions'},
  {cat:'Compensation & Benefits', line:'Benefits',                key:'benefits'},
  {cat:'Compensation & Benefits', line:'Payroll Taxes',           key:'payroll'},
  {cat:'Compensation & Benefits', line:'Severance Pay',           key:'severance'},
  {cat:'Software & SaaS',         line:'EPD Tools',               key:'epdTools'},
  {cat:'Software & SaaS',         line:'Business Tools',          key:'bizTools'},
  {cat:'Hosting & Infrastructure', line:'Cloud Hosting & Compute', key:'hosting'},
  {cat:'Hosting & Infrastructure', line:'Blockchain & RPC',        key:'blockchainRpc'},
  {cat:'Hosting & Infrastructure', line:'Security & Monitoring',   key:'securityMon'},
  {cat:'HR & Recruiting',         line:'HR Costs',                key:'hrCosts'},
  {cat:'HR & Recruiting',         line:'Third-Party & Referrals', key:'recruiting'},
  {cat:'Marketing Expense',       line:'Events',                  key:'meals'},
  {cat:'Marketing Expense',       line:'Other',                   key:'mktExp'},
  {cat:'Travel & Entertainment',  line:'Travel',                  key:'travel'},
  {cat:'Travel & Entertainment',  line:'Company Offsite',         key:'colos'},
  {cat:'Professional Services',   line:'Professional Services',   key:'profSvc'},
  {cat:'Professional Services',   line:'Entity Compliance',       key:'compliance'},
  {cat:'Professional Services',   line:'Corporate Compliance',    key:'corpFees'},
  {cat:'Professional Services',   line:'Lobbying',                key:'lobbying'},
  {cat:'Transaction Fees',        line:'Bank Fees',               key:'bankFees'},
];

function findKeyForLineItem(lineItemName) {
  if (!lineItemName) return null;
  const normalized = lineItemName.toString().trim().toLowerCase();
  for (const item of CAT_LINES) {
    if (item.line.toLowerCase() === normalized) return item.key;
  }
  for (const item of CAT_LINES) {
    if (normalized.includes(item.line.toLowerCase()) || item.line.toLowerCase().includes(normalized)) return item.key;
  }
  return lineItemName.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

// ── Global error handlers ──────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] [FATAL] Uncaught exception:`, err);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[${new Date().toISOString()}] [FATAL] Unhandled rejection:`, reason);
});

const app  = express();
const PORT = process.env.PORT || 8080;

const upload = multer({ storage: multer.memoryStorage() });

// ── SQLite Database ────────────────────────────────────────────────────────────
const dbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH 
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'tidelog.db')
  : path.join(__dirname, 'tidelog.db');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH 
  ? process.env.RAILWAY_VOLUME_MOUNT_PATH
  : __dirname;

console.log(`[DB] Database path: ${dbPath}`);
console.log(`[DB] Data directory: ${DATA_DIR}`);
console.log(`[DB] Volume mount: ${process.env.RAILWAY_VOLUME_MOUNT_PATH || 'NOT SET (using local)'}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const migrationSQL = `
CREATE TABLE IF NOT EXISTS user_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'restricted' CHECK(role IN ('admin', 'restricted', 'budget_admin')),
  budget_department TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO user_access (email, role) 
VALUES ('gustavo@orca.so', 'admin');
`;
db.exec(migrationSQL);
console.log('✓ Database initialized');

// ── Environment variables ──────────────────────────────────────────────────────
const BIRDEYE_KEY          = process.env.BIRDEYE_KEY          || '';
const HELIUS_KEY           = process.env.HELIUS_KEY           || '';
const QB_CLIENT_ID         = process.env.QB_CLIENT_ID         || '';
const QB_CLIENT_SECRET     = process.env.QB_CLIENT_SECRET     || '';
const QB_REDIRECT_URI      = process.env.QB_REDIRECT_URI      || 'http://localhost:8080/auth/qb/callback';
const ALLOWED_ORIGINS      = (process.env.ALLOWED_ORIGINS     || 'http://localhost,http://127.0.0.1,https://tidelog-frontend.vercel.app,https://*.vercel.app').split(',').map(s => s.trim());
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const SESSION_SECRET       = process.env.SESSION_SECRET       || 'fallback-secret-change-me';
const SERVER_BASE_URL      = process.env.SERVER_BASE_URL      || 'https://tidelog-server-production.up.railway.app';
const FRONTEND_URL         = process.env.FRONTEND_URL         || 'https://tidelog-orca.netlify.app';

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const RAILWAY_API_TOKEN  = process.env.RAILWAY_API_TOKEN  || '';
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID || '';
const RAILWAY_SERVICE_ID = process.env.RAILWAY_SERVICE_ID || '';
const RAILWAY_ENV_ID     = process.env.RAILWAY_ENV_ID     || '';

const QB_BASE_URL  = 'https://quickbooks.api.intuit.com';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_AUTH_URL  = 'https://appcenter.intuit.com/connect/oauth2';
const QB_SCOPE     = 'com.intuit.quickbooks.accounting';

// ── In-memory stores ───────────────────────────────────────────────────────────
const _tokenStore   = {};
const _oauthStates  = {};
const _loginTokens  = {};

let _budgetData    = { team: [], lastUpdated: null, updatedBy: null };
let _budgetMapping = { mapping: [], lastUpdated: null };
let _budgetLines   = {};

// ── Load persisted data ────────────────────────────────────────────────────────
function loadPersistedTokens() {
  const raw = process.env.QB_TOKENS_JSON;
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    for (const [realmId, data] of Object.entries(parsed)) {
      _tokenStore[realmId] = data;
    }
    log('INFO', `Loaded persisted tokens for: ${Object.keys(parsed).join(', ')}`);
  } catch (e) {
    log('WARN', 'Failed to parse QB_TOKENS_JSON', { error: e.message });
  }
}

function loadPersistedBudgetData() {
  const raw = process.env.BUDGET_DATA_JSON;
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.team) _budgetData = parsed;
    log('INFO', `Budget data loaded: ${_budgetData.team.length} team members`);
  } catch (e) {
    log('WARN', 'Failed to parse BUDGET_DATA_JSON', { error: e.message });
  }
}

function loadPersistedBudgetMapping() {
  const raw = process.env.BUDGET_MAPPING_JSON;
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.mapping) _budgetMapping = parsed;
    log('INFO', `Budget mapping loaded: ${_budgetMapping.mapping.length} lines`);
  } catch (e) {
    log('WARN', 'Failed to parse BUDGET_MAPPING_JSON', { error: e.message });
  }
}

async function railwayUpsert(variables) {
  if (!RAILWAY_API_TOKEN || !RAILWAY_PROJECT_ID || !RAILWAY_SERVICE_ID || !RAILWAY_ENV_ID) return;
  const query = `mutation UpsertVariables($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`;
  try {
    const r = await fetch('https://backboard.railway.com/graphql/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RAILWAY_API_TOKEN}` },
      body: JSON.stringify({ query, variables: { input: { projectId: RAILWAY_PROJECT_ID, serviceId: RAILWAY_SERVICE_ID, environmentId: RAILWAY_ENV_ID, variables } } }),
    });
    const data = await r.json();
    if (data.errors) log('WARN', 'Railway upsert error', { errors: data.errors });
  } catch (e) {
    log('WARN', 'Railway upsert failed', { error: e.message });
  }
}

async function persistTokens() {
  await railwayUpsert({ QB_TOKENS_JSON: JSON.stringify(_tokenStore) });
  log('INFO', `Tokens persisted for: ${Object.keys(_tokenStore).join(', ')}`);
}

async function persistBudgetData() {
  await railwayUpsert({ BUDGET_DATA_JSON: JSON.stringify(_budgetData) });
  log('INFO', `Budget data persisted (${_budgetData.team.length} members)`);
}

async function persistBudgetMapping() {
  await railwayUpsert({ BUDGET_MAPPING_JSON: JSON.stringify(_budgetMapping) });
  log('INFO', `Budget mapping persisted (${_budgetMapping.mapping.length} lines)`);
}

function loadPersistedBudgetLines() {
  const raw = process.env.BUDGET_LINES_JSON;
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      _budgetLines = parsed;
      log('INFO', `Budget lines loaded: years [${Object.keys(_budgetLines).join(', ')}]`);
    }
  } catch (e) {
    log('WARN', 'Failed to parse BUDGET_LINES_JSON', { error: e.message });
  }
}

async function persistBudgetLines() {
  await railwayUpsert({ BUDGET_LINES_JSON: JSON.stringify(_budgetLines) });
  log('INFO', `Budget lines persisted: years [${Object.keys(_budgetLines).join(', ')}]`);
}

// ── Middleware ─────────────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    const allowed = ALLOWED_ORIGINS.some(o => {
      if (o === '*') return true;
      if (origin === o) return true;
      if (o.startsWith('*.')) return origin.endsWith(o.slice(1));
      return false;
    });
    if (allowed) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token'],
  credentials: true,
}));

app.use(cookieSession({
  name: 'tidelog_session', secret: SESSION_SECRET,
  maxAge: 24 * 60 * 60 * 1000, secure: true, sameSite: 'none', httpOnly: true,
}));

app.use((req, res, next) => {
  if (req.session && !req.session.regenerate) req.session.regenerate = (cb) => cb();
  if (req.session && !req.session.save) req.session.save = (cb) => cb();
  next();
});

app.use(passport.initialize());
app.use(passport.session());

// ── Passport ──────────────────────────────────────────────────────────────────
passport.use(new GoogleStrategy(
  { clientID: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, callbackURL: `${SERVER_BASE_URL}/auth/google/callback` },
  function(accessToken, refreshToken, profile, done) {
    const email = profile.emails?.[0]?.value;
    if (!email) return done(null, false, { message: 'No email from Google' });
    const emailLower = email.toLowerCase();
    if (!emailLower.endsWith('@orca.so') && !ALLOWED_EMAILS.includes(emailLower)) {
      log('WARN', `Login blocked for: ${email}`);
      return done(null, false, { message: 'Access restricted' });
    }
    log('INFO', `Google login success: ${email}`);
    return done(null, { email, name: profile.displayName });
  }
));
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  const token = req.headers['x-auth-token'];
  if (token) {
    const entry = _loginTokens[token];
    if (entry && Date.now() < entry.expiry) {
      req.user = entry.user;
      return next();
    }
  }
  res.status(401).json({ error: 'Not authenticated', loginUrl: `${SERVER_BASE_URL}/auth/google` });
}

const authMiddleware = requireAuth;

// ── Utility ────────────────────────────────────────────────────────────────────
function log(level, msg, data) {
  const ts = new Date().toISOString();
  if (data) console.log(`[${ts}] [${level}] ${msg}`, JSON.stringify(data));
  else      console.log(`[${ts}] [${level}] ${msg}`);
}

function missingEnv(...keys) { return keys.filter(k => !process.env[k]); }

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of Object.entries(_loginTokens)) {
    if (now >= entry.expiry) delete _loginTokens[token];
  }
}, 60 * 60 * 1000);

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const missing = missingEnv('BIRDEYE_KEY', 'HELIUS_KEY', 'QB_CLIENT_ID', 'QB_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
  res.json({
    status: 'ok', ts: new Date().toISOString(),
    env: {
      birdeye: !!BIRDEYE_KEY, helius: !!HELIUS_KEY, qb_id: !!QB_CLIENT_ID,
      qb_secret: !!QB_CLIENT_SECRET, google_id: !!GOOGLE_CLIENT_ID,
      google_secret: !!GOOGLE_CLIENT_SECRET, redirect: QB_REDIRECT_URI,
      railway_api: !!RAILWAY_API_TOKEN, allowed_emails: ALLOWED_EMAILS.length,
      budget_members: _budgetData.team.length,
    },
    warnings: missing.length ? `Missing env vars: ${missing.join(', ')}` : null,
    entities_with_tokens: Object.keys(_tokenStore),
  });
});

// ── Google Auth ────────────────────────────────────────────────────────────────
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: `${FRONTEND_URL}?auth=denied` }),
  (req, res) => {
    const loginToken = crypto.randomBytes(32).toString('hex');
    _loginTokens[loginToken] = { user: req.user, expiry: Date.now() + 7 * 24 * 60 * 60 * 1000 };
    log('INFO', `Login token generated for ${req.user.email}`);
    res.redirect(`${FRONTEND_URL}?auth=ok&token=${loginToken}`);
  }
);

app.get('/auth/status', (req, res) => {
  if (req.isAuthenticated()) return res.json({ authenticated: true, user: req.user });
  const token = req.headers['x-auth-token'];
  if (token) {
    const entry = _loginTokens[token];
    if (entry && Date.now() < entry.expiry) return res.json({ authenticated: true, user: entry.user });
  }
  res.json({ authenticated: false, loginUrl: `${SERVER_BASE_URL}/auth/google` });
});

app.get('/auth/verify', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });
  const entry = _loginTokens[token];
  if (!entry || Date.now() >= entry.expiry) return res.status(401).json({ error: 'Invalid or expired token' });
  res.json({ ok: true, user: entry.user });
});

app.get('/auth/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) delete _loginTokens[token];
  req.logout(() => res.json({ ok: true }));
});

// ── Birdeye proxy ──────────────────────────────────────────────────────────────
app.get('/proxy/birdeye', requireAuth, async (req, res) => {
  if (!BIRDEYE_KEY) return res.status(503).json({ error: 'Birdeye not configured' });
  const { path: apiPath, ...params } = req.query;
  if (!apiPath) return res.status(400).json({ error: 'Missing ?path=' });
  const qs = new URLSearchParams(params).toString();
  const url = `https://public-api.birdeye.so${apiPath}${qs ? '?' + qs : ''}`;
  try {
    const r = await fetch(url, {
      headers: {
        'X-API-KEY': BIRDEYE_KEY,
        'x-api-key': BIRDEYE_KEY,
        'x-chain': req.query.chain || 'solana',
        'accept': 'application/json',
      }
    });
    res.status(r.status).json(await r.json());
  } catch (e) {
    log('ERROR', 'Birdeye proxy failed', { error: e.message });
    res.status(502).json({ error: e.message });
  }
});

// ── Helius proxy ───────────────────────────────────────────────────────────────
app.post('/proxy/helius/rpc', requireAuth, async (req, res) => {
  if (!HELIUS_KEY) return res.status(503).json({ error: 'Helius not configured' });
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/proxy/helius/transactions', requireAuth, async (req, res) => {
  if (!HELIUS_KEY) return res.status(503).json({ error: 'Helius not configured' });
  try {
    const r = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/proxy/helius/addresses/:address/transactions', requireAuth, async (req, res) => {
  if (!HELIUS_KEY) return res.status(503).json({ error: 'Helius not configured' });
  const { address } = req.params;
  const qs = new URLSearchParams(req.query).toString();
  try {
    const r = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_KEY}${qs ? '&' + qs : ''}`, { headers: { 'Content-Type': 'application/json' } });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── QuickBooks proxy ───────────────────────────────────────────────────────────
// Uses Authorization: Bearer token from request header if provided (fresher token from frontend)
// Falls back to internal token store with auto-refresh
app.get('/proxy/qb', requireAuth, async (req, res) => {
  const { path: apiPath, realmId } = req.query;
  if (!apiPath) return res.status(400).json({ error: 'Missing ?path=' });
  if (!realmId) return res.status(400).json({ error: 'Missing ?realmId=' });

  // Prefer token from Authorization header (frontend has fresher token after client-side refresh)
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  let accessToken = headerToken;

  if (!accessToken) {
    // No header token — use internal store with auto-refresh
    const tokenData = _tokenStore[realmId];
    if (!tokenData?.accessToken) {
      return res.status(401).json({ error: 'No token for this realmId — please connect QB first', realmId });
    }
    if (Date.now() > tokenData.expiry - 300000) {
      try { await refreshQBToken(realmId); }
      catch (e) { return res.status(401).json({ error: 'Token refresh failed — please reconnect QB', detail: e.message }); }
    }
    accessToken = _tokenStore[realmId].accessToken;
  }

  const url = `${QB_BASE_URL}${apiPath}`;
  log('INFO', `QB request for realmId ${realmId}`, { url });

  try {
    const r = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
    });
    const text = await r.text();
    log('INFO', `QB response ${r.status} for realmId ${realmId}`);
    try { res.status(r.status).json(JSON.parse(text)); }
    catch { res.status(502).json({ error: 'QB returned non-JSON', qbStatus: r.status, preview: text.substring(0, 500) }); }
  } catch (e) {
    log('ERROR', 'QB proxy failed', { error: e.message });
    res.status(502).json({ error: e.message });
  }
});

// ── QuickBooks OAuth ───────────────────────────────────────────────────────────
app.get('/auth/qb/connect', (req, res) => {
  const { entity, realmId } = req.query;
  if (!entity || !realmId) return res.status(400).send('Missing entity or realmId');
  if (!QB_CLIENT_ID) return res.status(503).send('QB not configured');

  const random = crypto.randomBytes(12).toString('hex');
  const payload = Buffer.from(JSON.stringify({ entity, realmId, ts: Date.now() })).toString('base64url');
  const state = `${payload}.${random}`;

  _oauthStates[state] = { entity, realmId, ts: Date.now() };
  for (const [s, v] of Object.entries(_oauthStates)) {
    if (Date.now() - v.ts > 7200000) delete _oauthStates[s];
  }

  const params = new URLSearchParams({
    client_id: QB_CLIENT_ID, scope: QB_SCOPE,
    redirect_uri: QB_REDIRECT_URI, response_type: 'code', state,
  });

  log('INFO', `QB OAuth start for ${entity} (${realmId})`);
  res.redirect(`${QB_AUTH_URL}?${params}`);
});

app.get('/auth/qb/callback', async (req, res) => {
  const { code, state, realmId: callbackRealmId, error } = req.query;

  if (error) {
    log('WARN', 'QB OAuth error from Intuit', { error });
    return res.status(400).send(`QB auth error: ${error}`);
  }

  let stateData = _oauthStates[state];
  if (!stateData && state) {
    try {
      const payloadPart = state.split('.')[0];
      stateData = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
      log('INFO', 'OAuth state decoded from payload (server was restarted)');
    } catch (e) {
      log('WARN', 'Failed to decode OAuth state', { error: e.message });
    }
  }

  if (!stateData) {
    return res.status(400).send('Invalid or expired OAuth state. Please try connecting again.');
  }
  delete _oauthStates[state];

  const realmId = callbackRealmId || stateData.realmId;

  try {
    const tokenRes = await fetch(QB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64'),
        'Accept': 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: QB_REDIRECT_URI }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Token exchange failed (${tokenRes.status}): ${err}`);
    }

    const tokens = await tokenRes.json();
    saveTokens(realmId, tokens.access_token, tokens.refresh_token, tokens.expires_in || 3600);
    await persistTokens();
    log('INFO', `QB tokens saved for ${stateData.entity} (${realmId})`);

    res.send(`<!DOCTYPE html>
<html><head><title>Connected!</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1117;color:#06D6A0}</style>
</head><body>
  <div style="text-align:center">
    <div style="font-size:2rem;margin-bottom:8px">✓</div>
    <div style="font-size:1rem">QuickBooks connected for <strong>${stateData.entity}</strong></div>
    <div style="font-size:0.75rem;color:#888;margin-top:8px">This window will close automatically…</div>
  </div>
  <script>
    if(window.opener) {
      window.opener.postMessage({ type: 'QB_AUTH_SUCCESS', realmId: '${realmId}', entity: '${stateData.entity}' }, '*');
    }
    setTimeout(() => window.close(), 1500);
  </script>
</body></html>`);

  } catch (e) {
    log('ERROR', 'QB token exchange failed', { error: e.message });
    res.status(500).send(`Connection failed: ${e.message}`);
  }
});

app.post('/auth/qb/token', async (req, res) => {
  const { grant_type, refresh_token, code, realmId } = req.body;
  if (!grant_type) return res.status(400).json({ error: 'Missing grant_type' });
  if (!realmId)    return res.status(400).json({ error: 'Missing realmId' });
  try {
    const body = new URLSearchParams({ grant_type, redirect_uri: QB_REDIRECT_URI });
    if (grant_type === 'refresh_token') body.set('refresh_token', refresh_token);
    if (grant_type === 'authorization_code') body.set('code', code);
    const tokenRes = await fetch(QB_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64'), 'Accept': 'application/json' },
      body,
    });
    if (!tokenRes.ok) { const err = await tokenRes.text(); return res.status(tokenRes.status).json({ error: err }); }
    const tokens = await tokenRes.json();
    saveTokens(realmId, tokens.access_token, tokens.refresh_token || refresh_token, tokens.expires_in || 3600);
    await persistTokens();
    res.json({ access_token: tokens.access_token, refresh_token: tokens.refresh_token || refresh_token, expires_in: tokens.expires_in || 3600 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/auth/qb/save_tokens', async (req, res) => {
  const { accessToken, refreshToken, expiry, realmId } = req.body;
  if (!accessToken || !realmId) return res.status(400).json({ error: 'Missing accessToken or realmId' });
  _tokenStore[realmId] = { accessToken, refreshToken, expiry: expiry || Date.now() + 3540000 };
  await persistTokens();
  res.json({ ok: true });
});

app.get('/auth/qb/load_tokens', (req, res) => {
  const { realmId } = req.query;
  if (!realmId) {
    const connected = Object.entries(_tokenStore).map(([id, t]) => ({
      realmId: id, connected: !!t.accessToken, expiry: t.expiry, expired: Date.now() > t.expiry,
      accessToken: t.accessToken, refreshToken: t.refreshToken
    }));
    const first = Object.entries(_tokenStore).find(([id, t]) => t.accessToken && Date.now() < t.expiry);
    if (first) {
      const [firstRealmId, firstTokens] = first;
      return res.json({ entities: connected, accessToken: firstTokens.accessToken, refreshToken: firstTokens.refreshToken, expiry: firstTokens.expiry, realmId: firstRealmId });
    }
    return res.json({ entities: connected });
  }
  const t = _tokenStore[realmId];
  if (!t) return res.status(404).json({ error: 'No tokens for realmId' });
  res.json({ accessToken: t.accessToken, refreshToken: t.refreshToken, expiry: t.expiry, realmId });
});

// ── Budget — Team Tracker ──────────────────────────────────────────────────────
app.get('/budget/team', requireAuth, (req, res) => {
  res.json({ team: _budgetData.team, lastUpdated: _budgetData.lastUpdated, updatedBy: _budgetData.updatedBy });
});

app.post('/budget/team', requireAuth, async (req, res) => {
  const { team } = req.body;
  if (!Array.isArray(team)) return res.status(400).json({ error: 'Expected { team: [...] }' });
  _budgetData.team = team;
  _budgetData.lastUpdated = new Date().toISOString();
  _budgetData.updatedBy = req.user?.email || 'unknown';
  log('INFO', `Budget team saved by ${_budgetData.updatedBy} (${team.length} members)`);
  await persistBudgetData();
  res.json({ ok: true, count: team.length, lastUpdated: _budgetData.lastUpdated });
});

app.patch('/budget/team/:id', requireAuth, async (req, res) => {
  const id  = parseInt(req.params.id);
  const idx = _budgetData.team.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: `Member ${id} not found` });
  _budgetData.team[idx] = { ..._budgetData.team[idx], ...req.body };
  _budgetData.lastUpdated = new Date().toISOString();
  _budgetData.updatedBy = req.user?.email || 'unknown';
  await persistBudgetData();
  res.json({ ok: true, member: _budgetData.team[idx] });
});

app.post('/budget/team/add', requireAuth, async (req, res) => {
  const member = req.body;
  if (!member.name) return res.status(400).json({ error: 'name required' });
  member.id = _budgetData.team.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
  member.createdAt = new Date().toISOString();
  _budgetData.team.push(member);
  _budgetData.lastUpdated = new Date().toISOString();
  _budgetData.updatedBy = req.user?.email || 'unknown';
  await persistBudgetData();
  res.json({ ok: true, member });
});

app.delete('/budget/team/:id', requireAuth, async (req, res) => {
  const id  = parseInt(req.params.id);
  const idx = _budgetData.team.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: `Member ${id} not found` });
  _budgetData.team[idx].status = 'Terminated';
  _budgetData.team[idx].terminatedAt = new Date().toISOString();
  _budgetData.lastUpdated = new Date().toISOString();
  _budgetData.updatedBy = req.user?.email || 'unknown';
  await persistBudgetData();
  res.json({ ok: true, member: _budgetData.team[idx] });
});

// ── Budget — QB Mapping ────────────────────────────────────────────────────────
app.get('/budget/mapping', requireAuth, (req, res) => {
  res.json({ mapping: _budgetMapping.mapping, lastUpdated: _budgetMapping.lastUpdated });
});

app.post('/budget/mapping', requireAuth, async (req, res) => {
  const { mapping } = req.body;
  if (!Array.isArray(mapping)) return res.status(400).json({ error: 'Expected { mapping: [...] }' });
  _budgetMapping.mapping = mapping;
  _budgetMapping.lastUpdated = new Date().toISOString();
  log('INFO', `Budget mapping saved (${mapping.length} lines)`);
  await persistBudgetMapping();
  res.json({ ok: true, count: mapping.length, lastUpdated: _budgetMapping.lastUpdated });
});

app.get('/budget/lines', requireAuth, (req, res) => {
  const yr = req.query.year || '2025';
  res.json({ lines: _budgetLines[yr] || null, year: yr });
});

app.post('/budget/lines', requireAuth, async (req, res) => {
  const { year, lines } = req.body;
  if (!year || !lines || typeof lines !== 'object') return res.status(400).json({ error: 'Expected { year, lines }' });
  _budgetLines[year] = lines;
  log('INFO', `Budget lines saved for ${year}`);
  await persistBudgetLines();
  res.json({ ok: true, year, lastUpdated: new Date().toISOString() });
});

// ── Access Control ─────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const userEmail = req.user?.email;
  if (!userEmail) return res.status(401).json({ error: 'Not authenticated' });
  const row = db.prepare('SELECT role FROM user_access WHERE email = ?').get(userEmail);
  if (!row && userEmail === 'gustavo@orca.so') return next();
  if (!row || row.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function requireBudgetAdmin(req, res, next) {
  const userEmail = req.user?.email;
  if (!userEmail) return res.status(401).json({ error: 'Not authenticated' });
  const row = db.prepare('SELECT role FROM user_access WHERE email = ?').get(userEmail);
  if (!row && userEmail === 'gustavo@orca.so') return next();
  if (!row || (row.role !== 'admin' && row.role !== 'budget_admin')) return res.status(403).json({ error: 'Budget admin access required' });
  next();
}

app.get('/api/access/me', authMiddleware, (req, res) => {
  const email = req.user.email;
  const row = db.prepare('SELECT * FROM user_access WHERE email = ?').get(email);
  if (!row) {
    if (email === 'gustavo@orca.so') {
      log('WARN', `Admin fallback for ${email} (no DB entry)`);
      return res.json({ email, role: 'admin', permissions: null });
    } else {
      log('WARN', `Access denied for ${email} (no DB entry, not gustavo)`);
      return res.status(403).json({ error: 'Access not configured', message: 'Your account does not have access permissions. Please contact an administrator.' });
    }
  }
  if (row.role === 'admin') return res.json({ email: row.email, role: 'admin', permissions: null });
  if (row.role === 'budget_admin') {
    return res.json({
      email: row.email, role: 'budget_admin',
      permissions: { allowedPages: ['budget'], budgetDepartments: null, budgetTabs: ['departments'], canImportBudget: true }
    });
  }
  res.json({
    email: row.email, role: row.role,
    permissions: { allowedPages: ['budget'], budgetDepartments: row.budget_department ? [row.budget_department] : [], budgetTabs: ['departments'] }
  });
});

app.get('/api/access/list', authMiddleware, requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT email, role, budget_department, created_at, updated_at FROM user_access ORDER BY role DESC, email ASC`).all();
  res.json({ users: rows });
});

app.post('/api/access/user', authMiddleware, requireAdmin, (req, res) => {
  const { email, role, budgetDepartment } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  if (!['admin', 'restricted', 'budget_admin'].includes(role)) return res.status(400).json({ error: 'Role must be admin, budget_admin, or restricted' });
  if (role === 'restricted' && !budgetDepartment) return res.status(400).json({ error: 'Budget department required for restricted users' });
  try {
    db.prepare(`INSERT INTO user_access (email, role, budget_department, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(email) DO UPDATE SET role = excluded.role, budget_department = excluded.budget_department, updated_at = CURRENT_TIMESTAMP`).run(email.toLowerCase().trim(), role, role === 'restricted' ? budgetDepartment : null);
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving user access:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/access/user/:email', authMiddleware, requireAdmin, (req, res) => {
  const email = req.params.email;
  if (email === 'gustavo@orca.so') return res.status(403).json({ error: 'Cannot delete primary admin' });
  db.prepare('DELETE FROM user_access WHERE email = ?').run(email);
  res.json({ success: true });
});

// ── Budget Import ──────────────────────────────────────────────────────────────
app.post('/api/budget/import', authMiddleware, requireBudgetAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { year, month, department, confirm } = req.body;
    if (!year) return res.status(400).json({ error: 'Year required' });
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    log('INFO', `Excel file parsed: ${workbook.SheetNames.length} sheets found`, { sheets: workbook.SheetNames });
    if (!_budgetLines[year]) _budgetLines[year] = {};
    const results = { departmentsProcessed: [], departmentsMissing: [], departmentsOverwritten: [], totalRows: 0, totalKeys: 0 };
    const VALID_DEPTS = ['General', 'Ops', 'Finance', 'Legal', 'Product', 'Engineering', 'Marketing', 'Business Development'];
    const sheetsToProcess = department === 'All' ? workbook.SheetNames.filter(name => name !== 'Sheet1') : [department];
    log('INFO', `Sheets to process: ${sheetsToProcess.join(', ')}`, { department });
    if (department === 'All') {
      const foundDepts = sheetsToProcess.map(s => s.toLowerCase());
      VALID_DEPTS.forEach(dept => { if (!foundDepts.includes(dept.toLowerCase())) results.departmentsMissing.push(dept); });
    }
    if (confirm !== 'true') {
      const existingDepts = [];
      sheetsToProcess.forEach(sheetName => {
        const deptName = VALID_DEPTS.find(d => d.toLowerCase() === sheetName.toLowerCase()) || sheetName;
        if (_budgetLines[year][deptName] && Object.keys(_budgetLines[year][deptName]).length > 0) existingDepts.push(deptName);
      });
      if (existingDepts.length > 0) {
        return res.status(409).json({ error: 'Existing budget data found', needsConfirmation: true, existingDepartments: existingDepts, message: `Budget already exists for ${existingDepts.join(', ')} in ${year}${month ? ` (Month ${month})` : ''}. Do you want to overwrite?` });
      }
    }
    for (const sheetName of sheetsToProcess) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const deptName = VALID_DEPTS.find(d => d.toLowerCase() === sheetName.toLowerCase()) || sheetName;
      if (!_budgetLines[year][deptName]) _budgetLines[year][deptName] = {};
      if (!_budgetLines[year][deptName][month]) _budgetLines[year][deptName][month] = {};
      const hadExistingData = _budgetLines[year][deptName][month] && Object.keys(_budgetLines[year][deptName][month]).length > 0;
      log('INFO', `Processing ${sheetName} for month ${month}: reading column D (Budget) for all line items`);
      let rowsProcessed = 0, keysImported = 0;
      for (let i = 6; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;
        const lineItem = row[2];
        const budgetValue = row[3];
        if (lineItem && budgetValue !== null && budgetValue !== undefined && !lineItem.toLowerCase().includes('total')) {
          const key = findKeyForLineItem(lineItem);
          const value = parseFloat(budgetValue);
          log('INFO', `  Row ${i+1}: "${lineItem}" → key: "${key}" = ${value}`);
          if (!isNaN(value) && key) { _budgetLines[year][deptName][month][key] = value; keysImported++; }
          rowsProcessed++;
        }
      }
      results.departmentsProcessed.push(deptName);
      results.totalRows += rowsProcessed;
      results.totalKeys += keysImported;
      if (hadExistingData) results.departmentsOverwritten.push(deptName);
    }
    await persistBudgetLines();
    log('INFO', `Budget imported for ${results.departmentsProcessed.join(', ')} - ${year}/${month} by ${req.user.email}`, results);
    res.json({ success: true, year, month, ...results });
  } catch (err) {
    log('ERROR', 'Budget import failed', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Import failed', detail: err.message });
  }
});

// ── Snapshot Data ──────────────────────────────────────────────────────────────
const snapshotDataPath = path.join(DATA_DIR, 'snapshot_data.json');
let _snapshotData = null;

function loadSnapshotData() {
  try {
    console.log('[SNAPSHOT] Checking for snapshot data...');
    if (fs.existsSync(snapshotDataPath)) {
      const raw = fs.readFileSync(snapshotDataPath, 'utf8');
      _snapshotData = JSON.parse(raw);
      log('INFO', `Snapshot data loaded: ${_snapshotData?.transactions?.length || 0} transactions`);
    } else {
      console.log('[SNAPSHOT] No snapshot data file found - will be created on first upload');
    }
  } catch (err) {
    log('ERROR', 'Failed to load snapshot data', err.message);
    _snapshotData = null;
  }
}

function saveSnapshotData() {
  try {
    fs.writeFileSync(snapshotDataPath, JSON.stringify(_snapshotData, null, 2), 'utf8');
    log('INFO', 'Snapshot data saved to file');
  } catch (err) {
    log('ERROR', 'Failed to save snapshot data', err.message);
  }
}

app.post('/api/snapshot/upload', authMiddleware, requireAdmin, (req, res) => {
  try {
    const { transactions, metadata } = req.body;
    if (!transactions || !Array.isArray(transactions)) return res.status(400).json({ error: 'Missing or invalid transactions array' });
    _snapshotData = {
      transactions,
      metadata: { uploadedAt: new Date().toISOString(), uploadedBy: req.user.email, transactionCount: transactions.length, dateRange: metadata?.dateRange || null, entities: metadata?.entities || null, tokens: metadata?.tokens || null }
    };
    saveSnapshotData();
    log('INFO', `Snapshot uploaded by ${req.user.email}`, { transactions: transactions.length, dateRange: metadata?.dateRange });
    res.json({ success: true, transactionCount: transactions.length, uploadedAt: _snapshotData.metadata.uploadedAt });
  } catch (err) {
    log('ERROR', 'Snapshot upload failed', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
});

app.get('/api/snapshot/data', authMiddleware, (req, res) => {
  try {
    if (!_snapshotData) return res.status(404).json({ error: 'No snapshot data available' });
    log('INFO', `Snapshot data requested by ${req.user.email}`);
    res.json({ success: true, data: _snapshotData });
  } catch (err) {
    log('ERROR', 'Snapshot retrieval failed', { error: err.message });
    res.status(500).json({ error: 'Retrieval failed', detail: err.message });
  }
});

console.log('✓ Access control endpoints loaded');
console.log('✓ Budget import endpoint loaded');
console.log('✓ Snapshot data endpoints loaded');

// ── QB helpers ─────────────────────────────────────────────────────────────────
function saveTokens(realmId, accessToken, refreshToken, expiresIn) {
  _tokenStore[realmId] = { accessToken, refreshToken, expiry: Date.now() + (expiresIn - 60) * 1000 };
}

async function refreshQBToken(realmId) {
  const t = _tokenStore[realmId];
  if (!t?.refreshToken) throw new Error('No refresh token');
  const tokenRes = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64'), 'Accept': 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken }),
  });
  if (!tokenRes.ok) { const err = await tokenRes.text(); throw new Error(`Refresh failed (${tokenRes.status}): ${err}`); }
  const tokens = await tokenRes.json();
  saveTokens(realmId, tokens.access_token, tokens.refresh_token || t.refreshToken, tokens.expires_in || 3600);
  await persistTokens();
  log('INFO', `Token refreshed for realmId ${realmId}`);
}

// ── Proactive token refresh (every 30 min) ─────────────────────────────────────
async function refreshAllTokens() {
  const realmIds = Object.keys(_tokenStore);
  if (realmIds.length === 0) return;
  log('INFO', `Auto-refresh: checking ${realmIds.length} QB token(s)`);
  for (const realmId of realmIds) {
    const t = _tokenStore[realmId];
    if (!t?.refreshToken) continue;
    if (Date.now() > t.expiry - 60 * 60 * 1000) {
      try {
        await refreshQBToken(realmId);
        log('INFO', `Auto-refresh: token refreshed for ${realmId}`);
      } catch (e) {
        log('WARN', `Auto-refresh failed for ${realmId}: ${e.message}`);
      }
    } else {
      log('INFO', `Auto-refresh: ${realmId} ok (${Math.round((t.expiry - Date.now()) / 60000)}m left)`);
    }
  }
}

// ── Start ──────────────────────────────────────────────────────────────────────
console.log('[INIT] Starting Tidelog server...');
loadPersistedTokens();
loadPersistedBudgetData();
loadPersistedBudgetMapping();
loadPersistedBudgetLines();
loadSnapshotData();
console.log('[INIT] All data loaded successfully ✓');

setTimeout(refreshAllTokens, 5000);
setInterval(refreshAllTokens, 30 * 60 * 1000);

app.listen(PORT, () => {
  log('INFO', `Tidelog server running on port ${PORT}`);
  const missing = missingEnv('BIRDEYE_KEY', 'HELIUS_KEY', 'QB_CLIENT_ID', 'QB_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
  if (missing.length) log('WARN', `Missing environment variables: ${missing.join(', ')}`);
  else log('INFO', 'All environment variables configured ✓');
  if (!RAILWAY_API_TOKEN) log('WARN', 'RAILWAY_API_TOKEN not set — tokens will not persist across restarts');
  if (ALLOWED_EMAILS.length) log('INFO', `Extra allowed emails: ${ALLOWED_EMAILS.join(', ')}`);
});
