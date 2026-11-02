#!/usr/bin/env node
// Generates work/<slug>/index.html for each project in content/work/*.md,
// and fully regenerates work/index.html (hero + a card grid mixing the
// original 6 Framer-authored projects with CMS-managed ones).
//
// work/index.html used to be an original Framer/React page. Early testing
// showed that injecting new markup into it got silently stripped after
// Framer's JS hydrated the page (React reconciles the DOM against its own
// tree and removes anything it doesn't recognize). So work/index.html is
// now itself a CMS-generated page like the individual project pages — no
// Framer JS runtime, plain HTML/CSS/vanilla JS, fully under this script's
// control. The other original pages (home/about/contact/privacy-policy/404,
// and the 6 original project pages) are never touched by this script.
//
// Run via `npm run build` — Vercel runs this automatically on every push.

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONTENT_DIR = path.join(ROOT, "content/work");
const LEGACY_FILE = path.join(ROOT, "content/legacy-work.json");
const WORK_LIST_FILE = path.join(ROOT, "work/index.html");
const ORDER_FILE = path.join(ROOT, "content/order.json");
const HOME_FILE = path.join(ROOT, "index.html");
const HOME_ORDER_ID = "cms-home-order";
const SITEMAP_FILE = path.join(ROOT, "sitemap.xml");
const SITE_URL = "https://www.dtumenko.com";
// Strelica u uglu kartice — isti fajl koji Framer koristi na naslovnoj.
const CARD_ARROW = "/assets/images/image-01d98f11.svg";

// Kartica je mnogo sira nego visa, pa se od naslovne slike vidi samo pojas
// preko sredine. `hero_focus` iz CMS-a bira koji pojas — "Kadar" u panelu.
function focusPosition(focus) {
  if (focus === "top") return "center top";
  if (focus === "bottom") return "center bottom";
  return "center center";
}

// Odnos stranica slike, procitan iz samog fajla.
//
// Bez ovoga bi svaka slika isla u okvir zadate visine i secla se: prvi projekat
// je imao fotografije 3:2 pa se nije primetilo, sledeci ih je imao 1.70 i sve su
// bile posecene sa strane. Okvir zato uzima odnos SAME slike, pa nema sta da se
// sece — a posto se odnos zna vec pri build-u, mesto je rezervisano unapred i
// stranica ne poskoci kad se slika ucita.
//
// Citaju se zaglavlja JPEG/PNG/GIF/WebP fajlova; ako format nije prepoznat,
// vraca se null i okvir se prepusta samoj slici (`height: auto`), sto je i dalje
// bez secenja, samo uz mali skok pri ucitavanju.
function imageSize(src) {
  if (!src || !src.startsWith("/")) return null;
  const file = path.join(ROOT, src.slice(1));
  if (!fs.existsSync(file)) return null;

  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (err) {
    return null;
  }

  // PNG
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // GIF
  if (buf.length > 10 && buf.toString("ascii", 0, 3) === "GIF") {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // WebP — tri varijante zaglavlja (lossy, lossless, prosireni)
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8 ") {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (kind === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X") {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width, height };
    }
    return null;
  }

  // JPEG — trazi se SOF segment sa dimenzijama
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const length = buf.readUInt16BE(i + 2);
      const isSOF =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSOF) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + length;
    }
  }

  return null;
}

// Inline stil sa odnosom stranica; prazan string kad se dimenzije ne znaju.
function ratioStyle(src) {
  const size = imageSize(src);
  if (!size || !size.width || !size.height) return "";
  return ` style="aspect-ratio:${size.width} / ${size.height}"`;
}

