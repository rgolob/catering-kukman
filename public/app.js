let izbraniZaposleni = null;
let izbraniTip = null;

// Ura
function posodobiUro() {
  const zdaj = new Date();
  const ura = zdaj.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('ura').textContent = ura;
}
setInterval(posodobiUro, 1000);
posodobiUro();

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
    btn.textContent = z.ime;
    btn.dataset.id = z.id;
    btn.dataset.ime = z.ime;
    btn.dataset.prisoten = jePrisoten ? '1' : '0';
    btn.addEventListener('click', () => odpriDialog(z.id, z.ime, jePrisoten));
    grid.appendChild(btn);
  });
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
  const casStr = zdaj.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('dialog-cas').textContent = casStr;

  const vprasanje = izbraniTip === 'PRIHOD'
    ? 'Ali potrjuješ prihod na delo?'
    : 'Ali potrjuješ odhod z dela?';
  document.getElementById('dialog-vprasanje').textContent = vprasanje;

  document.getElementById('overlay').classList.remove('hidden');
}

// Zapri dialog
function zapriDialog() {
  document.getElementById('overlay').classList.add('hidden');
  izbraniZaposleni = null;
  izbraniTip = null;
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
    zapriDialog();
    prikaziToast(zapis.ime, izbraniTip);
    await Promise.all([naloziZaposlene(), naloziEvidenco()]);
  } catch (e) {
    console.error('Napaka:', e);
  }
}

// Toast obvestilo
function prikaziToast(ime, tip) {
  const toast = document.getElementById('toast');
  const besedilo = tip === 'PRIHOD' ? `✓ ${ime} — prihod zabeležen` : `✓ ${ime} — odhod zabeležen`;
  toast.textContent = besedilo;
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

// Osvežuj evidenco vsako minuto
setInterval(() => {
  naloziZaposlene();
  naloziEvidenco();
}, 60_000);
