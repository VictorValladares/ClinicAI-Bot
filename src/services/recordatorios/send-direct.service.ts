import axios from 'axios';

/**
 * Función para enviar mensajes de plantilla directamente a la API de WhatsApp
 * Esta función evita usar el provider de BuilderBot que está dando errores
 */
export async function sendWhatsAppTemplate(
    phoneNumber: string, 
    templateName: string,
    languageCode: string,
    parameters: Array<{text: string}>,
    additionalInfo?: string
) {
    try {
        // Asegurarnos de que el número tenga el prefijo +
        const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
        
        // Obtener tokens y configuración de las variables de entorno
        const metaApiVersion = process.env.META_VERSION || 'v22.0';
        const numberId = process.env.META_NUMBER_ID;
        const jwtToken = process.env.META_JWT_TOKEN;
        
        if (!numberId || !jwtToken) {
            throw new Error('Faltan variables de entorno: NUMBER_ID o JWT_TOKEN');
        }
        
        // Crear parámetros con formato correcto para la API
        const formattedParameters = parameters.map(param => ({
            type: 'text',
            text: param.text
        }));
        
        // El nombre exacto de la plantilla en la consola de Meta podría ser diferente
        // El código de idioma podría requerir un formato específico
        // Probar diferentes combinaciones
        const templateLanguageOptions = [
            { name: templateName, langCode: languageCode },              // Opción 1: appointment_reminder, es
            { name: templateName, langCode: `${languageCode}_ES` },      // Opción 2: appointment_reminder, es_ES
            { name: templateName, langCode: `${languageCode}_es` },      // Opción 3: appointment_reminder, es_es
            { name: 'appointment_reminder', langCode: 'es_ES' },         // Opción 4: Hardcoded explícitamente
            { name: 'appointment_reminder', langCode: 'es_es' },         // Opción 5: Hardcoded con variante
            { name: 'appointment_reminder', langCode: 'es' },            // Opción 6: Hardcoded simple
            { name: 'appointment_reminder', langCode: 'spa' }            // Opción 7: Código ISO de español
        ];
        
        // Intentar enviar con cada combinación hasta que una funcione
        let lastError = null;
        
        // Registro de debug
        console.log(`📱 ID de número de WhatsApp: ${numberId}`);
        console.log(`🔑 JWT token (primeros 10 caracteres): ${jwtToken.substring(0, 10)}...`);
        
        for (const option of templateLanguageOptions) {
            try {
                // Construir payload para la API según documentación oficial de Meta
                const payload = {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: formattedPhone,
                    type: 'template',
                    template: {
                        name: option.name,
                        language: {
                            code: option.langCode
                        },
                        components: [
                            {
                                type: 'body',
                                parameters: formattedParameters
                            },
                            {
                                type: 'button',
                                sub_type: 'quick_reply',
                                index: 0
                            },
                            {
                                type: 'button',
                                sub_type: 'quick_reply',
                                index: 1
                            }
                        ]
                    }
                };
                
                console.log(`📤 Intento con nombre:${option.name}, idioma:${option.langCode}`);
                console.log('📋 Payload:', JSON.stringify(payload, null, 2));
                
                // Endpoint de la API de WhatsApp Cloud
                const endpoint = `https://graph.facebook.com/${metaApiVersion}/${numberId}/messages`;
                
                // Hacer la petición HTTP a la API de Meta/WhatsApp
                const response = await axios({
                    method: 'post',
                    url: endpoint,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${jwtToken}`
                    },
                    data: payload,
                    timeout: 10000 // 10 segundos de timeout
                });
                
                // Si llegamos aquí es que funcionó
                console.log('✅ Mensaje enviado exitosamente:', JSON.stringify(response.data, null, 2));
                console.log(`✅ Combinación exitosa: nombre:${option.name}, idioma:${option.langCode}`);
                
                return {
                    success: true,
                    messageId: response.data.messages?.[0]?.id,
                    data: response.data,
                    additionalInfo,
                    templateUsed: `${option.name}:${option.langCode}`
                };
                
            } catch (attemptError: any) {
                lastError = attemptError;
                console.log(`⚠️ Fallo con nombre:${option.name}, idioma:${option.langCode} - ${attemptError.message}`);
                
                if (attemptError.response?.data?.error) {
                    console.log(`Error detallado: ${JSON.stringify(attemptError.response.data.error.message)}`);
                }
                
                // Continuar con la siguiente opción
                continue;
            }
        }
        
        // Si llegamos aquí, ninguna opción funcionó
        throw lastError || new Error("Todas las combinaciones de plantilla/idioma fallaron");
        
    } catch (error: any) {
        console.error('❌ Error enviando mensaje directo:', error.message);
        
        // Mostrar detalles del error de la API si están disponibles
        if (error.response?.data) {
            console.error('Detalles del error API:', JSON.stringify(error.response.data, null, 2));
            
            // Sugerencias específicas basadas en códigos de error comunes
            if (error.response.data.error?.code) {
                const errorCode = error.response.data.error.code;
                console.error(`Código de error: ${errorCode}`);
                
                if (errorCode === 100) {
                    console.error('💡 Error de parámetros: Revisa que el formato de la plantilla sea correcto');
                } else if (errorCode === 131047) {
                    console.error('💡 El mensaje no cumple con las políticas de WhatsApp');
                } else if (errorCode === 133001) {
                    console.error('💡 Plantilla no encontrada o no aprobada');
                } else if (errorCode === 132001) {
                    console.error('💡 Error de plantilla en el idioma especificado. Prueba con otro código de idioma como "es_ES" o "spa"');
                }
            }
        }
        
        return {
            success: false,
            error: error.message,
            details: error.response?.data,
            additionalInfo
        };
    }
} 