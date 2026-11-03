/* CMS panel za Tumenko portfolio — Framer CMS izgled, GitHub kao backend.
 *
 * Dve vrste stavki, isti editor:
 *
 *   kind "cms"     content/work/<slug>.md
 *                  scripts/build.mjs generise work/<slug>/index.html
 *
 *   kind "legacy"  6 originalnih Framer stranica. Njihov HTML je staticki
 *                  export bez Markdown izvora, pa se slike menjaju prepisom
 *                  src/srcset atributa u samom HTML-u — isto sto radi i
 *                  scripts/optimize-images.py. Mapa "koja slika je koji slot"
 *                  je content/legacy-images.json (vidi scripts/legacy-images.mjs).
 *
 * Sve izmene jedne stavke odlaze u JEDAN commit preko Git Data API-ja: upload
 * slika, prepisan HTML, azuriran manifest i legacy-work.json idu zajedno, pa
 * Vercel pravi jedan build umesto jednog po fajlu.
 *
 * Prijava je GitHub OAuth popup (api/auth.js + api/callback.js).
 */

(function () {
  "use strict";

  var CFG = window.CMS_CONFIG || {};
  var DEMO = !!CFG.demo;
  var TOKEN_KEY = "tumenko-cms-token";
  // Broj slika u 6 originalnih Framer stranica. Nije nasa odluka — Framer
  // komponenta tih stranica ima tacno sedam imenovanih polja za sliku (hero +
  // sest u galeriji), pa se sedma ne moze dodati bez izmene u samom Frameru.
  // Novi CMS projekti nemaju to ogranicenje: njihova galerija je niz.
  var LEGACY_IMAGE_SLOTS = 6;
  var NEW_PROJECT_SLOTS = 3;

  /* ------------------------------------------------------------ helpers */

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (value === null || value === undefined || value === false) return;
        if (key === "class") node.className = value;
        else if (key === "html") node.innerHTML = value;
        else if (key === "text") node.textContent = value;
        else if (key === "style") node.setAttribute("style", value);
        else if (key.slice(0, 2) === "on") node.addEventListener(key.slice(2), value);
        else if (key in node && key !== "list" && key !== "type") node[key] = value;
        else node.setAttribute(key, value);
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function svg(paths, width) {
    return (
      '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="' + (width || 1.7) + '" stroke-linecap="round" stroke-linejoin="round">' +
      paths +
      "</svg>"
    );
  }

  var ICONS = {
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    sort: svg('<path d="M7 4v16M7 4 4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3"/>'),
    filter: svg('<path d="M4 6h16M7 12h10M10 18h4"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>'),
    grip: svg('<circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none"/>'),
    database: svg('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>'),
    chevronDown: svg('<path d="m6 9 6 6 6-6"/>', 2),
    close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.7 5.7 3.7 9S14.5 18.3 12 21c-2.5-2.7-3.7-5.7-3.7-9S9.5 5.7 12 3Z"/>'),
    branch: svg('<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 7v10M18 11c0 3-4 3-6 4"/>'),
    play: svg('<path d="M8 5.5v13l10-6.5-10-6.5Z"/>'),
    trash: svg('<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>'),
    logout: svg('<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 16l4-4-4-4M20 12H10"/>'),
    arrowUp: svg('<path d="M12 19V5M12 5l-5 5M12 5l5 5"/>'),
    arrowDown: svg('<path d="M12 5v14M12 19l-5-5M12 19l5-5"/>'),
    file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>'),
  };

  var LOGO = '<img class="logo" src="/assets/images/image-882b5959.png" alt="Dejan Tumenko">';

  function toast(message, isError) {
    var host = document.querySelector(".toasts");
    if (!host) {
      host = el("div", { class: "toasts" });
      document.body.appendChild(host);
    }
    var node = el("div", { class: "toast" + (isError ? " toast--error" : ""), text: message });
    host.appendChild(node);
    setTimeout(function () {
      node.remove();
    }, isError ? 9000 : 4000);
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function b64encode(text) {
    var bytes = new TextEncoder().encode(text);
    var binary = "";
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function b64decode(b64) {
    var binary = atob(String(b64).replace(/\s/g, ""));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  var FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

  function parseMarkdown(text) {
    var match = FRONTMATTER.exec(text);
    if (!match) return { data: {}, body: text };
    var data = {};
    try {
      data = window.jsyaml.load(match[1]) || {};
    } catch (err) {
      console.error("Neispravan frontmatter", err);
    }
    return { data: data, body: match[2] };
  }

  function stringifyMarkdown(data, body) {
    var yaml = window.jsyaml.dump(data, { lineWidth: -1, noRefs: true });
    return "---\n" + yaml + "---\n\n" + String(body || "").trim() + "\n";
  }

  function isVideoPath(value) {
    return /\.(mp4|webm|mov|m4v)$/i.test(String(value || ""));
  }

  /* --------------------------------------------------------------- store */

  function GitHubStore(token) {
    this.token = token;
    this.shas = {};
  }

  GitHubStore.prototype.api = function (url, options) {
    var opts = options || {};
    var headers = {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + this.token,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (opts.body) headers["Content-Type"] = "application/json";

    // Bez no-store browser servira kesiran odgovor GitHub API-ja, pa se posle
    // Publish-a projekat otvori sa starim slikama dok se panel ne osvezi.
    return fetch("https://api.github.com" + url, {
      method: opts.method || "GET",
      headers: headers,
      cache: "no-store",
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      if (res.status === 404 && !opts.required) return null;
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        throw new Error("GitHub prijava je istekla — uloguj se ponovo.");
      }
      if (res.status === 204) return null;
      return res.json().then(function (json) {
        if (!res.ok) throw new Error((json && json.message) || "GitHub API " + res.status);
        return json;
      });
    });
  };

  GitHubStore.prototype.repoPath = function (file) {
    return "/repos/" + CFG.repo + "/contents/" + file.split("/").map(encodeURIComponent).join("/");
  };

  GitHubStore.prototype.readFile = function (file) {
    return this.api(this.repoPath(file) + "?ref=" + encodeURIComponent(CFG.branch)).then(
      function (res) {
        return res ? b64decode(res.content) : null;
      }
    );
  };

  GitHubStore.prototype.user = function () {
    return this.api("/user", { required: true });
  };

  // Jedan commit za proizvoljno mnogo fajlova. files: [{path, base64}] ili
  // [{path, remove: true}]. Contents API bi napravio commit po fajlu.
  GitHubStore.prototype.commit = function (message, files) {
    var self = this;
    var repo = "/repos/" + CFG.repo;
    var ref = "heads/" + CFG.branch;

    if (!files.length) return Promise.resolve();

    return this.api(repo + "/git/ref/" + ref, { required: true })
      .then(function (refData) {
        var baseSha = refData.object.sha;
        return self.api(repo + "/git/commits/" + baseSha, { required: true }).then(function (c) {
          return { baseSha: baseSha, baseTree: c.tree.sha };
        });
      })
      .then(function (base) {
        var blobs = files.map(function (file) {
          if (file.remove) {
            return Promise.resolve({ path: file.path, mode: "100644", type: "blob", sha: null });
          }
          return self
            .api(repo + "/git/blobs", {
              method: "POST",
              required: true,
              body: { content: file.base64, encoding: "base64" },
            })
            .then(function (blob) {
              return { path: file.path, mode: "100644", type: "blob", sha: blob.sha };
            });
        });

        return Promise.all(blobs).then(function (tree) {
          return self
            .api(repo + "/git/trees", {
              method: "POST",
              required: true,
              body: { base_tree: base.baseTree, tree: tree },
            })
            .then(function (newTree) {
              return self.api(repo + "/git/commits", {
                method: "POST",
                required: true,
                body: { message: message, tree: newTree.sha, parents: [base.baseSha] },
              });
            })
            .then(function (newCommit) {
              return self.api(repo + "/git/refs/" + ref, {
                method: "PATCH",
                required: true,
                body: { sha: newCommit.sha },
              });
            });
        });
      });
  };

  GitHubStore.prototype.load = function () {
    var self = this;

    var cms = this.api(
      this.repoPath(CFG.contentDir) + "?ref=" + encodeURIComponent(CFG.branch)
    ).then(function (entries) {
      var files = (entries || []).filter(function (entry) {
        return entry.type === "file" && /\.md$/i.test(entry.name);
      });
      return Promise.all(
        files.map(function (entry) {
          return self.readFile(entry.path).then(function (text) {
            return fromMarkdown(parseMarkdown(text), entry.path);
          });
        })
      );
    });

    var legacy = Promise.all([
      this.readFile(CFG.legacyFile),
      this.readFile(CFG.legacyImagesFile),
    ]).then(function (results) {
      if (!results[0]) return [];
      var rows = JSON.parse(results[0]);
      var manifest = results[1] ? JSON.parse(results[1]) : {};
      state.legacyManifest = manifest;
      return rows.map(function (row) {
        return fromLegacy(row, manifest[row.slug]);
      });
    });

    var pages = this.readFile(CFG.pagesFile).then(function (text) {
      var map = text ? JSON.parse(text) : {};
      state.pagesManifest = map;
      return Object.keys(map).map(function (id) {
        return fromPage(id, map[id]);
      });
    });

    var order = this.readFile(CFG.orderFile).then(function (text) {
      state.order = normalizeOrder(text ? JSON.parse(text) : null);
      state.orderOriginal = JSON.parse(JSON.stringify(state.order));
    });

    return Promise.all([legacy, cms, pages, order]).then(function (groups) {
      return groups[0].concat(groups[1], groups[2]);
    });
  };

  // Demo panel cita iste JSON fajlove koje sajt vec servira staticki, pa
  // prikazuje stvarno stanje projekata — samo nista ne upisuje nazad.
  function DemoStore() {
    this.items = null;
  }

  DemoStore.prototype.user = function () {
    return Promise.resolve({ login: "demo", avatar_url: "" });
  };

  DemoStore.prototype.load = function () {
    var self = this;
    if (this.items) return Promise.resolve(this.items.slice());

    function getJson(file, fallback) {
      return fetch("/" + file)
        .then(function (res) {
          return res.ok ? res.json() : fallback;
        })
        .catch(function () {
          return fallback;
        });
    }

    return Promise.all([
      getJson(CFG.legacyFile, []),
      getJson(CFG.legacyImagesFile, {}),
      getJson(CFG.pagesFile, {}),
      getJson(CFG.orderFile, { work: [], home: [] }),
    ]).then(function (results) {
      state.legacyManifest = results[1];
      state.pagesManifest = results[2];
      state.order = normalizeOrder(results[3]);
      state.orderOriginal = JSON.parse(JSON.stringify(state.order));
      self.items = results[0]
        .map(function (row) {
          return fromLegacy(row, results[1][row.slug]);
        })
        .concat(
          Object.keys(results[2]).map(function (id) {
            return fromPage(id, results[2][id]);
          })
        );
      return self.items.slice();
    });
  };

  DemoStore.prototype.readFile = function () {
    return Promise.resolve(null);
  };

  DemoStore.prototype.commit = function () {
    return new Promise(function (resolve) {
      setTimeout(resolve, 400);
    });
  };

  /* --------------------------------------------------------- item mapping */

  function emptySlots(count) {
    var out = [];
    for (var i = 0; i < count; i++) out.push({ src: "", alt: "", match: "" });
    return out;
  }

  function fromMarkdown(parsed, file) {
    var data = parsed.data || {};
    var services = Array.isArray(data.services) ? data.services : data.services ? [data.services] : [];
    var gallery = Array.isArray(data.gallery) ? data.gallery : [];

    // Galerija CMS projekta je obican niz — koliko slika ima, toliko slotova.
    // Nema gornje granice; jedan projekat moze da ima tri, drugi deset.
    var images = [];
    var video = { src: "", match: "" };
    gallery.forEach(function (row) {
      if (!row || !row.src) return;
      if (row.type === "video" || isVideoPath(row.src)) {
        if (!video.src) video = { src: row.src, match: row.src };
        return;
      }
      images.push({ src: row.src, alt: row.alt || "", match: row.src });
    });
    if (!images.length) images = emptySlots(1);

    return {
      key: "cms:" + file,
      kind: "cms",
      file: file,
      title: data.title || "",
      slug: data.slug || file.split("/").pop().replace(/\.md$/, ""),
      status: data.status === "Draft" ? "Draft" : "Live",
      year: data.year === 0 || data.year ? String(data.year) : "",
      overview: data.overview || "",
      projectOverview: data.project_overview || parsed.body.trim(),
      story: data.story || "",
      challenge: caseFields(data).challenge,
      results: caseFields(data).results,
      metrics: caseFields(data).metrics,
      testimonial: caseFields(data).testimonial,
      liveLink: data.live_link || "",
      services: services.map(String),
      thumb: { src: data.hero_image || "", alt: "", match: data.hero_image || "" },
      heroFocus: data.hero_focus || "center",
      images: images,
      video: video,
    };
  }

  // Case study polja (Challenge / Results / Testimonial) — ista za CMS i
  // originalnih 6. Brojeva uz Results ima uvek tri slota u editoru.
  var METRIC_SLOTS = 3;

  function readMetrics(list) {
    var metrics = (Array.isArray(list) ? list : []).slice(0, METRIC_SLOTS).map(function (metric) {
      return { value: String((metric && metric.value) || ""), label: String((metric && metric.label) || "") };
    });
    while (metrics.length < METRIC_SLOTS) metrics.push({ value: "", label: "" });
    return metrics;
  }

  function writeMetrics(metrics) {
    var list = (metrics || [])
      .map(function (metric) {
        return { value: String(metric.value || "").trim(), label: String(metric.label || "").trim() };
      })
      .filter(function (metric) {
        return metric.value;
      });
    return list.length ? list : undefined;
  }

  function readTestimonial(t) {
    t = t || {};
    return { quote: String(t.quote || ""), name: String(t.name || ""), role: String(t.role || "") };
  }

  function writeTestimonial(t) {
    t = t || {};
    var quote = String(t.quote || "").trim();
    if (!quote) return undefined;
    var out = { quote: quote };
    if (String(t.name || "").trim()) out.name = String(t.name).trim();
    if (String(t.role || "").trim()) out.role = String(t.role).trim();
    return out;
  }

  function caseFields(source) {
    return {
      challenge: source.challenge || "",
      results: source.results || "",
      metrics: readMetrics(source.metrics),
      testimonial: readTestimonial(source.testimonial),
    };
  }

  function caseData(item) {
    return {
      challenge: String(item.challenge || "").trim() || undefined,
      results: String(item.results || "").trim() || undefined,
      metrics: writeMetrics(item.metrics),
      testimonial: writeTestimonial(item.testimonial),
    };
  }

  function toMarkdown(item) {
    var gallery = item.images
      .filter(function (image) {
        return image.src;
      })
      .map(function (image) {
        return { type: "image", src: image.src, alt: image.alt || "" };
      });

    if (item.video && item.video.src) {
      gallery.push({ type: "video", src: item.video.src, alt: "" });
    }

    var data = {
      title: item.title,
      slug: item.slug,
      status: item.status,
      year: item.year === "" ? undefined : Number(item.year),
      services: item.services.filter(Boolean),
      overview: item.overview,
      challenge: undefined,
      story: String(item.story || "").trim(),
      results: undefined,
      metrics: undefined,
      testimonial: undefined,
      live_link: item.liveLink || "",
      hero_image: item.thumb.src || "",
      hero_focus: item.heroFocus || "center",
      gallery: gallery,
    };
    if (data.year === undefined || isNaN(data.year)) delete data.year;
    if (!data.story) delete data.story;
    var extra = caseData(item);
    Object.keys(extra).forEach(function (key) {
      if (extra[key] === undefined) delete data[key];
      else data[key] = extra[key];
    });
    return stringifyMarkdown(data, item.projectOverview);
  }

  function legacyField(manifest, key) {
    var texts = (manifest && manifest.texts) || [];
    for (var i = 0; i < texts.length; i++) {
      if (texts[i].key === key) return texts[i].value;
    }
    return "";
  }

  function fromLegacy(row, manifest) {
    var slots = manifest && manifest.images ? manifest.images.slice(0, LEGACY_IMAGE_SLOTS) : [];
    var images = slots.map(function (slot) {
      // `hidden` znaci: slika ostaje u Framer stranici (ne moze da se izbaci iz
      // izvora), ali joj assets/legacy-gallery.js sklanja slajd posle hidracije.
      return { src: slot.src, alt: slot.alt || "", match: slot.match, hidden: !!slot.hidden };
    });
    while (images.length < LEGACY_IMAGE_SLOTS) images.push({ src: "", alt: "", match: "", hidden: false });

    var thumb = (manifest && manifest.thumb) || { src: row.hero_image || "", match: "" };

    return {
      key: "legacy:" + row.slug,
      kind: "legacy",
      title: row.title || "",
      slug: row.slug || "",
      status: row.status === "Draft" ? "Draft" : "Live",
      year: row.year === 0 || row.year ? String(row.year) : "",
      overview: row.overview || "",
      // Duzi case-study tekst stoji u samoj Framer stranici (polje qHx5bRsBk u
      // handover payloadu), pa se menja prepisom izvora kao i ostali tekstovi.
      texts: ((manifest && manifest.texts) || []).map(function (text) {
        return {
          key: text.key,
          field: text.field,
          label: text.label,
          value: text.value,
          rows: text.rows || 6,
        };
      }),
      projectOverview: legacyField(manifest, "project_overview"),
      // Tekst "Approach" Framer stranica nema — stoji u legacy-work.json, a
      // scripts/build.mjs ga upisuje u stranicu (vidi assets/project-story.js).
      story: row.story || "",
      challenge: caseFields(row).challenge,
      results: caseFields(row).results,
      metrics: caseFields(row).metrics,
      testimonial: caseFields(row).testimonial,
      liveLink: legacyField(manifest, "live_link"),
      services: [],
      cardImage: row.hero_image || "",
      thumb: { src: thumb.src, alt: thumb.alt || "", match: thumb.match },
      images: images,
      // Slike preko Framer-ovih sest — ubacuje ih assets/legacy-gallery.js
      // posle hidracije, iz JSON bloka u samoj stranici.
      extraImages: ((manifest && manifest.extra) || []).map(function (image) {
        return { src: image.src, alt: image.alt || "" };
      }),
      video: (manifest && manifest.video) || { src: "", match: "" },
      sources:
        manifest && manifest.sources && manifest.sources.length
          ? manifest.sources.slice()
          : ["work/" + row.slug + "/index.html"],
    };
  }

  function toLegacyRow(item) {
    var year = Number(item.year);
    return {
      title: item.title,
      slug: item.slug,
      year: item.year !== "" && !isNaN(year) ? year : undefined,
      overview: item.overview,
      hero_image: item.cardImage || item.thumb.src || "",
      challenge: caseData(item).challenge,
      story: String(item.story || "").trim() || undefined,
      results: caseData(item).results,
      metrics: caseData(item).metrics,
      testimonial: caseData(item).testimonial,
      status: item.status === "Draft" ? "Draft" : undefined,
    };
  }

  // Home i About su takodje staticki Framer export — nemaju ni Markdown ni
  // karticu, pa im se menjaju samo imenovani slotovi iz content/pages.json.
  function fromPage(id, entry) {
    return {
      key: "page:" + id,
      kind: "page",
      id: id,
      title: entry.label || id,
      file: entry.file,
      url: entry.url || "/",
      slug: "",
      status: "Live",
      year: "",
      overview: "",
      projectOverview: "",
      images: (entry.images || []).map(function (image) {
        return { key: image.key, label: image.label, match: image.match, src: image.src };
      }),
      texts: (entry.texts || []).map(function (text) {
        return {
          key: text.key,
          label: text.label,
          value: text.value,
          rows: text.rows || 4,
        };
      }),
      sources: (entry.sources || [entry.file]).slice(),
    };
  }

  function emptyItem() {
    return {
      key: "cms:new-" + Date.now(),
      kind: "cms",
      file: null,
      isNew: true,
      title: "",
      slug: "",
      status: "Draft",
      year: String(new Date().getFullYear()),
      overview: "",
      projectOverview: "",
      story: "",
      challenge: "",
      results: "",
      metrics: readMetrics([]),
      testimonial: readTestimonial(null),
      liveLink: "",
      services: ["", "", ""],
      thumb: { src: "", alt: "", match: "" },
      images: emptySlots(NEW_PROJECT_SLOTS),
      video: { src: "", match: "" },
    };
  }

  /* --------------------------------------------------------------- state */

  var state = {
    store: null,
    user: null,
    items: [],
    legacyManifest: {},
    pagesManifest: {},
    // Redosled projekata na /work i na naslovnoj. Nije stavka kolekcije, pa ima
    // svoj draft i svoj Publish.
    order: { work: [], home: [] },
    orderOriginal: { work: [], home: [] },
    collection: "work",
    view: "list",
    selectedKey: null,
    draft: null,
    original: null,
    dirty: false,
    saving: false,
    query: "",
    statusFilter: "all",
    sortBy: "manual",
    sortDir: "asc",
    checked: {},
    // Upload-i cekaju u memoriji do Publish-a, da sve ode u jedan commit.
    // path -> { base64, previewUrl }
    staged: {},
  };

  var root = document.getElementById("cms-root");

  /* --------------------------------------------------------------- login */

  function renderLogin(errorMessage) {
    root.innerHTML = "";
    root.appendChild(
      el("div", { class: "login" }, [
        el("div", { class: "login__card" }, [
          el("div", { html: LOGO, class: "login__logo" }),
          el("h1", { text: "Tumenko CMS" }),
          el("p", {
            text:
              "Prijavi se GitHub nalogom koji ima pristup repozitorijumu " +
              CFG.repo +
              ". Svaka izmena je commit, Vercel posle toga sam redeployuje sajt.",
          }),
          el("button", { class: "btn btn--primary", onclick: startLogin }, ["Login with GitHub"]),
          errorMessage ? el("p", { class: "login__error", text: errorMessage }) : null,
        ]),
      ])
    );
  }

  function startLogin() {
    var width = 1000;
    var height = 700;
    var left = window.screenX + (window.outerWidth - width) / 2;
    var top = window.screenY + (window.outerHeight - height) / 2;
    var popup = window.open(
      "/api/auth",
      "tumenko-cms-auth",
      "width=" + width + ",height=" + height + ",left=" + left + ",top=" + top
    );
    if (!popup) {
      renderLogin("Browser je blokirao popup — dozvoli popup za ovaj sajt pa probaj ponovo.");
      return;
    }

    // api/callback.js koristi Decap handshake: javi se sa "authorizing:github",
    // saceka bilo kakav odgovor da sazna nas origin, pa posalje token.
    function onMessage(event) {
      if (typeof event.data !== "string") return;
      if (event.data === "authorizing:github") {
        popup.postMessage(event.data, event.origin);
        return;
      }
      var match = /^authorization:github:(success|error):([\s\S]+)$/.exec(event.data);
      if (!match) return;
      window.removeEventListener("message", onMessage);
      try {
        popup.close();
      } catch (err) {
        /* vec zatvoren */
      }
      var payload = JSON.parse(match[2]);
      if (match[1] === "error" || !payload.token) {
        renderLogin(payload.message || "Prijava nije uspela.");
        return;
      }
      localStorage.setItem(TOKEN_KEY, payload.token);
      boot(payload.token);
    }

    window.addEventListener("message", onMessage);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  }

  /* ---------------------------------------------------------------- boot */

  function boot(token) {
    state.store = DEMO ? new DemoStore() : new GitHubStore(token);
    root.innerHTML = "";
    root.appendChild(el("div", { class: "empty", text: "Ucitavanje…" }));

    state.store
      .user()
      .then(function (user) {
        state.user = user;
        return state.store.load();
      })
      .then(function (items) {
        state.items = items;
        render();
      })
      .catch(function (err) {
        console.error(err);
        if (DEMO) {
          toast(err.message, true);
          return;
        }
        renderLogin(err.message);
      });
  }

  /* -------------------------------------------------------------- derive */

  /* ------------------------------------------------------------ redosled */

  // content/order.json je nagovestaj redosleda, ne spisak sta postoji: build
  // sve nenabrojano redja na kraj. Zato se ovde ne validira sadrzaj, samo oblik.
  function normalizeOrder(data) {
    return {
      work: Array.isArray(data && data.work) ? data.work.slice() : [],
      home: Array.isArray(data && data.home) ? data.home.slice() : [],
    };
  }

  // Projekti u redosledu koji panel zna, plus svaki koji je u medjuvremenu dodat
  // a jos nije u order.json — inace bi novi projekat bio nevidljiv na ovom ekranu.
  function orderedProjects() {
    var projects = state.items.filter(function (item) {
      return item.kind !== 'page';
    });
    var bySlug = {};
    projects.forEach(function (item) {
      if (item.slug) bySlug[item.slug] = item;
    });

    var rows = [];
    state.order.work.forEach(function (slug) {
      if (bySlug[slug]) rows.push(bySlug[slug]);
    });
    projects.forEach(function (item) {
      if (rows.indexOf(item) < 0) rows.push(item);
    });
    return rows;
  }

  function orderDirty() {
    return JSON.stringify(state.order) !== JSON.stringify(state.orderOriginal);
  }

  function moveSlug(list, from, to) {
    if (to < 0 || to >= list.length || from === to) return false;
    list.splice(to, 0, list.splice(from, 1)[0]);
    return true;
  }

  function itemsInCollection(name) {
    return state.items.filter(function (item) {
      return name === "pages" ? item.kind === "page" : item.kind !== "page";
    });
  }

  function visibleItems() {
    var query = state.query.trim().toLowerCase();
    var rows = itemsInCollection(state.collection).filter(function (item) {
      // Stranice nemaju Live/Draft — filter po statusu vazi samo za projekte.
      if (item.kind !== "page" && state.statusFilter !== "all" && item.status !== state.statusFilter) {
        return false;
      }
      if (!query) return true;
      return (
        item.title.toLowerCase().indexOf(query) >= 0 ||
        item.slug.toLowerCase().indexOf(query) >= 0 ||
        item.overview.toLowerCase().indexOf(query) >= 0
      );
    });

    if (state.sortBy !== "manual") {
      rows.sort(function (a, b) {
        var x = state.sortBy === "year" ? Number(a.year || 0) : a.title.toLowerCase();
        var y = state.sortBy === "year" ? Number(b.year || 0) : b.title.toLowerCase();
        if (x < y) return state.sortDir === "asc" ? -1 : 1;
        if (x > y) return state.sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }
    return rows;
  }

  function findItem(key) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].key === key) return state.items[i];
    }
    return null;
  }

  // Sta panel prikazuje kao pregled slike.
  //
  // Fajl koji ceka Publish ima svoj data URL u memoriji. Vec upload-ovan fajl
  // se cita sa GitHub-a, a ne sa sajta: na sajtu ga nema dok Vercel ne zavrsi
  // build, pa bi posle objave pregled bio prazan nekoliko minuta. Slike iz
  // Framer export-a se ne menjaju i idu sa sajta, gde su kesirane.
  function displaySrc(src) {
    var staged = state.staged[src];
    if (staged) return staged.previewUrl;

    if (!DEMO && src && src.indexOf(CFG.publicFolder + "/") === 0) {
      return "https://raw.githubusercontent.com/" + CFG.repo + "/" + CFG.branch + src;
    }
    return src;
  }

  /* -------------------------------------------------------------- render */

  function render() {
    var scroller = root.querySelector(".table-wrap, .editor");
    var scrollTop = scroller ? scroller.scrollTop : 0;

    root.innerHTML = "";
    root.appendChild(
      el("div", { class: "app" }, [
        DEMO ? renderBanner() : null,
        renderTopbar(),
        el("div", { class: "body" }, [renderSidebar(), renderMain()]),
      ])
    );

    var next = root.querySelector(".table-wrap, .editor");
    if (next) next.scrollTop = scrollTop;
  }

  function renderBanner() {
    return el("div", {
      class: "banner",
      html:
        "<b>DEMO PANEL</b> — bez logina, samo za pregled. Izmene se <b>ne cuvaju</b> " +
        'i ne idu na sajt. Pravi panel je na <a href="/admin">/admin</a>.',
    });
  }

  function renderTopbar() {
    var right = [];

    if (state.view === "detail" || state.collection === "order") {
      // Redosled nije stavka kolekcije, pa ima svoj draft i svoj Publish.
      var isOrder = state.view !== "detail";
      var dirty = isOrder ? orderDirty() : state.dirty;

      right.push(
        el("span", {
          class: "savestate" + (dirty ? " is-dirty" : ""),
          text: state.saving ? "Objavljujem…" : dirty ? "Nesacuvano" : "Saved",
        })
      );
      right.push(
        el(
          "button",
          {
            class: "btn btn--primary",
            disabled: !dirty || state.saving,
            onclick: isOrder ? publishOrder : publishDraft,
          },
          ["Publish"]
        )
      );
    } else {
      right.push(
        el("a", { class: "btn", href: CFG.siteUrl + "/work", target: "_blank", rel: "noopener" }, [
          el("span", { html: ICONS.play }),
          el("span", { text: "View site" }),
        ])
      );
    }

    if (state.user && state.user.avatar_url) {
      right.unshift(el("img", { class: "avatar", src: state.user.avatar_url, alt: state.user.login }));
    }
    if (!DEMO) {
      right.unshift(
        el("button", { class: "icon-btn", title: "Odjavi se", onclick: logout }, [
          el("span", { html: ICONS.logout }),
        ])
      );
    }

    return el("header", { class: "topbar" }, [
      el("div", { class: "topbar__left" }, [
        el("span", { html: LOGO }),
        el("span", { class: "chip" }, [
          el("span", { text: "CMS" }),
          el("span", { html: ICONS.chevronDown }),
        ]),
      ]),
      el("div", { class: "topbar__center" }, [
        el("span", { text: CFG.repo }),
        el("span", { class: "topbar__branch" }, [
          el("span", { html: ICONS.branch }),
          el("span", { text: CFG.branch }),
        ]),
      ]),
      el("div", { class: "topbar__right" }, right),
    ]);
  }

  function renderSidebar() {
    var tabs = el("nav", { class: "tabs" }, [el("button", { class: "tab is-active" }, ["Collections"])]);

    if (state.view === "detail") {
      var rail = el(
        "div",
        { class: "sidebar__list" },
        visibleItems().map(function (item) {
          return el(
            "button",
            {
              class: "rail__item" + (item.key === state.selectedKey ? " is-active" : ""),
              onclick: function () {
                openItem(item.key);
              },
            },
            [
              el("span", { text: item.title || "Bez naslova" }),
              item.kind === "legacy" ? el("span", { class: "rail__badge", text: "Original" }) : null,
            ]
          );
        })
      );
      return el("aside", { class: "sidebar" }, [tabs, rail]);
    }

    var isOrder = state.collection === "order";

    return el("aside", { class: "sidebar" }, [
      tabs,
      isOrder ? null : el("div", { class: "sidebar__search" }, [
        el("span", { html: ICONS.search }),
        el("input", {
          type: "search",
          placeholder: "Search...",
          value: state.query,
          oninput: function (event) {
            state.query = event.target.value;
            refreshTable();
          },
        }),
      ]),
      el("div", { class: "sidebar__list" }, [
        collectionButton("work", "Work Items", ICONS.database),
        collectionButton("pages", "Pages", ICONS.file),
        collectionButton("order", "Redosled", ICONS.sort),
        isOrder ? null : el("button", { class: "collection collection--add", onclick: createItem }, [
          el("span", { html: ICONS.plus }),
          el("span", { text: "Add..." }),
        ]),
      ]),
    ]);
  }

  function collectionButton(name, label, icon) {
    return el(
      "button",
      {
        class: "collection" + (state.collection === name ? " is-active" : ""),
        onclick: function () {
          if (state.collection === name) return;
          state.collection = name;
          state.checked = {};
          render();
        },
      },
      [
        el("span", { html: icon }),
        el("span", { text: label }),
        el("span", {
          class: "collection__count",
          text: String(itemsInCollection(name).length),
        }),
      ]
    );
  }

  // Jedan red na ekranu Redosled. Prevlacenje radi preko HTML5 drag-and-drop-a,
  // a strelice stoje uz njega jer je prevlacenje na trackpad-u lako promasiti.
  function orderRow(list, index, label, badge, onChange) {
    function commit(from, to) {
      if (!moveSlug(list, from, to)) return;
      onChange();
    }

    return el(
      'li',
      {
        class: 'ord__row',
        draggable: true,
        ondragstart: function (event) {
          event.dataTransfer.effectAllowed = 'move';
          // Firefox ne pokrece prevlacenje bez podatka u dogadjaju.
          event.dataTransfer.setData('text/plain', String(index));
          event.target.classList.add('is-dragging');
        },
        ondragend: function (event) {
          event.target.classList.remove('is-dragging');
        },
        ondragover: function (event) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          event.currentTarget.classList.add('is-over');
        },
        ondragleave: function (event) {
          event.currentTarget.classList.remove('is-over');
        },
        ondrop: function (event) {
          event.preventDefault();
          event.currentTarget.classList.remove('is-over');
          var from = Number(event.dataTransfer.getData('text/plain'));
          if (!isNaN(from)) commit(from, index);
        },
      },
      [
        el('span', { class: 'ord__grip', html: ICONS.grip }),
        el('span', { class: 'ord__num', text: String(index + 1) }),
        el('span', { class: 'ord__title', text: label }),
        badge ? el('span', { class: 'rail__badge', text: badge }) : null,
        el('span', { class: 'ord__moves' }, [
          el(
            'button',
            {
              class: 'icon-btn',
              title: 'Pomeri gore',
              disabled: index === 0,
              onclick: function () {
                commit(index, index - 1);
              },
            },
            [el('span', { html: ICONS.arrowUp })]
          ),
          el(
            'button',
            {
              class: 'icon-btn',
              title: 'Pomeri dole',
              disabled: index === list.length - 1,
              onclick: function () {
                commit(index, index + 1);
              },
            },
            [el('span', { html: ICONS.arrowDown })]
          ),
        ]),
      ]
    );
  }

  function renderOrder() {
    var projects = orderedProjects();
    // state.order.work se drzi u koraku sa onim sto se vidi: novi projekat koji
    // jos nije u fajlu ovde dobija svoje mesto, pa Publish upisuje potpun spisak.
    state.order.work = projects.map(function (item) {
      return item.slug;
    });

    var titleBySlug = {};
    projects.forEach(function (item) {
      titleBySlug[item.slug] = item.title || item.slug;
    });

    var workList = el(
      'ol',
      { class: 'ord__list' },
      projects.map(function (item, index) {
        return orderRow(
          state.order.work,
          index,
          item.title || item.slug,
          item.kind === 'legacy' ? 'Original' : null,
          function () {
            render();
          }
        );
      })
    );

    var homeList = state.order.home.length
      ? el(
          'ol',
          { class: 'ord__list' },
          state.order.home.map(function (slug, index) {
            return orderRow(state.order.home, index, titleBySlug[slug] || slug, null, function () {
              render();
            });
          })
        )
      : el('p', {
          class: 'field__hint',
          text:
            'Kartice sa naslovne nisu jos procitane. Pokreni `npm run media-map` ' +
            'pa osvezi panel.',
        });

    return el('div', { class: 'ord' }, [
      el('section', { class: 'ord__panel' }, [
        el('h2', { class: 'ord__heading', text: 'Work stranica' }),
        el('p', {
          class: 'ord__hint',
          text:
            'Redosled kartica na /work. Prevuci red ili koristi strelice. ' +
            'Projekti na Draft-u se ne prikazuju na sajtu, ali ostaju ovde da im ' +
            'mesto ne propadne dok se ne vrate na Live.',
        }),
        workList,
      ]),
      el('section', { class: 'ord__panel' }, [
        el('h2', { class: 'ord__heading', text: 'Naslovna strana' }),
        el('p', {
          class: 'ord__hint',
          text:
            'Redosled cetiri kartice na dnu naslovne. Koje su to kartice dolazi iz ' +
            'originalnog izvoza i ne menja se odavde — menja se samo njihov raspored.',
        }),
        homeList,
      ]),
    ]);
  }
  function renderMain() {
    if (state.view === "detail") return el("main", { class: "main" }, [renderEditor()]);
    if (state.collection === "order") return el("main", { class: "main" }, [renderOrder()]);
    return el("main", { class: "main" }, [renderToolbar(), renderTable()]);
  }

  function renderToolbar() {
    // Stranice su fiksne — ne dodaju se, ne brisu i nemaju status.
    var isPages = state.collection === "pages";

    return el("div", { class: "toolbar" }, [
      isPages
        ? null
        : el("button", { class: "icon-btn", title: "Novi projekat", onclick: createItem }, [
            el("span", { html: ICONS.plus }),
          ]),
      isPages
        ? null
        : el(
            "button",
            {
              class: "icon-btn" + (state.sortBy !== "manual" ? " is-active" : ""),
              title: "Sortiraj",
              onclick: function (event) {
                openSortMenu(event.currentTarget);
              },
            },
            [el("span", { html: ICONS.sort })]
          ),
      isPages
        ? null
        : el(
            "button",
            {
              class: "icon-btn" + (state.statusFilter !== "all" ? " is-active" : ""),
              title: "Filtriraj",
              onclick: function (event) {
                openFilterMenu(event.currentTarget);
              },
            },
            [el("span", { html: ICONS.filter })]
          ),
      el("div", { class: "toolbar__search" }, [
        el("input", {
          type: "search",
          placeholder: "Search items...",
          value: state.query,
          oninput: function (event) {
            state.query = event.target.value;
            refreshTable();
          },
        }),
      ]),
      el("div", { class: "toolbar__spacer" }),
      el(
        "button",
        {
          class: "icon-btn",
          title: "Vise",
          onclick: function (event) {
            openMoreMenu(event.currentTarget);
          },
        },
        [el("span", { html: ICONS.dots })]
      ),
    ]);
  }

  function refreshTable() {
    var main = root.querySelector(".main");
    var old = main && main.querySelector(".table-wrap");
    if (!old) return render();
    main.replaceChild(renderTable(), old);
    var counter = root.querySelector(".collection__count");
    if (counter) counter.textContent = String(state.items.length);
  }

  function toggleAll() {
    var rows = visibleItems();
    var allOn =
      rows.length > 0 &&
      rows.every(function (item) {
        return state.checked[item.key];
      });
    rows.forEach(function (item) {
      if (allOn) delete state.checked[item.key];
      else state.checked[item.key] = true;
    });
    refreshTable();
  }

  function renderPagesTable() {
    var rows = visibleItems();

    var head = el("thead", {}, [
      el("tr", {}, [
        el("th", { class: "col-title", text: "Page" }),
        el("th", { class: "col-slug", text: "URL" }),
        el("th", { class: "col-text", text: "Slike" }),
        el("th", { class: "col-text", text: "Tekst" }),
        el("th", { class: "col-actions" }),
      ]),
    ]);

    var body = el(
      "tbody",
      {},
      rows.map(function (item) {
        return el("tr", {}, [
          el("td", {
            class: "col-title cell-title",
            text: item.title,
            onclick: function () {
              openItem(item.key);
            },
          }),
          el("td", { class: "col-slug", text: item.url }),
          el("td", { class: "col-text", text: item.images.length + " slika" }),
          el("td", {
            class: "col-text",
            text: item.texts.length ? item.texts[0].value : "—",
          }),
          el("td", { class: "col-actions" }, [
            el(
              "button",
              {
                class: "icon-btn",
                title: "Otvori stranicu na sajtu",
                onclick: function () {
                  window.open(CFG.siteUrl + item.url, "_blank", "noopener");
                },
              },
              [el("span", { html: ICONS.play })]
            ),
          ]),
        ]);
      })
    );

    return el("div", { class: "table-wrap" }, [el("table", { class: "table" }, [head, body])]);
  }

  function renderTable() {
    if (state.collection === "pages") return renderPagesTable();

    var rows = visibleItems();
    var allChecked =
      rows.length > 0 &&
      rows.every(function (item) {
        return state.checked[item.key];
      });

    var head = el("thead", {}, [
      el("tr", {}, [
        el("th", { class: "col-handle" }, [
          el("span", { class: "check" + (allChecked ? " is-on" : ""), onclick: toggleAll }),
        ]),
        el("th", { class: "col-title", text: "Title" }),
        el("th", { class: "col-status", text: "Status" }),
        el("th", { class: "col-slug", text: "Slug" }),
        el("th", { class: "col-text", text: "Overview" }),
        el("th", { class: "col-text", text: "Project Overview" }),
        el("th", { class: "col-year", text: "Year" }),
        el("th", { class: "col-actions" }),
      ]),
    ]);

    var body = el(
      "tbody",
      {},
      rows.map(function (item) {
        return el("tr", {}, [
          el("td", { class: "col-handle" }, [
            el("div", { class: "handle-cell" }, [
              el("span", { class: "grip", html: ICONS.grip }),
              el("span", {
                class: "check" + (state.checked[item.key] ? " is-on" : ""),
                onclick: function () {
                  if (state.checked[item.key]) delete state.checked[item.key];
                  else state.checked[item.key] = true;
                  refreshTable();
                },
              }),
            ]),
          ]),
          el("td", {
            class: "col-title cell-title",
            text: item.title || "Bez naslova",
            onclick: function () {
              openItem(item.key);
            },
          }),
          el("td", { class: "col-status" }, [statusPill(item)]),
          el("td", { class: "col-slug", text: item.slug }),
          el("td", { class: "col-text", text: item.overview }),
          el("td", { class: "col-text", text: item.projectOverview }),
          el("td", { class: "col-year", text: item.year }),
          el("td", { class: "col-actions" }, [
            el(
              "button",
              {
                class: "icon-btn",
                onclick: function (event) {
                  openRowMenu(event.currentTarget, item);
                },
              },
              [el("span", { html: ICONS.dots })]
            ),
          ]),
        ]);
      })
    );

    return el("div", { class: "table-wrap" }, [
      el("table", { class: "table" }, [head, body]),
      rows.length
        ? null
        : el("div", {
            class: "empty",
            text: state.items.length
              ? "Nijedan projekat ne odgovara pretrazi."
              : "Jos nema projekata — klikni + da dodas prvi.",
          }),
    ]);
  }

  function statusPill(item) {
    var isLive = item.status === "Live";
    return el(
      "button",
      {
        class: "pill " + (isLive ? "pill--live" : "pill--draft"),
        onclick: function (event) {
          openStatusMenu(event.currentTarget, item);
        },
      },
      [el("span", { text: item.status }), el("span", { html: ICONS.chevronDown })]
    );
  }

  /* --------------------------------------------------------------- menus */

  function openMenu(anchor, children) {
    closeMenu();
    var rect = anchor.getBoundingClientRect();
    var menu = el("div", { class: "menu" }, children);
    menu.style.visibility = "hidden";
    document.body.appendChild(menu);
    var top = rect.bottom + 6;
    if (top + menu.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menu.offsetHeight - 6);
    }
    menu.style.top = top + "px";
    menu.style.left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8) + "px";
    menu.style.visibility = "visible";

    function onOutside(event) {
      if (!menu.contains(event.target)) closeMenu();
    }
    menu._onOutside = onOutside;
    setTimeout(function () {
      document.addEventListener("mousedown", onOutside);
    }, 0);
  }

  function closeMenu() {
    var menu = document.querySelector(".menu");
    if (!menu) return;
    if (menu._onOutside) document.removeEventListener("mousedown", menu._onOutside);
    menu.remove();
  }

  function menuItem(label, onClick, extraClass) {
    return el(
      "button",
      {
        class: extraClass || "",
        onclick: function () {
          closeMenu();
          onClick();
        },
      },
      [label]
    );
  }

  function openStatusMenu(anchor, item) {
    openMenu(anchor, [
      el("div", { class: "menu__label", text: "Status" }),
      menuItem("Live", function () {
        setStatus(item, "Live");
      }),
      menuItem("Draft (pauza)", function () {
        setStatus(item, "Draft");
      }),
    ]);
  }

  function openSortMenu(anchor) {
    openMenu(anchor, [
      el("div", { class: "menu__label", text: "Sortiraj po" }),
      menuItem("Rucni redosled", function () {
        state.sortBy = "manual";
        render();
      }),
      menuItem("Naslov A→Z", function () {
        state.sortBy = "title";
        state.sortDir = "asc";
        render();
      }),
      menuItem("Naslov Z→A", function () {
        state.sortBy = "title";
        state.sortDir = "desc";
        render();
      }),
      menuItem("Godina, novije prvo", function () {
        state.sortBy = "year";
        state.sortDir = "desc";
        render();
      }),
      menuItem("Godina, starije prvo", function () {
        state.sortBy = "year";
        state.sortDir = "asc";
        render();
      }),
    ]);
  }

  function openFilterMenu(anchor) {
    openMenu(anchor, [
      el("div", { class: "menu__label", text: "Status" }),
      menuItem("Sve", function () {
        state.statusFilter = "all";
        render();
      }),
      menuItem("Samo Live", function () {
        state.statusFilter = "Live";
        render();
      }),
      menuItem("Samo Draft", function () {
        state.statusFilter = "Draft";
        render();
      }),
    ]);
  }

  function openMoreMenu(anchor) {
    openMenu(anchor, [
      menuItem("Osvezi iz repozitorijuma", reload),
      menuItem("Otvori /work na sajtu", function () {
        window.open(CFG.siteUrl + "/work", "_blank", "noopener");
      }),
    ]);
  }

  function openRowMenu(anchor, item) {
    openMenu(anchor, [
      menuItem("Otvori", function () {
        openItem(item.key);
      }),
      menuItem("Otvori stranicu na sajtu", function () {
        window.open(CFG.siteUrl + "/work/" + item.slug, "_blank", "noopener");
      }),
      el("div", { class: "menu__sep" }),
      menuItem(
        "Obrisi projekat",
        function () {
          deleteItem(item);
        },
        "btn--danger"
      ),
    ]);
  }

  /* -------------------------------------------------------------- editor */

  function dropUnsavedNew(exceptKey) {
    state.items = state.items.filter(function (item) {
      return !(item.isNew && item.key !== exceptKey);
    });
  }

  function openItem(key) {
    if (state.dirty && !confirm("Imas nesacuvane izmene. Napustiti ih?")) return;
    dropUnsavedNew(key);
    var item = findItem(key);
    if (!item) return;
    state.selectedKey = key;
    state.draft = JSON.parse(JSON.stringify(item));
    state.original = JSON.parse(JSON.stringify(item));
    while (state.draft.kind === "cms" && state.draft.services.length < 3) {
      state.draft.services.push("");
    }
    state.dirty = false;
    state.view = "detail";
    render();
  }

  function closeEditor() {
    if (state.dirty && !confirm("Imas nesacuvane izmene. Napustiti ih?")) return;
    dropUnsavedNew(null);
    state.view = "list";
    state.draft = null;
    state.original = null;
    state.selectedKey = null;
    state.dirty = false;
    render();
  }

  function createItem() {
    if (state.dirty && !confirm("Imas nesacuvane izmene. Napustiti ih?")) return;
    dropUnsavedNew(null);
    state.collection = "work";
    var item = emptyItem();
    state.items.push(item);
    state.selectedKey = item.key;
    state.draft = JSON.parse(JSON.stringify(item));
    state.original = JSON.parse(JSON.stringify(item));
    state.dirty = true;
    state.view = "detail";
    render();
  }

  // Samo topbar reaguje na dirty stanje; pun re-render bi izbacio fokus iz
  // polja u koje se kuca.
  function markDirty() {
    if (state.dirty) return;
    state.dirty = true;
    var bar = root.querySelector(".topbar");
    if (bar) bar.parentNode.replaceChild(renderTopbar(), bar);
  }

  function renderPageEditor(draft) {
    var fields = [];

    fields.push(
      fieldRow(
        "Page",
        el("input", { class: "input", value: draft.title, disabled: true }),
        null,
        el("p", { class: "field__hint" }, [
          el("span", { html: ICONS.globe }),
          el("span", { text: CFG.siteUrl.replace(/^https?:\/\//, "") + draft.url }),
        ])
      )
    );

    if (draft.texts.length) {
      fields.push(sectionRow("Tekst"));
      draft.texts.forEach(function (text) {
        fields.push(
          fieldRow(
            text.label,
            el("textarea", {
              class: "textarea",
              rows: text.rows,
              value: text.value,
              oninput: function (event) {
                text.value = event.target.value;
                markDirty();
              },
            })
          )
        );
      });
    }

    fields.push(sectionRow("Images"));
    draft.images.forEach(function (image) {
      fields.push(fieldRow(image.label, mediaSlot(image, "image")));
    });

    fields.push(
      fieldRow(
        "",
        el("p", {
          class: "field__hint",
          text:
            "Ovo je jedna od originalnih stranica. Odavde se menjaju slike i tekst; " +
            "raspored i animacije su fiksni u samoj stranici.",
        })
      )
    );

    return el("div", { class: "editor" }, [
      el("div", { class: "editor__inner" }, [
        el("button", { class: "editor__close", onclick: closeEditor, html: ICONS.close }),
        el("div", {}, fields),
      ]),
    ]);
  }

  function renderEditor() {
    var draft = state.draft;
    if (draft.kind === "page") return renderPageEditor(draft);

    var isLegacy = draft.kind === "legacy";
    var fields = [];

    fields.push(
      fieldRow(
        "Title",
        el("input", {
          class: "input",
          value: draft.title,
          oninput: function (event) {
            draft.title = event.target.value;
            if (draft.isNew && !draft.slugTouched) {
              draft.slug = slugify(draft.title);
              var slugInput = root.querySelector("[data-slug-input]");
              if (slugInput) slugInput.value = draft.slug;
              updateSlugHint();
            }
            markDirty();
          },
        })
      )
    );

    fields.push(
      fieldRow(
        "Status",
        el(
          "span",
          { class: "status-select pill " + (draft.status === "Live" ? "pill--live" : "pill--draft") },
          [
            el(
              "select",
              {
                onchange: function (event) {
                  draft.status = event.target.value;
                  markDirty();
                  rerenderEditor();
                },
              },
              [
                el("option", { value: "Live", selected: draft.status === "Live" }, ["Live"]),
                el("option", { value: "Draft", selected: draft.status === "Draft" }, ["Draft"]),
              ]
            ),
          ]
        ),
        isLegacy && draft.status === "Draft"
          ? "Draft sklanja karticu sa /work i iz sitemap-a. Sama stranica ostaje dostupna na direktan link jer je staticka stranica."
          : null
      )
    );

    fields.push(
      fieldRow(
        "Slug",
        el("input", {
          class: "input",
          value: draft.slug,
          disabled: isLegacy,
          "data-slug-input": "1",
          oninput: function (event) {
            draft.slugTouched = true;
            draft.slug = slugify(event.target.value);
            markDirty();
            updateSlugHint();
          },
          onblur: function (event) {
            event.target.value = draft.slug;
          },
        }),
        isLegacy ? "Slug je zakucan uz postojecu stranicu." : null,
        el("p", { class: "field__hint", "data-slug-hint": "1" }, [
          el("span", { html: ICONS.globe }),
          el("span", { text: prettyUrl(draft.slug) }),
        ])
      )
    );

    fields.push(sectionRow("Details"));

    fields.push(
      fieldRow(
        "Overview",
        el("textarea", {
          class: "textarea",
          rows: 3,
          value: draft.overview,
          oninput: function (event) {
            draft.overview = event.target.value;
            markDirty();
          },
        }),
        isLegacy
          ? "Kratak opis na kartici u /work listi."
          : "Kratak opis na kartici u /work listi i u meta description-u."
      )
    );

    // Kod CMS projekata tekst zivi u Markdownu; kod originalnih 6 u samoj
    // Framer stranici, pa se drzi u draft.texts i pise prepisom izvora.
    if (isLegacy) {
      draft.texts.forEach(function (text) {
        var single = (text.rows || 6) <= 1;
        var control = el(single ? "input" : "textarea", {
          class: single ? "input" : "textarea",
          rows: single ? null : text.rows,
          value: text.value,
          oninput: function (event) {
            text.value = event.target.value;
            if (text.key === "project_overview") draft.projectOverview = event.target.value;
            markDirty();
          },
        });

        var hint = null;
        if (text.key === "project_overview") hint = "Duzi case-study tekst na stranici projekta.";
        else if (text.key === "live_link") hint = "Dugme 'Live Work' na stranici projekta.";

        fields.push(fieldRow(text.label, control, hint));
      });
    } else {
      fields.push(
        fieldRow(
          "Project Overview",
          el("textarea", {
            class: "textarea",
            rows: 6,
            value: draft.projectOverview,
            oninput: function (event) {
              draft.projectOverview = event.target.value;
              markDirty();
            },
          }),
          "Duzi case-study tekst na dnu stranice projekta."
        )
      );
    }

    fields.push(
      fieldRow(
        "Year",
        el("input", {
          class: "input",
          type: "number",
          value: draft.year,
          oninput: function (event) {
            draft.year = event.target.value;
            markDirty();
          },
        })
      )
    );

    if (!isLegacy) {
      [0, 1, 2].forEach(function (index) {
        fields.push(
          fieldRow(
            "Service " + (index + 1),
            el("input", {
              class: "input",
              value: draft.services[index] || "",
              oninput: function (event) {
                draft.services[index] = event.target.value;
                markDirty();
              },
            })
          )
        );
      });

      fields.push(
        fieldRow(
          "Live Link",
          el("div", { class: "input-clear" }, [
            el("input", {
              class: "input",
              value: draft.liveLink,
              placeholder: "https://",
              oninput: function (event) {
                draft.liveLink = event.target.value;
                markDirty();
              },
            }),
            el(
              "button",
              {
                class: "clear",
                title: "Obrisi",
                onclick: function () {
                  draft.liveLink = "";
                  markDirty();
                  rerenderEditor();
                },
              },
              ["×"]
            ),
          ])
        )
      );
    }

    // Case study — ista polja za obe vrste projekata. Kod CMS projekata idu u
    // frontmatter, kod originalnih 6 u legacy-work.json (Framer stranica ih
    // nema; ubacuje ih assets/project-story.js). Prazno polje = nema sekcije.
    if (!draft.metrics) draft.metrics = readMetrics([]);
    if (!draft.testimonial) draft.testimonial = readTestimonial(null);

    function caseText(key, rows, placeholder) {
      return el("textarea", {
        class: "textarea",
        rows: rows,
        value: draft[key] || "",
        placeholder: placeholder,
        oninput: function (event) {
          draft[key] = event.target.value;
          markDirty();
        },
      });
    }

    fields.push(sectionRow("Case study"));

    fields.push(
      fieldRow(
        "Challenge",
        caseText("challenge", 5, "Sa kakvim problemom je brend dosao, sta nije radilo…"),
        "1–2 paragrafa, odvojena praznim redom. Prva sekcija ispod disciplina."
      )
    );

    // Polje se u podacima i dalje zove `story`.
    fields.push(
      fieldRow(
        "Approach",
        caseText("story", 8, "Sta je radjeno na projektu i kako su problemi reseni…"),
        "2–3 paragrafa, odvojena praznim redom."
      )
    );

    draft.metrics.forEach(function (metric, index) {
      fields.push(
        fieldRow(
          "Result " + (index + 1),
          el("div", { class: "metric-row" }, [
            el("input", {
              class: "input",
              value: metric.value,
              placeholder: index === 0 ? "+40%" : index === 1 ? "3×" : "12 wk",
              oninput: function (event) {
                metric.value = event.target.value;
                markDirty();
              },
            }),
            el("input", {
              class: "input",
              value: metric.label,
              placeholder: index === 0 ? "Direct bookings" : index === 1 ? "Social reach" : "Brief to launch",
              oninput: function (event) {
                metric.label = event.target.value;
                markDirty();
              },
            }),
          ]),
          index === 0 ? "Broj i kratak opis. Prikazuje se samo red koji ima broj." : null
        )
      );
    });

    fields.push(
      fieldRow(
        "Results",
        caseText("results", 5, "Sta se promenilo posle saradnje…"),
        "Tekst ispod brojeva. Paragrafi odvojeni praznim redom."
      )
    );

    fields.push(
      fieldRow(
        "Testimonial",
        el("textarea", {
          class: "textarea",
          rows: 4,
          value: draft.testimonial.quote,
          placeholder: "Izjava klijenta, bez navodnika — dodaju se sami.",
          oninput: function (event) {
            draft.testimonial.quote = event.target.value;
            markDirty();
          },
        })
      )
    );

    [
      ["name", "Testimonial Name", "Ime i prezime"],
      ["role", "Testimonial Role", "Funkcija, firma"],
    ].forEach(function (field) {
      fields.push(
        fieldRow(
          field[1],
          el("input", {
            class: "input",
            value: draft.testimonial[field[0]],
            placeholder: field[2],
            oninput: function (event) {
              draft.testimonial[field[0]] = event.target.value;
              markDirty();
            },
          })
        )
      );
    });

    fields.push(sectionRow("Images"));

    fields.push(
      fieldRow(
        "Thumb",
        // Bez ×: naslovna slika je i kartica na /work i banner na vrhu stranice,
        // pa ne moze da ostane prazna — moze samo da se zameni. Ranije je × stajao
        // i publish bi pukao tek na kraju.
        mediaSlot(draft.thumb, "image", false),
        isLegacy
          ? "Naslovna slika — kartica na /work i velika slika na vrhu stranice projekta."
          : "Naslovna slika — kartica na /work i vrh stranice projekta."
      )
    );

    // Kartica je mnogo sira nego visa, pa se od naslovne slike vidi samo pojas
    // preko sredine. Ako je ono sto se gleda pri vrhu ili pri dnu fotografije
    // (npr. par u donjoj cetvrtini, a iznad njih samo nebo), taj pojas ga
    // promasi. Ovim se bira koji deo slike ostaje u kadru.
    if (!isLegacy) {
      fields.push(
        fieldRow(
          "Kadar",
          el(
            "span",
            { class: "status-select pill" },
            [
              el(
                "select",
                {
                  onchange: function (event) {
                    draft.heroFocus = event.target.value;
                    markDirty();
                  },
                },
                [
                  el("option", { value: "top", selected: draft.heroFocus === "top" }, ["Vrh slike"]),
                  el("option", { value: "center", selected: draft.heroFocus !== "top" && draft.heroFocus !== "bottom" }, ["Sredina slike"]),
                  el("option", { value: "bottom", selected: draft.heroFocus === "bottom" }, ["Dno slike"]),
                ]
              ),
            ]
          ),
          "Koji deo naslovne slike da ostane u kadru na karticama i na vrhu stranice projekta."
        )
      );
    }

    draft.images.forEach(function (image, index) {
      fields.push(
        fieldRow(
          "Image " + (index + 1),
          mediaSlot(
            image,
            "image",
            // Kod CMS projekata × sklanja ceo slot, jer je galerija niz. Framer-ovih
            // slotova ima tacno sest i ne mogu da nestanu iz izvora, pa × slajd
            // sakriva: slika ostaje u stranici, a sa ekrana je skida
            // assets/legacy-gallery.js posle hidracije.
            isLegacy
              ? function () {
                  if (!image.src) return;
                  image.hidden = true;
                  markDirty();
                  rerenderEditor();
                }
              : function () {
                  draft.images.splice(index, 1);
                  if (!draft.images.length) draft.images.push({ src: "", alt: "", match: "" });
                  markDirty();
                  rerenderEditor();
                },
            isLegacy
              ? function () {
                  image.hidden = false;
                  markDirty();
                  rerenderEditor();
                }
              : null
          )
        )
      );
    });

    // Slike preko Framer-ovih sest. Nastavljaju numeraciju (Image 7, 8, …) i
    // ponasaju se isto, samo ih na stranicu dodaje assets/legacy-gallery.js.
    if (isLegacy) {
      draft.extraImages.forEach(function (image, index) {
        fields.push(
          fieldRow(
            "Image " + (LEGACY_IMAGE_SLOTS + index + 1),
            mediaSlot(image, "image", function () {
              draft.extraImages.splice(index, 1);
              markDirty();
              rerenderEditor();
            })
          )
        );
      });
    }

    fields.push(
      fieldRow(
        "",
        el(
          "button",
          {
            class: "btn",
            onclick: function () {
              (isLegacy ? draft.extraImages : draft.images).push({ src: "", alt: "", match: "" });
              markDirty();
              rerenderEditor();
            },
          },
          [el("span", { html: ICONS.plus }), el("span", { text: "Dodaj sliku" })]
        ),
        isLegacy
          ? "Galerija moze da ima koliko god slika treba. Prvih sest su fiksna polja stranice; sve preko toga dodaje sajt sam pri ucitavanju stranice."
          : "Galerija moze da ima koliko god slika treba — tri, deset, svejedno."
      )
    );

    fields.push(fieldRow("video", mediaSlot(draft.video, "video")));

    if (isLegacy) {
      fields.push(
        fieldRow(
          "",
          el("p", {
            class: "field__hint",
            text:
              "Ovo je jedna od originalnih stranica. Slike i tekst kartice se menjaju " +
              "odavde; raspored i animacije su fiksni u samoj stranici. " +
              "Prvih sest slika su fiksna polja stranice i ona ostaju u izvoru: × ih sklanja " +
              "sa stranice, a dugme Vrati ih vraca. Sedmu i dalje ubacuje sajt sam, " +
              "pri ucitavanju stranice. Novi projekti nemaju to ogranicenje.",
          })
        )
      );
    }

    var actions = [];
    if (!draft.isNew) {
      actions.push(
        el(
          "button",
          {
            class: "btn btn--danger",
            onclick: function () {
              deleteItem(findItem(state.selectedKey) || draft);
            },
          },
          [el("span", { html: ICONS.trash }), el("span", { text: "Obrisi projekat" })]
        )
      );
    }

    return el("div", { class: "editor" }, [
      el("div", { class: "editor__inner" }, [
        el("button", { class: "editor__close", onclick: closeEditor, html: ICONS.close }),
        el("div", {}, fields),
        actions.length ? el("div", { style: "margin-top:28px" }, actions) : null,
      ]),
    ]);
  }

  function rerenderEditor() {
    var main = root.querySelector(".main");
    var old = main && main.querySelector(".editor");
    if (!old) return render();
    var scrollTop = old.scrollTop;
    var next = renderEditor();
    main.replaceChild(next, old);
    next.scrollTop = scrollTop;
  }

  function prettyUrl(slug) {
    return CFG.siteUrl.replace(/^https?:\/\//, "") + "/work/" + (slug || "…");
  }

  function updateSlugHint() {
    var hint = root.querySelector("[data-slug-hint] span:last-child");
    if (hint) hint.textContent = prettyUrl(state.draft.slug);
  }

  function fieldRow(label, control, hint, extra) {
    return el("div", { class: "field" }, [
      el("div", { class: "field__label", text: label }),
      el("div", { class: "field__control" }, [
        control,
        hint ? el("p", { class: "field__hint", text: hint }) : null,
        extra || null,
      ]),
    ]);
  }

  function sectionRow(label) {
    return el("div", { class: "section" }, [el("span", { text: label })]);
  }

  // slot je { src, alt, match } — menja se u mestu da bi draft ostao jedan
  // objekat. onRemove: funkcija — × sklanja ceo slot; izostavljen — × prazni
  // sliku; false — nema × (slot koji ne sme da ostane prazan).
  // onRestore stoji samo uz Framer slotove, gde × sliku sakriva a ne brise.
  function mediaSlot(slot, kind, onRemove, onRestore) {
    var accept = kind === "video" ? "video/mp4,video/webm" : "image/*";

    // Sklonjen Framer slot izgleda kao prazan iako `src` ostaje: slika je jos u
    // stranici, samo joj je slajd sakriven. Zato i dugme "Vrati".
    if (!slot.src || slot.hidden) {
      return el("div", { class: "media" }, [
        el(
          "button",
          {
            class: kind === "video" ? "filepick" : "dropzone",
            onclick: function () {
              pickFile(accept, function (file) {
                stageFile(file, slot);
              });
            },
          },
          [kind === "video" ? "Choose File..." : "Upload"]
        ),
        slot.hidden && onRestore
          ? el("button", { class: "slot-remove", title: "Vrati originalnu sliku", onclick: onRestore }, [
              "Vrati",
            ])
          : onRemove && !onRestore
          ? el("button", { class: "slot-remove", title: "Ukloni ovaj slot", onclick: onRemove }, [
              "Ukloni",
            ])
          : null,
      ]);
    }

    var preview = displaySrc(slot.src);
    return el("div", { class: "media" }, [
      el("div", { class: "thumb" }, [
        isVideoPath(slot.src) || kind === "video"
          ? el("video", { src: preview, muted: true, playsinline: true })
          : el("img", { src: preview, alt: slot.alt || "" }),
        onRemove === false
          ? null
          : el(
              "button",
              {
                class: "thumb__remove",
                title: onRemove ? "Ukloni sliku iz galerije" : "Ukloni sliku",
                onclick:
                  onRemove ||
                  function () {
                    slot.src = "";
                    markDirty();
                    rerenderEditor();
                  },
              },
              ["×"]
            ),
      ]),
      el(
        "button",
        {
          class: "dropzone",
          onclick: function () {
            pickFile(accept, function (file) {
              stageFile(file, slot);
            });
          },
        },
        ["Zameni"]
      ),
    ]);
  }

  function pickFile(accept, onPick) {
    var input = el("input", { type: "file", accept: accept, style: "display:none" });
    document.body.appendChild(input);
    input.addEventListener("change", function () {
      if (input.files && input.files[0]) onPick(input.files[0]);
      input.remove();
    });
    input.click();
  }

  // Fajl se ne salje odmah — cuva se u memoriji i ulazi u isti commit kao
  // ostatak izmena kad se klikne Publish.
  function stageFile(file, slot) {
    var extension = (file.name.split(".").pop() || "bin").toLowerCase();
    var base = slugify(file.name.replace(/\.[^.]+$/, "")) || "file";
    var path = CFG.publicFolder + "/" + Date.now().toString(36) + "-" + base + "." + extension;

    var reader = new FileReader();
    reader.onerror = function () {
      toast("Ne mogu da procitam fajl.", true);
    };
    reader.onload = function () {
      var dataUrl = String(reader.result);
      state.staged[path] = {
        base64: dataUrl.split(",")[1],
        previewUrl: dataUrl,
        repoPath: CFG.mediaFolder + "/" + path.split("/").pop(),
      };
      slot.src = path;
      slot.hidden = false;
      markDirty();
      rerenderEditor();
    };
    reader.readAsDataURL(file);
  }

  /* --------------------------------------------------------------- write */

  function stagedFilesFor(item) {
    var used = [item.thumb && item.thumb.src, item.video && item.video.src]
      .concat(
        item.images.map(function (image) {
          return image.src;
        })
      )
      .concat(
        (item.extraImages || []).map(function (image) {
          return image.src;
        })
      );
    var files = [];
    used.forEach(function (src) {
      var staged = state.staged[src];
      // `committed` fajlovi ostaju u state.staged zbog pregleda iz memorije,
      // ali se ne salju ponovo pri sledecem Publish-u.
      if (!staged || staged.committed) return;
      var already = files.some(function (file) {
        return file.path === staged.repoPath;
      });
      if (!already) files.push({ path: staged.repoPath, base64: staged.base64 });
    });
    return files;
  }

  // Slot se u stranici pronalazi po `match`. Ako ga nema, izmena nema gde da se
  // upise — a ranije se takav slot tiho preskakao i publish je i dalje javljao
  // uspeh: Dejan je na Falco Gin-u "obrisao" dve slike, panel je rekao da je
  // sacuvao, a slike su ostale na stranici. Zato se sad staje sa jasnom porukom.
  function requireMatch(before, label) {
    if (before && before.match) return;
    throw new Error(
      "Mapa slika za ovaj projekat je zastarela, pa " + label + " nema gde da se " +
        "upise. Pokreni `npm run media-map` pa osvezi panel."
    );
  }

  // Framer slot ne moze da ostane prazan: u stranici bi ostao <img> bez adrese.
  // Slika se zato ili zamenjuje, ili sklanja preko × (`hidden`) — a tad joj src
  // ostaje. Prazan src ovde znaci da je manifest u losem stanju.
  // Bez `field` se tekst ne moze naci u Framer payload-u: izmena bi prosla bez
  // greske, a posetilac bi i dalje video stari tekst. Zato se staje.
  function requireField(field, label) {
    if (field) return;
    throw new Error(
      "Mapa teksta za " + label + " je zastarela, pa izmena nema gde da se upise. " +
        "Pokreni `npm run media-map` pa osvezi panel."
    );
  }
  function requireSrc(src, label) {
    if (src) return;
    throw new Error(
      label.charAt(0).toUpperCase() + label.slice(1) + " ne moze da ostane prazna. " +
        "Zameni je drugom slikom, ili je skloni sa stranice preko ×."
    );
  }

  // Vraca listu { match, src } za slotove kojima se slika promenila.
  function changedSlots(draft, original) {
    var pairs = [];
    if (draft.thumb.src !== original.thumb.src) {
      requireSrc(draft.thumb.src, "naslovna slika");
      requireMatch(original.thumb, "naslovna slika");
      pairs.push({ match: original.thumb.match, src: draft.thumb.src });
    }
    draft.images.forEach(function (image, index) {
      var before = original.images[index];
      if (!before || image.src === before.src) return;
      var label = "slika " + (index + 1);
      requireSrc(image.src, label);
      requireMatch(before, label);
      pairs.push({ match: before.match, src: image.src });
    });
    if (draft.video.src !== original.video.src && original.video.match) {
      pairs.push({ match: original.video.match, src: draft.video.src });
    }
    return pairs;
  }

  // Zamena slike u Framer-exportovanoj stranici.
  //
  // Ista slika stoji na tri mesta: u `srcset` listi (vise velicina), u `src`
  // atributu, i u JSON payload-u koji Framer ugradjuje u stranicu i iz kog
  // React hidrira. Preskociti payload znaci ostaviti stare URL-ove koje React
  // moze da vrati na ekran, pa se menjaju sva tri.
  function rewriteHtml(html, pairs) {
    pairs.forEach(function (pair) {
      if (!pair.src) return;

      // Nova slika je jedan fajl bez varijanti, pa cela srcset lista pada na
      // jedan unos umesto da se ponovi uz svaki deskriptor.
      html = html.replace(/srcset="([^"]*)"/gi, function (attr, value) {
        return value.indexOf(pair.match) >= 0 ? 'srcset="' + pair.src + '"' : attr;
      });

      var optImage = /^image-[a-f0-9]+$/i.test(pair.match);
      if (optImage) {
        // `image-abc123` pokriva sve velicine: -512, -1024, -2048, -2560.
        var sized = new RegExp("/assets/images/opt/" + pair.match + "-\\d+\\.webp", "g");
        html = html.replace(sized, pair.src);
      } else {
        html = html.split(pair.match).join(pair.src);
      }
    });
    return html;
  }

  // Spisak dodatnih i sklonjenih slika koji cita assets/legacy-gallery.js.
  // `gallery` su hasevi Framer-ovih sest slika — po njima skript pronalazi
  // galeriju u DOM-u posle hidracije, bez oslanjanja na Framer klase koje se
  // menjaju exportom. `hidden` su hasevi slajdova koje treba skloniti; ostaju i
  // u `gallery`, jer slika ostaje u stranici i sluzi kao orijentir.
  function writeExtraBlock(html, known, images, hidden) {
    var json = JSON.stringify({ gallery: known, images: images, hidden: hidden || [] });
    var re = /(<script type="application\/json" id="cms-extra-media">)([\s\S]*?)(<\/script>)/;

    if (re.test(html)) {
      return html.replace(re, function (all, open, body, close) {
        return open + json + close;
      });
    }
    return html.replace(
      "</body>",
      '<script type="application/json" id="cms-extra-media">' + json + "</script>\n</body>"
    );
  }

  function updatedManifest(draft) {
    var manifest = JSON.parse(JSON.stringify(state.legacyManifest || {}));
    var entry = manifest[draft.slug] || { thumb: null, images: [], video: null };

    entry.thumb = draft.thumb.src
      ? { match: draft.thumb.src === state.original.thumb.src ? draft.thumb.match : draft.thumb.src,
          src: draft.thumb.src, alt: draft.thumb.alt || "" }
      : null;

    entry.images = draft.images.map(function (image, index) {
      var before = state.original.images[index] || {};
      var slot = {
        match: image.src === before.src ? before.match || image.src : image.src,
        src: image.src,
        alt: image.alt || "",
      };
      // Sklonjena slika zadrzava src i match: tako moze da se vrati jednim
      // klikom, a i dalje je adresabilna ako se kasnije zamenjuje.
      if (image.hidden) slot.hidden = true;
      return slot;
    });

    entry.video = draft.video.src
      ? { match: draft.video.src === state.original.video.src ? draft.video.match : draft.video.src,
          src: draft.video.src }
      : null;

    entry.extra = cleanExtras(draft);
    // `field` mora da ostane: po njemu updatePayload pronalazi tekst u Framer
    // payload-u. Bez njega izmena teksta prodje bez greske, a posetilac i dalje
    // vidi stari — sto se i desilo Falco Gin-u posle prvog snimanja iz panela.
    entry.texts = (draft.texts || []).map(function (text) {
      return {
        key: text.key,
        field: text.field,
        label: text.label,
        value: text.value,
        rows: text.rows,
      };
    });

    manifest[draft.slug] = entry;
    return manifest;
  }

  // Po cemu assets/legacy-gallery.js prepoznaje galeriju u DOM-u posle
  // hidracije. Mora da bude stanje POSLE ove izmene: ako je slot upravo
  // zamenjen uploadom, stari Framer hash vise ne postoji na stranici i skript
  // ne bi nasao galeriju.
  function galleryMatches(draft) {
    return draft.images
      .map(function (image, index) {
        var before = state.original.images[index] || {};
        if (!image.src) return "";
        return image.src === before.src ? before.match || image.src : image.src;
      })
      .filter(Boolean);
  }

  // Hasevi slajdova koje assets/legacy-gallery.js treba da skloni. Racuna se
  // isto kao galleryMatches, jer sklonjena slika ostaje u stranici i po istom
  // hasu se pronalazi u DOM-u.
  function hiddenMatches(draft) {
    return draft.images
      .map(function (image, index) {
        if (!image.hidden || !image.src) return "";
        var before = state.original.images[index] || {};
        return image.src === before.src ? before.match || image.src : image.src;
      })
      .filter(Boolean);
  }

  function hiddenChanged(draft) {
    return (
      JSON.stringify(hiddenMatches(draft)) !==
      JSON.stringify(
        (state.original.images || [])
          .map(function (image) {
            return image.hidden && image.src ? image.match || image.src : "";
          })
          .filter(Boolean)
      )
    );
  }

  function cleanExtras(draft) {
    return (draft.extraImages || [])
      .filter(function (image) {
        return image.src;
      })
      .map(function (image) {
        return { src: image.src, alt: image.alt || "" };
      });
  }

  function extrasChanged(draft) {
    return JSON.stringify(cleanExtras(draft)) !== JSON.stringify(cleanExtras(state.original));
  }

  // Prepisuje stavku u state.items onim sto je upravo commit-ovano i azurira
  // mape, tako da panel odmah pokazuje novo stanje bez citanja sa GitHub-a.
  function commitDraftLocally(draft) {
    var key =
      draft.kind === "page"
        ? "page:" + draft.id
        : draft.kind === "legacy"
        ? "legacy:" + draft.slug
        : "cms:" + (draft.file || CFG.contentDir + "/" + draft.slug + ".md");

    var saved = JSON.parse(JSON.stringify(draft));
    saved.key = key;
    saved.isNew = false;
    if (saved.kind === "cms" && !saved.file) {
      saved.file = CFG.contentDir + "/" + saved.slug + ".md";
    }

    var replaced = false;
    state.items = state.items.map(function (item) {
      if (item.key !== draft.key && item.key !== key) return item;
      replaced = true;
      return saved;
    });
    if (!replaced) state.items.push(saved);
    state.selectedKey = key;

    if (saved.kind === "legacy") {
      // updatedManifest poredi sa state.original, koji je jos pre-publish
      // stanje — zato se zove pre nego sto se original resetuje.
      var manifest = updatedManifest(saved);
      state.legacyManifest = manifest;

      var entry = manifest[saved.slug] || {};
      if (saved.thumb && entry.thumb) saved.thumb.match = entry.thumb.match;
      (entry.images || []).forEach(function (image, index) {
        if (saved.images[index]) saved.images[index].match = image.match;
      });
      if (saved.video && entry.video) saved.video.match = entry.video.match;
    } else if (saved.kind === "page") {
      var pages = JSON.parse(JSON.stringify(state.pagesManifest || {}));
      var page = pages[saved.id] || {};

      page.images = saved.images.map(function (image, index) {
        var before = (state.original.images || [])[index] || {};
        // Zamenjena slika od sada se prepoznaje po svojoj novoj putanji.
        image.match = image.src === before.src ? before.match || image.src : image.src;
        return { key: image.key, label: image.label, match: image.match, src: image.src };
      });
      page.texts = saved.texts.map(function (text) {
        return { key: text.key, label: text.label, value: text.value, rows: text.rows };
      });

      pages[saved.id] = page;
      state.pagesManifest = pages;
    }
  }

  function padDraftSlots() {
    var draft = state.draft;
    if (!draft) return;
    while (draft.kind === "cms" && draft.services.length < 3) draft.services.push("");
    if (draft.kind === "cms" && !draft.images.length) {
      draft.images.push({ src: "", alt: "", match: "" });
    }
  }

  // Redosled ide u jedan fajl, pa je commit kratak. Stranice ne prepisuje panel
  // nego build na Vercel-u: on cita content/order.json i po njemu redja kartice
  // na /work i upisuje CSS `order` na naslovnu.
  function publishOrder() {
    if (!orderDirty()) return;

    state.saving = true;
    render();

    var body = JSON.stringify({ work: state.order.work, home: state.order.home }, null, 2);
    state.store
      .commit('CMS: redosled projekata', [
        { path: CFG.orderFile, base64: b64encode(body + '\n') },
      ])
      .then(function () {
        state.orderOriginal = JSON.parse(JSON.stringify(state.order));
        state.saving = false;
        render();
        toast('Redosled je sacuvan. Vidi se na sajtu kad Vercel zavrsi build.');
      })
      .catch(function (err) {
        state.saving = false;
        render();
        toast(err.message || 'Redosled nije sacuvan.', true);
      });
  }
  function publishDraft() {
    var draft = state.draft;
    if (!draft.title.trim()) {
      toast("Title je obavezan.", true);
      return;
    }
    if (draft.kind === "cms" && !draft.slug) {
      toast("Slug je obavezan.", true);
      return;
    }
    if (draft.kind === "cms") {
      var clash = state.items.filter(function (item) {
        return item.key !== draft.key && item.slug === draft.slug;
      });
      if (clash.length) {
        toast('Slug "' + draft.slug + '" vec postoji.', true);
        return;
      }
    }

    state.saving = true;
    render();

    // buildCommit ume i sinhrono da baci (npr. kad slot nema `match`), pa se
    // poziv uvija — inace greska promakne mimo .catch i panel ostane zaglavljen
    // na "cuvam".
    Promise.resolve()
      .then(function () {
        return buildCommit(draft);
      })
      .then(function (payload) {
        return state.store.commit(payload.message, payload.files);
      })
      .then(function () {
        // Namerno se NE cita ponovo sa GitHub-a. Dva razloga:
        //
        //   1. GitHub API je eventually consistent — odmah posle commit-a GET
        //      jos vraca prethodni sadrzaj, pa bi se projekat otvorio sa
        //      starim slikama dok se panel ne osvezi rucno.
        //   2. Nove slike se u panelu prikazuju preko /assets/uploads/..., a
        //      tamo ih nema dok Vercel ne zavrsi build.
        //
        // Stanje posle commit-a je vec poznato — to je upravo ono sto je
        // upisano — pa se primenjuje lokalno. state.staged se ne prazni da bi
        // pregled i dalje isao iz memorije, bez cekanja deploy-a.
        Object.keys(state.staged).forEach(function (path) {
          state.staged[path].committed = true;
        });
        commitDraftLocally(draft);

        state.saving = false;
        state.dirty = false;
        state.draft = JSON.parse(JSON.stringify(findItem(state.selectedKey) || draft));
        state.original = JSON.parse(JSON.stringify(state.draft));
        padDraftSlots();

        render();
        toast(
          DEMO
            ? "Demo: izmena nije sacuvana."
            : "Sacuvano. Panel vec prikazuje novo stanje; sajt je uzivo za par minuta."
        );
      })
      .catch(function (err) {
        console.error(err);
        state.saving = false;
        render();
        toast("Cuvanje nije uspelo: " + err.message, true);
      });
  }

  // Isti tekst stoji u dva oblika: u telu HTML-a i u template literalu unutar
  // page chunk-a. Escape zavisi od toga u koji fajl se upisuje.
  // Isti tekst stoji na vise mesta i u razlicitom kontekstu, pa escape ne moze
  // biti isti svuda:
  //
  //   html  telo stranice            -> HTML entiteti
  //   json  __framer__handoverData   -> JSON escape; entiteti bi se ovde
  //                                    prikazali doslovno ("&amp;"), jer React
  //                                    renderuje payload kao obican tekst
  //   mjs   page chunk               -> template literal
  function escapeFor(text, context) {
    var value = String(text);
    if (context === "mjs") {
      return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    }
    if (context === "json") {
      return JSON.stringify(value).slice(1, -1);
    }
    // Navodnici su bezbedni jer ovo nije vrednost atributa.
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  var HANDOVER = /<script\b[^>]*id="__framer__handoverData"[^>]*>[\s\S]*?<\/script>/i;

  // Tekstualna polja stranice projekta se u payloadu menjaju PO INDEKSU POLJA,
  // ne pretragom teksta: vrednosti kao "Brand Identity" javljaju se i drugde na
  // stranici, pa bi slepa zamena pogodila i ono sto ne treba.
  function updatePayload(html, updates) {
    var match = HANDOVER.exec(html);
    if (!match) return html;

    var openEnd = match[0].indexOf(">") + 1;
    var open = match[0].slice(0, openEnd);
    var body = match[0].slice(openEnd, match[0].length - "</script>".length);

    var table;
    try {
      table = JSON.parse(body);
    } catch (err) {
      console.error("handover payload nije validan JSON", err);
      return html;
    }

    var record = null;
    for (var i = 0; i < table.length; i++) {
      var entry = table[i];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      var hit = updates.some(function (update) {
        return update.field in entry;
      });
      if (hit) {
        record = entry;
        break;
      }
    }
    if (!record) return html;

    var touched = false;
    updates.forEach(function (update) {
      if (!(update.field in record)) return;
      var index = record[update.field];
      var slot = table[index];
      // Vrednost je ili direktno string na tom indeksu, ili omotac
      // {type, value} ciji `value` pokazuje na string.
      if (slot && typeof slot === "object" && !Array.isArray(slot) && "value" in slot) {
        table[slot.value] = update.to;
      } else {
        table[index] = update.to;
      }
      touched = true;
    });
    if (!touched) return html;

    // JSON.stringify ne escape-uje "/", pa bi tekst koji sadrzi "</script>"
    // prekinuo tag ranije.
    var serialized = JSON.stringify(table).split("</script>").join("<\\/script>");
    return html.replace(match[0], open + serialized + "</script>");
  }

  // Ista vrednost stoji i u renderovanom telu stranice. Menja se ciljano — kao
  // ceo tekstualni cvor ili cela vrednost atributa — da se ne pogodi podniz.
  function updateBodyText(html, updates) {
    updates.forEach(function (update) {
      var asText = ">" + update.from + "<";
      html = html.split(asText).join(">" + escapeFor(update.to, "html") + "<");

      var asAttr = '"' + update.from + '"';
      html = html.split(asAttr).join('"' + update.to.replace(/"/g, "&quot;") + '"');
    });
    return html;
  }

  function replaceText(content, pair, context) {
    if (content.indexOf(pair.from) < 0) return content;
    return content.split(pair.from).join(escapeFor(pair.to, context));
  }

  function applyReplacements(content, imagePairs, textPairs, path) {
    var isJs = /\.mjs$/i.test(path);

    textPairs.forEach(function (pair) {
      if (content.indexOf(pair.from) < 0) return;

      if (isJs) {
        content = replaceText(content, pair, "mjs");
        return;
      }

      // U HTML-u se payload odvaja i menja po svojim pravilima; ostatak
      // stranice po HTML pravilima.
      var payload = HANDOVER.exec(content);
      if (!payload) {
        content = replaceText(content, pair, "html");
        return;
      }

      var head = content.slice(0, payload.index);
      var tail = content.slice(payload.index + payload[0].length);
      content =
        replaceText(head, pair, "html") +
        replaceText(payload[0], pair, "json") +
        replaceText(tail, pair, "html");
    });

    return rewriteHtml(content, imagePairs);
  }

  function buildPageCommit(draft) {
    var files = stagedFilesFor(draft);

    var imagePairs = [];
    draft.images.forEach(function (image, index) {
      var before = state.original.images[index];
      if (!before || image.src === before.src) return;
      var label = "slika " + (index + 1);
      requireSrc(image.src, label);
      requireMatch(before, label);
      imagePairs.push({ match: before.match, src: image.src });
    });

    var textPairs = [];
    draft.texts.forEach(function (text, index) {
      var before = state.original.texts[index];
      if (before && text.value !== before.value) {
        textPairs.push({ from: before.value, to: text.value });
      }
    });

    if (!imagePairs.length && !textPairs.length) {
      return Promise.reject(new Error("Nema izmena za snimanje."));
    }

    // Sadrzaj Home-a i About-a stoji i u HTML-u i u page chunk-u iz kog React
    // renderuje. Promeniti samo HTML znaci da hidracija vrati staro stanje —
    // zato se menja svaki izvor iz mape.
    var sources = draft.sources && draft.sources.length ? draft.sources : [draft.file];

    return Promise.all(
      sources.map(function (path) {
        return state.store.readFile(path);
      })
    ).then(function (contents) {
      var textHits = {};

      contents.forEach(function (content, index) {
        if (content === null) {
          throw new Error("Ne mogu da procitam " + sources[index] + " iz repozitorijuma.");
        }
        textPairs.forEach(function (pair, pairIndex) {
          textHits[pairIndex] = (textHits[pairIndex] || 0) + content.split(pair.from).length - 1;
        });
      });

      textPairs.forEach(function (pair, pairIndex) {
        if (!textHits[pairIndex]) {
          throw new Error(
            'Stari tekst "' + pair.from.slice(0, 40) +
              '…" nije pronadjen u stranici. Pokreni `npm run media-map` da se mapa osvezi.'
          );
        }
      });

      contents.forEach(function (content, index) {
        var next = applyReplacements(content, imagePairs, textPairs, sources[index]);
        if (next !== content) {
          files.push({ path: sources[index], base64: b64encode(next) });
        }
      });

      var manifest = JSON.parse(JSON.stringify(state.pagesManifest || {}));
      var entry = manifest[draft.id] || {};
      entry.images = draft.images.map(function (image, index) {
        var before = state.original.images[index] || {};
        return {
          key: image.key,
          label: image.label,
          match: image.src === before.src ? before.match : image.src,
          src: image.src,
        };
      });
      entry.texts = draft.texts.map(function (text) {
        return { key: text.key, label: text.label, value: text.value, rows: text.rows };
      });
      entry.sources = sources;
      manifest[draft.id] = entry;
      files.push({ path: CFG.pagesFile, base64: b64encode(JSON.stringify(manifest, null, 2) + "\n") });

      var what = [];
      if (imagePairs.length) what.push(imagePairs.length + " slika");
      if (textPairs.length) what.push("tekst");

      return { message: "CMS: " + draft.title + " — " + what.join(" + "), files: files };
    });
  }

  function buildCommit(draft) {
    if (draft.kind === "page") return buildPageCommit(draft);

    var files = stagedFilesFor(draft);

    if (draft.kind === "cms") {
      var path = draft.file || CFG.contentDir + "/" + draft.slug + ".md";
      draft.services = draft.services.filter(function (value) {
        return String(value).trim() !== "";
      });
      files.push({ path: path, base64: b64encode(toMarkdown(draft)) });
      return Promise.resolve({
        message: (draft.isNew ? "CMS: novi projekat " : "CMS: izmena ") + draft.title,
        files: files,
      });
    }

    // Kartica na /work je do sad koristila manju varijantu iste slike; kad se
    // Thumb zameni, karticu preuzima nova slika.
    if (draft.thumb.src !== state.original.thumb.src) {
      draft.cardImage = draft.thumb.src;
    }

    // Legacy: kartica u legacy-work.json, slike u HTML-u, mapa u manifestu.
    var rows = state.items
      .filter(function (item) {
        return item.kind === "legacy";
      })
      .map(function (item) {
        return toLegacyRow(item.key === draft.key ? draft : item);
      });

    files.push({ path: CFG.legacyFile, base64: b64encode(JSON.stringify(rows, null, 2) + "\n") });
    files.push({
      path: CFG.legacyImagesFile,
      base64: b64encode(JSON.stringify(updatedManifest(draft), null, 2) + "\n"),
    });

    var pairs = changedSlots(draft, state.original);
    var extrasDirty = extrasChanged(draft);
    var hiddenDirty = hiddenChanged(draft);

    var textUpdates = [];
    (draft.texts || []).forEach(function (text, index) {
      var before = (state.original.texts || [])[index];
      if (before && text.value !== before.value) {
        requireField(text.field, text.label || "tekst " + (index + 1));
        textUpdates.push({ field: text.field, from: before.value, to: text.value });
      }
    });

    if (!pairs.length && !extrasDirty && !hiddenDirty && !textUpdates.length) {
      return Promise.resolve({ message: "CMS: izmena kartice " + draft.title, files: files });
    }

    // Izvori projekta iz mape (stranica + eventualni page chunk), plus Home —
    // on prikazuje thumbove izabranih projekata, pa bi inace ostao sa starom
    // slikom dok bi /work i sama stranica imale novu.
    var sources = (draft.sources || ["work/" + draft.slug + "/index.html"]).slice();
    if (sources.indexOf("index.html") < 0) sources.push("index.html");

    return Promise.all(
      sources.map(function (path) {
        return state.store.readFile(path);
      })
    ).then(function (contents) {
      var pageFile = "work/" + draft.slug + "/index.html";

      contents.forEach(function (content, index) {
        if (content === null) return;
        var next = rewriteHtml(content, pairs);

        if (textUpdates.length) {
          // Payload je merodavan za ono sto se vidi posle hidracije; telo
          // stranice se menja da se pre hidracije ne vidi stari tekst.
          next = updatePayload(next, textUpdates);
          next = updateBodyText(next, textUpdates);
        }

        // Spisak dodatnih slika stoji samo u stranici samog projekta.
        if (sources[index] === pageFile) {
          next = writeExtraBlock(next, galleryMatches(draft), cleanExtras(draft), hiddenMatches(draft));
        }
        if (next !== content) {
          files.push({ path: sources[index], base64: b64encode(next) });
        }
      });

      var what = [];
      if (pairs.length) what.push("zamena " + pairs.length + " slike/slika");
      if (extrasDirty) what.push(cleanExtras(draft).length + " dodatnih slika");
      if (textUpdates.length) what.push(textUpdates.length + " tekstualnih polja");

      return { message: "CMS: " + draft.title + " — " + what.join(", "), files: files };
    });
  }

  function setStatus(item, status) {
    if (item.status === status) return;
    var previous = item.status;
    item.status = status;
    refreshTable();

    var files;
    if (item.kind === "legacy") {
      var rows = state.items
        .filter(function (row) {
          return row.kind === "legacy";
        })
        .map(toLegacyRow);
      files = [{ path: CFG.legacyFile, base64: b64encode(JSON.stringify(rows, null, 2) + "\n") }];
    } else {
      files = [{ path: item.file, base64: b64encode(toMarkdown(item)) }];
    }

    state.store
      .commit("CMS: " + item.title + " -> " + status, files)
      .then(function () {
        toast(DEMO ? "Demo: status nije sacuvan." : "Status: " + status + ". Sajt se gradi.");
      })
      .catch(function (err) {
        item.status = previous;
        refreshTable();
        toast("Ne mogu da promenim status: " + err.message, true);
      });
  }

  function deleteItem(item) {
    var extra =
      item.kind === "legacy"
        ? "\n\nBrise se i sama stranica work/" + item.slug + "/index.html."
        : "";
    if (!confirm('Obrisati "' + item.title + '"?' + extra)) return;

    var files = [];
    if (item.kind === "legacy") {
      var rows = state.items
        .filter(function (row) {
          return row.kind === "legacy" && row.key !== item.key;
        })
        .map(toLegacyRow);
      var manifest = JSON.parse(JSON.stringify(state.legacyManifest || {}));
      delete manifest[item.slug];
      files.push({ path: CFG.legacyFile, base64: b64encode(JSON.stringify(rows, null, 2) + "\n") });
      files.push({
        path: CFG.legacyImagesFile,
        base64: b64encode(JSON.stringify(manifest, null, 2) + "\n"),
      });
      files.push({ path: "work/" + item.slug + "/index.html", remove: true });
    } else {
      if (item.isNew) {
        state.items = state.items.filter(function (row) {
          return row.key !== item.key;
        });
        state.view = "list";
        state.draft = null;
        state.dirty = false;
        render();
        return;
      }
      files.push({ path: item.file, remove: true });
    }

    state.store
      .commit("CMS: brisanje projekta " + item.title, files)
      .then(function () {
        // Kao i kod Publish-a: stanje je poznato, pa se ne cita ponovo sa
        // GitHub-a koji odmah posle commit-a jos vraca staro.
        state.items = state.items.filter(function (row) {
          return row.key !== item.key;
        });
        if (item.kind === "legacy") {
          var manifest = JSON.parse(JSON.stringify(state.legacyManifest || {}));
          delete manifest[item.slug];
          state.legacyManifest = manifest;
        }
        state.view = "list";
        state.draft = null;
        state.original = null;
        state.selectedKey = null;
        state.dirty = false;
        render();
        toast(DEMO ? "Demo: nista nije obrisano." : "Obrisano. Sajt se gradi.");
      })
      .catch(function (err) {
        toast("Brisanje nije uspelo: " + err.message, true);
      });
  }

  function reload() {
    state.store
      .load()
      .then(function (items) {
        state.items = items;
        state.view = "list";
        state.draft = null;
        state.original = null;
        state.dirty = false;
        render();
        toast("Osvezeno.");
      })
      .catch(function (err) {
        toast(err.message, true);
      });
  }

  /* ---------------------------------------------------------------- init */

  window.addEventListener("beforeunload", function (event) {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  if (DEMO) {
    boot(null);
  } else {
    var saved = localStorage.getItem(TOKEN_KEY);
    if (saved) boot(saved);
    else renderLogin(null);
  }
})();
