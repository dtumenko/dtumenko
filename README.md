# Tumenko — Creative Director Portfolio

Statički export Framer sajta (napravljen preko NocodeXport-a). Čist HTML/CSS/JS,
bez potrebe za build korakom — može se hostovati bilo gde kao static site.

## Struktura

```
index.html                     Home (Framer)
about/index.html               About (Framer)
contact/index.html             Contact (Framer)
privacy-policy/index.html      Privacy Policy (Framer)
404/index.html                 404 stranica (Framer)
work/cro-sea-villas/ itd.      6 originalnih case study-jeva (Framer, netaknuti)
work/index.html                Works lista — GENERISANA (originalnih 6 + CMS projekti)
work/<novi-slug>/index.html    Novi CMS projekti — GENERISANI

assets/images, fonts, videos   Mediji (Framer export)
assets/animate                 Framer/Motion runtime (samo za Framer stranice)
assets/uploads                 Slike/video koje CMS panel upload-uje
assets/cms.css, cms.js         Stilovi/JS za CMS-generisane stranice (bez Framer JS-a)
assets/legacy-gallery.js       Dodaje, sklanja i prebrojava slike u galerijama 6 originalnih stranica
assets/framer-nav.js           Gasi Framer klijentsku navigaciju i cuva <title> posle hidracije
assets/framer-media.js         Slike na naslovnoj i About-u — da ih Framer ne secka

content/work/*.md              Podaci za nove projekte (izvor za CMS panel)
content/legacy-work.json       Podaci za originalnih 6 projekata (za work listu)
templates/                     Template delovi koje scripts/build.mjs sastavlja
scripts/build.mjs              Generator — pravi work/<slug>/, work/index.html i sitemap.xml
scripts/resync.mjs             (staro) re-mirror ceo sajt iz novog Framer export-a

admin/                         CMS panel u Framer stilu (/admin na živom sajtu)
admin-preview/                 isti panel, demo režim bez logina (/admin-preview)
admin-decap/                   Decap CMS, rezervni panel (/admin-decap)
api/auth.js, api/callback.js   GitHub OAuth za prijavu u /admin
```

## Deploy na Vercel preko GitHub-a

