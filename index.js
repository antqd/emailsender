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
      attachments: attachments.map((a) => ({
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


const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`✅ Server attivo su http://localhost:${PORT}`)
);
