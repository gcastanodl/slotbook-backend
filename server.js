const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Backend funcionando 🚀");
});

app.post("/login", (req, res) => {
  const { user, password } = req.body;

  if (user === "admin" && password === "1234") {
    return res.json({ role: "admin" });
  }

  if (user === "staff" && password === "1234") {
    return res.json({ role: "staff" });
  }

  res.status(401).json({ error: "Credenciales incorrectas" });
});

app.listen(3000, () => {
  console.log("Servidor corriendo en http://localhost:3000");
});