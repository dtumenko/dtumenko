/* Case study (Challenge / Approach / Results / Testimonial) na originalnih 6
 * Framer stranica — desno, ispod disciplina.
 *
 * Framer komponenta tih stranica nema polje za taj tekst, a markup dodat u
 * izvor React posle hidracije skloni (isti problem kao sa dodatnim slikama —
 * vidi assets/legacy-gallery.js). Zato ga scripts/build.mjs upisuje kao JSON
 * u <script id="cms-story">, iz polja challenge/story/results/metrics/
 * testimonial u content/legacy-work.json, a ovaj skript ga ubacuje POSLE
 * hidracije — svaku sekciju kao poseban blok, kao na CMS stranicama.
 *
 * Blok se ne pravi od nule: klonira se Framer-ov blok "Overview" (oznaka +
 * tekst), pa nasledjuje iste klase — font, velicinu, boju i prelomne tacke.
 * Klase se ne pominju nigde u kodu jer se menjaju sa svakim exportom; blok se
 * pronalazi po tekstu oznake "Overview", a discipline po data-framer-name.
 *
 * Desna kolona je sticky (top: 48px). Kad sa ovim tekstom postane visa od
 * ekrana, lepi se tek kad joj dno udje u sliku — isto kao na CMS stranicama
 * (assets/cms.js).
 */