// Hero uzima odnos svoje slike kad se zna; klasa je tu da CSS moze da razlikuje
// ta dva slucaja, jer bez poznatog odnosa mora da ostane visok ceo ekran.
function heroAttrs(src) {
  const ratio = ratioStyle(src);
  return ratio ? ` class="cms-hero cms-hero--fit"${ratio}` : ' class="cms-hero"';
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// Svi linkovi u template-ima su apsolutni ("/work", "/about", …). Relativni su
// ovde bili greska: vercel.json ima trailingSlash: false, pa /work nema kosu
// crtu na kraju i "./cro-sea-villas" se racuna od korena — /cro-sea-villas
// umesto /work/cro-sea-villas, dakle 404. Apsolutne putanje rade isto na svakoj
// dubini, pa nema ni prepravljanja nav/footer partiala po dubini stranice.

function loadProjects() {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const raw = fs.readFileSync(path.join(CONTENT_DIR, f), "utf8");
      const { data, content } = matter(raw);
      return { ...data, project_overview: data.project_overview || content.trim() };
    })
    .filter((p) => (p.status || "Live") === "Live" && p.slug);
}

// Framer stranice se ne generisu odavde, ali im kartica na /work dolazi iz
// legacy-work.json — pa `status: "Draft"` sklanja projekat sa liste i iz
// sitemap-a. Sama stranica ostaje na svom URL-u (staticki export).
function loadLegacyProjects() {
  if (!fs.existsSync(LEGACY_FILE)) return [];
  return JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8")).filter(
    (project) => (project.status || "Live") === "Live"
  );
}

// Slike bez opisa iz panela dobijaju "Naslov projekta — image N" (sajt je na
// engleskom). Prazan alt je za Google i citace ekrana isto sto i slika bez
// ikakvog opisa.
function renderGalleryItems(gallery, title) {
  if (!Array.isArray(gallery) || gallery.length === 0) return "";
  return gallery
    .map((item, index) => {
      if (item.type === "video") {
        return `      <div class="cms-project__figure" data-cms-reveal${ratioStyle(item.src)}><video src="${escapeHtml(item.src)}" muted loop playsinline controls preload="metadata"></video></div>`;
      }
      return `      <div class="cms-project__figure" data-cms-reveal${ratioStyle(item.src)}><img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt || `${title} — image ${index + 1}`)}" loading="lazy"></div>`;
    })
    .join("\n");
}

// Framer usluge redja jednu ispod druge, ne kao nabrajanje kroz zarez.
function renderServiceList(services) {
  if (!services) return "";
  const list = (Array.isArray(services) ? services : [services]).filter(Boolean);
  if (!list.length) return "";
  const items = list
    .map((service) => `        <li>${escapeHtml(service)}</li>`)
    .join("\n");
  return `      <ul class="cms-info__services" data-cms-reveal="tilt">\n${items}\n      </ul>`;
}

// "croseavillas.hr" otkucano bez protokola bi kao href bilo relativno i vodilo
// na /work/<slug>/croseavillas.hr. Framer je to sam normalizovao, pa i mi.
function normalizeUrl(url) {
  const trimmed = String(url).trim();
  if (!trimmed || /^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("/")) return trimmed;
  if (/^(mailto:|tel:)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// Duzi opis rada (polje `story`): sta je radjeno, koji su problemi reseni.
// Stoji desno, ispod disciplina. Paragrafi se u CMS-u odvajaju praznim redom.
const STORY_LABEL = "Approach";

function storyParagraphs(story) {
  return String(story || "")
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s*\r?\n\s*/g, " ").trim())
    .filter(Boolean);
}

function renderStoryBlock(story) {
  const paragraphs = storyParagraphs(story);
  if (!paragraphs.length) return "";
  const body = paragraphs
    .map((paragraph) => `        <p class="cms-info__text">${escapeHtml(paragraph)}</p>`)
    .join("\n");
  return (
    `      <div class="cms-info__block cms-info__story" data-cms-reveal="tilt">\n` +
    `        <p class="cms-info__label">${STORY_LABEL}</p>\n${body}\n      </div>`
  );
}

