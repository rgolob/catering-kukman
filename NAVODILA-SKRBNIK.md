# Navodila za skrbnika — Evidenca prisotnosti Catering Kukman

---

## Dostop do aplikacije

| Stran | URL |
|---|---|
| Tablica (evidentiranje) | /prisotnost |
| Admin panel | /prisotnost/admin |
| Aplikacija za zaposlene | /prisotnost/moj |

**Admin geslo:** `kukman2024`
*(Geslo zamenjajte takoj po prvem vpisu — Admin panel → Nastavitve → Sprememba gesla)*

---

## Prva namestitev

### Korak 1 — Registracija tablice

Samo registrirane naprave lahko beležijo prihode in odhode.
To storite ENKRAT na vsaki napravi, ki bo služila kot tablica.

1. Na tablici odprite **Admin panel** → se prijavite
2. Kliknite zavihek **Nastavitve**
3. V razdelku *Registracija tablice* vpišite oznako (npr. `Tablica 1`)
4. Kliknite **Registriraj to napravo**
5. Prikaže se zeleno sporočilo: *✓ Ta naprava je registrirana*

> Če se ta naprava kdaj "pozabi" (počiščeni piškotki), pojdite v
> Nastavitve → poiščite svojo napravo v seznamu → kliknite **Povrnitev**.

### Korak 2 — Pregled zaposlenih

1. Admin panel → zavihek **Zaposleni**
2. Preverite, ali so vsi zaposleni v sistemu
3. Vsak zaposleni ima privzeto vrsto dela (Pomivalec, Koordinator itd.)
4. Privzeti PIN za vse: `1234` — zaposleni si ga spremenijo sami

---

## Dnevna uporaba

### Evidentiranje na tablici

Zaposleni pridejo do tablice in:
1. Kliknejo na **svoje ime**
2. Vnesejo **4-mestni PIN**
3. Sistem zabeleži prihod ali odhod (izmenično)

### Evidentiranje z QR kodo (telefon)

QR koda je prikazana na vrhu tablice in se samodejno zamenja vsakih 15 minut.

**Prvič (zjutraj):**
1. Zaposleni s telefonom **skenira QR kodo** na tablici
2. Tapne **svoje ime** na seznamu
3. Prihod je zabeležen ✓
4. Prikaže se gumb: *"Shranite to stran za evidenco in pregled ur →"*
   → zaposleni klikne in **shrani stran `/prisotnost/moj` na domači zaslon** telefona

**Naslednjič (odhod in naprej):**
1. Odpre shranjeno ikono `/prisotnost/moj`
2. Na vrhu: njegovo ime + velik gumb **Odhod ›** (ali Prihod ›) → En tap → zabeleženo ✓
3. Spodaj: prijava s PIN-om za pregled lastnih ur in oddajo zahtevkov

> Identiteta (prihod/odhod gumb) velja samo za tekoči dan.
> Naslednje jutro stran zahteva novo skeniranje QR kode.
> Pregled ur in zahtevki so dostopni kadarkoli s PIN-om.

### Vnos dodatnega dela

Kadar je zaposleni del izmene delal na drugem delovnem mestu
(npr. Magda normalno kot Pomivalec, vmes 2 uri v Strežbi):

1. Po odhodu se samodejno odpre dialog **Dodatno delo**
2. Izberite vrsto dela → vnesite čas Od in Do → kliknite **Dodaj segment**
3. Dodate lahko več segmentov
4. Kliknite **Zaključi**

Sistem pri obračunu samodejno upošteva različne urne postavke.

---

## Admin panel — pregled funkcij

### Zaposleni
- Dodajanje in urejanje zaposlenih
- Sprememba imena (gumb ✎ na kartici)
- Nastavitev privzetega dela in urne postavke
- Resetiranje PIN-a

### Evidenca
- Ročni vnos prihoda/odhoda (za popravke ali manjkajoče vnose)
- Pregled vseh vnosov po datumu

### Prisotnost
- Klik na zaposlenega → pregled vseh prihajanj in odhajanj
- Brisanje napačnih vnosov

### Obračun
- Izbira meseca → izpis ur in zaslužka po zaposlenem
- Upošteva privzeto delo + dodatne segmente
- Možnost izvoza v Excel

### Dela
- Upravljanje vrst dela in urnih postavk
- Trenutne postavke: Pomivalec €9, Priprava €10, Organizator €11, Teren €11, Koordinator €12

### Nastavitve
- Registracija naprav (tablic)
- Brisanje naprav
- Povrnitev izgubljenega žetona
- Sprememba admin gesla

---

## Varnost

- Samo registrirane tablice lahko beležijo prisotnost s PIN-om
- QR koda se menja vsakih 15 minut → ni možno posredovati kode od doma
- Telefon po koncu dneva "pozabi" zaposlenega → drugi dan zahteva fizično prisotnost
- Admin seja je zaščitena s podpisanim piškotkom

---

## Reševanje težav

| Težava | Rešitev |
|---|---|
| *"Naprava ni registrirana"* | Admin panel → Nastavitve → Registriraj to napravo |
| *"QR koda ni veljavna"* | Skenirajte svežo QR kodo na tablici |
| Izgubljen token na tablici | Admin panel → Nastavitve → Povrnitev |
| Zaposleni pozabil PIN | Admin panel → Zaposleni → kartica zaposlenega → vpišite nov PIN |
| QR slika se ne prikaže | Osvežite stran (pull-to-refresh) |
