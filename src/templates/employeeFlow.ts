import { addKeyword, EVENTS } from '@builderbot/bot';
import { getEmployeesByRole, checkAppointmentAvailability } from '~/services/employeeService';
import { citaFlow } from './citaFlow';
import { confirmationFlow } from './confirmationFlow';
import { identifyTenant } from '../utils/tenantHelper';
import { chatwoot } from '~/app';
import { formatDate } from '~/utils/citaUtils';
import { BotContext, BotMethods } from '@builderbot/bot/dist/types'; // Assuming types exist
import { sendSimple } from '~/utils/flowUtils'; // Importar sendSimple centralizada


const employeeFlow = addKeyword(EVENTS.ACTION)
  // Acción inicial para identificar el tenant si no está en el estado
  .addAction(async (ctx, ctxFn) => {
    // Eliminada actualización de lastSender y log
    const currentState = await ctxFn.state.getMyState();
    
    // Verificar si ya tenemos tenant en el estado
    if (!currentState.tenant) {
      // Identificar el tenant
      const tenant = await identifyTenant(ctx);
      
      if (!tenant) {
        // Pasar ctx y chatwoot a sendSimple
        await sendSimple(ctxFn, ctx, chatwoot, 'Lo siento, ocurrió un error al identificar la clínica.');
        return ctxFn.endFlow('Flujo terminado por error de tenant.');
      }
      
      // Actualizar el estado con el tenant
      await ctxFn.state.update({ 
        ...currentState,  // Mantener otros datos
        tenant: tenant
      });
    }
  })
  .addAction(async (ctx, ctxFn) => {
    // Esta acción comprueba disponibilidad
    // No recibe nueva entrada directa del usuario aquí, así que NO actualizamos lastSender
    // Obtenemos el state completo
    const currentState = (await ctxFn.state.getMyState()) || {};
    const { hasDate, isoDate, tenant, date } = currentState;
    const logCtx = 'EmployeeFlow Availability Check';
    
    // Verificar que tengamos el tenant
    if (!tenant || !tenant.id) {
      console.error('No se encontró información del tenant en el estado');
      await ctxFn.state.update({ 
        shouldEnd: true,
        endMessage: 'Error al identificar la clínica. Por favor, intenta de nuevo.' 
      });
      return;
    }
    
    // Verificar que tengamos la fecha
    if (!hasDate || !isoDate) {
      await ctxFn.state.update({ 
        shouldEnd: true,
        endMessage: 'Por favor, inicia el proceso de cita nuevamente.' 
      });
      return;
    }

    // Consulta de empleados disponibles (ejemplo: fisioterapeutas)
    // ACTUALIZADO: Pasar el tenant.id como segundo parámetro
    const employees = await getEmployeesByRole('fisioterapeuta', tenant.id);
    
    const availableEmployees = [];
    
    for (const emp of employees) {
      // ACTUALIZADO: Pasar el tenant.id como tercer parámetro
      const canWork = await checkAppointmentAvailability(isoDate, emp.id, tenant.id);
      if (canWork) {
        availableEmployees.push(emp);
      }
    }
    
    // Guardamos en el estado
    const noAvailabilityMsg = `Lo siento, no hay profesionales disponibles en ${tenant.clinicName} para esa hora. Por favor, elige otra fecha.`;
    await ctxFn.state.update({ 
      availableEmployees,
      shouldEnd: availableEmployees.length === 0,
      endMessage: availableEmployees.length === 0 ? noAvailabilityMsg : null,
      date: date
    });
  })
  // 1) Primer bloque: si `shouldEnd` es true, llamamos a endFlow aquí (sin usar flowDynamic)
  .addAnswer(
    [''],
    { capture: false },
    async (_, ctxFn) => {
      const { shouldEnd, endMessage } = await ctxFn.state.getMyState();
      if (shouldEnd && endMessage) {
          // Log and send the end message *only* if shouldEnd is true
          // Pasar ctx y chatwoot a sendSimple (necesitamos ctx, lo añadimos al callback anterior si es posible o lo obtenemos del state si se guarda)
          // Por ahora, asumimos que ctx no está disponible aquí y no podemos registrar este mensaje específico.
          // Considerar refactorizar si es crucial registrar este mensaje.
          await ctxFn.flowDynamic(endMessage); // Usar flowDynamic directamente si no podemos usar sendSimple
          // await sendSimple(ctxFn, ???, chatwoot, endMessage); 
          return ctxFn.endFlow(); 
      }
    }
  )
  // 2) Segundo bloque: si no se cerró el flujo antes, aquí usamos flowDynamic
  .addAnswer(
    [''],
    { capture: false },
    async (ctx, ctxFn) => {
      const { availableEmployees, tenant, date } = await ctxFn.state.getMyState();
      const clinicName = tenant?.clinicName || 'nuestra clínica';
      const logCtx = 'EmployeeFlow Show Available';

      // Formatear la fecha desde el objeto Date guardado en el estado
      const fechaFormateada = date ? formatDate(date) : 'Fecha no especificada'; 
      const confirmationMsg = `✅ Genial! La fecha ${fechaFormateada} está disponible en ${clinicName}.`;
      // Pasar ctx y chatwoot a sendSimple
      await sendSimple(ctxFn, ctx, chatwoot, confirmationMsg);

      const buttons = availableEmployees.map((emp) => ({ body: emp.name }));
      buttons.push({ body: 'Cancelar' });
      
      const responseMsg = `Estos son los profesionales disponibles en ${clinicName} para esa hora. Selecciona uno o pulsa "Cancelar" para salir:`;
      // Pasar ctx y chatwoot a sendSimple
      await sendSimple(ctxFn, ctx, chatwoot, responseMsg, { buttons } as any);
    }
  )
  // 3) Tercer bloque: manejamos la respuesta del usuario (captura de input)
  .addAnswer(
    [],
    { capture: true },
    async (ctx, ctxFn) => {
      // Eliminada actualización de lastSender y log
      const input = ctx.body.toLowerCase().trim();
      
      const myState = await ctxFn.state.getMyState();
      const { isoDate, tenant, availableEmployees } = myState || {};
      const clinicName = tenant?.clinicName || 'nuestra clínica';
      const logCtx = 'EmployeeFlow Select Employee';
      
      // Si no hay fecha en state, volvemos al flow de cita
      if (!isoDate) {
        console.log("No hay isoDate en state, redirigiendo a citaFlow");
        return ctxFn.gotoFlow(citaFlow);
      }

      // Opción "Cancelar"
      if (input === 'cancelar') {
        console.log("Usuario canceló la selección");
        await ctxFn.state.update({ tenant }); // Mantener solo tenant
        const responseMsg = `Reserva en ${clinicName} cancelada. Escribe "quiero una cita" para iniciar de nuevo.`;
        // Pasar ctx y chatwoot a sendSimple
        await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
        return;
      }

      // Caso: elige un profesional
      // Verificamos si el input coincide con algún profesional disponible
      const chosen = availableEmployees.find(
        (emp) => emp.name.toLowerCase() === input.toLowerCase()
      );
      if (!chosen) {
        const responseMsg = 'Profesional no válido o no disponible. Escribe "Cancelar" para salir o elige otro:';
        // Pasar ctx y chatwoot a sendSimple
        await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
        return;
      }

      // Guardamos el profesional elegido
      await ctxFn.state.update({ employeeId: chosen.id });
      const responseMsg = `✅ Has seleccionado a ${chosen.name} en ${clinicName}.`;
      // Pasar ctx y chatwoot a sendSimple
      await sendSimple(ctxFn, ctx, chatwoot, responseMsg);
      
      // Pasamos al flujo de confirmación
      return ctxFn.gotoFlow(confirmationFlow);
    }
  );

export { employeeFlow };