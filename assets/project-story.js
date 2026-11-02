/* Tekst "Approach" na originalnih 6 Framer stranica — desno, ispod disciplina.
 *
 * Framer komponenta tih stranica nema polje za taj tekst, a markup dodat u
 * izvor React posle hidracije skloni (isti problem kao sa dodatnim slikama —
 * vidi assets/legacy-gallery.js). Zato ga scripts/build.mjs upisuje kao JSON
 * u <script id="cms-story">, iz polja `story` u content/legacy-work.json, a
 * ovaj skript ga ubacuje POSLE hidracije.
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

  function readConfig() {
    var node = document.getElementById(DATA_ID);
    if (!node) return null;
    try {
      var data = JSON.parse(node.textContent || "{}");
      var paragraphs = Array.isArray(data.paragraphs) ? data.paragraphs.filter(Boolean) : [];
      if (!paragraphs.length) return null;
      return { label: data.label || "Approach", paragraphs: paragraphs };
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

  function buildBlock(slot, config) {
    var node = slot.group.cloneNode(true);
    node.setAttribute(MARK, "");
    clearMotion(node);

    var boxes = Array.prototype.slice.call(node.children);
    var labelIndex = Array.prototype.indexOf.call(slot.group.children, slot.labelBox);
    var labelBox = boxes[labelIndex];
    var textBox = boxes[labelIndex + 1] || boxes[labelIndex === 0 ? 1 : 0];
    if (!labelBox || !textBox) return null;

    var labelText = labelBox.querySelector("p") || labelBox;
    labelText.textContent = config.label;

    // Svaki paragraf je svoj tekstualni okvir, kao kod Framer-a: razmak medju
    // njima je onda `gap` bloka (16px), isti kao izmedju oznake i teksta.
    boxes.forEach(function (box) {
      if (box !== labelBox) box.remove();
    });
    config.paragraphs.forEach(function (paragraph) {
      var box = textBox.cloneNode(true);
      var p = box.querySelector("p") || box;
      // Framer ume da podeli tekst na vise <p> u istom okviru — ostaje jedan.
      Array.prototype.forEach.call(box.querySelectorAll("p"), function (other) {
        if (other !== p) other.remove();
      });
      p.textContent = paragraph;
      node.appendChild(box);
    });

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

  function apply(config) {
    var slots = findSlots();
    slots.forEach(function (slot) {
      var existing = slot.column.querySelector(":scope > [" + MARK + "]");
      if (existing && existing.previousElementSibling === slot.anchor) return;
      if (existing) existing.remove();

      var node = buildBlock(slot, config);
      if (!node) return;
      slot.anchor.insertAdjacentElement("afterend", node);
      if (observer) observer.observe(node);
      setTimeout(function () {
        reveal(node);
        if (observer) observer.unobserve(node);
      }, 1500);
    });
    if (slots.length) fitSticky();
  }

  // Sticky kolona visa od ekrana: top postaje negativan, pa kolona prvo
  // odskroluje sa stranicom i stane tek kad joj dno udje u sliku. Framer top
  // drzi u svojoj klasi, pa se nadjacava pravilom iz stylesheet-a sa
  // !important, po koloni.
  function fitSticky() {
    var rules = [];
    Array.prototype.forEach.call(document.querySelectorAll("[" + MARK + "]"), function (block, index) {
      var column = block.parentElement;
      if (!column) return;
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
