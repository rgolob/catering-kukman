// ── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'obracun') naloziObracunTab();
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
  try {
    const res = await fetch('/api/admin/zaposleni');
    if (res.status === 401 || res.redirected || res.url.includes('/login')) { window.location.href = '/login'; return; }
    if (!res.ok) {
      prikaziToast(`Napaka strežnika (${res.status}) — preveri nastavitve baze`, 'napaka');
      return;
    }
    const zaposleni = await res.json();
    if (!Array.isArray(zaposleni)) { prikaziToast('Napaka pri nalaganju zaposlenih', 'napaka'); return; }

  const tbody = document.querySelector('#zaposleni-tabela tbody');
  tbody.innerHTML = '';

  zaposleni.forEach(z => {
    const tr = document.createElement('tr');
    const jeAktiven = z.aktiven === 1;
    const pinPrikaz = z.pin ? `<code class="pin-koda">${z.pin}</code>` : '<span class="pin-ni">—</span>';

    const jePrivzetPin = z.pin_setup_required && z.pin === '1234';
    const pinSetupPill = z.pin_setup_required
      ? (jePrivzetPin ? '<span class="pin-setup-pill pin-privzet">Privzet PIN 1234</span>' : '<span class="pin-setup-pill">Čaka nastavitev</span>')
      : '';
    const upVrednost = z.urna_postavka ? `€${parseFloat(z.urna_postavka).toFixed(2)}` : '—';
    tr.innerHTML = `
      <td>${escHtml(z.ime)}</td>
      <td class="td-up">
        <div class="up-celica">
          <span class="up-euro-znak">€</span>
          <input type="number" class="up-input" value="${parseFloat(z.urna_postavka || 0).toFixed(2)}" min="0" step="0.10" placeholder="0.00" data-id="${z.id}" title="Urna postavka €/h" />
          <span class="up-unit">/h</span>
        </div>
      </td>
      <td class="td-pin">
        <div class="pin-celica">
          <span class="pin-vrednost">${pinPrikaz}</span>
          ${pinSetupPill}
          <button class="btn-sm btn-pin-uredi" data-id="${z.id}" data-pin="${z.pin || ''}">Uredi PIN</button>
          <button class="btn-sm btn-pin-ponastavi" data-id="${z.id}" data-ime="${escHtml(z.ime)}">Ponastavi PIN</button>
        </div>
        <div class="pin-uredi-vrstica" id="pin-vrstica-${z.id}" style="display:none">
          <input type="text" class="pin-input" maxlength="4" pattern="\\d{4}" placeholder="4 cifre" value="${z.pin || ''}" />
          <button class="btn-sm btn-pin-shrani" data-id="${z.id}">Shrani</button>
          <button class="btn-sm btn-pin-brisi" data-id="${z.id}">Briši PIN</button>
          <button class="btn-sm btn-pin-preklic" data-id="${z.id}">Prekliči</button>
        </div>
      </td>
      <td><span class="status-pill ${jeAktiven ? 'aktiven' : 'neaktiven'}">${jeAktiven ? 'Aktiven' : 'Neaktiven'}</span></td>
      <td>
        <button class="btn-sm btn-toggle ${jeAktiven ? '' : 'aktiviraj'}" data-id="${z.id}" data-aktiven="${jeAktiven ? 1 : 0}">
          ${jeAktiven ? 'Deaktiviraj' : 'Aktiviraj'}
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Urna postavka — shrani ob spremembi
  tbody.querySelectorAll('.up-input').forEach(input => {
    input.addEventListener('change', async () => {
      const vrednost = parseFloat(input.value);
      if (isNaN(vrednost) || vrednost < 0) { input.value = '0.00'; return; }
      const res = await fetch(`/api/admin/zaposleni/${input.dataset.id}/urna-postavka`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urnaPostavka: vrednost })
      });
      if (res.ok) {
        prikaziToast(`Urna postavka shranjena`);
        input.value = vrednost.toFixed(2);
      } else {
        prikaziToast('Napaka pri shranjevanju', 'napaka');
      }
    });
  });

  // PIN uredi
  tbody.querySelectorAll('.btn-pin-uredi').forEach(btn => {
    btn.addEventListener('click', () => {
      const vrstica = document.getElementById('pin-vrstica-' + btn.dataset.id);
      btn.style.display = 'none';
      vrstica.style.display = 'flex';
      vrstica.querySelector('.pin-input').focus();
    });
  });

  tbody.querySelectorAll('.btn-pin-ponastavi').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ime = btn.dataset.ime;
      if (!confirm(`Ponastavi PIN za "${ime}"?\n\nGenerirani začasni PIN bo prikazan samo enkrat. Zaposleni si bo moral nastaviti nov PIN ob naslednji prijavi.`)) return;
      const res = await fetch(`/api/admin/zaposleni/${btn.dataset.id}/ponastavi-pin`, { method: 'POST' });
      if (res.ok) {
        const d = await res.json();
        alert(`Začasni PIN za ${ime}:\n\n${d.tempPin}\n\nSporočite ga zaposlenemu. Ob naslednji prijavi si bo moral nastaviti nov PIN.`);
        naloziZaposlene();
      } else {
        prikaziToast('Napaka pri ponastavitvi PIN-a', 'napaka');
      }
    });
  });

  tbody.querySelectorAll('.btn-pin-preklic').forEach(btn => {
    btn.addEventListener('click', () => {
      const vrstica = document.getElementById('pin-vrstica-' + btn.dataset.id);
      vrstica.style.display = 'none';
      vrstica.closest('td').querySelector('.btn-pin-uredi').style.display = '';
    });
  });

  async function shraniPin(id, pin) {
    const res = await fetch(`/api/admin/zaposleni/${id}/pin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin || null })
    });
    if (res.ok) {
      prikaziToast(pin ? `PIN nastavljen` : `PIN izbrisan`);
      naloziZaposlene();
    } else {
      const d = await res.json();
      prikaziToast(d.napaka, 'napaka');
    }
  }

  tbody.querySelectorAll('.btn-pin-shrani').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('pin-vrstica-' + btn.dataset.id).querySelector('.pin-input');
      const pin = input.value.trim();
      if (pin && !/^\d{4}$/.test(pin)) {
        prikaziToast('PIN mora biti točno 4 cifre', 'napaka'); return;
      }
      shraniPin(btn.dataset.id, pin);
    });
  });

  tbody.querySelectorAll('.btn-pin-brisi').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('Izbrisati PIN tega zaposlenega?')) shraniPin(btn.dataset.id, null);
    });
  });

  tbody.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const jeAktiven = btn.dataset.aktiven === '1';
      const ime = btn.closest('tr').querySelector('td').textContent;
      if (!confirm(`${jeAktiven ? 'Deaktivirati' : 'Aktivirati'} zaposlenega "${ime}"?`)) return;
      await fetch(`/api/admin/zaposleni/${btn.dataset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aktiven: !jeAktiven })
      });
      prikaziToast(`${ime} ${jeAktiven ? 'deaktiviran' : 'aktiviran'}`);
      naloziZaposlene();
    });
  });
  } catch (e) {
    prikaziToast('Ni povezave s strežnikom', 'napaka');
    console.error(e);
  }
}

document.getElementById('btn-dodaj').addEventListener('click', async () => {
  const imeInput = document.getElementById('novo-ime');
  const napaka = document.getElementById('dodaj-napaka');
  napaka.style.display = 'none';

  const ime = imeInput.value.trim();
  if (!ime) { napaka.textContent = 'Vnesite ime.'; napaka.style.display = 'block'; return; }

  try {
    const res = await fetch('/api/admin/zaposleni', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ime })
    });

    if (res.redirected || res.url.includes('/login')) {
      window.location.href = '/login'; return;
    }

    if (res.ok) {
      imeInput.value = '';
      prikaziToast(`${ime} dodan`);
      naloziZaposlene();
    } else {
      const data = await res.json();
      napaka.textContent = data.napaka || 'Napaka pri dodajanju';
      napaka.style.display = 'block';
    }
  } catch (e) {
    napaka.textContent = 'Napaka: ni povezave s strežnikom';
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

  try {
    const res = await fetch(`/api/admin/evidenca?od=${od}&do=${do_}`);
    if (res.status === 401 || res.redirected || res.url.includes('/login')) { window.location.href = '/login'; return; }
    if (!res.ok) { prikaziToast(`Napaka strežnika (${res.status})`, 'napaka'); return; }
    const zapisi = await res.json();
    if (!Array.isArray(zapisi)) { prikaziToast('Napaka pri nalaganju evidenc', 'napaka'); return; }

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
    const nakNapis = z.naknadno ? ' <span class="nk-pill">NK</span>' : '';
    tr.innerHTML = `
      <td>${datum}</td>
      <td>${escHtml(z.ime)}</td>
      <td><span class="tip-pill ${z.tip}">${z.tip === 'PRIHOD' ? 'Prihod' : 'Odhod'}</span></td>
      <td>${ura}${nakNapis}</td>
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
  } catch (e) {
    prikaziToast('Ni povezave s strežnikom', 'napaka');
    console.error(e);
  }
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

