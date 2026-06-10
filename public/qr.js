const params = new URLSearchParams(window.location.search);
const token = params.get('t') || '';
const LS_KEY = 'qr_zaposleni';
const QR_COOKIE = 'kukman_qr';

let pinZaposleniId = null;
let pinIme = null;
let pinVnos = '';
let qrDodatnoZaposleniId = null;
let qrDodatnoDatum = '';
let qrDodatnoOstala = [];
let danesDatum = '';

const MESECI = ['januar','februar','marec','april','maj','junij',
                'julij','avgust','september','oktober','november','december'];
const DNEVI  = ['nedelja','ponedeljek','torek','sreda','četrtek','petek','sobota'];

function formatDatum() {
  const d = new Date();
  return `${DNEVI[d.getDay()]}, ${d.getDate()}. ${MESECI[d.getMonth()]} ${d.getFullYear()}`;
}
document.getElementById('qr-datum').textContent = formatDatum();

// ── Cookie helpers ─────────────────────────────────────────────────────────────

function getQrCookie() {
  try {
    const m = document.cookie.match(/(?:^|;\s*)kukman_qr=([^;]+)/);
    return m ? JSON.parse(decodeURIComponent(m[1])) : null;
  } catch (_) { return null; }
}

function setQrCookie(id, ime) {
  const data = encodeURIComponent(JSON.stringify({ id, ime }));
  const exp = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${QR_COOKIE}=${data}; expires=${exp}; path=/; SameSite=Lax`;
}

function clearQrCookie() {
  document.cookie = `${QR_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax`;
  localStorage.removeItem(LS_KEY);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const infoRes = await fetch('/api/qr-info');
  const info = await infoRes.json();
  const { token: veljavni, datum: danes } = info;
  danesDatum = danes || '';

  if (!token || token !== veljavni) {
    document.getElementById('qr-napaka').classList.remove('hidden');
    return;
  }

  const cookie = getQrCookie();
  if (cookie) {
    await prikaziPinView(cookie.id, cookie.ime);
  } else {
    await prikaziSeznam();
  }
}

// ── Name list ─────────────────────────────────────────────────────────────────

async function prikaziSeznam() {
  document.getElementById('qr-pin-wrap').classList.add('hidden');
  document.getElementById('qr-seznam-wrap').classList.remove('hidden');

  const statusRes = await fetch('/api/status');
  const zaposleni = await statusRes.json();

  const seznam = document.getElementById('qr-seznam');
  seznam.innerHTML = zaposleni.map(z => {
    const jePrisoten = z.zadnji_tip === 'PRIHOD';
    return `<button class="qr-ime-btn ${jePrisoten ? 'prisoten' : ''}" data-id="${z.id}" data-ime="${z.ime}">
      <span class="qr-btn-ime">${z.ime}</span>
      <span class="qr-btn-akcija">${jePrisoten ? 'Odhod ›' : 'Prihod ›'}</span>
    </button>`;
  }).join('');

  seznam.querySelectorAll('.qr-ime-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('qr-seznam-wrap').classList.add('hidden');
      prikaziPinView(Number(btn.dataset.id), btn.dataset.ime);
    });
  });
}

// ── PIN view ──────────────────────────────────────────────────────────────────

async function prikaziPinView(id, ime) {
  pinZaposleniId = id;
  pinIme = ime;
  pinVnos = '';

  const statusRes = await fetch('/api/status');
  const zaposleni = await statusRes.json();
  const oseba = zaposleni.find(z => z.id === id);
  const jePrisoten = oseba?.zadnji_tip === 'PRIHOD';

  const ime1 = ime.trim().split(' ').pop();
  document.getElementById('qr-pin-pozdrav').textContent = `Pozdravljeni, ${ime1}!`;
  document.getElementById('qr-pin-akcija').textContent = jePrisoten
    ? 'Vnesite PIN za odhod' : 'Vnesite PIN za prihod';

  posodobiQrPin();
  document.getElementById('qr-pin-napaka').textContent = '';
  document.getElementById('qr-pin-wrap').classList.remove('hidden');
}

// ── PIN input ─────────────────────────────────────────────────────────────────

function posodobiQrPin() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('qr-dp' + i);
    dot.classList.toggle('vnesen', i < pinVnos.length);
    dot.classList.remove('napaka-anim');
  }
}

function dodajQrPinCifro(c) {
  if (pinVnos.length >= 4) return;
  document.getElementById('qr-pin-napaka').textContent = '';
  pinVnos += c;
  posodobiQrPin();
  if (pinVnos.length === 4) potrdiQrPin();
}

function brisiQrPin() {
  if (!pinVnos.length) return;
  pinVnos = pinVnos.slice(0, -1);
  posodobiQrPin();
  document.getElementById('qr-pin-napaka').textContent = '';
}

function prikaziQrPinNapako(sporocilo) {
  const row = document.getElementById('qr-pin-dots-row');
  row.classList.remove('tresenje');
  void row.offsetWidth;
  row.classList.add('tresenje');
  for (let i = 0; i < 4; i++) document.getElementById('qr-dp' + i).classList.add('napaka-anim');
  document.getElementById('qr-pin-napaka').textContent = sporocilo;
  pinVnos = '';
  setTimeout(() => {
    posodobiQrPin();
    document.getElementById('qr-pin-napaka').textContent = '';
  }, 800);
}

// ── Record ────────────────────────────────────────────────────────────────────

async function potrdiQrPin() {
  const pin = pinVnos;
  try {
    const res = await fetch('/api/qr-belezi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zaposleniId: pinZaposleniId, token, pin })
    });
    const d = await res.json();

    if (!res.ok) {
      prikaziQrPinNapako(d.napaka?.includes('PIN') ? 'Napačen PIN' : (d.napaka || 'Napaka'));
      return;
    }

    setQrCookie(pinZaposleniId, pinIme);
    localStorage.setItem(LS_KEY, JSON.stringify({ id: pinZaposleniId, ime: pinIme, datum: danesDatum }));

    document.getElementById('qr-pin-wrap').classList.add('hidden');

    document.getElementById('qr-rez-ime').textContent = d.ime;
    document.getElementById('qr-rez-tip').textContent = d.tip === 'PRIHOD' ? 'Prihod zabeležen ✓' : 'Odhod zabeležen ✓';
    document.getElementById('qr-rez-cas').textContent = String(d.cas).slice(11, 16);

    const ikona = document.getElementById('qr-check-ikona');
    ikona.className = 'qr-check ' + (d.tip === 'PRIHOD' ? 'prihod' : 'odhod');
    document.getElementById('qr-rez-link').classList.toggle('hidden', d.tip !== 'PRIHOD');

    const rez = document.getElementById('qr-rezultat');
    rez.classList.remove('hidden');

    if (d.tip === 'ODHOD') {
      qrDodatnoZaposleniId = pinZaposleniId;
      qrDodatnoDatum = d.datum;
      qrDodatnoOstala = d.ostala_dela || [];
      setTimeout(() => {
        rez.classList.add('hidden');
        prikaziDodatnoOverlay();
      }, 2000);
    } else {
      setTimeout(async () => {
        rez.classList.add('hidden');
        await prikaziPinView(pinZaposleniId, pinIme);
      }, 3000);
    }
  } catch (_) {
    prikaziQrPinNapako('Napaka pri povezavi');
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

document.querySelectorAll('.dialog-tipka[data-qr-digit]').forEach(btn => {
  btn.addEventListener('click', () => dodajQrPinCifro(btn.dataset.qrDigit));
});
document.getElementById('qr-pin-brisi').addEventListener('click', brisiQrPin);
document.getElementById('qr-nisem-jaz').addEventListener('click', async () => {
  clearQrCookie();
  document.getElementById('qr-pin-wrap').classList.add('hidden');
  await prikaziSeznam();
});

// ── ODHOD overlay ─────────────────────────────────────────────────────────────

function formatirajUrQR(min) {
  const u = Math.floor(min / 60), m = Math.round(min % 60);
  return m > 0 ? `${u}u ${m}m` : `${u}u`;
}

function prikaziDodatnoOverlay() {
  const delaSekcija = document.getElementById('qr-dela-sekcija');
  if (qrDodatnoOstala.length > 0) {
    document.getElementById('qr-dodatno-select').innerHTML = qrDodatnoOstala.map(d =>
      `<option value="${d.id}">${d.naziv} (€${parseFloat(d.urna_postavka).toFixed(2)}/h)</option>`
    ).join('');
    document.getElementById('qr-dodatno-napaka').textContent = '';
    document.getElementById('qr-dodatno-segmenti').innerHTML = '';
    delaSekcija.classList.remove('hidden');
  } else {
    delaSekcija.classList.add('hidden');
  }
  document.getElementById('qr-km-input').value = '';
  document.getElementById('qr-strosek-input').value = '';
  document.getElementById('qr-dodatno-overlay').classList.remove('hidden');
}

async function posljiSegment(deloId, body) {
  const napaka = document.getElementById('qr-dodatno-napaka');
  napaka.textContent = '';
  const res = await fetch('/api/qr-razporeditev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zaposleniId: qrDodatnoZaposleniId, token, datum: qrDodatnoDatum, deloId, ...body })
  });
  if (res.ok) {
    const d = await res.json();
    const naziv = document.getElementById('qr-dodatno-select').selectedOptions[0].text.split(' (')[0];
    const seg = document.createElement('div');
    seg.className = 'dodatno-segment';
    seg.textContent = body.celDan ? `${naziv} · cel dan` : `${naziv} · ${formatirajUrQR(d.trajanjeMinut || body.trajanje * 60)}`;
    document.getElementById('qr-dodatno-segmenti').appendChild(seg);
    document.getElementById('qr-dodatno-trajanje').value = '';
  } else {
    const d = await res.json();
    napaka.textContent = d.napaka || 'Napaka pri shranjevanju';
  }
}

document.getElementById('qr-btn-dodaj-seg').addEventListener('click', () => {
  const deloId = Number(document.getElementById('qr-dodatno-select').value);
  const trajanje = parseFloat(document.getElementById('qr-dodatno-trajanje').value);
  const napaka = document.getElementById('qr-dodatno-napaka');
  if (!trajanje || trajanje <= 0) { napaka.textContent = 'Vnesite trajanje v urah'; return; }
  posljiSegment(deloId, { trajanje });
});

document.getElementById('qr-btn-cel-dan').addEventListener('click', () => {
  posljiSegment(Number(document.getElementById('qr-dodatno-select').value), { celDan: true });
});

document.getElementById('qr-btn-zakljuci').addEventListener('click', async () => {
  const km = parseFloat(document.getElementById('qr-km-input').value) || 0;
  const strosek = parseFloat(document.getElementById('qr-strosek-input').value) || 0;
  if (km > 0 || strosek > 0) {
    try {
      await fetch('/api/qr-kilometrina', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zaposleniId: qrDodatnoZaposleniId, token, datum: qrDodatnoDatum, km, strosek })
      });
    } catch (_) {}
  }
  document.getElementById('qr-dodatno-overlay').classList.add('hidden');
  await prikaziPinView(qrDodatnoZaposleniId, pinIme);
});

init();
