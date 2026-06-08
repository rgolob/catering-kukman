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

    setTimeout(async () => {
      rez.classList.add('hidden');
      const shranjeno = localStorage.getItem(LS_KEY);
      if (shranjeno) {
        const { id, ime: sime } = JSON.parse(shranjeno);
        // Osveži token pred prikazom
        const infoRes = await fetch('/api/qr-info');
        aktivniToken = (await infoRes.json()).token;
        await prikaziOsebo(id, sime);
      } else {
        prikaziNapotilo();
      }
    }, 3000);
  } catch (_) {
    alert('Napaka pri povezavi');
    init();
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

init();