function renderLiveLinkBlock(liveLink) {
  if (!liveLink) return "";
  const href = normalizeUrl(liveLink);
  // Framer ovde uvek pise "Live Work", ne sam URL.
  return `      <a class="cms-info__link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-cms-reveal="tilt">Live Work</a>`;
}

// {{CANONICAL}} feeds <link rel="canonical">, og:url and the JSON-LD block in
// templates/_head.html. canonicalPath is the clean, root-absolute path of the
// generated page ("/work", "/work/<slug>") — matches vercel.json cleanUrls.
function renderHead(headPartial, title, description, canonicalPath, noindex) {
  return headPartial
    .replace(/\{\{TITLE\}\}/g, escapeHtml(title))
    .replace(/\{\{DESCRIPTION\}\}/g, escapeHtml(description || ""))
    .replace(/\{\{CANONICAL\}\}/g, escapeHtml(SITE_URL + canonicalPath))
    .replace(
      /\{\{ROBOTS\}\}/g,
      noindex ? '<meta name="robots" content="noindex, nofollow">' : ""
    );
}

function buildWorkItemPage(project, partials) {
  const head = renderHead(
    partials.head,
    `${project.title} — Dejan Tumenko`,
    project.overview,
    `/work/${project.slug}`,
    project.noindex
  );

  return partials.workItemTemplate
    .replace("<!--CMS_HEAD-->", head)
    .replace("<!--CMS_NAV-->", partials.nav)
    .replace("<!--CMS_FOOTER-->", partials.footer)
    .replace(/\{\{TITLE\}\}/g, escapeHtml(project.title))
    .replace("{{HERO_IMAGE}}", escapeHtml(project.hero_image || ""))
    .replace("{{HERO_FOCUS}}", focusPosition(project.hero_focus))
    .replace("{{HERO_ATTRS}}", heroAttrs(project.hero_image))
    .replace("{{GALLERY_ITEMS}}", renderGalleryItems(project.gallery, project.title))
    .replace("{{YEAR}}", escapeHtml(project.year || ""))
    .replace("{{SERVICE_LIST}}", renderServiceList(project.services))
    // Funkcija, ne string: u zamenskom stringu `$&` i `$'` imaju posebno
    // znacenje, a slobodan tekst ih moze sadrzati.
    // Bez teksta nestaje i sam red, da u stranici ne ostane prazan.
    .replace(/\{\{STORY_BLOCK\}\}\n?/, () => {
      const block = renderStoryBlock(project.story);
      return block ? block + "\n" : "";
    })
    .replace("{{LIVE_LINK_BLOCK}}", renderLiveLinkBlock(project.live_link))
    .replace("{{PROJECT_OVERVIEW}}", escapeHtml(project.project_overview || ""));
}

// Godina se na hover "otkotrlja": u prozoru visine jednog reda stoje dve iste
// godine jedna ispod druge, pa gornja izlazi na vrh dok donja ulazi odozdo.
// Kopija je aria-hidden da je citac ekrana ne procita dvaput.
function renderYearRoll(year) {
  const value = escapeHtml(year || "");
  return (
    '<span class="cms-card__year"><span class="cms-card__roll">' +
    `<span>${value}</span><span aria-hidden="true">${value}</span>` +
    "</span></span>"
  );
}

function buildCardGrid(projects) {
  const cards = projects
    .map(
      (p) => `        <a class="cms-card" href="/work/${escapeHtml(p.slug)}">
          <div class="cms-card__image"><img src="${escapeHtml(p.hero_image || (p.gallery && p.gallery[0] && p.gallery[0].src) || "")}" alt="${escapeHtml(p.title)}" loading="lazy" style="object-position:${focusPosition(p.hero_focus)}"></div>
          <div class="cms-card__body">
            <div class="cms-card__meta" data-cms-reveal>
              <h3 class="cms-card__title">${escapeHtml(p.title)}</h3>
              ${renderYearRoll(p.year)}
            </div>
            <p class="cms-card__overview" data-cms-reveal>${escapeHtml(p.overview || "")}</p>
          </div>
          <img class="cms-card__arrow" src="${CARD_ARROW}" alt="" aria-hidden="true">
        </a>`
    )
    .join("\n");
  return `    <div class="cms-card-grid">\n${cards}\n    </div>`;
}

