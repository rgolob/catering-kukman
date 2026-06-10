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

function isoNaCasInput(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function casOdDoMinuteFE(casOd, casDo) {
  const [oh, om] = String(casOd || '00:00').split(':').map(Number);
  const [dh, dm] = String(casDo || '00:00').split(':').map(Number);
  return Math.max(0, (dh * 60 + dm) - (oh * 60 + om));
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
    const zdajE = new Date();
    document.getElementById('btn-naprej').disabled =
      prikazanoLeto === zdajE.getFullYear() && prikazaniMesec === (zdajE.getMonth() + 1);
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

    const gorivoBadge = d.gorivo > 0 ? `<span class="km-badge">⛽ €${parseFloat(d.gorivo).toFixed(2)}</span>` : '';
    const nakupBadge = d.nakup > 0 ? `<span class="km-badge strosek-badge">🛒 €${parseFloat(d.nakup).toFixed(2)}</span>` : '';
    const badges = (gorivoBadge || nakupBadge) ? `<span class="dan-badges">${gorivoBadge}${nakupBadge}</span>` : '';
    const delaBadges = d.razporeditev && d.razporeditev.length > 0
      ? `<div class="dan-dela">${d.razporeditev.map(r => `<span class="dan-delo-chip">${r.naziv} ${formatirajUre(r.minute)}</span>`).join('')}</div>`
      : '';
    return `<tr class="${jeDanes ? 'danes-row' : ''}">
      <td>
        <span>${formatirajDatum(d.datum)}${jeDanes ? ' <b>danes</b>' : ''}</span>
        ${badges}${delaBadges}
      </td>
      <td class="td-cas">${formatirajCas(d.prvPrihod)}</td>
      <td class="td-cas">${d.vTeku && !d.nepopoln ? '<span style="color:#38a169">v delu</span>' : formatirajCas(d.zadnjiOdhod)}</td>
      <td class="td-ure ${ureClass}">
        ${ureStr}
        <button class="btn-uredi-dan" data-datum="${d.datum}" data-gorivo="${d.gorivo || 0}" data-nakup="${d.nakup || 0}" data-prihod="${isoNaCasInput(d.prvPrihod)}" data-odhod="${isoNaCasInput(d.zadnjiOdhod)}" data-komentar="${d.komentar || ''}" title="Uredi">✏</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.btn-uredi-dan').forEach(btn => {
    btn.addEventListener('click', () => odpriRetroModal(
      btn.dataset.datum,
      parseFloat(btn.dataset.gorivo),
      parseFloat(btn.dataset.nakup),
      btn.dataset.prihod,
      btn.dataset.odhod,
      btn.dataset.komentar
    ));
  });

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
    const gorivoRow = document.getElementById('placilo-gorivo-row');
    if (data.gorivo) {
      document.getElementById('placilo-gorivo-znesek').textContent = formatEur(data.gorivo);
      gorivoRow.style.display = '';
    } else { gorivoRow.style.display = 'none'; }
    const nakupRow = document.getElementById('placilo-nakup-row');
    if (data.nakup) {
      document.getElementById('placilo-nakup-znesek').textContent = formatEur(data.nakup);
      nakupRow.style.display = '';
    } else { nakupRow.style.display = 'none'; }
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

// ── Retroaktivni vnos ────────────────────────────────────────────────────────

let retroDatum = null;

async function odpriRetroModal(datum, gorivo, nakup, prihod, odhod, komentar) {
  retroDatum = datum;
  const d = new Date(datum + 'T00:00:00');
  document.getElementById('retro-naslov').textContent =
    `${DNEVI[d.getDay()]} ${d.getDate()}. ${MESECI[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
  document.getElementById('retro-gorivo').value = gorivo > 0 ? gorivo : '';
  document.getElementById('retro-nakup').value = nakup > 0 ? nakup : '';
  document.getElementById('retro-prihod').value = prihod || '';
  document.getElementById('retro-odhod').value = odhod || '';
  document.getElementById('retro-komentar').value = komentar || '';
  document.getElementById('retro-shrani-napaka').textContent = '';
  document.getElementById('retro-trajanje').value = '';

  try {
    const res = await fetch('/api/moj-cas/dela');
    const dela = await res.json();
    const delaSekcija = document.getElementById('retro-dela-sekcija');
    if (dela.length > 0) {
      document.getElementById('retro-delo-select').innerHTML = dela.map(d =>
        `<option value="${d.id}">${d.naziv} (€${parseFloat(d.urna_postavka).toFixed(2)}/h)</option>`
      ).join('');
      document.getElementById('retro-napaka').textContent = '';
      delaSekcija.style.display = '';
    } else {
      delaSekcija.style.display = 'none';
    }
  } catch (_) {
    document.getElementById('retro-dela-sekcija').style.display = 'none';
  }

  await osveziRetroSegmente();
  document.getElementById('retro-overlay').classList.remove('hidden');
}

async function osveziRetroSegmente() {
  try {
    const res = await fetch(`/api/moj-cas/razporeditev?datum=${retroDatum}`);
    const segmenti = await res.json();
    const el = document.getElementById('retro-segmenti');
    if (!segmenti.length) { el.innerHTML = ''; return; }
    el.innerHTML = segmenti.map(s => {
      const min = s.trajanje_minut != null ? s.trajanje_minut : casOdDoMinuteFE(s.cas_od, s.cas_do);
      return `<div class="retro-segment">
        <span>${s.naziv} · ${formatirajUre(min)}</span>
        <button class="retro-del-btn" data-id="${s.id}">✕</button>
      </div>`;
    }).join('');
    el.querySelectorAll('.retro-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/moj-cas/razporeditev/${btn.dataset.id}`, { method: 'DELETE' });
        await osveziRetroSegmente();
      });
    });
  } catch (_) {}
}

