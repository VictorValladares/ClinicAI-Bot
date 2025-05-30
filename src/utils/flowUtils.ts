import { BotContext, BotMethods } from '@builderbot/bot/dist/types';
import { handleMessage } from '~/services/chatwoot'; // Importar handleMessage
import { ChatwootClass } from '~/services/chatwoot/chatwoot.class'; // Importar tipo ChatwootClass

// Definir una interfaz para el estado que incluya chatwoot_conversation_id opcionalmente
interface StateWithChatwoot {
    chatwoot_conversation_id?: number;
    [key: string]: any; 
}

/**
 * Envía uno o más mensajes usando flowDynamic y registra el mensaje saliente en Chatwoot.
 * @param ctxFn Contexto de funciones del bot (incluye flowDynamic, state, etc.)
 * @param ctx Contexto del mensaje (para obtener ctx.from)
 * @param chatwoot Instancia de ChatwootClass
 * @param message Mensaje o array de mensajes a enviar.
 * @param options Opciones adicionales para flowDynamic (ej. botones), aplicadas solo al último mensaje si es un array.
 */
export async function sendSimple( 
    ctxFn: BotMethods, 
    ctx: BotContext,
    chatwoot: ChatwootClass, // Añadir instancia de chatwoot
    message: string | string[], 
    options?: any
) {
    const messagesToSend = Array.isArray(message) ? message : [message];
    
    try {
        for (const msg of messagesToSend) {
            // Determinar si aplicar opciones (solo al último mensaje del array o si es un único mensaje)
            const currentOptions = (messagesToSend.length === 1 || messagesToSend.indexOf(msg) === messagesToSend.length - 1) ? options : undefined;
            
            // 1. Enviar el mensaje al usuario
            await ctxFn.flowDynamic(msg, currentOptions);
            await new Promise(resolve => setTimeout(resolve, 150)); // Pequeño delay opcional

            // 2. Registrar el mensaje saliente en Chatwoot
            try {
                const currentState = await ctxFn.state.getMyState() as StateWithChatwoot;
                const conversationId = currentState?.chatwoot_conversation_id;
                
                if (conversationId && chatwoot) {
                    await handleMessage(
                        {
                            phone: ctx.from, // Número del destinatario
                            name: 'Bot', // Nombre para el bot en Chatwoot
                            message: msg,
                            mode: 'outgoing',
                            attachment: [] // Asumimos que no hay adjuntos aquí, ajustar si es necesario
                        },
                        chatwoot
                    );
                    // console.log(`[sendSimple] Mensaje saliente registrado en Chatwoot (Conv ID: ${conversationId}).`); // Log opcional
                } else if (!chatwoot) {
                    console.warn('[sendSimple] Advertencia: No se proporcionó instancia de chatwoot. No se registró el mensaje saliente.');
                } else {
                    // console.warn('[sendSimple] Advertencia: No se encontró chatwoot_conversation_id en el estado. No se registró el mensaje saliente.'); // Log opcional
                }
            } catch (chatwootError) {
                console.error('[sendSimple] Error al registrar mensaje saliente en Chatwoot:', chatwootError);
            }
            
            // Delay adicional si se envían múltiples mensajes
            if (messagesToSend.length > 1 && messagesToSend.indexOf(msg) < messagesToSend.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 300)); // Delay entre mensajes
            }
        }
    } catch (sendError) { 
        console.error(`[sendSimple] Error enviando mensaje vía flowDynamic:`, sendError); 
    }
} 