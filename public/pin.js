let pin = '';

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
    body: JSON.stringify({ pin })
  });

  if (res.ok) {
    const data = await res.json();
    window.location.href = data.pinSetupRequired ? '/pin-setup' : '/moj-cas';
  } else {
    // Shake animation + error
    const prikaz = document.querySelector('.pin-prikaz');
    prikaz.classList.remove('tresenje');
    void prikaz.offsetWidth;
    prikaz.classList.add('tresenje');

    for (let i = 0; i < 4; i++) {
      document.getElementById('d' + i).classList.add('napaka-anim');
    }

    document.getElementById('napaka').textContent = 'Napačen PIN';
    pin = '';
    setTimeout(() => {
      posodobiPrikaz();
      document.getElementById('napaka').textContent = '';
    }, 800);
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
