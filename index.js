require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");

const app = express();
app.use(cors());

// ⬆️ ALZO I LIMITI (prima erano 10mb)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ✅ Trasportatore SMTP comune a tutte le rotte
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// 🎯 Invio principale (info@energyplanner.it)
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

// 🎯 Invio alternativo (backoffice@energyplanner.it)
app.post("/api/sendEmailAlt", async (req, res) => {
  const { nome, email, attachments } = req.body;

  const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

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
        contentType: "application/pdf", // utile per garantire apertura corretta
      })),
    });

    res.status(200).json({ message: "Email inviata" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Errore invio" });
  }
});

// ========= INVIA LA STESSA MAIL A MEGLIODOJO + CLIENTE =========
app.post("/api/sendToClient", async (req, res) => {
  try {
    const BRAND = process.env.BRAND_NAME || "Energy Planner";
    const { nome, email, telefono, messaggio, allegati, filename, allegato } =
      req.body || {};

    if (!nome || !email) {
      return res
        .status(400)
        .json({ message: "nome ed email sono obbligatori" });
    }

    // Normalizza allegati: accetta array [{filename, content(base64)}] o singolo {filename, allegato}
    const rawList = Array.isArray(allegati)
      ? allegati
      : allegati
      ? [allegati]
      : allegato
      ? [{ filename: filename || "documento.pdf", content: allegato }]
      : [];

    const attachments = rawList
      .filter(
        (a) => a && (a.content || a.base64 || a.contentBase64 || a.allegato)
      )
      .map((a) => ({
        filename: a.filename || "allegato.pdf",
        content: Buffer.from(
          a.content || a.base64 || a.contentBase64 || a.allegato,
          "base64"
        ),
        encoding: "base64",
      }));

    // Stesso subject + stesso HTML per entrambi
    const subject = `Richiesta ${BRAND} – ${nome}`;
    const html = `
      <h2>Dettagli richiesta</h2>
      <p><b>Nome:</b> ${nome}</p>
      <p><b>Email:</b> ${email}</p>
      ${telefono ? `<p><b>Telefono:</b> ${telefono}</p>` : ""}
      ${messaggio ? `<p><b>Messaggio:</b><br>${messaggio}</p>` : ""}
      <p><small>${new Date().toLocaleString("it-IT")}</small></p>
    `;

    // Invia la stessa identica mail (contenuti + allegati) a entrambi
    await Promise.all([
      transporter.sendMail({
        from: `"${BRAND}" <${process.env.EMAIL_USER}>`,
        to: "megliodojo@gmail.com",
        subject,
        html,
        attachments,
        replyTo: email, // così rispondendo si contatta direttamente il cliente
      }),
      transporter.sendMail({
        from: `"${BRAND}" <${process.env.EMAIL_USER}>`,
        to: email,
        subject,
        html,
        attachments,
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

// ========= NUOVO: invia SOLO agli interni (niente mail al cliente) =========
app.post("/api/sendToInternalOnly", async (req, res) => {
  try {
    const BRAND = process.env.BRAND_NAME || "Energy Planner";
    const { nome, email, telefono, messaggio, allegati, filename, allegato } =
      req.body || {};

    if (!nome || !email) {
      return res
        .status(400)
        .json({ ok: false, message: "nome ed email sono obbligatori" });
    }

    // normalizza allegati: array [{ filename, base64|content|contentBase64 }] o singolo {filename, allegato}
    const rawList = Array.isArray(allegati)
      ? allegati
      : allegati
      ? [allegati]
      : allegato
      ? [{ filename: filename || "documento.pdf", base64: allegato }]
      : [];

    const attachments = rawList
      .filter((a) => a && (a.base64 || a.content || a.contentBase64))
      .map((a) => ({
        filename: a.filename || "allegato.pdf",
        content: Buffer.from(
          a.base64 || a.content || a.contentBase64,
          "base64"
        ),
        encoding: "base64",
      }));

    // destinatari interni solo per questo flusso
    const internalOnly = (
      process.env.INTERNAL_ONLY_TO ||
      process.env.CUSTOMER_INTERNAL_TO ||
      "megliodojo@gmail.com"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!internalOnly.length) {
      return res
        .status(500)
        .json({ ok: false, message: "Destinatari interni non configurati" });
    }

    await transporter.sendMail({
      from: `"${BRAND}" <${process.env.EMAIL_USER}>`,
      to: internalOnly,
      subject: `Nuova richiesta (solo interni): ${nome}`,
      html: `
        <h2>Nuova richiesta</h2>
        <p><b>Nome:</b> ${nome}</p>
        <p><b>Email cliente:</b> ${email}</p>
        ${telefono ? `<p><b>Telefono:</b> ${telefono}</p>` : ""}
        ${messaggio ? `<p><b>Messaggio:</b><br>${messaggio}</p>` : ""}
        <p><small>${new Date().toLocaleString("it-IT")}</small></p>
      `,
      attachments,
      replyTo: email,
    });

    // nessuna mail al cliente qui
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`✅ Server attivo su http://localhost:${PORT}`)
);
