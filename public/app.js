let izbraniZaposleni = null;
let izbraniTip = null;
let dialogPin = '';

// State for the "additional work" overlay after ODHOD
let odhodZaposleniId = null;
let odhodPin = null;
let odhodDatum = null;
let odhodDela = [];

// Ura v headerju
function posodobiUro() {
  const zdaj = new Date();
  const ura = zdaj.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('ura').textContent = ura;
}
setInterval(posodobiUro, 1000);
posodobiUro();

// Pretvori ms v HH:MM:SS
function formatPretecenCas(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Vsako sekundo posodobi čas od prihoda na vseh karticah
function posodobiPretecenCas() {
  const zdaj = Date.now();
  document.querySelectorAll('.btn-elapsed[data-prihod]').forEach(el => {
    const prihod = new Date(el.dataset.prihod).getTime();
    el.textContent = formatPretecenCas(zdaj - prihod);
  });
}
setInterval(posodobiPretecenCas, 1000);

// Zgradi HTML za kartico zaposlenega
function karticaHtml(ime, jePrisoten, zadnji_prihod) {
  let html = `<span class="btn-ime">${ime}</span>`;
  if (jePrisoten && zadnji_prihod) {
    const prihod = new Date(zadnji_prihod);
    const uraStr = prihod.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
    html += `<span class="btn-prihod">&#9679; od ${uraStr}</span>`;
    html += `<span class="btn-elapsed" data-prihod="${zadnji_prihod}">00:00:00</span>`;
  } else if (!jePrisoten && zadnji_prihod !== undefined) {
    html += `<span class="btn-status-odsoten">&#9675; Odsoten</span>`;
  }
  return html;
}

// Naloži zaposlene in njihove statuse
async function naloziZaposlene() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const statusi = await res.json();
    if (!Array.isArray(statusi)) return;

    const grid = document.getElementById('zaposleni-grid');
    grid.innerHTML = '';

    statusi.forEach(z => {
      const jePrisoten = z.zadnji_tip === 'PRIHOD';
      const btn = document.createElement('button');
      btn.className = 'zaposleni-btn ' + (z.zadnji_tip === null ? '' : jePrisoten ? 'prisoten' : 'odsoten');
      btn.dataset.id = z.id;
      btn.dataset.ime = z.ime;
      btn.dataset.prisoten = jePrisoten ? '1' : '0';
      btn.innerHTML = karticaHtml(z.ime, jePrisoten, z.zadnji_prihod);
      btn.addEventListener('click', () => odpriDialog(z.id, z.ime, jePrisoten));
      grid.appendChild(btn);
    });

    posodobiPretecenCas();
  } catch (e) { console.error('naloziZaposlene:', e); }
}

