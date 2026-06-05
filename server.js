const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Init DB
const db = new DatabaseSync(path.join(__dirname, 'data', 'prisotnost.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS zaposleni (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ime TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS evidenca (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zaposleni_id INTEGER NOT NULL,
    tip TEXT NOT NULL CHECK(tip IN ('PRIHOD', 'ODHOD')),
    cas DATETIME NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (zaposleni_id) REFERENCES zaposleni(id)
  );
`);

// Seed default employees if empty
const count = db.prepare('SELECT COUNT(*) as n FROM zaposleni').get();
if (count.n === 0) {
  const insert = db.prepare('INSERT INTO zaposleni (ime) VALUES (?)');
  ['Ana Novak', 'Bojan Kranjc', 'Maja Horvat', 'Luka Kovač', 'Sara Zupan'].forEach(ime => insert.run(ime));
}

// GET all employees
app.get('/api/zaposleni', (req, res) => {
  const zaposleni = db.prepare('SELECT * FROM zaposleni ORDER BY ime').all();
  res.json(zaposleni);
});

// GET today's records
app.get('/api/danes', (req, res) => {
  const danes = db.prepare(`
    SELECT e.id, z.ime, e.tip, e.cas
    FROM evidenca e
    JOIN zaposleni z ON z.id = e.zaposleni_id
    WHERE date(e.cas) = date('now', 'localtime')
    ORDER BY e.cas DESC
  `).all();
  res.json(danes);
});

// GET last record today for each employee (to determine next action)
app.get('/api/status', (req, res) => {
  const statusi = db.prepare(`
    SELECT z.id, z.ime,
      (SELECT tip FROM evidenca WHERE zaposleni_id = z.id AND date(cas) = date('now', 'localtime') ORDER BY cas DESC LIMIT 1) as zadnji_tip
    FROM zaposleni z
    ORDER BY z.ime
  `).all();
  res.json(statusi);
});

// POST clock in/out
app.post('/api/belezi', (req, res) => {
  const { zaposleni_id, tip } = req.body;
  if (!zaposleni_id || !['PRIHOD', 'ODHOD'].includes(tip)) {
    return res.status(400).json({ napaka: 'Neveljavni podatki' });
  }
  const stmt = db.prepare('INSERT INTO evidenca (zaposleni_id, tip) VALUES (?, ?)');
  const result = stmt.run(zaposleni_id, tip);

  const zapis = db.prepare(`
    SELECT e.id, z.ime, e.tip, e.cas
    FROM evidenca e JOIN zaposleni z ON z.id = e.zaposleni_id
    WHERE e.id = ?
  `).get(result.lastInsertRowid);

  res.json(zapis);
});

// POST add new employee
app.post('/api/zaposleni', (req, res) => {
  const { ime } = req.body;
  if (!ime || !ime.trim()) {
    return res.status(400).json({ napaka: 'Ime je obvezno' });
  }
  try {
    const result = db.prepare('INSERT INTO zaposleni (ime) VALUES (?)').run(ime.trim());
    res.json({ id: result.lastInsertRowid, ime: ime.trim() });
  } catch (e) {
    res.status(409).json({ napaka: 'Zaposleni s tem imenom že obstaja' });
  }
});

// DELETE employee
app.delete('/api/zaposleni/:id', (req, res) => {
  db.prepare('DELETE FROM zaposleni WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Strežnik teče na http://localhost:${PORT}`);
});
