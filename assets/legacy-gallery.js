/* Dodatne slike u galerijama originalnih 6 Framer stranica.
 *
 * Framer komponenta tih stranica ima tacno sedam imenovanih polja za sliku
 * (hero + sest u galeriji) — vidi __framer__handoverData u samoj stranici.
 * Sedmo polje ne postoji, pa se sedma slika ne moze dodati ni kroz HTML ni
 * kroz payload: React posle hidracije prezida galeriju iz svojih propova i
 * svaki dodat markup nestane.
 *
 * Zato se dodatne slike ubacuju POSLE hidracije, iz ovog skripta. Klonira se
 * postojeci slajd (da razmak, dimenzije i zaobljenja ostanu identicni) i u
 * njemu se zameni slika. Framer svoje slajdove pusta fade-in animacijom preko
 * Framer Motion-a; klon u toj animaciji ne ucestvuje, pa mu se skida pocetno
 * skriveno stanje i dodaje sopstveni fade preko IntersectionObserver-a.
 *
 * Isti mehanizam sluzi i za sklanjanje Framer-ovih slika. Slot se ne moze
 * isprazniti u izvoru — React bi posle hidracije vratio svoju sliku iz propova,
 * a prazan <img src> bi ostavio rupu na stranici. Zato slika ostaje gde jeste i
 * samo joj se slajd sakriva ovde, posle hidracije. Sakriva se preko stylesheet-a
 * sa !important, jer Framer inline stilove prepisuje u svakom frame-u.
 *
 * Oba spiska pise CMS panel u <script id="cms-extra-media"> u samoj stranici.
 * Prazni spiskovi znace da skript ne radi nista.
 */

