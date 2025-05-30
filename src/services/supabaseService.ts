import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Usar la URL y clave correctas desde el archivo .env
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

// Crear el cliente con opciones avanzadas
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    headers: {
      // Asegurar que estamos usando el rol de servicio
      Authorization: `Bearer ${supabaseKey}`
    }
  }
});

// Verificamos que la conexión funcione al iniciar la app
(async () => {
  try {
    const { data, error } = await supabase
      .from('tenant_config')
      .select('clinic_name')
      .limit(1);
      
    if (error) {
      console.error('Error al conectar con Supabase:', error);
    } else {
      console.log('Conexión a Supabase establecida correctamente');
    }
  } catch (err) {
    console.error('Error crítico al conectar con Supabase:', err);
  }
})();

/**
 * Confirma una cita actualizando su estado a "confirmed" en la tabla "appointments".
 *
 * @param date - Fecha/hora de la cita a confirmar (formato ISO).
 * @param tenantId - ID del tenant al que pertenece la cita.
 */
export async function confirmAppointment({ date, tenantId }: { date: string; tenantId: string }) {
  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'confirmed' })
    .eq('date', date)
    .eq('user_id', tenantId) // Añadimos filtro por tenant
    .select();
    
  return { data, error };
}