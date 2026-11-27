const express = require("express");
const crypto = require("node:crypto");
const { ethers } = require("ethers");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BROKER_ADDRESS = String(process.env.PABAL_BROKER_ADDRESS || "").toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

if (!ethers.isAddress(BROKER_ADDRESS)) {
  throw new Error("Set PABAL_BROKER_ADDRESS to Pabal's published broker address.");
}

function verifyPabalRequest({ headers, rawBody, agentId, brokerAddress, toleranceSec = 300 }) {
  const get = (n) => headers[n] ?? headers[Object.keys(headers).find(k => k.toLowerCase() === n)];
  const keyId = get("x-pabal-key-id");
  const timestamp = Number(get("x-pabal-timestamp"));
  const signature = get("x-pabal-signature");
  if (!keyId || !signature || !Number.isSafeInteger(timestamp)) return { ok: false, reason: "missing_signature_headers" };
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSec) return { ok: false, reason: "timestamp_out_of_range" };
  if (String(brokerAddress).toLowerCase() !== String(keyId).toLowerCase()) return { ok: false, reason: "unknown_key_id" };
  const bodyHash = crypto.createHash("sha256").update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8")).digest("hex");
  const payload = `${String(keyId).toLowerCase()}\n${timestamp}\n${Number(agentId)}\n${bodyHash}`;
  let signer;
  try { signer = ethers.verifyMessage(payload, signature); } catch { return { ok: false, reason: "bad_signature" }; }
  if (signer.toLowerCase() !== String(keyId).toLowerCase()) return { ok: false, reason: "signer_mismatch" };
  return { ok: true, signer };
}

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, broker: BROKER_ADDRESS });
});

// Verify the exact raw request bytes BEFORE parsing JSON.
app.post("/execute", express.raw({ type: "*/*", limit: "256kb" }), async (req, res) => {
  const rawBody = req.body || Buffer.alloc(0);

  // Extract only the signed agentId scalar without JSON.parse, so signature
  // verification happens against the untouched raw bytes before parsing.
  const rawText = rawBody.toString("utf8");
  const idMatch = rawText.match(/"agentId"\\s*:\\s*(\\d+)/);
  const agentId = idMatch ? Number(idMatch[1]) : NaN;
  if (!Number.isSafeInteger(agentId) || agentId < 1) return res.status(400).json({ error: "invalid_agent_id" });

  const verified = verifyPabalRequest({
    headers: req.headers, rawBody, agentId, brokerAddress: BROKER_ADDRESS
  });
  if (!verified.ok) return res.status(401).json({ error: "unauthorized", reason: verified.reason });

  let body;
  try { body = JSON.parse(rawText); }
  catch { return res.status(400).json({ error: "invalid_json" }); }

  const action = body?.request?.action;
  if (action === "pabal.ping") return res.status(200).json({ ok: true });
  if (action !== "assistant.chat") return res.status(400).json({ error: "unsupported_action" });

  const message = typeof body?.request?.params?.message === "string"
    ? body.request.params.message.trim() : "";
  if (!message) return res.status(400).json({ error: "message_required" });

  try {
    const reply = await generateReply(message);
    return res.status(200).json({ ok: true, reply });
  } catch (err) {
    console.error("assistant.chat failed:", err.message);
    return res.status(502).json({ error: "assistant_unavailable" });
  }
});

async function generateReply(message) {
  if (!OPENAI_API_KEY) {
    return "Hi, I'm Citti, your personal assistant. I received your message, but my AI provider is not configured yet. Please ask the agent owner to finish the AI setup.";
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: "You are Citti, a helpful personal assistant. Be clear, friendly, practical, and honest. Never claim to have taken actions you have not taken." },
        { role: "user", content: message }
      ],
      temperature: 0.6,
      max_tokens: 500
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
  const data = await response.json();
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) throw new Error("AI provider returned an empty response");
  return reply.trim();
}

app.listen(PORT, "0.0.0.0", () => console.log(`Citti listening on ${PORT}`));
