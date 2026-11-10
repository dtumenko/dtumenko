#!/usr/bin/env node
// Pravi mape "koji medij stoji gde" za staticke Framer stranice, da bi CMS
// panel mogao da ih prikaze i menja. Te stranice nemaju Markdown izvor — one
// su export iz Framera — pa se mapa izvlaci iz samog HTML-a.
//
//   content/legacy-images.json   6 originalnih project stranica
//   content/pages.json           Home i About (hero, tekst ispod hero banera,
//                                slike u About sekciji)
//
// `match` je token koji panel trazi u HTML-u pri zameni: kod Framer slika to je
// hash bez sufiksa velicine (`image-d7d720ef`), jer ista slika stoji u
// `srcset`-u u vise velicina. Kad se slika zameni uploadom, `match` postaje
// puna putanja novog fajla. Panel odrzava oba fajla posle svake izmene.
//
// Pokretanje: npm run media-map   (potrebno posle novog Framer exporta)

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const LEGACY_FILE = path.join(ROOT, "content/legacy-work.json");
const LEGACY_OUT = path.join(ROOT, "content/legacy-images.json");
const PAGES_OUT = path.join(ROOT, "content/pages.json");
const ORDER_OUT = path.join(ROOT, "content/order.json");
const CONTENT_DIR = path.join(ROOT, "content/work");

// Slike koje se javljaju na svakoj stranici i nisu deo sadrzaja.
const CHROME_IMAGES = new Set([
  "image-9299c3ff", // logo u navigaciji (desktop + mobile varijanta)
  "image-60b39321", // slika u footer/CTA sekciji, identicna na svim stranicama
]);

const GALLERY_SLOTS = 6;

const PAGES = [
  { id: "home", label: "Home", file: "index.html", url: "/", withText: true },
  { id: "about", label: "About", file: "about/index.html", url: "/about", withText: false },
];

function readHtml(file) {
  const full = path.join(ROOT, file);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}

// Slike redosledom pojavljivanja. Framer renderuje odvojene desktop/mobile
// varijante iste sekcije, pa se ista slika javlja vise puta — dedupira se uz
// cuvanje redosleda.
// Slika je ili Framer-ova optimizovana (vise velicina istog hasa, pa je `match`
// hash bez sufiksa) ili fajl koji je panel upload-ovao (jedna velicina, `match`
// je puna putanja). Kad se Framer slika zameni uploadom, u stranici ostaje samo
// ovaj drugi oblik — zato se moraju prepoznavati oba.
function imageRef(tag) {
  const opt = /\ssrc="(\/assets\/images\/opt\/(image-[a-f0-9]+)-\d+\.webp)"/.exec(tag);
  if (opt) return { src: opt[1], match: opt[2] };

  const uploaded = /\ssrc="(\/assets\/uploads\/[^"]+)"/.exec(tag);
  if (uploaded) return { src: uploaded[1], match: uploaded[1] };

  return null;
}

function orderedImages(html, skip) {
  const tags = html.match(/<img\b[^>]*>/g) || [];
  const seen = new Set();
  const out = [];

  for (const tag of tags) {
    const ref = imageRef(tag);
    if (!ref) continue;
    if (CHROME_IMAGES.has(ref.match) || seen.has(ref.match)) continue;
    if (skip && skip.has(ref.match)) continue;
    seen.add(ref.match);
    const alt = /\salt="([^"]*)"/.exec(tag);
    out.push({ match: ref.match, src: ref.src, alt: alt ? alt[1] : "" });
  }
  return out;
}

function findVideo(html) {
  const match = /<video\b[^>]*\ssrc="(\/assets\/videos\/[^"]+)"/.exec(html);
  return match ? { match: match[1], src: match[1] } : null;
}

