# Telegram Setup (Ben)

Telegram is FirstKnock's primary delivery channel: daily digests, instant hot pings, and simple commands. Total setup time: about 10 minutes. Do this before Phase 3.

## Step 1 — Create the bot

1. In Telegram, open a chat with **@BotFather** (verify the blue check; there are fakes).
2. Send `/newbot`.
3. Name: `FirstKnock` (display name, can have spaces).
4. Username: something like `firstknock_bot` (must end in `bot`; if taken, `firstknock_leads_bot`).
5. BotFather replies with the **bot token** (looks like `1234567890:AAH...`). Treat it like a password.

Make a second bot the same way for development (`firstknock_dev_bot`) so testing never pings real clients. Two tokens: `TELEGRAM_BOT_TOKEN` (prod, Railway) and dev (local `.env`).

## Step 2 — Sanity-test the token

Message your bot `/start` once (bots cannot message you first), then:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

Find `"chat":{"id":123456789,...}` in the response. That number is your personal chat_id. Send yourself a test:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -d chat_id=123456789 -d text="FirstKnock bot is alive"
```

If that message arrives, Telegram is done as infrastructure. Everything else is code.

## Step 3 — How the app wires it (this is what your agent codes in Phase 3)

- Worker runs a **grammY** bot in long-polling mode. ONE worker instance only: two pollers on one token throw 409 errors and fight forever.
- **Tenant connect flow:** the app's settings page shows a button linking to `https://t.me/<bot_username>?start=<connect_code>` where `connect_code` is a short-lived random code tied to the tenant. The bot's `/start` handler reads the payload, looks up the code, and stores that `chat.id` on the tenant row. Connection done, no typing.
- **Group chats** (Paul wants pings in his ops group): add the bot to the group, then someone sends `/connect <code>` in the group. Same lookup, stores the group's chat_id. Note: group ids are negative numbers; store as text. If group commands don't reach the bot, disable privacy mode: BotFather → `/setprivacy` → Disable.
- **Digest send:** worker job renders top-N leads as one message (score, address, one-line why, deep link into the app) and sends to the stored chat_id at the tenant's hour. Respect Telegram limits: max ~4096 chars per message, split if longer; no more than ~30 messages/second total (we will never get close).
- **Hot pings:** same send path, fired by the scoring job when a lead crosses the tenant threshold.
- **Commands to implement:** `/start <code>` (connect), `/leads` (today's top 5), `/pause 7d` (mute digests, vacation), `/help`.

## Step 4 — Handoff to clients

Clients never see BotFather or tokens. Their entire experience: click "Connect Telegram" in settings, tap Start in Telegram, done. If a client later asks "can it go to our team group chat," the answer is yes: add bot to group, `/connect <code>`.

## Gotchas learned the hard way

- 409 Conflict errors mean two processes are polling the same token. Kill one. This WILL happen the first time you run local dev while Railway is deployed: use the dev bot token locally, always.
- `getUpdates` returns nothing after a webhook was ever set: run `deleteWebhook` once if polling seems dead.
- Never log tokens, and never commit `.env`. If a token leaks, BotFather → `/revoke` issues a new one instantly.
