import { DateTime } from 'luxon';
import aiServices from "~/services/aiServices"
import { config } from "~/config";

// Convierte una fecha en formato ISO a un texto legible.
// @param {string} iso - Fecha en formato ISO.
// @returns {string} - Fecha en formato legible.
function iso2Text(iso: string): string {
  try {
    // Convertir la fecha a DateTime de Luxon
    const dateTime = DateTime.fromISO(iso, { zone: 'utc' }).setZone('Europe/Madrid');
    // Formatear la fecha
    const formattedDate = dateTime.toLocaleString({
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    });
    return formattedDate;
  } catch (error) {
    console.error('Error al convertir la fecha:', error);
    return 'Formato de fecha no válido';
  }
}

function formatDate(date: Date): string {
  try {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      timeZone: 'Europe/Madrid'
    };

    return new Intl.DateTimeFormat('es-ES', options).format(date);
  } catch (error) {
    console.error('Error al convertir la fecha:', error);
    return 'Formato de fecha no válido';
  }
}

async function text2Iso(text: string): Promise<string> {
  const currentDate = new Date();
  const service = new aiServices(config.apiKey); // Use config instead of process.env
  const prompt = `La fecha de hoy es: ${currentDate}. Te voy a dar un texto. 
  Necesito que ese texto extraigas la fecha y la hora del texto que te voy a dar y respondas con las misma en formato ISO.
  Me tienes que responder EXCLUSIVAMENTE con esa fecha y horarios en formato ISO, usando el horario 10:00 en caso de que no este especificada la hora.
  Por ejemplo, el texto puede ser algo como "el jueves 30 de mayo a las 12hs". En ese caso tu respuesta tiene que ser "2024-06-30T12:00:00.000"
  Por ejemplo, el texto puede ser algo como "Este viernes 31". En ese caso tu respuesta tiene que ser "2024-06-31T10:00:00.000"
  Si el texto es algo como: Mañana 10am, sumarle un día a la fecha actual y dar eso como resultado.
  Si el texto no tiene sentido, responde 'false'`;

  const messages = [{ role: 'user', content: text }];
  const response = await service.chat(prompt, messages);
  
  return response.trim();
}

export { formatDate, text2Iso, iso2Text };