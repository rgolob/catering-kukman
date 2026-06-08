// ── CONSTANTS ──
const LS_KEY = 'qr_zaposleni';
const MESECI = ['Januar','Februar','Marec','April','Maj','Junij',
                'Julij','Avgust','September','Oktober','November','December'];
const MESECI_GEN = ['januar','februar','marec','april','maj','junij',
                    'julij','avgust','september','oktober','november','december'];
const DNEVI_CEL  = ['nedelja','ponedeljek','torek','sreda','četrtek','petek','sobota'];
const DNEVI_KR   = ['Ned','Pon','Tor','Sre','Čet','Pet','Sob'];

// ── DATUM V HEADERJU ──
const _d = new Date();
document.getElementById('moj-datum').textContent =
  `${DNEVI_CEL[_d.getDay()]}, ${_d.getDate()}. ${MESECI_GEN[_d.getMonth()]} ${_d.getFullYear()}`;

// ── STATE ──
let aktivniToken = '';
let dodatnoZaposleniId = null;
let dodatnoDatum = '';
let dodatnoOstala = [];

let pinZaposleniId = null;
let pinVnos = '';
let prikazanoLeto, prikazaniMesec;

// ── MAIN INIT ──
async function init() {
  const zdaj = new Date();
  prikazanoLeto = zdaj.getFullYear();
  prikazaniMesec = zdaj.getMonth() + 1;

  initEvid();
  initPinSekcija();
}

// ─────────────────────────────────────────────
// EVIDENTIRANJE (QR)
// ─────────────────────────────────────────────

async function initEvid() {
  const shranjeno = localStorage.getItem(LS_KEY);
  if (!shranjeno) { prikaziNapotilo(); return; }

  let id, ime, shrDatum;
  try { ({ id, ime, datum: shrDatum } = JSON.parse(shranjeno)); }
  catch (_) { localStorage.removeItem(LS_KEY); prikaziNapotilo(); return; }

  const { token, datum: danes } = await fetch('/api/qr-info').then(r => r.json());
  if (shrDatum !== danes) { localStorage.removeItem(LS_KEY); prikaziNapotilo(); return; }

  aktivniToken = token;
  await prikaziOsebo(id, ime);
}

function prikaziNapotilo() {
  document.getElementById('mp-napotilo').classList.remove('hidden');
  document.getElementById('mp-oseba-wrap').classList.add('hidden');
  document.getElementById('mp-rezultat').classList.add('hidden');
}

async function prikaziOsebo(id, ime) {
  document.getElementById('mp-napotilo').classList.add('hidden');
  document.getElementById('mp-rezultat').classList.add('hidden');
  document.getElementById('mp-oseba-wrap').classList.remove('hidden');

  const zaposleni = await fetch('/api/status').then(r => r.json());
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
    if (!res.ok) { alert(d.napaka || 'Napaka'); initEvid(); return; }

    document.getElementById('mp-rez-ime').textContent = d.ime;
    document.getElementById('mp-rez-tip').textContent = d.tip === 'PRIHOD' ? 'Prihod zabeležen ✓' : 'Odhod zabeležen ✓';
    document.getElementById('mp-rez-cas').textContent = String(d.cas).slice(11, 16);
    document.getElementById('mp-check-ikona').className = 'qr-check ' + (d.tip === 'PRIHOD' ? 'prihod' : 'odhod');
    document.getElementById('mp-rezultat').classList.remove('hidden');

    if (d.tip === 'ODHOD' && d.ostala_dela?.length > 0) {
      dodatnoZaposleniId = zaposleniId;
      dodatnoDatum = d.datum;
      dodatnoOstala = d.ostala_dela;
      setTimeout(() => {
        document.getElementById('mp-rezultat').classList.add('hidden');
        prikaziDodatnoDeloOverlay();
      }, 2000);
    } else {
      setTimeout(async () => {
        document.getElementById('mp-rezultat').classList.add('hidden');
        await initEvid();
      }, 3000);
    }
  } catch (_) {
    alert('Napaka pri povezavi');
    initEvid();
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

document.getElementById('mp-nisem-jaz').addEventListener('click', () => {
  localStorage.removeItem(LS_KEY);
  prikaziNapotilo();
});
document.getElementById('mp-btn-dodaj-seg').addEventListener('click', dodajSegment);
document.getElementById('mp-btn-zakljuci').addEventListener('click', async () => {
  document.getElementById('mp-dodatno-overlay').classList.add('hidden');
  await initEvid();
});

// ─────────────────────────────────────────────
// PIN PRIJAVA + URE
// ─────────────────────────────────────────────

async function initPinSekcija() {
  const res = await fetch('/api/moj-cas/info');
  if (res.status === 401) {
    prikaziPinLogin();
    naloziZaposlene();
    return;
  }
  const data = await res.json();
  if (data.pinSetupRequired) {
    window.location.href = '/prisotnost/pin-setup';
    return;
  }
  prikaziUreVsebina(data);
}

function prikaziPinLogin() {
  document.getElementById('pin-sekcija').classList.remove('hidden');
  document.getElementById('ure-vsebina').classList.add('hidden');
  document.getElementById('pin-ime-wrap').classList.remove('hidden');
  document.getElementById('pin-vnos-wrap').classList.add('hidden');
  pinZaposleniId = null;
  pinVnos = '';
}

function prikaziUreVsebina(data) {
  document.getElementById('pin-sekcija').classList.add('hidden');
  document.getElementById('ure-vsebina').classList.remove('hidden');

  document.getElementById('ure-ime').textContent = data.ime;
  const status = data.statusDanes;
  const statusEl = document.getElementById('ure-status-danes');
  if (status === 'PRIHOD') statusEl.innerHTML = '<span style="color:#38a169">● Prisoten danes</span>';
  else if (status === 'ODHOD') statusEl.innerHTML = '<span style="color:#dd6b20">○ Odsoten danes</span>';
  else statusEl.innerHTML = '<span style="color:#a0aec0">○ Ni vnosa danes</span>';

  // Prikaži ure tab (resetiraj na prvega)
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="ure"]').classList.add('active');
  document.getElementById('tab-ure').classList.remove('hidden');
  document.getElementById('tab-zahtevki').classList.add('hidden');

  naloziMesec();
  naloziKumulativno();
}

