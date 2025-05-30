import { config } from '~/config';

/**
 * Es la funcion que importa para guardar los mensajes y todo lo que sea necesario
 * @params dataIn pasando los datos del contacto + el mensaje
 * @params chatwoot la dependencia del chatwoot... (create, buscar...)
 */

const handleMessage = async (
    dataIn: {
        phone: any;
        name: any;
        message: any;
        mode: any; // 'incoming' o 'outgoing'
        attachment: any[];
    },
    chatwoot: any // Instancia de ChatwootClass
): Promise<number | null> => {
    // console.log(`[handleMessage] Intentando manejar mensaje:`, { ... }); // <-- Comentado, el log final es suficiente
    
    // Validar que la instancia de chatwoot fue pasada
    if (!chatwoot) {
        console.error('[handleMessage] ERROR: La instancia de Chatwoot no fue proporcionada.');
        return null;
    }

    try {
        // Asegurarse de que el inbox_name se obtiene de la configuración
        const inboxName = process.env.INBOX_NAME || config.INBOX_NAME || "ClinicAI"; 
        // console.log(`[handleMessage] Usando nombre de inbox: ${inboxName}`); // <-- Comentado
        
        const inbox = await chatwoot.findOrCreateInbox({
            name: inboxName,
        });
        
        if (!inbox || !inbox.id) {
             console.error(`[handleMessage] ERROR: No se pudo obtener o crear el inbox ${inboxName}`);
             return null;
        }
        // console.log(`[handleMessage] Inbox ID: ${inbox.id}`); // <-- Comentado

        // await chatwoot.checkAndSetCustomAttribute(); // Esta función parece causar problemas recursivos, revisar su implementación si es necesaria

        const contact = await chatwoot.findOrCreateContact({
            from: dataIn.phone,
            name: dataIn.name,
            inbox: inbox.id // Pasar inbox id a findOrCreateContact
        });
        
        if (!contact || !contact.id) {
            console.error(`[handleMessage] ERROR: No se pudo obtener o crear el contacto para ${dataIn.phone}`);
            return null;
        }
        // console.log(`[handleMessage] Contact ID: ${contact.id}`); // <-- Comentado

        const conversation = await chatwoot.findOrCreateConversation({
            inbox_id: inbox.id,
            contact_id: contact.id,
            phone_number: dataIn.phone,
        });
        
        if (!conversation || !conversation.id) {
            console.error(`[handleMessage] ERROR: No se pudo obtener o crear la conversación para ${dataIn.phone}`);
            return null;
        }
        // console.log(`[handleMessage] Conversation ID: ${conversation.id}`); // <-- Comentado

        // --- MODIFICACIÓN CLAVE ---
        // Llamar a createMessage para AMBOS modos, 'incoming' y 'outgoing'.
        // Chatwoot necesita que le enviemos explícitamente ambos tipos de mensajes
        // a través de la API para que se asocien correctamente a la conversación que hemos creado o encontrado.
        const messageResult = await chatwoot.createMessage({
            msg: dataIn.message,
            mode: dataIn.mode, // Pasar el modo correspondiente
            conversation_id: conversation.id,
            attachment: dataIn.attachment,
        });

        // Loguear éxito o fallo del mensaje
        if (messageResult) {
            // console.log(`[handleMessage] Mensaje (${dataIn.mode}) para ${dataIn.phone} registrado en Chatwoot (Conv ID ${conversation.id}).`);
        } else {
             console.error(`[handleMessage] ERROR: createMessage falló para Conv ID ${conversation.id} (Modo: ${dataIn.mode})`);
             // Aunque falle el registro, devolvemos el ID de conversación para que el flujo continúe si es posible
        }
        // --- FIN MODIFICACIÓN ---

        // Siempre devolvemos el ID de la conversación encontrada o creada
        return conversation.id;

    } catch (error) {
        console.error('[handleMessage] ERROR al procesar mensaje:', error);
        return null;
    }
};

export { handleMessage };