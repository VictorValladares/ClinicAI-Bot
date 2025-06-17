// chatwootCtrl.ts – añade /bot status para consultar la blacklist
import axios from 'axios';
import { config } from '~/config';

// --- Constantes de Meta ---
const META_API_VERSION = process.env.META_API_VERSION || 'v22.0';

/* -------------------------------------------------------------------------- */
/*  Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Envía un mensaje de WhatsApp mediante la API de Meta.
 */
async function sendWhatsAppMessage(phone: string, message: string): Promise<any> {
  try {
    let formattedPhone = phone.replace(/[\s\-()]/g, '');
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = `+${formattedPhone}`;
    }

    const numberId = process.env.META_NUMBER_ID;
    const accessToken = process.env.META_JWT_TOKEN;

    if (!numberId || !accessToken) {
      throw new Error('Faltan credenciales de WhatsApp (META_NUMBER_ID o META_JWT_TOKEN) en .env');
    }

    const metaApiUrl = `https://graph.facebook.com/${META_API_VERSION}/${numberId}/messages`;
    const metaPayload = {
      messaging_product: 'whatsapp',
      to: formattedPhone,
      type: 'text',
      text: { body: message },
    };

    const response = await axios.post(metaApiUrl, metaPayload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  } catch (error: any) {
    console.error(`❌ [Webhook Handler] Error al enviar mensaje de agente a WhatsApp (${phone}):`, error.message);
    if (error.response?.data) {
      console.error('   Detalles API Meta:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

/**
 * Envía una *nota privada* al hilo de Chatwoot para que el agente vea la respuesta
 * del comando (/bot status). No se muestra al cliente.
 */
async function sendChatwootNote(conversationId: number, content: string) {
  try {
    const endpoint = config.CHATWOOT_ENDPOINT;
    const accountId = config.CHATWOOT_ACCOUNT_ID;
    const apiToken = config.CHATWOOT_TOKEN;

    if (!endpoint || !accountId || !apiToken) {
      console.warn('[Webhook Handler] No se pudo enviar nota: faltan CHATWOOT_ENDPOINT, CHATWOOT_ACCOUNT_ID o API token');
      return;
    }

    const url = `${endpoint}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;

    await axios.post(
      url,
      { content, private: true, message_type: 'outgoing' },
      { headers: { 'api_access_token': apiToken, 'Content-Type': 'application/json' } },
    );
  } catch (noteErr) {
    console.error('[Webhook Handler] ❌ Error enviando nota de Chatwoot:', noteErr);
  }
}

/* -------------------------------------------------------------------------- */
/*  Tipos y extensión de objeto global                                         */
/* -------------------------------------------------------------------------- */

interface GlobalBot {
  dynamicBlacklist?: {
    data: Set<string>;
    add(phone: string): void;
    remove(phone: string): void;
    checkIf(phone: string): boolean;
  };
  addBlacklist?: (phone: string) => Promise<boolean>;
}

declare global {
  interface Global {
    bot: GlobalBot;
  }
}

/* -------------------------------------------------------------------------- */
/*  Controlador de Webhook de Chatwoot                                         */
/* -------------------------------------------------------------------------- */

export const chatwootCtrl = async (bot: any, req: any, res: any) => {
  const body = req.body;
  const event = body?.event;

  try {
    /* ------------------- Garantizar existencia de utilidades ------------------ */

    if (!bot.addBlacklist) {
      console.warn('⚠️ [Webhook Handler] bot.addBlacklist no está definido. Implementando sustituto.');
      bot.addBlacklist = async (phone: string) => {
        if (!bot.dynamicBlacklist) {
          bot.dynamicBlacklist = {
            data: new Set<string>(),
            add(phone: string) {
              this.data.add(phone);
            },
            remove(phone: string) {
              this.data.delete(phone);
            },
            checkIf(phone: string) {
              return this.data.has(phone);
            },
          };
          global.bot = bot;
        }
        bot.dynamicBlacklist.add(phone);
        return true;
      };
    }

    if (!bot.dynamicBlacklist) {
      console.warn('⚠️ [Webhook Handler] bot.dynamicBlacklist no está definido. Implementando sustituto.');
      bot.dynamicBlacklist = {
        data: new Set<string>(),
        add(phone: string) {
          this.data.add(phone);
        },
        remove(phone: string) {
          this.data.delete(phone);
        },
        checkIf(phone: string) {
          return this.data.has(phone);
        },
      };
      global.bot = bot;
    }

    /* ------------------------------ Manejo eventos ---------------------------- */

    if (event === 'conversation.created') {
      const mapperAttributes = body?.changed_attributes?.map((a: any) => Object.keys(a)).flat(2);
      if (mapperAttributes?.includes('assignee_id')) {
        const phone = body?.meta?.sender?.phone_number?.replace('+', '');
        const idAssignee = body?.changed_attributes[0]?.assignee_id?.current_value ?? null;
        if (phone && idAssignee) {
          await bot.addBlacklist(phone);
        } else if (phone && bot.dynamicBlacklist.checkIf(phone) && !idAssignee) {
          bot.dynamicBlacklist.remove(phone);
        }
      }
    } else if (event === 'conversation.updated') {
      // Conversación resuelta ⇒ quitar de blacklist y disparar flowGracias
      if (body?.status === 'resolved') {
        const phone = body?.meta?.sender?.phone_number?.replace('+', '');
        if (phone && bot.dynamicBlacklist.checkIf(phone)) {
          bot.dynamicBlacklist.remove(phone);
          fetch(`${config.BOT_URL}/v1/flowGracias`, {
            method: 'POST',
            body: JSON.stringify({ number: phone, name: 'Cliente' }),
            headers: { 'Content-Type': 'application/json' },
          }).catch((err) => console.error('[Webhook Handler] Error llamando a flowGracias:', err));
        }
      }

      // Cambio de asignación de agente
      const assignmentChange = body?.changed_attributes?.find((attr: any) => attr?.assignee_id !== undefined);
      if (assignmentChange) {
        const phone = body?.meta?.sender?.phone_number?.replace('+', '');
        const idAssignee = assignmentChange?.assignee_id?.current_value ?? null;
        const previousAssignee = assignmentChange?.assignee_id?.previous_value ?? null;
        if (phone && idAssignee && !previousAssignee) {
          await bot.addBlacklist(phone);
        } else if (phone && !idAssignee && previousAssignee) {
          bot.dynamicBlacklist.remove(phone);
        }
      }
    }
    /* ------------------------- Mensaje outgoing público ------------------------ */
    else if (event === 'message_created' && body.message_type === 'outgoing' && body.private !== true) {
      const isBotMessage =
        body.sender?.name === 'Bot' ||
        body.sender?.type === 'bot' ||
        !body.sender ||
        (body.content && body.content.includes('ClinicAI:')) ||
        (body.content && body.content.startsWith('[BOT]'));

      if (!isBotMessage) {
        let recipientPhone = body.conversation?.meta?.sender?.phone_number;
        if (!recipientPhone && body.conversation?.meta?.user?.phone_number) {
          recipientPhone = body.conversation.meta.user.phone_number;
        }
        const messageContent = body.content || '';

        if (recipientPhone && messageContent.trim()) {
          try {
            await sendWhatsAppMessage(recipientPhone, messageContent);
          } catch (error) {
            console.error(`[Webhook Handler] ❌ Error al enviar mensaje de agente a WhatsApp (${recipientPhone}):`, error);
          }
        }
      }
    }
    /* ---------------------------- Nota privada agente -------------------------- */
    else if (event === 'message_created' && body.private === true) {
      const messageContent = (body.content || '').trim().toLowerCase();
      const recipientPhone = body.conversation?.meta?.sender?.phone_number?.replace('+', '');

      if (recipientPhone && messageContent) {
        // 🔴 Pausar bot
        if (messageContent === '/bot off' || messageContent === '/pausar bot') {
          await bot.addBlacklist(recipientPhone);
          await sendChatwootNote(body.conversation.id, '🔴 Bot *pausado* para este cliente.');
        }
        // 🟢 Activar bot
        else if (messageContent === '/bot on' || messageContent === '/activar bot') {
          bot.dynamicBlacklist.remove(recipientPhone);
          await sendChatwootNote(body.conversation.id, '🟢 Bot *activado* para este cliente.');
        }
        // ℹ️ Estado del bot
        else if (messageContent === '/bot status' || messageContent === '/estado bot') {
          const isPaused = bot.dynamicBlacklist.checkIf(recipientPhone);
          const statusMsg = isPaused
            ? '🔴 Bot está *pausado* para este cliente.'
            : '🟢 Bot está *activo* para este cliente.';
          await sendChatwootNote(body.conversation.id, statusMsg);
        }
      }
    }
    /* ----------------------- CSAT (encuesta de satisfacción) ------------------- */
    else if (
      event === 'message_created' &&
      body.content_type === 'input_csat' &&
      body.conversation?.channel.includes('Channel::Api') &&
      body.private === false &&
      body.content?.includes('Por favor califica esta conversacion') &&
      body.conversation?.status === 'resolved'
    ) {
      const phone = body.conversation?.meta?.sender?.phone_number?.replace('+', '');
      const content = body?.content ?? '';

      // Reemplazar URLs locales que puedan quedar en el mensaje CSAT
      const urlsToReplace = [
        { oldUrl: 'https://0.0.0.0', newUrl: config.CHATWOOT_ENDPOINT },
        { oldUrl: 'https://127.0.0.1', newUrl: config.CHATWOOT_ENDPOINT },
      ];

      const escapeRegex = (str: string) =>
        str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

      let updatedContent = content;
      urlsToReplace.forEach(({ oldUrl, newUrl }) => {
        updatedContent = updatedContent.replace(
          new RegExp(escapeRegex(oldUrl), 'gi'),
          newUrl,
        );
      });

      // Enviar CSAT vía provider.sendMessage (si existe)
      if (phone && bot.provider?.sendMessage) {
        try {
          await bot.provider.sendMessage(phone, updatedContent, {});
        } catch (csatError) {
          console.error(`[Webhook Handler] ❌ Error enviando CSAT via provider a ${phone}:`, csatError);
        }
      }

      // Disparar flowGracias si el cliente no está en blacklist
      if (phone && !bot.dynamicBlacklist.checkIf(phone)) {
        fetch(`${config.BOT_URL}/v1/flowGracias`, {
          method: 'POST',
          body: JSON.stringify({ number: phone, name: 'Cliente' }),
          headers: { 'Content-Type': 'application/json' },
        }).catch((err) => console.error('[Webhook Handler] Error llamando a flowGracias:', err));
      }
    }

    /* --------------------------- Respuesta al webhook -------------------------- */

    res.statusCode = 200;
    res.end('ok');
  } catch (error) {
    console.error('[Webhook Handler] ❌ Error general en el controlador de Chatwoot:', error);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
};
