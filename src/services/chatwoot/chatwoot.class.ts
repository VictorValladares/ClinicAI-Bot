import { readFile } from 'fs/promises';
import fetch from 'node-fetch';
import FormData from 'form-data';
import mime from 'mime-types';
import { config } from '~/config';

class ChatwootClass {
    config: {account?: string, token?: string, endpoint?: string};

    /**
     * Recibir todos los parametros de configuracion de conexion con chatwoot
     */
    constructor(
        _config: {account?: string, token?: string, endpoint?: string} = {}
    ) {
        if (!_config?.account){
            throw new Error("ACCOUNT_ERROR");
        }
        if (!_config?.token){
            throw new Error("TOKEN_ERROR");
        }
        if (!_config?.endpoint){
            throw new Error("ENDPOINT_ERROR");
        }
        this.config = _config;
    }
    
    /**
     * [utility]
     * Formateo del numero +34 34
     * @param {*} number
     * @returns
     */
    formatNumber = (number: any) => {
        if(!number.startsWith('+')){
            return `+${number}`;
        }
        return number;
    };

    /**
     * [utility]
     * Esta funcion nos ayuda a crear un encabezado con la autorizacion del token
     * @returns {Object} - Encabezados con token de autorización
     */
    buildHeader = () => {
        const headers = {
            'api_access_token': this.config.token,
            'Authorization': `Bearer ${this.config.token}`,
            'Content-Type': 'application/json'
        };
        return headers;
    };

    /**
     * [utility]
     * Esta funcion nos ayuda a construir la url base
     * @params {*} path
     * @returns
     */
    buildUrl = (path: string) => {
        const cleanPath = path.startsWith('/') ? path.substring(1) : path;
        const url = `${this.config.endpoint}/api/v1/accounts/${this.config.account}/${cleanPath}`;
        return url;
    };

    /**
     * [searchByNumber]
     * Busca un contacto por numero de telefono
     * @params {*} from
     * @returns
     */
    findContact = async (from: string) => {
        try {
            const phone = this.formatNumber(from);
            const url = this.buildUrl(`contacts/search?q=${encodeURIComponent(phone)}`);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: this.buildHeader()
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Error en la búsqueda de contacto: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            
            if (data && data.payload && Array.isArray(data.payload)) {
                const exactMatch = data.payload.find((contact: any) => 
                    contact.phone_number === phone || 
                    (contact.phone_numbers && contact.phone_numbers.includes(phone))
                );
                
                if (exactMatch) {
                    return exactMatch;
                } else {
                    return null;
                }
            }
            
            return null;
        } catch (error) {
            console.error(`[Error findContact]`,error);
            return null;
        }
    }

    /**
     * [createContact]
     * Crea un contacto en chatwoot
     * @params {*} from
     * @returns
     */
    createContact = async (dataIn = { from: "", name: "", inbox: ""}) => {
        try {
            dataIn.from = this.formatNumber(dataIn.from);
            
            const data = {
                inbox_id: dataIn.inbox,
                name: dataIn.name,
                phone_number: dataIn.from,
                identifier: dataIn.from
            }

            const url = this.buildUrl(`contacts`);

            const dataFetch = await fetch(url, {
                headers: this.buildHeader(),
                method: "POST",
                body: JSON.stringify(data)
            });

            if (!dataFetch.ok) {
                const errorText = await dataFetch.text();
                throw new Error(`Error al crear contacto: ${dataFetch.status} - ${errorText}`);
            }

            const response = await dataFetch.json();
            
            if (response && response.payload && response.payload.contact) {
                return response.payload.contact;
            } else {
                console.error('[createContact] Respuesta no tiene el formato esperado:', response);
                throw new Error('Formato de respuesta inválido al crear contacto');
            }
        } catch (error) {
            console.error(`[Error createContact]`,error);
            return null;
        }
    }

    /**
     * [CONTACT]
     * Buscar o crear contacto
     * @params {*} dataIn
     * @returns
     */
    findOrCreateContact = async (
        dataIn: any = { from: "", name: "", inbox: ""}
    ) => {
        try {
            dataIn.from = this.formatNumber(dataIn.from);
            const getContact = await this.findContact(dataIn.from);
            
            if (!getContact) {
                const newContact = await this.createContact(dataIn);
                
                if (!newContact) {
                    throw new Error('No se pudo crear el contacto');
                }
                
                return newContact;
            }
            
            return getContact;
        } catch (error) {
            console.error(`[Error findOrCreateContact]`, error);
            throw new Error(`Error al buscar o crear contacto: ${error}`);
        }
    }

