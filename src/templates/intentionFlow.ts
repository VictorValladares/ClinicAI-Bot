import { addKeyword, EVENTS } from '@builderbot/bot';
import path from "path";
import fs from "fs";
import { faqFlow } from "./faqFlow";
import { citaFlow } from "./citaFlow";
import aiServices from '~/services/aiServices';
import { config } from "../config";
import { chatwoot } from '~/app';
import { handleMessage } from '~/services/chatwoot';
import { findRelevantAppointmentForResponseByPhone, updateAppointmentStatus, findAppointmentById } from '~/services/appointmentService';
import { identifyTenant } from '../utils/tenantHelper';

export const DetectIntention = addKeyword(EVENTS.ACTION)
    .addAction(async (ctx, { state, gotoFlow, endFlow, flowDynamic }) => {
        // Verificamos si el usuario está en blacklist antes de procesar
        if (ctx.from && global.bot && global.bot.dynamicBlacklist?.checkIf?.(ctx.from)) {
            console.log(`🛑 [DetectIntention] Usuario ${ctx.from} en blacklist. Ignorando mensaje.`);
            return endFlow();
        }

        try {
            const currentState = await state.getMyState();
            const tenant = currentState?.tenant;
            const history = currentState?.history || [];
            const clientName = currentState?.clientName;
            const name = clientName || ctx.pushName || "Usuario";

            if (!tenant) {
                console.error("[DetectIntention] Error: No se encontró tenant en el estado.");
                const errorMsg = "Hubo un problema recuperando la configuración.";
                try {
                    await handleMessage({ phone: ctx.from, name: 'Bot', message: errorMsg, mode: 'outgoing', attachment: [] }, chatwoot);
                } catch (e) { console.error('[DetectIntention Tenant Error] Error registrando mensaje en Chatwoot:', e); }
                return endFlow(errorMsg);
            }

            // NUEVO: Verificar si hay una cita pendiente de confirmación antes de procesar otras intenciones
            try {
                const relevantAppointmentId = await findRelevantAppointmentForResponseByPhone(ctx.from, tenant.id);
                if (relevantAppointmentId) {
                    console.log(`[DetectIntention] Found relevant appointment ${relevantAppointmentId} for ${ctx.from}. Checking for confirmation intent.`);
                    
                    // Get appointment details first to check current status
                    const appointmentIdStr = String(relevantAppointmentId);
                    const appointment = await findAppointmentById(appointmentIdStr, tenant.id);
                    
                    if (!appointment) {
                        console.warn(`[DetectIntention] Appointment ${appointmentIdStr} not found, continuing with normal flow.`);
                    } else {
                        // Usar IA para detectar si el mensaje es una confirmación de cita
                        const confirmationPrompt = `Analiza el siguiente mensaje y determina si el usuario está confirmando o aceptando una cita médica.
                        
Responde únicamente con:
- "CONFIRMAR" si el mensaje indica confirmación, aceptación o acuerdo (ej: "sí", "vale", "perfecto", "nos vemos", "confirmo", "de acuerdo", "ok", "está bien")
- "CANCELAR" si el mensaje indica cancelación o rechazo (ej: "no puedo", "cancelo", "no podré", "tengo que cancelar")
- "OTRO" si el mensaje no está relacionado con confirmar/cancelar una cita

Mensaje del usuario: "${ctx.body}"`;

                        const AI = new aiServices(config.apiKey);
                        const confirmationIntent = await AI.chat(confirmationPrompt, []);
                        
                        if (confirmationIntent === "CONFIRMAR") {
                            // Check if appointment is already canceled
                            if (appointment.status === 'cancelled') {
                                const cancelledConfirmMsg = `Tu cita en ${tenant.clinicName} fue cancelada anteriormente. Si quieres reagendar, puedes escribirnos.`;
                                await flowDynamic(cancelledConfirmMsg);
                                try {
                                    await handleMessage({ phone: ctx.from, name: 'Bot', message: cancelledConfirmMsg, mode: 'outgoing', attachment: [] }, chatwoot);
                                } catch (e) { console.error('[DetectIntention Cancelled Confirm] Error registrando mensaje en Chatwoot:', e); }
                                return endFlow();
                            }
                            // Confirmar la cita si no está cancelada
                            else if (appointment.status !== 'confirmed') {
                                await updateAppointmentStatus(appointmentIdStr, 'confirmed', tenant.id);
                                const confirmMsg = `✅ ¡Gracias! Tu cita en ${tenant.clinicName} ha sido confirmada.`;
                                await flowDynamic(confirmMsg);
                                try {
                                    await handleMessage({ phone: ctx.from, name: 'Bot', message: confirmMsg, mode: 'outgoing', attachment: [] }, chatwoot);
                                } catch (e) { console.error('[DetectIntention Confirmation] Error registrando mensaje en Chatwoot:', e); }
                                return endFlow();
                            } else {
                                const alreadyConfirmedMsg = `Tu cita en ${tenant.clinicName} ya estaba confirmada. ¡Te esperamos!`;
                                await flowDynamic(alreadyConfirmedMsg);
                                try {
                                    await handleMessage({ phone: ctx.from, name: 'Bot', message: alreadyConfirmedMsg, mode: 'outgoing', attachment: [] }, chatwoot);
                                } catch (e) { console.error('[DetectIntention Already Confirmed] Error registrando mensaje en Chatwoot:', e); }
                                return endFlow();
                            }
                        } else if (confirmationIntent === "CANCELAR") {
                            // Check if appointment is already canceled
                            if (appointment.status === 'cancelled') {
                                const alreadyCancelledMsg = `Tu cita en ${tenant.clinicName} ya estaba cancelada.`;
                                await flowDynamic(alreadyCancelledMsg);
                                try {
                                    await handleMessage({ phone: ctx.from, name: 'Bot', message: alreadyCancelledMsg, mode: 'outgoing', attachment: [] }, chatwoot);
                                } catch (e) { console.error('[DetectIntention Already Cancelled] Error registrando mensaje en Chatwoot:', e); }
                                return endFlow();
                            }
                            // Cancelar la cita si no está cancelada
                            else {
                                await updateAppointmentStatus(appointmentIdStr, 'cancelled', tenant.id);
                                const cancelMsg = `Tu cita en ${tenant.clinicName} ha sido cancelada. Puedes volver a agendar cuando quieras.`;
                                await flowDynamic(cancelMsg);
                                try {
                                    await handleMessage({ phone: ctx.from, name: 'Bot', message: cancelMsg, mode: 'outgoing', attachment: [] }, chatwoot);
                                } catch (e) { console.error('[DetectIntention Cancellation] Error registrando mensaje en Chatwoot:', e); }
                                return endFlow();
                            }
                        }
                        // Si es "OTRO", continúa con la detección normal de intenciones
                    }
                }
            } catch (error) {
                console.error("[DetectIntention] Error checking for appointment confirmation:", error);
                // Continúa con la detección normal de intenciones si hay error
            }

            // Agregar el mensaje del usuario al historial
            history.push({ role: "user", content: ctx.body });
            await state.update({ history });

            // Cargar el prompt para la detección de intención
            const pathIntentionPrompt = path.join(process.cwd(), "assets/Prompts", "prompt_Detection.txt");
            let intentionPrompt = fs.readFileSync(pathIntentionPrompt, "utf-8")
                .replace('[Nombre Clínica]', tenant.clinicName);

            // Add client context for better intention detection
            if (clientName) {
                intentionPrompt += `\n\nContexto adicional: El cliente se llama ${clientName} y ya está registrado en el sistema.`;
            }

            // Detectar la intención usando el servicio de IA
            const AI = new aiServices(config.apiKey);
            const intention = await AI.chat(intentionPrompt, history);

            // Dirigir al flujo correspondiente según la intención
            switch (intention) {
                case "CITA":
                    return gotoFlow(citaFlow);
                case "FAQ":
                    return gotoFlow(faqFlow);
                default: {
                    const intentos = currentState?.intentos || 0;
                    if (intentos >= 3) {
                        const limitMsg = "Parece que no logro entenderte. Si necesitas ayuda, por favor contacta directamente con la clínica.";
                        try {
                            await handleMessage({ phone: ctx.from, name: 'Bot', message: limitMsg, mode: 'outgoing', attachment: [] }, chatwoot);
                        } catch (e) { console.error('[DetectIntention Limit] Error registrando mensaje en Chatwoot:', e); }
                        return endFlow(limitMsg);
                    }
                    await state.update({ intentos: intentos + 1 });
                    const fallbackMsg = clientName 
                        ? `${clientName}, no entiendo tu mensaje, por favor intenta de nuevo`
                        : "No entiendo tu mensaje, por favor intenta de nuevo";
                    await flowDynamic(fallbackMsg);
                    try {
                        await handleMessage({ phone: ctx.from, name: 'Bot', message: fallbackMsg, mode: 'outgoing', attachment: [] }, chatwoot);
                    } catch (e) { console.error('[DetectIntention Fallback] Error registrando mensaje en Chatwoot:', e); }
                    return;
                }
            }
        } catch (err) {
            console.error("[DetectIntention] Error:", err);
            const errorMsg = "Lo siento, ocurrió un error interno.";
            try {
                await handleMessage({ phone: ctx.from, name: 'Bot', message: errorMsg, mode: 'outgoing', attachment: [] }, chatwoot);
            } catch (e) { console.error('[DetectIntention Catch Error] Error registrando mensaje en Chatwoot:', e); }
            return endFlow(errorMsg);
        }
    });