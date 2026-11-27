# Citti ($CITTI) — Pabal self-run agent

Node 20 / Express server implementing Pabal's documented contract:
- `GET /health` returns `{ "ok": true, "broker": "..." }`.
- `POST /execute` hashes the exact raw request body and verifies Pabal's signature.
- `pabal.ping` returns HTTP 200 `{ "ok": true }` without side effects.
- `assistant.chat` returns Citti's assistant reply.
- No wallet private key, seed phrase, or user-fund custody is used.

## Environment
Required:
- `PABAL_BROKER_ADDRESS`: exact public broker signer address published by Pabal.
- `PORT`: hosting port (defaults to 3000).

Optional:
- `OPENAI_API_KEY`: enables full AI responses. Without it, Citti returns a setup message.
- `OPENAI_MODEL`: defaults to `gpt-4.1-mini`.

## Local test
```bash
cp .env.example .env
# Set PABAL_BROKER_ADDRESS in .env
npm install
npm start
```
Check `GET /health`. Deploy to an always-on public HTTPS host with a stable hostname; no sleeping/ephemeral URLs.

## Pabal
Set the Pabal server endpoint to the origin (no path, query or fragment). The service exposes `/health` and `/execute`.
Declare `assistant.chat` as the action and `persona` as the category. Custody is `no`.
