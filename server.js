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

try { db.exec(`ALTER TABLE zaposleni ADD COLUMN aktiven INTEGER NOT NULL DEFAULT 1`); } catch (_) {}
try { db.exec(`ALTER TABLE zaposleni ADD COLUMN pin TEXT`); } catch (_) {}

const count = db.prepare('SELECT COUNT(*) as n FROM zaposleni').get();
if (count.n === 0) {
  const ins = db.prepare('INSERT INTO zaposleni (ime) VALUES (?)');
  ['Ana Novak', 'Bojan Kranjc', 'Maja Horvat', 'Luka Kovač', 'Sara Zupan'].forEach(ime => ins.run(ime));
}

// ── Hours calculation ─────────────────────────────────────────────────────────
function izracunajDnevneUre(zapisi, zdaj = new Date()) {
  const poDnevih = new Map();
  zapisi.forEach(z => {
    const datum = z.cas.slice(0, 10);
    if (!poDnevih.has(datum)) poDnevih.set(datum, []);
    poDnevih.get(datum).push({ tip: z.tip, cas: new Date(z.cas.replace(' ', 'T')) });
  });

  const danasnji = zdaj.toISOString().slice(0, 10);
  const rezultati = [];

  for (const [datum, vnosi] of poDnevih) {
    vnosi.sort((a, b) => a.cas - b.cas);
    let minute = 0, zadnjiPrihod = null, prvPrihod = null, zadnjiOdhod = null;

    for (const v of vnosi) {
      if (v.tip === 'PRIHOD') {
        if (!prvPrihod) prvPrihod = v.cas;
        zadnjiPrihod = v.cas;
      } else if (v.tip === 'ODHOD' && zadnjiPrihod) {
        minute += (v.cas - zadnjiPrihod) / 60000;
        zadnjiOdhod = v.cas;
        zadnjiPrihod = null;
      }
    }

    const vTeku = zadnjiPrihod !== null;
    if (vTeku && datum === danasnji) minute += (zdaj - zadnjiPrihod) / 60000;

    rezultati.push({
      datum,
      prvPrihod: prvPrihod ? prvPrihod.toISOString() : null,
      zadnjiOdhod: zadnjiOdhod ? zadnjiOdhod.toISOString() : null,
      minute: Math.round(minute),
      vTeku,
      nepopoln: vTeku && datum !== danasnji
    });
  }

  return rezultati.sort((a, b) => a.datum.localeCompare(b.datum));
}

function izracunajMesecneUre(vsiZapisi) {
  const poMesecih = new Map();
  vsiZapisi.forEach(z => {
    const kljuc = z.cas.slice(0, 7);
    if (!poMesecih.has(kljuc)) poMesecih.set(kljuc, []);
    poMesecih.get(kljuc).push(z);
  });

  return [...poMesecih.entries()]
    .map(([mesec, zapisi]) => ({
      mesec,
      minute: izracunajDnevneUre(zapisi).reduce((s, d) => s + d.minute, 0)
    }))
    .sort((a, b) => b.mesec.localeCompare(a.mesec));
}

// ── Auth middlewares ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.admin) return next();
  res.redirect('/login');
}

function requirePinAuth(req, res, next) {
  if (req.session.zaposleniId) return next();
  res.status(401).json({ napaka: 'Ni prijavljen' });
}

// Block direct file access
app.use((req, res, next) => {
  if (req.path === '/admin.html') return res.redirect('/admin');
  if (req.path === '/moj-cas.html') return res.redirect('/pin');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/pin', (req, res) => {
  if (req.session.zaposleniId) return res.redirect('/moj-cas');
  res.sendFile(path.join(__dirname, 'public', 'pin.html'));
});

app.get('/moj-cas', (req, res) => {
  if (!req.session.zaposleniId) return res.redirect('/pin');
  res.sendFile(path.join(__dirname, 'public', 'moj-cas.html'));
});

