// ── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'evidenca') { naloziEvidenco(); naloziRvZaposlene(); }
    if (btn.dataset.tab === 'obracun') naloziObracunTab();
    if (btn.dataset.tab === 'prisotnost') naloziPrisotnostTab();
    if (btn.dataset.tab === 'zahtevki') naloziZahtevkiTab();
    if (btn.dataset.tab === 'lestvica') naloziLestvicaTab();
    if (btn.dataset.tab === 'dela') naloziDelaTab();
    if (btn.dataset.tab === 'nastavitve') { naloziNapraveTab(); naloziUvozTekst(); }
  });
});

// ── Odjava ────────────────────────────────────────────────────────────────────
document.getElementById('btn-odjava').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/prisotnost/login';
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
    if (res.status === 401 || res.redirected || res.url.includes('/login')) { window.location.href = '/prisotnost/login'; return; }
    if (!res.ok) {
      prikaziToast(`Napaka strežnika (${res.status}) — preveri nastavitve baze`, 'napaka');
      return;
    }
    const zaposleni = await res.json();
    if (!Array.isArray(zaposleni)) { prikaziToast('Napaka pri nalaganju zaposlenih', 'napaka'); return; }

  const seznam = document.getElementById('zaposleni-seznam');
  seznam.innerHTML = '';

  zaposleni.forEach(z => {
    const jeAktiven = z.aktiven === 1;
    const jePrivzetPin = z.pin_setup_required && z.pin === '1234';
    const pinOpozorilo = z.pin_setup_required
      ? `<span class="zap-pin-opozorilo" title="${jePrivzetPin ? 'Privzet PIN 1234' : 'Čaka nastavitev PIN-a'}">&#9888;</span>`
      : '';

    const kartica = document.createElement('div');
    kartica.className = 'zap-kartica' + (jeAktiven ? '' : ' zap-kartica-neaktivna');
    kartica.dataset.id = z.id;
    kartica.innerHTML = `
      <div class="zap-kartica-glava">
        <div class="zap-kartica-levo">
          <span class="zap-kartica-ime">${escHtml(z.ime)}</span>
          <div class="zap-ime-uredi-vrstica" style="display:none">
            <input class="zap-ime-input" value="${escHtml(z.ime)}" maxlength="60" />
            <button class="btn-sm btn-zap-ime-shrani" data-id="${z.id}">✓</button>
            <button class="btn-sm btn-zap-ime-preklic">✕</button>
          </div>
          ${pinOpozorilo}
        </div>
        <div class="zap-kartica-desno">
          <span class="status-pill ${jeAktiven ? 'aktiven' : 'neaktiven'}">${jeAktiven ? 'Aktiven' : 'Neaktiven'}</span>
          <button class="btn-sm btn-zap-ime-uredi zap-pencil" title="Uredi ime" data-id="${z.id}">✎</button>
          <span class="zap-chevron">›</span>
        </div>
      </div>
      <div class="zap-kartica-podrobnosti">
        <div class="zap-podrobnosti-vrstica">
          <span class="zap-podrobnosti-oznaka">Privzeto delo</span>
          <select class="privzeto-delo-select" data-id="${z.id}">
            <option value="">— Brez —</option>
          </select>
        </div>
        <div class="zap-podrobnosti-vrstica">
          <span class="zap-podrobnosti-oznaka">Dovoljene vloge</span>
          <div class="dela-checkboxes" id="dela-cb-${z.id}"></div>
        </div>
        <div class="zap-podrobnosti-vrstica">
          <span class="zap-podrobnosti-oznaka">PIN</span>
          <div class="pin-celica">
            <div class="pin-prikaz-vrstica" id="pin-prikaz-${z.id}">
              <span class="pin-zvezdice">••••</span>
              <button class="btn-sm btn-pin-razkrij" data-id="${z.id}">Razkrij</button>
              <button class="btn-sm btn-pin-uredi" data-id="${z.id}">Uredi</button>
              <button class="btn-sm btn-pin-ponastavi" data-id="${z.id}" data-ime="${escHtml(z.ime)}">Ponastavi</button>
            </div>
            <div class="pin-razkrit-vrstica" id="pin-razkrit-${z.id}" style="display:none">
              ${z.pin ? `<code class="pin-koda">${z.pin}</code>` : '<span class="pin-ni">Ni PIN-a</span>'}
              ${z.pin_setup_required ? `<span class="pin-setup-pill${jePrivzetPin ? ' pin-privzet' : ''}">${jePrivzetPin ? 'Privzet 1234' : 'Čaka nastavitev'}</span>` : ''}
              <button class="btn-sm btn-pin-skrij" data-id="${z.id}">Skrij</button>
            </div>
            <div class="pin-uredi-vrstica" id="pin-vrstica-${z.id}" style="display:none">
              <input type="text" class="pin-input" maxlength="4" pattern="\\d{4}" placeholder="4 cifre" value="${z.pin || ''}" />
              <button class="btn-sm btn-pin-shrani" data-id="${z.id}">Shrani</button>
              <button class="btn-sm btn-pin-brisi" data-id="${z.id}">Briši PIN</button>
              <button class="btn-sm btn-pin-preklic" data-id="${z.id}">Prekliči</button>
            </div>
          </div>
        </div>
        <div class="zap-podrobnosti-akcije">
          <button class="btn-sm btn-toggle ${jeAktiven ? '' : 'aktiviraj'}" data-id="${z.id}" data-aktiven="${jeAktiven ? 1 : 0}">
            ${jeAktiven ? 'Deaktiviraj' : 'Aktiviraj'}
          </button>
        </div>
      </div>
    `;
    seznam.appendChild(kartica);

    // Toggle expand/collapse on header click
    kartica.querySelector('.zap-kartica-glava').addEventListener('click', () => {
      kartica.classList.toggle('zap-odprta');
    });

    // Uredi ime
    kartica.querySelector('.btn-zap-ime-uredi').addEventListener('click', e => {
      e.stopPropagation();
      kartica.querySelector('.zap-kartica-ime').style.display = 'none';
      const v = kartica.querySelector('.zap-ime-uredi-vrstica');
      v.style.display = 'flex';
      v.querySelector('.zap-ime-input').focus();
      kartica.querySelector('.btn-zap-ime-uredi').style.display = 'none';
    });
    kartica.querySelector('.btn-zap-ime-preklic').addEventListener('click', e => {
      e.stopPropagation();
      kartica.querySelector('.zap-kartica-ime').style.display = '';
      kartica.querySelector('.zap-ime-uredi-vrstica').style.display = 'none';
      kartica.querySelector('.btn-zap-ime-uredi').style.display = '';
    });
    kartica.querySelector('.btn-zap-ime-shrani').addEventListener('click', async e => {
      e.stopPropagation();
      const input = kartica.querySelector('.zap-ime-input');
      const novoIme = input.value.trim();
      if (!novoIme) return;
      const res = await fetch(`/api/admin/zaposleni/${z.id}/ime`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ime: novoIme })
      });
      if (res.ok) { prikaziToast('Ime posodobljeno'); naloziZaposlene(); }
      else { const d = await res.json(); prikaziToast(d.napaka || 'Napaka', 'napaka'); }
    });
    kartica.querySelector('.zap-ime-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') kartica.querySelector('.btn-zap-ime-shrani').click();
      if (e.key === 'Escape') kartica.querySelector('.btn-zap-ime-preklic').click();
    });
    kartica.querySelector('.zap-ime-input').addEventListener('click', e => e.stopPropagation());
  });

  // Privzeto delo + Dovoljene vloge
  const delaRes = await fetch('/api/dela');
  const vsaDela = delaRes.ok ? await delaRes.json() : [];

  function getCheckedDelaIds(zId) {
    const container = document.getElementById(`dela-cb-${zId}`);
    const sel = document.querySelector(`.privzeto-delo-select[data-id="${zId}"]`);
    const privzetoId = sel?.value ? Number(sel.value) : null;
    const checked = container
      ? [...container.querySelectorAll('input[type="checkbox"]')]
          .filter(c => c.checked).map(c => Number(c.value))
      : [];
    if (privzetoId && !checked.includes(privzetoId)) checked.push(privzetoId);
    return checked;
  }

  async function saveVloge(zId) {
    const delaIds = getCheckedDelaIds(zId);
    const res = await fetch(`/api/admin/zaposleni/${zId}/dela`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delaIds })
    });
    if (res.ok) prikaziToast('Vloge posodobljene');
    else prikaziToast('Napaka pri shranjevanju', 'napaka');
  }

  seznam.querySelectorAll('.privzeto-delo-select').forEach(sel => {
    sel.addEventListener('click', e => e.stopPropagation());
    const zId = Number(sel.dataset.id);
    const zaposlen = zaposleni.find(z => Number(z.id) === zId);
    vsaDela.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.naziv} (€${parseFloat(d.urna_postavka).toFixed(2)}/h)`;
      if (Number(zaposlen?.privzeto_delo_id) === Number(d.id)) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', async () => {
      const newDeloId = sel.value ? Number(sel.value) : null;
      const oldDeloId = Number(zaposlen?.privzeto_delo_id) || null;
      // Update checkbox state in DOM
      const container = document.getElementById(`dela-cb-${zId}`);
      if (container) {
        if (oldDeloId) {
          const oldCb = container.querySelector(`input[value="${oldDeloId}"]`);
          if (oldCb) { oldCb.disabled = false; oldCb.closest('.dela-pill').classList.remove('dela-pill-privzeto'); }
        }
        if (newDeloId) {
          const newCb = container.querySelector(`input[value="${newDeloId}"]`);
          if (newCb) { newCb.disabled = true; newCb.checked = true; newCb.closest('.dela-pill').classList.add('dela-pill-privzeto', 'dela-pill-checked'); }
        }
      }
      zaposlen.privzeto_delo_id = newDeloId;
      const res = await fetch(`/api/admin/zaposleni/${zId}/privzeto-delo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deloId: newDeloId })
      });
      if (res.ok) { await saveVloge(zId); prikaziToast('Privzeto delo shranjeno'); }
      else prikaziToast('Napaka pri shranjevanju', 'napaka');
    });
  });

  // Dovoljene vloge — pill checkboxes
  seznam.querySelectorAll('[id^="dela-cb-"]').forEach(container => {
    const zId = Number(container.id.replace('dela-cb-', ''));
    const zaposlen = zaposleni.find(z => Number(z.id) === zId);
    const zDelaIds = zaposlen?.dela_ids || [];
    container.addEventListener('click', e => e.stopPropagation());
    vsaDela.forEach(d => {
      const deloId = Number(d.id);
      const isDefault = Number(zaposlen?.privzeto_delo_id) === deloId;
      const isChecked = zDelaIds.includes(deloId) || isDefault;
      const pill = document.createElement('label');
      pill.className = 'dela-pill' + (isChecked ? ' dela-pill-checked' : '') + (isDefault ? ' dela-pill-privzeto' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = deloId;
      cb.checked = isChecked;
      cb.disabled = isDefault;
      cb.addEventListener('change', () => {
        pill.classList.toggle('dela-pill-checked', cb.checked);
        saveVloge(zId);
      });
      pill.appendChild(cb);
      pill.appendChild(document.createTextNode(d.naziv));
      container.appendChild(pill);
    });
  });

  // PIN razkrij / skrij
  seznam.querySelectorAll('.btn-pin-razkrij').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('pin-prikaz-' + btn.dataset.id).style.display = 'none';
      document.getElementById('pin-razkrit-' + btn.dataset.id).style.display = 'flex';
    });
  });
  seznam.querySelectorAll('.btn-pin-skrij').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('pin-razkrit-' + btn.dataset.id).style.display = 'none';
      document.getElementById('pin-prikaz-' + btn.dataset.id).style.display = 'flex';
    });
  });

  // PIN uredi
  seznam.querySelectorAll('.btn-pin-uredi').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('pin-prikaz-' + btn.dataset.id).style.display = 'none';
      const vrstica = document.getElementById('pin-vrstica-' + btn.dataset.id);
      vrstica.style.display = 'flex';
      vrstica.querySelector('.pin-input').focus();
    });
  });

  seznam.querySelectorAll('.btn-pin-ponastavi').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
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

  seznam.querySelectorAll('.btn-pin-preklic').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('pin-vrstica-' + btn.dataset.id).style.display = 'none';
      document.getElementById('pin-prikaz-' + btn.dataset.id).style.display = 'flex';
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

  seznam.querySelectorAll('.btn-pin-shrani').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const input = document.getElementById('pin-vrstica-' + btn.dataset.id).querySelector('.pin-input');
      const pin = input.value.trim();
      if (pin && !/^\d{4}$/.test(pin)) {
        prikaziToast('PIN mora biti točno 4 cifre', 'napaka'); return;
      }
      shraniPin(btn.dataset.id, pin);
    });
  });

  seznam.querySelectorAll('.btn-pin-brisi').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (confirm('Izbrisati PIN tega zaposlenega?')) shraniPin(btn.dataset.id, null);
    });
  });

  seznam.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const jeAktiven = btn.dataset.aktiven === '1';
      const ime = btn.closest('.zap-kartica').querySelector('.zap-kartica-ime').textContent;
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
      window.location.href = '/prisotnost/login'; return;
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

