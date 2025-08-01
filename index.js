// backend/index.js
require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post("/api/sendEmail", async (req, res) => {
  const { nome, email, allegato, filename } = req.body;

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
      to: "info@energyplanner.it",
      subject: `Nuova candidatura da ${nome}`,
      html: `
        <p>Nome: ${nome}</p>
        <p>Email: ${email}</p>
        <p>Data: ${new Date().toLocaleString("it-IT")}</p>
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server avviato su http://localhost:${PORT}`));