// Nalaganje zaposlenov za PIN izbiro
async function naloziZaposlene() {
  try {
    const res = await fetch('/api/zaposleni-seznam');
    if (!res.ok) return;
    const zaposleni = await res.json();
    const el = document.getElementById('pin-zaposleni-seznam');
    el.innerHTML = zaposleni.map(z => `<button class="ime-tipka" data-id="${z.id}">${z.ime}</button>`).join('');
    el.querySelectorAll('.ime-tipka').forEach(btn => {
      btn.addEventListener('click', () => izberIme(Number(btn.dataset.id), btn.textContent.trim()));
    });
  } catch (_) {}
}

function izberIme(id, ime) {
  pinZaposleniId = id;
  document.getElementById('pin-navodilo-txt').textContent = `Pozdravljeni, ${ime}!`;
  document.getElementById('pin-ime-wrap').classList.add('hidden');
  document.getElementById('pin-vnos-wrap').classList.remove('hidden');
  pinVnos = '';
  posodobiPinPrikaz();
  document.getElementById('pin-napaka').textContent = '';
}

function vrniNaIzbiro() {
  pinZaposleniId = null;
  pinVnos = '';
  document.getElementById('pin-ime-wrap').classList.remove('hidden');
  document.getElementById('pin-vnos-wrap').classList.add('hidden');
  document.getElementById('pin-napaka').textContent = '';
}

function posodobiPinPrikaz() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('pd' + i);
    dot.classList.toggle('vnesen', i < pinVnos.length);
    dot.classList.remove('napaka-anim');
  }
}

async function preveriPin() {
  const res = await fetch('/api/pin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zaposleniId: pinZaposleniId, pin: pinVnos })
  });
  if (res.ok) {
    const data = await res.json();
    if (data.pinSetupRequired) { window.location.href = '/prisotnost/pin-setup'; return; }
    const infoRes = await fetch('/api/moj-cas/info');
    prikaziUreVsebina(await infoRes.json());
  } else {
    const prikaz = document.querySelector('.pin-prikaz');
    prikaz.classList.remove('tresenje');
    void prikaz.offsetWidth;
    prikaz.classList.add('tresenje');
    for (let i = 0; i < 4; i++) document.getElementById('pd' + i).classList.add('napaka-anim');
    document.getElementById('pin-napaka').textContent = 'Napačen PIN';
    pinVnos = '';
    setTimeout(() => {
      posodobiPinPrikaz();
      document.getElementById('pin-napaka').textContent = '';
    }, 800);
  }
}

function dodajCifro(c) {
  if (!pinZaposleniId || pinVnos.length >= 4) return;
  document.getElementById('pin-napaka').textContent = '';
  pinVnos += c;
  posodobiPinPrikaz();
  if (pinVnos.length === 4) preveriPin();
}

