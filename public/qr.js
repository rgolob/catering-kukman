const params = new URLSearchParams(window.location.search);
const token = params.get('t') || '';
const LS_KEY = 'qr_zaposleni';

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
  const { token: veljavni } = await infoRes.json();

  if (!token || token !== veljavni) {
    document.getElementById('qr-napaka').classList.remove('hidden');
    return;
  }

  const shranjeno = localStorage.getItem(LS_KEY);
  if (shranjeno) {
    try {
      const { id, ime, token: shrToken } = JSON.parse(shranjeno);
      // Token se zamenja vsak dan — če se ne ujema, je nov dan → pozabi identiteto
      if (shrToken !== token) {
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
      // Shrani skupaj s tokenom — veljavno samo danes
      localStorage.setItem(LS_KEY, JSON.stringify({ id, ime, token }));
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

  const ime1 = ime.split(' ')[0];
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
    rez.classList.remove('hidden');

    setTimeout(async () => {
      rez.classList.add('hidden');
      const shranjeno = localStorage.getItem(LS_KEY);
      if (shranjeno) {
        const { id, ime: sime } = JSON.parse(shranjeno);
        await prikaziOseboView(id, sime);
      } else {
        await prikaziSeznam();
      }
    }, 3000);
  } catch (_) {
    alert('Napaka pri povezavi');
    init();
  }
}

document.getElementById('qr-nisem-jaz').addEventListener('click', async () => {
  localStorage.removeItem(LS_KEY);
  await prikaziSeznam();
});

init();