// Default date range: last 3 days
function lokalniDatumStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
const danes = new Date();
const pred2Dnevi = new Date(danes); pred2Dnevi.setDate(danes.getDate() - 2);
document.getElementById('filter-od').value = lokalniDatumStr(pred2Dnevi);
document.getElementById('filter-do').value = lokalniDatumStr(danes);

async function naloziEvidenco() {
  const od  = document.getElementById('filter-od').value;
  const do_ = document.getElementById('filter-do').value;
  const zapId = document.getElementById('filter-zaposleni').value;

  try {
    const url = `/api/admin/evidenca?od=${od}&do=${do_}` + (zapId ? `&zaposleniId=${zapId}` : '');
    const res = await fetch(url);
    if (res.status === 401 || res.redirected || res.url.includes('/login')) { window.location.href = '/prisotnost/login'; return; }
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
    const delaNapis = z.dodatna_dela ? `<br><span class="ev-dela-badge">${escHtml(z.dodatna_dela)}</span>` : '';
    tr.innerHTML = `
      <td>${datum}</td>
      <td>${escHtml(z.ime)}</td>
      <td><span class="tip-pill ${z.tip}">${z.tip === 'PRIHOD' ? 'Prihod' : 'Odhod'}</span>${delaNapis}</td>
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
    const [resObr, resStim, resAkt] = await Promise.all([
      fetch(`/api/admin/obracun?leto=${obrLeto}&mesec=${obrMesec}`),
      fetch(`/api/admin/stimulacija?mesec=${obrLeto}-${String(obrMesec).padStart(2,'0')}`),
      fetch(`/api/admin/akontacija?mesec=${obrLeto}-${String(obrMesec).padStart(2,'0')}`)
    ]);

    if (!resObr.ok) { prikaziToast('Napaka pri nalaganju obračuna', 'napaka'); return; }
    const { obracun } = await resObr.json();
    const stimulacije = resStim.ok ? await resStim.json() : [];
    const akontacije = resAkt.ok ? await resAkt.json() : [];

    // Obračun tabela
    const tbody = document.getElementById('obracun-tbody');
    const prazno = document.getElementById('obracun-prazno');

    // Grupiranje akontacij po zaposlenem za prikaz v celici
    const aktPoId = new Map();
    akontacije.forEach(a => {
      const zid = Number(a.zaposleni_id);
      if (!aktPoId.has(zid)) aktPoId.set(zid, []);
      aktPoId.get(zid).push(a);
    });

    let skupajMin = 0, skupajOsnova = 0, skupajStim = 0, skupajVse = 0, skupajGorivo = 0, skupajNakup = 0, skupajAkt = 0, skupajPreostalo = 0;
    tbody.innerHTML = obracun.map(z => {
      skupajMin += z.minute || 0;
      skupajOsnova += z.osnova || 0;
      skupajStim += z.stimulacija || 0;
      skupajVse += z.skupaj || 0;
      skupajGorivo += z.gorivo || 0;
      skupajNakup += z.nakup || 0;
      skupajAkt += z.akontacija || 0;
      skupajPreostalo += z.preostalo || 0;
      const vsaDela = [];
      if (z.privzetaMinuta > 0 && z.privzetoDelo) vsaDela.push({ minute: z.privzetaMinuta, naziv: z.privzetoDelo.naziv });
      (z.dodatnaDela || []).forEach(d => vsaDela.push({ minute: d.minute, naziv: d.naziv }));
      const delaBreakdown = vsaDela.length > 1
        ? '<br><span class="td-ure-sub">' + vsaDela.map(d => `${formatUre(d.minute)} ${escHtml(d.naziv)}`).join(' + ') + '</span>'
        : vsaDela.length === 1 ? `<br><span class="td-ure-sub">${escHtml(vsaDela[0].naziv)}</span>` : '';
      const zAkt = aktPoId.get(z.id) || [];
      const aktSubtext = zAkt.map(a =>
        `<br><span class="td-ure-sub">${a.datum.slice(5).replace('-','.')} ${formatEur(a.znesek)}${a.opomba ? ` · ${escHtml(a.opomba)}` : ''}</span>`
      ).join('');
      return `<tr>
        <td><span class="obr-ime-link" data-id="${z.id}" style="cursor:pointer;color:#2b6cb0;text-decoration:underline">${escHtml(z.ime)}</span> <button class="obr-vnos-btn" data-id="${z.id}" title="Dodaj strošek / akontacijo">+</button></td>
        <td class="td-r td-osnova">${formatEur(z.osnova)}<br><span class="td-ure-sub">${formatUre(z.minute)}</span>${delaBreakdown}</td>
        <td class="td-r">${z.gorivo ? formatEur(z.gorivo) : '—'}</td>
        <td class="td-r">${z.nakup ? formatEur(z.nakup) : '—'}</td>
        <td class="td-r td-skupaj">${z.skupaj ? formatEur(z.skupaj) : '—'}${z.stimulacija ? `<br><span class="td-ure-sub">+ ${formatEur(z.stimulacija)} stim</span>` : ''}</td>
        <td class="td-r">${z.akontacija ? formatEur(z.akontacija) : '—'}${aktSubtext}</td>
        <td class="td-r td-skupaj">${z.preostalo != null ? `<strong>${formatEur(z.preostalo)}</strong>` : '—'}</td>
      </tr>`;
    }).join('') + (obracun.length ? `<tr class="obr-skupaj-row">
        <td><strong>SKUPAJ</strong></td>
        <td class="td-r td-osnova"><strong>${formatEur(skupajOsnova)}</strong><br><span class="td-ure-sub">${formatUre(skupajMin)}</span></td>
        <td class="td-r">${skupajGorivo ? `<strong>${formatEur(skupajGorivo)}</strong>` : '—'}</td>
        <td class="td-r">${skupajNakup ? `<strong>${formatEur(skupajNakup)}</strong>` : '—'}</td>
        <td class="td-r td-skupaj"><strong>${formatEur(skupajVse)}</strong>${skupajStim ? `<br><span class="td-ure-sub">+ ${formatEur(skupajStim)} stim</span>` : ''}</td>
        <td class="td-r">${skupajAkt ? `<strong>${formatEur(skupajAkt)}</strong>` : '—'}</td>
        <td class="td-r td-skupaj"><strong>${formatEur(skupajPreostalo)}</strong></td>
      </tr>` : '');

    prazno.style.display = obracun.length ? 'none' : 'block';

    tbody.querySelectorAll('.obr-ime-link').forEach(el => {
      el.addEventListener('click', () => odpriPrisModal(Number(el.dataset.id), obrLeto, obrMesec));
    });

    tbody.querySelectorAll('.obr-vnos-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const zid = Number(btn.dataset.id);
        const z = obracun.find(x => x.id === zid);
        odpriVnosPopup(zid, z ? z.ime : '', aktPoId.get(zid) || [], z ? z.skupaj : null);
      });
    });

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

let _vnosZaposleniId = null, _vnosSkupaj = null;

async function odpriVnosPopup(zaposleniId, ime, zAkt, skupaj) {
  _vnosZaposleniId = zaposleniId;
  _vnosSkupaj = skupaj;
  document.getElementById('vnos-popup-ime').textContent = ime;
  document.getElementById('vnos-popup-datum').value = '';
  document.getElementById('vnos-gorivo').value = '';
  document.getElementById('vnos-nakup').value = '';
  document.getElementById('vnos-znesek').value = '';
  document.getElementById('vnos-popup-komentar').value = '';
  document.getElementById('vnos-popup-napaka').textContent = '';
  posodobiVnosTip('strosek');

  // Naloži in prikaži obstoječe vnose
  const mesecStr = `${obrLeto}-${String(obrMesec).padStart(2,'0')}`;
  const seznam = document.getElementById('vnos-popup-seznam');
  seznam.innerHTML = '<div class="akt-popup-prazno">Nalaganje…</div>';
  document.getElementById('vnos-popup-overlay').classList.remove('hidden');

  const kmRes = await fetch(`/api/admin/kilometrina?zaposleniId=${zaposleniId}&od=${mesecStr}-01&do=${mesecStr}-31`).catch(() => null);
  const kmVnosi = kmRes && kmRes.ok ? await kmRes.json() : [];
  prikaziVnosSeznam(zaposleniId, zAkt, kmVnosi);
}

function prikaziVnosSeznam(zaposleniId, zAkt, kmVnosi) {
  const seznam = document.getElementById('vnos-popup-seznam');
  const vsi = [
    ...kmVnosi.filter(k => k.km > 0 || k.strosek > 0).map(k => ({
      tip: 'km', datum: k.datum,
      label: `${k.datum.slice(5).replace('-','.')} ${k.km > 0 ? `⛽ ${formatEur(k.km)}` : ''} ${k.strosek > 0 ? `🛍 ${formatEur(k.strosek)}` : ''}`.trim(),
      brisiUrl: `/api/admin/kilometrina/${zaposleniId}/${k.datum}`
    })),
    ...zAkt.map(a => ({
      tip: 'akt', datum: a.datum,
      label: `${a.datum ? a.datum.slice(5).replace('-','.') : '—'} 💰 ${formatEur(a.znesek)}${a.opomba ? ` · ${escHtml(a.opomba)}` : ''}`,
      brisiUrl: `/api/admin/akontacija/${a.id}`
    }))
  ].sort((a, b) => a.datum < b.datum ? -1 : 1);

  if (!vsi.length) {
    seznam.innerHTML = '<div class="akt-popup-prazno">Ni vnosov za ta mesec.</div>';
    return;
  }
  seznam.innerHTML = vsi.map((v, i) => `
    <div class="akt-popup-item">
      <span>${v.label}</span>
      <button class="btn-sm btn-danger btn-vnos-brisi" data-i="${i}">×</button>
    </div>`).join('');
  seznam.querySelectorAll('.btn-vnos-brisi').forEach(btn => {
    const v = vsi[Number(btn.dataset.i)];
    btn.addEventListener('click', async () => {
      const res = await fetch(v.brisiUrl, { method: 'DELETE' });
      if (res.ok) { zapriVnosPopup(); naloziObracun(); }
      else prikaziToast('Napaka pri brisanju', 'napaka');
    });
  });
}

function zapriVnosPopup() {
  document.getElementById('vnos-popup-overlay').classList.add('hidden');
  _vnosZaposleniId = null;
}

document.getElementById('vnos-popup-zapri').addEventListener('click', zapriVnosPopup);
document.getElementById('vnos-popup-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('vnos-popup-overlay')) zapriVnosPopup();
});

function posodobiVnosTip(tip) {
  const jeAkt = tip === 'akontacija';
  document.querySelectorAll('.vnos-tip-btn').forEach(b => b.classList.toggle('active', b.dataset.tip === tip));
  document.getElementById('vnos-strosek-polja').style.display = jeAkt ? 'none' : '';
  document.getElementById('vnos-akt-polja').style.display = jeAkt ? '' : 'none';
  const infoEl = document.getElementById('vnos-skupaj-info');
  if (jeAkt && _vnosSkupaj != null) {
    infoEl.textContent = `Zaslužil ta mesec: ${formatEur(_vnosSkupaj)}`;
    infoEl.style.display = '';
  } else {
    infoEl.style.display = 'none';
  }
}

document.querySelectorAll('.vnos-tip-btn').forEach(btn => {
  btn.addEventListener('click', () => posodobiVnosTip(btn.dataset.tip));
});

document.getElementById('vnos-popup-dodaj').addEventListener('click', async () => {
  const napaka = document.getElementById('vnos-popup-napaka');
  napaka.textContent = '';
  const zaposleniId = _vnosZaposleniId;
  const datum = document.getElementById('vnos-popup-datum').value;
  const komentar = document.getElementById('vnos-popup-komentar').value.trim();
  const mesec = `${obrLeto}-${String(obrMesec).padStart(2,'0')}`;
  if (!datum) { napaka.textContent = 'Izberi datum.'; return; }

  const jeAkt = document.querySelector('.vnos-tip-btn.active')?.dataset.tip === 'akontacija';
  let res;
  if (jeAkt) {
    const znesek = parseFloat(document.getElementById('vnos-znesek').value);
    if (!znesek) { napaka.textContent = 'Vnesite znesek.'; return; }
    res = await fetch('/api/admin/akontacija', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zaposleniId, mesec, datum, znesek, opomba: komentar })
    });
  } else {
    const gorivo = parseFloat(document.getElementById('vnos-gorivo').value) || 0;
    const nakup = parseFloat(document.getElementById('vnos-nakup').value) || 0;
    if (!gorivo && !nakup) { napaka.textContent = 'Vnesite gorivo ali nakup.'; return; }
    res = await fetch('/api/admin/kilometrina', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zaposleniId, datum, km: gorivo, strosek: nakup })
    });
  }
  if (res.ok) { zapriVnosPopup(); naloziObracun(); }
  else { const d = await res.json(); napaka.textContent = d.napaka || 'Napaka'; }
});

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

// ── PRISOTNOST TAB ────────────────────────────────────────────────────────────
const MESECI_PRIS = ['Januar','Februar','Marec','April','Maj','Junij',
                     'Julij','Avgust','September','Oktober','November','December'];
const DNI_PRIS = ['ned','pon','tor','sre','čet','pet','sob'];

let prisLeto, prisMesec;

function naloziPrisotnostTab() {
  if (!prisLeto) {
    const zdaj = new Date();
    prisLeto = zdaj.getFullYear();
    prisMesec = zdaj.getMonth() + 1;
  }
  naloziPrisotnost();
}

async function naloziPrisotnost() {
  const zdaj = new Date();
  document.getElementById('pris-mesec-napis').textContent =
    `${MESECI_PRIS[prisMesec - 1]} ${prisLeto}`;
  document.getElementById('pris-btn-naprej').disabled =
    prisLeto === zdaj.getFullYear() && prisMesec === zdaj.getMonth() + 1;

  try {
    const res = await fetch(`/api/admin/prisotnost?leto=${prisLeto}&mesec=${prisMesec}`);
    if (!res.ok) return;
    const { seznam } = await res.json();

    const container = document.getElementById('prisotnost-seznam');
    const prazno = document.getElementById('prisotnost-prazno');

    if (!seznam.length) {
      container.innerHTML = '';
      prazno.style.display = 'block';
      return;
    }
    prazno.style.display = 'none';

    container.innerHTML = seznam.map(z => {
      const ure = formatUre(z.skupajMinut);
      const nak = z.steviloNaknadno
        ? `<span class="pris-nak-badge">${z.steviloNaknadno} naknadno</span>` : '';
      return `<div class="pris-kartica" data-id="${z.id}">
        <div class="pris-ime">${escHtml(z.ime)}</div>
        <div class="pris-ure">${ure}</div>
        <div class="pris-stat">${z.steviloDni} dni ${nak}</div>
      </div>`;
    }).join('');

    container.querySelectorAll('.pris-kartica').forEach(k => {
      k.addEventListener('click', () => odpriPrisModal(Number(k.dataset.id)));
    });
  } catch(e) { console.error(e); }
}

async function odpriPrisModal(zaposleniId, leto, mesec) {
  leto = leto || prisLeto;
  mesec = mesec || prisMesec;
  try {
    const res = await fetch(`/api/admin/prisotnost/${zaposleniId}?leto=${leto}&mesec=${mesec}`);
    if (!res.ok) return;
    const d = await res.json();

    document.getElementById('pris-modal-ime').textContent = d.ime;
    document.getElementById('pris-modal-povzetek').textContent =
      `${MESECI_PRIS[d.mesec - 1]} ${d.leto}  ·  Skupaj: ${formatUre(d.skupajMinut)}  ·  ${d.dnevi.length} dni`;

    const vsebina = document.getElementById('pris-modal-vsebina');
    if (!d.dnevi.length) {
      vsebina.innerHTML = '<div class="prazno">Ni evidentiranih ur za ta mesec.</div>';
    } else {
      const vrstice = d.dnevi.map(dan => {
        const dt = new Date(dan.datum + 'T00:00:00');
        const dayName = DNI_PRIS[dt.getDay()];
        const datStr = `${dayName} ${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.`;

        const prihodiVnosi = dan.vnosi.filter(v => v.tip === 'PRIHOD');
        const odhodiVnosi = dan.vnosi.filter(v => v.tip === 'ODHOD');

        function vnosiHtml(arr) {
          if (!arr.length) return '<span class="pris-manjka">—</span>';
          return arr.map(v =>
            v.naknadno
              ? `${v.cas} <span class="pris-nak-pill" title="Naknadno vneseno">N</span>`
              : v.cas
          ).join('<br>');
        }

        const ureStr = dan.minute ? formatUre(dan.minute) : '—';
        const rowClass = dan.nepopoln ? 'class="pris-row-nepopoln"' : '';
        const delaStr = (dan.dela || []).length
          ? '<br><span class="td-ure-sub">' + dan.dela.map(d => `${escHtml(d.naziv)}${d.minute ? ` ${formatUre(d.minute)}` : ''}`).join(' · ') + '</span>'
          : '';

        return `<tr ${rowClass}>
          <td class="pris-td-datum">${datStr}</td>
          <td>${vnosiHtml(prihodiVnosi)}</td>
          <td>${vnosiHtml(odhodiVnosi)}</td>
          <td class="td-r pris-td-ure">${ureStr}${delaStr}</td>
        </tr>`;
      }).join('');

      vsebina.innerHTML = `<table class="tabela pris-tabela">
        <thead><tr>
          <th>Datum</th><th>Prihod</th><th>Odhod</th><th class="th-r">Ure</th>
        </tr></thead>
        <tbody>${vrstice}</tbody>
      </table>`;
    }

    const mesecStr = `${leto}-${String(mesec).padStart(2,'0')}`;

    // Naloži razporeditev, dela in km vzporedno
    const [razRes, delaRes, kmRes] = await Promise.all([
      fetch(`/api/admin/razporeditev?zaposleniId=${zaposleniId}&od=${mesecStr}-01&do=${mesecStr}-31`),
      fetch('/api/admin/dela'),
      fetch(`/api/admin/kilometrina?zaposleniId=${zaposleniId}&od=${mesecStr}-01&do=${mesecStr}-31`)
    ]);
    const [razporeditev, dela, kilometrina] = await Promise.all([
      razRes.ok ? razRes.json() : [],
      delaRes.ok ? delaRes.json() : [],
      kmRes.ok ? kmRes.json() : []
    ]);

    // Razporeditev del
    const razEl = document.getElementById('pris-modal-razporeditev');
    function prikaziRazporeditev(raz) {
      const razHtml = raz.length ? raz.map(r => {
        const ureStr = r.trajanje_minut ? formatUre(Number(r.trajanje_minut)) : `${r.cas_od}–${r.cas_do}`;
        return `<tr>
          <td>${r.datum.slice(5).replace('-','.')}</td>
          <td>${escHtml(r.delo_naziv)} <span class="td-ure-sub">€${parseFloat(r.delo_up || r.urna_postavka).toFixed(2)}/h</span></td>
          <td>${ureStr}</td>
          <td><button class="btn-sm btn-danger btn-raz-brisi" data-id="${r.id}">×</button></td>
        </tr>`;
      }).join('') : `<tr><td colspan="4" class="prazno" style="font-size:0.85em">Ni razporeditev</td></tr>`;

      const delaOpts = dela.map(d => `<option value="${d.id}">${escHtml(d.naziv)} (€${parseFloat(d.urna_postavka).toFixed(2)}/h)</option>`).join('');

      razEl.innerHTML = `
        <h3 style="margin:20px 0 8px;font-size:0.95rem;color:#4a5568">Razporeditev del</h3>
        <table class="tabela" style="margin-bottom:12px">
          <thead><tr><th>Datum</th><th>Delo</th><th>Ure</th><th></th></tr></thead>
          <tbody>${razHtml}</tbody>
        </table>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
          <label style="font-size:0.82rem;display:flex;flex-direction:column;gap:3px">Datum<input type="date" id="raz-datum" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.85rem" /></label>
          <label style="font-size:0.82rem;display:flex;flex-direction:column;gap:3px">Delo<select id="raz-delo" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.85rem">${delaOpts}</select></label>
          <label style="font-size:0.82rem;display:flex;flex-direction:column;gap:3px">Trajanje (ur)<input type="number" id="raz-trajanje" min="0.5" max="24" step="0.5" placeholder="ur" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.85rem;width:68px" /></label>
          <button id="raz-cel-dan" class="btn-sm" style="background:#276749;color:#fff;padding:6px 12px;align-self:flex-end">Cel dan</button>
          <button id="raz-dodaj" class="btn-sm" style="background:#2b6cb0;color:#fff;padding:6px 14px;align-self:flex-end">Dodaj</button>
        </div>
        <div id="raz-napaka" style="color:#fc8181;font-size:0.82rem;margin-top:4px"></div>`;

      razEl.querySelectorAll('.btn-raz-brisi').forEach(btn => {
        btn.addEventListener('click', async () => {
          const r = await fetch(`/api/admin/razporeditev/${btn.dataset.id}`, { method: 'DELETE' });
          if (r.ok) { const fresh = await osveziRaz(); prikaziRazporeditev(fresh); naloziObracun(); }
          else prikaziToast('Napaka pri brisanju', 'napaka');
        });
      });

      async function dodajRaz(body) {
        const napaka = document.getElementById('raz-napaka');
        napaka.textContent = '';
        const datum = document.getElementById('raz-datum').value;
        const deloId = document.getElementById('raz-delo').value;
        if (!datum || !deloId) { napaka.textContent = 'Izpolni datum in delo.'; return; }
        const res = await fetch('/api/admin/razporeditev', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zaposleniId, datum, deloId: Number(deloId), ...body })
        });
        if (res.ok) { const fresh = await osveziRaz(); prikaziRazporeditev(fresh); naloziObracun(); }
        else { const e = await res.json(); napaka.textContent = e.napaka || 'Napaka'; }
      }

      document.getElementById('raz-dodaj').addEventListener('click', () => {
        const trajanje = parseFloat(document.getElementById('raz-trajanje').value);
        if (!trajanje || trajanje <= 0) { document.getElementById('raz-napaka').textContent = 'Vnesite trajanje v urah.'; return; }
        dodajRaz({ trajanje });
      });
      document.getElementById('raz-cel-dan').addEventListener('click', () => dodajRaz({ celDan: true }));
    }

    // Stroški (gorivo/nakup)
    const kmEl = document.getElementById('pris-modal-km');
    function prikaziKilometrina(km) {
      const kmHtml = km.length ? km.map(k => `
        <tr>
          <td>${k.datum.slice(5).replace('-','.')}</td>
          <td class="td-r">${Number(k.km) > 0 ? `${k.km} km` : '—'}</td>
          <td class="td-r">${Number(k.strosek) > 0 ? formatEur(Number(k.strosek)) : '—'}</td>
          <td><button class="btn-sm btn-danger btn-km-brisi" data-datum="${k.datum}">×</button></td>
        </tr>`).join('') : `<tr><td colspan="4" class="prazno" style="font-size:0.85em">Ni vnosov</td></tr>`;

      kmEl.innerHTML = `
        <h3 style="margin:20px 0 8px;font-size:0.95rem;color:#4a5568">⛽ Gorivo / 🛍 Nakup</h3>
        <table class="tabela" style="margin-bottom:12px">
          <thead><tr><th>Datum</th><th class="th-r">Gorivo (€)</th><th class="th-r">Nakup (€)</th><th></th></tr></thead>
          <tbody>${kmHtml}</tbody>
        </table>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
          <label style="font-size:0.82rem;display:flex;flex-direction:column;gap:3px">Datum<input type="date" id="km-datum" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.85rem" /></label>
          <label style="font-size:0.82rem;display:flex;flex-direction:column;gap:3px">⛽ Gorivo (€)<input type="number" id="km-gorivo" min="0" step="0.01" placeholder="0.00" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.85rem;width:80px" /></label>
          <label style="font-size:0.82rem;display:flex;flex-direction:column;gap:3px">🛍 Nakup (€)<input type="number" id="km-nakup" min="0" step="0.01" placeholder="0.00" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.85rem;width:80px" /></label>
          <button id="km-shrani" class="btn-sm" style="background:#2b6cb0;color:#fff;padding:6px 14px;align-self:flex-end">Shrani</button>
        </div>
        <div id="km-napaka" style="color:#fc8181;font-size:0.82rem;margin-top:4px"></div>`;

      kmEl.querySelectorAll('.btn-km-brisi').forEach(btn => {
        btn.addEventListener('click', async () => {
          const r = await fetch(`/api/admin/kilometrina/${zaposleniId}/${btn.dataset.datum}`, { method: 'DELETE' });
          if (r.ok) { const fresh = await osveziKm(); prikaziKilometrina(fresh); naloziObracun(); }
          else prikaziToast('Napaka pri brisanju', 'napaka');
        });
      });

      document.getElementById('km-shrani').addEventListener('click', async () => {
        const napaka = document.getElementById('km-napaka');
        napaka.textContent = '';
        const datum = document.getElementById('km-datum').value;
        const gorivo = parseFloat(document.getElementById('km-gorivo').value) || 0;
        const nakup = parseFloat(document.getElementById('km-nakup').value) || 0;
        if (!datum) { napaka.textContent = 'Izpolni datum.'; return; }
        if (!gorivo && !nakup) { napaka.textContent = 'Vnesite gorivo ali nakup.'; return; }
        const res = await fetch('/api/admin/kilometrina', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zaposleniId, datum, km: gorivo, strosek: nakup })
        });
        if (res.ok) {
          document.getElementById('km-datum').value = '';
          document.getElementById('km-gorivo').value = '';
          document.getElementById('km-nakup').value = '';
          const fresh = await osveziKm(); prikaziKilometrina(fresh); naloziObracun();
        } else { const e = await res.json(); napaka.textContent = e.napaka || 'Napaka'; }
      });
    }

    async function osveziRaz() {
      const r = await fetch(`/api/admin/razporeditev?zaposleniId=${zaposleniId}&od=${mesecStr}-01&do=${mesecStr}-31`);
      return r.ok ? await r.json() : [];
    }
    async function osveziKm() {
      const r = await fetch(`/api/admin/kilometrina?zaposleniId=${zaposleniId}&od=${mesecStr}-01&do=${mesecStr}-31`);
      return r.ok ? await r.json() : [];
    }

    prikaziRazporeditev(razporeditev);
    prikaziKilometrina(kilometrina);

    document.getElementById('pris-modal-overlay').classList.remove('hidden');
  } catch(e) { console.error(e); }
}

document.getElementById('pris-btn-prej').addEventListener('click', () => {
  prisMesec--;
  if (prisMesec < 1) { prisMesec = 12; prisLeto--; }
  naloziPrisotnost();
});
document.getElementById('pris-btn-naprej').addEventListener('click', () => {
  prisMesec++;
  if (prisMesec > 12) { prisMesec = 1; prisLeto++; }
  naloziPrisotnost();
});

document.getElementById('pris-modal-zapri').addEventListener('click', () => {
  document.getElementById('pris-modal-overlay').classList.add('hidden');
});
document.getElementById('pris-modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('pris-modal-overlay'))
    document.getElementById('pris-modal-overlay').classList.add('hidden');
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Briši vse zaposlene in ure ────────────────────────────────────────────────
document.getElementById('btn-brisi-vse').addEventListener('click', async () => {
  const el = document.getElementById('brisi-vse-rezultat');
  const btn = document.getElementById('btn-brisi-vse');
  if (!confirm('POZOR: Izbrisati VSE zaposlene in VSE evidence ur?\n\nTe akcije ni mogoče razveljaviti.')) return;
  if (!confirm('Si prepričan? Vsi podatki bodo trajno izgubljeni.')) return;
  btn.disabled = true;
  btn.textContent = 'Brišem…';
  el.textContent = '';
  try {
    const res = await fetch('/api/admin/brisi-vse-zaposlene', { method: 'POST' });
    const d = await res.json();
    if (res.ok) {
      el.style.color = '#68d391';
      el.textContent = `✓ ${d.sporocilo}`;
      prikaziToast('Vsi podatki izbrisani');
      naloziZaposlene();
    } else {
      el.style.color = '#fc8181';
      el.textContent = d.napaka || 'Napaka';
    }
  } catch (e) {
    el.style.color = '#fc8181';
    el.textContent = 'Ni povezave s strežnikom';
  }
  btn.disabled = false;
  btn.textContent = 'Briši vse zaposlene in ure';
});

// ── Briši današnje vnose ──────────────────────────────────────────────────────
document.getElementById('btn-brisi-danes').addEventListener('click', async () => {
  const el = document.getElementById('brisi-rezultat');
  const btn = document.getElementById('btn-brisi-danes');
  if (!confirm('Izbrisati vse vnose za današnji dan?')) return;
  btn.disabled = true;
  btn.textContent = 'Brišem…';
  el.textContent = '';
  try {
    const res = await fetch('/api/admin/brisi-danes', { method: 'POST' });
    const d = await res.json();
    if (res.ok) {
      el.style.color = '#68d391';
      el.textContent = `✓ Izbrisano ${d.stevilo} ${d.stevilo === 1 ? 'vnos' : 'vnosov'}`;
      prikaziToast(`Izbrisano ${d.stevilo} vnosov za danes`);
    } else {
      el.style.color = '#fc8181';
      el.textContent = d.napaka || 'Napaka';
    }
  } catch (e) {
    el.style.color = '#fc8181';
    el.textContent = 'Ni povezave s strežnikom';
  }
  btn.disabled = false;
  btn.textContent = 'Izbriši današnje vnose';
});

// ── Demo seed ─────────────────────────────────────────────────────────────────
document.getElementById('btn-seed-demo').addEventListener('click', async () => {
  const el = document.getElementById('seed-rezultat');
  const btn = document.getElementById('btn-seed-demo');
  if (!confirm('Vstaviti demo podatke (jan–jun 2026) za vseh 5 zaposlenih?')) return;
  btn.disabled = true;
  btn.textContent = 'Vstavljam…';
  el.textContent = '';
  try {
    const res = await fetch('/api/admin/seed-demo', { method: 'POST' });
    const d = await res.json();
    if (res.ok) {
      el.style.color = '#68d391';
      el.textContent = `✓ ${d.sporocilo}`;
      prikaziToast(d.sporocilo);
      naloziZaposlene();
    } else {
      el.style.color = '#fc8181';
      el.textContent = d.napaka || 'Napaka';
    }
  } catch (e) {
    el.style.color = '#fc8181';
    el.textContent = 'Ni povezave s strežnikom';
  }
  btn.disabled = false;
  btn.textContent = 'Vstavi demo podatke';
});

// ── Uvoz zaposlenih ───────────────────────────────────────────────────────────
async function naloziUvozTekst() {
  try {
    const res = await fetch('/api/admin/vnos-zaposleni');
    const d = await res.json();
    document.getElementById('uvoz-textarea').value = d.tekst || '';
  } catch (_) {}
}

document.getElementById('btn-uvoz-reset').addEventListener('click', naloziUvozTekst);

document.getElementById('btn-uvozi-zaposlene').addEventListener('click', async () => {
  const el = document.getElementById('uvoz-rezultat');
  const btn = document.getElementById('btn-uvozi-zaposlene');
  const tekst = document.getElementById('uvoz-textarea').value.trim();
  if (!tekst) { el.style.color = '#fc8181'; el.textContent = 'Seznam je prazen.'; return; }
  if (!confirm('POZOR: Izbrisati vse zaposlene in uvoziti seznam iz polja zgoraj?\n\nTe akcije ni mogoče razveljaviti.')) return;
  btn.disabled = true;
  btn.textContent = 'Uvažam…';
  el.textContent = '';
  try {
    const res = await fetch('/api/admin/uvozi-zaposlene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tekst })
    });
    const d = await res.json();
    if (res.ok) {
      el.style.color = '#68d391';
      el.textContent = `✓ ${d.sporocilo}`;
      prikaziToast(d.sporocilo);
      naloziZaposlene();
    } else {
      el.style.color = '#fc8181';
      el.textContent = d.napaka || 'Napaka pri uvozu';
    }
  } catch (e) {
    el.style.color = '#fc8181';
    el.textContent = 'Ni povezave s strežnikom';
  }
  btn.disabled = false;
  btn.textContent = 'Uvozi zaposlene';
});

// ── ZAHTEVKI TAB ──────────────────────────────────────────────────────────────
function naloziZahtevkiTab() { naloziZahtevke(); }

async function naloziZahtevke() {
  try {
    const res = await fetch('/api/admin/zahtevki');
    if (!res.ok) return;
    const vsiZahtevki = await res.json();

    const cakajoci = vsiZahtevki.filter(z => z.status === 'CAKA');
    const badge = document.getElementById('zahtevki-badge');
    if (cakajoci.length > 0) {
      badge.textContent = cakajoci.length;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }

    const samoCakajoci = document.getElementById('zahtevki-samo-cakajoci')?.checked !== false;
    const zahtevki = samoCakajoci ? cakajoci : vsiZahtevki;

    const tbody = document.getElementById('zahtevki-tbody');
    const prazno = document.getElementById('zahtevki-prazno');
    if (!tbody) return;

    if (!zahtevki.length) {
      tbody.innerHTML = '';
      prazno.style.display = 'block';
      return;
    }
    prazno.style.display = 'none';

    tbody.innerHTML = zahtevki.map(z => {
      const casStr = String(z.cas_zahtevka).slice(0, 16).replace('T', ' ');
      const tipTxt = z.tip === 'PRIHOD' ? 'Prihod' : 'Odhod';
      const sc = z.status === 'CAKA' ? 'caka' : z.status === 'ODOBREN' ? 'odobren' : 'zavrnjen';
      const st = z.status === 'CAKA' ? 'Čaka' : z.status === 'ODOBREN' ? 'Odobreno' : 'Zavrnjeno';
      const akcije = z.status === 'CAKA'
        ? `<button class="btn-sm btn-odobri" data-id="${z.id}">Odobri</button>
           <button class="btn-sm btn-zavrni btn-danger" data-id="${z.id}">Zavrni</button>`
        : '';
      return `<tr>
        <td>${escHtml(z.ime_zaposlenega)}</td>
        <td><span class="tip-pill ${z.tip}">${tipTxt}</span></td>
        <td class="td-cas">${casStr}</td>
        <td class="td-opomba">${escHtml(z.opomba || '—')}</td>
        <td><span class="zahtevek-status-pill ${sc}">${st}</span></td>
        <td class="td-akcije">${akcije}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-odobri').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Odobriti zahtevek? Obstoječ vnos istega tipa za ta dan bo zamenjan.')) return;
        const r = await fetch(`/api/admin/zahtevki/${btn.dataset.id}/odobri`, { method: 'POST' });
        if (r.ok) { prikaziToast('Zahtevek odobren'); naloziZahtevke(); }
        else { const d = await r.json(); prikaziToast(d.napaka || 'Napaka', 'napaka'); }
      });
    });
    tbody.querySelectorAll('.btn-zavrni').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Zavrniti ta zahtevek?')) return;
        const r = await fetch(`/api/admin/zahtevki/${btn.dataset.id}/zavrni`, { method: 'POST' });
        if (r.ok) { prikaziToast('Zahtevek zavrnjen'); naloziZahtevke(); }
        else { const d = await r.json(); prikaziToast(d.napaka || 'Napaka', 'napaka'); }
      });
    });
  } catch(e) { console.error(e); }
}

