/* Cetiri ispravke Framer runtime-a na exportovanim stranicama.
 *
 * 1. Klijentska navigacija — iskljucena.
 * 2. Tap na dodirnom ekranu — uvek vodi, i iz prvog puta.
 * 3. Mobilni meni — dobio je sadrzaj; u exportu ga nije ni bilo.
 * 4. Naslov stranice — vracen na onaj iz HTML-a.
 *
 * Framer export nosi svoj router: klik na interni link se presretne i stranica
 * se iscrta na klijentu, iz podataka koje Framer nosi sa sobom. To je bilo u
 * redu dok je sadrzaj dolazio iskljucivo iz Framera.
 *
 * Sada nije: /work i /work/<slug> generise scripts/build.mjs, a sadrzaj
 * originalnih stranica menja CMS panel prepisom samih fajlova. Framer o tim
 * izmenama ne zna nista, pa bi soft-navigacija prikazala staro stanje — nov
 * projekat se ne bi video na /work, zamenjena slika bi ostala stara — sve dok
 * se stranica ne osvezi rucno.
 *
 * Zato se svaki interni link vodi kao obicno ucitavanje stranice. Gubi se
 * Framer-ov prelaz izmedju stranica; dobija se to da se uvek vidi ono sto je
 * stvarno na sajtu.
 */