function brisiCifro() {
  if (pinVnos.length === 0) return;
  pinVnos = pinVnos.slice(0, -1);
  posodobiPinPrikaz();
  document.getElementById('pin-napaka').textContent = '';
}

document.querySelectorAll('.tipka[data-digit]').forEach(btn => {
  btn.addEventListener('click', () => dodajCifro(btn.dataset.digit));
});
document.getElementById('pin-brisi').addEventListener('click', brisiCifro);
document.getElementById('pin-nazaj').addEventListener('click', vrniNaIzbiro);

document.addEventListener('keydown', e => {
  const pinAktiven = !document.getElementById('pin-vnos-wrap').classList.contains('hidden');
  if (!pinAktiven) return;
  if (e.key >= '0' && e.key <= '9') dodajCifro(e.key);
  else if (e.key === 'Backspace') brisiCifro();
  else if (e.key === 'Escape') vrniNaIzbiro();
});

document.getElementById('btn-odjava').addEventListener('click', async () => {
  await fetch('/api/pin-logout', { method: 'POST' });
  prikaziPinLogin();
  naloziZaposlene();
});

// ─────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-ure').classList.toggle('hidden', tab !== 'ure');
    document.getElementById('tab-zahtevki').classList.toggle('hidden', tab !== 'zahtevki');
    if (tab === 'zahtevki') naloziZahtevke();
  });
});

// ─────────────────────────────────────────────
// MOJE URE — MESEC
// ─────────────────────────────────────────────

function formatirajUre(minute) {
  if (minute <= 0) return '0u';
  const u = Math.floor(minute / 60), m = minute % 60;
  return m === 0 ? `${u}u` : `${u}u ${m}m`;
}

function formatirajCas(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
}

function formatirajDatum(datum) {
  const d = new Date(datum + 'T00:00:00');
  return `${DNEVI_KR[d.getDay()]} ${d.getDate()}.`;
}

function formatEur(n) {
  return n != null ? '€' + parseFloat(n).toFixed(2) : '—';
}

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

async function naloziMesec() {
  const res = await fetch(`/api/moj-cas/mesec?leto=${prikazanoLeto}&mesec=${prikazaniMesec}`);
  const data = await res.json();

  document.getElementById('mesec-naslov').textContent = `${MESECI[prikazaniMesec - 1]} ${prikazanoLeto}`;

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
    } else { stimRow.style.display = 'none'; }
    document.getElementById('placilo-skupaj-znesek').textContent = formatEur(data.skupajPlacilo);
    plBox.style.display = '';
  } else { plBox.style.display = 'none'; }

  const zdaj = new Date();
  document.getElementById('btn-naprej').disabled =
    prikazanoLeto === zdaj.getFullYear() && prikazaniMesec === (zdaj.getMonth() + 1);
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
    const pCell = imaPlacilo ? `<td class="td-ure">${m.skupajPlacilo != null ? formatEur(m.skupajPlacilo) : '—'}</td>` : '';
    return `<tr><td>${ime}</td><td class="td-ure">${formatirajUre(m.minute)}</td>${pCell}</tr>`;
  }).join('') + `<tr class="mesec-skupaj">
    <td>Skupaj vse</td>
    <td class="td-ure">${formatirajUre(skupajVsega)}</td>
    ${imaPlacilo ? `<td class="td-ure">${formatEur(skupajPlacilo)}</td>` : ''}
  </tr>`;
}

// ─────────────────────────────────────────────
// ZAHTEVKI
// ─────────────────────────────────────────────

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
    const opHtml = z.opomba ? `<span class="zahtevek-opomba">${z.opomba}</span>` : '';
    return `<div class="zahtevek-vrstica">
      <span class="zahtevek-tip ${z.tip.toLowerCase()}">${tipTxt}</span>
      <span class="zahtevek-cas">${casStr}</span>
      ${opHtml}
      <span class="zahtevek-status ${sc}">${st}</span>
    </div>`;
  }).join('');
}

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
  const res = await fetch('/api/moj-cas/zahtevek', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tip, cas: `${datum} ${ura}`, opomba: opomba || undefined })
  });
  if (res.ok) {
    document.getElementById('naknadno-overlay').classList.add('hidden');
    // Preklopi na zahtevki tab
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="zahtevki"]').classList.add('active');
    document.getElementById('tab-ure').classList.add('hidden');
    document.getElementById('tab-zahtevki').classList.remove('hidden');
    naloziZahtevke();
  } else {
    const d = await res.json();
    napaka.textContent = d.napaka || 'Napaka pri pošiljanju zahtevka';
  }
});

// ── START ──
init();
