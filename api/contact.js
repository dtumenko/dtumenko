// Prima kontakt formu sa /contact i salje je na mejl.
//
// Framer export nosi formu bez ikakvog `action`: u originalu ju je primao
// Framer-ov hosting, koji van Framera ne postoji — pa je dugme "posalji" do sad
// bilo mrtvo. Ovaj endpoint je zamena.
//
// Salje se preko Resend-a (https://resend.com), jer trazi samo jedan API kljuc
// i nikakvu biblioteku. Podesava se kroz Vercel env promenljive:
//
//   RESEND_API_KEY   obavezno — kljuc iz Resend naloga
//   CONTACT_TO       gde stizu poruke (podrazumevano hi@dtumenko.com)
//   CONTACT_FROM     posiljalac; mora biti sa domena potvrdjenog u Resend-u
//                    (dtumenko.com je potvrdjen, pa je podrazumevani sa njega)
//
// Adresa posetioca ide u `reply_to`, pa se na poruku odgovara obicnim Reply.

const DEFAULT_TO = "hi@dtumenko.com";
const DEFAULT_FROM = "dtumenko.com <website@dtumenko.com>";

// Polja koja popuni samo bot; posetilac ih ne vidi. Framer ih vec ima u formi.
const HONEYPOTS = [
  "website",
  "company",
  "subject",
  "title",
  "description",
  "feedback",
  "notes",
  "details",
  "remarks",
  "comments",
];

function clean(value, limit) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit || 200);
}

// Vrednosti posetioca ne smeju da unesu nove redove u zaglavlje mejla.
function headerSafe(value) {
  return clean(value, 200).replace(/[\r\n]/g, " ");
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};

  // Bot je popunio nevidljivo polje — tiho se potvrdjuje da ne pokusava ponovo.
  if (HONEYPOTS.some((name) => clean(body[name]))) {
    res.status(200).json({ ok: true });
    return;
  }

  const email = headerSafe(body.email);
  const firstName = clean(body.firstName, 80);
  const lastName = clean(body.lastName, 80);
  const phone = clean(body.phone, 60);
  const message = String(body.message == null ? "" : body.message).trim().slice(0, 5000);

  if (!looksLikeEmail(email)) {
    res.status(400).json({ error: "Neispravna imejl adresa." });
    return;
  }
  if (!firstName && !message) {
    res.status(400).json({ error: "Poruka je prazna." });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("contact: nedostaje RESEND_API_KEY");
    res.status(500).json({ error: "Slanje trenutno nije podeseno." });
    return;
  }

  const name = [firstName, lastName].filter(Boolean).join(" ");
  const lines = [
    `Ime: ${name || "(nije uneto)"}`,
    `Imejl: ${email}`,
    `Telefon: ${phone || "(nije uneto)"}`,
    "",
    "Poruka:",
    message || "(nije uneta)",
  ];

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.CONTACT_FROM || DEFAULT_FROM,
        to: [process.env.CONTACT_TO || DEFAULT_TO],
        reply_to: email,
        subject: `Poruka sa sajta${name ? " — " + name : ""}`,
        text: lines.join("\n"),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("contact: Resend je odbio poruku", response.status, detail);
      res.status(502).json({ error: "Poruka nije poslata. Pokusajte ponovo." });
      return;
    }
  } catch (err) {
    console.error("contact: slanje nije uspelo", err);
    res.status(502).json({ error: "Poruka nije poslata. Pokusajte ponovo." });
    return;
  }

  res.status(200).json({ ok: true });
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}