// ── Auth API ──────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const config = beriConfig();
  if (sha256(req.body.geslo || '') === config.passwordHash) {
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

app.post('/api/pin-login', (req, res) => {
  const { pin } = req.body;
  if (!pin || !/^\d{4}$/.test(pin))
    return res.status(400).json({ napaka: 'PIN mora biti 4-mestna številka' });

  const z = db.prepare('SELECT id, ime FROM zaposleni WHERE pin = ? AND aktiven = 1').get(pin);
  if (!z) return res.status(401).json({ napaka: 'Napačen PIN' });

  req.session.zaposleniId = z.id;
  res.json({ ok: true, ime: z.ime });
});

app.post('/api/pin-logout', (req, res) => {
  delete req.session.zaposleniId;
  res.json({ ok: true });
});

// ── Main-page API (public) ────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json(db.prepare(`
    SELECT z.id, z.ime,
      (SELECT tip FROM evidenca WHERE zaposleni_id = z.id
       AND date(cas) = date('now','localtime') ORDER BY cas DESC LIMIT 1) AS zadnji_tip
    FROM zaposleni z WHERE z.aktiven = 1 ORDER BY z.ime
  `).all());
});

app.get('/api/danes', (req, res) => {
  res.json(db.prepare(`
    SELECT e.id, z.ime, e.tip, e.cas
    FROM evidenca e JOIN zaposleni z ON z.id = e.zaposleni_id
    WHERE date(e.cas) = date('now','localtime') ORDER BY e.cas DESC
  `).all());
});

app.post('/api/belezi', (req, res) => {
  const { zaposleni_id, tip } = req.body;
  if (!zaposleni_id || !['PRIHOD', 'ODHOD'].includes(tip))
    return res.status(400).json({ napaka: 'Neveljavni podatki' });
  const r = db.prepare('INSERT INTO evidenca (zaposleni_id, tip) VALUES (?, ?)').run(zaposleni_id, tip);
  res.json(db.prepare(`
    SELECT e.id, z.ime, e.tip, e.cas
    FROM evidenca e JOIN zaposleni z ON z.id = e.zaposleni_id WHERE e.id = ?
  `).get(r.lastInsertRowid));
});

// ── Moj čas API (PIN auth) ────────────────────────────────────────────────────
app.get('/api/moj-cas/info', requirePinAuth, (req, res) => {
  const z = db.prepare('SELECT id, ime FROM zaposleni WHERE id = ?').get(req.session.zaposleniId);
  if (!z) return res.status(404).json({ napaka: 'Zaposleni ne obstaja' });

  const zadnji = db.prepare(`
    SELECT tip, cas FROM evidenca WHERE zaposleni_id = ?
    AND date(cas) = date('now','localtime') ORDER BY cas DESC LIMIT 1
  `).get(z.id);

  res.json({ id: z.id, ime: z.ime, statusDanes: zadnji?.tip ?? null });
});

app.get('/api/moj-cas/mesec', requirePinAuth, (req, res) => {
  const zdaj = new Date();
  const leto = parseInt(req.query.leto) || zdaj.getFullYear();
  const mesec = parseInt(req.query.mesec) || (zdaj.getMonth() + 1);

  const od = `${leto}-${String(mesec).padStart(2, '0')}-01`;
  const do_ = `${leto}-${String(mesec).padStart(2, '0')}-31`;

  const zapisi = db.prepare(`
    SELECT tip, cas FROM evidenca WHERE zaposleni_id = ?
    AND date(cas) BETWEEN ? AND ? ORDER BY cas ASC
  `).all(req.session.zaposleniId, od, do_);

  res.json({ leto, mesec, dnevi: izracunajDnevneUre(zapisi, zdaj) });
});

app.get('/api/moj-cas/kumulativno', requirePinAuth, (req, res) => {
  const zapisi = db.prepare(`
    SELECT tip, cas FROM evidenca WHERE zaposleni_id = ? ORDER BY cas ASC
  `).all(req.session.zaposleniId);

  res.json(izracunajMesecneUre(zapisi));
});

// ── Admin API ─────────────────────────────────────────────────────────────────
app.get('/api/admin/zaposleni', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM zaposleni ORDER BY ime').all());
});

app.post('/api/admin/zaposleni', requireAuth, (req, res) => {
  const { ime } = req.body;
  if (!ime?.trim()) return res.status(400).json({ napaka: 'Ime je obvezno' });
  try {
    const r = db.prepare('INSERT INTO zaposleni (ime) VALUES (?)').run(ime.trim());
    res.json({ id: r.lastInsertRowid, ime: ime.trim(), aktiven: 1, pin: null });
  } catch (_) {
    res.status(409).json({ napaka: 'Zaposleni s tem imenom že obstaja' });
  }
});

app.patch('/api/admin/zaposleni/:id', requireAuth, (req, res) => {
  const aktiven = req.body.aktiven ? 1 : 0;
  db.prepare('UPDATE zaposleni SET aktiven = ? WHERE id = ?').run(aktiven, req.params.id);
  res.json({ ok: true });
});

app.patch('/api/admin/zaposleni/:id/pin', requireAuth, (req, res) => {
  const { pin } = req.body;
  if (pin !== null && pin !== '' && !/^\d{4}$/.test(pin))
    return res.status(400).json({ napaka: 'PIN mora biti 4-mestna številka' });

  const noviPin = pin || null;
  if (noviPin) {
    const obstoji = db.prepare('SELECT id FROM zaposleni WHERE pin = ? AND id != ?').get(noviPin, req.params.id);
    if (obstoji) return res.status(409).json({ napaka: 'Ta PIN je že zaseden' });
  }
  db.prepare('UPDATE zaposleni SET pin = ? WHERE id = ?').run(noviPin, req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/evidenca', requireAuth, (req, res) => {
  const od = req.query.od || '1970-01-01', do_ = req.query.do || '9999-12-31';
  res.json(db.prepare(`
    SELECT e.id, z.ime, e.tip, e.cas FROM evidenca e
    JOIN zaposleni z ON z.id = e.zaposleni_id
    WHERE date(e.cas) BETWEEN ? AND ? ORDER BY e.cas DESC
  `).all(od, do_));
});

app.delete('/api/admin/evidenca/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM evidenca WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/izvoz', requireAuth, (req, res) => {
  const od = req.query.od || '1970-01-01', do_ = req.query.do || '9999-12-31';
  const rows = db.prepare(`
    SELECT e.id, z.ime, e.tip, e.cas FROM evidenca e
    JOIN zaposleni z ON z.id = e.zaposleni_id
    WHERE date(e.cas) BETWEEN ? AND ? ORDER BY e.cas ASC
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
  res.setHeader('Content-Disposition', `attachment; filename="evidenca_${od}_${do_}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

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
  console.log(`Moj čas:         http://localhost:${PORT}/pin`);
  console.log(`Privzeto geslo:  kukman2024`);
});