function buildWorkListPage(allProjects, partials) {
  const head = renderHead(
    partials.head,
    "Works — Dejan Tumenko, Creative Director",
    "Selected branding, art direction, and visual identity projects by Dejan Tumenko, Belgrade-based Creative Director.",
    "/work"
  );
  return partials.workListTemplate
    .replace("<!--CMS_HEAD-->", head)
    .replace("<!--CMS_NAV-->", partials.nav)
    .replace("<!--CMS_FOOTER-->", partials.footer)
    .replace("{{CARD_GRID}}", buildCardGrid(allProjects));
}

// Static pages are hand-authored Framer exports this script never touches, so
// their sitemap entries are declared here; project pages are appended from the
// same data that generates them, which is the whole point — a project added in
// /admin lands in the sitemap on the next Vercel build instead of being
// invisible to crawlers until someone remembers to edit sitemap.xml by hand.
const STATIC_PAGES = [
  { loc: "/", changefreq: "monthly", priority: "1.0" },
  { loc: "/work", changefreq: "monthly", priority: "0.9" },
  { loc: "/about", changefreq: "monthly", priority: "0.8" },
  { loc: "/contact", changefreq: "yearly", priority: "0.6" },
  { loc: "/privacy-policy", changefreq: "yearly", priority: "0.2" },
];

// Reuse the lastmod already published for a URL so untouched pages don't get a
// fresh date on every deploy — only genuinely new URLs get today's.
function existingLastmods() {
  const xml = readIfExists(SITEMAP_FILE);
  const map = new Map();
  const re = /<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g;
  let match;
  while ((match = re.exec(xml))) map.set(match[1], match[2]);
  return map;
}