document.getElementById('zahtevki-samo-cakajoci').addEventListener('change', () => naloziZahtevke());

// ── LESTVICA TAB ──────────────────────────────────────────────────────────────
let lestvicaObdobje = 'mesec';

function lestvicaObd() {
  const zdaj = new Date();
  const leto = zdaj.getFullYear();
  const mes = String(zdaj.getMonth() + 1).padStart(2, '0');
  const prejLeto = zdaj.getMonth() === 0 ? leto - 1 : leto;
  const prejMes = String(zdaj.getMonth() === 0 ? 12 : zdaj.getMonth()).padStart(2, '0');

  if (lestvicaObdobje === 'mesec') {
    const od = `${leto}-${mes}-01`;
    const zadnji = new Date(leto, zdaj.getMonth() + 1, 0).getDate();
    return { od, do: `${leto}-${mes}-${String(zadnji).padStart(2, '0')}` };
  }
  if (lestvicaObdobje === 'prej') {
    const od = `${prejLeto}-${prejMes}-01`;
    const zadnji = new Date(prejLeto, parseInt(prejMes), 0).getDate();
    return { od, do: `${prejLeto}-${prejMes}-${String(zadnji).padStart(2, '0')}` };
  }
  return null;
}

function formatUre(minute) {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return m > 0 ? `${h} ur ${m} min` : `${h} ur`;
}

