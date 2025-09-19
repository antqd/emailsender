require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");

const app = express();
app.use(cors());

// limiti alzati
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ================== SMTP SHARED ==================
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ================== HELPERS ==================
/**
 * Normalizza gli allegati dal body:
 * - accetta array in `allegati` o `attachments` [{filename, content|base64|contentBase64|allegato}]
 * - accetta singolo `{filename, allegato}` (string base64)
 * - ritorna array compatibile con nodemailer
 */
function normalizeAttachments({ allegati, attachments, allegato, filename }) {
  const rawList = Array.isArray(allegati || attachments)
    ? allegati || attachments
    : allegati || attachments
    ? [allegati || attachments]
    : allegato
    ? [{ filename: filename || "documento.pdf", base64: allegato }]
    : [];

  return rawList
    .filter(
      (a) => a && (a.base64 || a.content || a.contentBase64 || a.allegato)
    )
    .map((a) => ({
      filename: a.filename || "allegato.pdf",
      content: Buffer.from(
        a.base64 || a.content || a.contentBase64 || a.allegato,
        "base64"
      ),
      encoding: "base64",
      contentType: (a.filename || "").toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : undefined,
    }));
}

/**
 * Invia la stessa mail (stesso contenuto + allegati) agli interni e al cliente.
 */
async function sendToInternalsAndClient({
  toInternals,
  toClient,
  subject,
  html,
  attachments,
  brand,
  replyTo,
}) {
  const fromName = brand || process.env.BRAND_NAME || "Energy Planner";
  const from = `"${fromName}" <${process.env.EMAIL_USER}>`;

  const tasks = [];
  if (toInternals?.length) {
    tasks.push(
      transporter.sendMail({
        from,
        to: toInternals,
        subject,
        html,
        attachments,
        replyTo,
      })
    );
  }
  if (toClient) {
    tasks.push(
      transporter.sendMail({
        from,
        to: toClient,
        subject,
        html,
        attachments,
      })
    );
  }
  await Promise.all(tasks);
}

/** HTML standard */
function composeHtml({ nome, email, telefono, messaggio }) {
  return `
    <h2>Dettagli richiesta</h2>
    <p><b>Nome:</b> ${nome || "-"}</p>
    <p><b>Email:</b> ${email || "-"}</p>
    ${telefono ? `<p><b>Telefono:</b> ${telefono}</p>` : ""}
    ${messaggio ? `<p><b>Messaggio:</b><br>${messaggio}</p>` : ""}
    <p><small>${new Date().toLocaleString("it-IT")}</small></p>
  `;
}

/** Ricava lista destinatari interni */
function getInternalRecipients(envKey, fallback) {
  const raw =
    process.env[envKey] ||
    process.env.INTERNAL_ONLY_TO ||
    process.env.CUSTOMER_INTERNAL_TO ||
    "";
  const list = (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length) return list;
  return fallback;
}

// ================== ENDPOINT ESISTENTI ==================

// invio principale
app.post("/api/sendEmail", async (req, res) => {
  const { nome, email, allegato, filename } = req.body;

  try {
    await transporter.sendMail({
      from: `"Energy Planner" <${process.env.EMAIL_USER}>`,
      to: "megliorisparmiare@gmail.com",
      subject: `Nuova candidatura da ${nome}`,
      html: `
        <p><strong>Nome:</strong> ${nome}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Data:</strong> ${new Date().toLocaleString("it-IT")}</p>
      `,
      attachments: [
        {
          filename,
          content: Buffer.from(allegato, "base64"),
          encoding: "base64",
        },
      ],
    });

    res.status(200).json({ message: "Email inviata" });
  } catch (err) {
    console.error("Errore invio:", err);
    res.status(500).json({ message: "Errore invio email" });
  }
});

// invio alternativo
app.post("/api/sendEmailAlt", async (req, res) => {
  const { nome, email, attachments } = req.body;

  try {
    await transporter.sendMail({
      from: `"Energy Planner" <${process.env.EMAIL_USER}>`,
      to: "megliorisparmiare@gmail.com",
      subject: `Candidatura da ${nome}`,
      html: `
        <p>Nome: ${nome}</p>
        <p>Email: ${email}</p>
        <p>Data: ${new Date().toLocaleString("it-IT")}</p>
      `,
      attachments: (attachments || []).map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content, "base64"),
        encoding: "base64",
        contentType: "application/pdf",
      })),
    });

    res.status(200).json({ message: "Email inviata" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Errore invio" });
  }
});

