// src/templates/reminderResponseFlow.ts
import { addKeyword, EVENTS } from '@builderbot/bot';
import type { BotContext, BotMethods } from '@builderbot/bot/dist/types';
import { supabase } from '../services/supabaseService'; // Keep if used elsewhere, otherwise potentially remove
import { findAppointmentById, updateAppointmentStatus, findRelevantAppointmentForResponseByPhone } from '~/services/appointmentService';
import { identifyTenant } from '~/utils/tenantHelper';
import { chatwoot } from '~/app';
import { handleMessage } from '~/services/chatwoot';

const LOG_PREFIX = '[ReminderResponseFlow]';

/**
 * Sends a response message via flowDynamic and logs it to Chatwoot.
 * @param {BotMethods} ctxFn - The context functions object.
 * @param {BotContext} ctx - The current context object.
 * @param {string} message - The message text to send.
 * @param {string} logContext - Context information for logging.
 */
async function sendAndLogResponse(ctxFn: BotMethods, ctx: BotContext, message: string, logContext: string) {
  await ctxFn.flowDynamic(message);
  try {
    // Log outgoing message to Chatwoot
    await handleMessage({
      phone: ctx.from,
      name: 'Bot', // Or retrieve bot name if available
      message,
      mode: "outgoing",
      attachment: []
    }, chatwoot);
    console.log(`${LOG_PREFIX} [${logContext}] Logged outgoing message to Chatwoot for ${ctx.from}.`);
  } catch (error) {
    console.error(`${LOG_PREFIX} [${logContext}] Error logging outgoing message to Chatwoot for ${ctx.from}:`, error);
  }
}

/**
 * NOTA: Este flujo maneja respuestas exactas a recordatorios de citas.
 * Para respuestas en lenguaje natural (como "vale, nos vemos", "perfecto", etc.),
 * el sistema principal de detección de intenciones en intentionFlow.ts ahora
 * maneja automáticamente las confirmaciones cuando hay citas pendientes.
 */
