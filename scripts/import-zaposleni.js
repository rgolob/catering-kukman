'use strict';

/**
 * Uvozni skript — brisanje starih zaposlenih in uvoz novih iz vnos-zaposleni.txt
 * Zaženi: node scripts/import-zaposleni.js
 */

const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const YEAR = '2026';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:./data/prisotnost.db',
  authToken: process.env.TURSO_AUTH_TOKEN || undefined
});

function parseDatum(ddmm) {
  const [dd, mm] = ddmm.split('.');
  return `${YEAR}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function addDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function parseShiftLine(line) {
  const m = line.match(/^(\d{2}\.\d{2})\s+(.+)$/);
  if (!m) return null;
  const datum = parseDatum(m[1]);
  const rest = m[2].trim();
  if (rest === '-') return { datum, shift: null, km: null };

  // Format: -HH:MM-HH:MM [notes]
  const tm = rest.match(/^-(\d{2}:\d{2})-(\d{2}:\d{2})\s*(.*)$/);
  if (!tm) return { datum, shift: null, km: null };

  const [, start, end, notes] = tm;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const crossesMidnight = (eh * 60 + em) < (sh * 60 + sm);

  const kmM = (notes || '').match(/(\d+)\s*km/i);
  const km = kmM ? parseInt(kmM[1]) : null;

  return { datum, shift: { start, end, crossesMidnight }, km };
}

function capitalizeFirst(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseFile(txt) {
  const blocks = txt.split(/\n[ \t]*\n/).filter(b => b.trim());
  const employees = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
    if (!lines.length) continue;

    const parts = lines[0].split('|').map(s => s.trim());
    if (parts.length < 3) continue;

    const [ime, delaStr, pin] = parts;
    const dela = delaStr.split(',')
      .map(s => capitalizeFirst(s.trim()));

    const days = [];
    for (const line of lines.slice(1)) {
      const parsed = parseShiftLine(line);
      if (parsed) days.push(parsed);
    }

    employees.push({ ime: ime.trim(), dela, pin: pin.trim(), days });
  }

  return employees;
}

async function main() {
  const txtPath = path.join(__dirname, '../vnos-zaposleni.txt');
  const txt = fs.readFileSync(txtPath, 'utf8');
  const employees = parseFile(txt);

  console.log(`Uvažam ${employees.length} zaposlenih...`);

  // 0. Zagotovi tabele (v primeru, da app še ni zagnal ensureDb)
  await db.batch([
    { sql: `CREATE TABLE IF NOT EXISTS zaposleni_dela (zaposleni_id INTEGER NOT NULL, delo_id INTEGER NOT NULL, PRIMARY KEY (zaposleni_id, delo_id))`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS kilometrina (id INTEGER PRIMARY KEY AUTOINCREMENT, zaposleni_id INTEGER NOT NULL, datum TEXT NOT NULL, km REAL NOT NULL, UNIQUE(zaposleni_id, datum))`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS evidenca_razporeditev (id INTEGER PRIMARY KEY AUTOINCREMENT, zaposleni_id INTEGER NOT NULL, datum TEXT NOT NULL, delo_id INTEGER NOT NULL, cas_od TEXT NOT NULL, cas_do TEXT NOT NULL)`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS zahtevki (id INTEGER PRIMARY KEY AUTOINCREMENT, zaposleni_id INTEGER NOT NULL, tip TEXT NOT NULL, cas_zahtevka TEXT NOT NULL, opomba TEXT, status TEXT NOT NULL DEFAULT 'CAKA', ustvarjen TEXT NOT NULL)`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS stimulacija (id INTEGER PRIMARY KEY AUTOINCREMENT, zaposleni_id INTEGER NOT NULL, mesec TEXT NOT NULL, znesek REAL NOT NULL DEFAULT 0, opomba TEXT)`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS dela (id INTEGER PRIMARY KEY AUTOINCREMENT, naziv TEXT NOT NULL UNIQUE, urna_postavka REAL NOT NULL DEFAULT 0)`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS zaposleni (id INTEGER PRIMARY KEY AUTOINCREMENT, ime TEXT NOT NULL UNIQUE, aktiven INTEGER NOT NULL DEFAULT 1, pin TEXT, pin_setup_required INTEGER DEFAULT 0, urna_postavka REAL DEFAULT 0, privzeto_delo_id INTEGER)`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS evidenca (id INTEGER PRIMARY KEY AUTOINCREMENT, zaposleni_id INTEGER NOT NULL, tip TEXT NOT NULL, cas DATETIME NOT NULL, naknadno INTEGER DEFAULT 0, delo_id INTEGER)`, args: [] },
    // Seed work types
    { sql: "INSERT OR IGNORE INTO dela (naziv, urna_postavka) VALUES ('Pomivalec', 9)", args: [] },
    { sql: "INSERT OR IGNORE INTO dela (naziv, urna_postavka) VALUES ('Priprava', 10)", args: [] },
    { sql: "INSERT OR IGNORE INTO dela (naziv, urna_postavka) VALUES ('Organizator', 11)", args: [] },
    { sql: "INSERT OR IGNORE INTO dela (naziv, urna_postavka) VALUES ('Teren', 11)", args: [] },
    { sql: "INSERT OR IGNORE INTO dela (naziv, urna_postavka) VALUES ('Koordinator', 12)", args: [] },
    { sql: "INSERT OR IGNORE INTO dela (naziv, urna_postavka) VALUES ('Praktikant', 4)", args: [] },
    { sql: "INSERT OR IGNORE INTO dela (naziv, urna_postavka) VALUES ('Pripravnik', 2)", args: [] },
    // Počisti napačno dodane tipe
    { sql: "DELETE FROM zaposleni_dela WHERE delo_id IN (SELECT id FROM dela WHERE naziv IN ('Strežba','Kuhinja'))", args: [] },
    { sql: "DELETE FROM dela WHERE naziv IN ('Strežba','Kuhinja')", args: [] },
  ], 'write');

  // 1. Pobriši stare podatke
  await db.batch([
    { sql: 'DELETE FROM zaposleni_dela', args: [] },
    { sql: 'DELETE FROM kilometrina', args: [] },
    { sql: 'DELETE FROM evidenca_razporeditev', args: [] },
    { sql: 'DELETE FROM evidenca', args: [] },
    { sql: 'DELETE FROM zahtevki', args: [] },
    { sql: 'DELETE FROM stimulacija', args: [] },
    { sql: 'DELETE FROM zaposleni', args: [] },
  ], 'write');
  console.log('Stari zaposleni pobrisani.');

  // 2. Naloži tipi dela
  const { rows: delaRows } = await db.execute('SELECT id, naziv FROM dela');
  const delaMap = new Map(delaRows.map(d => [d.naziv, Number(d.id)]));

  // 3. Uvozi vsakega zaposlenega
  for (const emp of employees) {
    const privzetoDeloNaziv = emp.dela[0];
    const privzetoDeloId = delaMap.get(privzetoDeloNaziv) || null;

    if (privzetoDeloNaziv && !privzetoDeloId) {
      console.warn(`  OPOZORILO: Neznano delo "${privzetoDeloNaziv}" za ${emp.ime}`);
    }

    // Vstavi zaposlenega
    const r = await db.execute({
      sql: 'INSERT INTO zaposleni (ime, pin, privzeto_delo_id, pin_setup_required) VALUES (?, ?, ?, 0)',
      args: [emp.ime, emp.pin, privzetoDeloId]
    });
    const zaposleniId = Number(r.lastInsertRowid);

    // Vstavi dovoljene tipe dela (zaposleni_dela)
    for (const deloNaziv of emp.dela) {
      const deloId = delaMap.get(deloNaziv);
      if (!deloId) { console.warn(`  OPOZORILO: Preskačem neznano delo "${deloNaziv}" za ${emp.ime}`); continue; }
      await db.execute({
        sql: 'INSERT OR IGNORE INTO zaposleni_dela (zaposleni_id, delo_id) VALUES (?, ?)',
        args: [zaposleniId, deloId]
      });
    }

    // Vstavi prisotnosti
    let evidencaCount = 0;
    for (const day of emp.days) {
      if (!day.shift) continue;
      const { datum, shift, km } = day;
      const odhodDatum = shift.crossesMidnight ? addDay(datum) : datum;

      await db.execute({
        sql: 'INSERT INTO evidenca (zaposleni_id, tip, cas) VALUES (?, ?, ?)',
        args: [zaposleniId, 'PRIHOD', `${datum} ${shift.start}:00`]
      });
      await db.execute({
        sql: 'INSERT INTO evidenca (zaposleni_id, tip, cas) VALUES (?, ?, ?)',
        args: [zaposleniId, 'ODHOD', `${odhodDatum} ${shift.end}:00`]
      });
      evidencaCount++;

      // Vstavi km
      if (km) {
        await db.execute({
          sql: 'INSERT OR REPLACE INTO kilometrina (zaposleni_id, datum, km) VALUES (?, ?, ?)',
          args: [zaposleniId, datum, km]
        });
      }
    }

    console.log(`  ✓ ${emp.ime} (${emp.dela.join(', ')}) — ${evidencaCount} izmen`);
  }

  console.log('\nUvoz zaključen.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
