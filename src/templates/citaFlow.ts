// citaFlow.ts
import { addKeyword, EVENTS } from '@builderbot/bot';
import { text2Iso, formatDate } from '~/utils/citaUtils';
import { getClientByPhone } from '~/services/clientService';
import { registerFlow } from './registerFlow';
import { employeeFlow } from './employeeFlow';
import { identifyTenant } from '../utils/tenantHelper';
import { chatwoot } from '~/app';
import { sendSimple } from '~/utils/flowUtils';


const citaFlow = addKeyword(EVENTS.ACTION)
  // Acción inicial para identificar el tenant
  .addAction(async (ctx, ctxFn) => {
    // Get tenant from state first (should be available from mainFlow or registerFlow)
    const currentState = await ctxFn.state.getMyState();
    let tenant = currentState?.tenant;
    
    // If not in state, identify it
    if (!tenant) {
      tenant = await identifyTenant(ctx);
      if (!tenant) {
        await sendSimple(ctxFn, ctx, chatwoot, 'Lo siento, ocurrió un error al identificar la clínica.'); 
        return ctxFn.endFlow('Flujo terminado por error de tenant.');
      }
      // Save tenant to state
      await ctxFn.state.update({ tenant: tenant });
    }
  })
  .addAction(async (ctx, ctxFn) => {
    // Obtener el estado actual
    const myState = await ctxFn.state.getMyState();
    const tenant = myState.tenant;
    const existingClientName = myState.clientName; // From mainFlow or registerFlow
    const logCtx = 'CitaFlow Init';

    if (!tenant?.id) {
      await sendSimple(ctxFn, ctx, chatwoot, 'Error: No se pudo identificar la clínica.'); 
      return;
    }

    // Check if we already have client info from previous flows
    let clientId = myState.clientId;
    let clientName = existingClientName;

    if (!clientId) {
      // Look up client in database if not in state
      const client = await getClientByPhone(ctx.from, tenant.id);
      if (!client) {
        const responseMsg = `⚠️ Necesitas registrarte primero en ${tenant.clinicName} para poder agendar una cita.`;
        await sendSimple(ctxFn, ctx, chatwoot, responseMsg); 
        return ctxFn.gotoFlow(registerFlow);
      }
      clientId = client.id;
      clientName = client.name;
    }

    // Update state with client info and reset appointment-specific data
    await ctxFn.state.update({
      tenant: tenant,
      clientId: clientId,
      clientName: clientName,
      hasDate: false,
      date: null,
      isoDate: null,
      isAvailable: false
    });

    const isoDate = await text2Iso(ctx.body);
    console.log('📅 Detected date:', isoDate);

    if (isoDate && isoDate !== 'false') {
      const dateObj = new Date(isoDate);
      if (dateObj <= new Date()) {
        await sendSimple(ctxFn, ctx, chatwoot, `${clientName}, la fecha debe ser en el futuro. Intenta otra fecha.`);
        return;
      }

      // Verificar si la hora es 10:00 (hora por defecto de text2Iso)
      const horaDetectada = dateObj.getHours(); 
      const minutosDetectados = dateObj.getMinutes();
      const esHoraPorDefecto = horaDetectada === 10 && minutosDetectados === 0;

      await ctxFn.state.update({
        hasDate: true,
        date: dateObj,
        isoDate: isoDate,
      });

      if (esHoraPorDefecto) {
        // La hora es 10:00, preguntamos al usuario
        const fechaFormateada = formatDate(dateObj).split(', ')[1].split(' a las')[0]; // Extraer solo la fecha
        const responseMsg = `🗓️ Perfecto ${clientName}, la fecha es ${fechaFormateada}. ¿A qué hora te gustaría la cita en ${tenant.clinicName}? (Ej: "a las 15:30")`;
        await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
        return; 
      } else {
        // El usuario ya especificó una hora
        console.log(`[${logCtx}] Hora específica detectada (${isoDate}), yendo a employeeFlow`);
        return ctxFn.gotoFlow(employeeFlow);
      }
      
    } else {
      const responseMsg = `${clientName}, por favor indícame la fecha para tu cita en ${tenant.clinicName} (Ej: "15 de marzo a las 10")`;
      await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
      return;
    }
  })
  // Pide la fecha si no se detectó inicialmente O pide la hora si solo se dio fecha
  .addAnswer(
    [""], // Captura cualquier respuesta
    { capture: true },
    async (ctx, ctxFn) => {
      const myState = await ctxFn.state.getMyState();
      const tenant = myState.tenant;
      const clientName = myState.clientName;
      const fechaPrevia = myState.date;
      const logCtx = 'CitaFlow Answer';

      if (!tenant?.id) {
        await sendSimple(ctxFn, ctx, chatwoot, 'Error: No se pudo identificar la clínica.'); 
        return;
      }

      let isoDate: string | null = null;
      let dateObj: Date | null = null;

      if (fechaPrevia && !myState.isoDate.includes('T10:00:00')) { 
          // Ya teníamos una fecha específica antes
          isoDate = await text2Iso(ctx.body);
          if (isoDate && isoDate !== 'false') dateObj = new Date(isoDate);

      } else if (fechaPrevia) {
        // Teníamos una fecha (hora 10:00) y ahora esperamos la HORA
        const fechaTexto = fechaPrevia.toISOString().split('T')[0]; 
        const textoCompleto = `${fechaTexto} ${ctx.body}`; 
        console.log(`[${logCtx}] Intentando parsear hora: ${textoCompleto}`);
        isoDate = await text2Iso(textoCompleto); // Re-evaluamos con la hora
        if (isoDate && isoDate !== 'false') {
            dateObj = new Date(isoDate);
            // Verificamos si la nueva fecha/hora sigue siendo 10:00
            const esHoraPorDefectoTodavia = dateObj.getHours() === 10 && dateObj.getMinutes() === 0;
            if (esHoraPorDefectoTodavia) {
                 console.log(`[${logCtx}] Hora sigue siendo 10:00, volvemos a pedir.`);
                 const responseMsg = `${clientName}, necesito una hora específica distinta a las 10:00 AM. Por favor, indícame la hora para tu cita en ${tenant.clinicName}. (Ej: "14:30")`;
                 await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
                 return; // Esperamos nueva respuesta
            }
             console.log(`[${logCtx}] Hora específica recibida: ${isoDate}`);
        } else {
             console.log(`[${logCtx}] No se pudo parsear la hora: ${ctx.body}`);
        }
      } else {
        // No teníamos fecha previa, esperamos fecha Y HORA juntas
        isoDate = await text2Iso(ctx.body);
         if (isoDate && isoDate !== 'false') {
            dateObj = new Date(isoDate);
            // Verificamos si es 10:00 AM por defecto
             const esHoraPorDefecto = dateObj.getHours() === 10 && dateObj.getMinutes() === 0;
             if (esHoraPorDefecto) {
                 console.log(`[${logCtx}] Hora 10:00 detectada, pedimos hora específica.`);
                 await ctxFn.state.update({ 
                     hasDate: true,
                     date: dateObj,
                     isoDate: isoDate,
                 });
                 const fechaFormateada = formatDate(dateObj).split(', ')[1].split(' a las')[0];
                 const responseMsg = `🗓️ Entendido ${clientName}, la fecha es ${fechaFormateada}. ¿A qué hora te gustaría la cita en ${tenant.clinicName}? (Ej: "a las 15:30")`;
                 await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
                 return; // Esperamos la hora
             }
         }
      }
      
      // Si tenemos una fecha válida (con hora específica)
      if (dateObj && isoDate && isoDate !== 'false') {
        if (dateObj <= new Date()) {
          await sendSimple(ctxFn, ctx, chatwoot, `${clientName}, la fecha debe ser en el futuro. Intenta otra fecha.`);
          return; // Esperamos nueva fecha/hora
        }
        // Actualizamos el estado con la fecha y hora definitivas
        await ctxFn.state.update({
          hasDate: true,
          date: dateObj,
          isoDate,
        });
        
        console.log(`[${logCtx}] Fecha/hora (${isoDate}) válida, yendo a employeeFlow`);
        return ctxFn.gotoFlow(employeeFlow);

      } else {
        // Si no se pudo parsear ni como fecha completa ni como hora
        const responseMsg = `${clientName}, no entendí la fecha o la hora. Por favor, usa un formato como "15 de marzo a las 10" o indica solo la hora si ya te pregunté por ella.`;
        await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
        return;
      }
    }
  );

export { citaFlow };