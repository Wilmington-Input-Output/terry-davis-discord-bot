# Fastify HTTP Server + Discord Bot Consolidation Implementation Plan

## Overview

Wrap the existing Discord bot in a Fastify HTTP server so that `npm start` boots Fastify, which in turn logs the Discord client in. Reorganize all discord-bot code (`bot.ts`, `engagement/`, `messages/`, `utils/`) into a single `discordBot/` folder. Add a `PORT` env var. Wire SIGINT/SIGTERM handlers so that an HTTP shutdown also tears down the Discord client and cron jobs cleanly.

## Current State Analysis

- Entry point is `bot.ts` at repo root. It loads `dotenv-safe`, builds a `discord.js` `Client`, registers event handlers, schedules two `CronJob`s inside `ClientReady`, and calls `client.login(token)` as the final top-level statement.
- `bot.ts` imports from three sibling folders:
  - `./messages/replies` — used in `bot.ts:4`
  - `./utils/channels` — used in `bot.ts:5`
  - `./engagement/openEnded` — used in `bot.ts:6`
  - `./engagement/multipleChoice` — used in `bot.ts:7`
- Cross-folder imports inside the bot directories use `../` (e.g., `engagement/multipleChoice.ts:2` → `../messages/engagement`, `engagement/openEnded.ts:2-3` → `../messages/openEndedEngagement` and `../utils/members`).
- `package.json`: `main: "bot.ts"`, `scripts.start: "tsx bot.ts"`, no Fastify dependency, dependencies include `cron`, `discord.js`, `dotenv-safe`, `typescript`.
- `.env.example` declares `TOKEN`, `HOME_CHANNEL_ID`, `BANK_TOKEN`. `HOME_CHANNEL_ID` is unused in code (a `MAIN_CHANNEL_ID` constant is hardcoded in `bot.ts:13`).
- `dotenv-safe` is configured with `example: './.env.example'`, so the example file is the source of truth for required env vars — adding a key to the example **without** adding it to `.env` will crash startup.
- The two `CronJob` instances are created inside the `ClientReady` handler and never assigned to variables, so there is currently no way to call `.stop()` on them.
- `tsconfig.json` is `module: commonjs`, `target: es2016`, `strict: true`, `esModuleInterop: true`. Imports use no file extensions; `tsx` resolves them.
- Deployment is via `.github/workflows/deploy.yml` → self-hosted runner → `pm2 restart terry-davis-discord-bot`. The pm2 process is expected to exist on the host and will pick up the new entry automatically as long as `npm start` is what pm2 runs.

### Key Discoveries:
- `dotenv-safe` must be configured before any `process.env.*` read; today that happens at the top of `bot.ts:9-11`. After the move, that initialization must happen in the new entry file (`server.ts`) before the discord module is imported and before Fastify reads `PORT`.
- `discord.js` `Client` exposes `client.destroy()` (returns `Promise<void>`) which logs out, terminates the WebSocket, and clears caches — the right call for clean shutdown.
- `cron`'s `CronJob` instance exposes `.stop()` to halt scheduled firings.
- Fastify's `app.close()` runs registered `onClose` hooks; this gives a single clean integration point for tearing down the bot when the server is shut down.

## Desired End State

After this plan:

- `npm start` runs `tsx server.ts`.
- `server.ts` is the only top-level entry. It loads dotenv-safe, creates a Fastify instance, registers an `onClose` hook that shuts the Discord bot down, calls `app.listen({ port: Number(process.env.PORT) })`, and only then triggers `startDiscordBot()`.
- All Discord-related source lives under `discordBot/`:
  - `discordBot/index.ts` (formerly `bot.ts`) — exports `startDiscordBot()` and `stopDiscordBot()`; no top-level side effects.
  - `discordBot/engagement/multipleChoice.ts`
  - `discordBot/engagement/openEnded.ts`
  - `discordBot/messages/replies.ts`
  - `discordBot/messages/engagement.ts`
  - `discordBot/messages/openEndedEngagement.ts`
  - `discordBot/utils/channels.ts`
  - `discordBot/utils/members.ts`