// ── OBRAČUN TAB ───────────────────────────────────────────────────────────────
const MESECI_OBR = ['Januar','Februar','Marec','April','Maj','Junij',
                    'Julij','Avgust','September','Oktober','November','December'];

let obrLeto, obrMesec;

function formatEur(n) {
  if (n == null) return '—';
  return '€' + parseFloat(n).toFixed(2);
}
function formatUre(min) {
  if (!min) return '0u';
  const u = Math.floor(min / 60), m = min % 60;
  return m ? `${u}u ${m}m` : `${u}u`;
}

async function naloziObracun() {
  document.getElementById('obr-mesec-napis').textContent =
    `${MESECI_OBR[obrMesec - 1]} ${obrLeto}`;

  const zdaj = new Date();
  const jeTekochiMesec = obrLeto === zdaj.getFullYear() && obrMesec === (zdaj.getMonth() + 1);
  document.getElementById('obr-btn-naprej').disabled = jeTekochiMesec;

  try {
    const [resObr, resStim] = await Promise.all([
      fetch(`/api/admin/obracun?leto=${obrLeto}&mesec=${obrMesec}`),
      fetch(`/api/admin/stimulacija?mesec=${obrLeto}-${String(obrMesec).padStart(2,'0')}`)
    ]);

    if (!resObr.ok) { prikaziToast('Napaka pri nalaganju obračuna', 'napaka'); return; }
    const { obracun } = await resObr.json();
    const stimulacije = resStim.ok ? await resStim.json() : [];

    // Obračun tabela
    const tbody = document.getElementById('obracun-tbody');
    const prazno = document.getElementById('obracun-prazno');

    let skupajMin = 0, skupajOsnova = 0, skupajStim = 0, skupajVse = 0;
    tbody.innerHTML = obracun.map(z => {
      skupajMin += z.minute || 0;
      skupajOsnova += z.osnova || 0;
      skupajStim += z.stimulacija || 0;
      skupajVse += z.skupaj || 0;
      return `<tr>
        <td>${escHtml(z.ime)}</td>
        <td class="td-r">${formatUre(z.minute)}</td>
        <td class="td-r">${z.urnaPostavka ? `€${parseFloat(z.urnaPostavka).toFixed(2)}` : '—'}</td>
        <td class="td-r">${formatEur(z.osnova)}</td>
        <td class="td-r">${z.stimulacija ? formatEur(z.stimulacija) : '—'}</td>
        <td class="td-r td-skupaj">${z.skupaj ? formatEur(z.skupaj) : '—'}</td>
      </tr>`;
    }).join('') + (obracun.length ? `<tr class="obr-skupaj-row">
        <td><strong>SKUPAJ</strong></td>
        <td class="td-r"><strong>${formatUre(skupajMin)}</strong></td>
        <td class="td-r">—</td>
        <td class="td-r"><strong>${formatEur(skupajOsnova)}</strong></td>
        <td class="td-r"><strong>${skupajStim ? formatEur(skupajStim) : '—'}</strong></td>
        <td class="td-r td-skupaj"><strong>${formatEur(skupajVse)}</strong></td>
      </tr>` : '');

    prazno.style.display = obracun.length ? 'none' : 'block';

    // Stimulacija tabela + dropdown
    await naloziStimulacije(stimulacije);

  } catch(e) {
    prikaziToast('Napaka pri nalaganju', 'napaka');
    console.error(e);
  }
}