// stessi contenuti a interni + cliente
app.post("/api/sendToClient", async (req, res) => {
  try {
    const BRAND = process.env.BRAND_NAME || "Dojo";
    const {
      nome,
      email,
      telefono,
      messaggio,
      allegati,
      attachments,
      filename,
      allegato,
    } = req.body || {};

    if (!nome || !email) {
      return res
        .status(400)
        .json({ message: "nome ed email sono obbligatori" });
    }

    const atts = normalizeAttachments({
      allegati,
      attachments,
      allegato,
      filename,
    });

    const subject = `Richiesta ${BRAND} – ${nome}`;
    const html = composeHtml({ nome, email, telefono, messaggio });

    await Promise.all([
      transporter.sendMail({
        from: `"${BRAND}" <${process.env.EMAIL_USER}>`,
        to: "megliodojo@gmail.com",
        subject,
        html,
        attachments: atts,
        replyTo: email,
      }),
      transporter.sendMail({
        from: `"${BRAND}" <${process.env.EMAIL_USER}>`,
        to: email,
        subject,
        html,
        attachments: atts,
      }),
    ]);

    res.json({ ok: true, message: "Stessa mail inviata a cliente e interni" });
  } catch (err) {
    console.error("Errore invio /api/sendToClient:", err);
    res.status(500).json({
      ok: false,
      message: "Errore invio",
      error: String(err?.message || err),
    });
  }
});

// solo interni
app.post("/api/sendToInternalOnly", async (req, res) => {
  try {
    const BRAND = process.env.BRAND_NAME || "Energy Planner";
    const {
      nome,
      email,
      telefono,
      messaggio,
      allegati,
      attachments,
      filename,
      allegato,
    } = req.body || {};

    if (!nome || !email) {
      return res
        .status(400)
        .json({ ok: false, message: "nome ed email sono obbligatori" });
    }

    const atts = normalizeAttachments({
      allegati,
      attachments,
      allegato,
      filename,
    });

    const internalOnly = getInternalRecipients("INTERNAL_ONLY_TO", [
      "megliodojo@gmail.com",
    ]);

    if (!internalOnly.length) {
      return res
        .status(500)
        .json({ ok: false, message: "Destinatari interni non configurati" });
    }

    await transporter.sendMail({
      from: `"${BRAND}" <${process.env.EMAIL_USER}>`,
      to: internalOnly,
      subject: `Nuova richiesta (solo interni): ${nome}`,
      html: composeHtml({ nome, email, telefono, messaggio }),
      attachments: atts,
      replyTo: email,
    });

    return res.json({ ok: true, message: "Inoltro agli interni completato" });
  } catch (err) {
    console.error("Errore /api/sendToInternalOnly:", err);
    return res.status(500).json({
      ok: false,
      message: "Errore invio",
      error: String(err?.message || err),
    });
  }
});