// Naloži današnjo evidenco
async function naloziEvidenco() {
  try {
    const res = await fetch('/api/danes');
    if (!res.ok) return;
    const zapisi = await res.json();
    if (!Array.isArray(zapisi)) return;

    const list = document.getElementById('evidenca-list');
    if (zapisi.length === 0) {
      list.innerHTML = '<div class="evidenca-prazno">Še ni nobenih zapisov za danes.</div>';
      return;
    }

    list.innerHTML = zapisi.map(z => {
      const cas = new Date(z.cas).toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="evidenca-zapis">
          <span class="tip-pill ${z.tip}">${z.tip === 'PRIHOD' ? 'Prihod' : 'Odhod'}</span>
          <span class="ev-ime">${z.ime}</span>
          <span class="ev-cas">${cas}</span>
        </div>
      `;
    }).join('');
  } catch (e) { console.error('naloziEvidenco:', e); }
}

// ── Dialog PIN logika ──────────────────────────────────────────────────────────

function posodobiDialogPin() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('dp' + i);
    dot.classList.toggle('vnesen', i < dialogPin.length);
    dot.classList.remove('napaka-anim');
  }
}

function dodajDialogCifro(c) {
  if (dialogPin.length >= 4) return;
  document.getElementById('dialog-pin-napaka').textContent = '';
  dialogPin += c;
  posodobiDialogPin();
  if (dialogPin.length === 4) potrdiZapis();
}

function brisiDialogPin() {
  if (dialogPin.length === 0) return;
  dialogPin = dialogPin.slice(0, -1);
  posodobiDialogPin();
  document.getElementById('dialog-pin-napaka').textContent = '';
}

function resetDialogPin() {
  dialogPin = '';
  posodobiDialogPin();
  document.getElementById('dialog-pin-napaka').textContent = '';
}

function prikaziPinNapako(sporocilo) {
  const prikaz = document.getElementById('dialog-pin-prikaz');
  prikaz.classList.remove('tresenje');
  void prikaz.offsetWidth;
  prikaz.classList.add('tresenje');
  for (let i = 0; i < 4; i++) {
    document.getElementById('dp' + i).classList.add('napaka-anim');
  }
  document.getElementById('dialog-pin-napaka').textContent = sporocilo;
  dialogPin = '';
  setTimeout(() => {
    posodobiDialogPin();
    document.getElementById('dialog-pin-napaka').textContent = '';
  }, 800);
}

// Odpri potrditveni dialog
function odpriDialog(id, ime, jePrisoten) {
  izbraniZaposleni = id;
  izbraniTip = jePrisoten ? 'ODHOD' : 'PRIHOD';
  resetDialogPin();

  const badge = document.getElementById('dialog-tip-badge');
  badge.textContent = izbraniTip === 'PRIHOD' ? 'Prihod' : 'Odhod';
  badge.className = 'tip-badge ' + izbraniTip;

  document.getElementById('dialog-ime').textContent = ime;

  const zdaj = new Date();
  document.getElementById('dialog-cas').textContent = zdaj.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });

  document.getElementById('dialog-vprasanje').textContent = 'Vnesite vaš PIN za potrditev';

  document.getElementById('overlay').classList.remove('hidden');
}

// Zapri dialog
function zapriDialog() {
  document.getElementById('overlay').classList.add('hidden');
  resetDialogPin();
  izbraniZaposleni = null;
  izbraniTip = null;
}

// Takoj posodobi kartico po potrditvi
function posodobiKarticoTakoj(id, tip, cas) {
  const btn = document.querySelector(`[data-id="${id}"]`);
  if (!btn) return;
  const ime = btn.dataset.ime;

  if (tip === 'PRIHOD') {
    btn.className = 'zaposleni-btn prisoten';
    btn.innerHTML = karticaHtml(ime, true, cas.toISOString());
  } else {
    btn.className = 'zaposleni-btn odsoten';
    btn.innerHTML = karticaHtml(ime, false, null);
  }
  btn.dataset.prisoten = tip === 'PRIHOD' ? '1' : '0';
  posodobiPretecenCas();
}

// Potrdi zapis (kliče se samodejno po 4 vnesenih cifrach)
async function potrdiZapis() {
  if (!izbraniZaposleni || !izbraniTip || dialogPin.length !== 4) return;

  const pinZaPoslati = dialogPin;

  try {
    const res = await fetch('/api/belezi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zaposleni_id: izbraniZaposleni, tip: izbraniTip, pin: pinZaPoslati })
    });

    if (res.status === 401) {
      prikaziPinNapako('Napačen PIN');
      return;
    }

    const zapis = await res.json();
    if (!res.ok) {
      prikaziPinNapako(zapis.napaka || 'Napaka');
      return;
    }

    // Save before zapriDialog() resets them
    const tipZaDodatno = izbraniTip;
    const idZaDodatno = izbraniZaposleni;
    const pinZaDodatno = pinZaPoslati;

    // Takoj posodobi kartico
    posodobiKarticoTakoj(izbraniZaposleni, izbraniTip, new Date(zapis.cas));
    zapriDialog();
    prikaziToast(zapis.ime, tipZaDodatno);

    if (tipZaDodatno === 'ODHOD' && zapis.privzetoDelo && zapis.ostala_dela?.length > 0) {
      prikaziDodatnoDeloOverlay(idZaDodatno, pinZaDodatno, String(zapis.cas).slice(0, 10), zapis.privzetoDelo, zapis.ostala_dela);
    }

    naloziZaposlene();
    naloziEvidenco();
  } catch (e) {
    console.error('Napaka:', e);
    prikaziPinNapako('Napaka pri povezavi');
  }
}

// Toast obvestilo
function prikaziToast(ime, tip) {
  const toast = document.getElementById('toast');
  toast.textContent = tip === 'PRIHOD' ? `✓ ${ime} — prihod zabeležen` : `✓ ${ime} — odhod zabeležen`;
  toast.className = 'toast ' + tip.toLowerCase();
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ── Event listenerji ───────────────────────────────────────────────────────────

document.querySelectorAll('.dialog-tipka[data-digit]').forEach(btn => {
  btn.addEventListener('click', () => dodajDialogCifro(btn.dataset.digit));
});
document.getElementById('dialog-btn-brisi').addEventListener('click', brisiDialogPin);
document.getElementById('btn-preklic').addEventListener('click', zapriDialog);
document.getElementById('overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('overlay')) zapriDialog();
});

// Tipkovnica za PIN v dialogu
document.addEventListener('keydown', e => {
  if (document.getElementById('overlay').classList.contains('hidden')) return;
  if (e.key >= '0' && e.key <= '9') dodajDialogCifro(e.key);
  else if (e.key === 'Backspace') brisiDialogPin();
  else if (e.key === 'Escape') zapriDialog();
});

// ── Dodatno delo overlay ───────────────────────────────────────────────────────

function prikaziDodatnoDeloOverlay(zaposleniId, pin, datum, privzetoDelo, ostala_dela) {
  odhodZaposleniId = zaposleniId;
  odhodPin = pin;
  odhodDatum = datum;
  odhodDela = ostala_dela;

  const sel = document.getElementById('dodatno-delo-select');
  sel.innerHTML = ostala_dela.map(d =>
    `<option value="${d.id}">${d.naziv} (€${parseFloat(d.urna_postavka).toFixed(2)}/h)</option>`
  ).join('');

  document.getElementById('dodatno-od').value = '';
  document.getElementById('dodatno-do').value = '';
  document.getElementById('dodatno-segmenti').innerHTML = '';
  document.getElementById('dodatno-napaka').textContent = '';
  document.getElementById('dodatno-podnaslov').textContent =
    `Odhod zabeležen. Ste delali katero drugo delo poleg ${privzetoDelo.naziv}?`;

  document.getElementById('dodatno-overlay').classList.remove('hidden');
}

async function dodajSegment() {
  const deloId = document.getElementById('dodatno-delo-select').value;
  const casOd = document.getElementById('dodatno-od').value;
  const casDo = document.getElementById('dodatno-do').value;
  const napaka = document.getElementById('dodatno-napaka');

  if (!casOd || !casDo) { napaka.textContent = 'Vnesite čas od in do.'; return; }
  if (casOd >= casDo) { napaka.textContent = 'Čas "od" mora biti pred "do".'; return; }
  napaka.textContent = '';

  const res = await fetch('/api/razporeditev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zaposleniId: odhodZaposleniId, pin: odhodPin, datum: odhodDatum, deloId, casOd, casDo })
  });

  if (res.ok) {
    const deloNaziv = odhodDela.find(d => String(d.id) === String(deloId))?.naziv || '?';
    const seg = document.getElementById('dodatno-segmenti');
    const div = document.createElement('div');
    div.className = 'dodatno-segment';
    div.textContent = `✓ ${deloNaziv}: ${casOd}–${casDo}`;
    seg.appendChild(div);
    document.getElementById('dodatno-od').value = '';
    document.getElementById('dodatno-do').value = '';
  } else {
    const d = await res.json();
    napaka.textContent = d.napaka || 'Napaka pri shranjevanju';
  }
}

document.getElementById('btn-dodaj-segment').addEventListener('click', dodajSegment);
document.getElementById('btn-dodatno-zakljuci').addEventListener('click', () => {
  document.getElementById('dodatno-overlay').classList.add('hidden');
  odhodZaposleniId = null;
  odhodPin = null;
});

async function naloziQR() {
  try {
    const res = await fetch('/api/qr-info');
    const d = await res.json();
    if (d.qrBase64) {
      document.getElementById('qr-tablica-img').src = 'data:image/png;base64,' + d.qrBase64;
    }
  } catch (_) {}
}

// Začetno nalaganje in osvežitev vsako minuto
naloziZaposlene();
naloziEvidenco();
naloziQR();
// QR se obnovi ob polnoči — preverimo vsako uro
setInterval(() => { naloziZaposlene(); naloziEvidenco(); }, 60_000);
setInterval(naloziQR, 3_600_000);