async function naloziLestvico() {
  const obd = lestvicaObd();
  const params = obd ? `?od=${obd.od}&do=${obd.do}` : '';
  const res = await fetch('/api/admin/lestvica' + params);
  if (!res.ok) return;
  const data = await res.json();

  const seznam = document.getElementById('lestvica-seznam');
  const prazno = document.getElementById('lestvica-prazno');

  const zUr = data.filter(z => z.minute > 0);
  if (!zUr.length) {
    seznam.innerHTML = '';
    prazno.style.display = 'block';
    return;
  }
  prazno.style.display = 'none';

  const maxMin = zUr[0].minute;
  const medalje = ['🥇', '🥈', '🥉'];

  seznam.innerHTML = data.map((z, i) => {
    const medalja = i < 3 ? medalje[i] : `<span class="lestvica-rank">${i + 1}</span>`;
    const barW = maxMin > 0 ? Math.round(z.minute / maxMin * 100) : 0;
    const ure = z.minute > 0 ? formatUre(z.minute) : '—';
    const dniTxt = z.dni === 1 ? '1 dan' : `${z.dni} dni`;
    return `<div class="lestvica-vrstica ${i === 0 ? 'lestvica-prva' : ''}">
      <span class="lestvica-medalja">${medalja}</span>
      <div class="lestvica-info">
        <div class="lestvica-ime">${escHtml(z.ime)}</div>
        <div class="lestvica-bar-wrap"><div class="lestvica-bar" style="width:${barW}%"></div></div>
      </div>
      <div class="lestvica-stat">
        <span class="lestvica-ure">${ure}</span>
        <span class="lestvica-dni">${z.dni > 0 ? dniTxt : ''}</span>
      </div>
    </div>`;
  }).join('');
}