document.getElementById('retro-btn-dodaj').addEventListener('click', async () => {
  const deloId = document.getElementById('retro-delo-select').value;
  const trajanje = parseFloat(document.getElementById('retro-trajanje').value);
  const napaka = document.getElementById('retro-napaka');
  if (!trajanje || trajanje <= 0) { napaka.textContent = 'Vnesite trajanje v urah.'; return; }
  napaka.textContent = '';
  const res = await fetch('/api/moj-cas/razporeditev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datum: retroDatum, deloId, trajanje })
  });
  if (res.ok) {
    document.getElementById('retro-trajanje').value = '';
    await osveziRetroSegmente();
  } else {
    const d = await res.json().catch(() => ({}));
    napaka.textContent = d.napaka || 'Napaka';
  }
});

document.getElementById('retro-btn-cel-dan').addEventListener('click', async () => {
  const deloId = document.getElementById('retro-delo-select').value;
  const napaka = document.getElementById('retro-napaka');
  napaka.textContent = '';
  const res = await fetch('/api/moj-cas/razporeditev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datum: retroDatum, deloId, celDan: true })
  });
  if (res.ok) {
    await osveziRetroSegmente();
  } else {
    const d = await res.json().catch(() => ({}));
    napaka.textContent = d.napaka || 'Napaka';
  }
});

document.getElementById('retro-shrani').addEventListener('click', async () => {
  const gorivo = parseFloat(document.getElementById('retro-gorivo').value) || 0;
  const nakup = parseFloat(document.getElementById('retro-nakup').value) || 0;
  const prihod = document.getElementById('retro-prihod').value || null;
  const odhod = document.getElementById('retro-odhod').value || null;
  const komentar = document.getElementById('retro-komentar').value.trim() || null;
  const napaka = document.getElementById('retro-shrani-napaka');
  napaka.textContent = '';
  try {
    const res = await fetch('/api/moj-cas/kilometrina', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datum: retroDatum, gorivo, nakup, prihod, odhod, komentar })
    });
    if (res.ok) {
      document.getElementById('retro-overlay').classList.add('hidden');
      naloziMesec();
    } else {
      const d = await res.json().catch(() => ({}));
      napaka.textContent = d.napaka || 'Napaka pri shranjevanju';
    }
  } catch (_) {
    napaka.textContent = 'Napaka pri povezavi';
  }
});

document.getElementById('retro-preklic').addEventListener('click', () => {
  document.getElementById('retro-overlay').classList.add('hidden');
});
document.getElementById('retro-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('retro-overlay'))
    document.getElementById('retro-overlay').classList.add('hidden');
});

// Init
const zdaj = new Date();
prikazanoLeto = zdaj.getFullYear();
prikazaniMesec = zdaj.getMonth() + 1;

naloziInfo();
naloziMesec();
naloziKumulativno();
naloziZahtevke();
