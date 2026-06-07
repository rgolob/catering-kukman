let pin = '';
let novPin = '';
let korak = 1; // 1 = vnos novega, 2 = potrditev

async function init() {
  try {
    const res = await fetch('/api/nastavi-pin-info');
    if (res.status === 401) { window.location.href = '/prisotnost/pin'; return; }
    const data = await res.json();
    document.getElementById('pozdrav-ime').textContent = data.ime;
    if (!data.pinSetupRequired) { window.location.href = '/prisotnost/moj-cas'; return; }
  } catch(_) {}
}

function posodobiPrikaz() {
  for (let i = 0; i < 4; i++) {
    document.getElementById('d' + i).classList.toggle('vnesen', i < pin.length);
    document.getElementById('d' + i).classList.remove('napaka-anim');
  }
}

function nastaviKorak1() {
  korak = 1;
  pin = '';
  document.getElementById('korak-napis').textContent = 'Korak 1 od 2';
  document.getElementById('navodilo').textContent = 'Izberite nov 4-mestni PIN';
  document.getElementById('navodilo-sub').textContent = '';
  document.getElementById('napaka').textContent = '';
  posodobiPrikaz();
}

function nastaviKorak2() {
  korak = 2;
  pin = '';
  document.getElementById('korak-napis').textContent = 'Korak 2 od 2';
  document.getElementById('navodilo').textContent = 'Potrdite PIN';
  document.getElementById('navodilo-sub').textContent = 'Vnesite PIN še enkrat';
  document.getElementById('napaka').textContent = '';
  posodobiPrikaz();
}

async function preveriPin() {
  if (korak === 1) {
    novPin = pin;
    nastaviKorak2();
    return;
  }

  // Korak 2: primerjava
  if (pin !== novPin) {
    const prikaz = document.querySelector('.pin-prikaz');
    prikaz.classList.remove('tresenje');
    void prikaz.offsetWidth;
    prikaz.classList.add('tresenje');
    for (let i = 0; i < 4; i++) document.getElementById('d' + i).classList.add('napaka-anim');
    document.getElementById('napaka').textContent = 'PIN se ne ujema, poskusite znova';
    pin = '';
    setTimeout(() => { nastaviKorak1(); }, 1200);
    return;
  }

  // PIN se ujema - shrani
  try {
    const res = await fetch('/api/nastavi-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novPin })
    });
    if (res.ok) {
      window.location.href = '/prisotnost/moj-cas';
    } else {
      const d = await res.json();
      document.getElementById('napaka').textContent = d.napaka || 'Napaka';
      pin = '';
      setTimeout(nastaviKorak1, 1500);
    }
  } catch(_) {
    document.getElementById('napaka').textContent = 'Napaka pri shranjevanju';
  }
}

function dodajCifro(c) {
  if (pin.length >= 4) return;
  document.getElementById('napaka').textContent = '';
  pin += c;
  posodobiPrikaz();
  if (pin.length === 4) preveriPin();
}

function brisi() {
  if (pin.length === 0) return;
  pin = pin.slice(0, -1);
  posodobiPrikaz();
  document.getElementById('napaka').textContent = '';
}

document.querySelectorAll('.tipka[data-digit]').forEach(btn => {
  btn.addEventListener('click', () => dodajCifro(btn.dataset.digit));
});
document.getElementById('btn-brisi').addEventListener('click', brisi);
document.addEventListener('keydown', e => {
  if (e.key >= '0' && e.key <= '9') dodajCifro(e.key);
  else if (e.key === 'Backspace') brisi();
});

init();