function naloziLestvicaTab() {
  naloziLestvico();
}

document.getElementById('lestvica-obdobje').querySelectorAll('.btn-obdobje').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-obdobje').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    lestvicaObdobje = btn.dataset.obdobje;
    naloziLestvico();
  });
});

// ── ROČNI VNOS ────────────────────────────────────────────────────────────────
async function naloziRvZaposlene() {
  const res = await fetch('/api/admin/zaposleni');
  if (!res.ok) return;
  const zaposleni = await res.json();
  const aktivni = zaposleni.filter(z => z.aktiven === 1);
  const opcije = aktivni.map(z => `<option value="${z.id}">${escHtml(z.ime)}</option>`).join('');
  const sel = document.getElementById('rv-zaposleni');
  sel.innerHTML = opcije;
  const filterSel = document.getElementById('filter-zaposleni');
  const obstojecaVrednost = filterSel.value;
  filterSel.innerHTML = '<option value="">Vsi</option>' + opcije;
  if (obstojecaVrednost) filterSel.value = obstojecaVrednost;
}

document.getElementById('rv-datum').value = new Date().toISOString().slice(0, 10);

document.getElementById('btn-rv-shrani').addEventListener('click', async () => {
  const napaka = document.getElementById('rv-napaka');
  napaka.style.display = 'none';
  const zaposleniId = document.getElementById('rv-zaposleni').value;
  const datum = document.getElementById('rv-datum').value;
  const casPrihoda = document.getElementById('rv-prihod').value;
  const casOdhoda = document.getElementById('rv-odhod').value;

  if (!zaposleniId || !datum) { napaka.textContent = 'Izberi zaposlenega in datum.'; napaka.style.display = 'block'; return; }
  if (!casPrihoda && !casOdhoda) { napaka.textContent = 'Vnesi vsaj en čas (prihod ali odhod).'; napaka.style.display = 'block'; return; }

  const res = await fetch('/api/admin/rocni-vnos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zaposleniId, datum, casPrihoda, casOdhoda })
  });
  if (res.ok) {
    const d = await res.json();
    prikaziToast(`Vnešeno: ${d.vstavljeno} zapis${d.vstavljeno === 1 ? '' : 'a'}`);
    document.getElementById('rv-prihod').value = '';
    document.getElementById('rv-odhod').value = '';
    naloziEvidenco();
  } else {
    const d = await res.json();
    napaka.textContent = d.napaka || 'Napaka pri vnosu';
    napaka.style.display = 'block';
  }
});

