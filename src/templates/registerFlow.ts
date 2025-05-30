import { addKeyword, EVENTS } from '@builderbot/bot';
// Cambiar la importación al archivo correcto
import { insertClient } from '~/services/clientService';
import { identifyTenant } from '../utils/tenantHelper';
import { chatwoot } from '~/app';
import { handleMessage } from '~/services/chatwoot';
import { DetectIntention } from './intentionFlow';

// Función para crear un delay/retraso (si no está global)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const registerFlow = addKeyword(EVENTS.ACTION)
  // Acción inicial para identificar el tenant
  .addAction(async (ctx, ctxFn) => {
    const tenant = await identifyTenant(ctx);
    if (!tenant) {
      const errorMsg = 'Error identificando la clínica.';
      await ctxFn.flowDynamic(errorMsg);
      // Registrar mensaje saliente
      try {
        await handleMessage({ phone: ctx.from, name: 'Bot', message: errorMsg, mode: 'outgoing', attachment: [] }, chatwoot);
      } catch (e) { console.error('[registerFlow Tenant Error] Error registrando mensaje en Chatwoot:', e); }
      return ctxFn.endFlow();
    }
    await ctxFn.state.update({ tenant });
    
  })
  
  // Paso 2: Preguntar si se desea comenzar con el registro (quitamos el paso 1 anterior)
  .addAnswer(
    '¿Quieres comenzar con el registro?',
    { capture: true, buttons: [{ body: 'Si' }, { body: 'No, gracias' }] },
    async (ctx, ctxFn) => {
      if (ctx.body === "No, gracias") {
        const cancelMsg = "El registro fue cancelado, puedes volver a escribir cuando quieras continuarlo.";
        // Registrar mensaje saliente antes de endFlow si es posible
        try {
            await handleMessage({ phone: ctx.from, name: 'Bot', message: cancelMsg, mode: 'outgoing', attachment: [] }, chatwoot);
        } catch (e) { console.error('[registerFlow Cancel] Error registrando mensaje en Chatwoot:', e); }
        return ctxFn.endFlow(cancelMsg);
      } else if (ctx.body === "Si") {
        const proceedMsg = 'Perfecto, voy a proceder con algunas preguntas';
        await ctxFn.flowDynamic(proceedMsg);
        // Registrar mensaje saliente
        try {
            await handleMessage({ phone: ctx.from, name: 'Bot', message: proceedMsg, mode: 'outgoing', attachment: [] }, chatwoot);
        } catch (e) { console.error('[registerFlow Proceed] Error registrando mensaje en Chatwoot:', e); }
        return;
      } else {
        const fallbackMsg = "¡Elige una opción válida!";
        // Registrar mensaje saliente
        try {
            await handleMessage({ phone: ctx.from, name: 'Bot', message: fallbackMsg, mode: 'outgoing', attachment: [] }, chatwoot);
        } catch (e) { console.error('[registerFlow Fallback] Error registrando mensaje en Chatwoot:', e); }
        return ctxFn.fallBack(fallbackMsg);
      }
    }
  )
  
  // El resto del flujo permanece igual
  .addAnswer(
    'Por favor, escribe tu nombre completo:', // Pregunta directamente aquí
    { capture: true },
    async (ctx, { state, flowDynamic }) => {
      await state.update({ name: ctx.body });
    }
  )
  .addAnswer(
    '¿Cuál es tu email?',
    { capture: true },
    async (ctx, { state, flowDynamic, endFlow, gotoFlow }) => {
      const email = ctx.body;
      const currentState = await state.getMyState();
      const { name, tenant } = currentState;
      const logCtx = 'RegisterFlow Create';

      if (!email.includes('@')) {
        const errorMsg = "Formato de correo inválido. Por favor, inténtalo de nuevo.";
        await flowDynamic(errorMsg);
        // Registrar mensaje saliente
        try {
            await handleMessage({ phone: ctx.from, name: 'Bot', message: errorMsg, mode: 'outgoing', attachment: [] }, chatwoot);
        } catch (e) { console.error('[registerFlow Invalid Email] Error registrando mensaje en Chatwoot:', e); }
        return;
      }
      
      await state.update({ email: email });
      
      // Crear cliente
      const newClient = await insertClient({ name, phone: ctx.from, email, tenantId: tenant.id });

      if (!newClient) {
        const errorMsg = `Hubo un error al registrarte en ${tenant.clinicName}. Intenta más tarde.`;
        await flowDynamic(errorMsg);
        // Registrar mensaje saliente
        try {
            await handleMessage({ phone: ctx.from, name: 'Bot', message: errorMsg, mode: 'outgoing', attachment: [] }, chatwoot);
        } catch (e) { console.error('[registerFlow DB Error] Error registrando mensaje en Chatwoot:', e); }
        return;
      }

      // Store client information for personalization
      await state.update({ 
        clientName: name,
        clientEmail: email,
        isExistingClient: false // Mark as newly registered
      });

      const successMsg = `✅ ¡Registro completado en ${tenant.clinicName}, ${name}! ¿En qué puedo ayudarte hoy?`;
      await flowDynamic(successMsg);
      // Registrar mensaje saliente
      try {
          await handleMessage({ phone: ctx.from, name: 'Bot', message: successMsg, mode: 'outgoing', attachment: [] }, chatwoot);
      } catch (e) { console.error('[registerFlow Success] Error registrando mensaje en Chatwoot:', e); }
      
      // Go to intention detection instead of ending
      return gotoFlow(DetectIntention);
    }
  );

export { registerFlow };