// Bỏ qua SSL check cho request HTTPS không hợp lệ
const https = require('https');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fetch = require('node-fetch');
const sanitizeHtml = require('sanitize-html');
const DB = require('./db');

const app = express();
const START_PORT = Number(process.env.PORT || 4000);

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static('public'));

// middleware kiểm tra role
function requireRole(role) {
  return (req, res, next) => {
    const u = req.session.user;
    if (!u || u.role !== role) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    next();
  };
}

// ===================== AUTH =====================
app.post('/api/auth/login', async (req, res) => {
  const { role, username, password } = req.body || {};
  if (!role || !username || !password) return res.status(400).json({ ok: false, error: 'Missing fields' });

  if (role === 'admin') {
    const admin = DB.getAdmin();
    if (admin.username !== username.trim()) return res.status(401).json({ ok: false, error: 'Invalid admin' });
    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'Wrong password' });
    req.session.user = { role: 'admin', username };
    return res.json({ ok: true });
  }

  if (role === 'user') {
    const u = DB.getUser(username.trim());
    if (!u) return res.status(401).json({ ok: false, error: 'User not found' });
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'Wrong password' });
    if (!u.active) return res.status(403).json({ ok: false, error: 'User not active' });
    req.session.user = { role: 'user', username: u.username };
    return res.json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: 'Invalid role' });
});

app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/auth/me', (req, res) => res.json({ ok: true, user: req.session.user || null }));

// ===================== SETTINGS =====================
app.get('/api/admin/settings', requireRole('admin'), (req, res) => res.json({ ok: true, settings: DB.getSettings() }));
app.patch('/api/admin/settings', requireRole('admin'), (req, res) => {
  const patch = {};
  if (typeof req.body.source_url === 'string') patch.source_url = req.body.source_url;
  if (typeof req.body.signincode_password === 'string') patch.signincode_password = req.body.signincode_password;
  if (typeof req.body.fetch_mode === 'string') patch.fetch_mode = req.body.fetch_mode;
  const updated = DB.updateSettings(patch);
  res.json({ ok: true, settings: updated });
});

// ===================== USERS =====================
app.get('/api/admin/users', requireRole('admin'), (req, res) => res.json({ ok: true, users: DB.listUsers().map(u => ({ username: u.username, active: u.active })) }));
app.post('/api/admin/users', requireRole('admin'), async (req, res) => {
  const { username, password, active } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Missing fields' });
  const password_hash = await bcrypt.hash(password, 10);
  DB.upsertUser({ username: username.trim(), password_hash, active: !!active });
  res.json({ ok: true });
});
app.patch('/api/admin/users/:username', requireRole('admin'), async (req, res) => {
  const { username } = req.params;
  const exist = DB.getUser(username);
  if (!exist) return res.status(404).json({ ok: false, error: 'User not found' });
  const patch = { username };
  if (typeof req.body.active === 'boolean') patch.active = req.body.active;
  if (typeof req.body.password === 'string' && req.body.password) patch.password_hash = await bcrypt.hash(req.body.password, 10);
  DB.upsertUser({ ...exist, ...patch });
  res.json({ ok: true });
});
app.delete('/api/admin/users/:username', requireRole('admin'), (req, res) => { DB.deleteUser(req.params.username); res.json({ ok: true }); });

// ===================== EMAILS =====================
app.get('/api/admin/emails', requireRole('admin'), (req, res) => res.json({ ok: true, emails: DB.listEmails() }));
app.post('/api/admin/emails', requireRole('admin'), (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: 'Missing email' });
  const list = DB.addEmail(email);
  res.json({ ok: true, emails: list });
});
app.delete('/api/admin/emails/:email', requireRole('admin'), (req, res) => {
  const em = decodeURIComponent(req.params.email || '');
  const list = DB.removeEmail(em);
  res.json({ ok: true, emails: list });
});

// ===================== SHARED =====================
app.get('/api/emails', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  res.json({ ok: true, emails: DB.listEmails() });
});

// ===================== SHOW CODE =====================
async function fetchFullHtml(email) {
  const { source_url, signincode_password } = DB.getSettings();
  const form = new URLSearchParams();
  form.append('password', signincode_password);
  form.append('recipient_email', email);

  const r = await fetch(source_url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'origin': source_url,
      'referer': source_url,
      'user-agent': 'Mozilla/5.0'
    },
    body: form,
    // Bypass SSL reject
    agent: new https.Agent({ rejectUnauthorized: false })
  });

  const raw = await r.text();
  return raw;
}

app.post('/api/show-code', async (req, res) => {
  const sess = req.session.user;
  if (!sess || sess.role !== 'user') return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ ok: false, error: 'Missing email' });
  if (!DB.listEmails().includes(email)) return res.status(403).json({ ok: false, error: 'Email chưa được kích hoạt' });

  try {
    const raw = await fetchFullHtml(email);
    if (/Enter Password to Access/i.test(raw)) {
      return res.status(401).json({ ok: false, error: 'Sai mật khẩu Signincode (Admin > Cài đặt)' });
    }

    const clean = sanitizeHtml(raw, {
      allowedTags: false,
      disallowedTagsMode: 'discard',
      allowedAttributes: false,
      nonTextTags: ['style'],
      transformTags: {
        'script': () => ({ tagName: 'noscript' }),
        'iframe': () => ({ tagName: 'div' }),
        'object': () => ({ tagName: 'div' }),
        'embed': () => ({ tagName: 'div' })
      }
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(clean);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ===================== ROUTES =====================
app.get('/', (req, res) => res.redirect('/login-user.html'));
app.get('/admin', (req, res) => res.redirect('/login-admin.html'));
app.get('/user', (req, res) => res.redirect('/login-user.html'));

// ===================== AUTO PORT =====================
function startOnPort(port, attemptsLeft = 12) {
  const server = app
    .listen(port, () => {
      const actual = server.address().port;
      console.log('Server on http://localhost:' + actual);
      console.log('Admin: admin/admin123 | User: demo/demo123');
    })
    .on('error', (err) => {
      if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        const next = port + 1;
        console.warn(`Port ${port} busy, trying ${next}...`);
        startOnPort(next, attemptsLeft - 1);
      } else {
        console.error('Failed to bind:', err);
        process.exit(1);
      }
    });
}
startOnPort(START_PORT);