- The repo root no longer contains `bot.ts`, `engagement/`, `messages/`, or `utils/`.
- `.env.example` includes a `PORT=` line.
- A `SIGINT`/`SIGTERM` handler triggers `app.close()`, which via `onClose` calls `stopDiscordBot()`, which stops both `CronJob`s and calls `client.destroy()`, then the process exits normally.
- No HTTP routes are registered.

### Verification:
- `npm start` boots, logs Fastify listening on `PORT`, then logs "Bot is online!".
- Sending `SIGINT` (Ctrl-C) produces an orderly shutdown: Fastify close → cron stop → Discord destroy → process exits with code 0, no unhandled rejections.
- No code outside `discordBot/` imports from `engagement/`, `messages/`, or `utils/`.

## What We're NOT Doing

- Not adding any HTTP routes, plugins, or schemas to Fastify. The instance is created and listened on; nothing else.
- Not changing the cron schedules, message content, reaction behavior, or any business logic in `engagement/` or `messages/`.
- Not adding tests — the repo has none and the user did not ask for them.
- Not changing the deploy workflow, the pm2 process name, or anything in `.github/workflows/deploy.yml`. Since `npm start` continues to be the boot command and `main` is updated, pm2 needs no changes.
- Not removing or renaming `HOME_CHANNEL_ID` or `BANK_TOKEN` from `.env.example` even though they are currently unused — outside the scope of this change.
- Not switching from `tsx` to a compiled build step.
- Not adding logging frameworks; keep using `console.log`/`console.error` for parity with the existing code.

## Implementation Approach

Four phases, ordered so the repo stays runnable between phases where possible. Phase 1 reorganizes files without behavior change. Phase 2 refactors the bot module to expose start/stop instead of running at import time. Phase 3 introduces the Fastify server and wires it as the entry. Phase 4 wires shutdown handlers and verifies the cleanup path end-to-end.

Phases 1 and 2 cannot be split — moving `bot.ts` into `discordBot/index.ts` and refactoring its top-level side effects to a `startDiscordBot()` function happen together, otherwise the repo is in a broken state mid-phase. They're presented as two phases for clarity of intent but should be implemented as one commit.

---

## Phase 1: Consolidate Discord code into `discordBot/`

### Overview

Move all four current bot-related folders/files into `discordBot/` and update internal imports. This is a pure file move with import-path fixups — no behavior changes.

### Changes Required:

#### 1. Move files

New paths:

```
discordBot/index.ts                                (from bot.ts)
discordBot/engagement/multipleChoice.ts            (from engagement/multipleChoice.ts)
discordBot/engagement/openEnded.ts                 (from engagement/openEnded.ts)
discordBot/messages/replies.ts                     (from messages/replies.ts)
discordBot/messages/engagement.ts                  (from messages/engagement.ts)
discordBot/messages/openEndedEngagement.ts         (from messages/openEndedEngagement.ts)
discordBot/utils/channels.ts                       (from utils/channels.ts)
discordBot/utils/members.ts                        (from utils/members.ts)
```

Use `git mv` so history is preserved. After the move, the directories `engagement/`, `messages/`, and `utils/` at the repo root must not exist.

#### 2. Update imports inside `discordBot/index.ts`

**File**: `discordBot/index.ts`
**Changes**: Imports stay relative — same `./` paths work because the file moved together with its siblings.

```ts
import { replies } from './messages/replies'
import { isGuildTextChannel } from './utils/channels'
import { sendOpenEndedQuestion } from './engagement/openEnded'
import { sendMultipleChoiceQuestion } from './engagement/multipleChoice'
```

These four lines need no change once the files are co-located — verify after move.

#### 3. Verify cross-folder imports inside subfolders

**File**: `discordBot/engagement/multipleChoice.ts`
**Changes**: `../messages/engagement` import remains correct since both folders moved together.

**File**: `discordBot/engagement/openEnded.ts`
**Changes**: `../messages/openEndedEngagement` and `../utils/members` imports remain correct.

#### 4. Update `package.json` `main` field

**File**: `package.json`
**Changes**: Point `main` at the new location for now — phase 3 will repoint to `server.ts`.