const reminderResponseFlow = addKeyword([
  'Sí, confirmo', 
  'No puedo asistir',
  'Si, confirmo',
  'Confirmo',
  'No puedo',
  'Cancelar cita',
  'Cancelo'
])
  .addAction(async (ctx: BotContext, ctxFn: BotMethods) => {
    const { state, endFlow } = ctxFn;
    const userResponse = ctx.body.toLowerCase().trim();
    const userPhone = ctx.from;

    console.log(`${LOG_PREFIX} Received response: '${ctx.body}' from ${userPhone}`);

    // 1. Identify Tenant
    const tenant = await identifyTenant(ctx);
    if (!tenant) {
      console.error(`${LOG_PREFIX} Tenant not identified for ${userPhone}.`);
      // Avoid sending sensitive error details to the user
      await sendAndLogResponse(ctxFn, ctx, 'Tuvimos un problema procesando tu solicitud. Por favor, contacta con la clínica.', `${LOG_PREFIX} Tenant Error`);
      return endFlow();
    }
    // No need to store tenant in state here unless subsequent steps require it without re-fetching
    const clinicName = tenant.clinicName || 'nuestra clínica';
    console.log(`${LOG_PREFIX} Tenant identified: ${tenant.id} for ${userPhone}`);

    // 2. Find Relevant Appointment (Replaces getting ID from state)
    let appointmentId: number | null = null;
    try {
        // NEW: Look up the appointment based on phone and tenant
        appointmentId = await findRelevantAppointmentForResponseByPhone(userPhone, tenant.id);
        if (!appointmentId) {
            console.warn(`${LOG_PREFIX} No relevant pending/upcoming appointment found for ${userPhone} at tenant ${tenant.id}.`);
            await sendAndLogResponse(ctxFn, ctx, 'No encontramos una cita pendiente reciente para confirmar o cancelar. Si necesitas ayuda, contacta con la clínica.', `${LOG_PREFIX} No Relevant Appt Found`);
            return endFlow();
        }
        console.log(`${LOG_PREFIX} Found relevant appointment ID: ${appointmentId} for ${userPhone}`);

    } catch(error) {
         console.error(`${LOG_PREFIX} Error finding relevant appointment for ${userPhone}:`, error);
         await sendAndLogResponse(ctxFn, ctx, `Hubo un error buscando tu cita. Por favor, intenta de nuevo o contacta a ${clinicName}.`, `${LOG_PREFIX} Find Appt Error`);
         return endFlow();
    }

    // Convert ID to string for service functions that expect it
    const appointmentIdStr = String(appointmentId);

    // 3. Find Full Appointment Details (using the found ID as string)
    const appointment = await findAppointmentById(appointmentIdStr, tenant.id);
    if (!appointment) {
      // This case should be rare if findRelevantAppointmentForResponseByPhone returned an ID, but handle defensively.
      console.error(`${LOG_PREFIX} Appointment details not found for ID ${appointmentIdStr} (Tenant: ${tenant.id}), although ID was returned by lookup.`);
      await sendAndLogResponse(ctxFn, ctx, 'No pudimos encontrar los detalles completos de tu cita encontrada. Por favor, contacta con la clínica.', `${LOG_PREFIX} Appt Details Not Found`);
      return endFlow();
    }
     console.log(`${LOG_PREFIX} Found appointment details for ID: ${appointmentIdStr}`);

    // 4. Process User Response based on the specific appointment found
    try {
      let responseMessage = '';
      
      // FIRST: Check if appointment is already canceled
      if (appointment.status === 'cancelled') {
        if (userResponse.includes('sí') || userResponse.includes('si') || userResponse.includes('confirmo')) {
          // User trying to confirm a canceled appointment
          responseMessage = `Tu cita en ${clinicName} fue cancelada anteriormente. Si quieres reagendar, puedes escribirnos.`;
          await sendAndLogResponse(ctxFn, ctx, responseMessage, `${LOG_PREFIX} Confirm Cancelled Appt`);
        } else if (userResponse.includes('no puedo') || userResponse.includes('cancelo') || userResponse.includes('cancelar')) {
          // User trying to cancel an already canceled appointment
          responseMessage = `Tu cita en ${clinicName} ya estaba cancelada.`;
          await sendAndLogResponse(ctxFn, ctx, responseMessage, `${LOG_PREFIX} Already Cancelled`);
        }
        return endFlow();
      }
      
      // SECOND: Handle confirmation patterns for non-canceled appointments
      if (userResponse.includes('sí') || userResponse.includes('si') || userResponse.includes('confirmo')) {
        if (appointment.status === 'confirmed') {
            responseMessage = `Tu cita en ${clinicName} ya estaba confirmada. ¡Te esperamos!`;
            await sendAndLogResponse(ctxFn, ctx, responseMessage, `${LOG_PREFIX} Already Confirmed`);
        } else {
            // Use string ID
            await updateAppointmentStatus(appointmentIdStr, 'confirmed', tenant.id);
            responseMessage = `✅ ¡Gracias! Tu cita en ${clinicName} ha sido confirmada.`;
            await sendAndLogResponse(ctxFn, ctx, responseMessage, `${LOG_PREFIX} Confirmed`);
        }
      } 
      // THIRD: Handle cancellation patterns for non-canceled appointments
      else if (userResponse.includes('no puedo') || userResponse.includes('cancelo') || userResponse.includes('cancelar')) {
         // Use string ID
         await updateAppointmentStatus(appointmentIdStr, 'cancelled', tenant.id);
         responseMessage = `Tu cita en ${clinicName} ha sido cancelada. Puedes volver a agendar cuando quieras.`;
         await sendAndLogResponse(ctxFn, ctx, responseMessage, `${LOG_PREFIX} Cancelled`);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Error updating appointment status for ID ${appointmentIdStr}:`, error);
      await sendAndLogResponse(ctxFn, ctx, `Hubo un error procesando tu respuesta para la cita. Por favor, contacta a ${clinicName}.`, `${LOG_PREFIX} Update Error`);
      // Decide whether to endFlow() on update error or allow retry
      return endFlow(); // End flow on update error to prevent inconsistent state
    }

    // 5. Cleanup and End Flow (State cleanup might not be needed if nothing crucial was stored)
    // await state.clear(); // Consider if state needs clearing or was used at all
    return endFlow();
  });

export { reminderResponseFlow };