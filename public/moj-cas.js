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
  if (res.status === 401) { window.location.href = '/prisotnost/pin'; return; }
  const data = await res.json();

  if (data.pinSetupRequired) { window.location.href = '/prisotnost/pin-setup'; return; }

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

function formatEur(n) {
  return n != null ? '€' + parseFloat(n).toFixed(2) : '—';
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
    document.getElementById('placilo-box').style.display = 'none';
    return;
  }
  prazno.style.display = 'none';

  const skupajMinut = data.dnevi.reduce((s, d) => s + d.minute, 0);
  document.getElementById('skupaj-ure').textContent = formatirajUre(skupajMinut);

  const danasnji = new Date().toISOString().slice(0, 10);

  tbody.innerHTML = data.dnevi.map(d => {
    const jeDanes = d.datum === danasnji;
    let ureStr, ureClass;
    if (d.nepopoln) { ureStr = 'nepopoln'; ureClass = 'nepopoln'; }
    else if (d.vTeku) { ureStr = formatirajUre(d.minute) + ' ▶'; ureClass = 'v-teku'; }
    else { ureStr = formatirajUre(d.minute); ureClass = ''; }

    return `<tr class="${jeDanes ? 'danes-row' : ''}">
      <td>${formatirajDatum(d.datum)}${jeDanes ? ' <b>danes</b>' : ''}</td>
      <td class="td-cas">${formatirajCas(d.prvPrihod)}</td>
      <td class="td-cas">${d.vTeku && !d.nepopoln ? '<span style="color:#38a169">v delu</span>' : formatirajCas(d.zadnjiOdhod)}</td>
      <td class="td-ure ${ureClass}">${ureStr}</td>
    </tr>`;
  }).join('');

  // Prikaz plačila
  const plBox = document.getElementById('placilo-box');
  if (data.skupajPlacilo !== null) {
    const ure = (skupajMinut / 60).toFixed(2);
    document.getElementById('placilo-osnova-napis').textContent =
      `Osnova (${ure}h × €${parseFloat(data.urnaPostavka).toFixed(2)}/h)`;
    document.getElementById('placilo-osnova-znesek').textContent = formatEur(data.osnova);
    const stimRow = document.getElementById('placilo-stim-row');
    if (data.stimulacija) {
      document.getElementById('placilo-stim-znesek').textContent = formatEur(data.stimulacija);
      stimRow.style.display = '';
    } else {
      stimRow.style.display = 'none';
    }
    document.getElementById('placilo-skupaj-znesek').textContent = formatEur(data.skupajPlacilo);
    plBox.style.display = '';
  } else {
    plBox.style.display = 'none';
  }

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
    document.getElementById('th-placilo').style.display = 'none';
    return;
  }
  prazno.style.display = 'none';

  const imaPlacilo = meseci.some(m => m.skupajPlacilo !== null);
  document.getElementById('th-placilo').style.display = imaPlacilo ? '' : 'none';

  let skupajVsega = 0, skupajPlacilo = 0;
  tbody.innerHTML = meseci.map(m => {
    skupajVsega += m.minute;
    skupajPlacilo += m.skupajPlacilo || 0;
    const [leto, mes] = m.mesec.split('-');
    const ime = `${MESECI[parseInt(mes) - 1]} ${leto}`;
    const placiloCell = imaPlacilo ? `<td class="td-ure">${m.skupajPlacilo != null ? formatEur(m.skupajPlacilo) : '—'}</td>` : '';
    return `<tr>
      <td>${ime}</td>
      <td class="td-ure">${formatirajUre(m.minute)}</td>
      ${placiloCell}
    </tr>`;
  }).join('') + `<tr class="mesec-skupaj">
    <td>Skupaj vse</td>
    <td class="td-ure">${formatirajUre(skupajVsega)}</td>
    ${imaPlacilo ? `<td class="td-ure">${formatEur(skupajPlacilo)}</td>` : ''}
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
  window.location.href = '/prisotnost/pin';
});

// ── Naknadno evidentiranje ────────────────────────────────────────────────────
document.getElementById('btn-naknadno').addEventListener('click', () => {
  const danes = new Date().toISOString().slice(0, 10);
  document.getElementById('nak-datum').max = danes;
  document.getElementById('nak-datum').value = danes;
  document.getElementById('nak-ura').value = '';
  document.getElementById('nak-opomba').value = '';
  document.getElementById('nak-napaka').textContent = '';
  document.querySelector('input[name="nak-tip"][value="PRIHOD"]').checked = true;
  document.getElementById('naknadno-overlay').classList.remove('hidden');
});

document.getElementById('nak-preklic').addEventListener('click', () => {
  document.getElementById('naknadno-overlay').classList.add('hidden');
});

document.getElementById('naknadno-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('naknadno-overlay'))
    document.getElementById('naknadno-overlay').classList.add('hidden');
});

document.getElementById('nak-potrdi').addEventListener('click', async () => {
  const datum  = document.getElementById('nak-datum').value;
  const ura    = document.getElementById('nak-ura').value;
  const tip    = document.querySelector('input[name="nak-tip"]:checked').value;
  const opomba = document.getElementById('nak-opomba').value.trim();
  const napaka = document.getElementById('nak-napaka');

  if (!datum || !ura) { napaka.textContent = 'Vnesite datum in uro.'; return; }

  const cas = `${datum} ${ura}`;
  const res = await fetch('/api/moj-cas/zahtevek', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tip, cas, opomba: opomba || undefined })
  });

  if (res.ok) {
    document.getElementById('naknadno-overlay').classList.add('hidden');
    naloziZahtevke();
  } else {
    const d = await res.json();
    napaka.textContent = d.napaka || 'Napaka pri pošiljanju zahtevka';
  }
});

// ── Zahtevki ─────────────────────────────────────────────────────────────────
async function naloziZahtevke() {
  const res = await fetch('/api/moj-cas/zahtevki');
  if (!res.ok) return;
  const zahtevki = await res.json();

  const el = document.getElementById('zahtevki-seznam');
  if (!zahtevki || zahtevki.length === 0) { el.innerHTML = ''; return; }

  el.innerHTML = '<div class="zahtevki-naslov">Moji zahtevki</div>' + zahtevki.map(z => {
    const casStr = String(z.cas_zahtevka).slice(0, 16).replace('T', ' ');
    const tipTxt = z.tip === 'PRIHOD' ? 'Prihod' : 'Odhod';
    const sc = z.status === 'CAKA' ? 'caka' : z.status === 'ODOBREN' ? 'odobren' : 'zavrnjen';
    const st = z.status === 'CAKA' ? 'Čaka' : z.status === 'ODOBREN' ? 'Odobreno' : 'Zavrnjeno';
    const opombaHtml = z.opomba ? `<span class="zahtevek-opomba">${z.opomba}</span>` : '';
    return `<div class="zahtevek-vrstica">
      <span class="zahtevek-tip ${z.tip.toLowerCase()}">${tipTxt}</span>
      <span class="zahtevek-cas">${casStr}</span>
      ${opombaHtml}
      <span class="zahtevek-status ${sc}">${st}</span>
    </div>`;
  }).join('');
}

// Init
const zdaj = new Date();
prikazanoLeto = zdaj.getFullYear();
prikazaniMesec = zdaj.getMonth() + 1;

naloziInfo();
naloziMesec();
naloziKumulativno();
naloziZahtevke();
