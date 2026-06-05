const MESECI = ['Januar','Februar','Marec','April','Maj','Junij',
                 'Julij','Avgust','September','Oktober','November','December'];
const DNEVI  = ['Ned','Pon','Tor','Sre','Čet','Pet','Sob'];

let prikazanoLeto, prikazaniMesec;

function formatirajUre(minute) {
  if (minute <= 0) return '0u 0m';
  const u = Math.floor(minute / 60);
  const m = minute % 60;
  return m === 0 ? `${u}u` : `${u}u ${m}m`;
}

function formatirajCas(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
}

function formatirajDatum(datum) {
  const d = new Date(datum + 'T00:00:00');
  const dan = d.getDate();
  const ime = DNEVI[d.getDay()];
  return `${ime} ${dan}.`;
}

async function naloziInfo() {
  const res = await fetch('/api/moj-cas/info');
  if (res.status === 401) { window.location.href = '/pin'; return; }
  const data = await res.json();

  document.getElementById('pozdrav').textContent = data.ime;

  const status = data.statusDanes;
  const statusEl = document.getElementById('status-danes');
  if (status === 'PRIHOD') {
    statusEl.innerHTML = '<span style="color:#9ae6b4">● Prisoten danes</span>';
  } else if (status === 'ODHOD') {
    statusEl.innerHTML = '<span style="color:#fbd38d">○ Odsoten danes</span>';
  } else {
    statusEl.innerHTML = '<span style="color:#b2b2b2">○ Ni vnosa danes</span>';
  }
}

async function naloziMesec() {
  const res = await fetch(`/api/moj-cas/mesec?leto=${prikazanoLeto}&mesec=${prikazaniMesec}`);
  const data = await res.json();

  document.getElementById('mesec-naslov').textContent =
    `${MESECI[prikazaniMesec - 1]} ${prikazanoLeto}`;

  const tbody = document.getElementById('tbody-dni');
  const prazno = document.getElementById('mesec-prazno');

  if (!data.dnevi || data.dnevi.length === 0) {
    tbody.innerHTML = '';
    prazno.style.display = 'block';
    document.getElementById('skupaj-ure').textContent = '0u';
    return;
  }
  prazno.style.display = 'none';

  const skupajMinut = data.dnevi.reduce((s, d) => s + d.minute, 0);
  document.getElementById('skupaj-ure').textContent = formatirajUre(skupajMinut);

  const danasnji = new Date().toISOString().slice(0, 10);

  tbody.innerHTML = data.dnevi.map(d => {
    const jeDanes = d.datum === danasnji;
    let ureStr, ureClass;
    if (d.nepopoln) {
      ureStr = 'nepopoln';
      ureClass = 'nepopoln';
    } else if (d.vTeku) {
      ureStr = formatirajUre(d.minute) + ' ▶';
      ureClass = 'v-teku';
    } else {
      ureStr = formatirajUre(d.minute);
      ureClass = '';
    }

    return `<tr class="${jeDanes ? 'danes-row' : ''}">
      <td>${formatirajDatum(d.datum)}${jeDanes ? ' <b>danes</b>' : ''}</td>
      <td class="td-cas">${formatirajCas(d.prvPrihod)}</td>
      <td class="td-cas">${d.vTeku && !d.nepopoln ? '<span style="color:#38a169">v delu</span>' : formatirajCas(d.zadnjiOdhod)}</td>
      <td class="td-ure ${ureClass}">${ureStr}</td>
    </tr>`;
  }).join('');

  // Disable "naprej" if we're already at current month
  const zdaj = new Date();
  const jeTekochiMesec = prikazanoLeto === zdaj.getFullYear() && prikazaniMesec === (zdaj.getMonth() + 1);
  document.getElementById('btn-naprej').disabled = jeTekochiMesec;
}

async function naloziKumulativno() {
  const res = await fetch('/api/moj-cas/kumulativno');
  const meseci = await res.json();

  const tbody = document.getElementById('tbody-meseci');
  const prazno = document.getElementById('kum-prazno');

  if (!meseci || meseci.length === 0) {
    tbody.innerHTML = '';
    prazno.style.display = 'block';
    return;
  }
  prazno.style.display = 'none';

  let skupajVsega = 0;
  tbody.innerHTML = meseci.map(m => {
    skupajVsega += m.minute;
    const [leto, mes] = m.mesec.split('-');
    const ime = `${MESECI[parseInt(mes) - 1]} ${leto}`;
    return `<tr>
      <td>${ime}</td>
      <td class="td-ure">${formatirajUre(m.minute)}</td>
    </tr>`;
  }).join('') + `<tr class="mesec-skupaj">
    <td>Skupaj vse</td>
    <td class="td-ure">${formatirajUre(skupajVsega)}</td>
  </tr>`;
}

// Navigacija
document.getElementById('btn-prej').addEventListener('click', () => {
  prikazaniMesec--;
  if (prikazaniMesec < 1) { prikazaniMesec = 12; prikazanoLeto--; }
  naloziMesec();
});

document.getElementById('btn-naprej').addEventListener('click', () => {
  prikazaniMesec++;
  if (prikazaniMesec > 12) { prikazaniMesec = 1; prikazanoLeto++; }
  naloziMesec();
});

// Odjava
document.getElementById('btn-odjava').addEventListener('click', async () => {
  await fetch('/api/pin-logout', { method: 'POST' });
  window.location.href = '/pin';
});

// Init
const zdaj = new Date();
prikazanoLeto = zdaj.getFullYear();
prikazaniMesec = zdaj.getMonth() + 1;

naloziInfo();
naloziMesec();
naloziKumulativno();