    /**
     * [CONVERSATION]
     * Importante crear este atributo personalizado en chatwoot
     * @params {*} dataIn
     * @returns
     */
    createConversation = async (dataIn: {
        inbox_id: string;
        contact_id: string;
        phone_number: string;
    }) => {
        try {
            const phoneNumberWithoutPlus = dataIn.phone_number.replace('+', '');
            const payload = {
                inbox_id: dataIn.inbox_id,
                contact_id: dataIn.contact_id,
                source_id: phoneNumberWithoutPlus, 
                phone_number: dataIn.phone_number,
            }

            const url = this.buildUrl(`conversations`);
            
            const dataFetch = await fetch(url, {
                headers: this.buildHeader(),
                method: "POST",
                body: JSON.stringify(payload)
            }); 

            if (!dataFetch.ok) {
                const errorText = await dataFetch.text();
                throw new Error(`Error al crear conversación: ${dataFetch.status} - ${errorText}`);
            }

            const response = await dataFetch.json();
            
            const conversation = (response?.payload?.conversation || response?.id) ? (response.payload?.conversation || response) : null;
            if (conversation) {
                return conversation;
            } else {
                console.error(`[createConversation] Respuesta no tiene el formato esperado:`, response);
                throw new Error('Formato de respuesta inválido al crear conversación');
            }
        } catch (error) {
            console.error(`[Error createConversation]`, error);
            throw new Error(`Error al crear conversación: ${error}`);
        }
    }

    /**
     * 
     */

    setCustomAttributes = async () => {
        try {
            const attribute = {
                attribute_description: "phone_number",
                attribute_key: "phone_number", 
                attribute_values: [""],
                attribute_model: 0,
            };

            const url = this.buildUrl(`/custom_attributes_definitions`);
            
            const response = await fetch(url, {
                method: "POST",
                headers: this.buildHeader(),
                body: JSON.stringify(attribute)
            });

            const data = await response.json();
            return data;
        } catch (error) {
            console.error(`[Error setCustomAttributes]`, error);
            return;
        }
    }

    /**
     * [CUSTOM_ATTRIBUTES]
     * Obtener atributos personalizados
     * @params {*} dataIn
     * @returns
     */
    getAttributes = async () => {
        try {
            const url = this.buildUrl(`/custom_attributes_definitions`);

            const dataFetch = await fetch(url, {
                headers: this.buildHeader(),
                method: "GET"
            });

            const data = await dataFetch.json();
            return data;
        } catch (error) {
            console.error(`[Error getAttributes]`, error);
            return [];
        }
    }

    checkAndSetAttribute = async () => {
        try {
            const existingAttributes: any[] = (await this.getAttributes()) as any[];

            const attributeExists = existingAttributes.some(
                (attr: any) => attr.attribute_key === "attribute.attribute_key"
            );

            if (!attributeExists) {
                await this.setCustomAttributes();
                return;
            } else {
                return;
            }
        } catch (error) {
            console.error(`[Error checkAndSetAttribute]`, error);
        }
    }

