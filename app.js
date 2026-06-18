'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');
const cookieSession = require('cookie-session');
const XLSX = require('xlsx');
const QRCode = require('qrcode');
const { createClient } = require('@libsql/client');

const TZ = 'Europe/Ljubljana';

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// Token se menja vsakih 15 minut; sprejmemo trenutni in prejšnji slot (grace period)
function generateQrToken(slotOffset = 0) {
  const secret = process.env.SESSION_SECRET || 'kukman-evidenca-tajna-kljuc-2024';
  const slot = Math.floor(Date.now() / (15 * 60 * 1000)) + slotOffset;
  return crypto.createHash('sha256').update(`qr-${slot}-${secret}`).digest('hex').slice(0, 20);
}

function validQrTokens() {
  return [generateQrToken(0), generateQrToken(-1)];
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
    { sql: `CREATE TABLE IF NOT EXISTS stimulacija (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zaposleni_id INTEGER NOT NULL,
        mesec TEXT NOT NULL,
        znesek REAL NOT NULL DEFAULT 0,
        opomba TEXT
      )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS akontacija (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zaposleni_id INTEGER NOT NULL,
        mesec TEXT NOT NULL,
        datum TEXT NOT NULL,
        znesek REAL NOT NULL DEFAULT 0,
        opomba TEXT
      )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS zahtevki (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zaposleni_id INTEGER NOT NULL,
        tip TEXT NOT NULL,
        cas_zahtevka TEXT NOT NULL,
        opomba TEXT,
        status TEXT NOT NULL DEFAULT 'CAKA',
        ustvarjen TEXT NOT NULL
      )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS dela (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        naziv TEXT NOT NULL UNIQUE,
        urna_postavka REAL NOT NULL DEFAULT 0
      )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS evidenca_razporeditev (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zaposleni_id INTEGER NOT NULL,
        datum TEXT NOT NULL,
        delo_id INTEGER NOT NULL,
        cas_od TEXT NOT NULL,
        cas_do TEXT NOT NULL
      )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS zaposleni_dela (
        zaposleni_id INTEGER NOT NULL,
        delo_id INTEGER NOT NULL,
        PRIMARY KEY (zaposleni_id, delo_id)
      )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS kilometrina (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zaposleni_id INTEGER NOT NULL,
        datum TEXT NOT NULL,
        km REAL NOT NULL DEFAULT 0,
        strosek REAL NOT NULL DEFAULT 0,
        UNIQUE(zaposleni_id, datum)
      )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS device_tokens (
        token TEXT PRIMARY KEY,
        label TEXT NOT NULL DEFAULT 'Tablica',
        created_at TEXT NOT NULL
      )`, args: [] },
    { sql: `INSERT OR IGNORE INTO config (kljuc, vrednost) VALUES ('admin_hash', ?)`,
      args: [sha256('kukman2024')] }
  ], 'write');

  // Safe migration: add new columns if they don't exist
  try { await db.execute('ALTER TABLE zaposleni ADD COLUMN pin_setup_required INTEGER DEFAULT 0'); } catch(_) {}
  try { await db.execute('ALTER TABLE evidenca ADD COLUMN naknadno INTEGER DEFAULT 0'); } catch(_) {}
  try { await db.execute('ALTER TABLE zaposleni ADD COLUMN urna_postavka REAL DEFAULT 0'); } catch(_) {}
  try { await db.execute('ALTER TABLE zaposleni ADD COLUMN privzeto_delo_id INTEGER'); } catch(_) {}
  try { await db.execute('ALTER TABLE evidenca ADD COLUMN delo_id INTEGER'); } catch(_) {}
  try { await db.execute('ALTER TABLE kilometrina ADD COLUMN strosek REAL NOT NULL DEFAULT 0'); } catch(_) {}
  try { await db.execute('ALTER TABLE kilometrina ADD COLUMN komentar TEXT'); } catch(_) {}
  try { await db.execute('ALTER TABLE evidenca_razporeditev ADD COLUMN trajanje_minut INTEGER'); } catch(_) {}
  // Zaposleni z defaultnim PIN 1234 morajo nastaviti lasten PIN
  try { await db.execute("UPDATE zaposleni SET pin_setup_required = 1 WHERE pin = '1234' AND (pin_setup_required = 0 OR pin_setup_required IS NULL)"); } catch(_) {}

  // Seed work types (INSERT OR IGNORE — safe to run multiple times)
  await db.batch([
    { sql: "INSERT OR IGNORE INTO dela (naziv, urna_postavka) VALUES ('Pomivalec', 9)", args: [] },
    { sql: "INSERT OR IGNORE INTO dela (naziv, urna_postavka) VALUES ('Priprava', 10)", args: [] },
    { sql: "INSERT OR IGNORE INTO dela (naziv, urna_postavka) VALUES ('Organizator', 11)", args: [] },
    { sql: "INSERT OR IGNORE INTO dela (naziv, urna_postavka) VALUES ('Teren', 11)", args: [] },
    { sql: "INSERT OR IGNORE INTO dela (naziv, urna_postavka) VALUES ('Koordinator', 12)", args: [] },
    { sql: "INSERT OR IGNORE INTO dela (naziv, urna_postavka) VALUES ('Praktikant', 4)", args: [] },
    { sql: "INSERT OR IGNORE INTO dela (naziv, urna_postavka) VALUES ('Pripravnik', 2)", args: [] },
  ], 'write');

  // Odstrani napačno dodane tipe dela (Strežba in Kuhinja = Teren)
  try {
    await db.execute("DELETE FROM zaposleni_dela WHERE delo_id IN (SELECT id FROM dela WHERE naziv IN ('Strežba','Kuhinja'))");
    await db.execute("DELETE FROM dela WHERE naziv IN ('Strežba','Kuhinja')");
  } catch(_) {}

  _initialized = true;
  return db;
}

