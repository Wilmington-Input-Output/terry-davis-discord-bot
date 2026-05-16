# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start` — runs the bot via `tsx bot.ts` (no build step; TypeScript is executed directly by tsx).
- `npm ci` — install dependencies (used by deploy workflow).

There is no test suite, no linter, and no separate build command. Type checking happens implicitly via `tsx`; to type-check explicitly, run `npx tsc --noEmit`.

## Runtime requirements

- Node.js 20 (matches `.github/workflows/deploy.yml`).
- `.env` must define `TOKEN` (Discord bot token) and `HOME_CHANNEL_ID`. `dotenv-safe` validates against `.env.example` at startup — adding a new env var requires updating both `.env` and `.env.example` or the process will exit.

## Deployment

`master` triggers `.github/workflows/deploy.yml` on a **self-hosted runner**, which `npm ci`s, rewrites `.env` from GitHub secrets, then `pm2 restart terry-davis-discord-bot`. The bot is expected to be already registered with pm2 under that name on the runner host; the workflow does not create the pm2 entry.

Note: the workflow currently writes `HOME_CHANNEL_ID=${{ secrets.TOKEN }}` (same secret for both env vars). The bot ignores `HOME_CHANNEL_ID` in code anyway — see "Hardcoded channel ID" below.

## Architecture

Single-process Discord client (`bot.ts`) wired to discord.js v14 with these intents: Guilds, GuildMessages, MessageContent, GuildMembers, GuildMessageReactions. Two background `CronJob`s run alongside the event handlers in the same process — there is no separate scheduler or queue.

- **`bot.ts`** — entry point. Registers the `ClientReady`, `MessageCreate`, `Error`, and `ShardError` handlers, then schedules two crons:
  - `0 29 18 * * 2,4,6` — Tue/Thu/Sat at 18:29 server time. Picks a 50/50 random branch between `sendMultipleChoiceQuestion` and `sendOpenEndedQuestion`.
  - `0 0 12 * * 0` — Sunday at 12:00 server time. Posts the static "buymeacoffee" support message.
  - Cron times use the server's local TZ (the comments say CST but no TZ is passed to `CronJob`). If you need a specific zone, pass `timeZone` as the 5th `CronJob` arg.
- **`engagement/`** — runtime behavior that posts engagement prompts:
  - `multipleChoice.ts` — posts a question with 🇦/🇧/🇨/🇩 reaction options, attaches a 48-hour `ReactionCollector`, and on the **second unique reactor** sends a follow-up asking why they chose that answer. Uses a module-level `lastEngagementIndices` array to avoid repeating questions until all have been used; this state is **in-memory only** and resets on bot restart.
  - `openEnded.ts` — picks a question and 50/50 either posts plain or tags 3 random non-bot guild members via `getRandomMembers`.
- **`messages/`** — pure data modules: `replies.ts` (Terry Davis quotes for `!terry` and startup), `engagement.ts` (multiple-choice Q&A pairs), `openEndedEngagement.ts` (open-ended question strings). Adding content = adding to these arrays; no other wiring is needed.
- **`utils/`** — `channels.ts` exports the `isGuildTextChannel` type guard used before any `send` call that needs a `TextChannel`-shaped channel; `members.ts` exports `getRandomMembers` which calls `guild.members.fetch()` (requires the `GuildMembers` intent — already enabled).

## Message commands and reactions

Defined inline in the `MessageCreate` handler in `bot.ts`:

- `!terry` → random Terry Davis quote.
- `!meetup` → posts the meetup URL.
- `!test` → triggers the engagement cron branch immediately, **owner-gated** by hardcoded Discord user ID `185862369174487040`. When adding similar debug commands, gate them the same way.
- Any message matching `/\bCIA\b/i` gets a 👀 reaction.
- Reactions on specific user IDs (`1032407444523077712` → 🇫🇷, two IDs → 🇦🇱). User IDs are hardcoded — search for them when changing membership.

## Hardcoded channel ID

`MAIN_CHANNEL_ID = "862860519900053533"` is hardcoded in `bot.ts` and used by both the ready handler and both cron jobs. The `HOME_CHANNEL_ID` env var exists in `.env.example` but is **not read** by any code. Either route is fine — just be aware the env var is a vestige today.

## Conventions specific to this repo

- New randomness should use `crypto.randomInt` (already used in `engagement/` and `utils/members.ts`) rather than `Math.random`, except where 50/50 boolean coin flips already use `Math.random < 0.5`.
- Imports use no `.ts` extension; tsx resolves them. `tsconfig.json` is `module: commonjs` / `target: es2016` / `strict: true`.
- The codebase's existing style mixes semicolons and indentation conventions inconsistently. Follow the user's global CLAUDE.md rules (no semicolons, 80-char lines, mandatory curly braces, early returns) for new code rather than mirroring legacy files.