(function () {
  "use strict";

  var DATA_ID = "cms-extra-media";
  var MARK = "data-cms-extra";
  var HIDE = "data-cms-hidden";
  var DOT = "data-cms-dot";
  var DOT_ON = "data-cms-dot-on";
  var DOT_FIRST = "data-cms-dot-first";
  var DOT_LAST = "data-cms-dot-last";
  var STYLE_ID = "cms-hidden-style";
  var DOT_SELECTOR = 'button[aria-label^="Scroll to page"]';

  function readConfig() {
    var node = document.getElementById(DATA_ID);
    if (!node) return null;
    try {
      var data = JSON.parse(node.textContent || "{}");
      var images = Array.isArray(data.images) ? data.images.filter(function (i) { return i && i.src; }) : [];
      var known = Array.isArray(data.gallery) ? data.gallery : [];
      var hidden = Array.isArray(data.hidden) ? data.hidden.filter(Boolean) : [];
      if (!images.length && !hidden.length) return null;
      return { images: images, known: known, hidden: hidden };
    } catch (err) {
      console.error("cms-extra-media: neispravan JSON", err);
      return null;
    }
  }

  // Framer renderuje istu galeriju u vise varijanti (desktop i mobilna), a
  // koja se vidi zavisi od sirine ekrana — obe stoje u DOM-u. Zato se dopunjuju
  // SVE, ne prva pronadjena: inace se dodate slike zateknu u varijanti koja se
  // kod posetioca ne prikazuje.
  //
  // Kontejner se ne trazi po Framer klasi — one se menjaju sa svakim exportom —
  // nego kao predak koji drzi i prvu i poslednju poznatu sliku galerije.
  function findTracks(known) {
    if (known.length < 2) return [];

    var first = known[0];
    var last = known[known.length - 1];
    var tracks = [];

    Array.prototype.forEach.call(
      document.querySelectorAll('img[src*="' + first + '"]'),
      function (img) {
        var node = img.parentElement;
        while (node && node !== document.body) {
          if (node.querySelector('img[src*="' + last + '"]')) break;
          node = node.parentElement;
        }
        if (!node || node === document.body) return;

        // Slajd je ono dete kontejnera koje sadrzi ovu sliku.
        var slide = img;
        while (slide && slide.parentElement !== node) slide = slide.parentElement;
        if (!slide) return;

        var seen = tracks.some(function (entry) {
          return entry.track === node;
        });
        if (!seen) tracks.push({ track: node, slide: slide });
      }
    );

    return tracks;
  }

  function buildSlide(template, image, index) {
    var node = template.cloneNode(true);
    node.setAttribute(MARK, String(index));
    // Sablon je prvi slajd galerije; ako je bas on sakriven, klon to ne nasledjuje.
    node.removeAttribute(HIDE);

    node.querySelectorAll("video, source").forEach(function (el) {
      el.remove();
    });
    node.querySelectorAll("img").forEach(function (img) {
      // Video slajd: slika iz sablona se menja videom koji nasledjuje njen
      // polozaj i isecanje (klasa i inline stil), pa stoji u okviru isto kao slika.
      if (isVideo(image.src)) {
        var video = document.createElement("video");
        if (img.className) video.className = img.className;
        if (img.getAttribute("style")) video.setAttribute("style", img.getAttribute("style"));
        video.src = image.src;
        if (image.poster) video.poster = image.poster;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "none";
        video.setAttribute("muted", "");
        video.setAttribute("playsinline", "");
        video.setAttribute("disablepictureinpicture", "");
        video.setAttribute("aria-label", image.alt || "Video");
        video.style.setProperty("object-fit", "cover");
        img.parentNode.replaceChild(video, img);
        return;
      }
      img.setAttribute("src", image.src);
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
      img.setAttribute("alt", image.alt || "");
      img.setAttribute("loading", "lazy");
    });

    // Framer ostavlja slajd sakriven dok ga njegova scroll animacija ne pusti;
    // klon nije deo te animacije, pa bi ostao nevidljiv zauvek.
    node.style.setProperty("opacity", "0");
    node.style.setProperty("transform", "translateY(20px)");
    node.style.setProperty("transition", "opacity .6s ease, transform .6s ease");
    node.style.setProperty("will-change", "opacity, transform");
    return node;
  }

  function reveal(node) {
    node.style.setProperty("opacity", "1");
    node.style.setProperty("transform", "none");
  }

  function apply(config) {
    var tracks = findTracks(config.known);
    if (!tracks.length) return false;

    ensureStyle();
    tracks.forEach(function (found) {
      hide(config, found);
      fill(config, found);
      // Tek sad je traka u konacnom stanju: visak sklonjen, dodate slike unutra.
      syncDots(found);
    });
    return true;
  }

  // Framer inline stilove prepisuje u svakom frame-u, pa se sakriva pravilom iz
  // stylesheet-a sa !important, a ne postavljanjem style.display na slajdu.
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "[" + HIDE + "]{display:none !important}" +
      // Framer i tackicama pise inline stil u svakom frame-u, pa i razmak i
      // aktivno stanje moraju da dodju odavde.
      "[" + DOT + "]{padding:10px 4px !important}" +
      "[" + DOT_FIRST + "]{padding-left:10px !important}" +
      "[" + DOT_LAST + "]{padding-right:10px !important}" +
      "[" + DOT + "]>*{opacity:.5 !important}" +
      "[" + DOT_ON + "]>*{opacity:1 !important}";
    (document.head || document.documentElement).appendChild(style);
  }

  // Slajdovi koje je panel oznacio kao sklonjene. Slika ostaje u izvoru — samo
  // njen slajd ispada iz rasporeda, pa nema ni praznog mesta ni scroll-snap
  // tacke na mobilnoj traci.
  function hide(config, found) {
    if (!config.hidden.length) return;

    config.hidden.forEach(function (token) {
      var selector = 'img[src*="' + token + '"], source[srcset*="' + token + '"]';
      Array.prototype.forEach.call(found.track.querySelectorAll(selector), function (node) {
        var slide = node;
        while (slide && slide.parentElement !== found.track) slide = slide.parentElement;
        // Dodate slike nikad ne ucestvuju: njihov src je nov, a sablon im je
        // ocisten u buildSlide.
        if (!slide || slide.hasAttribute(MARK)) return;
        if (!slide.hasAttribute(HIDE)) slide.setAttribute(HIDE, "");
      });
    });
  }

  // Framer iscrtava tacno sest tackica — koliko komponenta ima polja za sliku,
  // a ne koliko slajdova stvarno stoji u traci. Na Pletho-u je vec bilo sest
  // tackica na dvanaest slajdova, a cim se slajd skloni, Framer na kraju trake
  // upali tackicu koje vise nema na ekranu.
  //
  // Zato se tackice preuzimaju: jedna po slajdu, aktivna se racuna iz
  // scrollLeft-a, a klik vodi na tacan slajd. Ista logika vec stoji u
  // assets/cms.js za nove project stranice, pa se obe galerije ponasaju isto.
  function slidesOf(track) {
    return Array.prototype.filter.call(track.children, function (node) {
      return !node.hasAttribute(HIDE);
    });
  }

  function markActive(pill, track) {
    var slides = slidesOf(track);
    var dots = pill.querySelectorAll("[" + DOT + "]:not([" + HIDE + "])");
    if (!dots.length) return;

    var best = 0;
    var nearest = Infinity;
    slides.forEach(function (slide, index) {
      var distance = Math.abs(slide.offsetLeft - track.scrollLeft);
      if (distance < nearest) {
        nearest = distance;
        best = index;
      }
    });

    Array.prototype.forEach.call(dots, function (dot, index) {
      if (index === best) dot.setAttribute(DOT_ON, "");
      else dot.removeAttribute(DOT_ON);
    });
  }

  function syncDots(found) {
    var track = found.track;
    var scope = track.parentElement;
    while (scope && scope !== document.body && !scope.querySelector(DOT_SELECTOR)) {
      scope = scope.parentElement;
    }
    if (!scope || scope === document.body) return;

    var first = scope.querySelector(DOT_SELECTOR);
    if (!first) return;
    var pill = first.parentElement;
    var slides = slidesOf(track);
    if (!slides.length) return;

    // Framer-ovih dugmadi ima sest; visak se sakriva, a kad slajdova ima vise
    // (dodate slike) dogradjuju se klonovi. Klon ne nosi React-ov interni kljuc,
    // pa Framer-ov delegirani rukovalac na njemu nista ne radi — klik hvatamo mi.
    var buttons = Array.prototype.slice.call(pill.children);
    while (buttons.length < slides.length) {
      var clone = buttons[0].cloneNode(true);
      pill.appendChild(clone);
      buttons.push(clone);
    }

    buttons.forEach(function (button, index) {
      button.setAttribute(DOT, "");
      button.setAttribute("aria-label", "Slika " + (index + 1));
      if (index >= slides.length) {
        button.setAttribute(HIDE, "");
        button.removeAttribute(DOT_FIRST);
        button.removeAttribute(DOT_LAST);
        return;
      }
      button.removeAttribute(HIDE);
      if (index === 0) button.setAttribute(DOT_FIRST, "");
      else button.removeAttribute(DOT_FIRST);
      if (index === slides.length - 1) button.setAttribute(DOT_LAST, "");
      else button.removeAttribute(DOT_LAST);
    });

    if (!pill.hasAttribute("data-cms-dots-bound")) {
      pill.setAttribute("data-cms-dots-bound", "");

      // Capture faza i stopImmediatePropagation: Framer svoj klik racuna
      // proporcionalno po sirini trake, sto posle sklanjanja vodi na pogresan slajd.
      pill.addEventListener(
        "click",
        function (event) {
          var button = event.target.closest ? event.target.closest("[" + DOT + "]") : null;
          if (!button || button.hasAttribute(HIDE)) return;
          event.preventDefault();
          event.stopImmediatePropagation();

          var visible = Array.prototype.filter.call(pill.children, function (node) {
            return !node.hasAttribute(HIDE);
          });
          var slide = slidesOf(track)[visible.indexOf(button)];
          if (slide) track.scrollTo({ left: slide.offsetLeft, behavior: "smooth" });
        },
        true
      );

      var pending = false;
      track.addEventListener("scroll", function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () {
          pending = false;
          markActive(pill, track);
        });
      });
    }

    markActive(pill, track);
  }

  function fill(config, found) {
    // Provera je broj slajdova, ne "postoji li ijedan": ako React prezida
    // listu i pojede deo dodatih, ostatak se skida i ubacuju se svi ponovo.
    var existing = found.track.querySelectorAll("[" + MARK + "]");
    if (existing.length === config.images.length) return;
    Array.prototype.forEach.call(existing, function (node) {
      node.remove();
    });

    // Framer svoje slajdove otkriva sopstvenom scroll matematikom sticky
    // sekcije, a ne prostim presecanjem sa viewport-om — na to se ne moze
    // zakaciti. IntersectionObserver se koristi samo da fade lepse ispadne kad
    // proradi; bezuslovni tajmer garantuje da slika nikad ne ostane nevidljiva.
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

    config.images.forEach(function (image, index) {
      var node = buildSlide(found.slide, image, index);
      found.track.appendChild(node);
      if (observer) observer.observe(node);
      setTimeout(function () {
        reveal(node);
        if (observer) observer.unobserve(node);
      }, 1500);
      Array.prototype.forEach.call(node.querySelectorAll("video"), watchVideo);
    });
  }

  function isVideo(src) {
    return /\.(mp4|webm|mov|m4v)$/i.test(String(src || ""));
  }

  // Dodati videi se pustaju sami, bez zvuka i u krug, samo dok su na ekranu —
  // ista logika kao u assets/cms.js za nove project stranice (menjati na oba
  // mesta). Ko je iskljucio animacije ili stedi podatke dobija kontrole.
  var calm =
    (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
    (navigator.connection && navigator.connection.saveData);
  var visibleVideos = [];
  var warmObserver = null;
  var playObserver = null;

  function showControls(video) {
    video.controls = true;
    video.preload = "metadata";
  }

  function playVideo(video) {
    if (video.dataset.cmsPaused || document.hidden) return;
    var attempt = video.play();
    if (attempt && attempt.catch) attempt.catch(function () { showControls(video); });
  }

  function watchVideo(video) {
    if (calm || typeof IntersectionObserver !== "function") {
      showControls(video);
      return;
    }
    if (!warmObserver) {
      warmObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.preload = "auto";
            warmObserver.unobserve(entry.target);
          });
        },
        { rootMargin: "400px 0px" }
      );
      playObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            var target = entry.target;
            var at = visibleVideos.indexOf(target);
            if (entry.isIntersecting && target.isConnected) {
              if (at < 0) visibleVideos.push(target);
              playVideo(target);
            } else {
              if (at >= 0) visibleVideos.splice(at, 1);
              target.pause();
            }
          });
        },
        { threshold: 0.25 }
      );
      document.addEventListener("visibilitychange", function () {
        visibleVideos.forEach(function (target) {
          if (document.hidden) target.pause();
          else playVideo(target);
        });
      });
    }
    warmObserver.observe(video);
    playObserver.observe(video);
    video.addEventListener("click", function () {
      if (video.controls) return;
      if (video.paused) {
        delete video.dataset.cmsPaused;
        playVideo(video);
      } else {
        video.dataset.cmsPaused = "1";
        video.pause();
      }
    });
  }

  function start() {
    var config = readConfig();
    if (!config) return;

    // Hidracija nije trenutna, a React usput zameni podrazumevani markup i
    // varijante galerije ne moraju da se pojave istovremeno. Zato se pokusava
    // punih 10 sekundi i ne prekida na prvom uspehu — druga varijanta zna da
    // stigne kasnije. Kad se broj slajdova poklopi, apply nista ne radi.
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

    // Prezidavanje liste (npr. promena breakpointa) vraca dodate slajdove.
    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", schedule);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
