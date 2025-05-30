// confirmationFlow.ts
import { addKeyword, EVENTS } from '@builderbot/bot';
// Actualizar las importaciones para usar servicios correctos
import { getClientByPhone } from '~/services/clientService';
import { createAppointment, findAppointmentById, updateAppointmentStatus } from '~/services/appointmentService';
import { citaFlow } from './citaFlow';
import { text2Iso, formatDate } from '~/utils/citaUtils';
import { identifyTenant } from '../utils/tenantHelper';
import { employeeFlow } from './employeeFlow';
import { chatwoot } from '~/app';
import { BotContext, BotMethods } from '@builderbot/bot/dist/types'; // Assuming types exist
import { sendSimple } from '~/utils/flowUtils'; // Importar sendSimple centralizada

// Helper function to send message and log to Chatwoot
// interface StateWithChatwoot { chatwoot_conversation_id?: string; lastSender?: 'user' | 'bot' | 'unknown'; [key: string]: any; }

// Función para crear un delay/retraso
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// async function sendAndLog( ctxFn: BotMethods, message: string | string[], logContext: string, options?: any) {
// Modificado para simplificar: solo envía mensajes, no loguea a Chatwoot ni actualiza lastSender
/* Eliminada la definición local de sendSimple
async function sendSimple( ctxFn: BotMethods, message: string | string[], options?: any) {
    // ... implementación anterior ...
}
*/

