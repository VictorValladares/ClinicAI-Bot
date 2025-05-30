import { supabase } from './supabaseService';

/**
 * Busca un cliente por teléfono, filtrando por el tenant actual
 */
export async function getClientByPhone(phone: string, tenantId: string) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('phone', phone)
    .eq('user_id', tenantId)
    .single();
    
  if (error) {
    console.error('Error fetching client by phone:', error);
    return null;
  }
  return data;
}

/**
 * Inserta un nuevo cliente, asociándolo al tenant actual
 */
export async function insertClient({ 
  phone, 
  name, 
  email, 
  tenantId 
}: { 
  phone: string; 
  name: string; 
  email: string; 
  tenantId: string;
}) {
  const { data, error } = await supabase
    .from('clients')
    .insert([{ phone, name, email, user_id: tenantId }])
    .select();
    
  if (error) {
    console.error('Error inserting client:', error);
    return null;
  }
  return data[0];
}

/**
 * Obtiene todos los clientes de un tenant
 */
export async function getClientsByTenant(tenantId: string) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('user_id', tenantId)
    .order('created_at', { ascending: false });
    
  if (error) {
    console.error('Error fetching clients:', error);
    return [];
  }
  return data;
}