(function () {
  "use strict";

  /* ---------------------------------------------------------- navigacija */

  function linkFor(node) {
    var link = node && node.closest ? node.closest("a[href]") : null;
    if (!link) return null;
    if (link.hasAttribute("download")) return null;
    if (link.target && link.target !== "_self") return null;
    return link;
  }

  // vercel.json ima trailingSlash: false, pa je kanonska putanja bez kose crte
  // na kraju. Framer u exportu koristi relativne linkove ("../work"), koji se
  // racunaju od nivoa TRENUTNE putanje — ako se stranica ipak otvori sa kosom
  // crtom (/about/), "../work" postaje /about/work umesto /work, i ceo meni
  // vodi u 404. Zato se racuna od kanonske putanje, ne od one iz adrese.
  function canonicalPath(path) {
    return path.length > 1 && path.charAt(path.length - 1) === "/"
      ? path.slice(0, -1)
      : path;
  }

  // Vraca odrediste samo ako je u pitanju interni link koji zaista vodi na
  // drugu stranicu; sidro unutar iste stranice ostaje sidro.
  function internalTarget(link) {
    var raw = link.getAttribute("href");
    if (!raw) return null;

    var here = canonicalPath(location.pathname);
    var url;
    try {
      url = new URL(raw, location.origin + here + location.search);
    } catch (err) {
      return null;
    }
    if (url.origin !== location.origin) return null;
    if (canonicalPath(url.pathname) === here && url.hash) return null;
    return url.href;
  }

  function go(href) {
    try {
      location.assign(href);
    } catch (err) {
      location.href = href;
    }
  }

  function isPlainLeftClick(event) {
    return (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    );
  }

  // Namerno se NE gleda event.defaultPrevented: ako je neki drugi rukovalac
  // stigao pre nas i vec otkazao podrazumevanu radnju, to je upravo slucaj u
  // kome bi Framer preuzeo navigaciju i prikazao staro stanje. Interni link
  // uvek treba da bude obicno ucitavanje.
  function onClick(event) {
    if (!isPlainLeftClick(event)) return;

    var link = linkFor(event.target);
    if (!link) return;

    var href = internalTarget(link);
    if (!href) return;

    // Capture faza + stopImmediatePropagation: Framer-ov rukovalac nikad ne
    // vidi ovaj klik.
    event.preventDefault();
    event.stopImmediatePropagation();
    go(href);
  }

  document.addEventListener("click", onClick, true);

  /* ------------------------------------------------------------ prevlacenje */

  // Link se u browseru moze prevuci (drag). Ako se mis pomeri vise od ~4px
  // dok je taster pritisnut — sto se na touchpadu ili u brzom pokretu desava
  // stalno — browser to tumaci kao pocetak prevlacenja i klik se nikad ne
  // desi. Linkovi u meniju su mali (oko 40x22px), pa je izgledalo kao da
  // dugme ne reaguje dok se ne klikne vise puta.
  //
  // CSS gasi prevlacenje u Chrome-u i Safariju, dragstart u Firefox-u.
  var noDrag = document.createElement("style");
  noDrag.textContent = "a[href]{-webkit-user-drag:none}";
  document.head.appendChild(noDrag);

  document.addEventListener(
    "dragstart",
    function (event) {
      if (linkFor(event.target)) event.preventDefault();
    },
    true
  );

  /* --------------------------------------------------------------- dodir */

  // Stranice koriste Lenis smooth scroll. Dok stranica jos klizi po inerciji,
  // prvi dodir cesto samo zaustavi to klizanje i nikad ne postane klik — pa
  // izgleda kao da link ne radi dok se ne tapne jos par puta.
  //
  // Zato se tap hvata na `touchend`: ako se prst pomerio jedva i dodir je
  // trajao kratko, to je tap i vodi se kao navigacija. `preventDefault`
  // sprecava klik koji bi browser posle toga sam napravio, pa nema dvostruke
  // navigacije.
  var TAP_SLOP = 10; // px
  var TAP_TIME = 700; // ms
  var touch = null;

  document.addEventListener(
    "touchstart",
    function (event) {
      if (event.touches.length !== 1) {
        touch = null;
        return;
      }
      var point = event.touches[0];
      touch = {
        x: point.clientX,
        y: point.clientY,
        at: Date.now(),
        link: linkFor(event.target),
      };
    },
    true
  );

  document.addEventListener("touchcancel", function () {
    touch = null;
  }, true);

  document.addEventListener(
    "touchend",
    function (event) {
      var start = touch;
      touch = null;
      if (!start || !start.link) return;

      var point = event.changedTouches && event.changedTouches[0];
      if (!point) return;
      if (Math.abs(point.clientX - start.x) > TAP_SLOP) return;
      if (Math.abs(point.clientY - start.y) > TAP_SLOP) return;
      if (Date.now() - start.at > TAP_TIME) return;

      var href = internalTarget(start.link);
      if (!href) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      go(href);
    },
    true
  );

  /* ---------------------------------------------------------- mobilni meni */

  // Na uskom ekranu navigacija je svedena na dugme MENU. U Framer projektu ono
  // otvara overlay, ali NocodeXport tu interakciju nije izvezao: dugme u
  // stranici nema nijedan rukovalac (provereno na React propovima — samo
  // `className`, `style`, `tabIndex`). Dakle sa naslovne, About-a i Contact-a
  // se na telefonu uopste nije moglo doci do Works-a.
  //
  // Zbunjujuce je bilo to sto na /work i /work/<slug> meni RADI — te stranice
  // generise scripts/build.mjs i na njima meni pravi assets/cms.js. Otud utisak
  // da "nekad radi, nekad ne".
  //
  // Ovde se pravi isti takav overlay, istog izgleda kao onaj iz cms.css.

  var LINKS = [
    ["/", "Home"],
    ["/work", "Works"],
    ["/about", "About"],
    ["/contact", "Contact"],
  ];

  var overlay = null;

  function buildOverlay() {
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "framer-nav-menu";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:1000;display:none;flex-direction:column;" +
      "padding:24px;background:rgb(15,15,15)";

    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.style.cssText =
      "align-self:flex-end;background:none;border:0;color:#fff;cursor:pointer;" +
      "font-family:'PT Mono',monospace;font-size:15px;text-transform:uppercase";
    close.addEventListener("click", closeMenu);
    overlay.appendChild(close);

    var list = document.createElement("nav");
    list.style.cssText = "margin-top:48px;display:flex;flex-direction:column;gap:24px";
    LINKS.forEach(function (pair) {
      var link = document.createElement("a");
      link.href = pair[0];
      link.textContent = pair[1];
      link.style.cssText =
        "color:#fff;text-decoration:none;font-size:32px;" +
        "font-family:'Switzer','Switzer Placeholder',sans-serif";
      list.appendChild(link);
    });
    overlay.appendChild(list);

    document.body.appendChild(overlay);
    return overlay;
  }

  function openMenu() {
    buildOverlay().style.display = "flex";
    document.documentElement.style.overflow = "hidden";
  }

  function closeMenu() {
    if (!overlay) return;
    overlay.style.display = "none";
    document.documentElement.style.overflow = "";
  }

  // Dugme se trazi po Framer imenu, a ako ga nema — po tekstu, da preziv i
  // eventualni novi export.
  function menuButton() {
    var named = document.querySelector('[data-framer-name="Menu Button"]');
    if (named) return named;

    return Array.prototype.filter.call(
      document.querySelectorAll('[role="button"], button, div[tabindex]'),
      function (node) {
        return node.textContent.trim().toUpperCase() === "MENU";
      }
    )[0] || null;
  }

  // Slusa se na dokumentu, ne na samom dugmetu: Framer posle hidracije ume da
  // zameni cvor, pa bi rukovalac otisao sa starim.
  document.addEventListener(
    "click",
    function (event) {
      var button = menuButton();
      if (!button || !button.contains(event.target)) return;
      event.preventDefault();
      openMenu();
    },
    true
  );

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeMenu();
  });

  /* --------------------------------------------------------------- naslov */

  // Framer posle hidracije prepise <title> naslovom iz svojih podataka: na
  // /about je u HTML-u "About — Dejan Tumenko, Brand Designer", a runtime ga
  // vrati na genericki "Tumenko — Brand Designer". Google izvrsava JS, pa bi
  // indeksirao prepisani naslov i SEO naslovi ne bi znacili nista.
  //
  // Naslov iz HTML-a se zapamti i vraca se kad god ga nesto promeni.
  //
  // Ne cita se iz document.title: Framer-ov script_main je `async` modul i iz
  // kesa zna da hidrira PRE ovog `defer` skripta, pa bi se zapamtio vec
  // prepisan naslov ("Cro Sea Villas - My Framer Site") i branio bi se on.
  // og:title nosi isti naslov kao <title>, a Framer ga ne dira.
  var ogTitle = document.querySelector('meta[property="og:title"]');
  var wantedTitle = (ogTitle && ogTitle.getAttribute("content")) || document.title;

  function keepTitle() {
    if (document.title !== wantedTitle) document.title = wantedTitle;
  }

  if (window.MutationObserver) {
    // Prati se ceo <head>: Framer ume i da zameni sam <title> element, ne samo
    // njegov tekst.
    new MutationObserver(keepTitle).observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  window.addEventListener("load", keepTitle);
})();