(function () {
  "use strict";

  var DATA_ID = "cms-story";
  var MARK = "data-cms-story";
  var STICKY = "data-cms-sticky";
  var STYLE_ID = "cms-story-style";
  var STICKY_GAP = 48;
  var CASE_STYLE_ID = "cms-case-style";

  // Brojevi i citat nemaju par na Framer stranici, pa im se velicina zadaje
  // ovde. Font, boja i oznake dolaze iz kloniranih Framer okvira. Iste mere su
  // u assets/cms.css (CMS stranice) — menjati na oba mesta. !important jer
  // Framer velicinu teksta drzi u svojim klasama.
  var CASE_CSS =
    "[data-cms-story] .cms-case__metrics{display:grid;grid-template-columns:repeat(var(--cms-metrics,3),minmax(0,1fr));gap:16px;width:100%}" +
    '[data-cms-story] .cms-case__metrics[data-count="1"]{--cms-metrics:1}' +
    '[data-cms-story] .cms-case__metrics[data-count="2"]{--cms-metrics:2}' +
    "[data-cms-story] .cms-case__metric{display:flex;flex-direction:column;gap:8px;padding-top:16px;border-top:0.8px solid rgb(99,99,99);min-width:0}" +
    "[data-cms-story] .cms-case__value p{font-size:clamp(32px,2.8vw,44px)!important;font-weight:500!important;line-height:1.05!important;letter-spacing:-0.02em!important}" +
    // Framer okvir oznake je sirok koliko tekst i ne prelama red.
    "[data-cms-story] .cms-case__metric>*{width:100%!important;min-width:0}" +
    "[data-cms-story] .cms-case__metric p,[data-cms-story] .cms-case__by p{white-space:normal!important}" +
    "[data-cms-story] .cms-case__muted{opacity:.6}" +
    "[data-cms-story] .cms-case__quote{display:flex;flex-direction:column;gap:16px;width:100%}" +
    "[data-cms-story] .cms-case__quote-text p{font-size:22px!important;line-height:1.4!important;letter-spacing:-0.01em!important}" +
    "[data-cms-story] .cms-case__by{display:flex;flex-wrap:wrap;gap:4px 8px}" +
    "[data-cms-story] .cms-case__by>*{width:auto!important;flex:0 0 auto!important}" +
    "@media (max-width:480px){" +
    "[data-cms-story] .cms-case__metrics,[data-cms-story] .cms-case__metrics[data-count]{grid-template-columns:1fr;gap:0}" +
    "[data-cms-story] .cms-case__metric{flex-direction:row;align-items:baseline;justify-content:space-between;gap:16px;padding:12px 0}" +
    "[data-cms-story] .cms-case__metric>*{width:auto!important;flex:0 1 auto!important}" +
    "[data-cms-story] .cms-case__metric>:last-child p{text-align:right!important}" +
    "[data-cms-story] .cms-case__quote-text p{font-size:20px!important}" +
    "}";

  function readConfig() {
    var node = document.getElementById(DATA_ID);
    if (!node) return null;
    try {
      var data = JSON.parse(node.textContent || "{}");
      var sections = (Array.isArray(data.sections) ? data.sections : []).filter(function (section) {
        return section && section.label;
      });
      return sections.length ? sections : null;
    } catch (err) {
      console.error("cms-story: neispravan JSON", err);
      return null;
    }
  }

  // Framer renderuje desnu kolonu u vise varijanti (desktop, tablet, mobilni) i
  // sve stoje u DOM-u; vidi se ona koja odgovara sirini. Zato se tekst dodaje u
  // SVAKU, ne u prvu pronadjenu.
  function findSlots() {
    var slots = [];
    Array.prototype.forEach.call(document.querySelectorAll("p"), function (label) {
      if (label.textContent.trim() !== "Overview") return;
      // Klon nosi istu oznaku samo dok joj se tekst ne zameni — preskace se.
      if (label.closest("[" + MARK + "]")) return;

      var labelBox = label.closest('[data-framer-component-type="RichTextContainer"]') || label.parentElement;
      var group = labelBox && labelBox.parentElement;
      var column = group && group.parentElement;
      if (!group || !column || group.children.length < 2) return;

      // Ubacuje se iza bloka sa disciplinama; ako ga nema, odmah iza Overview-a.
      var anchor = group;
      Array.prototype.forEach.call(column.children, function (child) {
        if (child.querySelector('[data-framer-name="Service Row"]')) anchor = child;
      });

      slots.push({ group: group, labelBox: labelBox, column: column, anchor: anchor });
    });
    return slots;
  }

  // Framer blok uvodi animacijom (opacity 0, translateY, rotateX) i to stanje
  // drzi u inline stilu. Klon u toj animaciji ne ucestvuje, pa bi ostao
  // nevidljiv — inline stilovi se skidaju i blok dobija sopstveni fade.
  function clearMotion(node) {
    [node].concat(Array.prototype.slice.call(node.querySelectorAll("[style]"))).forEach(function (el) {
      ["opacity", "transform", "will-change"].forEach(function (prop) {
        el.style.removeProperty(prop);
      });
    });
  }

  // Framer okvir teksta sa jednim <p> i zadatim tekstom.
  function textFrom(template, text, className) {
    var box = template.cloneNode(true);
    var p = box.querySelector("p") || box;
    // Framer ume da podeli tekst na vise <p> u istom okviru — ostaje jedan.
    Array.prototype.forEach.call(box.querySelectorAll("p"), function (other) {
      if (other !== p) other.remove();
    });
    p.textContent = text;
    if (className) box.classList.add(className);
    return box;
  }

  function div(className, children) {
    var node = document.createElement("div");
    node.className = className;
    children.forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function buildBlock(slot, section) {
    var node = slot.group.cloneNode(true);
    node.setAttribute(MARK, "");
    clearMotion(node);

    var boxes = Array.prototype.slice.call(node.children);
    var labelIndex = Array.prototype.indexOf.call(slot.group.children, slot.labelBox);
    var labelBox = boxes[labelIndex];
    var textBox = boxes[labelIndex + 1] || boxes[labelIndex === 0 ? 1 : 0];
    if (!labelBox || !textBox) return null;

    var labelText = labelBox.querySelector("p") || labelBox;
    labelText.textContent = section.label;

    // Svaki paragraf je svoj tekstualni okvir, kao kod Framer-a: razmak medju
    // njima je onda `gap` bloka (16px), isti kao izmedju oznake i teksta.
    boxes.forEach(function (box) {
      if (box !== labelBox) box.remove();
    });

    var metrics = Array.isArray(section.metrics) ? section.metrics : [];
    if (metrics.length) {
      var grid = div(
        "cms-case__metrics",
        metrics.map(function (metric) {
          return div("cms-case__metric", [
            textFrom(textBox, metric.value, "cms-case__value"),
            metric.label ? textFrom(labelBox, metric.label, "cms-case__muted") : null,
          ]);
        })
      );
      grid.setAttribute("data-count", String(metrics.length));
      node.appendChild(grid);
    }

    (section.paragraphs || []).forEach(function (paragraph) {
      node.appendChild(textFrom(textBox, paragraph));
    });

    var t = section.testimonial;
    if (t && t.quote) {
      var by = [];
      if (t.name) by.push(textFrom(labelBox, t.name));
      if (t.role) by.push(textFrom(labelBox, t.role, "cms-case__muted"));
      node.appendChild(
        div("cms-case__quote", [
          textFrom(textBox, "\u201c" + t.quote + "\u201d", "cms-case__quote-text"),
          by.length ? div("cms-case__by", by) : null,
        ])
      );
    }

    node.style.setProperty("opacity", "0");
    node.style.setProperty("transform", "translateY(25px)");
    node.style.setProperty("transition", "opacity .6s ease, transform .6s ease");
    return node;
  }

  function reveal(node) {
    node.style.setProperty("opacity", "1");
    node.style.setProperty("transform", "none");
  }

  // Na Framer stranicama Lenis smooth scroll ume da zbuni IntersectionObserver
  // (vidi legacy-gallery.js), pa tajmer garantuje da tekst nikad ne ostane
  // nevidljiv; observer samo ulepsava trenutak kad proradi.
  var observer =
    "IntersectionObserver" in window
      ? new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            reveal(entry.target);
            observer.unobserve(entry.target);
          });
        })
      : null;

  function apply(sections) {
    var slots = findSlots();
    slots.forEach(function (slot) {
      var existing = slot.column.querySelectorAll(":scope > [" + MARK + "]");
      if (existing.length === sections.length && existing[0].previousElementSibling === slot.anchor) return;
      Array.prototype.forEach.call(existing, function (node) {
        node.remove();
      });

      var after = slot.anchor;
      sections.forEach(function (section, index) {
        var node = buildBlock(slot, section);
        if (!node) return;
        after.insertAdjacentElement("afterend", node);
        after = node;
        if (observer) observer.observe(node);
        setTimeout(function () {
          reveal(node);
          if (observer) observer.unobserve(node);
        }, 1500 + index * 120);
      });
    });
    if (slots.length) fitSticky();
  }

  // Sticky kolona visa od ekrana: top postaje negativan, pa kolona prvo
  // odskroluje sa stranicom i stane tek kad joj dno udje u sliku. Framer top
  // drzi u svojoj klasi, pa se nadjacava pravilom iz stylesheet-a sa
  // !important, po koloni.
  function fitSticky() {
    var rules = [];
    var columns = [];
    Array.prototype.forEach.call(document.querySelectorAll("[" + MARK + "]"), function (block) {
      if (block.parentElement && columns.indexOf(block.parentElement) < 0) columns.push(block.parentElement);
    });
    columns.forEach(function (column, index) {
      column.setAttribute(STICKY, String(index));
      if (getComputedStyle(column).position !== "sticky") return;
      var overflow = column.offsetHeight + STICKY_GAP * 2 - window.innerHeight;
      if (overflow > 0) {
        rules.push("[" + STICKY + '="' + index + '"]{top:' + (STICKY_GAP - overflow) + "px !important}");
      }
    });

    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    var css = rules.join("");
    if (style.textContent !== css) style.textContent = css;
  }

  function start() {
    var config = readConfig();
    if (!config) return;

    if (!document.getElementById(CASE_STYLE_ID)) {
      var caseStyle = document.createElement("style");
      caseStyle.id = CASE_STYLE_ID;
      caseStyle.textContent = CASE_CSS;
      (document.head || document.documentElement).appendChild(caseStyle);
    }

    // Hidracija nije trenutna i varijante kolone ne stizu istovremeno, pa se
    // pokusava punih 10 sekundi; kad je blok vec na mestu, apply ne radi nista.
    var tries = 0;
    var timer = setInterval(function () {
      apply(config);
      if (++tries > 40) clearInterval(timer);
    }, 250);

    var pending = false;
    function schedule() {
      if (pending) return;
      pending = true;
      setTimeout(function () {
        pending = false;
        apply(config);
      }, 200);
    }

    // React ume da prezida kolonu (npr. pri promeni prelomne tacke) — tada se
    // blok vraca.
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", function () {
      schedule();
      fitSticky();
    });
    window.addEventListener("load", fitSticky);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSticky);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
