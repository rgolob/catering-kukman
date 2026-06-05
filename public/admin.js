// ── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Odjava ────────────────────────────────────────────────────────────────────
document.getElementById('btn-odjava').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

// ── Toast ─────────────────────────────────────────────────────────────────────
function prikaziToast(besedilo, tip = 'uspeh') {
  const toast = document.getElementById('toast');
  toast.textContent = besedilo;
  toast.className = 'toast ' + tip;
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ── ZAPOSLENI TAB ─────────────────────────────────────────────────────────────
async function naloziZaposlene() {
  const res = await fetch('/api/admin/zaposleni');
  const zaposleni = await res.json();

  const tbody = document.querySelector('#zaposleni-tabela tbody');
  tbody.innerHTML = '';

  zaposleni.forEach(z => {
    const tr = document.createElement('tr');
    const jeAktiven = z.aktiven === 1;
    tr.innerHTML = `
      <td>${escHtml(z.ime)}</td>
      <td><span class="status-pill ${jeAktiven ? 'aktiven' : 'neaktiven'}">${jeAktiven ? 'Aktiven' : 'Neaktiven'}</span></td>
      <td>
        <button class="btn-sm btn-toggle ${jeAktiven ? '' : 'aktiviraj'}" data-id="${z.id}" data-aktiven="${jeAktiven ? 1 : 0}">
          ${jeAktiven ? 'Deaktiviraj' : 'Aktiviraj'}
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const jeAktiven = btn.dataset.aktiven === '1';
      const ime = btn.closest('tr').querySelector('td').textContent;
      const potrditev = confirm(`${jeAktiven ? 'Deaktivirati' : 'Aktivirati'} zaposlenega "${ime}"?`);
      if (!potrditev) return;

      await fetch(`/api/admin/zaposleni/${btn.dataset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aktiven: !jeAktiven })
      });
      prikaziToast(`${ime} ${jeAktiven ? 'deaktiviran' : 'aktiviran'}`);
      naloziZaposlene();
    });
  });
}

document.getElementById('btn-dodaj').addEventListener('click', async () => {
  const imeInput = document.getElementById('novo-ime');
  const napaka = document.getElementById('dodaj-napaka');
  napaka.style.display = 'none';

  const ime = imeInput.value.trim();
  if (!ime) { napaka.textContent = 'Vnesite ime.'; napaka.style.display = 'block'; return; }

  const res = await fetch('/api/admin/zaposleni', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ime })
  });

  if (res.ok) {
    imeInput.value = '';
    prikaziToast(`${ime} dodan`);
    naloziZaposlene();
  } else {
    const data = await res.json();
    napaka.textContent = data.napaka;
    napaka.style.display = 'block';
  }
});

document.getElementById('novo-ime').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-dodaj').click();
});

// ── EVIDENCA TAB ──────────────────────────────────────────────────────────────

// Default date range: last 30 days
const danes = new Date();
const pred30 = new Date(danes); pred30.setDate(pred30.getDate() - 30);
document.getElementById('filter-od').value = pred30.toISOString().slice(0, 10);
document.getElementById('filter-do').value = danes.toISOString().slice(0, 10);

async function naloziEvidenco() {
  const od  = document.getElementById('filter-od').value;
  const do_ = document.getElementById('filter-do').value;

  const res = await fetch(`/api/admin/evidenca?od=${od}&do=${do_}`);
  const zapisi = await res.json();

  const badge = document.getElementById('evidenca-stevilo');
  badge.textContent = zapisi.length;

  const prazno = document.getElementById('evidenca-prazno');
  const tbody = document.querySelector('#evidenca-tabela tbody');

  if (zapisi.length === 0) {
    tbody.innerHTML = '';
    prazno.style.display = 'block';
    return;
  }
  prazno.style.display = 'none';

  tbody.innerHTML = '';
  zapisi.forEach(z => {
    const dt = new Date(z.cas);
    const datum = dt.toLocaleDateString('sl-SI');
    const ura = dt.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${datum}</td>
      <td>${escHtml(z.ime)}</td>
      <td><span class="tip-pill ${z.tip}">${z.tip === 'PRIHOD' ? 'Prihod' : 'Odhod'}</span></td>
      <td>${ura}</td>
      <td><button class="btn-sm btn-danger" data-id="${z.id}">Izbriši</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-danger').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Izbrisati ta zapis?')) return;
      await fetch(`/api/admin/evidenca/${btn.dataset.id}`, { method: 'DELETE' });
      prikaziToast('Zapis izbrisan');
      naloziEvidenco();
    });
  });
}

document.getElementById('btn-iskanje').addEventListener('click', naloziEvidenco);

document.getElementById('btn-izvoz').addEventListener('click', () => {
  const od  = document.getElementById('filter-od').value;
  const do_ = document.getElementById('filter-do').value;
  window.location.href = `/api/admin/izvoz?od=${od}&do=${do_}`;
});

// ── NASTAVITVE TAB ────────────────────────────────────────────────────────────
document.getElementById('btn-geslo').addEventListener('click', async () => {
  const napaka = document.getElementById('geslo-napaka');
  const uspeh  = document.getElementById('geslo-uspeh');
  napaka.style.display = 'none';
  uspeh.style.display  = 'none';

  const staroGeslo = document.getElementById('staro-geslo').value;
  const novoGeslo  = document.getElementById('novo-geslo').value;
  const novoGeslo2 = document.getElementById('novo-geslo2').value;

  if (novoGeslo !== novoGeslo2) {
    napaka.textContent = 'Novi gesli se ne ujemata.';
    napaka.style.display = 'block';
    return;
  }

  const res = await fetch('/api/admin/geslo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staroGeslo, novoGeslo })
  });

  if (res.ok) {
    uspeh.textContent = 'Geslo uspešno spremenjeno.';
    uspeh.style.display = 'block';
    document.getElementById('staro-geslo').value = '';
    document.getElementById('novo-geslo').value = '';
    document.getElementById('novo-geslo2').value = '';
  } else {
    const data = await res.json();
    napaka.textContent = data.napaka;
    napaka.style.display = 'block';
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
naloziZaposlene();
naloziEvidenco();
