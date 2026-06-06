let izbraniZaposleni = null;
let izbraniTip = null;

// Ura v headerju
function posodobiUro() {
  const zdaj = new Date();
  const ura = zdaj.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('ura').textContent = ura;
}
setInterval(posodobiUro, 1000);
posodobiUro();

// Pretvori ms v HH:MM:SS
function formatPretecenCas(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Vsako sekundo posodobi čas od prihoda na vseh karticah
function posodobiPretecenCas() {
  const zdaj = Date.now();
  document.querySelectorAll('.btn-elapsed[data-prihod]').forEach(el => {
    const prihod = new Date(el.dataset.prihod).getTime();
    el.textContent = formatPretecenCas(zdaj - prihod);
  });
}
setInterval(posodobiPretecenCas, 1000);

// Zgradi HTML za kartico zaposlenega
function karticaHtml(ime, jePrisoten, zadnji_prihod) {
  let html = `<span class="btn-ime">${ime}</span>`;
  if (jePrisoten && zadnji_prihod) {
    const prihod = new Date(zadnji_prihod);
    const uraStr = prihod.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
    html += `<span class="btn-prihod">&#9679; od ${uraStr}</span>`;
    html += `<span class="btn-elapsed" data-prihod="${zadnji_prihod}">00:00:00</span>`;
  } else if (!jePrisoten && zadnji_prihod !== undefined) {
    html += `<span class="btn-status-odsoten">&#9675; Odsoten</span>`;
  }
  return html;
}

// Naloži zaposlene in njihove statuse
async function naloziZaposlene() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const statusi = await res.json();
    if (!Array.isArray(statusi)) return;

    const grid = document.getElementById('zaposleni-grid');
    grid.innerHTML = '';

    statusi.forEach(z => {
      const jePrisoten = z.zadnji_tip === 'PRIHOD';
      const btn = document.createElement('button');
      btn.className = 'zaposleni-btn ' + (z.zadnji_tip === null ? '' : jePrisoten ? 'prisoten' : 'odsoten');
      btn.dataset.id = z.id;
      btn.dataset.ime = z.ime;
      btn.dataset.prisoten = jePrisoten ? '1' : '0';
      btn.innerHTML = karticaHtml(z.ime, jePrisoten, z.zadnji_prihod);
      btn.addEventListener('click', () => odpriDialog(z.id, z.ime, jePrisoten));
      grid.appendChild(btn);
    });

    posodobiPretecenCas();
  } catch (e) { console.error('naloziZaposlene:', e); }
}

// Naloži današnjo evidenco
async function naloziEvidenco() {
  try {
    const res = await fetch('/api/danes');
    if (!res.ok) return;
    const zapisi = await res.json();
    if (!Array.isArray(zapisi)) return;

    const list = document.getElementById('evidenca-list');
    if (zapisi.length === 0) {
      list.innerHTML = '<div class="evidenca-prazno">Še ni nobenih zapisov za danes.</div>';
      return;
    }

    list.innerHTML = zapisi.map(z => {
      const cas = new Date(z.cas).toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="evidenca-zapis">
          <span class="tip-pill ${z.tip}">${z.tip === 'PRIHOD' ? 'Prihod' : 'Odhod'}</span>
          <span class="ev-ime">${z.ime}</span>
          <span class="ev-cas">${cas}</span>
        </div>
      `;
    }).join('');
  } catch (e) { console.error('naloziEvidenco:', e); }
}

// Odpri potrditveni dialog
function odpriDialog(id, ime, jePrisoten) {
  izbraniZaposleni = id;
  izbraniTip = jePrisoten ? 'ODHOD' : 'PRIHOD';

  const badge = document.getElementById('dialog-tip-badge');
  badge.textContent = izbraniTip === 'PRIHOD' ? 'Prihod' : 'Odhod';
  badge.className = 'tip-badge ' + izbraniTip;

  document.getElementById('dialog-ime').textContent = ime;

  const zdaj = new Date();
  document.getElementById('dialog-cas').textContent = zdaj.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });

  document.getElementById('dialog-vprasanje').textContent = izbraniTip === 'PRIHOD'
    ? 'Ali potrjuješ prihod na delo?'
    : 'Ali potrjuješ odhod z dela?';

  document.getElementById('overlay').classList.remove('hidden');
}

// Zapri dialog
function zapriDialog() {
  document.getElementById('overlay').classList.add('hidden');
  izbraniZaposleni = null;
  izbraniTip = null;
}

// Takoj posodobi kartico po potrditvi (brez čakanja na API refresh)
function posodobiKarticoTakoj(id, tip, cas) {
  const btn = document.querySelector(`[data-id="${id}"]`);
  if (!btn) return;
  const ime = btn.dataset.ime;

  if (tip === 'PRIHOD') {
    btn.className = 'zaposleni-btn prisoten';
    btn.innerHTML = karticaHtml(ime, true, cas.toISOString());
  } else {
    btn.className = 'zaposleni-btn odsoten';
    btn.innerHTML = karticaHtml(ime, false, null);
  }
  btn.dataset.prisoten = tip === 'PRIHOD' ? '1' : '0';
  posodobiPretecenCas();
}

// Potrdi zapis
async function potrdiZapis() {
  if (!izbraniZaposleni || !izbraniTip) return;

  try {
    const res = await fetch('/api/belezi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zaposleni_id: izbraniZaposleni, tip: izbraniTip })
    });
    const zapis = await res.json();

    // Takoj posodobi kartico – ne čakaj na polni API refresh
    posodobiKarticoTakoj(izbraniZaposleni, izbraniTip, new Date(zapis.cas));

    zapriDialog();
    prikaziToast(zapis.ime, izbraniTip);

    // Osveži vse v ozadju
    naloziZaposlene();
    naloziEvidenco();
  } catch (e) {
    console.error('Napaka:', e);
  }
}

// Toast obvestilo
function prikaziToast(ime, tip) {
  const toast = document.getElementById('toast');
  toast.textContent = tip === 'PRIHOD' ? `✓ ${ime} — prihod zabeležen` : `✓ ${ime} — odhod zabeležen`;
  toast.className = 'toast ' + tip.toLowerCase();
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// Event listenerji
document.getElementById('btn-potrdi').addEventListener('click', potrdiZapis);
document.getElementById('btn-preklic').addEventListener('click', zapriDialog);
document.getElementById('overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('overlay')) zapriDialog();
});

// Začetno nalaganje
naloziZaposlene();
naloziEvidenco();

// Osvežuj vsako minuto
setInterval(() => {
  naloziZaposlene();
  naloziEvidenco();
}, 60_000);
