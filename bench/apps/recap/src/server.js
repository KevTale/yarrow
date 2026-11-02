import "./env.js";
import express from "express";
import { modelFromEnv } from "./llm.js";
import { recap } from "./recap.js";
import { page } from "./views.js";

const model = modelFromEnv();
const app = express();
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(express.json({ limit: "100kb" }));

app.get("/", (_req, res) => res.send(page({ model: model.name })));

app.post("/", async (req, res) => {
  const notes = req.body.notes ?? "";
  try {
    res.send(page({ model: model.name, notes, result: await recap(notes, model) }));
  } catch (error) {
    res.status(400).send(page({ model: model.name, notes, error: error.message }));
  }
});

// The same, for scripts: POST {"notes": "..."}.
app.post("/api/recap", async (req, res) => {
  try {
    res.json(await recap(req.body?.notes ?? "", model));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Recap on http://localhost:${port} (model: ${model.name})`));