// ── DELA TAB ──────────────────────────────────────────────────────────────────
function naloziDelaTab() { naloziDela(); }

async function naloziDela() {
  try {
    const res = await fetch('/api/admin/dela');
    if (!res.ok) return;
    const dela = await res.json();

    const tbody = document.getElementById('dela-tbody');
    const prazno = document.getElementById('dela-prazno');
    if (!dela.length) { tbody.innerHTML = ''; prazno.style.display = 'block'; return; }
    prazno.style.display = 'none';

    tbody.innerHTML = dela.map(d => `
      <tr data-id="${d.id}">
        <td><span class="dela-naziv">${escHtml(d.naziv)}</span><input class="dela-edit-naziv dela-edit-input" value="${escHtml(d.naziv)}" maxlength="40" style="display:none" /></td>
        <td class="td-r"><span class="dela-up">€${parseFloat(d.urna_postavka).toFixed(2)}</span><input type="number" class="dela-edit-up dela-edit-input" value="${parseFloat(d.urna_postavka).toFixed(2)}" min="0.01" step="0.01" style="display:none;width:70px" /></td>
        <td class="td-akcije">
          <button class="btn-sm btn-dela-uredi">Uredi</button>
          <button class="btn-sm btn-dela-shrani" style="display:none">Shrani</button>
          <button class="btn-sm btn-dela-preklic" style="display:none">Prekliči</button>
          <button class="btn-sm btn-danger btn-dela-brisi">Zbriši</button>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
      const id = tr.dataset.id;
      tr.querySelector('.btn-dela-uredi').addEventListener('click', () => {
        tr.querySelector('.dela-naziv').style.display = 'none';
        tr.querySelector('.dela-up').style.display = 'none';
        tr.querySelectorAll('.dela-edit-input').forEach(i => i.style.display = '');
        tr.querySelector('.btn-dela-uredi').style.display = 'none';
        tr.querySelector('.btn-dela-brisi').style.display = 'none';
        tr.querySelector('.btn-dela-shrani').style.display = '';
        tr.querySelector('.btn-dela-preklic').style.display = '';
      });
      tr.querySelector('.btn-dela-preklic').addEventListener('click', () => naloziDela());
      tr.querySelector('.btn-dela-shrani').addEventListener('click', async () => {
        const naziv = tr.querySelector('.dela-edit-naziv').value.trim();
        const urnaPostavka = parseFloat(tr.querySelector('.dela-edit-up').value);
        if (!naziv || isNaN(urnaPostavka) || urnaPostavka <= 0) {
          prikaziToast('Preveri vnos', 'napaka'); return;
        }
        const r = await fetch(`/api/admin/dela/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ naziv, urnaPostavka })
        });
        if (r.ok) { prikaziToast('Vrsta dela posodobljena'); naloziDela(); naloziZaposlene(); }
        else { const d = await r.json(); prikaziToast(d.napaka || 'Napaka', 'napaka'); }
      });
      tr.querySelector('.btn-dela-brisi').addEventListener('click', async () => {
        if (!confirm(`Zbrisati vrsto dela "${tr.querySelector('.dela-naziv').textContent}"?`)) return;
        const r = await fetch(`/api/admin/dela/${id}`, { method: 'DELETE' });
        if (r.ok) { prikaziToast('Vrsta dela zbrisana'); naloziDela(); naloziZaposlene(); }
        else { const d = await r.json(); prikaziToast(d.napaka || 'Napaka', 'napaka'); }
      });
    });
  } catch(e) { console.error(e); }
}

