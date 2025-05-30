import { addKeyword, EVENTS } from "@builderbot/bot";
import aiServices from "~/services/aiServices";
import { config } from "../config";
import { handleMessage } from '~/services/chatwoot';
import { chatwoot } from "~/app";
import { getTenantPrompt } from "~/services/tenantService";

// Simple fallback prompt if database prompt is not available
const fallbackPrompt = `
Actúas como recepcionista virtual de una clínica de fisioterapia. Tu tarea es responder preguntas frecuentes de forma clara, profesional y concisa.

🎯 Normas de respuesta:
- Contesta en **una sola frase**.
- Sé claro, útil y cordial.
- Si conoces el nombre del cliente ([Nombre Cliente]), úsalo para hacer la conversación más personal y amigable.
- Si preguntan por reservas, responde: "Para reservar, puedes escribirnos por WhatsApp."
- Si algo requiere más información, responde: "Llama a la clínica para más detalles."

Responde siempre con una frase breve, fiel a la información y sin inventar. Usa el nombre del cliente cuando esté disponible para hacer la conversación más personal.
`;

export const faqFlow = addKeyword(EVENTS.ACTION)
    .addAction(
        async (ctx, { state, flowDynamic, endFlow }) => {
            try {
                const currentState = await state.getMyState();
                const tenant = currentState?.tenant;
                const clientName = currentState?.clientName;

                if (!tenant || !tenant.id) {
                    console.error("Error en faqFlow: No se encontró tenant en el estado.");
                    const errorMsg = "Lo siento, hubo un problema al recuperar la información de la clínica para responder.";
                    await flowDynamic(errorMsg);
                    // Registrar mensaje de error saliente
                    try {
                        await handleMessage({ phone: ctx.from, name: 'Bot', message: errorMsg, mode: 'outgoing', attachment: [] }, chatwoot);
                    } catch (e) { console.error('[faqFlow Error] Error registrando mensaje en Chatwoot:', e); }
                    console.log(`[FaqFlow Error] Mensaje de error enviado.`);
                    return endFlow();
                }

                // Get prompt from database
                let finalPrompt: string;
                try {
                    const dbPrompt = await getTenantPrompt(tenant.id);
                    if (dbPrompt) {
                        finalPrompt = dbPrompt;
                        console.log(`[faqFlow] Usando prompt personalizado de la base de datos para tenant ${tenant.id}`);
                    } else {
                        finalPrompt = fallbackPrompt;
                        console.log(`[faqFlow] Usando prompt por defecto para tenant ${tenant.id} (no encontrado en BD)`);
                    }
                } catch (error) {
                    console.error(`[faqFlow] Error obteniendo prompt de BD para tenant ${tenant.id}:`, error);
                    finalPrompt = fallbackPrompt;
                }
                
                // Add client name for personalization if available
                if (clientName) {
                    finalPrompt = finalPrompt.replace(/\[Nombre Cliente\]/g, clientName);
                } else {
                    // Remove placeholder if no client name available
                    finalPrompt = finalPrompt.replace(/\[Nombre Cliente\]/g, 'estimado/a cliente');
                }

                console.log(`faqFlow: Enviando consulta a IA para ${tenant.clinicName || 'clínica'}${clientName ? ` (Cliente: ${clientName})` : ''}. Consulta: "${ctx.body}"`);

                const AI = new aiServices(config.apiKey);
                const history = [{ role: "user", content: ctx.body }];
                const response = await AI.chat(finalPrompt, history);
                
                await flowDynamic(response);
                // Registrar respuesta de IA saliente
                try {
                    await handleMessage({ phone: ctx.from, name: 'Bot', message: response, mode: 'outgoing', attachment: [] }, chatwoot);
                } catch (e) { console.error('[faqFlow Success] Error registrando mensaje en Chatwoot:', e); }
                console.log(`[FaqFlow Success] Respuesta de IA enviada.`);

                return endFlow();

            } catch (error) {
                console.error("Error en llamada a GPT en faqFlow:", error);
                const errorMsg = "Lo siento, no pude procesar tu consulta en este momento. Por favor, intenta de nuevo.";
                await flowDynamic(errorMsg);
                // Registrar mensaje de error GPT saliente
                 try {
                    await handleMessage({ phone: ctx.from, name: 'Bot', message: errorMsg, mode: 'outgoing', attachment: [] }, chatwoot);
                } catch (e) { console.error('[faqFlow GPT Error] Error registrando mensaje en Chatwoot:', e); }
                console.log(`[faqFlow GPT Error] Mensaje de error enviado.`);
                return endFlow();
            }
        }
    );
