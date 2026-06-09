const params = new URLSearchParams(window.location.search);
const token = params.get('t') || '';
const LS_KEY = 'qr_zaposleni';

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

async function init() {
  const infoRes = await fetch('/api/qr-info');
  const info = await infoRes.json();
  const { token: veljavni, datum: danes } = info;
  danesDatum = danes || '';

  if (!token || token !== veljavni) {
    document.getElementById('qr-napaka').classList.remove('hidden');
    return;
  }

  const shranjeno = localStorage.getItem(LS_KEY);
  if (shranjeno) {
    try {
      const { id, ime, datum: shrDatum } = JSON.parse(shranjeno);
      // Datum se zamenja vsak dan → pozabi identiteto
      if (shrDatum !== danes) {
        localStorage.removeItem(LS_KEY);
        await prikaziSeznam();
      } else {
        await prikaziOseboView(id, ime);
      }
    } catch (_) {
      localStorage.removeItem(LS_KEY);
      await prikaziSeznam();
    }
  } else {
    await prikaziSeznam();
  }
}

async function prikaziSeznam() {
  document.getElementById('qr-oseba-wrap').classList.add('hidden');
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
      const id = Number(btn.dataset.id);
      const ime = btn.dataset.ime;
      // Shrani skupaj z datumom — veljavno samo danes
      localStorage.setItem(LS_KEY, JSON.stringify({ id, ime, datum: danesDatum }));
      zabelezi(id, ime);
    });
  });
}

async function prikaziOseboView(id, ime) {
  document.getElementById('qr-seznam-wrap').classList.add('hidden');
  document.getElementById('qr-oseba-wrap').classList.remove('hidden');

  const statusRes = await fetch('/api/status');
  const zaposleni = await statusRes.json();
  const oseba = zaposleni.find(z => z.id === id);
  const jePrisoten = oseba?.zadnji_tip === 'PRIHOD';

  const imeParts = ime.trim().split(' ');
  const ime1 = imeParts[imeParts.length - 1];
  document.getElementById('qr-oseba-pozdrav').textContent = `Pozdravljeni, ${ime1}!`;

  const btn = document.getElementById('qr-oseba-btn');
  btn.textContent = jePrisoten ? 'Odhod ›' : 'Prihod ›';
  btn.className = 'qr-oseba-btn ' + (jePrisoten ? 'odhod' : 'prihod');
  btn.onclick = () => zabelezi(id, ime);
}

async function zabelezi(zaposleniId, ime) {
  document.getElementById('qr-oseba-wrap').classList.add('hidden');
  document.getElementById('qr-seznam-wrap').classList.add('hidden');

  try {
    const res = await fetch('/api/qr-belezi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zaposleniId, token })
    });
    const d = await res.json();
    if (!res.ok) { alert(d.napaka || 'Napaka'); init(); return; }

    const tipTxt = d.tip === 'PRIHOD' ? 'Prihod zabeležen ✓' : 'Odhod zabeležen ✓';
    const cas = String(d.cas).slice(11, 16);

    document.getElementById('qr-rez-ime').textContent = d.ime;
    document.getElementById('qr-rez-tip').textContent = tipTxt;
    document.getElementById('qr-rez-cas').textContent = cas;

    const rez = document.getElementById('qr-rezultat');
    const ikona = document.getElementById('qr-check-ikona');
    ikona.className = 'qr-check ' + (d.tip === 'PRIHOD' ? 'prihod' : 'odhod');

    // Po prvem PRIHODU pokaži link za shranitev strani
    const link = document.getElementById('qr-rez-link');
    if (d.tip === 'PRIHOD') {
      link.classList.remove('hidden');
    } else {
      link.classList.add('hidden');
    }

    rez.classList.remove('hidden');

    if (d.tip === 'ODHOD') {
      qrDodatnoZaposleniId = zaposleniId;
      qrDodatnoDatum = d.datum;
      qrDodatnoOstala = d.ostala_dela || [];
      setTimeout(() => {
        rez.classList.add('hidden');
        prikaziDodatnoOverlay();
      }, 2000);
    } else {
      setTimeout(async () => {
        rez.classList.add('hidden');
        const shranjeno = localStorage.getItem(LS_KEY);
        if (shranjeno) {
          const { id, ime: sime } = JSON.parse(shranjeno);
          await prikaziOseboView(id, sime);
        } else {
          await prikaziSeznam();
        }
      }, 5000);
    }
  } catch (_) {
    alert('Napaka pri povezavi');
    init();
  }
}

function prikaziDodatnoOverlay() {
  const delaSekcija = document.getElementById('qr-dela-sekcija');
  if (qrDodatnoOstala.length > 0) {
    const select = document.getElementById('qr-dodatno-select');
    select.innerHTML = qrDodatnoOstala.map(d =>
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

async function dodajSegment() {
  const napaka = document.getElementById('qr-dodatno-napaka');
  const deloId = Number(document.getElementById('qr-dodatno-select').value);
  const casOd = document.getElementById('qr-dodatno-od').value;
  const casDo = document.getElementById('qr-dodatno-do').value;
  if (!casOd || !casDo) { napaka.textContent = 'Vnesite čas od in do'; return; }
  if (casOd >= casDo) { napaka.textContent = 'Čas "od" mora biti pred "do"'; return; }
  napaka.textContent = '';
  const res = await fetch('/api/qr-razporeditev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zaposleniId: qrDodatnoZaposleniId, token, datum: qrDodatnoDatum, deloId, casOd, casDo })
  });
  if (res.ok) {
    const naziv = document.getElementById('qr-dodatno-select').selectedOptions[0].text;
    const seg = document.createElement('div');
    seg.className = 'dodatno-segment';
    seg.textContent = `${naziv}: ${casOd}–${casDo}`;
    document.getElementById('qr-dodatno-segmenti').appendChild(seg);
    document.getElementById('qr-dodatno-od').value = '';
    document.getElementById('qr-dodatno-do').value = '';
  } else {
    const d = await res.json();
    napaka.textContent = d.napaka || 'Napaka pri shranjevanju';
  }
}

document.getElementById('qr-btn-dodaj-seg').addEventListener('click', dodajSegment);
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
  await prikaziSeznam();
});

document.getElementById('qr-nisem-jaz').addEventListener('click', async () => {
  localStorage.removeItem(LS_KEY);
  await prikaziSeznam();
});

init();