document.getElementById('btn-dodaj-delo').addEventListener('click', async () => {
  const naziv = document.getElementById('novo-delo-naziv').value.trim();
  const urnaPostavka = parseFloat(document.getElementById('novo-delo-up').value);
  const napaka = document.getElementById('dela-napaka');
  napaka.textContent = '';
  if (!naziv) { napaka.textContent = 'Vnesite naziv'; return; }
  if (isNaN(urnaPostavka) || urnaPostavka <= 0) { napaka.textContent = 'Vnesite urno postavko'; return; }
  const res = await fetch('/api/admin/dela', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ naziv, urnaPostavka })
  });
  if (res.ok) {
    document.getElementById('novo-delo-naziv').value = '';
    document.getElementById('novo-delo-up').value = '';
    prikaziToast('Vrsta dela dodana');
    naloziDela();
    naloziZaposlene();
  } else {
    const d = await res.json();
    napaka.textContent = d.napaka || 'Napaka';
  }
});

// ── Device tokens ─────────────────────────────────────────────────────────────
const DEVICE_TOKEN_KEY = 'kukman_device_token';
const DEVICE_COOKIE = 'kukman_dt';
const COOKIE_MAX_AGE = 365 * 24 * 3600; // 1 leto

function shraniBraniToken(token) {
  localStorage.setItem(DEVICE_TOKEN_KEY, token);
  document.cookie = `${DEVICE_COOKIE}=${token}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Strict`;
}

