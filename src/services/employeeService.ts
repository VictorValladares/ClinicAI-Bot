import { supabase } from './supabaseService';

/**
 * Obtiene los empleados con un rol específico, filtrando por tenant.
 */
export async function getEmployeesByRole(role: string, tenantId: string) {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('role', role)
    .eq('user_id', tenantId); // Filtra por tenant

  if (error) {
    console.error('Error fetching employees by role:', error);
    return [];
  }
  return data;
}

/**
 * Comprueba la disponibilidad de una cita filtrado por tenant
 */
export async function checkAppointmentAvailability(date: string, employee_id: string | null = null, tenantId: string) {
  // 1. Verificar que la fecha de la cita sea mayor que la fecha actual.
  const appointmentDate = new Date(date);
  const now = new Date();
  if (appointmentDate <= now) {
    console.warn('La fecha solicitada está en el pasado o es igual a la fecha actual.');
    return false;
  }

  // 2. Verificar conflictos: si ya existe alguna cita en esa franja para el mismo tenant
  const { data, error } = await supabase
    .from('appointments')
    .select('id, employee_id, date')
    .eq('date', date)
    .eq('user_id', tenantId); // Filtra por tenant
    
  if (error) {
    console.error('Error checking appointment availability:', error);
    return false;
  }
  
  // Verificar conflictos como antes
  if (data && data.length > 0) {
    if (employee_id === null) {
      return false;
    } else {
      const conflict = data.find((app: any) => app.employee_id === null || app.employee_id === employee_id);
      if (conflict) return false;
    }
  }
  
  // 3. Verificar horario del empleado (solo si pertenece al tenant)
  if (employee_id) {
    const { data: empData, error: empError } = await supabase
      .from('employees')
      .select('schedule')
      .eq('id', employee_id)
      .eq('user_id', tenantId) // Filtra por tenant
      .single();

    if (empError) {
      console.error('Error fetching employee schedule:', empError);
      return false;
    }

    // Verificar horario como antes
    if (!empData || !empData.schedule) {
      return true;
    }

    // ... resto del código existente para verificar el horario
    const schedule = empData.schedule;
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[appointmentDate.getDay()];
    const appointmentTime = appointmentDate.toTimeString().slice(0, 5);
    
    let withinSchedule = false;
    for (const slot of schedule) {
      if (slot.day.toLowerCase() === dayName.toLowerCase()) {
        if (appointmentTime >= slot.start && appointmentTime <= slot.end) {
          withinSchedule = true;
          break;
        }
      }
    }
    if (!withinSchedule) {
      return false;
    }
  }
  
  return true;
}