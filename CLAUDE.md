# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start` — runs the whole app via `tsx server.ts` (no build step; TypeScript is executed directly by tsx).
- `npm ci` — install dependencies (used by the deploy workflow).

There is no test suite, no linter, and no separate build command. Type checking happens implicitly via `tsx`; to type-check explicitly, run `npx tsc --noEmit`.

## Runtime requirements

- Node.js 20 (matches `.github/workflows/deploy.yml`).
- `dotenv-safe` validates `process.env` against `.env.example` at startup — if any var listed in `.env.example` is missing from `.env`, the process exits. Adding a new env var requires updating **both** `.env` and `.env.example`.
- Required env vars: `TOKEN` (Discord bot token), `HOME_CHANNEL_ID` (the one Discord channel everything posts to), `BANK_WEBHOOK_SECRET`, `BANK_TOKEN`, `BANK_ACCOUNT_ID` (Mercury), `DONATE_WEBHOOK_SECRET` (Buy Me a Coffee), and `PORT` (Fastify listen port; `server.ts` throws if it is not a finite number).

## Deployment

Pushing to `master` triggers `.github/workflows/deploy.yml` on a **self-hosted runner**, which `npm ci`s, rewrites `.env` from GitHub secrets, then `pm2 restart terry-davis-discord-bot`. The bot must already be registered with pm2 under that name on the runner host; the workflow does not create the pm2 entry.

The workflow hardcodes `HOME_CHANNEL_ID=862860519900053533` (not a secret) and pulls everything else from secrets. The workflow has a duplicate `BANK_TOKEN` line — harmless but worth knowing.

## Architecture

Single Node process. **`server.ts` is the entry point**: it boots a Fastify HTTP server that hosts the donation/bank webhooks AND starts the Discord bot in the same process. There is no separate scheduler, queue, or web server — the two crons run as timers inside the Discord client lifecycle.

Startup order (`server.ts` `main()`): register `bankWebhook` → register `donateWebhook` → `app.listen` → `startDiscordBot()`. `SIGINT`/`SIGTERM` trigger a graceful shutdown that calls `app.close()`, whose `onClose` hook calls `stopDiscordBot()`. Note: Fastify is created with `logger: false`, so `request.log.*` calls in the webhook handlers are no-ops in practice.

### `discordBot/` — the Discord client and engagement behavior

- **`index.ts`** — owns the client lifecycle as module-level singletons (`client`, `engagementCron`, `supportCron`) and exports `startDiscordBot()`, `stopDiscordBot()`, and `getClient()`. `getClient()` is the seam other modules (e.g. `announce.ts`) use to post messages. Intents: Guilds, GuildMessages, MessageContent, GuildMembers, GuildMessageReactions. Registers `ClientReady`, `MessageCreate`, `GuildMemberAdd`, `Error`, `ShardError` handlers, then schedules two crons inside `ClientReady`:
  - `0 29 18 * * 2,4,6` — Tue/Thu/Sat at 18:29 server-local time. 50/50 coin flip between `sendOpenEndedQuestion` and `sendMultipleChoiceQuestion`.
  - `0 0 12 * * 0` — Sunday at 12:00 server-local time. Posts the static Buy Me a Coffee support message.
  - Cron times use the server's local TZ (no `timeZone` arg is passed to `CronJob`). Pass `timeZone` as the 5th `CronJob` arg if a specific zone is needed.
  - The startup "bot is online" reply to the home channel is intentionally **commented out** — don't re-enable it without reason.
  - A `GuildMemberAdd` handler posts a welcome message (mentioning the new member) to `HOME_CHANNEL_ID` when a non-bot user joins. Built via the shared `buildWelcomeMessage(userId)` helper; relies on the already-enabled `GuildMembers` intent.
- **`announce.ts`** — pure formatting + posting layer for webhook-driven messages. Exports `announceBankTransaction` and `announceDonation`, which format a message (org name is `Wilmington Input Output`) and post it to `HOME_CHANNEL_ID` via `getClient()`. If the client isn't ready or the channel isn't sendable, it logs a warning and silently skips — it never throws into the webhook handler.
- **`engagement/`** — posts engagement prompts:
  - `multipleChoice.ts` — posts a question with 🇦/🇧/🇨/🇩 reactions, attaches a 48-hour `ReactionCollector`, and on the **second unique reactor** sends a follow-up asking why they chose that answer, then stops the collector. A module-level `lastEngagementIndices` array avoids repeating questions until all have been used; this state is **in-memory only** and resets on restart.
  - `openEnded.ts` — picks a question and 50/50 either posts plain or tags 3 random non-bot guild members via `getRandomMembers`.