async function naloziStimulacije(stimulacije) {
  // Posodobi dropdown z aktivnimi zaposlenimi
  try {
    const res = await fetch('/api/admin/zaposleni');
    if (res.ok) {
      const zaposleni = await res.json();
      const sel = document.getElementById('stim-zaposleni');
      sel.innerHTML = zaposleni.filter(z => z.aktiven).map(z =>
        `<option value="${z.id}">${escHtml(z.ime)}</option>`
      ).join('');
    }
  } catch(_) {}

  const tbody = document.getElementById('stim-tbody');
  const prazno = document.getElementById('stim-prazno');

  if (!Array.isArray(stimulacije) || stimulacije.length === 0) {
    tbody.innerHTML = '';
    prazno.style.display = 'block';
    return;
  }
  prazno.style.display = 'none';

  tbody.innerHTML = stimulacije.map(s => `
    <tr>
      <td>${escHtml(s.ime)}</td>
      <td class="td-r">${formatEur(s.znesek)}</td>
      <td>${escHtml(s.opomba || '—')}</td>
      <td><button class="btn-sm btn-danger btn-stim-brisi" data-id="${s.id}">Izbriši</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-stim-brisi').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Izbrisati to stimulacijo?')) return;
      const res = await fetch(`/api/admin/stimulacija/${btn.dataset.id}`, { method: 'DELETE' });
      if (res.ok) { prikaziToast('Stimulacija izbrisana'); naloziObracun(); }
      else prikaziToast('Napaka pri brisanju', 'napaka');
    });
  });
}

document.getElementById('obr-btn-prej').addEventListener('click', () => {
  obrMesec--;
  if (obrMesec < 1) { obrMesec = 12; obrLeto--; }
  naloziObracun();
});

document.getElementById('obr-btn-naprej').addEventListener('click', () => {
  obrMesec++;
  if (obrMesec > 12) { obrMesec = 1; obrLeto++; }
  naloziObracun();
});

document.getElementById('btn-dodaj-stim').addEventListener('click', async () => {
  const napaka = document.getElementById('stim-napaka');
  napaka.style.display = 'none';
  const zaposleniId = document.getElementById('stim-zaposleni').value;
  const znesek = document.getElementById('stim-znesek').value;
  const opomba = document.getElementById('stim-opomba').value.trim();
  const mesec = `${obrLeto}-${String(obrMesec).padStart(2,'0')}`;

  if (!zaposleniId || !znesek || parseFloat(znesek) <= 0) {
    napaka.textContent = 'Izberite zaposlenega in vnesite znesek.';
    napaka.style.display = 'block'; return;
  }

  const res = await fetch('/api/admin/stimulacija', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zaposleniId, mesec, znesek: parseFloat(znesek), opomba })
  });

  if (res.ok) {
    document.getElementById('stim-znesek').value = '';
    document.getElementById('stim-opomba').value = '';
    prikaziToast('Stimulacija dodana');
    naloziObracun();
  } else {
    const d = await res.json();
    napaka.textContent = d.napaka || 'Napaka';
    napaka.style.display = 'block';
  }
});

function naloziObracunTab() {
  if (!obrLeto) {
    const zdaj = new Date();
    obrLeto = zdaj.getFullYear();
    obrMesec = zdaj.getMonth() + 1;
  }
  naloziObracun();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
naloziZaposlene();
naloziEvidenco();
