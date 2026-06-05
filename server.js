const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const session = require('express-session');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'kukman-evidenca-tajna-kljuc',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// ── Config (admin password) ──────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'data', 'config.json');

function beriConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const privzeto = { passwordHash: sha256('kukman2024') };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(privzeto, null, 2));
    return privzeto;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function shraniConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// ── Database ─────────────────────────────────────────────────────────────────
const db = new DatabaseSync(path.join(__dirname, 'data', 'prisotnost.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS zaposleni (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ime     TEXT    NOT NULL UNIQUE,
    aktiven INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS evidenca (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    zaposleni_id  INTEGER NOT NULL,
    tip           TEXT    NOT NULL CHECK(tip IN ('PRIHOD', 'ODHOD')),
    cas           DATETIME NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (zaposleni_id) REFERENCES zaposleni(id)
  );
`);

// Migrate: add aktiven column if it doesn't exist yet
try {
  db.exec(`ALTER TABLE zaposleni ADD COLUMN aktiven INTEGER NOT NULL DEFAULT 1`);
} catch (_) {}

const count = db.prepare('SELECT COUNT(*) as n FROM zaposleni').get();
if (count.n === 0) {
  const ins = db.prepare('INSERT INTO zaposleni (ime) VALUES (?)');
  ['Ana Novak', 'Bojan Kranjc', 'Maja Horvat', 'Luka Kovač', 'Sara Zupan'].forEach(ime => ins.run(ime));
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.admin) return next();
  res.redirect('/login');
}

// Block direct file access to admin.html
app.use((req, res, next) => {
  if (req.path === '/admin.html') return res.redirect('/admin');
  next();
});

// Static files (login.html, index.html, JS, CSS…)
app.use(express.static(path.join(__dirname, 'public')));

// ── Public pages ─────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── Auth API ─────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { geslo } = req.body;
  const config = beriConfig();
  if (sha256(geslo || '') === config.passwordHash) {
    req.session.admin = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ napaka: 'Napačno geslo' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// ── Main-page API (public) ────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const rows = db.prepare(`
    SELECT z.id, z.ime,
      (SELECT tip FROM evidenca
       WHERE zaposleni_id = z.id AND date(cas) = date('now','localtime')
       ORDER BY cas DESC LIMIT 1) AS zadnji_tip
    FROM zaposleni z
    WHERE z.aktiven = 1
    ORDER BY z.ime
  `).all();
  res.json(rows);
});

app.get('/api/danes', (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, z.ime, e.tip, e.cas
    FROM evidenca e JOIN zaposleni z ON z.id = e.zaposleni_id
    WHERE date(e.cas) = date('now','localtime')
    ORDER BY e.cas DESC
  `).all();
  res.json(rows);
});

app.post('/api/belezi', (req, res) => {
  const { zaposleni_id, tip } = req.body;
  if (!zaposleni_id || !['PRIHOD', 'ODHOD'].includes(tip))
    return res.status(400).json({ napaka: 'Neveljavni podatki' });

  const r = db.prepare('INSERT INTO evidenca (zaposleni_id, tip) VALUES (?, ?)').run(zaposleni_id, tip);
  const zapis = db.prepare(`
    SELECT e.id, z.ime, e.tip, e.cas
    FROM evidenca e JOIN zaposleni z ON z.id = e.zaposleni_id
    WHERE e.id = ?
  `).get(r.lastInsertRowid);
  res.json(zapis);
});

// ── Admin API ─────────────────────────────────────────────────────────────────

// List all employees
app.get('/api/admin/zaposleni', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM zaposleni ORDER BY ime').all());
});

// Add employee
app.post('/api/admin/zaposleni', requireAuth, (req, res) => {
  const { ime } = req.body;
  if (!ime?.trim()) return res.status(400).json({ napaka: 'Ime je obvezno' });
  try {
    const r = db.prepare('INSERT INTO zaposleni (ime) VALUES (?)').run(ime.trim());
    res.json({ id: r.lastInsertRowid, ime: ime.trim(), aktiven: 1 });
  } catch (_) {
    res.status(409).json({ napaka: 'Zaposleni s tem imenom že obstaja' });
  }
});

// Toggle active/inactive
app.patch('/api/admin/zaposleni/:id', requireAuth, (req, res) => {
  const aktiven = req.body.aktiven ? 1 : 0;
  db.prepare('UPDATE zaposleni SET aktiven = ? WHERE id = ?').run(aktiven, req.params.id);
  res.json({ ok: true });
});

// Records with optional date range
app.get('/api/admin/evidenca', requireAuth, (req, res) => {
  const od  = req.query.od  || '1970-01-01';
  const do_ = req.query.do  || '9999-12-31';
  const rows = db.prepare(`
    SELECT e.id, z.ime, e.tip, e.cas
    FROM evidenca e JOIN zaposleni z ON z.id = e.zaposleni_id
    WHERE date(e.cas) BETWEEN ? AND ?
    ORDER BY e.cas DESC
  `).all(od, do_);
  res.json(rows);
});

// Delete single record
app.delete('/api/admin/evidenca/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM evidenca WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Export to Excel
app.get('/api/admin/izvoz', requireAuth, (req, res) => {
  const od  = req.query.od  || '1970-01-01';
  const do_ = req.query.do  || '9999-12-31';
  const rows = db.prepare(`
    SELECT e.id, z.ime, e.tip, e.cas
    FROM evidenca e JOIN zaposleni z ON z.id = e.zaposleni_id
    WHERE date(e.cas) BETWEEN ? AND ?
    ORDER BY e.cas ASC
  `).all(od, do_);

  const podatki = rows.map(r => {
    const dt = new Date(r.cas);
    return {
      'Datum': dt.toLocaleDateString('sl-SI'),
      'Zaposleni': r.ime,
      'Tip': r.tip === 'PRIHOD' ? 'Prihod' : 'Odhod',
      'Ura': dt.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(podatki);
  ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 10 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Evidenca prisotnosti');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `evidenca_${od}_${do_}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// Change password
app.post('/api/admin/geslo', requireAuth, (req, res) => {
  const { staroGeslo, novoGeslo } = req.body;
  const config = beriConfig();
  if (sha256(staroGeslo || '') !== config.passwordHash)
    return res.status(401).json({ napaka: 'Staro geslo ni pravilno' });
  if (!novoGeslo || novoGeslo.length < 4)
    return res.status(400).json({ napaka: 'Novo geslo mora imeti vsaj 4 znake' });
  config.passwordHash = sha256(novoGeslo);
  shraniConfig(config);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Strežnik teče na http://localhost:${PORT}`);
  console.log(`Admin panel:     http://localhost:${PORT}/admin`);
  console.log(`Privzeto geslo:  kukman2024`);
});
