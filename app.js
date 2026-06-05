'use strict';

const express = require('express');
const path = require('path');
const crypto = require('node:crypto');
const cookieSession = require('cookie-session');
const XLSX = require('xlsx');
const { createClient } = require('@libsql/client');

const TZ = 'Europe/Ljubljana';

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function localTime() {
  return new Date().toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 19);
}

function localDate() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

// ── Database ──────────────────────────────────────────────────────────────────
let _db = null;
let _initialized = false;

function getDb() {
  if (!_db) {
    _db = createClient({
      url: process.env.TURSO_DATABASE_URL || 'file:./data/prisotnost.db',
      authToken: process.env.TURSO_AUTH_TOKEN || undefined
    });
  }
  return _db;
}

async function ensureDb() {
  if (_initialized) return getDb();
  const db = getDb();

  await db.batch([
    { sql: `CREATE TABLE IF NOT EXISTS zaposleni (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ime TEXT NOT NULL UNIQUE,
        aktiven INTEGER NOT NULL DEFAULT 1, pin TEXT
      )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS evidenca (
        id INTEGER PRIMARY KEY AUTOINCREMENT, zaposleni_id INTEGER NOT NULL,
        tip TEXT NOT NULL, cas DATETIME NOT NULL
      )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS config (
        kljuc TEXT PRIMARY KEY, vrednost TEXT NOT NULL
      )`, args: [] },
    { sql: `INSERT OR IGNORE INTO config (kljuc, vrednost) VALUES ('admin_hash', ?)`,
      args: [sha256('kukman2024')] }
  ], 'write');

  // Safe migration: add new columns if they don't exist
  try { await db.execute('ALTER TABLE zaposleni ADD COLUMN pin_setup_required INTEGER DEFAULT 0'); } catch(_) {}
  try { await db.execute('ALTER TABLE evidenca ADD COLUMN naknadno INTEGER DEFAULT 0'); } catch(_) {}

  const { rows } = await db.execute('SELECT COUNT(*) as n FROM zaposleni');
  if (Number(rows[0].n) === 0) {
    await db.batch(
      ['Ana Novak', 'Bojan Kranjc', 'Maja Horvat', 'Luka Kovač', 'Sara Zupan'].map(ime => ({
        sql: 'INSERT OR IGNORE INTO zaposleni (ime) VALUES (?)', args: [ime]
      })), 'write'
    );
  }

  _initialized = true;
  return db;
}

// ── Hours calculation ─────────────────────────────────────────────────────────
function izracunajDnevneUre(zapisi, zdaj = new Date()) {
  const poDnevih = new Map();
  zapisi.forEach(z => {
    const datum = String(z.cas).slice(0, 10);
    if (!poDnevih.has(datum)) poDnevih.set(datum, []);
    poDnevih.get(datum).push({ tip: z.tip, cas: new Date(String(z.cas).replace(' ', 'T')) });
  });

  const danasnji = localDate();
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
      datum, minute: Math.round(minute), vTeku,
      prvPrihod: prvPrihod ? prvPrihod.toISOString() : null,
      zadnjiOdhod: zadnjiOdhod ? zadnjiOdhod.toISOString() : null,
      nepopoln: vTeku && datum !== danasnji
    });
  }

  return rezultati.sort((a, b) => a.datum.localeCompare(b.datum));
}

