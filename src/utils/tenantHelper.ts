import { getTenantByNumberId, getTenantByUserId } from '../services/tenantService';
import { supabase } from '../services/supabaseService';

/**
 * Helper para identificar el tenant basado en el mensaje o el número del cliente
 */

/**
 * Normalizes a phone number by removing non-numeric characters and optionally the leading '+'.
 * @param phoneNumber The phone number string to normalize.
 * @returns The normalized phone number string.
 */
export function normalizePhone(phoneNumber: string): string {
  if (!phoneNumber) return '';
  
  // Eliminar todos los caracteres no numéricos
  return phoneNumber.replace(/[^\d+]/g, '')
                   .replace(/^\+/, ''); // Opcionalmente quita el + inicial si existe
}

export async function identifyTenant(ctx: any) {
  try {
    // Método 1: Intentar identificar por el número de destino (tradicional)
    const toNumberRaw = ctx.to || 
                       ctx.key?.remoteJid ||
                       ctx.message?.to || 
                       ctx.message?.recipient_id;
    
    if (toNumberRaw) {
      // Normalizar el número para comparación
      const toNumber = normalizePhone(toNumberRaw);
      
      const tenant = await getTenantByNumberId(toNumber);
      if (tenant) {
        return {
          id: tenant.user_id,
          clinicName: tenant.clinic_name,
          numberId: tenant.number_id,
          settings: tenant.settings || {}
        };
      }
    }
    
    // Método 2: Intentar identificar por el número del remitente
    const fromNumber = ctx.from || 
                      (ctx.key?.remoteJid ? normalizePhone(ctx.key.remoteJid.split('@')[0]) : null);
    
    if (fromNumber) {
      // Primero buscamos si este cliente ya existe en alguna clínica
      const { data, error } = await supabase
        .from('clients')
        .select('user_id')
        .eq('phone', fromNumber)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (!error && data && data.length > 0) {
        const tenantId = data[0].user_id;
        const tenant = await getTenantByUserId(tenantId);
        
        if (tenant) {
          return {
            id: tenant.user_id,
            clinicName: tenant.clinic_name,
            numberId: tenant.number_id,
            settings: tenant.settings || {}
          };
        }
      }
    }
    
    // Método 3: Usar el tenant por defecto si todo lo demás falla
    if (process.env.DEFAULT_TENANT_ID) {
      const tenant = await getTenantByUserId(process.env.DEFAULT_TENANT_ID);
      
      if (tenant) {
        return {
          id: tenant.user_id,
          clinicName: tenant.clinic_name,
          numberId: tenant.number_id,
          settings: tenant.settings || {}
        };
      }
    }
    
    console.error('No se pudo identificar el tenant');
    return null;
  } catch (error) {
    console.error('Error in tenant identification:', error);
    return null;
  }
}