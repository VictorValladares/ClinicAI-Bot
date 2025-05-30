import { createBot, createProvider, createFlow, addKeyword, utils } from '@builderbot/bot'
import { MemoryDB as Database } from '@builderbot/bot'
import { provider } from './provider'
import templates from './templates'
import { ChatwootClass } from './services/chatwoot/chatwoot.class'
import { chatwootCtrl } from './services/chatwoot/webhook.handler'
import cron from 'node-cron'
import { checkAndSendReminders } from './services/recordatorios/reminder.service'
import { supabase } from './services/supabaseService'
import { config } from './config'
import aiServices from './services/aiServices'


const PORT = process.env.PORT ?? 3008
export const chatwoot = new ChatwootClass({
    account: process.env.CHATWOOT_ACCOUNT_ID || 'YOUR_ACCOUNT_ID',
    token: process.env.CHATWOOT_TOKEN || 'YOUR_API_TOKEN',
    endpoint: process.env.CHATWOOT_ENDPOINT || 'YOUR_CHATWOOT_URL'
})

const main = async () => {

    const botInstance = await createBot({
        flow: templates,
        provider: provider,
        database: new Database(),
    })

    const { handleCtx, httpServer } = botInstance
    const botProvider = botInstance.provider

    if (!botProvider || !httpServer) {
        console.error("🔴 Critical Error: Could not access provider or httpServer from bot instance.")
        return
    }

    if (!botProvider.server?.post) {
        console.error("🔴 Critical Error: Provider's server object does not support .post() method.")
        console.error("   Please check the provider implementation (", botProvider.constructor.name, ").")
        return
    }

    botProvider.server.post("/chatwoot", handleCtx(chatwootCtrl))
    console.log(`🔌 Chatwoot Webhook route /chatwoot registered on provider server.`)

    cron.schedule('00 8 * * *', () => {
        console.log('⏰ Ejecutando tarea programada de recordatorios (8:00 servidor)...');
        checkAndSendReminders(provider, supabase);
      }, {
        scheduled: true,
        timezone: "Europe/Madrid"
      });

    httpServer(+PORT)

    console.log(`🤖 Bot and HTTP Server started on port ${PORT}`)
}

main()