function preberiToken() {
  const ls = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (ls) return ls;
  const m = document.cookie.match(new RegExp(`(?:^|; )${DEVICE_COOKIE}=([^;]+)`));
  const cookie = m ? m[1] : null;
  if (cookie) localStorage.setItem(DEVICE_TOKEN_KEY, cookie); // obnovi localStorage iz cookieja
  return cookie;
}

function odstraniToken() {
  localStorage.removeItem(DEVICE_TOKEN_KEY);
  document.cookie = `${DEVICE_COOKIE}=; max-age=0; path=/`;
}

function naloziNapraveTab() {
  const statusEl = document.getElementById('naprava-status');
  const mojeToken = preberiToken();
  statusEl.textContent = mojeToken ? '✓ Ta naprava je registrirana' : '✗ Ta naprava NI registrirana';
  statusEl.style.color = mojeToken ? '#38a169' : '#e53e3e';
  naloziNaprave();
}

async function naloziNaprave() {
  const res = await fetch('/api/admin/device-tokens');
  if (!res.ok) return;
  const naprave = await res.json();
  const container = document.getElementById('naprave-seznam');
  if (!naprave.length) {
    container.innerHTML = '<p style="color:#a0aec0;font-size:0.88em">Nobena naprava ni registrirana.</p>';
    return;
  }
  const mojeToken = preberiToken();
  container.innerHTML = naprave.map(n => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0">
      <span style="flex:1;font-size:0.9em">
        ${n.label}${n.token === mojeToken ? ' <strong style="color:#38a169">(ta naprava)</strong>' : ''}
        <span style="color:#a0aec0;font-size:0.82em;display:block">${String(n.created_at).slice(0,16)}</span>
      </span>
      ${n.token !== mojeToken ? `<button class="btn-naprava-povrni" data-token="${n.token}" style="background:#ebf8ff;border:1px solid #bee3f8;color:#2b6cb0;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:0.82em">Povrnitev</button>` : ''}
      <button class="btn-naprava-brisi" data-token="${n.token}" style="background:#fff5f5;border:1px solid #fed7d7;color:#e53e3e;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:0.82em">Odstrani</button>
    </div>
  `).join('');
  container.querySelectorAll('.btn-naprava-povrni').forEach(btn => {
    btn.addEventListener('click', () => {
      shraniBraniToken(btn.dataset.token);
      prikaziToast('Token povrnjen ✓');
      naloziNapraveTab();
    });
  });
  container.querySelectorAll('.btn-naprava-brisi').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Odstraniti napravo?')) return;
      await fetch(`/api/admin/device-tokens/${btn.dataset.token}`, { method: 'DELETE' });
      if (btn.dataset.token === preberiToken()) odstraniToken();
      naloziNapraveTab();
    });
  });
}

document.getElementById('btn-registriraj-tablico').addEventListener('click', async () => {
  const label = document.getElementById('naprava-label').value.trim() || 'Tablica';
  const res = await fetch('/api/admin/registriraj-tablico', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label })
  });
  if (res.ok) {
    const d = await res.json();
    shraniBraniToken(d.token);
    prikaziToast('Tablica registrirana ✓');
    naloziNapraveTab();
  } else {
    prikaziToast('Napaka pri registraciji', 'napaka');
  }
});

// ── Backup & Restore ──────────────────────────────────────────────────────────
document.getElementById('btn-backup').addEventListener('click', async () => {
  const el = document.getElementById('backup-rezultat');
  el.textContent = '';
  try {
    const res = await fetch('/api/admin/backup');
    if (!res.ok) { el.style.color = '#fc8181'; el.textContent = 'Napaka pri backupu'; return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const datum = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.href = url;
    a.download = `backup_kukman_${datum}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    el.style.color = '#68d391';
    el.textContent = '✓ Backup prenesen';
    setTimeout(() => { el.textContent = ''; }, 3000);
  } catch (e) {
    el.style.color = '#fc8181';
    el.textContent = 'Napaka: ' + e.message;
  }
});

document.getElementById('btn-restore').addEventListener('click', async () => {
  const el = document.getElementById('backup-rezultat');
  const fileInput = document.getElementById('backup-file-input');
  el.textContent = '';
  if (!fileInput.files.length) { el.style.color = '#fc8181'; el.textContent = 'Izberi backup datoteko.'; return; }
  if (!confirm('POZOR: Obnova bo izbrisala VSE obstoječe podatke in jih zamenjala z backup datoteko.\n\nSi prepričan?')) return;
  if (!confirm('Potrdi še enkrat: vsi trenutni podatki bodo trajno izgubljeni.')) return;
  try {
    const tekst = await fileInput.files[0].text();
    const backup = JSON.parse(tekst);
    const res = await fetch('/api/admin/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup)
    });
    const d = await res.json();
    if (res.ok) {
      el.style.color = '#68d391';
      el.textContent = `✓ ${d.sporocilo}`;
      prikaziToast(d.sporocilo);
      naloziZaposlene();
      fileInput.value = '';
    } else {
      el.style.color = '#fc8181';
      el.textContent = d.napaka || 'Napaka pri obnovi';
    }
  } catch (e) {
    el.style.color = '#fc8181';
    el.textContent = 'Napaka: ' + (e.message || 'neveljavna datoteka');
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
naloziZaposlene();
naloziEvidenco();
naloziRvZaposlene();
// Check for pending requests badge on load
(async () => {
  try {
    const res = await fetch('/api/admin/zahtevki');
    if (res.ok) {
      const z = await res.json();
      const n = z.filter(x => x.status === 'CAKA').length;
      const badge = document.getElementById('zahtevki-badge');
      if (n > 0) { badge.textContent = n; badge.style.display = ''; }
    }
  } catch(_) {}
})();