// Framer stranicu ne opisuje samo HTML. Deo sadrzaja — na Home-u hero slika i
// uvodni tekst — stoji i u page chunk-u iz kog React renderuje, i on posle
// hidracije pregazi HTML. Zato se za svaki slot pamti i koji `.mjs` fajl ga
// sadrzi, pa panel menja sve izvore odjednom. (Isto je radio i
// scripts/optimize-images.py kad je prepisivao putanje slika.)
function findSources(baseFile, tokens) {
  const sources = [baseFile];
  const dir = path.join(ROOT, "assets/animate");
  if (!fs.existsSync(dir) || !tokens.length) return sources;

  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".mjs")) continue;
    const content = fs.readFileSync(path.join(dir, name), "utf8");
    if (tokens.some((token) => content.includes(token))) {
      sources.push("assets/animate/" + name);
    }
  }
  return sources;
}

// Dodatne slike se ne mogu ubaciti u Framer galeriju ni kroz HTML ni kroz
// payload (komponenta ima tacno sedam imenovanih polja za sliku), pa ih
// assets/legacy-gallery.js dodaje posle hidracije. Ovde se u stranicu jednom
// ubacuje taj skript i prazan blok sa podacima koji panel kasnije popunjava.
const EXTRA_BLOCK_ID = "cms-extra-media";
const EXTRA_SCRIPT = '<script src="/assets/legacy-gallery.js" defer></script>';

// Sve stranice koje nosi Framer runtime — na njima treba iskljuciti njegovu
// klijentsku navigaciju, jer bi prikazala stanje pre izmena iz panela.
const FRAMER_PAGES = [
  "index.html",
  "about/index.html",
  "contact/index.html",
  "privacy-policy/index.html",
  "404/index.html",
];

const NAV_SCRIPT = '<script src="/assets/site-nav.js" defer></script>';

// Naslovna i About drze slike koje se menjaju iz panela. Framer ih secka po
// okviru zadate visine; ovaj skript ih vraca u celinu (vidi komentar u fajlu).
const MEDIA_SCRIPT = '<script src="/assets/site-media.js" defer></script>';

// Kontakt forma iz Framer exporta nema `action` — ovaj skript je vezuje za
// api/contact.js (vidi komentar u fajlu).
const CONTACT_SCRIPT = '<script src="/assets/contact-form.js" defer></script>';

function ensureContactScript(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return false;

  const html = fs.readFileSync(full, "utf8");
  if (html.includes("/assets/contact-form.js")) return false;

  fs.writeFileSync(full, html.replace("</body>", CONTACT_SCRIPT + "\n</body>"), "utf8");
  return true;
}

function ensureMediaScript(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return false;

  const html = fs.readFileSync(full, "utf8");
  if (html.includes("/assets/site-media.js")) return false;

  fs.writeFileSync(full, html.replace("</body>", MEDIA_SCRIPT + "\n</body>"), "utf8");
  return true;
}

function ensureNavScript(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return false;

  const html = fs.readFileSync(full, "utf8");
  if (html.includes("/assets/site-nav.js")) return false;

  fs.writeFileSync(full, html.replace("</body>", NAV_SCRIPT + "\n</body>"), "utf8");
  return true;
}

function extraBlock(known, images, hidden) {
  return (
    '<script type="application/json" id="' + EXTRA_BLOCK_ID + '">' +
    JSON.stringify({ gallery: known, images: images || [], hidden: hidden || [] }) +
    "</script>"
  );
}

function ensureExtraHooks(file, known) {
  const full = path.join(ROOT, file);
  let html = fs.readFileSync(full, "utf8");
  const before = html;

  // Sacuvaj vec upisane dodatne i sklonjene slike ako blok postoji. Bez ovoga
  // bi svako pokretanje media-map-a vratilo na stranicu slike koje je panel
  // sklonio.
  let existing = [];
  let hidden = [];
  const found = new RegExp(
    '<script type="application/json" id="' + EXTRA_BLOCK_ID + '">([\\s\\S]*?)</script>'
  ).exec(html);
  if (found) {
    try {
      const data = JSON.parse(found[1]);
      existing = data.images || [];
      hidden = data.hidden || [];
    } catch (err) {
      console.warn(`  upozorenje: neispravan ${EXTRA_BLOCK_ID} u ${file}`);
    }
    html = html.replace(found[0], extraBlock(known, existing, hidden));
  } else {
    html = html.replace("</body>", extraBlock(known, existing, hidden) + "\n</body>");
  }

  if (!html.includes("/assets/legacy-gallery.js")) {
    html = html.replace("</body>", EXTRA_SCRIPT + "\n</body>");
  }
  if (!html.includes("/assets/site-nav.js")) {
    html = html.replace("</body>", NAV_SCRIPT + "\n</body>");
  }

  if (html !== before) fs.writeFileSync(full, html, "utf8");
  return { extra: existing, hidden: hidden };
}