// routes/ct3.js (o dentro il tuo index)
app.post("/api/ct3-invio", async (req, res) => {
  try {
    const BRAND = "MeglioEfficientare";
    const {
      privato = {},
      azienda = {},
      luogoedata,
      relazioneTesto, // stringa -> la trasformiamo in .txt
      allegati = {}, // gruppi con array {filename, base64, mime}
    } = req.body || {};

    // pick nome/email/iban minimi per validazione base
    const ragioneSociale =
      azienda?.denominazione ||
      `${privato?.nome || ""} ${privato?.cognome || ""}`.trim();
    const email = privato?.email || azienda?.email;
    const iban = privato?.iban || azienda?.iban;

    if (!ragioneSociale || !email || !iban) {
      return res.status(400).json({
        ok: false,
        message: "ragioneSociale, email e IBAN sono obbligatori",
      });
    }

    // helper: normalizza array allegati
    const mapMany = (
      arr,
      fallbackName,
      fallbackMime = "application/octet-stream"
    ) => {
      const list = Array.isArray(arr) ? arr : arr ? [arr] : [];
      return list
        .filter((f) => f && (f.base64 || f.contentBase64 || f.content))
        .map((f, i) => ({
          filename:
            f.filename ||
            `${fallbackName.replace(/(\.\w+)?$/, "")}${
              list.length > 1 ? `_${i + 1}` : ""
            }${(fallbackName.match(/\.\w+$/) || [".bin"])[0]}`,
          content: Buffer.from(
            f.base64 || f.contentBase64 || f.content,
            "base64"
          ),
          encoding: "base64",
          contentType: f.mime || fallbackMime,
        }));
    };

    const atts = [
      // gruppi richiesti
      ...mapMany(
        allegati?.codice_fiscale,
        "codice_fiscale.pdf",
        "application/pdf"
      ),
      ...mapMany(
        allegati?.documento_identita,
        "documento_identita.pdf",
        "application/pdf"
      ),
      ...mapMany(allegati?.catastale, "catastale.pdf", "application/pdf"),
      ...mapMany(
        allegati?.foto_generatore,
        "foto_generatore.jpg",
        "image/jpeg"
      ),
      ...mapMany(allegati?.visura, "visura.pdf", "application/pdf"),
      // pdf modulo
      ...mapMany(
        allegati?.pdf_modulo,
        "contratto_conto_termico.pdf",
        "application/pdf"
      ),
      // firme opzionali
      ...mapMany(
        allegati?.firma_beneficiario,
        "firma_beneficiario.png",
        "image/png"
      ),
      ...mapMany(
        allegati?.firma_responsabile,
        "firma_responsabile.png",
        "image/png"
      ),
    ];

    // relazione tecnica commerciale -> TXT
    if (relazioneTesto && String(relazioneTesto).trim().length) {
      atts.push({
        filename: "relazione_tecnica.txt",
        content: Buffer.from(String(relazioneTesto), "utf8"),
        contentType: "text/plain; charset=utf-8",
      });
    }

    // corpo email riassuntivo
    const subject = `[CT3] ${BRAND} – ${ragioneSociale}`;
    const html = `
      <h2>Contratto Conto Termico 3.0</h2>

      <h3>Beneficiario — Privato</h3>
      <p><b>Nome:</b> ${privato?.nome || "-"}</p>
      <p><b>Cognome:</b> ${privato?.cognome || "-"}</p>
      <p><b>IBAN:</b> ${privato?.iban || "-"}</p>
      <p><b>Indirizzo:</b> ${privato?.indirizzo || "-"}</p>
      <p><b>Comune:</b> ${privato?.comune || "-"}</p>
      <p><b>CAP:</b> ${privato?.cap || "-"}</p>
      <p><b>Telefono:</b> ${privato?.telefono || "-"}</p>
      <p><b>Email:</b> ${privato?.email || "-"}</p>

      <h3>Beneficiario — Azienda</h3>
      <p><b>Denominazione:</b> ${azienda?.denominazione || "-"}</p>
      <p><b>IBAN:</b> ${azienda?.iban || "-"}</p>
      <p><b>Indirizzo:</b> ${azienda?.indirizzo || "-"}</p>
      <p><b>Comune:</b> ${azienda?.comune || "-"}</p>
      <p><b>CAP:</b> ${azienda?.cap || "-"}</p>
      <p><b>Telefono:</b> ${azienda?.telefono || "-"}</p>
      <p><b>Email:</b> ${azienda?.email || "-"}</p>

      <p><b>Luogo e data (pag.2):</b> ${luogoedata || "-"}</p>

      <hr/>
      <p style="font-size:12px;color:#555">Inviato il ${new Date().toLocaleString(
        "it-IT"
      )}</p>
    `;

    // Invia a interni + cliente
    await Promise.all([
      transporter.sendMail({
        from: `"${BRAND}" <${process.env.EMAIL_USER}>`,
        to: ["backoffice@energyplanner.it"], // <-- cambia con tua mail interna
        subject,
        html,
        attachments: atts,
        replyTo: email,
      }),
      transporter.sendMail({
        from: `"${BRAND}" <${process.env.EMAIL_USER}>`,
        to: email,
        subject,
        html,
        attachments: atts,
      }),
    ]);

    return res.json({
      ok: true,
      message: "Email inviata a backoffice + cliente",
    });
  } catch (err) {
    console.error("Errore /api/ct3-invio:", err);
    return res
      .status(500)
      .json({
        ok: false,
        message: "Errore invio",
        error: String(err?.message || err),
      });
  }
});