Repo je [github.com/dtumenko/dtumenko](https://github.com/dtumenko/dtumenko), grana `main`
(do novembra 2026. bio je `Chevu13/Deki-sajt`):

```bash
git remote add origin https://github.com/dtumenko/dtumenko.git
git push -u origin main
```

Login u `/admin` radi svako ko ima write pravo na taj repo — panel piše preko
GitHub API-ja. Drugi nalog se dodaje kroz Settings → Collaborators.

1. Idi na [vercel.com/new](https://vercel.com/new), izaberi taj GitHub repo.
2. Framework Preset: **Other**. Build Command i Output Directory ostavi prazne —
   [vercel.json](vercel.json) već zadaje `npm run build` i `outputDirectory: "."`.
3. Deploy.

`vercel.json` uključuje `cleanUrls` (pa `/about` servira `about/index.html`,
`/work/pletho` servira `work/pletho/index.html`) i dugotrajni cache za
optimizovane slike, fontove i video.

## Dodavanje novih projekata — CMS panel (/admin)

Novi projekti se **ne** dodaju kroz Framer. Na `/admin` stoji sopstveni CMS
panel — vizuelno kopija Framer-ovog CMS-a (sidebar sa kolekcijom, tabela stavki,
editor sa poljem po redu), ali umesto Framer-ovog backend-a piše direktno u ovaj
repozitorijum preko GitHub API-ja. Svaki Publish je **jedan commit** — upload
slika, izmenjen sadržaj i ažurirane mape idu zajedno (Git Data API), pa Vercel
pravi jedan build umesto jednog po fajlu.

Editor ima ista polja za obe vrste projekata: Title, Status, Slug, Details
(Overview, Project Overview, Year, Service 1–3, Live Link) i Images (Thumb,
Image 1, 2, 3…, video). **Broj slika u galeriji nije ogranicen** — ni kod novih
projekata ni kod originalnih 6 — vidi nize.

Panel ima dve kolekcije u sidebaru:

| Kolekcija | Stavke | Izvor | Šta se menja |
|---|---|---|---|
| **Work Items** | CMS projekti | `content/work/*.md` | sve; `scripts/build.mjs` iz njih generiše `work/<slug>/index.html` |
| **Work Items** | Framer projekti (originalnih 6) | `content/legacy-work.json` + sam HTML | kartica na `/work`, **Project Overview, Service 1–3, Live Link**, sve slike i video **+ dodatne preko šest, sklanjanje/vraćanje Framer slotova**, Status, brisanje |
| **Pages** | Home, About | `content/pages.json` + sam HTML | Home: hero slika i tekst ispod hero banera. About: tri slike u sekciji |

### Kako se menja sadržaj statičkih Framer stranica

Te stranice nemaju Markdown izvor — one su export iz Framera. Panel im menja
sadržaj tako što prepiše same izvorne fajlove, isto što radi i
`scripts/optimize-images.py` kad prepisuje putanje slika.

Mape "šta stoji gde" pravi `npm run media-map`:

```
content/legacy-images.json   6 project stranica: tekstualna polja, Thumb,
                             Image 1–6 (+ dodatne), video
content/pages.json           Home i About: slike + tekst
content/order.json           Redosled projekata na /work i na naslovnoj
```

Zamena mora da pogodi **svako mesto na kom sadržaj stoji**, inače React posle
hidracije vrati staro stanje:

1. `srcset` lista (više veličina iste slike)
2. `src` atribut
3. **JSON payload** (`__framer__handoverData`) iz kog React hidrira
4. **page chunk** u `assets/animate/*.mjs` — Home i About renderuju hero sliku i
   tekst odatle, ne iz HTML-a

Tekst se escape-uje **po kontekstu, ne po fajlu** — isti pasus zna da stoji na
dva mesta u istom fajlu:

| Gde | Escape |
|---|---|
| telo HTML-a | HTML entiteti |
| `__framer__handoverData` | JSON escape — entiteti bi se ovde videli doslovno (`&amp;`), jer React renderuje payload kao običan tekst |
| `assets/animate/*.mjs` | template literal (backslash, backtick, `${`) |

Zato svaka stavka u mapi nosi i listu `sources`. Project stranice imaju samo
svoj HTML; Home i About imaju i po jedan `.mjs` chunk.

Kad se zameni Thumb nekog od 6 projekata, prepisuje se i `index.html` — naslovna
prikazuje thumbove izabranih radova, pa bi inače ostala sa starom slikom.

**Tekstualna polja originalnih 6** (Project Overview, Service 1–3, Live Link) se
u payloadu menjaju **po indeksu polja, ne pretragom teksta**. Vrednosti kao
`Brand Identity` javljaju se na stranici i van tog polja, pa bi slepa zamena
pogodila i ono što ne treba. Panel pročita payload kao JSON, izmeni tačno taj
indeks i serijalizuje nazad; u telu stranice menja samo ceo tekstualni čvor
(`>vrednost<`) i celu vrednost atributa.

### Dodatne slike u galerijama originalnih 6

Framer komponenta tih stranica ima **tačno sedam imenovanih polja za sliku**
(hero + šest) — vidi `__framer__handoverData` u samoj stranici, to je CMS upit
sa poljima `WZLjnByVm`, `gKZf9vCAz`, … Sedmo polje ne postoji, pa se sedma slika
ne može dodati ni kroz HTML ni kroz payload: React posle hidracije prezida
galeriju iz svojih propova i svaki dodat markup nestane (provereno).

Zato slike preko šeste dodaje [assets/legacy-gallery.js](assets/legacy-gallery.js)
**posle hidracije**: klonira postojeći slajd (da razmak i dimenzije budu
identični), zameni sliku u njemu i doda ga na kraj. Skript je otporan na to da
React prezida listu — poredi broj slajdova i vraća dodate ako nestanu.

Spisak stoji u samoj stranici, u `<script id="cms-extra-media">`, i piše ga CMS
panel. Galerija se u DOM-u pronalazi po hash imenima Framer-ovih šest slika, ne
po Framer klasama — te se menjaju sa svakim exportom.

Jedina razlika u odnosu na originalne slajdove: Framer svoje otkriva scroll
animacijom sticky sekcije, na koju se spolja ne može zakačiti, pa se dodate
prikazuju kratkim fade-om umesto scroll-sinhronizovanim. Sve ostalo — položaj,
dimenzije, razmak, lazy loading, dužina scroll-a — isto je.

### Sklanjanje slika iz galerija originalnih 6

Isto ogranicenje vazi i obrnuto: Framer-ov slot se **ne moze isprazniti**. Ako
mu se obrise `src`, u stranici ostaje `<img>` bez adrese; ako se ukloni ceo
element, React ga posle hidracije vrati iz svojih propova. Panel je zato jedno
vreme odbijao praznjenje — a dugme × je i dalje stajalo, pa je Dejan mogao da
obrise sliku i onda ne moze da sacuva.

Resenje koristi isti mehanizam kao dodatne slike. Slika **ostaje u izvoru**, a
`legacy-gallery.js` joj posle hidracije sakriva slajd. Sakriva se pravilom iz
stylesheet-a sa `!important`, ne postavljanjem `style.display` — Framer inline
stilove prepisuje u svakom frame-u.

U panelu: × sklanja sliku, dugme **Vrati** je vraca. Stanje se pamti na dva
mesta — `hidden: true` u `content/legacy-images.json` i spisak haseva u
`<script id="cms-extra-media">` na stranici. `src` i `match` ostaju netaknuti,
pa slika moze i da se vrati jednim klikom i da se kasnije zameni drugom.

`npm run media-map` prepisuje i manifest i taj blok, pa oba cuva pri
regenerisanju — inace bi svako pokretanje vratilo sklonjene slike na stranicu.

Naslovna slika (Thumb) nema × uopste: ona je i kartica na `/work` i banner na
vrhu stranice projekta, pa moze samo da se zameni.

#### Tackice ispod galerije

Framer iscrtava **tacno sest** tackica — koliko komponenta ima polja za sliku, a
ne koliko slajdova stvarno stoji u traci. Pletho je tako vec imao sest tackica na
dvanaest slajdova, a cim se slajd skloni, Framer na kraju trake upali tackicu
koje vise nema na ekranu.

Zato `legacy-gallery.js` tackice **preuzima** kad se broj slajdova razlikuje od
broja dugmadi: dogradi klonove ili sakrije visak, aktivnu racuna iz `scrollLeft`-a,
a klik hvata u capture fazi i vodi na tacan slajd (Framer svoj klik racuna
proporcionalno po sirini trake, sto posle sklanjanja promasi). Klon ne nosi
React-ov interni kljuc, pa Framer-ov delegirani rukovalac na njemu nista ne radi.

Logika je ista kao u [assets/cms.js](assets/cms.js) za nove project stranice, pa
se obe galerije ponasaju isto. Na desktopu Framer tackice ne iscrtava, i tu se
nista ne menja.

### Zasto je Framer-ova klijentska navigacija ugasena

Framer export nosi svoj router: klik na interni link se presretne i stranica se
iscrta na klijentu, iz podataka koje Framer nosi sa sobom. Posle prelaska na
sopstveni CMS to daje pogresan prikaz — `/work` generise `scripts/build.mjs`, a
sadrzaj originalnih stranica menja panel prepisom fajlova, i Framer o tome ne
zna nista. Klik na "Works" sa naslovne je prikazivao staru listu bez novih
projekata, sve dok se stranica ne osvezi rucno.

[assets/framer-nav.js](assets/framer-nav.js) zato svaki interni link vodi kao
obicno ucitavanje stranice (capture faza + `stopImmediatePropagation`, pa Framer
ov rukovalac klik nikad ne vidi). Gubi se Framer prelaz izmedju stranica; dobija
se to da se uvek vidi ono sto je stvarno na sajtu.

Isti skript vraca i `<title>`: Framer ga posle hidracije prepisuje genericnim
naslovom iz svojih podataka, pa bi SEO naslovi vazili samo do hidracije — a
Google izvrsava JS.

Raspored, tipografija i animacije tih stranica i dalje dolaze iz Framer export-a
i panel ih ne dira — kao ni Contact/Privacy Policy/404.

> Posle novog Framer export-a (`scripts/resync.mjs`) pokreni `npm run media-map`
> da se mape osveže, jer se hash imena slika i chunk-ova menjaju.

**Jednokratno podešavanje** (posle prvog Vercel deploy-a):

1. **GitHub OAuth App** — na [github.com/settings/developers](https://github.com/settings/developers)
   → "New OAuth App":
   - Homepage URL: `https://www.dtumenko.com`
   - Authorization callback URL: `https://www.dtumenko.com/api/callback`
   - Sačuvaj **Client ID** i generiši/sačuvaj **Client Secret**.
2. **Vercel env varijable** — u Vercel project → Settings → Environment Variables:
   - `OAUTH_CLIENT_ID` = Client ID iz koraka 1
   - `OAUTH_CLIENT_SECRET` = Client Secret iz koraka 1
   - Redeploy da se varijable primene.
3. Otvori `https://www.dtumenko.com/admin`, klikni **Login with GitHub**,
   odobri pristup (scope `repo`) — panel je spreman.

GitHub OAuth App prima samo jedan callback URL, i to sa `www`. Zato
[vercel.json](vercel.json) preusmerava `dtumenko.com` na `www.dtumenko.com`: login
otvoren sa adrese bez `www` bi inače pao na „redirect_uri is not associated".
Env varijable vezane su za Vercel projekat. Ako se sajt prebaci na novi projekat
(kao pri prelasku na `dtumenko/dtumenko`), treba ih ponovo upisati, i OAuth i
Resend.

Repo i grana su već upisani u [admin/index.html](admin/index.html)
(`window.CMS_CONFIG`) i u [admin/config.yml](admin/config.yml).

**Dodavanje projekta:** /admin → **+** u toolbaru → popuni Title (Slug se
predlaže sam), Overview, Project Overview, Year, Service 1–3, Live Link, Thumb,
Image 1–6 i video → **Publish**. Za par minuta projekat je na `/work` i na
`/work/<slug>`.

**Status:** `Draft` sklanja projekat sa `/work` liste i iz `sitemap.xml`; `Live`
ga objavljuje. Kod CMS projekata Draft znači i da se stranica uopšte ne generiše.
Kod originalnih 6, sama stranica ostaje dostupna na svom URL-u jer je statički
export — sklanja se samo kartica.

**Gde šta živi u panelu:**

```
admin/index.html          konfiguracija (repo, grana, domen) + učitavanje panela
admin/cms.css             stilovi (Framer look)
admin/cms.js              cela logika: GitHub API, tabela, editor, upload
admin/config.yml          konfiguracija za Decap fallback
admin-preview/            isti panel u demo režimu — bez logina, ništa se ne snima
admin-decap/              Decap CMS, zadržan kao rezerva ako panel ikad zabaguje
content/legacy-images.json  mapa medija u 6 project stranica
content/pages.json          mapa medija i teksta na Home i About
scripts/media-map.mjs       generator obe mape (npm run media-map)
```

**Poznato ponašanje:** ako se projektu naknadno promeni Slug, stara generisana
stranica `work/<stari-slug>/index.html` ostaje u repou dok se ručno ne obriše —
`scripts/build.mjs` samo dodaje i prepisuje, nikad ne briše. (Brisanje projekta
iz panela briše i fajl.)

> `admin-decap/` je Decap-ov standardni UI nad istim fajlovima. Kod njega se
> galerija vidi kao lista stavki, a ne kao Image 1–6 slotovi, i ne ume da menja
> slike u originalnih 6 stranica — to radi samo panel na `/admin`.

**Lokalni build bez panela** (npr. da ručno dodaš/izmeniš `content/work/*.md`):
```bash
npm install
npm run build
git add -A && git commit -m "..." && git push
```

`npm run build` uz `work/` regeneriše i `sitemap.xml`, tako da novi projekti
automatski ulaze u sitemap (postojećim URL-ovima se čuva stari `lastmod`).

### (Staro) Ako ikad ipak zatreba novi Framer export

Originalnih 6 Framer stranica i home/about/contact i dalje dolaze iz Framer-a.
Ako se ONE menjaju, koristi `node scripts/resync.mjs https://<export>.rehosted.page`
(ponovo skine sve Framer stranice + asset-e), pa `git status`/`diff`, pa commit+push.
Ovo ne dira `/work` listu niti CMS projekte.

> Napomena: resync prepisuje HTML stranice, pa se SEO dodaci (canonical,
> JSON-LD, skriveni `<h1>`, Google Analytics tag) gube na tim stranicama —
> treba ih ponovo dodati ili preuzeti iz git istorije.


## Kontakt forma

Framer export nosi formu bez `action`: u originalu ju je primao Framer-ov
hosting, koji van Framera ne postoji, pa je dugme "Submit" bilo mrtvo.

Sada ide ovako:

    contact/index.html  ->  assets/contact-form.js  ->  api/contact.js  ->  Resend  ->  hi@dtumenko.com

- `assets/contact-form.js` presrece slanje i salje JSON na `/api/contact`.
  Polja se citaju po **placeholder**-u, ne po `name`: Framer je u export izvezao
  pokvarene atribute — i prezime, i imejl, i telefon nose `name="Last Name"`.
- `api/contact.js` proverava podatke i salje mejl. Adresa posetioca ide u
  `reply_to`, pa se odgovara obicnim Reply. Nevidljiva polja koja Framer vec ima
  u formi (`website`, `company`, …) sluze kao zamka za botove: ako je bilo koje
  popunjeno, poruka se tiho odbacuje.

### Sta treba podesiti (jednom)

1. Napraviti nalog na [resend.com](https://resend.com) — free plan je 3.000
   poruka mesecno.
2. U Resend-u dodati domen `dtumenko.com` i uneti DNS zapise koje da (isti panel
   gde je i domen za Vercel). Bez toga poruke mogu da idu samo na adresu kojom je
   nalog otvoren.
3. U Vercel-u, Settings -> Environment Variables, dodati:

   | promenljiva | vrednost |
   |---|---|
   | `RESEND_API_KEY` | kljuc iz Resend-a (`re_…`) |
   | `CONTACT_FROM` | `Sajt <forma@dtumenko.com>` — mora biti sa potvrdjenog domena |
   | `CONTACT_TO` | `hi@dtumenko.com` (podrazumevano i bez ove promenljive) |

4. Redeploy.

Dok kljuc ne postoji, forma posetiocu kaze "Slanje trenutno nije podeseno" i
razlog upisuje u Vercel logove — ne pretvara se da je poslala.

> Newsletter forma u podnozju je i dalje bez `action`. Ako i ona treba da salje,
> vezuje se na isti endpoint.

## Poznato ograničenje

Sve slike iz `assets/images/` se deploy-uju, ukljucujuci i one koje stranice ne
koriste.

## Popravke — /work fatal error i ucitavanje slika (avg 2026)

### 1. `/work` i CMS stranice su rusile stranicu (`Unexpected response length`)

Framer-ov klijentski ruter povlaci CMS podatke iz `assets/animate/*.framercms`
preko **svoje** konvencije `?range=od-do,od-do` (nije standardni HTTP `Range`
header) i onda proverava da li je duzina odgovora tacno onolika kolika je
trazena. To radi samo Framer-ov CDN — svaki drugi host (Vercel ukljucen) vrati
ceo fajl, pa klijent baci `Request failed: Unexpected response length` i sruси
stranicu. Ranije resenje sa serverless funkcijom (`api/framercms`) nije moglo da
radi: Vercel `rewrites` primenjuje **posle** provere fajl sistema, a
`.framercms` fajl fizicki postoji, tako da se rewrite nikad nije ni okinuo.

Sada je zakrpljena sama funkcija koja radi taj fetch, u
`assets/animate/kvjGSOTZZ.CoZxkceV.mjs`: skida **ceo** fajl (33 KB, kesira se u
browseru i u memoriji po URL-u) i sece opsege lokalno. Nema servera, radi na
bilo kom statickom hostingu. `api/framercms` i rewrite iz `vercel.json` su
obrisani.

> Ako ikad radis novi Framer/NocodeXport export, ova zakrpa se gubi — treba je
> ponovo primeniti na novi `*.mjs` (trazi string `Unexpected response length`).

### 2. Slike (bagovanje na startu)

Framer u `srcset`-u koristi svoj CDN (`?scale-down-to=512&width=8479...`). Van
Framer hostinga ti parametri ne rade nista, pa je browser za svaki thumbnail
skidao ORIGINAL — hero slika je bila 8,5 MB, ukupno ~55 MB slika.

`scripts/optimize-images.py` je:
- napravio WebP varijante (512/1024/2048/2560 px) u `assets/images/opt/`
- prepisao `src` i `srcset` u svim HTML i `.mjs` fajlovima, sa tacnim `w`
  deskriptorima (hero je sada ~8 KB na 1024 px, ~430 KB na 2560 px)
- generisao `assets/lqip.css` — mali zamucen placeholder (base64, ~14 KB ukupno)
  kao `background-image` svake slike, pa se dok se prava slika ucitava vidi
  blur umesto praznog pravougaonika (cisti CSS, React ga ne moze pregaziti)
- dodao `preload` + `fetchpriority="high"` za hero na home-u
- neiskoriscene originale sklonio u `assets/images/_originals/`
  (`.vercelignore` ih izbacuje iz deploy-a; drzi ih u repo-u kao izvor)

Ponovno pokretanje posle dodavanja novih slika:
```bash
pip install pillow
python3 scripts/optimize-images.py
npm run build
```

`vercel.json` sada ima i `cleanUrls` + dugotrajni cache za `assets/images/opt/`,
fontove i video.

### Napomena o testiranju

Preview deploy URL-ovi (`...-lv5fj70aw-...vercel.app`) su zasticeni Vercel
login-om, pa ih ne mogu otvoriti spolja — testiraj na production domenu i uradi
hard refresh (Cmd/Ctrl+Shift+R) jer je stari `.mjs` mozda kesiran.

## Raspored CMS stranica — odakle su mere

`/work` i `/work/<slug>` su jedine stranice koje ne dolaze iz Framer export-a
(zasto — vidi komentar na vrhu `scripts/build.mjs`). Da bi ipak stajale kao
Framer-ove, sve mere u `assets/cms.css` su **izmerene u browseru** na
`https://dtumenko.framer.website`, ne procenjene sa slike.

Framer prelomne tacke: **810px** i **1200px**.

| | `>= 1200` | `810–1199` | `< 810` |
|---|---|---|---|
| /work naslov | 48px | 38px | 32px |
| /work mreza | 2 kolone | 1 kolona | 1 kolona |
| naslov kartice | 32px | 26px | 24px |
| hero naslov projekta | 60px | 48px | 38px |
| telo projekta | slike + podaci | slike + podaci | slike se prevlace u stranu, pa podaci |

Sto vazi svuda: padding stranice 16px, razmak u mrezi 16px, visina kartice
**708px na svakoj sirini**, slika kartice na `opacity: .7225` preko crne (na
hover potamni na `.51`, bez zumiranja — Framer sliku ne uvecava), tekst
vertikalno centriran, strelica (`image-01d98f11.svg`, rotirana -45°) u donjem
desnom uglu.

Stranica projekta: hero je visok `100vh` sa slikom preko cele povrsine i
naslovom na sredini; telo pocinje 160px ispod heroja (Framer: 80px razmak
sekcija + 64px padding + 16px unutrasnji padding) i deli se na slike (~70%) i
podatke (~29%), sa razmakom 16px.

Ispod 810px galerija prelazi u traku koja se prevlaci u stranu — `flex` red,
`overflow-x: auto`, `scroll-snap-type: x mandatory`, stavka preko celog reda
visine **282px**, razmak 10px. Podaci idu ispod nje. Framer to radi istim
sredstvima (`ul.framer--carousel`), pa se mere poklapaju u piksel.

Preko dna te trake stoji pilula sa tackicama: 28px visine, 5px od dna, crna na
20% uz `backdrop-filter: blur(4px)`, tackica 8px, neaktivna na `opacity: .5`.
Gradi je `assets/cms.js` — jedno dugme po slici, aktivna je ona ciji je levi rub
najblizi levom rubu okvira (racuna se iz stvarnih polozaja, pa ne zavisi od
sirine i razmaka), a klik pomera traku na tu sliku. Zato galerija ima omotac
`.cms-project__gallery`: tackice stoje preko nje, a same slike se pomeraju.

Navigacija na ovim stranicama mora rucno da se digne (`.cms-nav`,
`position: fixed`) — na Framer stranicama to radi njegov runtime, koji se ovde
namerno ne ucitava. Bez toga bi traka stajala u toku i gurala stranicu 68px
nize, pa hero ne bi pocinjao od vrha ekrana.

### Kadar naslovne slike (`hero_focus`)

Kartica je mnogo sira nego visa, a Framer sliku jos i uvecava 1.4x — pa se od
naslovne slike vidi samo pojas preko sredine. Ako je motiv pri vrhu ili pri dnu
fotografije, taj pojas ga promasi.

Polje **Kadar** u panelu (`hero_focus` u frontmatteru: `top` / `center` /
`bottom`, podrazumevano `center`) postavlja `object-position` na kartici u
`/work` i na vrhu stranice projekta. Ne dira slike u galeriji.

> Ako se doda novo polje u draft, mora i u `toMarkdown` u `admin/cms.js` —
> panel pise ceo frontmatter iz drafta, pa bi rucno dodat kljuc nestao pri
> prvom sledecem snimanju.

### Naslovna se ne generise

Framer je na naslovnu stavio cetiri izabrana rada. To je urednicki izbor, ne
cela lista — cela lista je `/work`. Novi projekti se zato na naslovnoj ne
pojavljuju sami; ako neki treba da **udje medju izabrane**, menja se sama
`index.html`. Njihov **redosled** se menja iz panela — vidi ispod.

### Tekst na Framer stranicama: `field` mora da prezivi snimanje

Duzi case-study tekst stoji u Framer payload-u, a `updatePayload` ga pronalazi
po `field` hasu iz `content/legacy-images.json`. Panel je taj kljuc brisao pri
svakom snimanju: prvo snimanje projekta je proslo, a svako sledece menjanje
teksta bi proslo **bez greske, a posetilac bi i dalje video stari tekst** — jer
bi se payload preskocio. Falco Gin je tako i ostao bez `field`-a.

Sad se `field` cuva, a ako ga nema, snimanje staje s porukom da se pokrene
`npm run media-map`. Home i About ovo ne dodiruje: tamo je zamena teksta
doslovna, bez trazenja po payload-u.
## Redosled projekata

Panel → **Redosled**. Dve liste: `/work` (svi projekti) i naslovna (one cetiri
kartice). Prevlacenjem ili strelicama, pa **Publish**.

Sve stoji u `content/order.json`:

```json
{ "work": ["slug", "slug", ...], "home": ["slug", ...] }
```

Fajl je **nagovestaj redosleda, ne spisak sta postoji**. Sve sto u njemu nije
nabrojano `build.mjs` redja na kraj, zadrzavajuci medjusobni raspored. Zato novi
projekat radi i pre nego sto ga neko pomeri u panelu, a preimenovan ili obrisan
slug ne moze da izbaci projekat sa liste.

`npm run media-map` fajl dopunjuje: novo na kraj, nestalo napolje, vec podesen
raspored se ne dira. Slug se cita iz frontmatter-a, ne iz imena fajla — kolega je
preimenovao projekat u panelu, pa je ostalo `hibbernate-wintersports.md` sa
slug-om `hibernate-wintersports`.

### Zasto naslovna radi bez diranja Framer markupa

Njene cetiri kartice se ne generisu odavde i ne mogu da se prepisu: React posle
hidracije prezida sekciju iz svojih propova. Ali kartice su **flex-stavke**, a
flex ima `order` — pa se menja samo raspored, ne i markup. Framer i dalje racuna
svoje scroll animacije nad istim cvorovima; za njega se nista nije promenilo.

`build.mjs` upisuje pravilo u `<style id="cms-home-order">` u `<head>`:

```css
div:has(> a[href="./work/pletho"]){order:0 !important}
```

Kartica se cilja preko `href` linka u njoj, jer se Framer klase menjaju sa svakim
exportom. Isti selektor pokriva i Desktop i Mobile varijantu — obe nose isti
`href`. `!important` je tu jer Framer inline stilove prepisuje u svakom frame-u.

Pravilo stoji u `<head>` staticki, ne ubacuje ga skript: raspored je tacan pre
nego sto Framer ista izmeri, pa nema trenutka u kom bi se videlo pogresno stanje.

Oslanja se na CSS `:has()`. Ako ga pregledac nema (pre Chrome 105 / Safari 15.4 /
Firefox 121), pravilo se preskace i ostaje redosled iz export-a — stranica radi
normalno, samo se raspored ne primenjuje.

### Draft projekti

Ostaju na listi u panelu iako se na sajtu ne vide. Tako im mesto ne propadne dok
se ne vrate na Live.
### Animacije na CMS stranicama

Sve je prepisano sa Framer stranica, izmereno u browseru:

| gde | u miru | pokret |
|---|---|---|
| slika u kartici | `opacity .7225` | hover: `.51` + `scale(1.06)` |
| godina u kartici | prvi od dva reda | hover: stub se digne za jedan red |
| `View All`, `Live Work` | bez linije | hover: linija se uvuce s leve strane |
| slike u galeriji | `opacity 0`, `translateY(20px)` | pri ulasku u sliku |
| blokovi sa podacima | `opacity 0`, `translateY(25px) rotateX(15deg)` | pri ulasku u sliku |
| naslov u heroju | `opacity .001`, `translateY(100px)` | odmah po ucitavanju |

Ulazak vodi `IntersectionObserver` iz `assets/cms.js` — dodaje `.is-in` na sve
sa `data-cms-reveal`. Ovde je pouzdan jer se na CMS stranicama ne ucitava Lenis
smooth scroll, koji ga na Framer stranicama razbija (zato `legacy-gallery.js`
ima svoj tajmer). Dva osiguraca: `<noscript>` blok u templateu i provera posle
3s koja otkrije ono sto je stvarno u slici, ako observer zakaze.

`prefers-reduced-motion: reduce` gasi sve to.

## Navigacija na Framer stranicama

### Mobilni meni ga uopste nije imao

Na uskom ekranu navigacija je svedena na dugme MENU. U Framer projektu ono
otvara overlay, ali NocodeXport tu interakciju **nije izvezao** — dugme u
stranici nema nijedan rukovalac (provereno na React propovima: samo `className`,
`style`, `tabIndex`). Sa naslovne, About-a, Contact-a i sest originalnih
projekata se na telefonu nije moglo doci do Works-a.

Zbunjujuce je bilo to sto na `/work` i `/work/<slug>` meni radi — te stranice
generise `scripts/build.mjs` i na njima meni pravi `assets/cms.js`. Otud utisak
da "nekad radi, nekad ne": zavisilo je sa koje stranice krenes.

`assets/framer-nav.js` sada sam pravi overlay, istog izgleda kao onaj iz
`cms.css`. Dugme se trazi po `data-framer-name="Menu Button"`, a ako ga nema —
po tekstu, da prezivi novi export. Slusa se na dokumentu, ne na dugmetu, jer
Framer posle hidracije ume da zameni cvor.



`assets/framer-nav.js` gasi Framer-ov klijentski ruter (zasto — vidi komentar u
fajlu). Uz to resava dve stvari koje su se videle kao "link ne radi iz prvog
klika":

- **Tap na telefonu.** Stranice koriste Lenis smooth scroll. Dok stranica jos
  klizi po inerciji, prvi dodir cesto samo zaustavi klizanje i nikad ne postane
  klik. Zato se tap hvata na `touchend` (pomeraj < 10px, trajanje < 700ms) i
  vodi kao navigacija, uz `preventDefault` da ne bude i drugog, browserovog
  klika.
- **Kosa crta na kraju adrese.** `vercel.json` ima `trailingSlash: false`, ali
  Framer u exportu koristi relativne linkove (`../work`). Ako se stranica ipak
  otvori kao `/about/`, `../work` postane `/about/work` — ceo meni vodi u 404.
  Linkovi se zato racunaju od **kanonske** putanje, ne od one iz adrese. Vercel
  danas preusmerava takve adrese, pa se to na sajtu nije videlo; sada ne zavisi
  od toga.

Takodje se vise ne gleda `event.defaultPrevented`: ako neki drugi rukovalac
stigne prvi i otkaze podrazumevanu radnju, to je upravo slucaj u kome bi Framer
preuzeo navigaciju i prikazao staro stanje.

## Preimenovanje projekta

Kad se projektu promeni slug (kolega je npr. ispravio "Hibbernate" u
"Hibernate"), build napravi novu stranicu — a stara je ostajala da visi na svom
URL-u kao duplikat, i u Google-u i na sajtu.

`scripts/build.mjs` sada brise stranice u `work/` koje vise nemaju svoj
projekat. Brise **samo ono sto je sam napravio**: prepoznaje se po `cms-main`,
koji postoji jedino u nasem template-u. Originalnih sest Framer stranica tako ne
moze da nastrada ni ako im projekat privremeno nestane sa spiska — provereno
tako sto je jedan od njih prebacen na Draft, pa je stranica ostala.

## Slike na stranici projekta

Svaka slika — i hero i one u galeriji — stoji u okviru koji uzima **odnos same
te slike**. Odnos meri `scripts/build.mjs` citajuci zaglavlje fajla
(JPEG/PNG/GIF/WebP) i upisuje ga kao `aspect-ratio` u samu stranicu, pa je mesto
rezervisano pre nego sto se slika ucita i stranica ne poskoci.

Zato ovde nema fiksnih odnosa u CSS-u. Ranije je stajalo `aspect-ratio: 3 / 2`
uz `object-fit: cover`: prvi projekat je imao fotografije 3:2 pa se nije
primetilo, sledeci ih je imao 1.70 i sve su bile posecene sa strane. Sada je
pravilo isto za svaki projekat koji se doda kroz panel, bez obzira na oblik
fotografija — ukljucujuci i uspravne.

Ako se odnos ne moze procitati (nepoznat format), okvir ostaje bez zadatog
odnosa a slika je `height: auto` — i dalje se vidi cela, samo uz mali skok pri
ucitavanju.

Hero: kad se odnos zna, dobija klasu `cms-hero--fit` i visina mu prati sliku;
`min-height: min-content` cuva da nikad ne bude nizi od naslova koji stoji preko
njega. Kad se odnos ne zna, ostaje visok ceo ekran kao ranije.

Na uskom ekranu galerija je traka koja se prevlaci: svaka slika zadrzava svoju
visinu, traka je visoka koliko najvisa, nize stoje na sredini.

> Kartice na `/work` su namerno drugacije: one su 708px visoke sa `cover`, jer
> je to Framer-ov raspored kartice. Kadar tamo bira polje **Kadar**
> (`hero_focus`) u panelu.

## Slike na naslovnoj i About stranici

Framer svaku od tih fotografija stavlja u okvir ZADATE visine, secka je sa
`object-fit: cover` i uz to je jos uveca — `scale(1.2)` na heroju, `scale(1.4)`
na About-u — pa je pomera gore-dole uz skrol. Dok su slike birane uz taj okvir
izgledalo je namerno; prva fotografija drugog odnosa stranica ubacena kroz panel
ostala je bez glave i bez dna.

`assets/framer-media.js` (ide samo u `index.html` i `about/index.html`):

- **Svuda** — sklanja uvecanje i pomeranje. To je cist gubitak kadra: sa
  `scale(1.4)` se od okvira vidi jedva 70%, i to pomereno.
- **About** — okviru pusta visinu da **prati odnos same fotografije**. Slika ide
  od ivice do ivice i vidi se cela, na svakoj sirini. Odnos se cita iz ucitane
  slike; dok nije ucitana (slike nize su `loading="lazy"`) uzimaju se
  `width`/`height` atributi, pa stranica ne poskoci kad slika stigne.
- **Hero** — zadrzava `cover`, samo bez uvecanja i pomeranja.

Zasto hero ne moze isto: preko njega stoji naslov, apsolutno pozicioniran u
odnosu na okvir visok ceo ekran. Ako mu se visina pusti, na telefonu ispadne
traka od ~190px i naslov se prelije van nje (probano). Ako se fotografija uklopi
cela u tako visok okvir (`contain`), ostane pola ekrana prazno.

Sto je jos probano pa odbaceno: `contain` na About-u (na velikom monitoru siroke
prazne trake sa strane) i kadar zakacen za vrh (spasava glavu na jednoj slici,
ali gradu na obali ostavi samo nebo).

Slike se biraju po strukturi, ne po imenu fajla: slika u Framer-ovom omotacu
pozadinske slike, sa `object-fit: cover`, koja **nije** u linku. Time ispadaju
kartice projekata na naslovnoj (linkovi su, i kadriranje im je u redu), logo u
navigaciji i potpis.

Tri zamke:

- Framer inline stil prepisuje na svakom kadru, pa pravila idu kroz stylesheet
  sa `!important` — samo tako nadjacaju inline vrednost koju on stalno vraca.
- Framer visinu zakiva i na svim omotacima iznad slike — i na sekciji, i na redu
  sa dve slike. Svima se pusta, ali penjanje staje kad omotac postane 3x visi od
  slike: tu je vec kraj sekcije i pocinje ostatak stranice.
- Sam okvir sa slikom je apsolutan; njemu se visina ne pusta na `auto` (sklopio
  bi se na nulu) nego se razapinje po roditelju, koji nosi odnos.

Na sirokim ekranima Framer menja varijantu sekcije, pa oznake odu sa starim
cvorovima. Vraca ih `MutationObserver`, preko tajmera a ne
`requestAnimationFrame` — rAF ume da bude uspavan dok se kartica ne iscrtava.

## Case study na stranici projekta (Challenge / Approach / Results / Testimonial)

Desno, ispod Overview-a i disciplina, stoje opcione sekcije, ovim redom:

| sekcija | polje u panelu | kljuc u podacima |
|---|---|---|
| Challenge | Challenge | `challenge` |
| Approach | Approach | `story` (staro ime polja, zadrzano) |
| Results | Result 1–3 (broj + opis) i Results (tekst) | `metrics: [{value, label}]`, `results` |
| Testimonial | Testimonial, Testimonial Name, Testimonial Role | `testimonial: {quote, name, role}` |

U panelu su pod naslovom **Case study** (posle Year), ista za obe vrste
projekata. Paragrafi se odvajaju praznim redom. Prazno polje znaci da se sekcija
ne prikazuje; broj bez vrednosti se preskace. Navodnici oko izjave se dodaju na
stranici. Oznake sekcija su istim fontom kao "Overview" (PT Mono), tekst kao
tekst Overview-a; brojevi su veliki Inter Display, a na telefonu (<=480px) svaki
broj dobija svoj red.

| | gde stoje podaci | ko ih stavlja na stranicu |
|---|---|---|
| CMS projekti | frontmatter `content/work/*.md` | `scripts/build.mjs` (`caseSections` -> `{{STORY_BLOCK}}` u `templates/work-item.html`), stilovi u `assets/cms.css` (`.cms-case__*`) |
| originalnih 6 | `content/legacy-work.json` | `scripts/build.mjs` upise `{sections}` kao JSON u `<script id="cms-story">`, a [assets/project-story.js](assets/project-story.js) ga ubaci posle hidracije |

Kod originalnih 6 je to isti put kao za dodatne slike: Framer komponenta nema
polje za taj tekst, a markup dodat u izvor React posle hidracije skloni. Skript
klonira Framer-ov blok "Overview" za svaku sekciju, pa tekst nasledjuje iste klase
(font, velicinu, prelomne tacke), i ubacuje sekcije iza bloka sa disciplinama.
Velicine brojeva i citata su u `CASE_CSS` u istom fajlu — iste mere kao u
`assets/cms.css`, menjati na oba mesta. Blok se trazi
po tekstu oznake "Overview", a discipline po `data-framer-name="Service Row"` —
ne po klasama, koje se menjaju sa svakim exportom.

Desna kolona je sticky (`top: 48px`). Sa tekstom ume da postane visa od ekrana,
pa bi joj dno ostalo van slike sve do kraja galerije. Zato `assets/cms.js` (CMS
stranice) i `project-story.js` (Framer stranice) tada racunaju negativan `top`:
kolona prvo odskroluje sa stranicom, a zalepi se tek kad joj dno udje u sliku.

Nazivi sekcija su u `caseSections()` u `scripts/build.mjs`.

## Popravke — pregled sajta (nov 2026)

- **Naslov u tabu "… - My Framer Site".** Framer-ov `script_main` je `async`
  modul i iz kesa zna da hidrira pre `framer-nav.js`, koji je onda zapamtio vec
  prepisan naslov i branio njega. Naslov se sad cita iz `og:title`, koji je
  isti kao `<title>` a Framer ga ne dira.
- **About, usluge na telefonu bile odsecene.** Framer je opisu u mobilnoj
  varijanti zakucao `width: 600px` i `height: 54px`, uz `overflow: hidden` na
  redu. Popravka je `<style id="cms-about-services">` u `about/index.html`.
- **"Live Work" vodio na framer.com** (Adria Design Biennale, Nordarch Studio,
  Vellor Residency — vrednost iz Framer sablona). `<style id="cms-placeholder-link">`
  na svih 6 Framer stranica sakriva link sa tim href-om; kad se u panelu upise
  pravi Live Link, dugme se samo vrati. U selektoru namerno nema `"framer.com"`
  bez protokola: panel pri izmeni Live Link-a menja svaki `"stara vrednost"` u
  HTML-u, pa bi prepisao i selektor.
- **Podnozje na /work i CMS projektima, na telefonu.** `templates/_footer.html`
  je Framer-ova Desktop varijanta, pa su Social, Sitemap i Privacy Policy
  ostajali desno van ekrana. `assets/cms.css` ga ispod 810px slaze u stubac, sa
  merama Framer-ove Phone varijante.
- **Hero CMS projekta na telefonu.** Nizak hero (prati odnos slike) je drzao
  "View All" i naslov ispod fiksne navigacije — "View All" se crtao preko
  logoa. Dobio je gornji padding.
- **Alt tekst u galerijama CMS projekata.** Slika bez opisa iz panela dobija
  "Naslov projekta — image N" umesto praznog `alt`.