function buildSitemap(allProjects) {
  const known = existingLastmods();
  const today = new Date().toISOString().slice(0, 10);

  const entries = [
    ...STATIC_PAGES,
    // `noindex: true` u frontmatteru drzi stranicu van sitemap-a i dodaje joj
    // meta robots noindex — za privremene/probne stranice na zivom sajtu.
    ...allProjects
      .filter((p) => !p.noindex)
      .map((p) => ({
        loc: `/work/${p.slug}`,
        changefreq: "yearly",
        priority: "0.7",
      })),
  ].map((entry) => {
    // The home page is the only URL published with a trailing slash.
    const loc = SITE_URL + (entry.loc === "/" ? "/" : entry.loc);
    return { ...entry, loc, lastmod: known.get(loc) || today };
  });

  const body = entries
    .map(
      (e) => `  <url>
    <loc>${escapeHtml(e.loc)}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

// Naslovna nije generisana. Framer je na nju stavio cetiri izabrana rada i to
// je urednicki izbor, ne cela lista — /work je ta lista. Novi projekti se zato
// na naslovnoj ne pojavljuju sami.
// Kad se projektu promeni slug — kolega je npr. ispravio "Hibbernate" u
// "Hibernate" — build napravi novu stranicu, a stara ostane da visi na svom
// URL-u kao duplikat. Zato se brisu stranice u work/ koje vise nemaju svoj
// projekat.
//
// Brise se SAMO ono sto je ovaj skript i napravio: prepoznaje se po `cms-main`,
// koji postoji jedino u nasem template-u. Originalne Framer stranice tako ne
// mogu da nastradaju ni ako im projekat privremeno nestane sa spiska (npr. kad
// se prebaci na Draft).
function pruneOrphans(slugs) {
  const dir = path.join(ROOT, "work");
  if (!fs.existsSync(dir)) return [];

  const keep = new Set(slugs);
  const removed = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || keep.has(entry.name)) continue;

    const page = path.join(dir, entry.name, "index.html");
    if (!readIfExists(page).includes('class="cms-main"')) continue;

    fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

// Redosled projekata na /work i na naslovnoj. `content/order.json` je samo
// nagovestaj redosleda, ne spisak sta postoji: sta u njemu nije nabrojano ide na
// kraj, zadrzavajuci medjusobni raspored. Tako novi projekat radi i pre nego sto
// ga neko pomeri u panelu, a preimenovan slug ne moze da izbaci projekat sa liste.
function readOrder() {
  const raw = readIfExists(ORDER_FILE);
  if (!raw) return { work: [], home: [] };
  try {
    const data = JSON.parse(raw);
    return {
      work: Array.isArray(data.work) ? data.work : [],
      home: Array.isArray(data.home) ? data.home : [],
    };
  } catch (err) {
    console.warn("upozorenje: content/order.json nije ispravan JSON — redosled se preskace");
    return { work: [], home: [] };
  }
}

function applyOrder(projects, order) {
  const rank = new Map(order.map((slug, index) => [slug, index]));
  return projects
    .map((project, index) => ({ project, index }))
    .sort((a, b) => {
      const ra = rank.has(a.project.slug) ? rank.get(a.project.slug) : Infinity;
      const rb = rank.has(b.project.slug) ? rank.get(b.project.slug) : Infinity;
      // Isti rang (oba nenabrojana) znaci "ostavi kako je bilo" — zato zatecen indeks.
      return ra === rb ? a.index - b.index : ra - rb;
    })
    .map((entry) => entry.project);
}

// Naslovna je Framer export i njene cetiri kartice se ne generisu odavde. Ali
// one su flex-stavke, pa im se redosled menja CSS-om `order` — bez diranja
// markupa, pa Framer i dalje racuna svoje scroll animacije nad istim cvorovima.
//
// Pravilo cilja karticu preko `href` linka u njoj, jer Framer klase se menjaju
// sa svakim exportom. Isti selektor pokriva i Desktop i Mobile varijantu.
function homeSlugs(html) {
  const seen = [];
  const re = /href="\.\/work\/([a-z0-9-]+)"/g;
  let match;
  while ((match = re.exec(html))) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

function homeOrderStyle(slugs) {
  if (slugs.length < 2) return "";
  const rules = slugs
    .map((slug, index) => `div:has(> a[href="./work/${slug}"]){order:${index} !important}`)
    .join("");
  return `<style id="${HOME_ORDER_ID}">${rules}</style>`;
}

function writeHomeOrder(order) {
  const html = readIfExists(HOME_FILE);
  if (!html) return null;

  const present = homeSlugs(html);
  if (present.length < 2) return null;

  // order.home je nagovestaj; merodavno je sta stvarno stoji na stranici.
  const ranked = applyOrder(
    present.map((slug) => ({ slug })),
    order.home
  ).map((entry) => entry.slug);

  const style = homeOrderStyle(ranked);
  const re = new RegExp(`<style id="${HOME_ORDER_ID}">[\\s\\S]*?</style>`);
  const next = re.test(html)
    ? html.replace(re, style)
    : html.replace("</head>", style + "\n</head>");

  if (next === html) return ranked;
  fs.writeFileSync(HOME_FILE, next, "utf8");
  return ranked;
}

// Originalnih 6 su Framer stranice: tekst ne moze da se upise u njihov markup,
// jer React posle hidracije prezida desnu kolonu iz svojih propova. Zato build
// upisuje `story` iz legacy-work.json kao JSON blok u stranicu, a
// assets/project-story.js ga posle hidracije ubacuje ispod disciplina — isti
// put kojim idu i dodatne slike (assets/legacy-gallery.js).
//
// Tekst se pise i Draft projektima: njihova stranica ostaje na svom URL-u.
const STORY_DATA_ID = "cms-story";
const STORY_SCRIPT = '<script src="/assets/project-story.js" defer></script>';
const STORY_DATA_RE = new RegExp(
  `<script type="application/json" id="${STORY_DATA_ID}">[\\s\\S]*?</script>\\n?`
);

function storyDataBlock(story) {
  const paragraphs = storyParagraphs(story);
  if (!paragraphs.length) return "";
  // `<` kao <, da tekst ne moze da zatvori <script> tag.
  const json = JSON.stringify({ label: STORY_LABEL, paragraphs }).replace(/</g, "\\u003c");
  return `<script type="application/json" id="${STORY_DATA_ID}">${json}</script>`;
}

function writeLegacyStories() {
  const raw = readIfExists(LEGACY_FILE);
  if (!raw) return [];

  const written = [];
  for (const row of JSON.parse(raw)) {
    if (!row.slug) continue;
    const file = path.join(ROOT, "work", row.slug, "index.html");
    const html = readIfExists(file);
    if (!html) continue;

    const block = storyDataBlock(row.story);
    let next = html.replace(STORY_DATA_RE, "").replace(STORY_SCRIPT + "\n", "").replace(STORY_SCRIPT, "");
    if (block) next = next.replace("</body>", () => `${block}\n${STORY_SCRIPT}\n</body>`);

    if (next !== html) fs.writeFileSync(file, next, "utf8");
    if (block) written.push(row.slug);
  }
  return written;
}

function main() {
  const cmsProjects = loadProjects();
  const legacyProjects = loadLegacyProjects();
  const order = readOrder();
  const allProjects = applyOrder([...legacyProjects, ...cmsProjects], order.work);
  // `noindex` znaci "nevidljiva stranica": van sitemap-a, van /work liste,
  // dostupna samo direktnim linkom. Stranica se svejedno generise.
  const listedProjects = allProjects.filter((p) => !p.noindex);

  const partials = {
    head: readIfExists(path.join(ROOT, "templates/_head.html")),
    nav: readIfExists(path.join(ROOT, "templates/_nav.html")),
    footer: readIfExists(path.join(ROOT, "templates/_footer.html")),
    workItemTemplate: readIfExists(path.join(ROOT, "templates/work-item.html")),
    workListTemplate: readIfExists(path.join(ROOT, "templates/work-list.html")),
  };

  for (const [name, value] of Object.entries(partials)) {
    if (!value) {
      console.error(`Missing templates/${name} — aborting.`);
      process.exit(1);
    }
  }

  for (const project of cmsProjects) {
    const outDir = path.join(ROOT, "work", project.slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "index.html"), buildWorkItemPage(project, partials), "utf8");
    console.log(`built  work/${project.slug}/index.html`);
  }

  fs.writeFileSync(WORK_LIST_FILE, buildWorkListPage(listedProjects, partials), "utf8");

  const homeRanked = writeHomeOrder(order);
  if (homeRanked) console.log(`redosled na naslovnoj: ${homeRanked.join(", ")}`);
  console.log(
    `built  work/index.html (${listedProjects.length} kartica, ` +
      `${allProjects.length - listedProjects.length} nelistirano)`
  );

  const stories = writeLegacyStories();
  if (stories.length) console.log(`tekst (${STORY_LABEL}) upisan u work/${stories.join(", work/")}`);

  const orphans = pruneOrphans(cmsProjects.map((p) => p.slug));
  if (orphans.length) console.log(`obrisano work/${orphans.join(", work/")} (nema projekat)`);

  const sitemap = buildSitemap(listedProjects);
  fs.writeFileSync(SITEMAP_FILE, sitemap, "utf8");
  console.log(`built  sitemap.xml (${(sitemap.match(/<loc>/g) || []).length} URLs)`);

  console.log(`\nDone.`);
}

main();
