/* Slike na naslovnoj i About stranici — cela slika, preko cele sirine.
 *
 * Framer svaku od tih fotografija stavlja u okvir ZADATE visine, secka je sa
 * `object-fit: cover` i uz to je jos uveca — `scale(1.2)` na heroju,
 * `scale(1.4)` na About-u — pa je pomera gore-dole uz skrol. Dok su slike
 * birane uz taj okvir izgledalo je namerno; prva fotografija drugog odnosa
 * stranica ubacena kroz panel ostala je bez glave i bez dna.
 *
 * Uvecanje i pomeranje se sklanjaju svuda — to je cist gubitak kadra: sa
 * `scale(1.4)` se od okvira vidi jedva 70%, i to pomereno.
 *
 * Dalje se ta dva mesta razlikuju:
 *
 *   About  — okviru se pusta visina da PRATI ODNOS same fotografije. Slika tako
 *            ide od ivice do ivice i vidi se cela, na svakoj sirini ekrana.
 *            Posto Framer visinu zakiva i na svim omotacima iznad, i njima se
 *            visina pusta — inace bi visa slika bila odsecena, a niza ostavila
 *            prazninu.
 *
 *   Hero   — preko njega stoji naslov, apsolutno pozicioniran u odnosu na okvir
 *            visok ceo ekran. Ako mu se visina pusti, na telefonu ispadne traka
 *            od ~190px i naslov se prelije van nje. Zato hero zadrzava `cover`,
 *            samo bez uvecanja i pomeranja — vidi se najveci i centriran isecak
 *            koji taj okvir dopusta.
 *
 * Framer inline stil prepisuje na svakom kadru, pa pravila moraju da idu kroz
 * stylesheet sa `!important`: samo tako nadjacaju inline vrednost koju on stalno
 * vraca.
 */

(function () {
  "use strict";

  var STYLE_ID = "cms-media-style";
  var CSS =
    "[data-cms-media]{transform:none!important}" +
    "[data-cms-grow]{height:auto!important;min-height:0!important;max-height:none!important}" +
    // Sam okvir sa slikom je apsolutan. Njemu se visina ne pusta na `auto`
    // — bez donje ivice bi se sklopio na nulu — nego se razapne po celom
    // roditelju, koji je taj koji nosi odnos fotografije.
    "[data-cms-fill]{position:absolute!important;inset:0!important;width:auto!important;height:auto!important}" +
    // Okvir koji nosi odnos je flex stavka; bez ovoga ga roditelj stisne i
    // odnos se ne postuje do kraja.
    "[data-cms-ratio]{height:auto!important;min-height:0!important;max-height:none!important;" +
    "flex-shrink:0!important;flex-basis:auto!important}";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // Okvir slike je roditelj Framer-ovog omotaca pozadinske slike — on nosi
  // zadatu visinu, uvecanje i pomeraj. Sam je apsolutan; u toku stranice stoji
  // njegov roditelj, i on je taj koji dobija odnos fotografije.
  function boxFor(img) {
    var wrapper = img.parentElement;
    if (!wrapper || !wrapper.hasAttribute("data-framer-background-image-wrapper")) return null;
    return wrapper.parentElement;
  }

  // Uzimaju se samo fotografije koje Framer secka (`cover`) i koje nisu deo
  // kartice projekta — kartice su linkovi i njihovo kadriranje je u redu.
  // Potpis i ostale grafike su vec `contain`, pa ispadaju same.
  function candidates() {
    return Array.prototype.filter.call(document.querySelectorAll("img"), function (img) {
      if (!boxFor(img)) return false;
      if (img.closest("a")) return false;
      return getComputedStyle(img).objectFit === "cover";
    });
  }

  // Framer visinu zakiva na celom nizu omotaca iznad slike — i na sekciji, i na
  // redu sa dve slike. Svi se puste, pa se sekcija sleze po sadrzaju.
  //
  // Penjanje staje kad omotac postane mnogo visi od same slike: tu je vec kraj
  // sekcije i pocinje ostatak stranice, koji nema veze sa ovom slikom.
  function grow(node, limit) {
    var chain = [];
    var guard = 0;
    while (node && node !== document.body && guard++ < 10) {
      if (node.getBoundingClientRect().height > limit) break;
      chain.push(node);
      node = node.parentElement;
    }
    chain.forEach(function (el) {
      el.setAttribute("data-cms-grow", "");
    });
  }

  // Odnos se cita iz same slike kad je ucitana. Dok nije — a slike nize na
  // stranici su `loading="lazy"`, pa cekaju skrol — uzimaju se `width`/`height`
  // atributi, da okvir odmah bude priblizno tacan i da stranica ne poskoci kad
  // slika stigne. Za sliku zamenjenu kroz panel ti atributi ostaju stari, pa se
  // po ucitavanju odnos ispravi.
  function ratioOf(img) {
    if (img.naturalWidth && img.naturalHeight) return img.naturalWidth + " / " + img.naturalHeight;
    var w = parseFloat(img.getAttribute("width"));
    var h = parseFloat(img.getAttribute("height"));
    if (w > 0 && h > 0) return w + " / " + h;
    return null;
  }

  function fitWhole(img, box) {
    var ratio = ratioOf(img);
    if (!ratio) return false;

    var frame = box.parentElement;
    if (!frame) return false;

    if (frame.style.aspectRatio !== ratio) frame.style.setProperty("aspect-ratio", ratio);
    frame.setAttribute("data-cms-ratio", "");
    box.setAttribute("data-cms-fill", "");
    grow(frame.parentElement, frame.getBoundingClientRect().height * 3);
    return true;
  }

  function apply() {
    ensureStyle();

    candidates().forEach(function (img) {
      var box = boxFor(img);
      if (!box) return;

      // Hero ostaje `cover` u svom okviru; ostalima okvir prati sliku.
      if (img.closest("header")) {
        box.setAttribute("data-cms-media", "");
        return;
      }

      if (fitWhole(img, box)) box.setAttribute("data-cms-media", "");
      if (!img.dataset.cmsWatched) {
        img.dataset.cmsWatched = "1";
        img.addEventListener("load", apply);
      }
    });
  }

  function start() {
    apply();

    if (window.MutationObserver) {
      // Namerno tajmer, ne requestAnimationFrame: Framer na sirokim ekranima
      // menja varijantu sekcije, pa oznake odu sa starim cvorovima i moraju
      // nazad — a rAF ume da bude uspavan dok se kartica ne iscrtava.
      var pending = false;
      new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () {
          pending = false;
          apply();
        }, 60);
      }).observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener("load", apply);
    window.addEventListener("resize", apply);

    // Slika ume da se dekodira posle svega; par provera da nijedna ne ostane
    // na Framer-ovom okviru.
    [300, 1200, 3000].forEach(function (delay) {
      setTimeout(apply, delay);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
