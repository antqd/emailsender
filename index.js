require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
        contentType: "application/pdf" // utile per garantire apertura corretta
      })),
    });

    res.status(200).json({ message: "Email inviata" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Errore invio" });
  }
});

// ========= NUOVO ENDPOINT: invia a interni megliodojo@gmail.com + ricevuta all'utente =========
app.post("/api/sendToClient", async (req, res) => {
  try {
    const BRAND = process.env.BRAND_NAME || "Energy Planner";
    const { nome, email, telefono, messaggio, allegati, filename, allegato } = req.body || {};

    if (!nome || !email) {
      return res.status(400).json({ message: "nome ed email sono obbligatori" });
    }

    // normalizza allegati: accetta array [{filename, content(base64)}] o singolo {filename, allegato}
    const rawList = Array.isArray(allegati)
      ? allegati
      : allegati
      ? [allegati]
      : allegato
      ? [{ filename: filename || "documento.pdf", content: allegato }]
      : [];

    const attachments = rawList
      .filter(a => a && (a.content || a.base64 || a.contentBase64 || a.allegato))
      .map(a => ({
        filename: a.filename || "allegato.pdf",
        content: Buffer.from((a.content || a.base64 || a.contentBase64 || a.allegato), "base64"),
        encoding: "base64",
      }));

    // 1) mail agli interni (fisso: megliodojo@gmail.com) + allegati
    const internalMail = {
      from: `"${BRAND}" <${process.env.EMAIL_USER}>`,
      to: "megliodojo@gmail.com",
      subject: `Richiesta cliente: ${nome}`,
      html: `
        <h2>Nuova richiesta cliente</h2>
        <p><b>Nome:</b> ${nome}</p>
        <p><b>Email:</b> ${email}</p>
        ${telefono ? `<p><b>Telefono:</b> ${telefono}</p>` : ""}
        ${messaggio ? `<p><b>Messaggio:</b><br>${messaggio}</p>` : ""}
        <p><small>${new Date().toLocaleString("it-IT")}</small></p>
      `,
      attachments,
      replyTo: email, // rispondendo dall'interno rispondi al cliente
    };

    // 2) ricevuta al cliente (senza allegati per default)
    const clientMail = {
      from: `"${BRAND}" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Conferma ricezione – ${BRAND}`,
      html: `
        <p>Ciao ${nome},</p>
        <p>abbiamo ricevuto la tua richiesta e ti risponderemo al più presto.</p>
        ${messaggio ? `<p><i>Messaggio inviato:</i><br>${messaggio}</p>` : ""}
        <p>— Team ${BRAND}</p>
      `,
      // Se vuoi rimandare anche gli allegati al cliente, decommenta:
      // attachments,
    };

    await Promise.all([
      transporter.sendMail(internalMail),
      transporter.sendMail(clientMail),
    ]);

    res.json({ ok: true, message: "Invio completato (interni + ricevuta cliente)" });
  } catch (err) {
    console.error("Errore invio /api/sendToClient:", err);
    res.status(500).json({ ok: false, message: "Errore invio", error: String(err?.message || err) });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`✅ Server attivo su http://localhost:${PORT}`)
);
