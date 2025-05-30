import { addKeyword, EVENTS } from '@builderbot/bot';
import { registerFlow } from './registerFlow';
import { getClientByPhone } from '~/services/clientService';
import { DetectIntention } from './intentionFlow';
import { identifyTenant } from '../utils/tenantHelper';
// Importar Supabase (si no está ya disponible globalmente)
import { createClient } from '@supabase/supabase-js'; // Comentado si getSupabase no se usa aquí directamente
import { MemoryDB as TmpDB } from '@builderbot/bot';
import { chatwoot } from '~/app'; // Importar instancia de chatwoot
import { handleMessage } from '~/services/chatwoot'; // Importar handleMessage

/**
 * Flow principal: bienvenida, identificación de tenant/cliente y derivación.
 */
const mainFlow = addKeyword(EVENTS.WELCOME)
    .addAction({ capture: false }, async (ctx, { flowDynamic, state, gotoFlow, endFlow }) => {
        // 1. Blacklist Check
        if (ctx.from && global.bot && global.bot.dynamicBlacklist?.checkIf?.(ctx.from)) {
            console.log(`🛑 [mainFlow] Usuario ${ctx.from} en blacklist.`);
            return endFlow();
        }

        // 2. Tenant Identification
        let tenant;
        try {
            tenant = await identifyTenant(ctx);
            if (!tenant) {
                console.warn(`[mainFlow] No se encontró tenant para ${ctx.from}. No se puede continuar.`);
                return endFlow(); // Termina si no hay tenant
            }
        
            // Guardamos tenant en estado INMEDIATAMENTE
            await state.update({ tenant });

        } catch (error) {
            console.error(`[mainFlow] Error crítico identificando tenant para ${ctx.from}:`, error);
            await flowDynamic("Tuvimos un problema inicial al verificar la configuración. Por favor, intenta de nuevo más tarde.");
            return endFlow();
        }

        // 3. Log Initial Incoming Message to Chatwoot (Moved earlier, before client check)
        let chatwootConversationId: number | null = null;
        try {
            chatwootConversationId = await handleMessage(
                {
                    phone: ctx.from,
                    name: ctx.pushName || 'Usuario WhatsApp',
                    message: ctx.body, // Log the WELCOME trigger message
                    mode: 'incoming',
                    attachment: ctx.message?.attachment || []
                },
                chatwoot
            );
            if (chatwootConversationId) {
                await state.update({ chatwoot_conversation_id: chatwootConversationId });
    
            } else {
                console.warn(`[mainFlow] handleMessage (inicial) no devolvió ID de conversación para ${ctx.from}.`);
            }
        } catch (err) {
            console.error(`[mainFlow] ERROR Chatwoot al registrar mensaje inicial (${ctx.from}):`, err);
            // No terminamos el flujo por error de Chatwoot, pero lo logueamos.
        }

        // 4. Client Check (using the identified tenant)
        try {
            const client = await getClientByPhone(ctx.from, tenant.id);

            if (client) {
                // --- Existing Client ---
                // Store client information for personalization
                await state.update({ 
                    clientName: client.name,
                    clientEmail: client.email,
                    isExistingClient: true 
                });
                
                // Go directly to intention detection without greeting
                return gotoFlow(DetectIntention);

            } else {
                // --- New Client ---
                await flowDynamic(`Bienvenido/a a ${tenant.clinicName}. Parece que es tu primera vez aquí.`);
                return gotoFlow(registerFlow); // Redirigir a flujo de registro
            }
        } catch (error: any) {
            console.error(`[mainFlow] Error buscando/manejando cliente (${ctx.from}):`, error.message);
            await flowDynamic('Lo siento, tuvimos un problema verificando tu información. Por favor, intenta de nuevo.');
            return endFlow(); // Terminar flujo en caso de error crítico buscando cliente
        }
    });

export { mainFlow };