// Vanilla JS for CMS-generated work pages. Intentionally independent of
// Framer's bundle (script_main.mjs) — these pages don't load it.
(function () {
  "use strict";

  // Mobile menu overlay
  var menuBtn = document.querySelector("[data-cms-menu-open]");
  var overlay = document.querySelector("[data-cms-menu-overlay]");
  var closeBtn = document.querySelector("[data-cms-menu-close]");
  if (menuBtn && overlay && closeBtn) {
    menuBtn.addEventListener("click", function () {
      overlay.classList.add("is-open");
    });
    closeBtn.addEventListener("click", function () {
      overlay.classList.remove("is-open");
    });
    overlay.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        overlay.classList.remove("is-open");
      });
    });
  }

  // Ulazne animacije: sve sa data-cms-reveal krece sakriveno (vidi cms.css) i
  // otkriva se kad udje u sliku. Na ovim stranicama nema Lenis smooth scrolla
  // koji na Framer stranicama razbija IntersectionObserver, pa je observer
  // ovde pouzdan.
  var reveal = document.querySelectorAll("[data-cms-reveal]");
  if (reveal.length) {
    var show = function (node) {
      node.classList.add("is-in");
    };

    if (typeof IntersectionObserver === "function") {
      var seen = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            show(entry.target);
            seen.unobserve(entry.target);
          });
        },
        // Krece malo pre nego sto element stigne do ivice, da animacija ne
        // pocinje tek kad je vec pola u slici.
        { rootMargin: "0px 0px -12% 0px", threshold: 0.01 }
      );
      reveal.forEach(function (node) {
        seen.observe(node);
      });
    } else {
      reveal.forEach(show);
    }

    // Osigurac: sadrzaj ne sme da ostane nevidljiv ako observer zakaze. Otkriva
    // se samo ono sto je tada stvarno u slici — kad bi se otkrilo sve, ostatak
    // stranice bi izgubio animaciju pri skrolu.
    setTimeout(function () {
      reveal.forEach(function (node) {
        if (node.classList.contains("is-in")) return;
        var rect = node.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) show(node);
      });
    }, 3000);
  }

  // Tackice ispod galerije. Na uskom ekranu se slike prevlace u stranu (vidi
  // cms.css), pa treba pokazati na kojoj si — i omoguciti skok na bilo koju.
  // Sam pomeraj radi `scroll-snap`; ovde se samo cita i postavlja `scrollLeft`.
  var gallery = document.querySelector("[data-cms-gallery]");
  var dots = document.querySelector("[data-cms-dots]");
  if (gallery && dots) {
    var figures = Array.prototype.slice.call(
      gallery.querySelectorAll(".cms-project__figure")
    );

    // Jedna slika nema izmedju cega da se bira.
    if (figures.length > 1) {
      var buttons = figures.map(function (figure, index) {
        var button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-label", "Slika " + (index + 1));
        button.appendChild(document.createElement("span"));
        button.addEventListener("click", function () {
          var delta =
            figure.getBoundingClientRect().left - gallery.getBoundingClientRect().left;
          gallery.scrollTo({ left: gallery.scrollLeft + delta, behavior: "smooth" });
        });
        dots.appendChild(button);
        return button;
      });

      // Aktivna je ona slika ciji je levi rub najblizi levom rubu okvira —
      // racuna se iz stvarnih polozaja, pa ne zavisi od sirine i razmaka.
      var markActive = function () {
        var base = gallery.getBoundingClientRect().left;
        var best = 0;
        var bestDistance = Infinity;
        figures.forEach(function (figure, index) {
          var distance = Math.abs(figure.getBoundingClientRect().left - base);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
          }
        });
        buttons.forEach(function (button, index) {
          if (index === best) button.setAttribute("aria-current", "true");
          else button.removeAttribute("aria-current");
        });
      };

      var pending = false;
      gallery.addEventListener(
        "scroll",
        function () {
          if (pending) return;
          pending = true;
          requestAnimationFrame(function () {
            pending = false;
            markActive();
          });
        },
        { passive: true }
      );

      window.addEventListener("resize", markActive);
      markActive();
    }
  }

  // Desna kolona prati skrol (sticky, top: 48px). Kad sa tekstom "Approach"
  // postane visa od ekrana, sa top: 48px bi joj dno ostalo van slike sve do
  // kraja galerije. Zato se tada lepi tek kad joj dno udje u sliku: top postaje
  // negativan, pa kolona prvo odskroluje sa stranicom, a onda stane. Ista
  // logika stoji u assets/project-story.js za originalne Framer stranice.
  var info = document.querySelector(".cms-project__info");
  if (info) {
    var STICKY_GAP = 48;
    var fitSticky = function () {
      info.style.top = "";
      // Ispod 810px kolona nije sticky (vidi cms.css) — nema sta da se racuna.
      if (getComputedStyle(info).position !== "sticky") return;
      var overflow = info.offsetHeight + STICKY_GAP * 2 - window.innerHeight;
      if (overflow > 0) info.style.top = STICKY_GAP - overflow + "px";
    };

    fitSticky();
    window.addEventListener("resize", fitSticky);
    window.addEventListener("load", fitSticky);
    // Visina zavisi od fonta: dok se Inter Display ne ucita, prelom je drugaciji.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSticky);
  }

})();
