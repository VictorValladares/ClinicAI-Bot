// citaFlow.ts – versión corregida
import { addKeyword, EVENTS } from '@builderbot/bot';
import { text2Iso, formatDate } from '~/utils/citaUtils';
import { getClientByPhone } from '~/services/clientService';
import { registerFlow } from './registerFlow';
import { employeeFlow } from './employeeFlow';
import { identifyTenant } from '../utils/tenantHelper';
import { chatwoot } from '~/app';
import { sendSimple } from '~/utils/flowUtils';

/**
 * Detecta si el usuario escribió explícitamente una hora en el mensaje.
 * Reconoce formatos como "10:00", "10h", "10.00", "a las 10", "10 am", etc.
 */
const hasExplicitTime = (text: string): boolean => {
  return /(\d{1,2}\s*[.:h]\s*\d{0,2})|(\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.))/i.test(text);
};

const citaFlow = addKeyword(EVENTS.ACTION)
  /**
   * 1️⃣ Acción inicial: identificar tenant y guardar en state
   */
  .addAction(async (ctx, ctxFn) => {
    const currentState = await ctxFn.state.getMyState();
    let tenant = currentState?.tenant;

    if (!tenant) {
      tenant = await identifyTenant(ctx);
      if (!tenant) {
        await sendSimple(ctxFn, ctx, chatwoot, 'Lo siento, ocurrió un error al identificar la clínica.');
        return ctxFn.endFlow('Flujo terminado por error de tenant.');
      }
      await ctxFn.state.update({ tenant });
    }
  })
  /**
   * 2️⃣ Segunda acción: verificar cliente y parsear primera fecha/hora (si existe)
   */
  .addAction(async (ctx, ctxFn) => {
    const myState = await ctxFn.state.getMyState();
    const tenant = myState.tenant;
    const existingClientName = myState.clientName;
    const logCtx = 'CitaFlow Init';

    if (!tenant?.id) {
      await sendSimple(ctxFn, ctx, chatwoot, 'Error: No se pudo identificar la clínica.');
      return;
    }

    // 2.1️⃣ Recuperar o buscar cliente
    let clientId = myState.clientId;
    let clientName = existingClientName;

    if (!clientId) {
      const client = await getClientByPhone(ctx.from, tenant.id);
      if (!client) {
        const responseMsg = `⚠️ Necesitas registrarte primero en ${tenant.clinicName} para poder agendar una cita.`;
        await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
        return ctxFn.gotoFlow(registerFlow);
      }
      clientId = client.id;
      clientName = client.name;
    }

    // 2.2️⃣ Guardar info de cliente y reset de cita
    await ctxFn.state.update({
      tenant,
      clientId,
      clientName,
      hasDate: false,
      date: null,
      isoDate: null,
      isAvailable: false,
    });

    /**
     * 2.3️⃣ Intentar parsear la fecha/hora del primer mensaje
     * Si el usuario NO indica hora y text2Iso cae al default 10:00, volvemos a preguntar la hora.
     */
    const isoDate = await text2Iso(ctx.body);
    console.log('📅 Detected date:', isoDate);

    if (isoDate && isoDate !== 'false') {
      const dateObj = new Date(isoDate);
      const horaDetectada = dateObj.getHours();
      const minutosDetectados = dateObj.getMinutes();
      const usuarioEscribioHora = hasExplicitTime(ctx.body);

      // ⏳ Solo seguimos si la fecha está en el futuro
      if (dateObj <= new Date()) {
        await sendSimple(
          ctxFn,
          ctx,
          chatwoot,
          `${clientName}, la fecha debe ser en el futuro. Intenta otra fecha.`
        );
        return;
      }

      // 2.4️⃣ Persistir fecha (sin hora definitiva todavía)
      await ctxFn.state.update({
        hasDate: true,
        date: dateObj,
        isoDate,
      });

      /**
       * 2.5️⃣ Si la hora es 10:00 y el usuario NO la escribió explícitamente -> pedir hora.
       * Si la hora es 10:00 porque el usuario sí la escribió, la aceptamos como definitiva.
       */
      const esHoraPorDefecto = horaDetectada === 10 && minutosDetectados === 0 && !usuarioEscribioHora;

      if (esHoraPorDefecto) {
        const fechaFormateada = formatDate(dateObj).split(', ')[1].split(' a las')[0];
        const responseMsg = `🗓️ Perfecto ${clientName}, la fecha es ${fechaFormateada}. ¿A qué hora te gustaría la cita en ${tenant.clinicName}? (Ej: "15:30")`;
        await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
        return; // Esperamos siguiente input con la hora
      }

      // 2.6️⃣ Hora distinta (o 10:00 explícita) => pasamos a employeeFlow
      console.log(`[${logCtx}] Hora específica detectada (${isoDate}), yendo a employeeFlow`);
      return ctxFn.gotoFlow(employeeFlow);
    }

    // 2.7️⃣ No se pudo parsear fecha en el primer mensaje
    const responseMsg = `${clientName}, por favor indícame la fecha para tu cita en ${tenant.clinicName} (Ej: "15 de marzo a las 10:30")`;
    await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
  })
  /**
   * 3️⃣ addAnswer: manejar mensajes posteriores para completar fecha y hora
   */
  .addAnswer([""], { capture: true }, async (ctx, ctxFn) => {
    const myState = await ctxFn.state.getMyState();
    const tenant = myState.tenant;
    const clientName = myState.clientName;
    const fechaPrevia: Date | null = myState.date;
    const logCtx = 'CitaFlow Answer';

    if (!tenant?.id) {
      await sendSimple(ctxFn, ctx, chatwoot, 'Error: No se pudo identificar la clínica.');
      return;
    }

    let isoDate: string | null = null;
    let dateObj: Date | null = null;

    /**
     * 3.1️⃣ Tenemos fecha previa Y ya incluía hora distinta de 10:00  → el usuario está corrigiendo la fecha.
     */
    if (fechaPrevia && myState.isoDate && !myState.isoDate.includes('T10:00:00')) {
      isoDate = await text2Iso(ctx.body);
      if (isoDate && isoDate !== 'false') dateObj = new Date(isoDate);
    }
    /**
     * 3.2️⃣ Teníamos solo fecha (sin hora o 10:00 por defecto) → ahora esperamos la HORA.
     */
    else if (fechaPrevia) {
      const fechaTexto = fechaPrevia.toISOString().split('T')[0];
      const textoCompleto = `${fechaTexto} ${ctx.body}`;
      console.log(`[${logCtx}] Intentando parsear hora: ${textoCompleto}`);
      isoDate = await text2Iso(textoCompleto);
      if (isoDate && isoDate !== 'false') {
        dateObj = new Date(isoDate);
        const esHoraPorDefectoTodavia =
          dateObj.getHours() === 10 && dateObj.getMinutes() === 0 && !hasExplicitTime(ctx.body);
        if (esHoraPorDefectoTodavia) {
          const responseMsg = `${clientName}, necesito una hora específica distinta a las 10:00. Por favor, indícame la hora para tu cita en ${tenant.clinicName}. (Ej: "14:30")`;
          await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
          return; // Seguimos esperando hora correcta
        }
        console.log(`[${logCtx}] Hora específica recibida: ${isoDate}`);
      } else {
        console.log(`[${logCtx}] No se pudo parsear la hora: ${ctx.body}`);
      }
    }
    /**
     * 3.3️⃣ No había nada antes → intentamos fecha y hora juntos
     */
    else {
      isoDate = await text2Iso(ctx.body);
      if (isoDate && isoDate !== 'false') {
        dateObj = new Date(isoDate);
        const esHoraPorDefecto =
          dateObj.getHours() === 10 && dateObj.getMinutes() === 0 && !hasExplicitTime(ctx.body);
        if (esHoraPorDefecto) {
          await ctxFn.state.update({ hasDate: true, date: dateObj, isoDate });
          const fechaFormateada = formatDate(dateObj).split(', ')[1].split(' a las')[0];
          const responseMsg = `🗓️ Entendido ${clientName}, la fecha es ${fechaFormateada}. ¿A qué hora te gustaría la cita en ${tenant.clinicName}? (Ej: "15:30")`;
          await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
          return; // Hora pendiente
        }
      }
    }

    /**
     * 3.4️⃣ Si tenemos fecha + hora válidas en el futuro ⇒ pasamos a employeeFlow
     */
    if (dateObj && isoDate && isoDate !== 'false') {
      if (dateObj <= new Date()) {
        await sendSimple(ctxFn, ctx, chatwoot, `${clientName}, la fecha debe ser en el futuro. Intenta otra fecha.`);
        return; // Volver a pedir fecha/hora
      }
      await ctxFn.state.update({ hasDate: true, date: dateObj, isoDate });
      console.log(`[${logCtx}] Fecha/hora (${isoDate}) válida, yendo a employeeFlow`);
      return ctxFn.gotoFlow(employeeFlow);
    }

    /**
     * 3.5️⃣ No se pudo interpretar el mensaje
     */
    const responseMsg = `${clientName}, no entendí la fecha o la hora. Por favor usa un formato como "15 de marzo a las 10:30" o indícame solo la hora si ya te pregunté por ella.`;
    await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
  });

export { citaFlow };