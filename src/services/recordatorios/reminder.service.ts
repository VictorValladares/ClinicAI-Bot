import { SupabaseClient } from '@supabase/supabase-js';
import { MetaProvider } from '@builderbot/provider-meta';
import axios from 'axios';
import { sendWhatsAppTemplate } from './send-direct.service'

const META_TEMPLATE = process.env.META_APPOINTMENT_TEMPLATE_NAME || 'appointment_reminder';


// Función para formatear números de teléfono para WhatsApp
function formatPhoneForWhatsApp(phone: string): string {
    // Eliminar espacios, guiones y paréntesis
    let formatted = phone.replace(/[\s\-()]/g, '');
    
    // Asegurarse de que tenga el prefijo "+"
    if (!formatted.startsWith('+')) {
        formatted = '+' + formatted;
    }
    
    return formatted;
}

interface Appointment {
    id: string;
    date: string;
    client_id: string;
    user_id: string;
}

interface Client {
    id: string;
    phone: string;
    name: string;
}

interface TenantInfo {
    clinic_name: string;
}

export const checkAndSendReminders = async (provider: MetaProvider, supabase: SupabaseClient) => {
    console.log('🔎 Buscando citas pendientes para mañana...');


    try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        const dayAfterTomorrow = new Date(tomorrow);
        dayAfterTomorrow.setDate(tomorrow.getDate() + 1);

        const { data: appointments, error: appointmentsError } = await supabase
            .from('appointments')
            .select('id, date, client_id, user_id')
            .gte('date', tomorrow.toISOString())
            .lt('date', dayAfterTomorrow.toISOString())
            .eq('status', 'pending');

        if (appointmentsError) {
            console.error('❌ Error consultando citas pendientes:', appointmentsError.message);
            return;
        }

        if (!appointments || appointments.length === 0) {
            console.log('👍 No hay citas pendientes para mañana.');
            return;
        }

        console.log(`✉️ Encontradas ${appointments.length} citas pendientes. Procesando recordatorios...`);

        for (const appt of appointments as Appointment[]) {
            const { data: client, error: clientError } = await supabase
                .from('clients')
                .select('id, phone, name')
                .eq('id', appt.client_id)
                .single();

            if (clientError) {
                console.error(`❌ Error obteniendo cliente ${appt.client_id} para cita ${appt.id}:`, clientError.message);
                continue;
            }
            if (!client) {
                console.error(`❌ Cliente ${appt.client_id} no encontrado para cita ${appt.id}.`);
                continue;
            }
            
            const { data: tenantInfo, error: tenantError } = await supabase
                .from('tenant_config')
                .select('clinic_name')
                .eq('user_id', appt.user_id)
                .single();

            if (tenantError) {
                console.error(`❌ Error obteniendo config. de tenant (user_id: ${appt.user_id}) para cita ${appt.id}:`, tenantError.message);
                continue;
            }
            if (!tenantInfo) {
                console.error(`❌ Config. de tenant (user_id: ${appt.user_id}) no encontrada para cita ${appt.id}.`);
                continue;
            }

            const appointmentDate = new Date(appt.date);
            // Ajustar la hora restando 2 horas (diferencia entre UTC y Madrid)
            appointmentDate.setHours(appointmentDate.getHours() - 2);
            const appointmentTime = appointmentDate.toLocaleTimeString('es-ES', { 
                hour: '2-digit', 
                minute: '2-digit', 
                hour12: false
            });

            console.log(`➡️ Preparando recordatorio para ${client.name} (${client.phone}) - Cita ${appt.id} en ${tenantInfo.clinic_name} a las ${appointmentTime}`);

            try {
                console.log(`🔄 Intentando enviar plantilla: ${META_TEMPLATE}`);
                
                // Usar el servicio de envío directo en lugar del provider
                console.log('📊 Usando servicio de envío directo a la API de Meta');
                
                const result = await sendWhatsAppTemplate(
                    client.phone,
                    META_TEMPLATE,
                    'es',
                    [
                        { text: client.name },
                        { text: tenantInfo.clinic_name },
                        { text: appointmentTime }
                    ],
                    `Cita ID: ${appt.id}`
                );
                
                if (result.success) {
                    console.log(`✅ Recordatorio enviado correctamente a ${client.phone} para cita ${appt.id}`);
                    console.log(`📲 ID del mensaje: ${result.messageId}`);
                } else {
                    console.error(`❌ Error enviando recordatorio a ${client.phone}: ${result.error}`);
                    if (result.details) {
                        console.error('Detalles del error:', JSON.stringify(result.details, null, 2));
                    }
                }

            } catch (sendError: any) {
                console.error(`❌ Error enviando template de recordatorio para cita ${appt.id} a ${client.phone}:`, sendError.message || sendError);
                
                // Obtener el número formateado para los logs
                const phoneForLogs = formatPhoneForWhatsApp(client.phone);
                
                console.error('Datos utilizados en la solicitud:');
                console.error(`- Número: ${phoneForLogs}`);
                console.error(`- Nombre del cliente: ${client.name}`);
                console.error(`- Nombre de la clínica: ${tenantInfo.clinic_name}`);
                console.error(`- Hora de la cita: ${appointmentTime}`);
                console.error(`- Nombre de la plantilla: ${META_TEMPLATE}`);
                
                // Verificar el tipo de error para diagnóstico
                if (sendError instanceof Error) {
                    console.error('Tipo de error: Error estándar de JavaScript');
                    console.error('Stack de error:', sendError.stack);
                    
                    // Verificar si es un error de red
                    if ('code' in sendError) {
                        console.error(`Código de error: ${(sendError as any).code}`);
                    }
                } else {
                    console.error('Tipo de error: Objeto no estándar');
                }
                
                // Mostrar detalles si el error tiene información adicional
                if (sendError.response) {
                    console.error('Status:', sendError.response.status);
                    console.error('Status Text:', sendError.response.statusText);
                    console.error('Headers:', JSON.stringify(sendError.response.headers, null, 2));
                    
                    if (sendError.response.data) {
                        console.error('Detalles del error API:', JSON.stringify(sendError.response.data, null, 2));
                        
                        // Si hay un código de error específico de WhatsApp
                        if (sendError.response.data.error && sendError.response.data.error.code) {
                            console.error(`Código de error de WhatsApp: ${sendError.response.data.error.code}`);
                            console.error(`Mensaje de error de WhatsApp: ${sendError.response.data.error.message}`);
                            
                            // Recomendaciones específicas basadas en códigos de error comunes
                            if (sendError.response.data.error.code === 100) {
                                console.error('💡 Sugerencia: Parámetro faltante o inválido en la solicitud');
                            } else if (sendError.response.data.error.code === 131047) {
                                console.error('💡 Sugerencia: El mensaje no cumple con las políticas de WhatsApp');
                            } else if (sendError.response.data.error.code === 130429) {
                                console.error('💡 Sugerencia: Límite de tasa superado, intenta más tarde');
                            } else if (sendError.response.data.error.code === 132000) {
                                console.error('💡 Sugerencia: Token de acceso no válido');
                            } else if (sendError.response.data.error.code === 132001) {
                                console.error('💡 Sugerencia: Token caducado, renueva el token');
                            } else if (sendError.response.data.error.code === 133001) {
                                console.error('💡 Sugerencia: Plantilla no encontrada o no aprobada');
                            }
                        }
                    }
                } else if (sendError.request) {
                    console.error('Error de solicitud sin respuesta:', sendError.request);
                } else {
                    console.error('Detalles del error:', JSON.stringify(sendError, null, 2));
                }
                
                // Intentar verificar estado de autenticación con Meta
                console.error(`JWT Token utilizado (primeros 10 caracteres): ${process.env.JWT_TOKEN?.substring(0, 10)}...`);
                console.error(`ID de número utilizado: ${process.env.NUMBER_ID}`);
                
                // Sugerencias generales
                console.error('💡 Recomendaciones generales:');
                console.error('1. Verifica que la plantilla esté aprobada en la consola de Meta');
                console.error('2. Asegúrate de que el token JWT sea válido y no haya caducado');
                console.error('3. Comprueba que el número de teléfono del receptor esté en el formato correcto');
                console.error('4. Verifica que los parámetros de la plantilla sean exactamente 3 y en el orden correcto');
            }
        }

        console.log('🏁 Proceso de recordatorios finalizado.');

    } catch (error: any) {
        console.error('❌ Error general en checkAndSendReminders:', error.message || error);
    }
};