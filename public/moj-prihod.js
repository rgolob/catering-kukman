const LS_KEY = 'qr_zaposleni';

const MESECI = ['januar','februar','marec','april','maj','junij',
                'julij','avgust','september','oktober','november','december'];
const DNEVI  = ['nedelja','ponedeljek','torek','sreda','četrtek','petek','sobota'];

function formatDatum() {
  const d = new Date();
  return `${DNEVI[d.getDay()]}, ${d.getDate()}. ${MESECI[d.getMonth()]} ${d.getFullYear()}`;
}
document.getElementById('mp-datum').textContent = formatDatum();

let aktivniToken = '';
let dodatnoZaposleniId = null;
let dodatnoDatum = '';
let dodatnoOstala = [];

async function init() {
  const shranjeno = localStorage.getItem(LS_KEY);
  if (!shranjeno) { prikaziNapotilo(); return; }

  let id, ime, shrDatum;
  try {
    ({ id, ime, datum: shrDatum } = JSON.parse(shranjeno));
  } catch (_) { localStorage.removeItem(LS_KEY); prikaziNapotilo(); return; }

  const infoRes = await fetch('/api/qr-info');
  const { token, datum: danes } = await infoRes.json();

  if (shrDatum !== danes) {
    localStorage.removeItem(LS_KEY);
    prikaziNapotilo();
    return;
  }

  aktivniToken = token;
  await prikaziOsebo(id, ime);
}

async function prikaziOsebo(id, ime) {
  document.getElementById('mp-napotilo').classList.add('hidden');
  document.getElementById('mp-oseba-wrap').classList.remove('hidden');

  const statusRes = await fetch('/api/status');
  const zaposleni = await statusRes.json();
  const oseba = zaposleni.find(z => z.id === id);
  const jePrisoten = oseba?.zadnji_tip === 'PRIHOD';

  document.getElementById('mp-pozdrav').textContent = `Pozdravljeni, ${ime.split(' ')[0]}!`;

  const btn = document.getElementById('mp-akcija-btn');
  btn.textContent = jePrisoten ? 'Odhod ›' : 'Prihod ›';
  btn.className = 'qr-oseba-btn ' + (jePrisoten ? 'odhod' : 'prihod');
  btn.onclick = () => zabelezi(id, ime);
}

async function zabelezi(zaposleniId, ime) {
  document.getElementById('mp-oseba-wrap').classList.add('hidden');

  try {
    const res = await fetch('/api/qr-belezi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zaposleniId, token: aktivniToken })
    });
    const d = await res.json();
    if (!res.ok) { alert(d.napaka || 'Napaka'); init(); return; }

    const tipTxt = d.tip === 'PRIHOD' ? 'Prihod zabeležen ✓' : 'Odhod zabeležen ✓';
    const cas = String(d.cas).slice(11, 16);

    document.getElementById('mp-rez-ime').textContent = d.ime;
    document.getElementById('mp-rez-tip').textContent = tipTxt;
    document.getElementById('mp-rez-cas').textContent = cas;

    const rez = document.getElementById('mp-rezultat');
    document.getElementById('mp-check-ikona').className = 'qr-check ' + (d.tip === 'PRIHOD' ? 'prihod' : 'odhod');
    rez.classList.remove('hidden');

    // Po odhodu ponudi vnos dodatnega dela
    if (d.tip === 'ODHOD' && d.ostala_dela?.length > 0) {
      dodatnoZaposleniId = zaposleniId;
      dodatnoDatum = d.datum;
      dodatnoOstala = d.ostala_dela;
      setTimeout(() => {
        rez.classList.add('hidden');
        prikaziDodatnoDeloOverlay();
      }, 2000);
    } else {
      setTimeout(async () => {
        rez.classList.add('hidden');
        await osvezi();
      }, 3000);
    }
  } catch (_) {
    alert('Napaka pri povezavi');
    init();
  }
}

function prikaziDodatnoDeloOverlay() {
  const select = document.getElementById('mp-dodatno-select');
  select.innerHTML = dodatnoOstala.map(d =>
    `<option value="${d.id}">${d.naziv} (€${parseFloat(d.urna_postavka).toFixed(2)}/h)</option>`
  ).join('');
  document.getElementById('mp-dodatno-napaka').textContent = '';
  document.getElementById('mp-dodatno-segmenti').innerHTML = '';
  document.getElementById('mp-dodatno-overlay').classList.remove('hidden');
}

async function dodajSegment() {
  const napaka = document.getElementById('mp-dodatno-napaka');
  const deloId = Number(document.getElementById('mp-dodatno-select').value);
  const casOd = document.getElementById('mp-dodatno-od').value;
  const casDo = document.getElementById('mp-dodatno-do').value;

  if (!casOd || !casDo) { napaka.textContent = 'Vnesite čas od in do'; return; }
  if (casOd >= casDo) { napaka.textContent = 'Čas "od" mora biti pred "do"'; return; }
  napaka.textContent = '';

  const res = await fetch('/api/qr-razporeditev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zaposleniId: dodatnoZaposleniId, token: aktivniToken, datum: dodatnoDatum, deloId, casOd, casDo })
  });

  if (res.ok) {
    const naziv = document.getElementById('mp-dodatno-select').selectedOptions[0].text;
    const seg = document.createElement('div');
    seg.className = 'dodatno-segment';
    seg.textContent = `${naziv}: ${casOd}–${casDo}`;
    document.getElementById('mp-dodatno-segmenti').appendChild(seg);
    document.getElementById('mp-dodatno-od').value = '';
    document.getElementById('mp-dodatno-do').value = '';
  } else {
    const d = await res.json();
    napaka.textContent = d.napaka || 'Napaka pri shranjevanju';
  }
}

async function osvezi() {
  const shranjeno = localStorage.getItem(LS_KEY);
  if (shranjeno) {
    const { id, ime } = JSON.parse(shranjeno);
    const infoRes = await fetch('/api/qr-info');
    aktivniToken = (await infoRes.json()).token;
    await prikaziOsebo(id, ime);
  } else {
    prikaziNapotilo();
  }
}

function prikaziNapotilo() {
  document.getElementById('mp-oseba-wrap').classList.add('hidden');
  document.getElementById('mp-napotilo').classList.remove('hidden');
}

document.getElementById('mp-nisem-jaz').addEventListener('click', () => {
  localStorage.removeItem(LS_KEY);
  prikaziNapotilo();
});

document.getElementById('mp-btn-dodaj-seg').addEventListener('click', dodajSegment);

document.getElementById('mp-btn-zakljuci').addEventListener('click', async () => {
  document.getElementById('mp-dodatno-overlay').classList.add('hidden');
  await osvezi();
});

init();