// Tekstualna polja stranice projekta stoje u Framer CMS kolekciji, a njihove
// vrednosti u __framer__handoverData. Citaju se odatle po id-u polja, ne
// pogadjanjem po sadrzaju — "Brand Identity" se na stranici javlja i na mestima
// koja nemaju veze sa ovim poljem.
const TEXT_FIELDS = [
  { key: "project_overview", field: "qHx5bRsBk", label: "Project Overview", rows: 6 },
  { key: "service1", field: "ES3pqjhrn", label: "Service 1", rows: 1 },
  { key: "service2", field: "rc8P13D3Q", label: "Service 2", rows: 1 },
  { key: "service3", field: "vdUCargUV", label: "Service 3", rows: 1 },
  { key: "live_link", field: "E3vtRy1Vd", label: "Live Link", rows: 1 },
];

const HANDOVER = /<script\b[^>]*id="__framer__handoverData"[^>]*>([\s\S]*?)<\/script>/i;

function handoverTable(html) {
  const script = HANDOVER.exec(html);
  if (!script) return null;
  try {
    return JSON.parse(script[1]);
  } catch (err) {
    return null;
  }
}

// Vrednost polja je indeks u istu tabelu, a tamo cesto stoji omotac
// {type, value} ciji je `value` opet indeks — tek on nosi sam tekst.
function fieldValue(table, record, field) {
  if (!(field in record)) return null;
  let value = table[record[field]];
  if (value && typeof value === "object" && "value" in value) value = table[value.value];
  return typeof value === "string" && value.trim() ? value : null;
}

function textFields(html) {
  const table = handoverTable(html);
  if (!table) return [];

  const record = table.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      TEXT_FIELDS.some((f) => f.field in entry)
  );
  if (!record) return [];

  return TEXT_FIELDS.map((spec) => {
    const value = fieldValue(table, record, spec.field);
    return value ? { ...spec, value } : null;
  }).filter(Boolean);
}

