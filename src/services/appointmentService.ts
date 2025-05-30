import { supabase } from './supabaseService';

/**
 * Obtiene todas las citas de un tenant
 */
export async function getAppointmentsByTenant(tenantId: string) {
  const { data, error } = await supabase
    .from('appointments')
    .select(`
      *,
      client:client_id (name, phone, email)
    `)
    .eq('user_id', tenantId)
    .order('date', { ascending: true });
    
  if (error) {
    console.error('Error fetching appointments:', error);
    return [];
  }
  return data;
}

/**
 * Crea una nueva cita, asociándola al tenant actual
 */
export async function createAppointment({
  client_id,
  employee_id,
  date,
  status,
  notes,
  tenantId
}: {
  client_id: string;
  employee_id: string;
  date: string;
  status: string;
  notes: string;
  tenantId: string;
}) {
  const { data, error } = await supabase
    .from('appointments')
    .insert([{
      client_id,
      employee_id,
      date,
      status,
      notes,
      user_id: tenantId
    }])
    .select();
    
  if (error) {
    console.error('Error creating appointment:', error);
    return null;
  }
  return data[0];
}

/**
 * Busca una cita por su ID y tenantId
 */
export async function findAppointmentById(appointmentId: string, tenantId: string) {
  const { data, error } = await supabase
    .from('appointments')
    .select('*') // Puedes seleccionar campos específicos si lo prefieres
    .eq('id', appointmentId)
    .eq('user_id', tenantId)
    .maybeSingle(); // Esperamos encontrar como máximo una cita

  if (error) {
    console.error(`Error fetching appointment by ID ${appointmentId}:`, error);
    return null;
  }
  return data;
}

/**
 * Actualiza el estado de una cita por su ID y tenantId
 */
export async function updateAppointmentStatus(appointmentId: string, newStatus: string, tenantId: string) {
  const { data, error } = await supabase
    .from('appointments')
    .update({ status: newStatus })
    .eq('id', appointmentId)
    .eq('user_id', tenantId)
    .select(); // Devuelve el registro actualizado

  if (error) {
    console.error(`Error updating appointment status ${appointmentId} to ${newStatus}:`, error);
    return null;
  }
  return data ? data[0] : null; // Devuelve la cita actualizada o null
}

/**
 * Finds the most relevant upcoming appointment for a client based on their phone number.
 * Relevant means: belonging to the tenant, associated with the client's phone,
 * status is 'pending', 'confirmed', or recently 'cancelled' (within 2 hours), and scheduled within the next 48 hours.
 * Returns the ID of the soonest relevant appointment, or null if none found.
 *
 * @param {string} phone - The client's phone number.
 * @param {string} tenantId - The ID of the tenant (user_id in appointments table).
 * @returns {Promise<number | null>} The appointment ID or null.
 */
export async function findRelevantAppointmentForResponseByPhone(phone: string, tenantId: string): Promise<number | null> {
  const now = new Date();
  const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const nowISO = now.toISOString();
  const in48HoursISO = in48Hours.toISOString();

  try {
    const { data, error } = await supabase
      .from('appointments')
      // Select appointment ID and join with clients table to filter by phone
      .select(`
        id,
        status,
        created_at,
        client:client_id (phone)
      `)
      .eq('user_id', tenantId) // Filter by tenant
      .eq('client.phone', phone) // Filter by client's phone number via join
      .in('status', ['pending', 'confirmed', 'cancelled']) // Include cancelled appointments too
      .gte('date', nowISO) // Filter appointments from now onwards
      .lte('date', in48HoursISO) // Filter appointments within the next 48 hours
      .order('date', { ascending: true }) // Get the soonest appointment first
      .limit(5); // Get a few appointments to filter by recency

    if (error) {
      // Handle potential error with the join filter if client table/column differs
      if (error.message.includes('relation "client" does not exist') || error.message.includes('column "phone" does not exist')) {
           console.error(`Error finding relevant appointment: Possible schema mismatch for client join/phone filter. Querying appointments for tenant ${tenantId} and phone ${phone}. Error:`, error);
      } else {
           console.error(`Error finding relevant appointment for phone ${phone}, tenant ${tenantId}:`, error);
      }
      return null;
    }

    if (data && data.length > 0) {
      // Filter logic: 
      // 1. Prefer pending/confirmed appointments
      // 2. If no pending/confirmed, include cancelled appointments only if cancelled within last 2 hours
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      
      // First, look for pending or confirmed appointments
      const activeAppointment = data.find(apt => apt.status === 'pending' || apt.status === 'confirmed');
      if (activeAppointment) {
        return activeAppointment.id as number;
      }
      
      // If no active appointments, look for recently cancelled ones
      // Use created_at as fallback since updated_at might not exist
      const recentlyCancelledAppointment = data.find(apt => {
        if (apt.status !== 'cancelled') return false;
        const createdAt = new Date(apt.created_at);
        return createdAt >= twoHoursAgo;
      });
      
      if (recentlyCancelledAppointment) {
        return recentlyCancelledAppointment.id as number;
      }
    }
    
    // No relevant appointment found
    return null;
  } catch (catchError) {
      console.error(`Unexpected error in findRelevantAppointmentForResponseByPhone for phone ${phone}, tenant ${tenantId}:`, catchError);
      return null;
  }
}