// === DIVENTA PARTNER MANAGER (interni: megliodojo + copia al cliente) ===
app.post("/api/diventa-partner-manager", async (req, res) => {
  try {
    const BRAND = "Dojo";

    const {
      ragioneSociale,
      indirizzo,
      comune,
      cap,
      descrizione,
      telefono,
      email,
      iban,
      allegati = {}, // { visura: File[]|File, documento_identita: File[]|File, codice_fiscale: File[]|File, firma: File|{...} }
    } = req.body || {};

    if (!ragioneSociale || !email || !iban) {
      return res.status(400).json({
        ok: false,
        message: "ragioneSociale, email e IBAN sono obbligatori",
      });
    }

    // helper: normalizza singolo o array -> array per nodemailer
    const mapMany = (x, fallbackName, fallbackMime) => {
      const list = Array.isArray(x) ? x : x ? [x] : [];
      return list
        .filter((f) => f && (f.base64 || f.contentBase64 || f.content))
        .map((f, i) => ({
          filename:
            f.filename ||
            `${fallbackName.replace(/(\.\w+)?$/, "")}${
              list.length > 1 ? `_${i + 1}` : ""
            }${(fallbackName.match(/\.\w+$/) || [".pdf"])[0]}`,
          content: Buffer.from(
            f.base64 || f.contentBase64 || f.content,
            "base64"
          ),
          encoding: "base64",
          contentType: f.mime || fallbackMime,
        }));
    };

    // allegati: visura/doc/cf multipli + firma (singola ma gestita con mapMany per semplicità)
    const atts = [
      ...mapMany(allegati?.visura, "visura.pdf", "application/pdf"),
      ...mapMany(
        allegati?.documento_identita,
        "documento_identita.pdf",
        "application/pdf"
      ),
      ...mapMany(
        allegati?.codice_fiscale,
        "codice_fiscale.pdf",
        "application/pdf"
      ),
      ...mapMany(allegati?.firma, "firma.png", "image/png"),
    ];

    const subject = `[Diventa Partner Manager] ${BRAND} – ${ragioneSociale}`;
    const html = `
      <h2>Diventa Partner Manager</h2>
      <p><b>Ragione sociale:</b> ${ragioneSociale}</p>
      <p><b>Indirizzo:</b> ${indirizzo || "-"}</p>
      <p><b>Comune:</b> ${comune || "-"}</p>
      <p><b>CAP:</b> ${cap || "-"}</p>
      <p><b>Telefono:</b> ${telefono || "-"}</p>
      <p><b>Email:</b> ${email || "-"}</p>
      <p><b>IBAN:</b> ${iban || "-"}</p>
      ${
        descrizione
          ? `<p><b>Descrizione attività:</b><br/>${descrizione}</p>`
          : ""
      }
      <hr/>
      <p style="font-size:12px;color:#555">Inviato il ${new Date().toLocaleString(
        "it-IT"
      )}</p>
    `;

    // invio a interni + cliente
    await Promise.all([
      transporter.sendMail({
        from: `"${BRAND}" <${process.env.EMAIL_USER}>`,
        to: ["megliodojo@gmail.com"],
        subject,
        html,
        attachments: atts,
        replyTo: email,
      }),
      transporter.sendMail({
        from: `"${BRAND}" <${process.env.EMAIL_USER}>`,
        to: email,
        subject,
        html,
        attachments: atts,
      }),
    ]);

    return res.json({
      ok: true,
      message: "Email inviata a megliodojo + cliente",
    });
  } catch (err) {
    console.error("Errore /api/diventa-partner-manager:", err);
    return res.status(500).json({
      ok: false,
      message: "Errore invio",
      error: String(err?.message || err),
    });
  }
});

// ================== NUOVI ENDPOINT PER MODULI ==================