- **`messages/`** — pure data modules: `replies.ts` (Terry Davis quotes for `!terry`), `engagement.ts` (multiple-choice Q&A pairs), `openEndedEngagement.ts` (open-ended question strings). Adding content = appending to these arrays; no other wiring needed.
- **`utils/`** — `channels.ts` exports the `isGuildTextChannel` type guard used before any `send` that needs a `TextChannel`-shaped channel; `members.ts` exports `getRandomMembers`, which calls `guild.members.fetch()` (requires the `GuildMembers` intent — enabled).

### `webhooks/` — inbound HTTP webhooks (Fastify plugins)

Each subdir is a `FastifyPluginAsync` (default export) plus a `verifySignature.ts`. Both plugins independently register `fastify-raw-body` (`field: 'rawBody'`, `global: false`, `runFirst: true`, `encoding: 'utf8'`) and set `config: { rawBody: true }` on their route — the raw body is required for HMAC verification. Each plugin **throws at registration time** if its secret env var is missing. On a bad/missing signature the handler returns `reply.callNotFound()` (404); otherwise it returns `{ ok: true }`. Announcements are fired with `void announce…().catch(…)` so the HTTP response is never blocked on Discord.

- **`bank/`** — `POST /webhooks/bank`, Mercury bank events. Header `mercury-signature` in `timestamp=…,signature=…` form; HMAC-SHA256 over `` `${timestamp}.${rawBody}` `` with a 5-minute timestamp-drift check, compared with `crypto.timingSafeEqual`. Only acts on `resourceType === 'transaction'` + `operationType === 'create'` with status `pending`/`sent` and a numeric amount; then fetches full transaction details from Mercury (`lib/bank.ts`) and **drops the event unless `tx.accountId === BANK_ACCOUNT_ID`**. `resolveCounterpartyName` maps internal transfers and a known alias set to the literal name `"Zac"`.
- **`donate/`** — `POST /webhooks/donate`, Buy Me a Coffee events. Header `x-signature-sha256`; HMAC-SHA256 over the raw body, compared with `crypto.timingSafeEqual`. Handles `donation.created`, `recurring_donation.started`, and `membership.started`; any other type is acknowledged and ignored. Amounts are formatted with `Intl.NumberFormat` (falls back to `$x.xx`).

### `lib/`

- **`bank.ts`** — `getTransactionDetails(resourceId)` GETs the Mercury transaction API with `BANK_TOKEN` as a bearer token (via `axios`). Used by the bank webhook to resolve account/counterparty before announcing.

## Discord message commands and reactions

Defined inline in the `MessageCreate` handler in `discordBot/index.ts`:

- `!terry` → random Terry Davis quote.
- `!meetup` → posts `https://wilmingtonio.org/`.
- `!test` → triggers the engagement cron branch immediately, **owner-gated** by hardcoded Discord user ID `185862369174487040`. Gate similar debug commands the same way.
- `!testwelcome` → posts the new-member welcome message (mentioning the sender) for manual verification without waiting for a real join, **owner-gated** by the same user ID.
- Any message matching `/\bCIA\b/i` gets a 👀 reaction.
- Message from user `1032407444523077712` → 🇫🇷 reaction.
- Message from user `193846431004622848` or `314929056422297602` → 🇦🇱 reaction.

User IDs are hardcoded — search for the literal ID when changing membership.

## Conventions specific to this repo

- New randomness should use `crypto.randomInt` (already used in `engagement/` and `utils/members.ts`) rather than `Math.random`, except where 50/50 boolean coin flips already use `Math.random() < 0.5`.
- Imports use no `.ts` extension; tsx resolves them. `tsconfig.json` is `module: commonjs` / `target: es2016` / `strict: true`.
- The codebase mixes semicolon/indentation conventions: the older `discordBot/engagement`, `discordBot/utils`, and `lib` files use semicolons and 4-space indent; the newer `server.ts`, `webhooks/`, and `discordBot/announce.ts` follow the user's global CLAUDE.md style (no semicolons, 2-space, 80-char lines, mandatory curly braces, early returns). Follow the global style for new code rather than mirroring the legacy files.
