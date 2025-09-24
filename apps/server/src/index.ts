import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, service: "server" }));

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`server listening on :${port}`));