function buildLegacy() {
  const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8"));
  const manifest = {};

  for (const project of legacy) {
    const html = readHtml(`work/${project.slug}/index.html`);
    if (!html) {
      console.warn(`preskacem ${project.slug} — nema work/${project.slug}/index.html`);
      continue;
    }

    const images = orderedImages(html);
    if (images.length < 1 + GALLERY_SLOTS) {
      console.warn(`upozorenje: ${project.slug} ima ${images.length} slika, ocekivano ${1 + GALLERY_SLOTS}`);
    }

    const [thumb, ...gallery] = images;
    const video = findVideo(html);
    const slots = [thumb, ...gallery.slice(0, GALLERY_SLOTS), video].filter(Boolean);

    manifest[project.slug] = {
      thumb: thumb || null,
      images: gallery.slice(0, GALLERY_SLOTS),
      video: video,
      sources: findSources(
        `work/${project.slug}/index.html`,
        slots.map((slot) => slot.match)
      ),
    };

    const known = gallery.slice(0, GALLERY_SLOTS).map((slot) => slot.match);
    const hooks = ensureExtraHooks(`work/${project.slug}/index.html`, known);
    const extras = hooks.extra;
    manifest[project.slug].extra = extras;

    // Sklonjeni slotovi se prepoznaju po hasu iz bloka na stranici; slika je i
    // dalje u izvoru, pa je orderedImages i dalje nalazi.
    if (hooks.hidden.length) {
      manifest[project.slug].images.forEach((slot) => {
        if (hooks.hidden.includes(slot.match)) slot.hidden = true;
      });
    }

    const fields = textFields(html);
    manifest[project.slug].texts = fields;
    if (!fields.length) {
      console.warn(`  upozorenje: ${project.slug} — nijedno tekstualno polje nije nadjeno`);
    }

    console.log(
      `${project.slug}: thumb + ${Math.min(gallery.length, GALLERY_SLOTS)} slika` +
        (video ? " + video" : "") +
        (extras.length ? ` + ${extras.length} dodatnih` : "") +
        (hooks.hidden.length ? ` (${hooks.hidden.length} sklonjeno)` : "") +
        `, ${manifest[project.slug].sources.length} izvor(a)`
    );
  }

  fs.writeFileSync(LEGACY_OUT, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}

// Tekst ispod hero banera na Home-u.
//
// Home prikazuje i kartice izabranih projekata, ciji su opisi duzi od uvodnog
// pasusa — pa "najduzi tekst" nije dovoljno dobar kriterijum. Razlikuju se po
// broju pojavljivanja: tekst kartice dolazi iz Framer CMS kolekcije i stoji u
// stranici tri puta (desktop varijanta, mobile varijanta, JSON payload za
// hidraciju), dok je uvodni pasus obican staticki tekst i javlja se tacno
// jednom. Uzima se najduzi takav — i to je ujedno uslov da zamena bude
// jednoznacna.
function findIntroText(html) {
  const body = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");

  const candidates = [
    ...new Set((body.match(/>[^<>]{80,}</g) || []).map((c) => c.slice(1, -1).trim())),
  ];

  const unique = candidates.filter(
    (text) => /[a-z]/.test(text) && html.split(text).length - 1 === 1
  );

  unique.sort((a, b) => b.length - a.length);
  return unique[0] || null;
}

function buildPages(legacyManifest) {
  // Home prikazuje thumbove izabranih projekata — oni se menjaju kroz sam
  // projekat, ne kroz stranicu, pa se ovde preskacu.
  const projectImages = new Set();
  for (const entry of Object.values(legacyManifest)) {
    if (entry.thumb) projectImages.add(entry.thumb.match);
    entry.images.forEach((image) => projectImages.add(image.match));
  }

  const pages = {};

  for (const page of PAGES) {
    const html = readHtml(page.file);
    if (!html) {
      console.warn(`preskacem ${page.id} — nema ${page.file}`);
      continue;
    }

    const images = orderedImages(html, projectImages).map((image, index) => ({
      key: page.id === "home" && index === 0 ? "hero" : "image" + (index + 1),
      label: page.id === "home" && index === 0 ? "Hero" : "Image " + (index + 1),
      match: image.match,
      src: image.src,
    }));

    const texts = [];
    if (page.withText) {
      const intro = findIntroText(html);
      if (intro) {
        const occurrences = html.split(intro).length - 1;
        if (occurrences !== 1) {
          console.warn(`upozorenje: uvodni tekst na ${page.id} se javlja ${occurrences}x`);
        }
        texts.push({
          key: "intro",
          label: "Tekst ispod hero banera",
          value: intro,
          rows: 4,
        });
      } else {
        console.warn(`upozorenje: nisam nasao uvodni tekst na ${page.id}`);
      }
    }

    const tokens = images.map((image) => image.match).concat(texts.map((text) => text.value));

    pages[page.id] = {
      label: page.label,
      file: page.file,
      url: page.url,
      images: images,
      texts: texts,
      sources: findSources(page.file, tokens),
    };

    console.log(
      `${page.id}: ${images.length} slika` +
        (texts.length ? `, ${texts.length} tekst` : "") +
        `, ${pages[page.id].sources.length} izvor(a)`
    );
  }

  fs.writeFileSync(PAGES_OUT, JSON.stringify(pages, null, 2) + "\n", "utf8");
}

// content/order.json drzi redosled projekata na /work i na naslovnoj. Panel ga
// pise, build.mjs ga cita. Ovde se samo dopunjuje: novi projekti se dodaju na
// kraj, nestali se izbacuju, a vec podeseni raspored se ne dira.
//
// Naslovne cetiri kartice dolaze iz Framer export-a i ne biraju se odavde —
// citaju se iz same index.html, pa ih panel ima cim ovo jednom prodje.
function knownSlugs() {
  const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8")).map((row) => row.slug);
  // Slug se cita iz frontmatter-a, ne iz imena fajla: kolega je preimenovao
  // projekat u panelu, pa je ostalo hibbernate-wintersports.md sa slug-om
  // hibernate-wintersports. /work se gradi po slug-u.
  const cms = fs.existsSync(CONTENT_DIR)
    ? fs
        .readdirSync(CONTENT_DIR)
        .filter((file) => file.endsWith(".md"))
        .map((file) => {
          const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8");
          const match = raw.match(/^slug:\s*(.+)$/m);
          const slug = match ? match[1].trim().replace(/^['"]|['"]$/g, "") : "";
          return slug || file.replace(/[.]md$/, "");
        })
    : [];
  return [...legacy, ...cms].filter(Boolean);
}

function homeSlugs() {
  const html = readHtml("index.html");
  if (!html) return [];
  const seen = [];
  const re = /href="[.]\/work\/([a-z0-9-]+)"/g;
  let match;
  while ((match = re.exec(html))) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

// Zadrzi zatecen raspored, dodaj novo na kraj, izbaci sta vise ne postoji.
function mergeOrder(previous, available) {
  const have = new Set(available);
  const kept = previous.filter((slug) => have.has(slug));
  const added = available.filter((slug) => !kept.includes(slug));
  return [...kept, ...added];
}

function buildOrder() {
  let previous = { work: [], home: [] };
  if (fs.existsSync(ORDER_OUT)) {
    try {
      const data = JSON.parse(fs.readFileSync(ORDER_OUT, "utf8"));
      previous = {
        work: Array.isArray(data.work) ? data.work : [],
        home: Array.isArray(data.home) ? data.home : [],
      };
    } catch (err) {
      console.warn("upozorenje: content/order.json nije ispravan JSON — pravi se novi");
    }
  }

  // `home` je izbor iz panela (koja cetiri projekta idu na naslovnu), ne spisak
  // onoga sto trenutno stoji u stranici — zato se ne dopunjuje iz index.html.
  // Samo se sklanja obrisan projekat; prazan izbor dobija kartice iz stranice.
  const known = new Set(knownSlugs());
  const home = previous.home.filter((slug) => known.has(slug));
  const order = {
    work: mergeOrder(previous.work, knownSlugs()),
    home: home.length ? home : homeSlugs(),
  };
  fs.writeFileSync(ORDER_OUT, JSON.stringify(order, null, 2) + "\n", "utf8");
  return order;
}

function main() {
  console.log("— project stranice —");
  const legacyManifest = buildLegacy();
  console.log("\n— Home i About —");
  buildPages(legacyManifest);

  const patched = FRAMER_PAGES.filter(ensureNavScript);
  console.log(
    `\n— navigacija —\nsite-nav.js: ${patched.length ? "dodat u " + patched.join(", ") : "vec svuda"}`
  );

  const media = PAGES.map((page) => page.file).filter(ensureMediaScript);
  console.log(
    `site-media.js: ${media.length ? "dodat u " + media.join(", ") : "vec svuda"}`
  );

  const order = buildOrder();
  console.log(
    `\n— redosled —\n/work: ${order.work.join(", ")}\nnaslovna: ${order.home.join(", ") || "(nema kartica)"}`
  );

  const contact = ["contact/index.html"].filter(ensureContactScript);
  console.log(
    `contact-form.js: ${contact.length ? "dodat u " + contact.join(", ") : "vec svuda"}`
  );

  console.log("\nnapisano: content/legacy-images.json, content/pages.json, content/order.json");
}

main();