// ── Hours calculation ─────────────────────────────────────────────────────────
function izracunajDnevneUre(zapisi, zdaj = new Date()) {
  const danasnji = localDate();

  // Sortiraj vse zapise kronološko in jih pari: vsak ODHOD gre k zadnjemu PRIHODU
  // Izmena se pripiše datumu PRIHODA (ne ODHODA) — pravilno za izmene čez polnoč
  const sorted = [...zapisi]
    .map(z => ({ tip: z.tip, naknadno: z.naknadno, cas: new Date(String(z.cas).replace(' ', 'T')), casStr: String(z.cas).replace(' ', 'T'), datum: String(z.cas).slice(0, 10) }))
    .sort((a, b) => a.cas - b.cas);

  const poDnevih = new Map();
  let odprtPrihod = null;

  for (const v of sorted) {
    if (v.tip === 'PRIHOD') {
      odprtPrihod = v;
      if (!poDnevih.has(v.datum)) poDnevih.set(v.datum, { minute: 0, prvPrihod: v.cas, prvPrihodStr: v.casStr, zadnjiOdhod: null, zadnjiOdhodStr: null, vTeku: true, odprtPrihod: v });
      else {
        const d = poDnevih.get(v.datum);
        if (!d.prvPrihod || v.cas < d.prvPrihod) { d.prvPrihod = v.cas; d.prvPrihodStr = v.casStr; }
        d.vTeku = true;
        d.odprtPrihod = v;
      }
    } else if (v.tip === 'ODHOD' && odprtPrihod) {
      const datum = odprtPrihod.datum; // pripiši datumu PRIHODA
      if (!poDnevih.has(datum)) poDnevih.set(datum, { minute: 0, prvPrihod: odprtPrihod.cas, prvPrihodStr: odprtPrihod.casStr, zadnjiOdhod: null, zadnjiOdhodStr: null, vTeku: false, odprtPrihod: null });
      const d = poDnevih.get(datum);
      d.minute += (v.cas - odprtPrihod.cas) / 60000;
      d.zadnjiOdhod = v.cas;
      d.zadnjiOdhodStr = v.casStr;
      d.vTeku = false;
      d.odprtPrihod = null;
      odprtPrihod = null;
    }
  }

  // Odprta izmena (brez odhoda): dodaj minute do zdaj če je danes
  if (odprtPrihod) {
    const d = poDnevih.get(odprtPrihod.datum);
    if (d) {
      if (odprtPrihod.datum === danasnji) d.minute += (zdaj - odprtPrihod.cas) / 60000;
      d.vTeku = true;
    }
  }

  return [...poDnevih.entries()].map(([datum, d]) => ({
    datum,
    minute: Math.round(d.minute),
    vTeku: d.vTeku,
    prvPrihod: d.prvPrihodStr || null,
    zadnjiOdhod: d.zadnjiOdhodStr || null,
    nepopoln: d.vTeku && datum !== danasnji
  })).sort((a, b) => a.datum.localeCompare(b.datum));
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

function casOdDoMinute(casOd, casDo) {
  const [oh, om] = String(casOd).split(':').map(Number);
  const [dh, dm] = String(casDo).split(':').map(Number);
  return Math.max(0, (dh * 60 + dm) - (oh * 60 + om));
}

function razMin(r) {
  return r.trajanje_minut != null ? Number(r.trajanje_minut) : casOdDoMinute(r.cas_od, r.cas_do);
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

  const BASE = '/prisotnost';

  function requireAuth(req, res, next) {
    if (req.session.admin) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ napaka: 'Ni prijavljen' });
    res.redirect(BASE + '/login');
  }

  function requirePinAuth(req, res, next) {
    if (req.session.zaposleniId) return next();
    res.status(401).json({ napaka: 'Ni prijavljen' });
  }

  async function requireDeviceToken(req, res, next) {
    const token = req.headers['x-device-token'];
    if (!token) return res.status(403).json({ napaka: 'Ta naprava ni registrirana kot tablica. Prosite admina.' });
    const { rows } = await req.db.execute({ sql: 'SELECT token FROM device_tokens WHERE token = ?', args: [token] });
    if (!rows.length) return res.status(403).json({ napaka: 'Ta naprava ni registrirana kot tablica. Prosite admina.' });
    next();
  }

  // Block direct .html access
  app.use((req, res, next) => {
    if (req.path === '/admin.html') return res.redirect(BASE + '/admin');
    if (req.path === '/moj-cas.html') return res.redirect(BASE + '/pin');
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));

  // ── Root redirect ────────────────────────────────────────────────────────────
  app.get('/', (req, res) => res.redirect(BASE));

  // ── Pages ───────────────────────────────────────────────────────────────────
  const P = path.join(__dirname, 'public', 'prisotnost');

  app.get(BASE, (req, res) =>
    res.sendFile(path.join(P, 'index.html')));

  app.get(BASE + '/login', (req, res) => {
    if (req.session.admin) return res.redirect(BASE + '/admin');
    res.sendFile(path.join(P, 'login.html'));
  });

  app.get(BASE + '/admin', requireAuth, (req, res) =>
    res.sendFile(path.join(P, 'admin.html')));

  app.get(BASE + '/pin', (req, res) => res.redirect('/moj-cas'));

  app.get(BASE + '/moj-cas', (req, res) => res.redirect('/moj-cas/app'));

  app.get(BASE + '/pin-setup', (req, res) => res.redirect('/moj-cas/pin-setup'));

  // ── Moj čas — dedicated employee route ──────────────────────────────────────
  app.get('/moj-cas', (req, res) => {
    if (req.session.zaposleniId) return res.redirect('/moj-cas/app');
    res.sendFile(path.join(P, 'pin.html'));
  });

  app.get('/moj-cas/app', (req, res) => {
    if (!req.session.zaposleniId) return res.redirect('/moj-cas');
    res.sendFile(path.join(P, 'moj-cas.html'));
  });

  app.get('/moj-cas/pin-setup', (req, res) =>
    res.sendFile(path.join(P, 'pin-setup.html')));

  app.get(BASE + '/qr', (req, res) =>
    res.sendFile(path.join(P, 'qr.html')));

  // ── Device check ────────────────────────────────────────────────────────────
  app.get('/api/device-check', requireDeviceToken, (req, res) => res.json({ ok: true }));

  // ── QR API ───────────────────────────────────────────────────────────────────
  app.get('/api/qr-info', async (req, res) => {
    const token = generateQrToken();
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const qrUrl = `${proto}://${host}${BASE}/qr?t=${token}`;
    // Sekunde do naslednje rotacije (za avtomatsko osvežitev na tablici)
    const msDoRotacije = (15 * 60 * 1000) - (Date.now() % (15 * 60 * 1000));
    try {
      const qrSvg = await QRCode.toString(qrUrl, { type: 'svg', width: 200, margin: 2 });
      res.json({ token, datum: localDate(), qrSvg, msDoRotacije });
    } catch (e) {
      res.json({ token, datum: localDate(), msDoRotacije });
    }
  });

  app.get('/api/qr-image', async (req, res) => {
    const token = generateDailyToken();
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const qrUrl = `${proto}://${host}${BASE}/qr?t=${token}`;
    const buf = await QRCode.toBuffer(qrUrl, {
      width: 280, margin: 2,
      color: { dark: '#1a365d', light: '#ffffff' }
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  });

  app.post('/api/qr-belezi', async (req, res) => {
    const { zaposleniId, token, pin } = req.body;
    if (!token || !validQrTokens().includes(token))
      return res.status(401).json({ napaka: 'QR koda ni veljavna ali je potekla' });
    const { rows } = await req.db.execute({
      sql: 'SELECT id, ime, pin_setup_required FROM zaposleni WHERE id = ? AND aktiven = 1',
      args: [zaposleniId]
    });
    if (!rows.length) return res.status(404).json({ napaka: 'Zaposleni ni najden' });
    if (!pin) return res.status(401).json({ napaka: 'Vnesite PIN' });
    const { rows: pinRows } = await req.db.execute({
      sql: 'SELECT id FROM zaposleni WHERE id = ? AND pin = ? AND aktiven = 1',
      args: [zaposleniId, pin]
    });
    if (!pinRows.length) return res.status(401).json({ napaka: 'Napačen PIN' });
    if (rows[0].pin_setup_required || pin === '1234') return res.json({ pinSetupRequired: true });
    const danes = localDate();
    const { rows: zadnji } = await req.db.execute({
      sql: 'SELECT tip, cas FROM evidenca WHERE zaposleni_id = ? AND substr(cas,1,10) = ? ORDER BY cas DESC LIMIT 1',
      args: [zaposleniId, danes]
    });
    const tip = zadnji[0]?.tip === 'PRIHOD' ? 'ODHOD' : 'PRIHOD';
    if (tip === 'ODHOD' && zadnji[0]?.cas) {
      const minutesSince = (new Date(localTime().replace(' ','T')) - new Date(zadnji[0].cas.replace(' ','T'))) / 60000;
      if (minutesSince < 10) {
        const preostalo = Math.ceil(10 - minutesSince);
        return res.status(400).json({ napaka: `Prezgodaj za odhod. Počakajte še ${preostalo} min.` });
      }
    }
    const cas = localTime();
    await req.db.execute({
      sql: 'INSERT INTO evidenca (zaposleni_id, tip, cas) VALUES (?, ?, ?)',
      args: [zaposleniId, tip, cas]
    });

    if (tip === 'ODHOD') {
      const [{ rows: zd }, { rows: ostala }] = await Promise.all([
        req.db.execute({
          sql: 'SELECT z.privzeto_delo_id, d.naziv, d.urna_postavka FROM zaposleni z LEFT JOIN dela d ON d.id = z.privzeto_delo_id WHERE z.id = ?',
          args: [zaposleniId]
        }),
        req.db.execute({
          sql: `SELECT d.id, d.naziv, d.urna_postavka FROM zaposleni_dela zd JOIN dela d ON d.id = zd.delo_id WHERE zd.zaposleni_id = ? AND zd.delo_id != COALESCE((SELECT privzeto_delo_id FROM zaposleni WHERE id = ?), 0) ORDER BY d.urna_postavka, d.naziv`,
          args: [zaposleniId, zaposleniId]
        })
      ]);
      const privzetoDelo = zd[0]?.privzeto_delo_id
        ? { id: Number(zd[0].privzeto_delo_id), naziv: zd[0].naziv, urna_postavka: zd[0].urna_postavka }
        : null;
      return res.json({ ok: true, ime: rows[0].ime, tip, cas, datum: danes, privzetoDelo, ostala_dela: ostala });
    }

    res.json({ ok: true, ime: rows[0].ime, tip, cas, datum: danes });
  });

  app.post('/api/qr-nastavi-pin', async (req, res) => {
    const { zaposleniId, token, stariPin, noviPin } = req.body;
    if (!token || !validQrTokens().includes(token))
      return res.status(401).json({ napaka: 'QR koda ni veljavna ali je potekla' });
    if (!noviPin || !/^\d{4}$/.test(noviPin))
      return res.status(400).json({ napaka: 'PIN mora biti 4-mestna številka' });
    if (noviPin === '1234')
      return res.status(400).json({ napaka: 'Izberite drugačen PIN kot privzeti' });
    const { rows } = await req.db.execute({
      sql: 'SELECT id, ime FROM zaposleni WHERE id = ? AND pin = ? AND aktiven = 1',
      args: [zaposleniId, stariPin]
    });
    if (!rows.length) return res.status(401).json({ napaka: 'Napačen PIN' });
    await req.db.execute({
      sql: 'UPDATE zaposleni SET pin = ?, pin_setup_required = 0 WHERE id = ?',
      args: [noviPin, zaposleniId]
    });
    const danes = localDate();
    const { rows: zadnji } = await req.db.execute({
      sql: 'SELECT tip, cas FROM evidenca WHERE zaposleni_id = ? AND substr(cas,1,10) = ? ORDER BY cas DESC LIMIT 1',
      args: [zaposleniId, danes]
    });
    const tip = zadnji[0]?.tip === 'PRIHOD' ? 'ODHOD' : 'PRIHOD';
    if (tip === 'ODHOD' && zadnji[0]?.cas) {
      const minutesSince = (new Date(localTime().replace(' ','T')) - new Date(zadnji[0].cas.replace(' ','T'))) / 60000;
      if (minutesSince < 10) {
        const preostalo = Math.ceil(10 - minutesSince);
        return res.status(400).json({ napaka: `Prezgodaj za odhod. Počakajte še ${preostalo} min.` });
      }
    }
    const cas = localTime();
    await req.db.execute({
      sql: 'INSERT INTO evidenca (zaposleni_id, tip, cas) VALUES (?, ?, ?)',
      args: [zaposleniId, tip, cas]
    });
    if (tip === 'ODHOD') {
      const [{ rows: zd }, { rows: ostala }] = await Promise.all([
        req.db.execute({
          sql: 'SELECT z.privzeto_delo_id, d.naziv, d.urna_postavka FROM zaposleni z LEFT JOIN dela d ON d.id = z.privzeto_delo_id WHERE z.id = ?',
          args: [zaposleniId]
        }),
        req.db.execute({
          sql: `SELECT d.id, d.naziv, d.urna_postavka FROM zaposleni_dela zd JOIN dela d ON d.id = zd.delo_id WHERE zd.zaposleni_id = ? AND zd.delo_id != COALESCE((SELECT privzeto_delo_id FROM zaposleni WHERE id = ?), 0) ORDER BY d.urna_postavka, d.naziv`,
          args: [zaposleniId, zaposleniId]
        })
      ]);
      const privzetoDelo = zd[0]?.privzeto_delo_id
        ? { id: Number(zd[0].privzeto_delo_id), naziv: zd[0].naziv, urna_postavka: zd[0].urna_postavka }
        : null;
      return res.json({ ok: true, ime: rows[0].ime, tip, cas, datum: danes, privzetoDelo, ostala_dela: ostala });
    }
    res.json({ ok: true, ime: rows[0].ime, tip, cas, datum: danes });
  });

  app.post('/api/qr-razporeditev', async (req, res) => {
    const { zaposleniId, token, datum, deloId, casOd, casDo, trajanje, celDan } = req.body;
    if (!token || !validQrTokens().includes(token))
      return res.status(401).json({ napaka: 'QR koda ni veljavna ali je potekla' });
    const { rows } = await req.db.execute({
      sql: 'SELECT id FROM zaposleni WHERE id = ? AND aktiven = 1', args: [zaposleniId]
    });
    if (!rows.length) return res.status(404).json({ napaka: 'Zaposleni ni najden' });
    if (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return res.status(400).json({ napaka: 'Neveljaven datum' });
    if (!deloId) return res.status(400).json({ napaka: 'Izberi vrsto dela' });

    let trajanjeMinut = null, casOdStore = '00:00', casDoStore = '00:00';
    if (celDan) {
      const { rows: ev } = await req.db.execute({
        sql: `SELECT tip, cas FROM evidenca WHERE zaposleni_id = ? AND (substr(cas,1,10) = ? OR substr(cas,1,10) = date(?, '+1 day')) ORDER BY cas ASC`,
        args: [zaposleniId, datum, datum]
      });
      const shiftMin = Math.round(izracunajDnevneUre(ev).find(d => d.datum === datum)?.minute || 0);
      if (!shiftMin) return res.status(400).json({ napaka: 'Ni evidentirane prisotnosti za ta dan' });
      const { rows: razObs } = await req.db.execute({
        sql: 'SELECT COALESCE(SUM(trajanje_minut),0) AS s FROM evidenca_razporeditev WHERE zaposleni_id = ? AND datum = ?',
        args: [zaposleniId, datum]
      });
      trajanjeMinut = Math.max(0, shiftMin - Number(razObs[0]?.s || 0));
      if (!trajanjeMinut) return res.status(400).json({ napaka: 'Vse minute tega dne so že razporejene' });
    } else if (trajanje != null) {
      trajanjeMinut = Math.round(parseFloat(trajanje) * 60);
      if (!trajanjeMinut || trajanjeMinut <= 0) return res.status(400).json({ napaka: 'Vnesite veljavno trajanje' });
    } else if (casOd && casDo) {
      if (!/^\d{2}:\d{2}$/.test(casOd) || !/^\d{2}:\d{2}$/.test(casDo))
        return res.status(400).json({ napaka: 'Neveljaven čas' });
      if (casOd >= casDo) return res.status(400).json({ napaka: 'Čas "od" mora biti pred "do"' });
      casOdStore = casOd; casDoStore = casDo;
    } else {
      return res.status(400).json({ napaka: 'Vnesite trajanje' });
    }

    const r = await req.db.execute({
      sql: 'INSERT INTO evidenca_razporeditev (zaposleni_id, datum, delo_id, cas_od, cas_do, trajanje_minut) VALUES (?, ?, ?, ?, ?, ?)',
      args: [zaposleniId, datum, deloId, casOdStore, casDoStore, trajanjeMinut]
    });
    res.json({ ok: true, id: Number(r.lastInsertRowid), trajanjeMinut });
  });

  app.post('/api/qr-kilometrina', async (req, res) => {
    const { zaposleniId, token, datum, km, strosek } = req.body;
    if (!token || !validQrTokens().includes(token))
      return res.status(401).json({ napaka: 'QR koda ni veljavna ali je potekla' });
    if (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum))
      return res.status(400).json({ napaka: 'Neveljaven datum' });
    const kmNum = parseFloat(km) || 0;
    const strosekNum = parseFloat(strosek) || 0;
    if (kmNum <= 0 && strosekNum <= 0)
      return res.status(400).json({ napaka: 'Vnesite km ali znesek stroškov' });
    await req.db.execute({
      sql: 'INSERT OR REPLACE INTO kilometrina (zaposleni_id, datum, km, strosek) VALUES (?, ?, ?, ?)',
      args: [zaposleniId, datum, kmNum, strosekNum]
    });
    res.json({ ok: true });
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
    const { zaposleniId, pin } = req.body;
    if (!pin || !/^\d{4}$/.test(pin))
      return res.status(400).json({ napaka: 'PIN mora biti 4-mestna številka' });
    if (!zaposleniId)
      return res.status(400).json({ napaka: 'Izberite ime' });
    const { rows } = await req.db.execute({
      sql: 'SELECT id, ime, pin_setup_required FROM zaposleni WHERE id = ? AND pin = ? AND aktiven = 1',
      args: [zaposleniId, pin]
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
    await req.db.execute({
      sql: 'UPDATE zaposleni SET pin = ?, pin_setup_required = 0 WHERE id = ?',
      args: [novPin, req.session.zaposleniId]
    });
    res.json({ ok: true });
  });

  // ── Public API ────────────────────────────────────────────────────────────────
  app.get('/api/zaposleni-seznam', async (req, res) => {
    const { rows } = await req.db.execute({
      sql: 'SELECT id, ime FROM zaposleni WHERE aktiven = 1 ORDER BY ime'
    });
    res.json(rows);
  });

  app.get('/api/status', async (req, res) => {
    const danes = localDate();
    const mesecOd = danes.slice(0, 7) + '-01';
    const zdaj = new Date();

    const [{ rows }, { rows: evMesec }] = await Promise.all([
      req.db.execute({
        sql: `SELECT z.id, z.ime,
          (SELECT tip FROM evidenca WHERE zaposleni_id = z.id AND substr(cas,1,10) = ?
           ORDER BY cas DESC LIMIT 1) AS zadnji_tip,
          (SELECT cas FROM evidenca WHERE zaposleni_id = z.id AND substr(cas,1,10) = ? AND tip = 'PRIHOD'
           ORDER BY cas DESC LIMIT 1) AS zadnji_prihod
          FROM zaposleni z WHERE z.aktiven = 1 ORDER BY z.ime`,
        args: [danes, danes]
      }),
      req.db.execute({
        sql: `SELECT zaposleni_id, tip, cas FROM evidenca WHERE substr(cas,1,10) >= ? ORDER BY cas ASC`,
        args: [mesecOd]
      })
    ]);

    const minutePoId = new Map();
    rows.forEach(z => {
      const zid = Number(z.id);
      const zEv = evMesec.filter(e => Number(e.zaposleni_id) === zid);
      minutePoId.set(zid, izracunajDnevneUre(zEv, zdaj).reduce((s, d) => s + d.minute, 0));
    });

    const sorted = [...rows].sort((a, b) =>
      (minutePoId.get(Number(b.id)) || 0) - (minutePoId.get(Number(a.id)) || 0)
    );
    res.json(sorted);
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

  app.post('/api/belezi', requireDeviceToken, async (req, res) => {
    const { zaposleni_id, tip, pin } = req.body;
    if (!zaposleni_id || !['PRIHOD', 'ODHOD'].includes(tip))
      return res.status(400).json({ napaka: 'Neveljavni podatki' });
    if (!pin) return res.status(400).json({ napaka: 'PIN je zahtevan' });

    const { rows: zr } = await req.db.execute({
      sql: 'SELECT pin, pin_setup_required FROM zaposleni WHERE id = ? AND aktiven = 1',
      args: [zaposleni_id]
    });
    if (!zr.length) return res.status(404).json({ napaka: 'Zaposleni ni najden' });
    if (zr[0].pin !== pin) return res.status(401).json({ napaka: 'Napačen PIN' });
    if (zr[0].pin_setup_required || pin === '1234')
      return res.status(422).json({ pinSetupRequired: true, napaka: 'Najprej spremenite PIN — obiščite /prisotnost/pin-setup ali skenirajte QR kodo' });

    if (tip === 'ODHOD') {
      const danes = localDate();
      const { rows: zadnji } = await req.db.execute({
        sql: 'SELECT tip, cas FROM evidenca WHERE zaposleni_id = ? AND substr(cas,1,10) = ? ORDER BY cas DESC LIMIT 1',
        args: [zaposleni_id, danes]
      });
      if (zadnji[0]?.tip === 'ODHOD')
        return res.status(400).json({ napaka: 'Odhod je že zabeležen.' });
      if (zadnji[0]?.tip === 'PRIHOD' && zadnji[0]?.cas) {
        const minutesSince = (new Date(localTime().replace(' ', 'T')) - new Date(zadnji[0].cas.replace(' ', 'T'))) / 60000;
        if (minutesSince < 10) {
          const preostalo = Math.ceil(10 - minutesSince);
          return res.status(400).json({ napaka: `Prezgodaj za odhod. Počakajte še ${preostalo} min.` });
        }
      }
    }

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
    const zapis = rows[0];

    if (tip === 'ODHOD') {
      const [{ rows: zd }, { rows: ostala }] = await Promise.all([
        req.db.execute({
          sql: `SELECT z.privzeto_delo_id, d.naziv, d.urna_postavka FROM zaposleni z LEFT JOIN dela d ON d.id = z.privzeto_delo_id WHERE z.id = ?`,
          args: [zaposleni_id]
        }),
        req.db.execute({
          sql: `SELECT d.id, d.naziv, d.urna_postavka FROM zaposleni_dela zd JOIN dela d ON d.id = zd.delo_id WHERE zd.zaposleni_id = ? AND zd.delo_id != COALESCE((SELECT privzeto_delo_id FROM zaposleni WHERE id = ?), 0) ORDER BY d.urna_postavka, d.naziv`,
          args: [zaposleni_id, zaposleni_id]
        })
      ]);
      const privzetoDelo = zd[0]?.privzeto_delo_id
        ? { id: Number(zd[0].privzeto_delo_id), naziv: zd[0].naziv, urna_postavka: zd[0].urna_postavka }
        : null;
      return res.json({ ...zapis, privzetoDelo, ostala_dela: ostala });
    }

    res.json(zapis);
  });

  app.post('/api/tablet-nastavi-pin', requireDeviceToken, async (req, res) => {
    const { zaposleni_id, stari_pin, novi_pin, tip } = req.body;
    if (!zaposleni_id || !['PRIHOD', 'ODHOD'].includes(tip))
      return res.status(400).json({ napaka: 'Neveljavni podatki' });
    if (!novi_pin || !/^\d{4}$/.test(novi_pin))
      return res.status(400).json({ napaka: 'PIN mora biti 4-mestna številka' });
    if (novi_pin === '1234')
      return res.status(400).json({ napaka: 'Izberite drugačen PIN kot privzeti' });

    const { rows: zr } = await req.db.execute({
      sql: 'SELECT pin FROM zaposleni WHERE id = ? AND aktiven = 1',
      args: [zaposleni_id]
    });
    if (!zr.length) return res.status(404).json({ napaka: 'Zaposleni ni najden' });
    if (zr[0].pin !== stari_pin) return res.status(401).json({ napaka: 'Napačen PIN' });

    await req.db.execute({
      sql: 'UPDATE zaposleni SET pin = ?, pin_setup_required = 0 WHERE id = ?',
      args: [novi_pin, zaposleni_id]
    });

    if (tip === 'ODHOD') {
      const danes = localDate();
      const { rows: zadnji } = await req.db.execute({
        sql: 'SELECT tip, cas FROM evidenca WHERE zaposleni_id = ? AND substr(cas,1,10) = ? ORDER BY cas DESC LIMIT 1',
        args: [zaposleni_id, danes]
      });
      if (zadnji[0]?.tip === 'ODHOD')
        return res.status(400).json({ napaka: 'Odhod je že zabeležen.' });
      if (zadnji[0]?.tip === 'PRIHOD' && zadnji[0]?.cas) {
        const minutesSince = (new Date(localTime().replace(' ', 'T')) - new Date(zadnji[0].cas.replace(' ', 'T'))) / 60000;
        if (minutesSince < 10) {
          const preostalo = Math.ceil(10 - minutesSince);
          return res.status(400).json({ napaka: `Prezgodaj za odhod. Počakajte še ${preostalo} min.` });
        }
      }
    }

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
    const zapis = rows[0];

    if (tip === 'ODHOD') {
      const [{ rows: zd }, { rows: ostala }] = await Promise.all([
        req.db.execute({
          sql: `SELECT z.privzeto_delo_id, d.naziv, d.urna_postavka FROM zaposleni z LEFT JOIN dela d ON d.id = z.privzeto_delo_id WHERE z.id = ?`,
          args: [zaposleni_id]
        }),
        req.db.execute({
          sql: `SELECT d.id, d.naziv, d.urna_postavka FROM zaposleni_dela zd JOIN dela d ON d.id = zd.delo_id WHERE zd.zaposleni_id = ? AND zd.delo_id != COALESCE((SELECT privzeto_delo_id FROM zaposleni WHERE id = ?), 0) ORDER BY d.urna_postavka, d.naziv`,
          args: [zaposleni_id, zaposleni_id]
        })
      ]);
      const privzetoDelo = zd[0]?.privzeto_delo_id
        ? { id: Number(zd[0].privzeto_delo_id), naziv: zd[0].naziv, urna_postavka: zd[0].urna_postavka }
        : null;
      return res.json({ ...zapis, privzetoDelo, ostala_dela: ostala });
    }

    res.json(zapis);
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
    const mesecStr = `${leto}-${String(mesec).padStart(2, '0')}`;
    const od = `${mesecStr}-01`, do_ = `${mesecStr}-31`;

    const [{ rows }, { rows: zRows }, { rows: stimRows }, { rows: razRows }, { rows: kmRows }, { rows: aktRows }] = await Promise.all([
      req.db.execute({ sql: `SELECT tip, cas FROM evidenca WHERE zaposleni_id = ? AND substr(cas,1,10) BETWEEN ? AND ? ORDER BY cas ASC`, args: [req.session.zaposleniId, od, do_] }),
      req.db.execute({ sql: `SELECT z.urna_postavka, z.privzeto_delo_id, d.urna_postavka AS priv_up FROM zaposleni z LEFT JOIN dela d ON d.id = z.privzeto_delo_id WHERE z.id = ?`, args: [req.session.zaposleniId] }),
      req.db.execute({ sql: 'SELECT SUM(znesek) as skupaj FROM stimulacija WHERE zaposleni_id = ? AND mesec = ?', args: [req.session.zaposleniId, mesecStr] }),
      req.db.execute({ sql: `SELECT r.datum, r.cas_od, r.cas_do, r.trajanje_minut, d.naziv, d.urna_postavka AS delo_up FROM evidenca_razporeditev r JOIN dela d ON d.id = r.delo_id WHERE r.zaposleni_id = ? AND r.datum BETWEEN ? AND ?`, args: [req.session.zaposleniId, od, do_] }),
      req.db.execute({ sql: 'SELECT datum, km, strosek, komentar FROM kilometrina WHERE zaposleni_id = ? AND datum BETWEEN ? AND ?', args: [req.session.zaposleniId, od, do_] }),
      req.db.execute({ sql: 'SELECT SUM(znesek) as skupaj FROM akontacija WHERE zaposleni_id = ? AND mesec = ?', args: [req.session.zaposleniId, mesecStr] })
    ]);

    const privzetaUp = parseFloat(zRows[0]?.priv_up) || parseFloat(zRows[0]?.urna_postavka) || 0;
    const stimulacija = parseFloat(stimRows[0]?.skupaj) || 0;
    const akontacija = parseFloat(aktRows[0]?.skupaj) || 0;
    const dnevi = izracunajDnevneUre(rows, zdaj);
    const skupajMinut = dnevi.reduce((s, d) => s + d.minute, 0);

    let dodatnaMinute = 0, dodatnaOsnova = 0;
    const razPoDateh = new Map();
    for (const r of razRows) {
      const min = razMin(r);
      dodatnaMinute += min;
      const up = parseFloat(r.delo_up) || 0;
      if (up > 0) dodatnaOsnova += Math.round(min / 60 * up * 100) / 100;
      if (r.datum) {
        if (!razPoDateh.has(r.datum)) razPoDateh.set(r.datum, []);
        razPoDateh.get(r.datum).push({ naziv: r.naziv, minute: min });
      }
    }
    const privzetaMinuta = Math.max(0, skupajMinut - dodatnaMinute);
    const privzetaOsnova = privzetaUp > 0 ? Math.round(privzetaMinuta / 60 * privzetaUp * 100) / 100 : 0;
    const hasRate = privzetaUp > 0 || razRows.length > 0;
    const osnova = hasRate ? Math.round((privzetaOsnova + dodatnaOsnova) * 100) / 100 : null;

    const kmPoDateh = new Map(kmRows.map(r => [String(r.datum), { gorivo: Number(r.km || 0), nakup: Number(r.strosek || 0), komentar: r.komentar || null }]));
    const dneviZKm = dnevi.map(d => ({
      ...d,
      ...(kmPoDateh.get(d.datum) || { gorivo: 0, nakup: 0 }),
      razporeditev: razPoDateh.get(d.datum) || []
    }));
    const skupajGorivo = Math.round(kmRows.reduce((s, r) => s + (Number(r.km) || 0), 0) * 100) / 100;
    const skupajNakup = Math.round(kmRows.reduce((s, r) => s + (Number(r.strosek) || 0), 0) * 100) / 100;
    const skupajStroški = Math.round((skupajGorivo + skupajNakup) * 100) / 100;

    res.json({
      leto, mesec, dnevi: dneviZKm,
      urnaPostavka: privzetaUp || null,
      imaDodatnaDela: razRows.length > 0,
      osnova,
      stimulacija: stimulacija || null,
      gorivo: skupajGorivo || null,
      nakup: skupajNakup || null,
      skupajPlacilo: (osnova !== null || stimulacija > 0 || skupajStroški > 0)
        ? Math.round(((osnova || 0) + stimulacija + skupajStroški) * 100) / 100
        : null,
      akontacija: akontacija || null
    });
  });

  app.get('/api/moj-cas/kumulativno', requirePinAuth, async (req, res) => {
    const [{ rows }, { rows: zRows }, { rows: stimRows }, { rows: razRows }] = await Promise.all([
      req.db.execute({ sql: 'SELECT tip, cas FROM evidenca WHERE zaposleni_id = ? ORDER BY cas ASC', args: [req.session.zaposleniId] }),
      req.db.execute({ sql: `SELECT z.urna_postavka, d.urna_postavka AS priv_up FROM zaposleni z LEFT JOIN dela d ON d.id = z.privzeto_delo_id WHERE z.id = ?`, args: [req.session.zaposleniId] }),
      req.db.execute({ sql: 'SELECT mesec, SUM(znesek) as skupaj FROM stimulacija WHERE zaposleni_id = ? GROUP BY mesec', args: [req.session.zaposleniId] }),
      req.db.execute({ sql: `SELECT r.datum, r.cas_od, r.cas_do, r.trajanje_minut, d.urna_postavka AS delo_up FROM evidenca_razporeditev r JOIN dela d ON d.id = r.delo_id WHERE r.zaposleni_id = ? ORDER BY r.datum ASC`, args: [req.session.zaposleniId] })
    ]);
    const privzetaUp = parseFloat(zRows[0]?.priv_up) || parseFloat(zRows[0]?.urna_postavka) || 0;
    const stimPoMesecih = new Map(stimRows.map(r => [r.mesec, parseFloat(r.skupaj) || 0]));

    // Group razporeditev by month
    const razPoMesecih = new Map();
    for (const r of razRows) {
      const mesec = String(r.datum).slice(0, 7);
      if (!razPoMesecih.has(mesec)) razPoMesecih.set(mesec, []);
      razPoMesecih.get(mesec).push(r);
    }

    const meseci = izracunajMesecneUre(rows).map(m => {
      const stim = stimPoMesecih.get(m.mesec) || 0;
      const mRaz = razPoMesecih.get(m.mesec) || [];
      let dodatnaMinute = 0, dodatnaOsnova = 0;
      for (const r of mRaz) {
        const min = razMin(r);
        dodatnaMinute += min;
        const up = parseFloat(r.delo_up) || 0;
        if (up > 0) dodatnaOsnova += Math.round(min / 60 * up * 100) / 100;
      }
      const privzetaMinuta = Math.max(0, m.minute - dodatnaMinute);
      const privzetaOsnova = privzetaUp > 0 ? Math.round(privzetaMinuta / 60 * privzetaUp * 100) / 100 : 0;
      const hasRate = privzetaUp > 0 || mRaz.length > 0;
      const osnova = hasRate ? Math.round((privzetaOsnova + dodatnaOsnova) * 100) / 100 : null;
      return { ...m, urnaPostavka: privzetaUp || null, osnova, stimulacija: stim || null,
        skupajPlacilo: (osnova !== null || stim > 0) ? Math.round(((osnova || 0) + stim) * 100) / 100 : null };
    });
    res.json(meseci);
  });

  app.post('/api/moj-cas/zahtevek', requirePinAuth, async (req, res) => {
    const { tip, cas, opomba } = req.body;
    if (!['PRIHOD', 'ODHOD'].includes(tip))
      return res.status(400).json({ napaka: 'Neveljaven tip' });
    if (!cas || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(cas))
      return res.status(400).json({ napaka: 'Neveljaven format časa' });
    const casDate = new Date(cas.replace(' ', 'T'));
    if (isNaN(casDate.getTime()) || casDate >= new Date())
      return res.status(400).json({ napaka: 'Čas mora biti v preteklosti' });
    await req.db.execute({
      sql: `INSERT INTO zahtevki (zaposleni_id, tip, cas_zahtevka, opomba, status, ustvarjen) VALUES (?, ?, ?, ?, 'CAKA', ?)`,
      args: [req.session.zaposleniId, tip, cas + ':00', opomba || null, localTime()]
    });
    res.json({ ok: true });
  });

  app.get('/api/moj-cas/zahtevki', requirePinAuth, async (req, res) => {
    const { rows } = await req.db.execute({
      sql: `SELECT id, tip, cas_zahtevka, opomba, status, ustvarjen FROM zahtevki WHERE zaposleni_id = ? ORDER BY ustvarjen DESC LIMIT 20`,
      args: [req.session.zaposleniId]
    });
    res.json(rows);
  });

  app.get('/api/moj-cas/dela', requirePinAuth, async (req, res) => {
    try {
      const { rows } = await req.db.execute({
        sql: `SELECT d.id, d.naziv, COALESCE(zd.urna_postavka, d.urna_postavka) AS urna_postavka
              FROM dela d
              JOIN zaposleni_dela zd ON zd.delo_id = d.id
              WHERE zd.zaposleni_id = ?
              ORDER BY d.naziv`,
        args: [req.session.zaposleniId]
      });
      res.json(rows);
    } catch (_) { res.json([]); }
  });

  app.post('/api/moj-cas/kilometrina', requirePinAuth, async (req, res) => {
    const { datum, gorivo, nakup, komentar, prihod, odhod } = req.body;
    if (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum))
      return res.status(400).json({ napaka: 'Neveljaven datum' });
    const zapId = req.session.zaposleniId;
    try {
      await req.db.execute({
        sql: 'INSERT OR REPLACE INTO kilometrina (zaposleni_id, datum, km, strosek, komentar) VALUES (?, ?, ?, ?, ?)',
        args: [zapId, datum, gorivo || 0, nakup || 0, komentar || null]
      });
      if (prihod && /^\d{2}:\d{2}$/.test(prihod)) {
        await req.db.execute({
          sql: `UPDATE evidenca SET cas = ? WHERE id = (
                  SELECT id FROM evidenca WHERE zaposleni_id = ? AND tip = 'PRIHOD' AND substr(cas,1,10) = ?
                  ORDER BY cas ASC LIMIT 1)`,
          args: [`${datum} ${prihod}:00`, zapId, datum]
        });
      }
      if (odhod && /^\d{2}:\d{2}$/.test(odhod)) {
        await req.db.execute({
          sql: `UPDATE evidenca SET cas = ? WHERE id = (
                  SELECT id FROM evidenca WHERE zaposleni_id = ? AND tip = 'ODHOD' AND substr(cas,1,10) = ?
                  ORDER BY cas DESC LIMIT 1)`,
          args: [`${datum} ${odhod}:00`, zapId, datum]
        });
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('moj-cas/kilometrina:', e);
      res.status(500).json({ napaka: 'Napaka pri shranjevanju' });
    }
  });

  app.get('/api/moj-cas/razporeditev', requirePinAuth, async (req, res) => {
    const { datum } = req.query;
    if (!datum) return res.json([]);
    try {
      const { rows } = await req.db.execute({
        sql: `SELECT r.id, d.naziv, r.cas_od, r.cas_do, r.trajanje_minut
              FROM evidenca_razporeditev r JOIN dela d ON d.id = r.delo_id
              WHERE r.zaposleni_id = ? AND r.datum = ? ORDER BY r.cas_od`,
        args: [req.session.zaposleniId, datum]
      });
      res.json(rows);
    } catch (_) { res.json([]); }
  });

  app.post('/api/moj-cas/razporeditev', requirePinAuth, async (req, res) => {
    const { datum, deloId, casOd, casDo, trajanje, celDan } = req.body;
    if (!datum || !deloId) return res.status(400).json({ napaka: 'Manjkajoči podatki' });

    let trajanjeMinut = null, casOdStore = '00:00', casDoStore = '00:00';
    if (celDan) {
      const { rows: ev } = await req.db.execute({
        sql: `SELECT tip, cas FROM evidenca WHERE zaposleni_id = ? AND (substr(cas,1,10) = ? OR substr(cas,1,10) = date(?, '+1 day')) ORDER BY cas ASC`,
        args: [req.session.zaposleniId, datum, datum]
      });
      const shiftMin = Math.round(izracunajDnevneUre(ev).find(d => d.datum === datum)?.minute || 0);
      if (!shiftMin) return res.status(400).json({ napaka: 'Ni evidentirane prisotnosti za ta dan' });
      const { rows: razObs } = await req.db.execute({
        sql: 'SELECT COALESCE(SUM(trajanje_minut),0) AS s FROM evidenca_razporeditev WHERE zaposleni_id = ? AND datum = ?',
        args: [req.session.zaposleniId, datum]
      });
      trajanjeMinut = Math.max(0, shiftMin - Number(razObs[0]?.s || 0));
      if (!trajanjeMinut) return res.status(400).json({ napaka: 'Vse minute tega dne so že razporejene' });
    } else if (trajanje != null) {
      trajanjeMinut = Math.round(parseFloat(trajanje) * 60);
      if (!trajanjeMinut || trajanjeMinut <= 0) return res.status(400).json({ napaka: 'Neveljavno trajanje' });
    } else if (casOd && casDo) {
      casOdStore = casOd; casDoStore = casDo;
    } else {
      return res.status(400).json({ napaka: 'Manjkajoči podatki' });
    }

    try {
      const r = await req.db.execute({
        sql: 'INSERT INTO evidenca_razporeditev (zaposleni_id, datum, delo_id, cas_od, cas_do, trajanje_minut) VALUES (?, ?, ?, ?, ?, ?)',
        args: [req.session.zaposleniId, datum, deloId, casOdStore, casDoStore, trajanjeMinut]
      });
      res.json({ ok: true, id: Number(r.lastInsertRowid), trajanjeMinut });
    } catch (e) { res.status(500).json({ napaka: 'Napaka pri shranjevanju' }); }
  });

  app.delete('/api/moj-cas/razporeditev/:id', requirePinAuth, async (req, res) => {
    try {
      await req.db.execute({
        sql: 'DELETE FROM evidenca_razporeditev WHERE id = ? AND zaposleni_id = ?',
        args: [req.params.id, req.session.zaposleniId]
      });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ napaka: 'Napaka' }); }
  });

  // ── Admin API ──────────────────────────────────────────────────────────────────
  app.get('/api/admin/zaposleni', requireAuth, async (req, res) => {
    const { rows } = await req.db.execute(
      `SELECT z.*, d.naziv AS privzeto_delo_naziv, d.urna_postavka AS privzeto_delo_up,
        (SELECT GROUP_CONCAT(delo_id) FROM zaposleni_dela WHERE zaposleni_id = z.id) AS dela_ids
       FROM zaposleni z LEFT JOIN dela d ON d.id = z.privzeto_delo_id ORDER BY z.ime`
    );
    res.json(rows.map(r => ({ ...r, dela_ids: r.dela_ids ? String(r.dela_ids).split(',').map(Number) : [] })));
  });

  app.put('/api/admin/zaposleni/:id/dela', requireAuth, async (req, res) => {
    const { delaIds } = req.body;
    if (!Array.isArray(delaIds)) return res.status(400).json({ napaka: 'Neveljaven vnos' });
    const id = Number(req.params.id);
    await req.db.execute({ sql: 'DELETE FROM zaposleni_dela WHERE zaposleni_id = ?', args: [id] });
    for (const deloId of delaIds) {
      await req.db.execute({
        sql: 'INSERT OR IGNORE INTO zaposleni_dela (zaposleni_id, delo_id) VALUES (?, ?)',
        args: [id, Number(deloId)]
      });
    }
    res.json({ ok: true });
  });

  app.patch('/api/admin/zaposleni/:id/privzeto-delo', requireAuth, async (req, res) => {
    const deloId = req.body.deloId ? Number(req.body.deloId) : null;
    await req.db.execute({
      sql: 'UPDATE zaposleni SET privzeto_delo_id = ? WHERE id = ?',
      args: [deloId, req.params.id]
    });
    res.json({ ok: true });
  });

  app.post('/api/admin/zaposleni', requireAuth, async (req, res) => {
    const { ime } = req.body;
    if (!ime?.trim()) return res.status(400).json({ napaka: 'Ime je obvezno' });
    try {
      const r = await req.db.execute({
        sql: 'INSERT INTO zaposleni (ime, pin, pin_setup_required) VALUES (?, ?, 1)',
        args: [ime.trim(), '1234']
      });
      res.json({ id: Number(r.lastInsertRowid), ime: ime.trim(), aktiven: 1, pin: '1234', pin_setup_required: 1 });
    } catch (_) {
      res.status(409).json({ napaka: 'Zaposleni s tem imenom že obstaja' });
    }
  });

  app.post('/api/admin/zaposleni/bulk', requireAuth, async (req, res) => {
    const { zaposleni } = req.body;
    if (!Array.isArray(zaposleni) || !zaposleni.length)
      return res.status(400).json({ napaka: 'Prazna lista' });
    let dodani = 0, napake = [];
    for (const z of zaposleni) {
      if (!z.ime?.trim()) continue;
      try {
        const r = await req.db.execute({
          sql: 'INSERT OR IGNORE INTO zaposleni (ime, pin, pin_setup_required) VALUES (?, ?, 1)',
          args: [z.ime.trim(), '1234']
        });
        if (Number(r.rowsAffected) > 0 && z.privzetoDelo) {
          const { rows: delaRows } = await req.db.execute({
            sql: 'SELECT id FROM dela WHERE naziv = ?', args: [z.privzetoDelo]
          });
          if (delaRows.length) {
            const zapId = Number(r.lastInsertRowid);
            await req.db.execute({
              sql: 'UPDATE zaposleni SET privzeto_delo_id = ? WHERE id = ?',
              args: [delaRows[0].id, zapId]
            });
          }
          dodani++;
        } else if (Number(r.rowsAffected) > 0) {
          dodani++;
        }
      } catch(e) { napake.push(z.ime); }
    }
    res.json({ ok: true, dodani, napake });
  });

  app.patch('/api/admin/zaposleni/:id/ime', requireAuth, async (req, res) => {
    const { ime } = req.body;
    if (!ime?.trim()) return res.status(400).json({ napaka: 'Ime je obvezno' });
    try {
      await req.db.execute({
        sql: 'UPDATE zaposleni SET ime = ? WHERE id = ?',
        args: [ime.trim(), req.params.id]
      });
      res.json({ ok: true });
    } catch(_) {
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
    const tempPin = String(Math.floor(1000 + Math.random() * 9000));
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
    await req.db.execute({
      sql: 'UPDATE zaposleni SET pin = ?, pin_setup_required = ? WHERE id = ?',
      args: [pin || null, pin === '1234' ? 1 : 0, req.params.id]
    });
    res.json({ ok: true });
  });

  // ── Dela API ──────────────────────────────────────────────────────────────────
  app.get('/api/dela', async (req, res) => {
    const { rows } = await req.db.execute('SELECT id, naziv, urna_postavka FROM dela ORDER BY urna_postavka, naziv');
    res.json(rows);
  });

  app.get('/api/admin/dela', requireAuth, async (req, res) => {
    const { rows } = await req.db.execute('SELECT id, naziv, urna_postavka FROM dela ORDER BY urna_postavka, naziv');
    res.json(rows);
  });

  app.post('/api/admin/dela', requireAuth, async (req, res) => {
    const { naziv, urnaPostavka } = req.body;
    if (!naziv?.trim()) return res.status(400).json({ napaka: 'Naziv je obvezen' });
    const up = parseFloat(urnaPostavka);
    if (isNaN(up) || up <= 0) return res.status(400).json({ napaka: 'Urna postavka mora biti pozitivno število' });
    try {
      const r = await req.db.execute({
        sql: 'INSERT INTO dela (naziv, urna_postavka) VALUES (?, ?)',
        args: [naziv.trim(), up]
      });
      res.json({ id: Number(r.lastInsertRowid), naziv: naziv.trim(), urna_postavka: up });
    } catch(_) {
      res.status(409).json({ napaka: 'Vrsta dela s tem imenom že obstaja' });
    }
  });

  app.patch('/api/admin/dela/:id', requireAuth, async (req, res) => {
    const { naziv, urnaPostavka } = req.body;
    const up = parseFloat(urnaPostavka);
    if (naziv !== undefined && !naziv.trim()) return res.status(400).json({ napaka: 'Naziv je obvezen' });
    if (!isNaN(up) && up <= 0) return res.status(400).json({ napaka: 'Urna postavka mora biti pozitivno število' });
    try {
      await req.db.execute({
        sql: 'UPDATE dela SET naziv = COALESCE(?, naziv), urna_postavka = COALESCE(?, urna_postavka) WHERE id = ?',
        args: [naziv?.trim() || null, isNaN(up) ? null : up, req.params.id]
      });
      res.json({ ok: true });
    } catch(_) {
      res.status(409).json({ napaka: 'Vrsta dela s tem imenom že obstaja' });
    }
  });

  app.delete('/api/admin/dela/:id', requireAuth, async (req, res) => {
    const { rows } = await req.db.execute({
      sql: 'SELECT COUNT(*) as n FROM zaposleni WHERE privzeto_delo_id = ?', args: [req.params.id]
    });
    if (Number(rows[0].n) > 0)
      return res.status(400).json({ napaka: 'Vrsta dela je privzeta za vsaj enega zaposlenega' });
    await req.db.execute({ sql: 'DELETE FROM dela WHERE id = ?', args: [req.params.id] });
    res.json({ ok: true });
  });

  // ── Device tokens ─────────────────────────────────────────────────────────────
  app.post('/api/admin/registriraj-tablico', requireAuth, async (req, res) => {
    const token = crypto.randomBytes(32).toString('hex');
    const label = String(req.body.label || 'Tablica').slice(0, 60);
    await req.db.execute({ sql: 'INSERT INTO device_tokens(token, label, created_at) VALUES(?, ?, ?)', args: [token, label, localTime()] });
    res.json({ token });
  });

  app.get('/api/admin/device-tokens', requireAuth, async (req, res) => {
    const { rows } = await req.db.execute('SELECT token, label, created_at FROM device_tokens ORDER BY created_at DESC');
    res.json(rows);
  });

  app.delete('/api/admin/device-tokens/:token', requireAuth, async (req, res) => {
    await req.db.execute({ sql: 'DELETE FROM device_tokens WHERE token = ?', args: [req.params.token] });
    res.json({ ok: true });
  });

  // ── Razporeditev API ──────────────────────────────────────────────────────────
  app.post('/api/razporeditev', async (req, res) => {
    const { zaposleniId, pin, datum, deloId, casOd, casDo, trajanje, celDan } = req.body;
    if (!zaposleniId || !pin) return res.status(401).json({ napaka: 'Ni pooblastil' });
    const { rows: zr } = await req.db.execute({
      sql: 'SELECT id FROM zaposleni WHERE id = ? AND pin = ? AND aktiven = 1',
      args: [zaposleniId, pin]
    });
    if (!zr.length) return res.status(401).json({ napaka: 'Napačen PIN' });
    if (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return res.status(400).json({ napaka: 'Neveljaven datum' });
    if (!deloId) return res.status(400).json({ napaka: 'Izberi vrsto dela' });

    let trajanjeMinut = null, casOdStore = '00:00', casDoStore = '00:00';
    if (celDan) {
      const { rows: ev } = await req.db.execute({
        sql: `SELECT tip, cas FROM evidenca WHERE zaposleni_id = ? AND (substr(cas,1,10) = ? OR substr(cas,1,10) = date(?, '+1 day')) ORDER BY cas ASC`,
        args: [zaposleniId, datum, datum]
      });
      const shiftMin = Math.round(izracunajDnevneUre(ev).find(d => d.datum === datum)?.minute || 0);
      if (!shiftMin) return res.status(400).json({ napaka: 'Ni evidentirane prisotnosti za ta dan' });
      const { rows: razObs } = await req.db.execute({
        sql: 'SELECT COALESCE(SUM(trajanje_minut),0) AS s FROM evidenca_razporeditev WHERE zaposleni_id = ? AND datum = ?',
        args: [zaposleniId, datum]
      });
      trajanjeMinut = Math.max(0, shiftMin - Number(razObs[0]?.s || 0));
      if (!trajanjeMinut) return res.status(400).json({ napaka: 'Vse minute tega dne so že razporejene' });
    } else if (trajanje != null) {
      trajanjeMinut = Math.round(parseFloat(trajanje) * 60);
      if (!trajanjeMinut || trajanjeMinut <= 0) return res.status(400).json({ napaka: 'Vnesite veljavno trajanje' });
    } else if (casOd && casDo) {
      if (!/^\d{2}:\d{2}$/.test(casOd) || !/^\d{2}:\d{2}$/.test(casDo))
        return res.status(400).json({ napaka: 'Neveljaven čas' });
      if (casOd >= casDo) return res.status(400).json({ napaka: 'Čas "od" mora biti pred "do"' });
      casOdStore = casOd; casDoStore = casDo;
    } else {
      return res.status(400).json({ napaka: 'Vnesite trajanje' });
    }

    const r = await req.db.execute({
      sql: 'INSERT INTO evidenca_razporeditev (zaposleni_id, datum, delo_id, cas_od, cas_do, trajanje_minut) VALUES (?, ?, ?, ?, ?, ?)',
      args: [zaposleniId, datum, deloId, casOdStore, casDoStore, trajanjeMinut]
    });
    res.json({ ok: true, id: Number(r.lastInsertRowid), trajanjeMinut });
  });

  app.post('/api/kilometrina-pin', async (req, res) => {
    const { zaposleniId, pin, datum, gorivo, nakup } = req.body;
    if (!zaposleniId || !pin) return res.status(401).json({ napaka: 'Ni pooblastil' });
    const { rows: zr } = await req.db.execute({
      sql: 'SELECT id FROM zaposleni WHERE id = ? AND pin = ? AND aktiven = 1',
      args: [zaposleniId, pin]
    });
    if (!zr.length) return res.status(401).json({ napaka: 'Napačen PIN' });
    if (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return res.status(400).json({ napaka: 'Neveljaven datum' });
    const km = parseFloat(gorivo) || 0;
    const strosek = parseFloat(nakup) || 0;
    if (km <= 0 && strosek <= 0) return res.status(400).json({ napaka: 'Vnesite gorivo ali nakup' });
    await req.db.execute({
      sql: 'INSERT OR REPLACE INTO kilometrina (zaposleni_id, datum, km, strosek) VALUES (?, ?, ?, ?)',
      args: [zaposleniId, datum, km, strosek]
    });
    res.json({ ok: true });
  });

  app.get('/api/admin/razporeditev', requireAuth, async (req, res) => {
    const { zaposleniId, od, do: do_ } = req.query;
    const args = [];
    let where = 'WHERE 1=1';
    if (zaposleniId) { where += ' AND r.zaposleni_id = ?'; args.push(zaposleniId); }
    if (od) { where += ' AND r.datum >= ?'; args.push(od); }
    if (do_) { where += ' AND r.datum <= ?'; args.push(do_); }
    const { rows } = await req.db.execute({
      sql: `SELECT r.id, r.zaposleni_id, z.ime, r.datum, r.delo_id, d.naziv AS delo_naziv,
            d.urna_postavka AS delo_up, r.cas_od, r.cas_do, r.trajanje_minut
            FROM evidenca_razporeditev r
            JOIN zaposleni z ON z.id = r.zaposleni_id
            JOIN dela d ON d.id = r.delo_id
            ${where} ORDER BY r.datum DESC, r.cas_od ASC`,
      args
    });
    res.json(rows);
  });

  app.post('/api/admin/razporeditev', requireAuth, async (req, res) => {
    const { zaposleniId, datum, deloId, trajanje, celDan } = req.body;
    if (!zaposleniId || !datum || !deloId) return res.status(400).json({ napaka: 'Manjkajo podatki' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return res.status(400).json({ napaka: 'Neveljaven datum' });
    let trajanjeMinut = null;
    if (celDan) {
      const { rows: ev } = await req.db.execute({
        sql: 'SELECT tip, cas FROM evidenca WHERE zaposleni_id = ? AND (substr(cas,1,10) = ? OR substr(cas,1,10) = date(?, \'+1 day\')) ORDER BY cas ASC',
        args: [zaposleniId, datum, datum]
      });
      const shiftMin = Math.round(izracunajDnevneUre(ev).find(d => d.datum === datum)?.minute || 0);
      if (!shiftMin) return res.status(400).json({ napaka: 'Ni evidentirane prisotnosti za ta dan' });
      const { rows: razObs } = await req.db.execute({
        sql: 'SELECT COALESCE(SUM(trajanje_minut),0) AS s FROM evidenca_razporeditev WHERE zaposleni_id = ? AND datum = ?',
        args: [zaposleniId, datum]
      });
      trajanjeMinut = Math.max(0, shiftMin - Number(razObs[0]?.s || 0));
      if (!trajanjeMinut) return res.status(400).json({ napaka: 'Vse minute tega dne so že razporejene' });
    } else if (trajanje != null) {
      trajanjeMinut = Math.round(parseFloat(trajanje) * 60);
      if (!trajanjeMinut || trajanjeMinut <= 0) return res.status(400).json({ napaka: 'Vnesite veljavno trajanje' });
    } else {
      return res.status(400).json({ napaka: 'Vnesite trajanje' });
    }
    const r = await req.db.execute({
      sql: 'INSERT INTO evidenca_razporeditev (zaposleni_id, datum, delo_id, cas_od, cas_do, trajanje_minut) VALUES (?, ?, ?, ?, ?, ?)',
      args: [zaposleniId, datum, deloId, '00:00', '00:00', trajanjeMinut]
    });
    res.json({ ok: true, id: Number(r.lastInsertRowid), trajanjeMinut });
  });

  app.delete('/api/admin/razporeditev/:id', requireAuth, async (req, res) => {
    await req.db.execute({ sql: 'DELETE FROM evidenca_razporeditev WHERE id = ?', args: [req.params.id] });
    res.json({ ok: true });
  });

  app.get('/api/admin/evidenca', requireAuth, async (req, res) => {
    const od = req.query.od || '1970-01-01', do_ = req.query.do || '9999-12-31';
    const zapId = req.query.zaposleniId ? Number(req.query.zaposleniId) : null;
    const { rows } = await req.db.execute({
      sql: `SELECT e.id, z.ime, e.tip, e.cas, e.naknadno FROM evidenca e
            JOIN zaposleni z ON z.id = e.zaposleni_id
            WHERE substr(e.cas,1,10) BETWEEN ? AND ?
            ${zapId ? 'AND e.zaposleni_id = ?' : ''}
            ORDER BY e.cas DESC`,
      args: zapId ? [od, do_, zapId] : [od, do_]
    });
    res.json(rows);
  });

  app.delete('/api/admin/evidenca/:id', requireAuth, async (req, res) => {
    await req.db.execute({ sql: 'DELETE FROM evidenca WHERE id = ?', args: [req.params.id] });
    res.json({ ok: true });
  });

  app.get('/api/admin/kilometrina', requireAuth, async (req, res) => {
    const { zaposleniId, od, do: do_ } = req.query;
    if (!zaposleniId) return res.status(400).json({ napaka: 'Manjka zaposleniId' });
    const args = [zaposleniId];
    let where = 'zaposleni_id = ?';
    if (od) { where += ' AND datum >= ?'; args.push(od); }
    if (do_) { where += ' AND datum <= ?'; args.push(do_); }
    const { rows } = await req.db.execute({
      sql: `SELECT datum, km, strosek FROM kilometrina WHERE ${where} ORDER BY datum DESC`,
      args
    });
    res.json(rows);
  });

  app.post('/api/admin/kilometrina', requireAuth, async (req, res) => {
    const { zaposleniId, datum, km, strosek } = req.body;
    if (!zaposleniId || !datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum))
      return res.status(400).json({ napaka: 'Manjkajo podatki' });
    const kmNum = parseFloat(km) || 0;
    const strosekNum = parseFloat(strosek) || 0;
    await req.db.execute({
      sql: 'INSERT OR REPLACE INTO kilometrina (zaposleni_id, datum, km, strosek) VALUES (?, ?, ?, ?)',
      args: [zaposleniId, datum, kmNum, strosekNum]
    });
    res.json({ ok: true });
  });

  app.delete('/api/admin/kilometrina/:zaposleniId/:datum', requireAuth, async (req, res) => {
    await req.db.execute({
      sql: 'DELETE FROM kilometrina WHERE zaposleni_id = ? AND datum = ?',
      args: [req.params.zaposleniId, req.params.datum]
    });
    res.json({ ok: true });
  });

  app.post('/api/admin/rocni-vnos', requireAuth, async (req, res) => {
    const { zaposleniId, datum, casPrihoda, casOdhoda } = req.body;
    if (!zaposleniId || !datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum))
      return res.status(400).json({ napaka: 'Manjkajo podatki' });
    const timeRe = /^\d{2}:\d{2}$/;
    const batch = [];
    if (casPrihoda && timeRe.test(casPrihoda))
      batch.push({ sql: 'INSERT INTO evidenca (zaposleni_id, tip, cas, naknadno) VALUES (?, ?, ?, 1)',
        args: [zaposleniId, 'PRIHOD', `${datum} ${casPrihoda}:00`] });
    if (casOdhoda && timeRe.test(casOdhoda))
      batch.push({ sql: 'INSERT INTO evidenca (zaposleni_id, tip, cas, naknadno) VALUES (?, ?, ?, 1)',
        args: [zaposleniId, 'ODHOD', `${datum} ${casOdhoda}:00`] });
    if (!batch.length) return res.status(400).json({ napaka: 'Vnesi vsaj en čas' });
    await req.db.batch(batch, 'write');
    res.json({ ok: true, vstavljeno: batch.length });
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

  app.patch('/api/admin/zaposleni/:id/urna-postavka', requireAuth, async (req, res) => {
    const vrednost = parseFloat(req.body.urnaPostavka);
    if (isNaN(vrednost) || vrednost < 0)
      return res.status(400).json({ napaka: 'Neveljavna urna postavka' });
    await req.db.execute({ sql: 'UPDATE zaposleni SET urna_postavka = ? WHERE id = ?', args: [vrednost, req.params.id] });
    res.json({ ok: true });
  });

  app.get('/api/admin/anomalije', requireAuth, async (req, res) => {
    const [{ rows: odprte }, { rows: napake }] = await Promise.all([
      req.db.execute(
        `SELECT e.zaposleni_id, z.ime, e.cas AS prihod_cas
         FROM evidenca e
         JOIN zaposleni z ON z.id = e.zaposleni_id
         WHERE z.aktiven = 1
           AND e.id = (SELECT id FROM evidenca e2 WHERE e2.zaposleni_id = e.zaposleni_id ORDER BY e2.cas DESC LIMIT 1)
           AND e.tip = 'PRIHOD'
           AND e.cas <= datetime('now', '-2 days')
         ORDER BY e.cas ASC`
      ),
      req.db.execute(
        `SELECT e1.zaposleni_id, z.ime, e1.cas AS prihod_cas, e2.cas AS naslednji_prihod_cas
         FROM evidenca e1
         JOIN zaposleni z ON z.id = e1.zaposleni_id
         JOIN evidenca e2 ON e2.zaposleni_id = e1.zaposleni_id
           AND e2.cas = (SELECT MIN(cas) FROM evidenca e3 WHERE e3.zaposleni_id = e1.zaposleni_id AND e3.cas > e1.cas)
         WHERE e1.tip = 'PRIHOD' AND e2.tip = 'PRIHOD'
           AND e1.cas >= date('now', '-60 days')
         ORDER BY e1.cas DESC
         LIMIT 50`
      )
    ]);
    res.json({ odprte, napake });
  });

  app.get('/api/admin/obracun', requireAuth, async (req, res) => {
    const zdaj = new Date();
    const leto = parseInt(req.query.leto) || zdaj.getFullYear();
    const mesec = parseInt(req.query.mesec) || (zdaj.getMonth() + 1);
    const mesecStr = `${leto}-${String(mesec).padStart(2, '0')}`;
    const od = `${mesecStr}-01`, do_ = `${mesecStr}-31`;

    const [{ rows: zaposleni }, { rows: evidenca }, { rows: stimulacije }, { rows: razporeditev }, { rows: kmRows }, { rows: akontacije }] = await Promise.all([
      req.db.execute(
        `SELECT z.id, z.ime, z.urna_postavka, z.privzeto_delo_id,
                d.naziv AS priv_naziv, d.urna_postavka AS priv_up
         FROM zaposleni z LEFT JOIN dela d ON d.id = z.privzeto_delo_id
         WHERE z.aktiven = 1 ORDER BY z.ime`
      ),
      req.db.execute({ sql: `SELECT zaposleni_id, tip, cas FROM evidenca WHERE substr(cas,1,10) BETWEEN ? AND ? ORDER BY cas ASC`, args: [od, do_] }),
      req.db.execute({ sql: 'SELECT zaposleni_id, SUM(znesek) as skupaj FROM stimulacija WHERE mesec = ? GROUP BY zaposleni_id', args: [mesecStr] }),
      req.db.execute({
        sql: `SELECT r.zaposleni_id, r.delo_id, d.naziv AS delo_naziv, d.urna_postavka AS delo_up, r.cas_od, r.cas_do, r.trajanje_minut
              FROM evidenca_razporeditev r JOIN dela d ON d.id = r.delo_id
              WHERE r.datum BETWEEN ? AND ?`,
        args: [od, do_]
      }),
      req.db.execute({ sql: `SELECT zaposleni_id, SUM(km) AS skupaj_km, SUM(strosek) AS skupaj_strosek FROM kilometrina WHERE datum BETWEEN ? AND ? GROUP BY zaposleni_id`, args: [od, do_] }),
      req.db.execute({ sql: 'SELECT zaposleni_id, SUM(znesek) as skupaj FROM akontacija WHERE mesec = ? GROUP BY zaposleni_id', args: [mesecStr] })
    ]);

    const stimMap = new Map(stimulacije.map(s => [Number(s.zaposleni_id), parseFloat(s.skupaj) || 0]));
    const kmMap = new Map(kmRows.map(r => [Number(r.zaposleni_id), { km: parseFloat(r.skupaj_km) || 0, strosek: parseFloat(r.skupaj_strosek) || 0 }]));
    const aktMap = new Map(akontacije.map(a => [Number(a.zaposleni_id), parseFloat(a.skupaj) || 0]));

    const obracun = zaposleni.map(z => {
      const zid = Number(z.id);
      const zEv = evidenca.filter(e => Number(e.zaposleni_id) === zid);
      const zRaz = razporeditev.filter(r => Number(r.zaposleni_id) === zid);

      const dnevi = izracunajDnevneUre(zEv, zdaj);
      const skupajMinut = dnevi.reduce((s, d) => s + d.minute, 0);

      const privzetaUp = parseFloat(z.priv_up) || parseFloat(z.urna_postavka) || 0;

      const delaMap = new Map();
      for (const r of zRaz) {
        const min = razMin(r);
        if (!delaMap.has(r.delo_id)) {
          delaMap.set(r.delo_id, { naziv: r.delo_naziv, urna_postavka: parseFloat(r.delo_up) || 0, minute: 0 });
        }
        delaMap.get(r.delo_id).minute += min;
      }
      const dodatnaMinute = [...delaMap.values()].reduce((s, d) => s + d.minute, 0);
      const privzetaMinuta = Math.max(0, skupajMinut - dodatnaMinute);

      const privzetaOsnova = privzetaUp > 0 ? Math.round(privzetaMinuta / 60 * privzetaUp * 100) / 100 : 0;
      const dodatnaOsnova = [...delaMap.values()].reduce((s, d) =>
        s + (d.urna_postavka > 0 ? Math.round(d.minute / 60 * d.urna_postavka * 100) / 100 : 0), 0);

      const hasRate = privzetaUp > 0 || delaMap.size > 0;
      const osnova = hasRate ? Math.round((privzetaOsnova + dodatnaOsnova) * 100) / 100 : null;
      const stimulacija = stimMap.get(zid) || 0;
      const { km: gorivo = 0, strosek: nakup = 0 } = kmMap.get(zid) || {};
      const akontacija = aktMap.get(zid) || 0;
      const hasData = osnova !== null || stimulacija > 0 || gorivo > 0 || nakup > 0 || akontacija > 0;
      const skupaj = hasData ? Math.round(((osnova || 0) + stimulacija + gorivo + nakup) * 100) / 100 : null;

      return {
        id: zid, ime: z.ime,
        privzetoDelo: z.privzeto_delo_id ? { id: Number(z.privzeto_delo_id), naziv: z.priv_naziv, urna_postavka: parseFloat(z.priv_up) } : null,
        urnaPostavka: privzetaUp,
        minute: skupajMinut,
        privzetaMinuta,
        dodatnaDela: [...delaMap.entries()].map(([id, d]) => ({ id, ...d })),
        osnova, stimulacija: stimulacija || null,
        gorivo, nakup,
        skupaj,
        akontacija: akontacija || null,
        preostalo: hasData ? Math.round((skupaj - akontacija) * 100) / 100 : null
      };
    });
    res.json({ leto, mesec, obracun });
  });

  app.get('/api/admin/obracun-tiskalnik', requireAuth, async (req, res) => {
    const zdaj = new Date();
    const leto = parseInt(req.query.leto) || zdaj.getFullYear();
    const mesec = parseInt(req.query.mesec) || (zdaj.getMonth() + 1);
    const zaposleniId = req.query.zaposleniId ? parseInt(req.query.zaposleniId) : null;
    const mesecStr = `${leto}-${String(mesec).padStart(2, '0')}`;
    const od = `${mesecStr}-01`, do_ = `${mesecStr}-31`;

    const [{ rows: zaposleniRows }, { rows: evidenca }, { rows: stimulacije }, { rows: razporeditev }, { rows: kmRows }, { rows: akontacije }] = await Promise.all([
      req.db.execute(
        zaposleniId
          ? { sql: `SELECT z.id, z.ime, z.urna_postavka, z.privzeto_delo_id, d.naziv AS priv_naziv, d.urna_postavka AS priv_up FROM zaposleni z LEFT JOIN dela d ON d.id = z.privzeto_delo_id WHERE z.id = ? AND z.aktiven = 1 ORDER BY z.ime`, args: [zaposleniId] }
          : `SELECT z.id, z.ime, z.urna_postavka, z.privzeto_delo_id, d.naziv AS priv_naziv, d.urna_postavka AS priv_up FROM zaposleni z LEFT JOIN dela d ON d.id = z.privzeto_delo_id WHERE z.aktiven = 1 ORDER BY z.ime`
      ),
      req.db.execute({ sql: `SELECT zaposleni_id, tip, cas FROM evidenca WHERE substr(cas,1,10) BETWEEN ? AND ? ORDER BY cas ASC`, args: [od, do_] }),
      req.db.execute({ sql: 'SELECT zaposleni_id, SUM(znesek) as skupaj FROM stimulacija WHERE mesec = ? GROUP BY zaposleni_id', args: [mesecStr] }),
      req.db.execute({
        sql: `SELECT r.zaposleni_id, r.datum, r.delo_id, d.naziv AS delo_naziv, d.urna_postavka AS delo_up, r.cas_od, r.cas_do, r.trajanje_minut
              FROM evidenca_razporeditev r JOIN dela d ON d.id = r.delo_id
              WHERE r.datum BETWEEN ? AND ?`,
        args: [od, do_]
      }),
      req.db.execute({ sql: `SELECT zaposleni_id, SUM(km) AS skupaj_km, SUM(strosek) AS skupaj_strosek FROM kilometrina WHERE datum BETWEEN ? AND ? GROUP BY zaposleni_id`, args: [od, do_] }),
      req.db.execute({ sql: 'SELECT zaposleni_id, SUM(znesek) as skupaj FROM akontacija WHERE mesec = ? GROUP BY zaposleni_id', args: [mesecStr] })
    ]);

    const stimMap = new Map(stimulacije.map(s => [Number(s.zaposleni_id), parseFloat(s.skupaj) || 0]));
    const kmMap = new Map(kmRows.map(r => [Number(r.zaposleni_id), { km: parseFloat(r.skupaj_km) || 0, strosek: parseFloat(r.skupaj_strosek) || 0 }]));
    const aktMap = new Map(akontacije.map(a => [Number(a.zaposleni_id), parseFloat(a.skupaj) || 0]));

    const zaposleniOut = [];
    for (const z of zaposleniRows) {
      const zid = Number(z.id);
      const zEv = evidenca.filter(e => Number(e.zaposleni_id) === zid);
      const zRaz = razporeditev.filter(r => Number(r.zaposleni_id) === zid);

      // Build daily entries with prihod/odhod times
      const sortedVnosi = [...zEv]
        .map(v => ({ tip: v.tip, casObj: new Date(String(v.cas).replace(' ', 'T')), casStr: String(v.cas), datum: String(v.cas).slice(0, 10) }))
        .sort((a, b) => a.casObj - b.casObj);

      const poDnevih = new Map();
      let odprtPrihod = null;
      for (const v of sortedVnosi) {
        if (v.tip === 'PRIHOD') {
          odprtPrihod = v;
          if (!poDnevih.has(v.datum)) poDnevih.set(v.datum, { minute: 0, prihod: null, odhod: null, odprtPrihod: v });
          const d = poDnevih.get(v.datum);
          if (!d.prihod) d.prihod = String(v.casStr).slice(11, 16);
          d.odprtPrihod = v;
        } else if (v.tip === 'ODHOD' && odprtPrihod) {
          const datum = odprtPrihod.datum;
          if (!poDnevih.has(datum)) poDnevih.set(datum, { minute: 0, prihod: String(odprtPrihod.casStr).slice(11, 16), odhod: null, odprtPrihod: null });
          const d = poDnevih.get(datum);
          d.minute += (v.casObj - odprtPrihod.casObj) / 60000;
          d.odhod = String(v.casStr).slice(11, 16) + (v.datum !== datum ? ' +1d' : '');
          d.odprtPrihod = null;
          odprtPrihod = null;
        }
      }

      // Build razporeditev by date
      const razPoDateh = new Map();
      for (const r of zRaz) {
        if (!razPoDateh.has(r.datum)) razPoDateh.set(r.datum, []);
        razPoDateh.get(r.datum).push({ naziv: r.delo_naziv, minute: razMin(r) });
      }

      const dnevi = [...poDnevih.entries()].sort().map(([datum, d]) => {
        const minuteRounded = Math.round(d.minute);
        let dela;
        if (razPoDateh.has(datum)) {
          dela = razPoDateh.get(datum);
        } else if (z.priv_naziv && minuteRounded > 0) {
          dela = [{ naziv: z.priv_naziv, minute: minuteRounded }];
        } else {
          dela = [];
        }
        return { datum, prihod: d.prihod || null, odhod: d.odhod || null, minute: minuteRounded, dela };
      }).filter(d => d.minute > 0 || d.prihod);

      if (!dnevi.length) continue;

      const skupajMinut = dnevi.reduce((s, d) => s + d.minute, 0);

      const privzetaUp = parseFloat(z.priv_up) || parseFloat(z.urna_postavka) || 0;
      const delaMap = new Map();
      for (const r of zRaz) {
        const min = razMin(r);
        if (!delaMap.has(r.delo_id)) {
          delaMap.set(r.delo_id, { naziv: r.delo_naziv, urna_postavka: parseFloat(r.delo_up) || 0, minute: 0 });
        }
        delaMap.get(r.delo_id).minute += min;
      }
      const dodatnaMinute = [...delaMap.values()].reduce((s, d) => s + d.minute, 0);
      const privzetaMinuta = Math.max(0, skupajMinut - dodatnaMinute);
      const privzetaOsnova = privzetaUp > 0 ? Math.round(privzetaMinuta / 60 * privzetaUp * 100) / 100 : 0;
      const dodatnaOsnova = [...delaMap.values()].reduce((s, d) =>
        s + (d.urna_postavka > 0 ? Math.round(d.minute / 60 * d.urna_postavka * 100) / 100 : 0), 0);
      const hasRate = privzetaUp > 0 || delaMap.size > 0;
      const osnova = hasRate ? Math.round((privzetaOsnova + dodatnaOsnova) * 100) / 100 : null;

      // Per-work-type breakdown for print
      const delaBreakdown = [];
      if (privzetaMinuta > 0 && privzetaUp > 0) {
        delaBreakdown.push({ naziv: z.priv_naziv || 'Osnova', minute: privzetaMinuta, urna_postavka: privzetaUp, osnova: privzetaOsnova });
      }
      for (const [, d] of delaMap) {
        if (d.minute > 0 && d.urna_postavka > 0) {
          delaBreakdown.push({ naziv: d.naziv, minute: d.minute, urna_postavka: d.urna_postavka, osnova: Math.round(d.minute / 60 * d.urna_postavka * 100) / 100 });
        }
      }

      const stimulacija = stimMap.get(zid) || 0;
      const { km: gorivo = 0, strosek: nakup = 0 } = kmMap.get(zid) || {};
      const akontacija = aktMap.get(zid) || 0;
      const hasData = osnova !== null || stimulacija > 0 || gorivo > 0 || nakup > 0 || akontacija > 0;
      const skupajPlacilo = hasData ? Math.round(((osnova || 0) + stimulacija + gorivo + nakup) * 100) / 100 : null;

      zaposleniOut.push({
        id: zid,
        ime: z.ime,
        privzetoDelo: z.priv_naziv || null,
        urnaPostavka: privzetaUp || null,
        skupajMinut,
        delaBreakdown,
        dnevi,
        osnova,
        stimulacija: stimulacija || null,
        gorivo: gorivo || null,
        nakup: nakup || null,
        skupajPlacilo,
        akontacija: akontacija || null,
        preostalo: hasData ? Math.round((skupajPlacilo - akontacija) * 100) / 100 : null
      });
    }

    res.json({ leto, mesec, mesecStr, zaposleni: zaposleniOut });
  });

  app.get('/api/admin/stimulacija', requireAuth, async (req, res) => {
    const { mesec } = req.query;
    if (!mesec) return res.status(400).json({ napaka: 'Manjka mesec' });
    const { rows } = await req.db.execute({
      sql: `SELECT s.id, s.zaposleni_id, z.ime, s.znesek, s.opomba
            FROM stimulacija s JOIN zaposleni z ON z.id = s.zaposleni_id
            WHERE s.mesec = ? ORDER BY z.ime`,
      args: [mesec]
    });
    res.json(rows);
  });

  app.post('/api/admin/stimulacija', requireAuth, async (req, res) => {
    const { zaposleniId, mesec, znesek, opomba } = req.body;
    if (!zaposleniId || !mesec || znesek == null)
      return res.status(400).json({ napaka: 'Manjkajo podatki' });
    if (!/^\d{4}-\d{2}$/.test(mesec))
      return res.status(400).json({ napaka: 'Neveljaven format meseca (YYYY-MM)' });
    const vrednost = parseFloat(znesek);
    if (isNaN(vrednost) || vrednost <= 0)
      return res.status(400).json({ napaka: 'Znesek mora biti pozitivno število' });
    const r = await req.db.execute({
      sql: 'INSERT INTO stimulacija (zaposleni_id, mesec, znesek, opomba) VALUES (?, ?, ?, ?)',
      args: [zaposleniId, mesec, vrednost, opomba || null]
    });
    res.json({ id: Number(r.lastInsertRowid), ok: true });
  });

  app.delete('/api/admin/stimulacija/:id', requireAuth, async (req, res) => {
    await req.db.execute({ sql: 'DELETE FROM stimulacija WHERE id = ?', args: [req.params.id] });
    res.json({ ok: true });
  });

  app.get('/api/admin/akontacija', requireAuth, async (req, res) => {
    const { mesec } = req.query;
    if (!mesec) return res.status(400).json({ napaka: 'Manjka mesec' });
    const { rows } = await req.db.execute({
      sql: `SELECT a.id, a.zaposleni_id, z.ime, a.datum, a.znesek, a.opomba
            FROM akontacija a JOIN zaposleni z ON z.id = a.zaposleni_id
            WHERE a.mesec = ? ORDER BY z.ime, a.datum`,
      args: [mesec]
    });
    res.json(rows);
  });

  app.post('/api/admin/akontacija', requireAuth, async (req, res) => {
    const { zaposleniId, mesec, datum, znesek, opomba } = req.body;
    if (!zaposleniId || !mesec || !datum || znesek == null)
      return res.status(400).json({ napaka: 'Manjkajo podatki' });
    if (!/^\d{4}-\d{2}$/.test(mesec))
      return res.status(400).json({ napaka: 'Neveljaven format meseca (YYYY-MM)' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum))
      return res.status(400).json({ napaka: 'Neveljaven datum' });
    const vrednost = parseFloat(znesek);
    if (isNaN(vrednost) || vrednost <= 0)
      return res.status(400).json({ napaka: 'Znesek mora biti pozitivno število' });
    const r = await req.db.execute({
      sql: 'INSERT INTO akontacija (zaposleni_id, mesec, datum, znesek, opomba) VALUES (?, ?, ?, ?, ?)',
      args: [zaposleniId, mesec, datum, vrednost, opomba || null]
    });
    res.json({ id: Number(r.lastInsertRowid), ok: true });
  });

  app.delete('/api/admin/akontacija/:id', requireAuth, async (req, res) => {
    await req.db.execute({ sql: 'DELETE FROM akontacija WHERE id = ?', args: [req.params.id] });
    res.json({ ok: true });
  });

  app.get('/api/admin/polmesec', requireAuth, async (req, res) => {
    const mesecStr = req.query.mesec || localDate().slice(0, 7);
    const od = `${mesecStr}-01`, do_ = `${mesecStr}-14`;

    const [{ rows: zaposleni }, { rows: evidenca }, { rows: razporeditev }, { rows: akontacije }] = await Promise.all([
      req.db.execute(
        `SELECT z.id, z.ime, z.urna_postavka, d.urna_postavka AS priv_up
         FROM zaposleni z LEFT JOIN dela d ON d.id = z.privzeto_delo_id
         WHERE z.aktiven = 1 ORDER BY z.ime`
      ),
      req.db.execute({ sql: `SELECT zaposleni_id, tip, cas FROM evidenca WHERE substr(cas,1,10) BETWEEN ? AND ? ORDER BY cas ASC`, args: [od, do_] }),
      req.db.execute({
        sql: `SELECT r.zaposleni_id, r.cas_od, r.cas_do, r.trajanje_minut, d.urna_postavka AS delo_up
              FROM evidenca_razporeditev r JOIN dela d ON d.id = r.delo_id WHERE r.datum BETWEEN ? AND ?`,
        args: [od, do_]
      }),
      req.db.execute({ sql: `SELECT id, zaposleni_id, znesek FROM akontacija WHERE mesec = ? AND opomba = 'polmesec'`, args: [mesecStr] })
    ]);

    const aktMap = new Map(akontacije.map(a => [Number(a.zaposleni_id), { id: Number(a.id), znesek: parseFloat(a.znesek) }]));
    const zdaj = new Date();

    const rezultat = zaposleni.map(z => {
      const zid = Number(z.id);
      const dnevi = izracunajDnevneUre(evidenca.filter(e => Number(e.zaposleni_id) === zid), zdaj);
      const skupajMinut = dnevi.reduce((s, d) => s + d.minute, 0);
      const privzetaUp = parseFloat(z.priv_up) || parseFloat(z.urna_postavka) || 0;
      const zRaz = razporeditev.filter(r => Number(r.zaposleni_id) === zid);
      let dodatnaMinute = 0, dodatnaOsnova = 0;
      for (const r of zRaz) {
        const min = razMin(r);
        dodatnaMinute += min;
        const up = parseFloat(r.delo_up) || 0;
        if (up > 0) dodatnaOsnova += Math.round(min / 60 * up * 100) / 100;
      }
      const privzetaOsnova = privzetaUp > 0 ? Math.round(Math.max(0, skupajMinut - dodatnaMinute) / 60 * privzetaUp * 100) / 100 : 0;
      const osnova = (privzetaUp > 0 || zRaz.length > 0) ? Math.round((privzetaOsnova + dodatnaOsnova) * 100) / 100 : null;
      const akt = aktMap.get(zid) || null;
      return { id: zid, ime: z.ime, minute: skupajMinut, osnova, potrjeno: !!akt, akontacijaId: akt?.id || null, akontacijaZnesek: akt?.znesek || null };
    }).filter(z => z.minute > 0 || z.potrjeno);

    res.json({ mesec: mesecStr, zaposleni: rezultat });
  });

  app.post('/api/admin/polmesec/potrdi', requireAuth, async (req, res) => {
    const { zaposleni_id, mesec, znesek } = req.body;
    if (!zaposleni_id || !mesec || znesek == null)
      return res.status(400).json({ napaka: 'Manjkajo podatki' });
    await req.db.execute({ sql: `DELETE FROM akontacija WHERE zaposleni_id = ? AND mesec = ? AND opomba = 'polmesec'`, args: [zaposleni_id, mesec] });
    const r = await req.db.execute({
      sql: `INSERT INTO akontacija (zaposleni_id, mesec, datum, znesek, opomba) VALUES (?, ?, ?, ?, 'polmesec')`,
      args: [zaposleni_id, mesec, localDate(), znesek]
    });
    res.json({ id: Number(r.lastInsertRowid) });
  });

  // ── Prisotnost – seznam zaposlenih za mesec ───────────────────────────────────
  app.get('/api/admin/prisotnost', requireAuth, async (req, res) => {
    const zdaj = new Date();
    const leto = parseInt(req.query.leto) || zdaj.getFullYear();
    const mesec = parseInt(req.query.mesec) || (zdaj.getMonth() + 1);
    const mesecStr = `${leto}-${String(mesec).padStart(2, '0')}`;
    const od = `${mesecStr}-01`, do_ = `${mesecStr}-31`;

    const [{ rows: zaposleni }, { rows: evidenca }] = await Promise.all([
      req.db.execute('SELECT id, ime FROM zaposleni WHERE aktiven = 1 ORDER BY ime'),
      req.db.execute({
        sql: `SELECT zaposleni_id, tip, cas, naknadno FROM evidenca
              WHERE substr(cas,1,10) BETWEEN ? AND ? ORDER BY cas ASC`,
        args: [od, do_]
      })
    ]);

    const seznam = zaposleni.map(z => {
      const zid = Number(z.id);
      const zEv = evidenca.filter(e => Number(e.zaposleni_id) === zid);
      const dnevi = izracunajDnevneUre(zEv, zdaj);
      const skupajMinut = dnevi.reduce((s, d) => s + d.minute, 0);
      const steviloNaknadno = zEv.filter(e => Number(e.naknadno) === 1).length;
      return {
        id: zid, ime: z.ime,
        skupajMinut: Math.round(skupajMinut),
        steviloDni: dnevi.length,
        steviloNaknadno
      };
    });
    seznam.sort((a, b) => b.skupajMinut - a.skupajMinut);
    res.json({ leto, mesec, seznam });
  });

  // ── Prisotnost – detajl zaposlenega za mesec ──────────────────────────────────
  app.get('/api/admin/prisotnost/:id', requireAuth, async (req, res) => {
    const zdaj = new Date();
    const leto = parseInt(req.query.leto) || zdaj.getFullYear();
    const mesec = parseInt(req.query.mesec) || (zdaj.getMonth() + 1);
    const mesecStr = `${leto}-${String(mesec).padStart(2, '0')}`;
    const od = `${mesecStr}-01`, do_ = `${mesecStr}-31`;

    const [{ rows: zRows }, { rows: vnosi }, { rows: razVnosi }] = await Promise.all([
      req.db.execute({ sql: 'SELECT z.id, z.ime, d.naziv AS privzeto_delo FROM zaposleni z LEFT JOIN dela d ON d.id = z.privzeto_delo_id WHERE z.id = ?', args: [req.params.id] }),
      req.db.execute({
        sql: `SELECT id, tip, cas, naknadno FROM evidenca
              WHERE zaposleni_id = ? AND substr(cas,1,10) BETWEEN ? AND ?
              ORDER BY cas ASC`,
        args: [req.params.id, od, do_]
      }),
      req.db.execute({
        sql: `SELECT r.datum, d.naziv AS delo_naziv, r.trajanje_minut, r.cas_od, r.cas_do
              FROM evidenca_razporeditev r JOIN dela d ON d.id = r.delo_id
              WHERE r.zaposleni_id = ? AND r.datum BETWEEN ? AND ?
              ORDER BY r.datum`,
        args: [req.params.id, od, do_]
      })
    ]);

    if (!zRows.length) return res.status(404).json({ napaka: 'Zaposleni ni najden' });

    const danes = localDate();
    let skupajMinut = 0;

    // Sortiraj kronološko in pari čez datum (za izmene čez polnoč)
    const sortedVnosi = [...vnosi]
      .map(v => ({ ...v, casObj: new Date(String(v.cas).replace(' ', 'T')), datum: String(v.cas).slice(0, 10) }))
      .sort((a, b) => a.casObj - b.casObj);

    const poDnevih = new Map();
    let odprtPrihod = null;

    for (const v of sortedVnosi) {
      if (v.tip === 'PRIHOD') {
        odprtPrihod = v;
        if (!poDnevih.has(v.datum)) poDnevih.set(v.datum, { minute: 0, vnosi: [], odprtPrihod: v });
        poDnevih.get(v.datum).vnosi.push({ tip: 'PRIHOD', cas: String(v.cas).slice(11, 16), naknadno: Number(v.naknadno) === 1 });
        poDnevih.get(v.datum).odprtPrihod = v;
      } else if (v.tip === 'ODHOD' && odprtPrihod) {
        const datum = odprtPrihod.datum;
        if (!poDnevih.has(datum)) poDnevih.set(datum, { minute: 0, vnosi: [], odprtPrihod: null });
        const d = poDnevih.get(datum);
        const min = (v.casObj - odprtPrihod.casObj) / 60000;
        d.minute += min;
        skupajMinut += min;
        // Prikaži čas odhoda — če je naslednji dan, dodaj "+1d"
        const odhCas = String(v.cas).slice(11, 16) + (v.datum !== datum ? ' +1d' : '');
        d.vnosi.push({ tip: 'ODHOD', cas: odhCas, naknadno: Number(v.naknadno) === 1 });
        d.odprtPrihod = null;
        odprtPrihod = null;
      }
    }

    const razPoDateh = new Map();
    for (const r of razVnosi) {
      if (!razPoDateh.has(r.datum)) razPoDateh.set(r.datum, []);
      razPoDateh.get(r.datum).push({
        naziv: r.delo_naziv,
        minute: razMin(r)
      });
    }

    const dnevi = [...poDnevih.entries()].sort().map(([datum, d]) => ({
      datum,
      minute: Math.round(d.minute),
      nepopoln: d.odprtPrihod !== null && datum !== danes,
      vnosi: d.vnosi,
      dela: razPoDateh.get(datum) || []
    }));

    res.json({
      id: Number(zRows[0].id), ime: zRows[0].ime,
      privzetoDelo: zRows[0].privzeto_delo || null,
      leto, mesec,
      skupajMinut: Math.round(skupajMinut),
      dnevi
    });
  });

  // ── Lestvica ──────────────────────────────────────────────────────────────────
  app.get('/api/admin/lestvica', requireAuth, async (req, res) => {
    const { od, do: do_ } = req.query;
    const zdaj = new Date();
    const args = od && do_ ? [od, do_] : [];
    const where = od && do_ ? 'AND substr(cas,1,10) BETWEEN ? AND ?' : '';

    const [{ rows: zaposleni }, { rows: evidenca }] = await Promise.all([
      req.db.execute('SELECT id, ime FROM zaposleni WHERE aktiven = 1 ORDER BY ime'),
      req.db.execute({ sql: `SELECT zaposleni_id, tip, cas FROM evidenca WHERE 1=1 ${where} ORDER BY cas ASC`, args })
    ]);

    const lestvica = zaposleni.map(z => {
      const zid = Number(z.id);
      const dnevi = izracunajDnevneUre(evidenca.filter(e => Number(e.zaposleni_id) === zid), zdaj);
      const minute = dnevi.reduce((s, d) => s + d.minute, 0);
      const dni = dnevi.filter(d => d.minute > 0 || d.vTeku).length;
      return { id: zid, ime: z.ime, minute, dni };
    });

    lestvica.sort((a, b) => b.minute - a.minute);
    res.json(lestvica);
  });

  // ── Zahtevki ──────────────────────────────────────────────────────────────────
  app.get('/api/admin/zahtevki', requireAuth, async (req, res) => {
    const { rows } = await req.db.execute(
      `SELECT z.id, z.tip, z.cas_zahtevka, z.opomba, z.status, z.ustvarjen,
              zap.ime AS ime_zaposlenega
       FROM zahtevki z
       JOIN zaposleni zap ON zap.id = z.zaposleni_id
       ORDER BY z.ustvarjen DESC`
    );
    res.json(rows);
  });

  app.post('/api/admin/zahtevki/:id/odobri', requireAuth, async (req, res) => {
    const { rows } = await req.db.execute({
      sql: 'SELECT * FROM zahtevki WHERE id = ?', args: [req.params.id]
    });
    if (!rows.length) return res.status(404).json({ napaka: 'Zahtevek ni najden' });
    const z = rows[0];
    if (z.status !== 'CAKA') return res.status(400).json({ napaka: 'Zahtevek je že obravnavan' });
    const datum = String(z.cas_zahtevka).slice(0, 10);
    await req.db.batch([
      { sql: `DELETE FROM evidenca WHERE zaposleni_id = ? AND tip = ? AND substr(cas,1,10) = ?`,
        args: [z.zaposleni_id, z.tip, datum] },
      { sql: 'INSERT INTO evidenca (zaposleni_id, tip, cas, naknadno) VALUES (?, ?, ?, 1)',
        args: [z.zaposleni_id, z.tip, z.cas_zahtevka] },
      { sql: "UPDATE zahtevki SET status = 'ODOBREN' WHERE id = ?", args: [z.id] }
    ], 'write');
    res.json({ ok: true });
  });

  app.post('/api/admin/zahtevki/:id/zavrni', requireAuth, async (req, res) => {
    const { rows } = await req.db.execute({
      sql: 'SELECT id, status FROM zahtevki WHERE id = ?', args: [req.params.id]
    });
    if (!rows.length) return res.status(404).json({ napaka: 'Zahtevek ni najden' });
    if (rows[0].status !== 'CAKA') return res.status(400).json({ napaka: 'Zahtevek je že obravnavan' });
    await req.db.execute({ sql: "UPDATE zahtevki SET status = 'ZAVRNJEN' WHERE id = ?", args: [req.params.id] });
    res.json({ ok: true });
  });

  // ── Preberi vnos-zaposleni.txt ────────────────────────────────────────────────
  app.get('/api/admin/vnos-zaposleni', requireAuth, async (req, res) => {
    try {
      // Najprej iz baze (zadnji uvoz), nato iz datoteke kot fallback
      const { rows } = await req.db.execute({ sql: `SELECT vrednost FROM config WHERE kljuc = 'vnos_zaposleni_txt'`, args: [] });
      if (rows[0]?.vrednost) return res.json({ tekst: rows[0].vrednost });
      const txtPath = path.join(__dirname, 'vnos-zaposleni.txt');
      const txt = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : '';
      res.json({ tekst: txt });
    } catch (e) {
      res.status(500).json({ napaka: e.message });
    }
  });

  // ── Uvoz zaposlenih iz vnos-zaposleni.txt ─────────────────────────────────────
  app.post('/api/admin/uvozi-zaposlene', requireAuth, async (req, res) => {
    try {
      const db = req.db;
      // Sprejmi tekst iz telesa zahteve, nato iz baze, nato iz datoteke
      let txt = (typeof req.body?.tekst === 'string' && req.body.tekst.trim()) ? req.body.tekst : null;
      if (!txt) {
        const { rows: cfgRows } = await db.execute({ sql: `SELECT vrednost FROM config WHERE kljuc = 'vnos_zaposleni_txt'`, args: [] });
        txt = cfgRows[0]?.vrednost || null;
      }
      if (!txt) {
        const txtPath = path.join(__dirname, 'vnos-zaposleni.txt');
        if (!fs.existsSync(txtPath)) return res.status(404).json({ napaka: 'Ni vnesenega seznama. Prilepi zaposlene v polje zgoraj.' });
        txt = fs.readFileSync(txtPath, 'utf8');
      }

      const YEAR = '2026';
      function parseDatumImp(ddmm) {
        const [dd, mm] = ddmm.split('.');
        return `${YEAR}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      }
      function addDayImp(dateStr) {
        const d = new Date(dateStr + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().slice(0, 10);
      }
      function parseShiftLineImp(line) {
        const m = line.match(/^(\d{2}\.\d{2})\s+(.+)$/);
        if (!m) return null;
        const datum = parseDatumImp(m[1]);
        const rest = m[2].trim();
        if (rest === '-') return { datum, shift: null, km: null, strosek: null };
        const tm = rest.match(/^-(\d{2}:\d{2})-(\d{2}:\d{2})\s*(.*)$/);
        if (!tm) return { datum, shift: null, km: null, strosek: null };
        const [, start, end, notes] = tm;
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        const crossesMidnight = (eh * 60 + em) < (sh * 60 + sm);
        const kmM = (notes || '').match(/(\d+)\s*km/i);
        const km = kmM ? parseInt(kmM[1]) : null;
        const strosekM = (notes || '').match(/(\d+(?:[.,]\d+)?)\s*€/);
        const strosek = strosekM ? parseFloat(strosekM[1].replace(',', '.')) : null;
        return { datum, shift: { start, end, crossesMidnight }, km, strosek };
      }
      function parseFileImp(src) {
        const blocks = src.split(/\n[ \t]*\n/).filter(b => b.trim());
        const employees = [];
        for (const block of blocks) {
          const lines = block.trim().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
          if (!lines.length) continue;
          const parts = lines[0].split('|').map(s => s.trim());
          if (parts.length < 3) continue;
          const [ime, delaStr, pin] = parts;
          const dela = delaStr.split(',').map(s => s.trim().charAt(0).toUpperCase() + s.trim().slice(1));
          const days = lines.slice(1).map(parseShiftLineImp).filter(Boolean);
          employees.push({ ime: ime.trim(), dela, pin: pin.trim(), days });
        }
        return employees;
      }

      const employees = parseFileImp(txt);
      if (!employees.length) return res.status(400).json({ napaka: 'Ni zaposlenih v datoteki' });

      // Pobriši obstoječe
      await db.batch([
        { sql: 'DELETE FROM zaposleni_dela', args: [] },
        { sql: 'DELETE FROM kilometrina', args: [] },
        { sql: 'DELETE FROM evidenca_razporeditev', args: [] },
        { sql: 'DELETE FROM evidenca', args: [] },
        { sql: 'DELETE FROM zahtevki', args: [] },
        { sql: 'DELETE FROM stimulacija', args: [] },
        { sql: 'DELETE FROM akontacija', args: [] },
        { sql: 'DELETE FROM zaposleni', args: [] },
      ], 'write');

      // Naložni tipi dela
      const { rows: delaRows } = await db.execute('SELECT id, naziv FROM dela');
      const delaMap = new Map(delaRows.map(d => [d.naziv, Number(d.id)]));

      let uvozenih = 0;
      let evidencCount = 0;
      for (const emp of employees) {
        const privzetoDeloId = delaMap.get(emp.dela[0]) || null;
        const r = await db.execute({
          sql: 'INSERT INTO zaposleni (ime, pin, privzeto_delo_id, pin_setup_required) VALUES (?, ?, ?, 1)',
          args: [emp.ime, emp.pin, privzetoDeloId]
        });
        const zaposleniId = Number(r.lastInsertRowid);
        for (const deloNaziv of emp.dela) {
          const deloId = delaMap.get(deloNaziv);
          if (!deloId) continue;
          await db.execute({ sql: 'INSERT OR IGNORE INTO zaposleni_dela (zaposleni_id, delo_id) VALUES (?, ?)', args: [zaposleniId, deloId] });
        }
        for (const day of emp.days) {
          if (!day.shift) continue;
          const { datum, shift, km, strosek } = day;
          const odhodDatum = shift.crossesMidnight ? addDayImp(datum) : datum;
          await db.execute({ sql: 'INSERT INTO evidenca (zaposleni_id, tip, cas) VALUES (?, ?, ?)', args: [zaposleniId, 'PRIHOD', `${datum} ${shift.start}:00`] });
          await db.execute({ sql: 'INSERT INTO evidenca (zaposleni_id, tip, cas) VALUES (?, ?, ?)', args: [zaposleniId, 'ODHOD', `${odhodDatum} ${shift.end}:00`] });
          evidencCount++;
          if (km || strosek) {
            await db.execute({ sql: 'INSERT OR REPLACE INTO kilometrina (zaposleni_id, datum, km, strosek) VALUES (?, ?, ?, ?)', args: [zaposleniId, datum, km || 0, strosek || 0] });
          }
        }
        uvozenih++;
      }

      // Shrani tekst v bazo za naslednje nalaganje textarea
      await db.execute({ sql: `INSERT OR REPLACE INTO config (kljuc, vrednost) VALUES ('vnos_zaposleni_txt', ?)`, args: [txt] });

      res.json({ ok: true, uvozenih, evidencCount, sporocilo: `Uvoženo ${uvozenih} zaposlenih (${evidencCount} izmen).` });
    } catch (e) {
      console.error(e);
      res.status(500).json({ napaka: e.message });
    }
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
