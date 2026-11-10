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

  // MP4 / MOV — dimenzije stoje u `tkhd` atomu video traga, kao 16.16 brojevi
  // na kraju atoma. Audio trag ima isti atom sa nulama, pa se uzima prvi koji
  // nije prazan. Kad je video snimljen uspravno (rotacija 90°), u matrici je
  // a = 0, pa se sirina i visina menjaju.
  if (buf.length > 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    let at = buf.indexOf("tkhd");
    while (at > 4 && at < buf.length - 90) {
      const version = buf[at + 4];
      const fields = at + 8 + (version === 1 ? 32 : 20) + 16;
      const matrixA = buf.readInt32BE(fields);
      const width = buf.readUInt32BE(fields + 36) >>> 16;
      const height = buf.readUInt32BE(fields + 40) >>> 16;
      if (width && height) return matrixA === 0 ? { width: height, height: width } : { width, height };
      at = buf.indexOf("tkhd", at + 4);
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
//
// Video je motion grafika, ne film: pusta se sam, bez zvuka i u krug, i to
// samo dok je na ekranu — to radi assets/cms.js. `preload="none"` znaci da se
// na telefonu nista ne skida dok video ne dodje do ekrana; do tad se vidi
// poster (prvi kadar koji panel napravi pri uploadu). Odnos stranica dolazi iz
// dimenzija koje je zapisao panel, pa iz postera, pa iz samog MP4 fajla.
function videoRatio(item) {
  if (Number(item.width) > 0 && Number(item.height) > 0) {
    return ` style="aspect-ratio:${Number(item.width)} / ${Number(item.height)}"`;
  }
  return ratioStyle(item.poster) || ratioStyle(item.src);
}

function renderGalleryItems(gallery, title) {
  if (!Array.isArray(gallery) || gallery.length === 0) return "";
  return gallery
    .map((item, index) => {
      if (item.type === "video" || /\.(mp4|webm|mov|m4v)$/i.test(item.src || "")) {
        const poster = item.poster ? ` poster="${escapeHtml(item.poster)}"` : "";
        const label = escapeHtml(item.alt || `${title} — video ${index + 1}`);
        return `      <div class="cms-project__figure cms-project__figure--video" data-cms-reveal${videoRatio(item)}><video src="${escapeHtml(item.src)}"${poster} muted loop playsinline preload="none" disablepictureinpicture aria-label="${label}" data-cms-video></video></div>`;
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

// Case study desno, ispod disciplina: Challenge -> Approach -> Results ->
// Testimonial. Svaka sekcija je opciona; prazna se ne prikazuje. Paragrafi se
// u CMS-u odvajaju praznim redom. Polje za Approach se i dalje zove `story`.
const MAX_METRICS = 3;

function storyParagraphs(story) {
  return String(story || "")
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s*\r?\n\s*/g, " ").trim())
    .filter(Boolean);
}

function cleanText(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

// Brojevi uz Results: { value: "+40%", label: "Direct bookings" }. Bez
// vrednosti broj nema smisla, pa se takav red preskace.
function caseMetrics(metrics) {
  return (Array.isArray(metrics) ? metrics : [])
    .map((metric) => ({ value: cleanText(metric && metric.value), label: cleanText(metric && metric.label) }))
    .filter((metric) => metric.value)
    .slice(0, MAX_METRICS);
}

// Navodnici se dodaju na stranici, pa se oni koje je klijent vec upisao skidaju.
function caseTestimonial(testimonial) {
  const t = testimonial || {};
  const quote = cleanText(t.quote).replace(/^["“”„']+|["“”']+$/g, "").trim();
  if (!quote) return null;
  return { quote, name: cleanText(t.name), role: cleanText(t.role) };
}

// Zajednicki opis sekcija — iz njega se prave i CMS stranice (HTML) i JSON za
// Framer stranice (assets/project-story.js).
function caseSections(project) {
  const sections = [];
  const text = (key, label) => {
    const paragraphs = storyParagraphs(project[key]);
    return { label, paragraphs };
  };

  const challenge = text("challenge", "Challenge");
  if (challenge.paragraphs.length) sections.push(challenge);

  const approach = text("story", "Approach");
  if (approach.paragraphs.length) sections.push(approach);

  const results = text("results", "Results");
  results.metrics = caseMetrics(project.metrics);
  if (results.paragraphs.length || results.metrics.length) sections.push(results);

  const testimonial = caseTestimonial(project.testimonial);
  if (testimonial) sections.push({ label: "Testimonial", paragraphs: [], testimonial });

  return sections;
}

// Sadrzaj jedne sekcije: brojevi, paragrafi, citat — bez oznake.
function renderCaseContent(section, indent) {
  const lines = [];

  if (section.metrics && section.metrics.length) {
    const items = section.metrics
      .map(
        (metric) =>
          `${indent}  <div class="cms-case__metric">
` +
          `${indent}    <p class="cms-case__value">${escapeHtml(metric.value)}</p>
` +
          (metric.label ? `${indent}    <p class="cms-case__metric-label">${escapeHtml(metric.label)}</p>
` : "") +
          `${indent}  </div>`
      )
      .join("\n");
    lines.push(`${indent}<div class="cms-case__metrics" data-count="${section.metrics.length}">
${items}
${indent}</div>`);
  }

  section.paragraphs.forEach((paragraph) => {
    lines.push(`${indent}<p class="cms-info__text">${escapeHtml(paragraph)}</p>`);
  });

  if (section.testimonial) {
    const { quote, name, role } = section.testimonial;
    const by = [
      name ? `<span class="cms-case__name">${escapeHtml(name)}</span>` : "",
      role ? `<span class="cms-case__role">${escapeHtml(role)}</span>` : "",
    ].join("");
    lines.push(
      `${indent}<figure class="cms-case__quote">
` +
        `${indent}  <blockquote><p>“${escapeHtml(quote)}”</p></blockquote>
` +
        (by ? `${indent}  <figcaption>${by}</figcaption>
` : "") +
        `${indent}</figure>`
    );
  }

  return lines.join("\n");
}

function renderCaseSection(section) {
  return (
    `      <div class="cms-info__block cms-info__case" data-cms-reveal="tilt">
` +
    `        <p class="cms-info__label">${escapeHtml(section.label)}</p>
` +
    `${renderCaseContent(section, "        ")}
      </div>`
  );
}

// Challenge / Approach / Results kao tabovi: oznake u redu, ispod tekst
// izabrane. Smenjuju se same, u krug (assets/cms.js). Svi paneli stoje u istoj
// celiji mreze, pa je blok uvek visok kao najduzi — nema skakanja dok se
// smenjuju. Prvi je izabran vec u HTML-u.
function renderCaseTabs(sections) {
  const tabs = sections
    .map(
      (section, index) =>
        `          <button type="button" class="cms-info__label cms-case__tab" role="tab" id="case-tab-${index}" aria-controls="case-panel-${index}" aria-selected="${index === 0}"${index === 0 ? "" : ' tabindex="-1"'}>${escapeHtml(section.label)}</button>`
    )
    .join("\n");
  const panels = sections
    .map(
      (section, index) =>
        `          <div class="cms-case__panel${index === 0 ? " is-active" : ""}" role="tabpanel" id="case-panel-${index}" aria-labelledby="case-tab-${index}"${index === 0 ? "" : ' aria-hidden="true" inert'}>
` +
        `${renderCaseContent(section, "            ")}
          </div>`
    )
    .join("\n");
  return (
    `      <div class="cms-info__block cms-case__tabs" data-cms-tabs data-cms-reveal="tilt">
` +
    `        <div class="cms-case__tablist" role="tablist">
${tabs}
        </div>
` +
    `        <div class="cms-case__panels">
${panels}
        </div>
      </div>`
  );
}

// Tekstualne sekcije idu u tabove (ako ih je bar dve); citat ostaje svoj blok
// ispod. Istu podelu pravi assets/project-story.js za Framer stranice.
function renderCaseBlocks(project) {
  const sections = caseSections(project);
  const text = sections.filter((section) => !section.testimonial);
  const rest = sections.filter((section) => section.testimonial);
  const blocks = text.length > 1 ? [renderCaseTabs(text)] : text.map(renderCaseSection);
  return blocks.concat(rest.map(renderCaseSection)).join("\n");
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
// {{OG_IMAGE}} je slika za deljenje (og/twitter), {{PAGE_SCHEMA}} dodatni
// JSON-LD stranice (kod projekata CreativeWork + breadcrumbs).
const DEFAULT_OG_IMAGE = SITE_URL + "/assets/meta/meta-492d77f9.jpg";

function renderHead(headPartial, title, description, canonicalPath, noindex, extra = {}) {
  return headPartial
    .replace(/\{\{OG_IMAGE\}\}/g, escapeHtml(extra.image || DEFAULT_OG_IMAGE))
    .replace(/\{\{PAGE_SCHEMA\}\}\n?/g, () => (extra.schema ? jsonLd(extra.schema) + "\n" : ""))
    .replace(/\{\{TITLE\}\}/g, escapeHtml(title))
    .replace(/\{\{DESCRIPTION\}\}/g, escapeHtml(description || ""))
    .replace(/\{\{CANONICAL\}\}/g, escapeHtml(SITE_URL + canonicalPath))
    .replace(
      /\{\{ROBOTS\}\}/g,
      noindex ? '<meta name="robots" content="noindex, nofollow">' : ""
    );
}

function jsonLd(data) {
  return `<script type="application/ld+json">\n${JSON.stringify(data).replace(/</g, "\\u003c")}\n</script>`;
}

// Slika za deljenje: assets/og/<slug>.jpg (1200x630, lagana — WhatsApp i
// LinkedIn ne prikazu preview za teske slike), inace hero ako je jpg/png.
function shareImage(slug, src) {
  if (fs.existsSync(path.join(ROOT, "assets/og", `${slug}.jpg`))) return `${SITE_URL}/assets/og/${slug}.jpg`;
  if (!src || !/\.(jpe?g|png)$/i.test(src)) return DEFAULT_OG_IMAGE;
  return /^https?:/.test(src) ? src : SITE_URL + src;
}

function projectSchema(project, url, image) {
  const services = Array.isArray(project.services) ? project.services.map(String) : [];
  const work = {
    "@type": "CreativeWork",
    "@id": `${url}#work`,
    name: project.title,
    description: project.overview || "",
    url,
    image,
    creator: { "@id": `${SITE_URL}/#person` },
    inLanguage: "en",
  };
  if (services.length) work.keywords = services.join(", ");
  if (project.year) work.dateCreated = String(project.year);
  return {
    "@context": "https://schema.org",
    "@graph": [
      work,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: "Work", item: `${SITE_URL}/work` },
          { "@type": "ListItem", position: 3, name: project.title, item: url },
        ],
      },
    ],
  };
}

function buildWorkItemPage(project, partials) {
  // Prva usluga ide u naslov ("Tripković Gazdinstvo — Brand Identity | ..."),
  // isto kao kod originalnih 6 projekata.
  const firstService =
    Array.isArray(project.services) && project.services.length ? String(project.services[0]) : "";
  const url = `${SITE_URL}/work/${project.slug}`;
  const image = shareImage(project.slug, project.hero_image);
  const head = renderHead(
    partials.head,
    firstService ? `${project.title} — ${firstService} | Dejan Tumenko` : `${project.title} — Dejan Tumenko`,
    project.overview,
    `/work/${project.slug}`,
    project.noindex,
    { image, schema: projectSchema(project, url, image) }
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
      const blocks = renderCaseBlocks(project);
      return blocks ? blocks + "\n" : "";
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
    "Work — Brand Identity & Packaging Design | Dejan Tumenko",
    "Selected brand identity, packaging, art direction and web design projects by Dejan Tumenko, a Belgrade-based brand designer.",
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

// Kartice na naslovnoj prepisuje writeHomeCards (nize). Ovo je rezerva za
// slucaj da ne prepozna stranicu: kartice su flex-stavke, pa im se redosled
// menja CSS-om `order` — bez diranja markupa.
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

// Rezervni put: kad writeHomeCards ne prepozna stranicu (npr. posle novog
// Framer exporta), kartice ostaju one iz exporta i samo im se menja redosled.
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

/* ------------------------------------------------- naslovna: izabrani radovi */

// Cetiri kartice na dnu naslovne su Framer-ova lista iz njegovog CMS-a. Koje
// projekte prikazuje bira se u panelu (Redosled -> Naslovna strana) i stoji u
// `order.home`; build ih ovde upisuje u stranicu.
//
// Kartica postoji na dva mesta i oba se prepisuju:
//
//   1. Payload (`__framer__handoverData`) — rezultat Framer-ovog upita, iz kog
//      React posle ucitavanja crta listu. On je merodavan za ono sto ostaje na
//      ekranu.
//   2. HTML svake kartice (desktop i mobilna varijanta) — ono sto se vidi pre
//      nego sto se React ukljuci. Mora da se slaze sa payload-om, inace React
//      odbaci markup i crta sve iznova.
//
// Prepisuje se ceo sadrzaj svakog mesta, pa je svejedno da li u stranici stoje
// kartice iz exporta ili one od proslog build-a. Ako nesto u strukturi nije kako
// se ocekuje, stranica se ne dira (vidi writeHomeOrder).
const HOME_CARD_COUNT = 4;
const HANDOVER_RE =
  /(<script type="framer\/handover" id="__framer__handoverData">)([\s\S]*?)(<\/script>)/;
// Polja Framer kolekcije "Work" koja kartica cita (vidi upit u payload-u).
const CARD_FIELDS = ["WZLjnByVm", "TTmrSXZqB", "VQ3BHmaZl", "I0PT0WR78", "Hom1TCczG", "id"];
// Framer ovako racuna `sizes` za sliku kartice; uzima se iz same stranice kad
// tamo postoji, a ovo je rezerva.
const CARD_SIZES =
  "(min-width: 2510px) max(calc(100vw - 144px), 1px), (min-width: 810px) and (max-width: 2509.98px) max(calc(100vw - 32px), 1px), (max-width: 809.98px) max(calc(100vw - 32px), 1px)";
const OPT_DIR = path.join(ROOT, "assets/images/opt");

// Payload je u devalue formatu: niz vrednosti u kom kontejneri pokazuju na
// clanove po indeksu, a ["Map", k, v, …] je Map. Cita se i pise samo ono sto se
// u njemu zaista nalazi; sve drugo je znak da se export promenio, pa se staje.
function unflatten(values) {
  const done = new Map();
  function hydrate(index) {
    if (index === -1) return undefined;
    if (!Number.isInteger(index) || index < 0 || index >= values.length) {
      throw new Error("nepoznata referenca " + index);
    }
    if (done.has(index)) return done.get(index);
    const value = values[index];
    if (value === null || typeof value !== "object") {
      done.set(index, value);
      return value;
    }
    if (Array.isArray(value)) {
      if (typeof value[0] === "string") {
        if (value[0] !== "Map") throw new Error("nepoznat tip " + value[0]);
        const map = new Map();
        done.set(index, map);
        for (let i = 1; i < value.length; i += 2) map.set(hydrate(value[i]), hydrate(value[i + 1]));
        return map;
      }
      const list = [];
      done.set(index, list);
      value.forEach((ref) => list.push(hydrate(ref)));
      return list;
    }
    const obj = {};
    done.set(index, obj);
    for (const key of Object.keys(value)) obj[key] = hydrate(value[key]);
    return obj;
  }
  return hydrate(0);
}

function flatten(root) {
  const values = [];
  function add(value) {
    if (value === undefined) return -1;
    const index = values.length;
    values.push(null);
    if (value === null || typeof value !== "object") {
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("broj " + value);
      values[index] = value;
    } else if (value instanceof Map) {
      const out = ["Map"];
      values[index] = out;
      for (const [key, item] of value) out.push(add(key), add(item));
    } else if (Array.isArray(value)) {
      const out = [];
      values[index] = out;
      value.forEach((item) => out.push(add(item)));
    } else {
      const out = {};
      values[index] = out;
      for (const key of Object.keys(value)) out[key] = add(value[key]);
    }
    return index;
  }
  add(root);
  return values;
}

// Slika kartice. Optimizovane slike (`image-<hash>-<sirina>.webp`) dobijaju sve
// velicine koje postoje na disku, kao sto ih je Framer i davao. Isto vazi za
// upload iz CMS-a (`/assets/uploads/<ime>.jpg`) kad u opt/ postoje WebP
// varijante `<ime>-<sirina>.webp`; ostale slike idu kao jedan fajl.
function cardImage(src) {
  if (!src) return null;
  const opt =
    src.match(/^\/assets\/images\/opt\/(image-[a-f0-9]+)-\d+\.webp$/i) ||
    src.match(/^\/assets\/uploads\/([A-Za-z0-9_-]+)\.(?:jpe?g|png|webp)$/i);
  if (opt && fs.existsSync(OPT_DIR)) {
    const widths = fs
      .readdirSync(OPT_DIR)
      .map((name) => name.match(new RegExp("^" + opt[1] + "-(\\d+)\\.webp$")))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
    if (widths.length) {
      const url = (w) => `/assets/images/opt/${opt[1]}-${w}.webp`;
      const largest = url(widths[widths.length - 1]);
      const size = imageSize(largest);
      if (size) {
        return {
          src: largest,
          srcSet: widths.length > 1 ? widths.map((w) => `${url(w)} ${w}w`).join(",") : "",
          width: size.width,
          height: size.height,
        };
      }
    }
  }
  const size = imageSize(src);
  if (!size) return null;
  return { src, srcSet: "", width: size.width, height: size.height };
}

function legacyThumbs() {
  try {
    return JSON.parse(readIfExists(path.join(ROOT, "content/legacy-images.json")) || "{}");
  } catch (err) {
    return {};
  }
}

function homeCard(project, thumbs) {
  const src = project.hero_image || (project.gallery || []).find((g) => g && g.src && g.type !== "video")?.src;
  const image = cardImage(src);
  if (!image) return null;
  const thumb = thumbs[project.slug] && thumbs[project.slug].thumb;
  const alt = (thumb && thumb.alt) || project.hero_alt || project.title || "";
  return {
    slug: project.slug,
    title: String(project.title || ""),
    year: String(project.year ?? ""),
    overview: String(project.overview || "").trim(),
    image: { ...image, alt: String(alt) },
  };
}

// Izbor iz panela, pa — ako je neki od izabranih u medjuvremenu sklonjen
// (Draft) ili obrisan — prazno mesto popunjava sledeci projekat sa /work.
function pickHomeCards(order, listedProjects) {
  const thumbs = legacyThumbs();
  const bySlug = new Map(listedProjects.map((p) => [p.slug, p]));
  const cards = [];
  const take = (project) => {
    if (!project || cards.length >= HOME_CARD_COUNT) return;
    if (cards.some((card) => card.slug === project.slug)) return;
    const card = homeCard(project, thumbs);
    if (card) cards.push(card);
  };
  order.home.forEach((slug) => take(bySlug.get(slug)));
  listedProjects.forEach(take);
  return cards;
}

function payloadRow(card) {
  const image = { src: card.image.src };
  if (card.image.srcSet) image.srcSet = card.image.srcSet;
  image.pixelWidth = card.image.width;
  image.pixelHeight = card.image.height;
  image.alt = card.image.alt;
  const text = (value) => ({ type: "string", value });
  return {
    WZLjnByVm: { type: "responsiveimage", value: image },
    TTmrSXZqB: text(card.title),
    VQ3BHmaZl: text(card.year),
    I0PT0WR78: text(card.overview),
    Hom1TCczG: text(card.slug),
    // Framer ovo koristi samo kao React kljuc; slug je jedinstven.
    id: text(card.slug),
  };
}

// Vraca payload sa novim karticama, ili baca gresku ako upit nije onaj koji se
// ocekuje.
function rewriteHandover(json, cards) {
  const values = JSON.parse(json);
  const root = unflatten(values);
  const queries = root && root["0"];
  if (!(queries instanceof Map)) throw new Error("payload nema mapu upita");

  let found = null;
  for (const [key, rows] of queries) {
    if (typeof key !== "string" || !key.includes('"xNIwcas5L"')) continue;
    if (found) throw new Error("vise upita nad kolekcijom");
    found = key;
    if (!Array.isArray(rows) || rows.length !== HOME_CARD_COUNT) {
      throw new Error("upit nema " + HOME_CARD_COUNT + " reda");
    }
    rows.forEach((row) => {
      const keys = Object.keys(row || {});
      if (keys.length !== CARD_FIELDS.length || !CARD_FIELDS.every((f) => keys.includes(f))) {
        throw new Error("red ima neocekivana polja: " + keys.join(","));
      }
      if (!row.WZLjnByVm || row.WZLjnByVm.type !== "responsiveimage") {
        throw new Error("polje slike nije responsiveimage");
      }
    });
  }
  if (!found) throw new Error("nema upita za kartice");

  queries.set(found, cards.map(payloadRow));
  const next = flatten(root);
  // Provera da zapis moze da se procita nazad u isto.
  if (JSON.stringify(unflatten(next)["0"].get(found)) !== JSON.stringify(cards.map(payloadRow))) {
    throw new Error("payload se ne cita nazad isto");
  }
  // `<` kao <, da tekst iz panela ne moze da zatvori <script> tag.
  return JSON.stringify(next).replace(/</g, "\\u003c");
}

// Sve kartice u telu stranice: <a href="./work/…"> … </a>. Svaka je u stranici
// dvaput (desktop pa mobilna), jedna za drugom.
function cardAnchors(html) {
  const bodyAt = html.indexOf("<body");
  const anchors = [];
  const re = /<a [^>]*href="\.\/work\/([a-z0-9-]+)"[^>]*>/g;
  re.lastIndex = bodyAt;
  let match;
  while ((match = re.exec(html))) {
    const end = html.indexOf("</a>", match.index);
    if (end === -1) throw new Error("kartica bez </a>");
    const inner = html.slice(match.index + match[0].length, end);
    if (inner.includes("<a ")) throw new Error("ugnjezden link u kartici");
    anchors.push({ slug: match[1], start: match.index, end: end + 4 });
    re.lastIndex = end;
  }
  return anchors;
}

function rewriteCardHtml(anchorHtml, card, sizes) {
  const imgs = anchorHtml.match(/<img [^>]*>/g) || [];
  const h3s = anchorHtml.match(/<h3 [^>]*>[^<]*<\/h3>/g) || [];
  const ps = anchorHtml.match(/<p [^>]*>[^<]*<\/p>/g) || [];
  if (imgs.length !== 2 || h3s.length !== 1 || ps.length !== 3) {
    throw new Error(`kartica ima ${imgs.length} slike, ${h3s.length} naslova, ${ps.length} pasusa`);
  }

  const style = (imgs[1].match(/ style="([^"]*)"/) || [])[1] || "";
  const image = card.image;
  const img =
    `<img decoding="async" loading="lazy" width="${image.width}" height="${image.height}"` +
    (image.srcSet ? ` sizes="${escapeHtml(sizes)}" srcset="${escapeHtml(image.srcSet)}"` : "") +
    ` src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}"` +
    (style ? ` style="${style}"` : "") +
    ">";

  let imgIndex = 0;
  let pIndex = 0;
  return anchorHtml
    .replace(/href="\.\/work\/[a-z0-9-]+"/, () => `href="./work/${card.slug}"`)
    .replace(/<img [^>]*>/g, (tag) => (imgIndex++ === 1 ? img : tag))
    .replace(/(<h3 [^>]*>)[^<]*(<\/h3>)/, (all, open, close) => open + escapeHtml(card.title) + close)
    .replace(/(<p [^>]*>)[^<]*(<\/p>)/g, (all, open, close) =>
      open + escapeHtml(pIndex++ < 2 ? card.year : card.overview) + close
    );
}

function writeHomeCards(order, listedProjects) {
  const html = readIfExists(HOME_FILE);
  if (!html) return null;

  const cards = pickHomeCards(order, listedProjects);
  if (cards.length !== HOME_CARD_COUNT) {
    throw new Error(`za naslovnu ima ${cards.length} projekata sa slikom, treba ${HOME_CARD_COUNT}`);
  }

  const handover = html.match(HANDOVER_RE);
  if (!handover) throw new Error("nema Framer payload-a");
  const payload = rewriteHandover(handover[2], cards);

  // Kartice idu u parovima (desktop, mobilna); po paru je jedno mesto u listi.
  const anchors = cardAnchors(html);
  if (anchors.length !== HOME_CARD_COUNT * 2) {
    throw new Error(`u stranici je ${anchors.length} kartica, ocekivano ${HOME_CARD_COUNT * 2}`);
  }
  for (let i = 0; i < anchors.length; i += 2) {
    if (anchors[i].slug !== anchors[i + 1].slug) throw new Error("kartice nisu u parovima");
  }
  const sizes =
    anchors
      .map((a) => (html.slice(a.start, a.end).match(/ sizes="([^"]*)"/) || [])[1])
      .find(Boolean) || CARD_SIZES;

  let next = "";
  let at = 0;
  anchors.forEach((anchor, index) => {
    next += html.slice(at, anchor.start);
    next += rewriteCardHtml(html.slice(anchor.start, anchor.end), cards[Math.floor(index / 2)], sizes);
    at = anchor.end;
  });
  next += html.slice(at);

  next = next.replace(HANDOVER_RE, (all, open, body, close) => open + payload + close);
  // Redosled sada stoji u samom markupu; stari CSS `order` bi ga samo kvario.
  next = next.replace(new RegExp(`<style id="${HOME_ORDER_ID}">[\\s\\S]*?</style>\\n?`), "");

  if (next !== html) fs.writeFileSync(HOME_FILE, next, "utf8");
  return cards.map((card) => card.slug);
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

function storyDataBlock(row) {
  const sections = caseSections(row);
  if (!sections.length) return "";
  // `<` kao \u003c, da tekst ne moze da zatvori <script> tag.
  const json = JSON.stringify({ sections }).replace(/</g, "\\u003c");
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

    const block = storyDataBlock(row);
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

  let homeCards = null;
  try {
    homeCards = writeHomeCards(order, listedProjects);
  } catch (err) {
    console.warn(
      `upozorenje: kartice na naslovnoj nisu prepisane (${err.message}) — ` +
        "ostaju one iz stranice, menja im se samo redosled"
    );
  }
  if (homeCards) {
    console.log(`naslovna: ${homeCards.join(", ")}`);
  } else {
    const homeRanked = writeHomeOrder(order);
    if (homeRanked) console.log(`redosled na naslovnoj: ${homeRanked.join(", ")}`);
  }
  console.log(
    `built  work/index.html (${listedProjects.length} kartica, ` +
      `${allProjects.length - listedProjects.length} nelistirano)`
  );

  const stories = writeLegacyStories();
  if (stories.length) console.log(`case study upisan u work/${stories.join(", work/")}`);

  const orphans = pruneOrphans(cmsProjects.map((p) => p.slug));
  if (orphans.length) console.log(`obrisano work/${orphans.join(", work/")} (nema projekat)`);

  const sitemap = buildSitemap(listedProjects);
  fs.writeFileSync(SITEMAP_FILE, sitemap, "utf8");
  console.log(`built  sitemap.xml (${(sitemap.match(/<loc>/g) || []).length} URLs)`);

  console.log(`\nDone.`);
}

main();