```json
"main": "discordBot/index.ts",
```

#### 5. Update `start` script (interim)

**File**: `package.json`
**Changes**: Temporarily point `start` at `discordBot/index.ts` so the repo remains runnable at end of phase 1. Phase 3 swaps this to `server.ts`.

```json
"scripts": {
  "start": "tsx discordBot/index.ts"
}
```

### Success Criteria:

#### Automated Verification:
- [ ] `npx tsc --noEmit` runs with zero errors.
- [ ] No file under repo root other than inside `discordBot/`, `node_modules/`, `.github/`, `.git/`, and `thoughts/` references `engagement/`, `messages/`, or `utils/` paths: `grep -rn "from '\.\./\(engagement\|messages\|utils\)\|from '\./\(engagement\|messages\|utils\)" --include='*.ts' .` returns only matches inside `discordBot/`.
- [ ] `engagement/`, `messages/`, `utils/`, and `bot.ts` no longer exist at repo root: `ls bot.ts engagement messages utils 2>&1` shows "No such file or directory" for each.

#### Manual Verification:
- [ ] `npm start` still boots the bot and sends a Terry Davis quote to `MAIN_CHANNEL_ID` on connect.

**Implementation Note**: After this phase, pause for human confirmation that the bot still boots and posts to Discord before proceeding to phase 2.

---

## Phase 2: Convert `discordBot/index.ts` into a start/stop module

### Overview

