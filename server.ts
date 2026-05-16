import dotenv from 'dotenv-safe'

dotenv.config({
  example: './.env.example',
})

import Fastify from 'fastify'
import {
  startDiscordBot,
  stopDiscordBot,
} from './discordBot'

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
