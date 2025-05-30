import axios from 'axios'; 
import { config } from '~/config';

// Define META_API_VERSION here as it's specific to this logic
const META_API_VERSION = process.env.META_API_VERSION || 'v22.0';

// --- Standalone function to send WhatsApp messages via Meta API --- 
async function sendWhatsAppMessage(phone: string, message: string): Promise<any> {
    try {
        let formattedPhone = phone.replace(/[\s\-()]/g, '');
        if (!formattedPhone.startsWith('+')) {
            formattedPhone = `+${formattedPhone}`;
        }
        const numberId = process.env.META_NUMBER_ID; // Corrected ENV VAR
        const accessToken = process.env.META_JWT_TOKEN; // Corrected ENV VAR

        if (!numberId || !accessToken) {
            throw new Error('Faltan credenciales de WhatsApp (META_NUMBER_ID o META_JWT_TOKEN) en .env');
        }

        const metaApiUrl = `https://graph.facebook.com/${META_API_VERSION}/${numberId}/messages`;
        const metaPayload = {
            messaging_product: 'whatsapp',
            to: formattedPhone,
            type: 'text',
            text: { body: message }
        };

        const response = await axios.post(metaApiUrl, metaPayload, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data;
    } catch (error: any) {
        console.error(`❌ [Webhook Handler] Error al enviar mensaje de agente a WhatsApp (${phone}):`, error.message);
        if (error.response?.data) {
            console.error('   Detalles API Meta:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

// Definir el tipo para el bot global
interface GlobalBot {
    dynamicBlacklist?: {
        data: Set<string>;
        add(phone: string): void;
        remove(phone: string): void;
        checkIf(phone: string): boolean;
    };
    addBlacklist?: (phone: string) => Promise<boolean>;
}

// Extender el objeto global
declare global {
    interface Global {
        bot: GlobalBot;
    }
}

// --- Chatwoot Controller Logic (Exported) ---
// It receives 'bot' from handleCtx
export const chatwootCtrl = async (bot: any, req: any, res: any) => {
    const body = req.body;
    const event = body?.event;


    try {
        // Ensure required bot methods/properties exist (maybe add fallbacks if needed)
        if (!bot.addBlacklist) {
            console.warn('⚠️ [Webhook Handler] bot.addBlacklist no está definido. Implementando un sustituto.');
            bot.addBlacklist = async (phone: string) => {
                if (!bot.dynamicBlacklist) {
                    bot.dynamicBlacklist = {
                        data: new Set<string>(),
                        add(phone: string) { this.data.add(phone); },
                        remove(phone: string) { this.data.delete(phone); },
                        checkIf(phone: string) { return this.data.has(phone); }
                    };
                    
                    // Asignar al ámbito global para compartir con mainFlow
                    global.bot = bot;
                }
                bot.dynamicBlacklist.add(phone);
                return true;
            };
        }
        if (!bot.dynamicBlacklist) {
             console.warn('⚠️ [Webhook Handler] bot.dynamicBlacklist no está definido. Implementando un sustituto.');
             bot.dynamicBlacklist = {
                data: new Set<string>(),
                add(phone: string) { this.data.add(phone); },
                remove(phone: string) { this.data.delete(phone); },
                checkIf(phone: string) { return this.data.has(phone); }
            };
            
            // Asignar al ámbito global para compartir con mainFlow
            global.bot = bot;
        }
        
        // --- Event Handling Logic ---
        if (event === "conversation.created") {
            const mapperAttributes = body?.changed_attributes?.map((a: any) => Object.keys(a)).flat(2);
            if (mapperAttributes?.includes("assignee_id")) {
                const phone = body?.meta?.sender?.phone_number?.replace("+", "");
                const idAssignee = body?.changed_attributes[0]?.assignee_id?.current_value ?? null;
                if (phone && idAssignee) {
                    await bot.addBlacklist(phone);
                } else if (phone && bot.dynamicBlacklist.checkIf(phone) && !idAssignee) {
                    bot.dynamicBlacklist.remove(phone);
                }
            }
        } else if (event === "conversation.updated") {
            // Check for resolved status
            if (body?.status === "resolved") {
                const phone = body?.meta?.sender?.phone_number?.replace("+", "");
                if (phone && bot.dynamicBlacklist.checkIf(phone)) {
                    bot.dynamicBlacklist.remove(phone);
                    // Use fetch as before
                    fetch(`${config.BOT_URL}/v1/flowGracias`, {
                        method: "POST",
                        body: JSON.stringify({ number: phone, name: "Cliente" }),
                        headers: { "Content-Type": "application/json" },
                    }).catch(err => console.error("[Webhook Handler] Error llamando a flowGracias:", err));
                }
            }
            // Check for assignment changes
            const assignmentChange = body?.changed_attributes?.find((attr: any) => attr?.assignee_id !== undefined);
            if (assignmentChange) {
                const phone = body?.meta?.sender?.phone_number?.replace("+", "");
                const idAssignee = assignmentChange?.assignee_id?.current_value ?? null;
                const previousAssignee = assignmentChange?.assignee_id?.previous_value ?? null;
                if (phone && idAssignee && !previousAssignee) {
                    await bot.addBlacklist(phone);
                } else if (phone && !idAssignee && previousAssignee) {
                    bot.dynamicBlacklist.remove(phone);
                }
            }
        } else if (
            event === 'message_created' &&
            body.message_type === 'outgoing' &&
            body.private !== true
        ) {
            // Check if this is a bot-generated message 
            const isBotMessage = 
                body.sender?.name === 'Bot' || 
                body.sender?.type === 'bot' ||
                !body.sender || 
                (body.content && body.content.includes('ClinicAI:')) || // Consider making 'ClinicAI:' configurable
                (body.content && body.content.startsWith('[BOT]'));
            
            if (!isBotMessage) {
                let recipientPhone = body.conversation?.meta?.sender?.phone_number;
                if (!recipientPhone && body.conversation?.meta?.user?.phone_number) {
                    recipientPhone = body.conversation.meta.user.phone_number;
                }
                const messageContent = body.content || '';

                if (recipientPhone && messageContent.trim()) {
                    try {
                        await sendWhatsAppMessage(recipientPhone, messageContent);
                    } catch (error) {
                        console.error(`[Webhook Handler] ❌ Error al enviar mensaje de agente a WhatsApp (${recipientPhone}):`, error);
                    }
                }
            }
        } else if (
            event === 'message_created' &&
            body.private === true // Private note
        ) {
            const messageContent = (body.content || '').trim().toLowerCase();
            const recipientPhone = body.conversation?.meta?.sender?.phone_number?.replace("+", "");
            if (recipientPhone && messageContent) {
                // Check for control commands
                if (messageContent === '/bot off' || messageContent === '/pausar bot') {
                    await bot.addBlacklist(recipientPhone);
                } 
                else if (messageContent === '/bot on' || messageContent === '/activar bot') {
                    bot.dynamicBlacklist.remove(recipientPhone);
                }
            }
        } else if (
            event === "message.created" && // Changed from "message.created" to "message_created" based on previous logs? Double check Chatwoot payload. Assuming "message_created" is correct based on outgoing message handling.
            body.content_type === "input_csat" &&
            body.conversation?.channel.includes("Channel::Api") && // Ensure this check is robust
            body.private === false &&
            body.content?.includes("Por favor califica esta conversacion") &&
            body.conversation?.status === "resolved"
        ) {
            const phone = body.conversation?.meta?.sender?.phone_number?.replace("+", "");
            const content = body?.content ?? "";

            // Replace localhost URLs - ensure config.CHATWOOT_ENDPOINT is correct public URL
            const urlsToReplace = [
                { oldUrl: "https://0.0.0.0", newUrl: config.CHATWOOT_ENDPOINT },
                { oldUrl: "https://127.0.0.1", newUrl: config.CHATWOOT_ENDPOINT },
            ];
            let updatedContent = content;
            urlsToReplace.forEach((urlPair) => {
                // Use regex globally and ignore case for broader matching
                updatedContent = updatedContent.replace(new RegExp(urlPair.oldUrl.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), "gi"), urlPair.newUrl);
            });

            // Use bot.provider.sendMessage for CSAT
            if (phone && bot.provider?.sendMessage) {
                 try {
                     await bot.provider.sendMessage(phone, updatedContent, {});
                 } catch (csatError) {
                     console.error(`[Webhook Handler] ❌ Error enviando CSAT via provider a ${phone}:`, csatError);
                 }
            }

            // Trigger flowGracias if user is not blacklisted
            if (phone && !bot.dynamicBlacklist.checkIf(phone)) {
                 fetch(`${config.BOT_URL}/v1/flowGracias`, {
                    method: "POST",
                    body: JSON.stringify({ number: phone, name: "Cliente" }),
                    headers: { "Content-Type": "application/json" },
                }).catch(err => console.error("[Webhook Handler] Error llamando a flowGracias:", err));
            }
        }

        // Send OK response
        res.statusCode = 200;
        res.end("ok");

    } catch (error) {
        console.error('[Webhook Handler] ❌ Error general en el controlador de Chatwoot:', error);
        res.statusCode = 500;
        res.end("Internal Server Error");
    }
}; 