`discordBot/index.ts` currently runs side effects at import time (creates the `Client`, registers handlers, schedules cron jobs, calls `client.login`). Replace those top-level side effects with two exported functions: `startDiscordBot()` and `stopDiscordBot()`. Hold references to `client` and both `CronJob`s in module scope so `stopDiscordBot()` can shut them down. Move the `dotenv-safe` config call out of this module — the entry point (still `discordBot/index.ts` at this phase's end, becoming `server.ts` in phase 3) is responsible for it.

### Changes Required:

#### 1. Refactor `discordBot/index.ts`

**File**: `discordBot/index.ts`
**Changes**:
- Remove the top-level `dotenv.config(...)` call entirely (entry point handles it).
- Remove top-level `client.login(token)`.
- Wrap the `Client` construction, all `client.on(...)` registrations, both `CronJob` schedulings, and the login call inside `export async function startDiscordBot()`.
- Hold `client` and the two `CronJob` instances in module-scope `let` variables so they can be torn down by `stopDiscordBot`.
- Add `export async function stopDiscordBot()` that calls `.stop()` on each `CronJob` (if defined) and `await client.destroy()` (if defined), then clears the module-scope references.
- Keep the existing helper functions (`getRandomReply`, `containsCIA`) as they are.

Sketch:

```ts
import { CronJob } from 'cron'
import { Client, Events, IntentsBitField } from 'discord.js'
import { replies } from './messages/replies'
import { isGuildTextChannel } from './utils/channels'
import { sendOpenEndedQuestion } from './engagement/openEnded'
import { sendMultipleChoiceQuestion } from './engagement/multipleChoice'

const MAIN_CHANNEL_ID = '862860519900053533'

let client: Client | undefined
let engagementCron: CronJob | undefined
let supportCron: CronJob | undefined

function getRandomReply(): string {
  const randomIndex = Math.floor(Math.random() * replies.length)
  return replies[randomIndex]
}

function containsCIA(str: string): boolean {
  return /\bCIA\b/i.test(str)
}

export async function startDiscordBot(): Promise<void> {
  const token = process.env.TOKEN

  if (!token) {
    throw new Error('TOKEN env var is required to start the Discord bot')
  }

  client = new Client({
    intents: [
      IntentsBitField.Flags.Guilds,
      IntentsBitField.Flags.GuildMessages,
      IntentsBitField.Flags.MessageContent,
      IntentsBitField.Flags.GuildMembers,
      IntentsBitField.Flags.GuildMessageReactions,
    ],
  })

  client.once(Events.ClientReady, async () => {
    console.log('Bot is online!')
    // ...existing ready-handler body unchanged, but assign cron jobs:
    engagementCron = new CronJob(/* same args */)
    supportCron = new CronJob(/* same args */)
  })

  client.on(Events.Error, /* existing */)
  client.on(Events.ShardError, /* existing */)
  client.on(Events.MessageCreate, /* existing */)

  await client.login(token)
}

export async function stopDiscordBot(): Promise<void> {
  engagementCron?.stop()
  supportCron?.stop()
  engagementCron = undefined
  supportCron = undefined

  if (client) {
    await client.destroy()
    client = undefined
  }
}
```

Important detail: the two `CronJob`s are constructed inside the `ClientReady` handler, so they only exist after Discord login completes. `stopDiscordBot` calling `.stop()` on `undefined` cron refs (e.g., during a shutdown that happens before ready fires) is handled by the optional-chaining `?.stop()`.

### Success Criteria:

#### Automated Verification:
- [ ] `npx tsc --noEmit` runs with zero errors.
- [ ] `grep -n "client.login\|dotenv.config" discordBot/index.ts` returns one match for `client.login` (now inside `startDiscordBot`) and zero matches for `dotenv.config`.
- [ ] `grep -n "^export " discordBot/index.ts` shows both `startDiscordBot` and `stopDiscordBot` exports.

#### Manual Verification:
- [ ] Phase 2 is intentionally not independently bootable — `npm start` will fail because dotenv-safe is no longer loaded by `discordBot/index.ts` and nothing calls `startDiscordBot()`. This is expected; verify only that `tsc --noEmit` passes. Booting is restored in phase 3.

**Implementation Note**: Combine phases 1 and 2 into a single commit to avoid landing an unbootable intermediate state on disk.

---

## Phase 3: Add Fastify entry point

### Overview

Create `server.ts` at the repo root as the new top-level entry. It loads `dotenv-safe`, creates a Fastify instance, reads `PORT` from env, starts listening, then calls `startDiscordBot()`. Add `PORT` to `.env.example`. Update `package.json` to install Fastify, set `main` to `server.ts`, and point `start` at it.

### Changes Required:

#### 1. Install Fastify

**File**: `package.json` (and `package-lock.json` via npm)
**Changes**: Run `npm install fastify`. Locked version will land in `package-lock.json`. No `@types/fastify` is needed — Fastify ships its own types.

#### 2. Update `package.json` `main` and `start`

**File**: `package.json`
**Changes**:

```json
{
  "main": "server.ts",
  "scripts": {
    "start": "tsx server.ts"
  }
}
```

#### 3. Add `PORT` to `.env.example`

**File**: `.env.example`
**Changes**: Append a `PORT` entry. Because `dotenv-safe` validates `.env` against `.env.example`, **`.env` must also gain a `PORT` value** or startup will fail with a `MissingEnvVarsError`. The deployment workflow (`.github/workflows/deploy.yml`) writes `.env` from secrets and will need a corresponding `PORT` secret or hardcoded line — this is called out in the manual verification step.

```
TOKEN=""
HOME_CHANNEL_ID="862860519900053533"
BANK_TOKEN=""
PORT="3000"
```

#### 4. Create `server.ts`

**File**: `server.ts` (new)
**Changes**:
- Configure `dotenv-safe` first (must happen before any module reads `process.env`).
- Build a Fastify instance with default logger off (parity with current `console.log` style) or with logger on — pick logger on for visibility into the listen call. Keep no plugins, no routes.
- Read `PORT` from env, coerce to `Number`. Fail fast if NaN.
- Register an `onClose` hook that awaits `stopDiscordBot()`.
- `await app.listen({ port, host: '0.0.0.0' })`.
- After listen resolves, `await startDiscordBot()`.

Sketch:

```ts
import dotenv from 'dotenv-safe'

dotenv.config({
  example: './.env.example',
})

import Fastify from 'fastify'
import { startDiscordBot, stopDiscordBot } from './discordBot'

const port = Number(process.env.PORT)

if (!Number.isFinite(port)) {
  throw new Error(
    `PORT env var must be a number, got: ${process.env.PORT}`,
  )
}

const app = Fastify({ logger: true })

app.addHook('onClose', async () => {
  await stopDiscordBot()
})

async function main(): Promise<void> {
  await app.listen({ port, host: '0.0.0.0' })
  await startDiscordBot()
}

main().catch(async (err) => {
  console.error('Fatal startup error', err)

  try {
    await stopDiscordBot()
  } catch (stopErr) {
    console.error(
      'Error stopping Discord bot after startup failure',
      stopErr,
    )
  }

  process.exit(1)
})
```

Note the `import` of `Fastify` comes **after** `dotenv.config(...)` so that any future env-driven Fastify config still sees populated `process.env`. The `discordBot` import is also below the dotenv call because the module reads `process.env.TOKEN` inside `startDiscordBot()` — keeping the ordering consistent avoids future surprises if module-top reads are added.

**Why `stopDiscordBot()` in the catch block:** `main()` can reject *after* `startDiscordBot()` has partially or fully run — e.g., a post-login throw, an error inside the `ClientReady` handler, or a thrown follow-on step added later. Without an explicit teardown, the Discord WebSocket and any scheduled crons stay alive until `process.exit(1)` hard-kills the process, which logs the bot out abruptly (no clean `client.destroy()` handshake) and can leave the bot appearing online in Discord for a beat. Calling `stopDiscordBot()` first lets `client.destroy()` do an orderly logout. The call is safe even when `main()` rejected before the client was constructed — `stopDiscordBot` uses `?.stop()` on the cron refs and `if (client)` around `client.destroy()`. We do **not** call `app.close()` in this path because `process.exit(1)` is about to terminate the socket anyway, and routing through `app.close()` → `onClose` → `stopDiscordBot()` would just add an indirection on the failure path.

### Success Criteria:

#### Automated Verification:
- [ ] `npm install fastify` completes without errors.
- [ ] `npx tsc --noEmit` runs with zero errors.
- [ ] `grep -n '"start"' package.json` shows `"start": "tsx server.ts"`.
- [ ] `grep -n PORT .env.example` shows the new line.
- [ ] `grep -n "stopDiscordBot" server.ts` shows at least two references — one in the `onClose` hook and one in the `main().catch(...)` block.

#### Manual Verification:
- [ ] `PORT=3000 npm start` (with a valid `.env`) boots, Fastify logs `Server listening at http://0.0.0.0:3000`, and the bot logs `Bot is online!` shortly after.
- [ ] `curl http://localhost:3000/` returns a 404 (Fastify default for an unregistered route) — confirms server is up; no routes is intentional.
- [ ] Startup-failure path: temporarily set `TOKEN=""` in `.env` to force `startDiscordBot()` to throw. Run `npm start` — expect the `Fatal startup error` log, the `Error stopping Discord bot after startup failure` log to be **absent** (no client was ever constructed, so `stopDiscordBot` runs cleanly), and the process to exit with code 1 (`echo $status` in fish).
- [ ] `.env` on disk has been updated to include `PORT=` or `npm start` will fail with `MissingEnvVarsError` from dotenv-safe.
- [ ] Document for deploy: `.github/workflows/deploy.yml` writes `.env` from secrets; before next deploy, either add a `PORT` secret + line to the workflow or accept that deploys will fail until that is done. (This is intentionally out of scope for the code change but must be flagged.)

**Implementation Note**: After this phase, pause for human confirmation that the server boots locally, the bot connects, and Discord behavior is unchanged.

---

## Phase 4: Wire SIGINT/SIGTERM to graceful shutdown

### Overview

Add `process.on('SIGINT', ...)` and `process.on('SIGTERM', ...)` handlers in `server.ts` that call `app.close()`, which fires the `onClose` hook from phase 3, which tears down crons and the Discord client. Ensure the handler is idempotent and that the process exits with code 0 on a clean shutdown.

### Changes Required:

#### 1. Add signal handlers in `server.ts`

**File**: `server.ts`
**Changes**: After `main()` is launched, register SIGINT and SIGTERM handlers. Guard against multiple signals firing the same shutdown twice.

```ts
let shuttingDown = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  console.log(`Received ${signal}, shutting down`)

  try {
    await app.close()
    process.exit(0)
  } catch (err) {
    console.error('Error during shutdown', err)
    process.exit(1)
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
```

Why `app.close()` and not call `stopDiscordBot()` directly: routing through Fastify's `onClose` keeps a single shutdown integration point and means any future Fastify plugins that register their own `onClose` hooks also get cleaned up.

### Success Criteria:

#### Automated Verification:
- [ ] `npx tsc --noEmit` runs with zero errors.
- [ ] `grep -n "process.on('SIG" server.ts` shows both SIGINT and SIGTERM handlers registered.

#### Manual Verification:
- [ ] Start the server (`npm start`), wait for "Bot is online!", press Ctrl-C. Output should show in order: `Received SIGINT, shutting down`, Fastify close logs, no unhandled rejection warnings, process exits with code 0 (confirm via `echo $status` in fish).
- [ ] Send `kill -TERM <pid>` to a running instance — same orderly shutdown.
- [ ] Send a second Ctrl-C during shutdown — second signal is ignored (idempotent), no double-destroy crash.
- [ ] After shutdown, the Discord bot shows offline in Discord (cron jobs stopped, websocket destroyed).

**Implementation Note**: This is the final phase. Combine into a single commit with phase 3 if convenient — they're tightly coupled (phase 3 introduces the hook, phase 4 invokes it).

---

## Testing Strategy

No automated test suite exists in this repo; the user did not ask for tests. Verification is via:

- `npx tsc --noEmit` after each phase to catch type errors.
- Manual local boot per phase.
- Manual shutdown smoke test after phase 4.

### Manual Testing Steps (final state):

1. Ensure `.env` has `TOKEN`, `HOME_CHANNEL_ID`, `BANK_TOKEN`, and `PORT` set.
2. Run `npm start`. Expect Fastify listening log, then `Bot is online!`, then a Terry Davis quote in the home Discord channel.
3. `curl localhost:$PORT/` — expect Fastify's default 404 JSON.
4. Trigger `!terry` in Discord — expect a quote reply.
5. Trigger `!test` from the owner Discord account — expect an engagement question.
6. Ctrl-C the process — expect orderly shutdown logs and exit code 0.

## Performance Considerations

Fastify with no routes adds negligible overhead (~10MB RSS and one event-loop listener). The HTTP server runs on a dedicated port and shares the event loop with the Discord client, which is fine for the current scale (single guild, low traffic).

## Migration Notes

- **Deploy workflow**: `.github/workflows/deploy.yml` writes `.env` from `secrets.TOKEN` for both `TOKEN` and `HOME_CHANNEL_ID`. After this change, the workflow must also write `PORT` (either from a new secret or as a hardcoded line) or pm2 restarts will fail with `MissingEnvVarsError`. Recommend: add `echo "PORT=3000" >> .env` to the workflow, since the port is not a secret. This workflow update is out of scope for this plan and must be done as a follow-up before the next deploy.
- **pm2**: The pm2 process `terry-davis-discord-bot` runs `npm start`. Because `npm start` continues to be the entry contract, pm2 needs no reconfiguration. The process will now hold an HTTP listener on `PORT` — make sure the chosen port is free on the host.
- **Firewall**: If the host has a firewall (ufw, iptables, security group), inbound on `PORT` does not need to be open since no routes exist yet; this becomes relevant when routes are added.

## References

- Current entry point: `bot.ts:1-132`
- Hardcoded channel ID: `bot.ts:13`
- Cron schedules: `bot.ts:44-65` (engagement Tue/Thu/Sat) and `bot.ts:67-83` (support Sun)
- dotenv-safe config: `bot.ts:9-11`
- Engagement modules: `engagement/multipleChoice.ts`, `engagement/openEnded.ts`
- Message data: `messages/replies.ts`, `messages/engagement.ts`, `messages/openEndedEngagement.ts`
- Utility modules: `utils/channels.ts`, `utils/members.ts`
- Deploy workflow: `.github/workflows/deploy.yml`
- Codebase overview: `CLAUDE.md`