function izracunajMesecneUre(vsiZapisi) {
  const poMesecih = new Map();
  vsiZapisi.forEach(z => {
    const kljuc = String(z.cas).slice(0, 7);
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

// ── App factory ───────────────────────────────────────────────────────────────
function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieSession({
    name: 'kukman-seja',
    keys: [process.env.SESSION_SECRET || 'kukman-evidenca-tajna-kljuc-2024'],
    maxAge: 8 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  }));

  // DB init on every request (cached after first time)
  app.use(async (req, res, next) => {
    try {
      req.db = await ensureDb();
      next();
    } catch (e) {
      console.error('DB error:', e);
      res.status(500).json({ napaka: 'Napaka baze podatkov' });
    }
  });

  function requireAuth(req, res, next) {
    if (req.session.admin) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ napaka: 'Ni prijavljen' });
    res.redirect('/login');
  }

  function requirePinAuth(req, res, next) {
    if (req.session.zaposleniId) return next();
    res.status(401).json({ napaka: 'Ni prijavljen' });
  }

  // Block direct .html access
  app.use((req, res, next) => {
    if (req.path === '/admin.html') return res.redirect('/admin');
    if (req.path === '/moj-cas.html') return res.redirect('/pin');
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));

  // ── Pages ───────────────────────────────────────────────────────────────────
  app.get('/login', (req, res) => {
    if (req.session.admin) return res.redirect('/admin');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  });

  app.get('/admin', requireAuth, (req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'admin.html')));

  app.get('/pin', (req, res) => {
    if (req.session.zaposleniId) return res.redirect('/moj-cas');
    res.sendFile(path.join(__dirname, 'public', 'pin.html'));
  });

  app.get('/moj-cas', (req, res) => {
    if (!req.session.zaposleniId) return res.redirect('/pin');
    res.sendFile(path.join(__dirname, 'public', 'moj-cas.html'));
  });

  // ── Auth API ─────────────────────────────────────────────────────────────────
  app.post('/api/login', async (req, res) => {
    const { rows } = await req.db.execute({ sql: 'SELECT vrednost FROM config WHERE kljuc = ?', args: ['admin_hash'] });
    const hash = rows[0]?.vrednost || sha256('kukman2024');
    if (sha256(req.body.geslo || '') === hash) {
      req.session.admin = true;
      res.json({ ok: true });
    } else {
      res.status(401).json({ napaka: 'Napačno geslo' });
    }
  });

  app.post('/api/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  app.post('/api/pin-login', async (req, res) => {
    const { pin } = req.body;
    if (!pin || !/^\d{4}$/.test(pin))
      return res.status(400).json({ napaka: 'PIN mora biti 4-mestna številka' });
    const { rows } = await req.db.execute({
      sql: 'SELECT id, ime, pin_setup_required FROM zaposleni WHERE pin = ? AND aktiven = 1', args: [pin]
    });
    if (!rows.length) return res.status(401).json({ napaka: 'Napačen PIN' });
    req.session.zaposleniId = Number(rows[0].id);
    res.json({ ok: true, ime: rows[0].ime, pinSetupRequired: !!rows[0].pin_setup_required });
  });

  app.post('/api/pin-logout', (req, res) => {
    delete req.session.zaposleniId;
    res.json({ ok: true });
  });

  app.get('/api/nastavi-pin-info', requirePinAuth, async (req, res) => {
    const { rows } = await req.db.execute({
      sql: 'SELECT ime, pin_setup_required FROM zaposleni WHERE id = ?',
      args: [req.session.zaposleniId]
    });
    if (!rows.length) return res.status(404).json({ napaka: 'Zaposleni ne obstaja' });
    res.json({ ime: rows[0].ime, pinSetupRequired: !!rows[0].pin_setup_required });
  });

  app.post('/api/nastavi-pin', requirePinAuth, async (req, res) => {
    const { novPin } = req.body;
    if (!novPin || !/^\d{4}$/.test(novPin))
      return res.status(400).json({ napaka: 'PIN mora biti 4-mestna številka' });
    const { rows } = await req.db.execute({
      sql: 'SELECT id FROM zaposleni WHERE pin = ? AND id != ?',
      args: [novPin, req.session.zaposleniId]
    });
    if (rows.length) return res.status(409).json({ napaka: 'Ta PIN je že zaseden, izberi drugega' });
    await req.db.execute({
      sql: 'UPDATE zaposleni SET pin = ?, pin_setup_required = 0 WHERE id = ?',
      args: [novPin, req.session.zaposleniId]
    });
    res.json({ ok: true });
  });

  // ── Public API ────────────────────────────────────────────────────────────────
  app.get('/api/status', async (req, res) => {
    const danes = localDate();
    const { rows } = await req.db.execute({
      sql: `SELECT z.id, z.ime,
        (SELECT tip FROM evidenca WHERE zaposleni_id = z.id AND substr(cas,1,10) = ?
         ORDER BY cas DESC LIMIT 1) AS zadnji_tip
        FROM zaposleni z WHERE z.aktiven = 1 ORDER BY z.ime`,
      args: [danes]
    });
    res.json(rows);
  });

  app.get('/api/danes', async (req, res) => {
    const danes = localDate();
    const { rows } = await req.db.execute({
      sql: `SELECT e.id, z.ime, e.tip, e.cas FROM evidenca e
            JOIN zaposleni z ON z.id = e.zaposleni_id
            WHERE substr(e.cas,1,10) = ? ORDER BY e.cas DESC`,
      args: [danes]
    });
    res.json(rows);
  });

  app.post('/api/belezi', async (req, res) => {
    const { zaposleni_id, tip } = req.body;
    if (!zaposleni_id || !['PRIHOD', 'ODHOD'].includes(tip))
      return res.status(400).json({ napaka: 'Neveljavni podatki' });

    const cas = localTime();
    const r = await req.db.execute({
      sql: 'INSERT INTO evidenca (zaposleni_id, tip, cas) VALUES (?, ?, ?)',
      args: [zaposleni_id, tip, cas]
    });
    const { rows } = await req.db.execute({
      sql: `SELECT e.id, z.ime, e.tip, e.cas FROM evidenca e
            JOIN zaposleni z ON z.id = e.zaposleni_id WHERE e.id = ?`,
      args: [Number(r.lastInsertRowid)]
    });
    res.json(rows[0]);
  });

  // ── Moj čas API ───────────────────────────────────────────────────────────────
  app.get('/api/moj-cas/info', requirePinAuth, async (req, res) => {
    const danes = localDate();
    const { rows: zRows } = await req.db.execute({
      sql: 'SELECT id, ime, pin_setup_required FROM zaposleni WHERE id = ?', args: [req.session.zaposleniId]
    });
    if (!zRows.length) return res.status(404).json({ napaka: 'Zaposleni ne obstaja' });
    const { rows: sRows } = await req.db.execute({
      sql: `SELECT tip FROM evidenca WHERE zaposleni_id = ? AND substr(cas,1,10) = ?
            ORDER BY cas DESC LIMIT 1`,
      args: [req.session.zaposleniId, danes]
    });
    res.json({ id: Number(zRows[0].id), ime: zRows[0].ime, statusDanes: sRows[0]?.tip ?? null, pinSetupRequired: !!zRows[0].pin_setup_required });
  });

  app.get('/api/moj-cas/mesec', requirePinAuth, async (req, res) => {
    const zdaj = new Date();
    const leto = parseInt(req.query.leto) || zdaj.getFullYear();
    const mesec = parseInt(req.query.mesec) || (zdaj.getMonth() + 1);
    const od = `${leto}-${String(mesec).padStart(2, '0')}-01`;
    const do_ = `${leto}-${String(mesec).padStart(2, '0')}-31`;
    const { rows } = await req.db.execute({
      sql: `SELECT tip, cas FROM evidenca WHERE zaposleni_id = ?
            AND substr(cas,1,10) BETWEEN ? AND ? ORDER BY cas ASC`,
      args: [req.session.zaposleniId, od, do_]
    });
    res.json({ leto, mesec, dnevi: izracunajDnevneUre(rows, zdaj) });
  });

  app.get('/api/moj-cas/kumulativno', requirePinAuth, async (req, res) => {
    const { rows } = await req.db.execute({
      sql: 'SELECT tip, cas FROM evidenca WHERE zaposleni_id = ? ORDER BY cas ASC',
      args: [req.session.zaposleniId]
    });
    res.json(izracunajMesecneUre(rows));
  });

  app.post('/api/moj-cas/naknadno', requirePinAuth, async (req, res) => {
    const { tip, cas } = req.body;
    if (!['PRIHOD', 'ODHOD'].includes(tip))
      return res.status(400).json({ napaka: 'Neveljaven tip' });
    if (!cas || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(cas))
      return res.status(400).json({ napaka: 'Neveljaven format časa' });
    const casDate = new Date(cas.replace(' ', 'T'));
    if (isNaN(casDate.getTime()) || casDate >= new Date())
      return res.status(400).json({ napaka: 'Čas mora biti v preteklosti' });
    await req.db.execute({
      sql: 'INSERT INTO evidenca (zaposleni_id, tip, cas, naknadno) VALUES (?, ?, ?, 1)',
      args: [req.session.zaposleniId, tip, cas + ':00']
    });
    res.json({ ok: true });
  });

  // ── Admin API ──────────────────────────────────────────────────────────────────
  app.get('/api/admin/zaposleni', requireAuth, async (req, res) => {
    const { rows } = await req.db.execute('SELECT * FROM zaposleni ORDER BY ime');
    res.json(rows);
  });

  app.post('/api/admin/zaposleni', requireAuth, async (req, res) => {
    const { ime } = req.body;
    if (!ime?.trim()) return res.status(400).json({ napaka: 'Ime je obvezno' });
    try {
      const r = await req.db.execute({ sql: 'INSERT INTO zaposleni (ime) VALUES (?)', args: [ime.trim()] });
      res.json({ id: Number(r.lastInsertRowid), ime: ime.trim(), aktiven: 1, pin: null });
    } catch (_) {
      res.status(409).json({ napaka: 'Zaposleni s tem imenom že obstaja' });
    }
  });

  app.patch('/api/admin/zaposleni/:id', requireAuth, async (req, res) => {
    await req.db.execute({
      sql: 'UPDATE zaposleni SET aktiven = ? WHERE id = ?',
      args: [req.body.aktiven ? 1 : 0, req.params.id]
    });
    res.json({ ok: true });
  });

  app.post('/api/admin/zaposleni/:id/ponastavi-pin', requireAuth, async (req, res) => {
    let tempPin = String(Math.floor(1000 + Math.random() * 9000));
    const { rows } = await req.db.execute({
      sql: 'SELECT id FROM zaposleni WHERE pin = ? AND id != ?',
      args: [tempPin, req.params.id]
    });
    if (rows.length) tempPin = String(Math.floor(1000 + Math.random() * 9000));
    await req.db.execute({
      sql: 'UPDATE zaposleni SET pin = ?, pin_setup_required = 1 WHERE id = ?',
      args: [tempPin, req.params.id]
    });
    res.json({ ok: true, tempPin });
  });

  app.patch('/api/admin/zaposleni/:id/pin', requireAuth, async (req, res) => {
    const { pin } = req.body;
    if (pin && !/^\d{4}$/.test(pin))
      return res.status(400).json({ napaka: 'PIN mora biti 4-mestna številka' });
    const noviPin = pin || null;
    if (noviPin) {
      const { rows } = await req.db.execute({
        sql: 'SELECT id FROM zaposleni WHERE pin = ? AND id != ?', args: [noviPin, req.params.id]
      });
      if (rows.length) return res.status(409).json({ napaka: 'Ta PIN je že zaseden' });
    }
    await req.db.execute({ sql: 'UPDATE zaposleni SET pin = ? WHERE id = ?', args: [noviPin, req.params.id] });
    res.json({ ok: true });
  });

  app.get('/api/admin/evidenca', requireAuth, async (req, res) => {
    const od = req.query.od || '1970-01-01', do_ = req.query.do || '9999-12-31';
    const { rows } = await req.db.execute({
      sql: `SELECT e.id, z.ime, e.tip, e.cas, e.naknadno FROM evidenca e
            JOIN zaposleni z ON z.id = e.zaposleni_id
            WHERE substr(e.cas,1,10) BETWEEN ? AND ? ORDER BY e.cas DESC`,
      args: [od, do_]
    });
    res.json(rows);
  });

  app.delete('/api/admin/evidenca/:id', requireAuth, async (req, res) => {
    await req.db.execute({ sql: 'DELETE FROM evidenca WHERE id = ?', args: [req.params.id] });
    res.json({ ok: true });
  });

  app.get('/api/admin/izvoz', requireAuth, async (req, res) => {
    const od = req.query.od || '1970-01-01', do_ = req.query.do || '9999-12-31';
    const { rows } = await req.db.execute({
      sql: `SELECT e.id, z.ime, e.tip, e.cas FROM evidenca e
            JOIN zaposleni z ON z.id = e.zaposleni_id
            WHERE substr(e.cas,1,10) BETWEEN ? AND ? ORDER BY e.cas ASC`,
      args: [od, do_]
    });
    const podatki = rows.map(r => {
      const parts = String(r.cas).split(' ');
      return {
        'Datum': parts[0].split('-').reverse().join('.'),
        'Zaposleni': r.ime,
        'Tip': r.tip === 'PRIHOD' ? 'Prihod' : 'Odhod',
        'Ura': parts[1]?.slice(0, 5) || ''
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

  app.post('/api/admin/geslo', requireAuth, async (req, res) => {
    const { staroGeslo, novoGeslo } = req.body;
    const { rows } = await req.db.execute({ sql: 'SELECT vrednost FROM config WHERE kljuc = ?', args: ['admin_hash'] });
    const hash = rows[0]?.vrednost || sha256('kukman2024');
    if (sha256(staroGeslo || '') !== hash)
      return res.status(401).json({ napaka: 'Staro geslo ni pravilno' });
    if (!novoGeslo || novoGeslo.length < 4)
      return res.status(400).json({ napaka: 'Novo geslo mora imeti vsaj 4 znake' });
    await req.db.execute({ sql: 'UPDATE config SET vrednost = ? WHERE kljuc = ?', args: [sha256(novoGeslo), 'admin_hash'] });
    res.json({ ok: true });
  });

  return app;
}

module.exports = { createApp };