const DEFAULTS = {
  VIVI_DEST: ["backoffice@energyplanner.it", "danielverardi29@gmail.com"],
  COMPARATOR_DEST: ["backoffice@energyplanner.it", "danielverardi29@gmail.com"],
  CONTRATTO_DEST: ["backoffice@energyplanner.it", "danielverardi29@gmail.com"],
  SCHEDA_CANTIERE_DEST: [
    "backoffice@energyplanner.it",
    "danielverardi29@gmail.com",
  ],
  FV_BUSINESS_DEST: ["backoffice@energyplanner.it", "jonathanlikaj1@gmail.com"],
};

function getDestFromEnv(key, fallbackArr) {
  const raw = process.env[key];
  if (!raw) return fallbackArr;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : fallbackArr;
}

function registerModuleEndpoint(path, envKey, fallback, subjectPrefix) {
  app.post(path, async (req, res) => {
    try {
      const BRAND = process.env.BRAND_NAME || "Energy Planner";
      const {
        nome,
        email,
        telefono,
        messaggio,
        allegati,
        attachments,
        filename,
        allegato,
      } = req.body || {};

      if (!nome || !email) {
        return res
          .status(400)
          .json({ ok: false, message: "nome ed email sono obbligatori" });
      }

      const atts = normalizeAttachments({
        allegati,
        attachments,
        allegato,
        filename,
      });
      const internalRecipients = getDestFromEnv(envKey, fallback);
      const subject = `[${subjectPrefix}] ${BRAND} – ${nome}`;
      const html = composeHtml({ nome, email, telefono, messaggio });

      await sendToInternalsAndClient({
        toInternals: internalRecipients,
        toClient: email,
        subject,
        html,
        attachments: atts,
        brand: BRAND,
        replyTo: email,
      });

      return res.json({
        ok: true,
        message: `Modulo ${subjectPrefix} inviato a interni + cliente`,
      });
    } catch (err) {
      console.error(`Errore ${path}:`, err);
      return res.status(500).json({
        ok: false,
        message: "Errore invio",
        error: String(err?.message || err),
      });
    }
  });
}

// con /api/send/...
registerModuleEndpoint(
  "/api/send/vivi-energia-easy",
  "VIVI_DEST_TO",
  DEFAULTS.VIVI_DEST,
  "Vivi energia easy"
);
registerModuleEndpoint(
  "/api/send/comparatore-vivi",
  "COMPARATOR_DEST_TO",
  DEFAULTS.COMPARATOR_DEST,
  "Comparatore vivi"
);
registerModuleEndpoint(
  "/api/send/contratto-vendita",
  "CONTRATTO_DEST_TO",
  DEFAULTS.CONTRATTO_DEST,
  "Contratto di vendita"
);
registerModuleEndpoint(
  "/api/send/scheda-cantiere",
  "SCHEDA_CANTIERE_DEST_TO",
  DEFAULTS.SCHEDA_CANTIERE_DEST,
  "Scheda cantiere"
);
registerModuleEndpoint(
  "/api/send/fv-business",
  "FV_BUSINESS_DEST_TO",
  DEFAULTS.FV_BUSINESS_DEST,
  "Progetto FV business"
);

// alias senza /send per evitare 404 quando incolli path brevi
registerModuleEndpoint(
  "/api/vivi-energia-easy",
  "VIVI_DEST_TO",
  DEFAULTS.VIVI_DEST,
  "Vivi energia easy"
);
registerModuleEndpoint(
  "/api/comparatore-vivi",
  "COMPARATOR_DEST_TO",
  DEFAULTS.COMPARATOR_DEST,
  "Comparatore vivi"
);
registerModuleEndpoint(
  "/api/contratto-vendita",
  "CONTRATTO_DEST_TO",
  DEFAULTS.CONTRATTO_DEST,
  "Contratto di vendita"
);
registerModuleEndpoint(
  "/api/scheda-cantiere",
  "SCHEDA_CANTIERE_DEST_TO",
  DEFAULTS.SCHEDA_CANTIERE_DEST,
  "Scheda cantiere"
);
registerModuleEndpoint(
  "/api/fv-business",
  "FV_BUSINESS_DEST_TO",
  DEFAULTS.FV_BUSINESS_DEST,
  "Progetto FV business"
);

// ================== AVVIO SERVER ==================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`✅ Server attivo su http://localhost:${PORT}`)
);