const confirmationFlow = addKeyword(EVENTS.ACTION)
  // Acción inicial para identificar el tenant
  .addAction(async (ctx, ctxFn) => {
    // Eliminada actualización de lastSender y log
    const tenant = await identifyTenant(ctx);
    
    if (!tenant) {
      // Pasar ctx y chatwoot a sendSimple
      await sendSimple(ctxFn, ctx, chatwoot, 'Lo siento, ocurrió un error al identificar la clínica.');
      return ctxFn.endFlow('Flujo terminado por error de tenant.');
    }
    
    // Guardar el tenant en el estado para usar en todo el flujo
    const currentState = await ctxFn.state.getMyState();
    await ctxFn.state.update({ 
      ...currentState,  // Mantener datos existentes de la cita
      tenant: tenant
    });
  })
  // NUEVO addAction para enviar la pregunta y registrarla
  .addAction(async (ctx, ctxFn) => { // Añadir ctx aquí para pasarlo a sendSimple
      const questionMsg = '¿Deseas confirmar la cita, cambiar la fecha o salir?';
      const buttons = [
          { body: 'Si ✅' },
          { body: 'Otra fecha' },
          { body: 'Salir' },
      ];
      // Enviar mensaje y botones
      // Pasar ctx y chatwoot a sendSimple
      await sendSimple(ctxFn, ctx, chatwoot, questionMsg, { buttons } as any);
  })
  // addAnswer modificado: ya no envía el mensaje, solo captura la respuesta
  .addAnswer(
    // Mensaje eliminado de aquí
    [''], // Espera cualquier respuesta
    {
      capture: true,
      // Los botones se envían en el addAction anterior
    },
    // La lógica de manejo de respuesta permanece igual
    async (ctx, ctxFn) => {
      // Eliminada actualización de lastSender y log
      const input = ctx.body.toLowerCase().trim();

      // Obtenemos datos del state, incluyendo tenant y ID de conversación
      const myState = await ctxFn.state.getMyState();
      // Eliminamos chatwoot_conversation_id de aquí porque ya se usó arriba
      const { isoDate, date, employeeId, tenant, clientId } = myState || {};

      if (!tenant || !tenant.id) {
        // Pasar ctx y chatwoot a sendSimple
        await sendSimple(ctxFn, ctx, chatwoot, 'Error: No se pudo identificar la clínica.');
        await ctxFn.state.clear();
        return ctxFn.endFlow();
      }

      const clinicName = tenant.clinicName || 'nuestra clínica';

      // Validamos que exista la info de la cita
      if (!isoDate || !employeeId || !clientId) {
        // Pasar ctx y chatwoot a sendSimple
        await sendSimple(ctxFn, ctx, chatwoot, `No tenemos los datos completos de la cita en ${clinicName}. Empecemos de nuevo.`);
        await ctxFn.state.update({ tenant }); // Mantener solo tenant
        return ctxFn.gotoFlow(citaFlow);
      }

      // Obtenemos el cliente mediante su teléfono y tenantId
      const client = await getClientByPhone(ctx.from, tenant.id);
      if (!client) {
        console.log(`No se encontró el cliente en ${clinicName}, regresamos a citaFlow.`);
        // Pasar ctx y chatwoot a sendSimple
        await sendSimple(ctxFn, ctx, chatwoot, `No se encontró tu registro en ${clinicName}. Por favor, regístrate.`);
        await ctxFn.state.update({ tenant }); // Mantener solo tenant
        return ctxFn.gotoFlow(citaFlow);
      }

      switch (input) {
        case 'si ✅': {
          // Crear la cita
          const appointment = await createAppointment({
              date: isoDate, // Usar isoDate
              client_id: clientId, // Corregido: Usar client_id
              employee_id: employeeId, // Corregido: Usar employee_id
              status: 'pending', // Añadir estado por defecto
              notes: '', // Añadir notas por defecto
              tenantId: tenant.id // Corregido: Incluir tenantId dentro del objeto
          });

          if (!appointment) {
            // Pasar ctx y chatwoot a sendSimple
            await sendSimple(ctxFn, ctx, chatwoot, `Hubo un error al crear tu cita en ${clinicName}. Intenta de nuevo.`);
            return ctxFn.endFlow();
          }
          
          const formattedDate = date ? formatDate(date) : 'fecha no especificada'; // Formatear desde el objeto Date
          // Pasar ctx y chatwoot a sendSimple
          await sendSimple(ctxFn, ctx, chatwoot, `✅ ¡Cita confirmada en ${clinicName} para ${formattedDate}!`);
          await ctxFn.state.clear();
          return ctxFn.endFlow();
        }

        case 'otra fecha': {
          await ctxFn.state.update({ tenant: tenant }); // Mantener tenant e ID de cliente
          // Pasar ctx y chatwoot a sendSimple
          await sendSimple(ctxFn, ctx, chatwoot, "Ok, dime qué otra fecha te gustaría.");
          return ctxFn.gotoFlow(citaFlow); // Volver a pedir fecha
        }

        case 'salir':
          await ctxFn.state.clear();
          // Pasar ctx y chatwoot a sendSimple
          await sendSimple(ctxFn, ctx, chatwoot, "De acuerdo, tu cita no ha sido confirmada. Puedes volver a empezar cuando quieras.");
          return ctxFn.endFlow();

        default:
          // Pasar ctx y chatwoot a sendSimple
          await sendSimple(ctxFn, ctx, chatwoot, 'No entendí tu respuesta. Por favor, elige una de las opciones.', {
            buttons: [{ body: 'Si ✅' }, { body: 'Otra fecha' }, { body: 'Salir' }],
          });
          return; // No usar fallback, esperar nueva respuesta
      }
    }
  )
  // SEGUNDO BLOQUE: capturamos la nueva fecha solo si se activó "changingDate"
  .addAnswer(
    [],
    { capture: true },
    async (ctx, ctxFn) => {
      // Eliminada actualización de lastSender y log
      const myState = await ctxFn.state.getMyState();
      const { changingDate, tenant } = myState || {};
      const logCtx = 'ConfirmationFlow Change Date';

      if (!changingDate) {
        // Si no estamos cambiando la fecha, simplemente no hacemos nada aquí.
        // El flujo continuará si hay más pasos o terminará.
        return;
      }

      // Si 'changingDate' es true, procesamos la nueva fecha
      if (!tenant || !tenant.id) {
        await sendSimple(ctxFn, ctx, chatwoot, 'Error: No se pudo identificar la clínica.');
        await ctxFn.state.clear();
        return; // Usamos return simple para detener esta ejecución específica
      }

      const clinicName = tenant.clinicName || 'nuestra clínica';

      // Intentamos parsear la nueva fecha
      const userInput = ctx.body.trim();
      const newIsoDate = await text2Iso(userInput);

      if (!newIsoDate || newIsoDate === 'false') {
        const responseMsg = `No entendí la fecha. Por favor, usa un formato tipo "15 de marzo a las 10" para tu cita en ${clinicName}.`;
        await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
        return; // Espera de nuevo en este addAnswer
      }

      const newDateObj = new Date(newIsoDate);
      if (newDateObj <= new Date()) {
        const responseMsg = 'La fecha debe ser en el futuro. Intenta otra fecha.';
        await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
        return; // Espera de nuevo en este addAnswer
      }

      // Actualizamos en el estado con la nueva fecha
      await ctxFn.state.update({
        ...myState,       // Mantener datos existentes (incluido tenant)
        isoDate: newIsoDate,
        date: newDateObj,
        hasDate: true,
        changingDate: false, // Desactivamos el flag
        employeeId: undefined, // IMPORTANTE: Resetear el empleado elegido
        // Quitamos isAvailable: true, ya que hay que volver a verificar
      });

      console.log(`[${logCtx}] Nueva fecha ${newIsoDate} recibida. Redirigiendo a employeeFlow.`);
      // Cambiamos aquí: redirigir a employeeFlow para verificar disponibilidad y elegir profesional
      return ctxFn.gotoFlow(employeeFlow);
    }
  );

export { confirmationFlow };