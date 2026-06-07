const params = new URLSearchParams(window.location.search);
const token = params.get('t') || '';

const MESECI = ['januar','februar','marec','april','maj','junij',
                'julij','avgust','september','oktober','november','december'];
const DNEVI  = ['nedelja','ponedeljek','torek','sreda','četrtek','petek','sobota'];

function formatDatum() {
  const d = new Date();
  return `${DNEVI[d.getDay()]}, ${d.getDate()}. ${MESECI[d.getMonth()]} ${d.getFullYear()}`;
}
document.getElementById('qr-datum').textContent = formatDatum();

async function naloziZaposlene() {
  const infoRes = await fetch('/api/qr-info');
  const { token: veljavni } = await infoRes.json();

  if (!token || token !== veljavni) {
    document.getElementById('qr-napaka').classList.remove('hidden');
    document.getElementById('qr-seznam-wrap').style.display = 'none';
    return;
  }

  const statusRes = await fetch('/api/status');
  const zaposleni = await statusRes.json();

  const seznam = document.getElementById('qr-seznam');
  seznam.innerHTML = zaposleni.map(z => {
    const jePrisoten = z.zadnji_tip === 'PRIHOD';
    return `<button class="qr-ime-btn ${jePrisoten ? 'prisoten' : ''}" data-id="${z.id}">
      <span class="qr-btn-ime">${z.ime}</span>
      <span class="qr-btn-akcija">${jePrisoten ? 'Odhod ›' : 'Prihod ›'}</span>
    </button>`;
  }).join('');

  seznam.querySelectorAll('.qr-ime-btn').forEach(btn => {
    btn.addEventListener('click', () => zabelezi(Number(btn.dataset.id)));
  });
}

async function zabelezi(zaposleniId) {
  try {
    const res = await fetch('/api/qr-belezi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zaposleniId, token })
    });
    const d = await res.json();
    if (!res.ok) { alert(d.napaka || 'Napaka'); return; }

    const tipTxt = d.tip === 'PRIHOD' ? 'Prihod zabeležen ✓' : 'Odhod zabeležen ✓';
    const cas = String(d.cas).slice(11, 16);

    document.getElementById('qr-seznam-wrap').style.display = 'none';
    document.getElementById('qr-rez-ime').textContent = d.ime;
    document.getElementById('qr-rez-tip').textContent = tipTxt;
    document.getElementById('qr-rez-cas').textContent = cas;

    const rez = document.getElementById('qr-rezultat');
    const ikona = document.getElementById('qr-check-ikona');
    ikona.className = 'qr-check ' + (d.tip === 'PRIHOD' ? 'prihod' : 'odhod');
    rez.classList.remove('hidden');

    setTimeout(() => {
      rez.classList.add('hidden');
      document.getElementById('qr-seznam-wrap').style.display = '';
      naloziZaposlene();
    }, 3000);
  } catch(_) { alert('Napaka pri povezavi'); }
}

naloziZaposlene();
