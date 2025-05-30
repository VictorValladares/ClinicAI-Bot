import { supabase } from './supabaseService';

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

/**
 * Gets the custom prompt for a specific tenant
 */
export async function getTenantPrompt(tenantId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('tenant_config')
      .select('prompt')
      .eq('user_id', tenantId)
      .maybeSingle();
      
    if (error) {
      console.error('Error fetching tenant prompt:', error);
      return null;
    }
    
    return data?.prompt || null;
  } catch (err) {
    console.error('Error inesperado en getTenantPrompt:', err);
    return null;
  }
}

/**
 * Busca un tenant por su número de WhatsApp normalizado o sin normalizar
 */
export async function getTenantByNumberId(numberId: string) {
  try {
    // Primero intentamos con el número normalizado
    const normalizedNumber = normalizePhone(numberId);
    
    // Verificamos en la columna phone_normalized (que debería contener 15550867725)
    const { data, error } = await supabase
      .from('tenant_config')
      .select('*')
      .eq('phone_normalized', normalizedNumber)
      .maybeSingle();
      
    if (error) {
      console.error('Error completo:', error);
      return null;
    }
    
    // Si encontramos el tenant, lo devolvemos
    if (data) {
      return data;
    }
    
    // Como segunda opción, buscamos por number_id
    const result = await supabase
      .from('tenant_config')
      .select('*')
      .eq('number_id', numberId)
      .maybeSingle();
    
    if (result.error) {
      console.error('Error buscando por number_id:', result.error);
      return null;
    }
    
    return result.data;
  } catch (err) {
    console.error('Error inesperado:', err);
    return null;
  }
}

/**
 * Busca un tenant por su user_id (para clientes y citas)
 */
export async function getTenantByUserId(userId: string) {
  try {
    const { data, error } = await supabase
      .from('tenant_config')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
      
    if (error) {
      console.error('Error fetching tenant by user ID:', error);
      return null;
    }
    
    return data;
  } catch (err) {
    console.error('Error inesperado en getTenantByUserId:', err);
    return null;
  }
}

/**
 * Crea un nuevo tenant en el sistema
 */
export async function createTenant(tenantData: {
  number_id: string;
  user_id: string;
  clinic_name: string;
  jwt_token: string;
  verify_token: string;
  settings?: Record<string, any>;
}) {
  const { data, error } = await supabase
    .from('tenant_config')
    .insert([tenantData])
    .select();
    
  if (error) {
    console.error('Error creating tenant:', error);
    return null;
  }
  return data[0];
}