    /**
     * [CONVERSATION]
     * Buscar si existe una conversacion previa (Workaround para error 500 en /filter)
     * @params {*} dataIn
     * @returns
     */
    findConversation = async (dataIn: {
        contact_id: string;
        inbox_id: string;
    }) => {
        try {
            const url = this.buildUrl(`contacts/${dataIn.contact_id}/conversations`);
            
            const response = await fetch(url, {
                method: "GET",
                headers: this.buildHeader()
            });

            if (!response.ok) {
                const errorText = await response.text();
                if (response.status === 404) {
                    return null;
                }
                throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            
            const conversationsArray = data?.payload; 

            if (conversationsArray && Array.isArray(conversationsArray)) {
                const openConversations = conversationsArray.filter(conv => 
                    conv.inbox_id === parseInt(dataIn.inbox_id, 10) && 
                    (conv.status === 'open' || conv.status === 'pending')
                );

                if (openConversations.length > 0) {
                    openConversations.sort((a, b) => b.id - a.id);
                    return [openConversations[0]];
                } else {
                    return null; 
                }
            } else {
                 console.warn(`[findConversation Workaround] Respuesta no tiene el formato esperado (array):`, data);
                return null; 
            }
        } catch (error: any) {
            console.error(`[Error findConversation Workaround]`, error.message);
            return null;
        }
    };

    /**
     * [CONVERSATION]
     * Buscar o crear una conversacion
     * @params {*} dataIn
     * @returns
     */
    findOrCreateConversation = async (dataIn: {
        inbox_id: string;
        contact_id: string;
        phone_number: string;
    }) => {
        try {
            if (!dataIn.inbox_id || !dataIn.contact_id || !dataIn.phone_number) {
                throw new Error('Se requieren inbox_id, contact_id y phone_number para crear una conversación');
            }
            
            dataIn.phone_number = this.formatNumber(dataIn.phone_number);
            
            try {
                const existingResult = await this.findConversation({
                    contact_id: dataIn.contact_id,
                    inbox_id: dataIn.inbox_id 
                });
                
                if (existingResult && Array.isArray(existingResult) && existingResult.length > 0) {
                    return existingResult[0];
                }
                
                const newConversation = await this.createConversation(dataIn);
                return newConversation;
            } catch (searchError) {
                console.error(`[findOrCreateConversation] Error al buscar/crear conversación:`, searchError);
                throw searchError; 
            }
        } catch (error) {
            console.error(`[Error findOrCreateConversation]`, error);
            throw new Error(`Error al buscar o crear conversación: ${error}`);
        }
    };

    createInbox = async (dataIn = { name: ""}) => {
        try {
            const payload = {
                name: dataIn.name,
                channel: {
                    type: "api",
                    webhook_url: "",
                },
            };

            const url = this.buildUrl(`inboxes`);
            
            const dataFetch = await fetch(url, {
                headers: this.buildHeader(),
                method: "POST",
                body: JSON.stringify(payload),
            });

            if (!dataFetch.ok) {
                const errorText = await dataFetch.text();
                throw new Error(`Error al crear inbox: ${dataFetch.status} - ${errorText}`);
            }

            const data = await dataFetch.json();
            return data;
        } catch (error) {
            console.error(`[Error createInbox]`, error);
            return null;
        }
    };

    /**
     * [inboxes]
     * Buscar si existe un ibox creado
     * @params {*} dataIn
     * @returns
     */
    findInbox = async (dataIn = { name: ""}) => {
        try {
            const url = this.buildUrl(`inboxes`);
            
            const dataFetch = await fetch(url, {
                headers: this.buildHeader(),
                method: "GET",
            });

            if (!dataFetch.ok) {
                const errorText = await dataFetch.text();
                throw new Error(`Error al buscar inbox: ${dataFetch.status} - ${errorText}`);
            }

            const data = await dataFetch.json();
            
            if (!data || !data.payload || !Array.isArray(data.payload)) {
                console.warn(`[findInbox] La respuesta no tiene el formato esperado:`, data);
                return null;
            }

            const payload = data.payload;
            const checkIfExists = payload.find(
                (o: {name: string}) => o.name === dataIn.name
            );

            if (!checkIfExists) {
                return null;
            }

            return checkIfExists;
        } catch (error) {
            console.error(`[Error findInbox]`, error);
            return null;
        }
    };

    /**
     * [inboxes]
     * Buscar o crear un inbox
     * @params {*} dataIn
     * @returns
     */
    findOrCreateInbox = async (dataIn = { name: ""}) => {
        try {
            const getInbox = await this.findInbox(dataIn);
            if (!getInbox) {
                const newInbox = await this.createInbox(dataIn);
                return newInbox;
            }
            
            return getInbox;
        } catch (error) {
            console.error(`[Error findOrCreateInbox]`, error);
            return null;
        }
    };

    /**
     * [message]
     * Crear un mensaje en una conversación
     * @params {*} dataIn
     * @returns
     */
    createMessage = async (dataIn: {
        msg: string;
        mode: 'incoming' | 'outgoing'; // Aceptar explícitamente los modos
        conversation_id: string;
        attachment?: any[];
    }) => {
        try {
            // Si es un mensaje saliente del bot, añadir prefijo para identificarlo fácilmente
            let messageContent = dataIn.msg;
            if (dataIn.mode === 'outgoing') {
                // Solo añadir prefijo si es mensaje del bot y no tiene ya un identificador
                const botIdentifier = '[BOT] ';
                if (!messageContent.startsWith(botIdentifier)) {
                    messageContent = botIdentifier + messageContent;
                }
            }

            const payload: any = {
                content: messageContent,
                message_type: dataIn.mode, // Usar el modo para determinar el tipo
                private: false,
                sender_type: dataIn.mode === 'outgoing' ? 'bot' : 'contact' // Marcar explícitamente como bot si es outgoing
            };

            if (dataIn.attachment && dataIn.attachment.length > 0) {
                payload.attachments = dataIn.attachment;
            }

            // NOTE: Constructing URL directly here for createMessage, not using buildUrl. Let's log this specific URL.
            const url = `${this.config.endpoint}/api/v1/accounts/${this.config.account}/conversations/${dataIn.conversation_id}/messages`;

            const headers = {
                'api_access_token': this.config.token,
                'Authorization': `Bearer ${this.config.token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };



            const response = await fetch(url, {
                method: "POST",
                headers: headers,
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[ChatwootClass] Error HTTP ${response.status} al enviar mensaje a Chatwoot: ${errorText}`);
                console.error(`[ChatwootClass] Payload que causó el error:`, JSON.stringify(payload, null, 2));
                throw new Error(`Error al crear mensaje: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            await new Promise(resolve => setTimeout(resolve, 50)); // Delay mínimo

            return data;
        } catch (error) {
            console.error(`[Error createMessage]`, error);
            return null;
        }
    };

    /**
     * [attribute]
     * Crear atributo personalizado si no existe
     */
    checkAndSetCustomAttribute = async () => {
        try {
            await this.checkAndSetAttribute();
            return true;
        } catch (error) {
            console.error(`[Error checkAndSetCustomAttribute]`, error);
            return false;
        }
    };
}

export { ChatwootClass };