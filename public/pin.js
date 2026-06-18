const LS_USER = 'kukman_pin_user';
let pin = '';
let izbraniZaposleniId = null;
let izbraniZaposleniIme = null;

async function naloziZaposlene() {
  try {
    const res = await fetch('/api/zaposleni-seznam');
    if (!res.ok) { document.getElementById('zaposleni-seznam').textContent = 'Napaka pri nalaganju.'; return; }
    const zaposleni = await res.json();
    const el = document.getElementById('zaposleni-seznam');
    el.innerHTML = zaposleni.map(z =>
      `<button class="ime-tipka" data-id="${z.id}">${z.ime}</button>`
    ).join('');
    el.querySelectorAll('.ime-tipka').forEach(btn => {
      btn.addEventListener('click', () => izberIme(Number(btn.dataset.id), btn.textContent.trim()));
    });
  } catch(_) {}
}

function izberIme(id, ime) {
  izbraniZaposleniId = id;
  izbraniZaposleniIme = ime;
  document.getElementById('pin-navodilo').textContent = `Pozdravljeni, ${ime}!`;
  document.getElementById('header-podnaslov').textContent = ime;
  document.getElementById('ime-karta').style.display = 'none';
  document.getElementById('pin-karta').style.display = '';
  pin = '';
  posodobiPrikaz();
  document.getElementById('napaka').textContent = '';
}

function vrniNaIzbiro() {
  izbraniZaposleniId = null;
  izbraniZaposleniIme = null;
  pin = '';
  document.getElementById('btn-nisem-jaz').style.display = 'none';
  document.getElementById('ime-karta').style.display = '';
  document.getElementById('pin-karta').style.display = 'none';
  document.getElementById('header-podnaslov').textContent = 'Moj čas';
  document.getElementById('napaka').textContent = '';
}

function posodobiPrikaz() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('d' + i);
    dot.classList.toggle('vnesen', i < pin.length);
    dot.classList.remove('napaka-anim');
  }
}

async function preveriPin() {
  const res = await fetch('/api/pin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zaposleniId: izbraniZaposleniId, pin })
  });

  if (res.ok) {
    const data = await res.json();
    localStorage.setItem(LS_USER, JSON.stringify({ id: izbraniZaposleniId, ime: izbraniZaposleniIme }));
    window.location.href = data.pinSetupRequired ? '/moj-cas/pin-setup' : '/moj-cas/app';
  } else {
    const prikaz = document.querySelector('.pin-prikaz');
    prikaz.classList.remove('tresenje');
    void prikaz.offsetWidth;
    prikaz.classList.add('tresenje');
    for (let i = 0; i < 4; i++) document.getElementById('d' + i).classList.add('napaka-anim');
    document.getElementById('napaka').textContent = 'Napačen PIN';
    pin = '';
    setTimeout(() => {
      posodobiPrikaz();
      document.getElementById('napaka').textContent = '';
    }, 800);
  }
}

function dodajCifro(c) {
  if (!izbraniZaposleniId || pin.length >= 4) return;
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
document.getElementById('btn-nazaj').addEventListener('click', vrniNaIzbiro);
document.getElementById('btn-nisem-jaz').addEventListener('click', () => {
  localStorage.removeItem(LS_USER);
  vrniNaIzbiro();
  naloziZaposlene();
});

document.addEventListener('keydown', e => {
  if (e.key >= '0' && e.key <= '9') dodajCifro(e.key);
  else if (e.key === 'Backspace') brisi();
  else if (e.key === 'Escape' && izbraniZaposleniId) vrniNaIzbiro();
});

// Preveri shranjeno identiteto
(function init() {
  try {
    const s = localStorage.getItem(LS_USER);
    if (s) {
      const { id, ime } = JSON.parse(s);
      izberIme(id, ime);
      document.getElementById('btn-nisem-jaz').style.display = '';
      return;
    }
  } catch(_) { localStorage.removeItem(LS_USER); }
  naloziZaposlene();
})();
