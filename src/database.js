import { createClient } from '@supabase/supabase-js';
import config from './config.js';

const supabase = createClient(config.supabase.url, config.supabase.key);

/**
 * Insert or update tender data in Supabase
 */
export async function saveTender(tenderData) {
  try {
    const { data, error } = await supabase
      .from('tenders')
      .upsert(
        {
          tender_id: tenderData.tender_id,
          tender_number: tenderData.tender_number,
          description: tenderData.description,
          department: tenderData.department,
          tender_type: tenderData.tender_type,
          opening_date: tenderData.opening_date,
          closing_date: tenderData.closing_date,
          tender_value: tenderData.tender_value,
          category: tenderData.category,
          location: tenderData.location,
          document_link: tenderData.document_link,
          status: tenderData.status,
          updated_at: new Date(),
        },
        { onConflict: 'tender_id' }
      )
      .select();

    if (error) {
      console.error('Error saving tender:', error);
      return null;
    }

    console.log('Tender saved:', data);
    return data;
  } catch (error) {
    console.error('Database error:', error);
    return null;
  }
}

/**
 * Get all tenders
 */
export async function getAllTenders(limit = 100, offset = 0) {
  try {
    const { data, error } = await supabase
      .from('tenders')
      .select('*')
      .order('closing_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching tenders:', error);
    return [];
  }
}

/**
 * Get tender by ID
 */
export async function getTenderById(id) {
  try {
    const { data, error } = await supabase
      .from('tenders')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching tender:', error);
    return null;
  }
}

/**
 * Get tenders by department
 */
export async function getTendersByDepartment(department, limit = 50) {
  try {
    const { data, error } = await supabase
      .from('tenders')
      .select('*')
      .eq('department', department)
      .order('closing_date', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching tenders by department:', error);
    return [];
  }
}

/**
 * Get tenders by status
 */
export async function getTendersByStatus(status, limit = 50) {
  try {
    const { data, error } = await supabase
      .from('tenders')
      .select('*')
      .eq('status', status)
      .order('closing_date', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching tenders by status:', error);
    return [];
  }
}

/**
 * Get upcoming tenders (closing soon)
 */
export async function getUpcomingTenders(daysAhead = 7) {
  try {
    const today = new Date();
    const futureDate = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('tenders')
      .select('*')
      .gte('closing_date', today.toISOString())
      .lte('closing_date', futureDate.toISOString())
      .order('closing_date', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching upcoming tenders:', error);
    return [];
  }
}

/**
 * Get total tender count
 */
export async function getTenderCount() {
  try {
    const { count, error } = await supabase
      .from('tenders')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;
    return count || 0;
  } catch (error) {
    console.error('Error fetching tender count:', error);
    return 0;
  }
}

/**
 * Delete old tenders (older than specified days)
 */
export async function deleteOldTenders(daysOld = 90) {
  try {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const { error } = await supabase
      .from('tenders')
      .delete()
      .lt('updated_at', cutoffDate.toISOString());

    if (error) throw error;
    console.log(`Deleted tenders older than ${daysOld} days`);
    return true;
  } catch (error) {
    console.error('Error deleting old tenders:', error);
    return false;
  }
}

export default {
  saveTender,
  getAllTenders,
  getTenderById,
  getTendersByDepartment,
  getTendersByStatus,
  getUpcomingTenders,
  getTenderCount,
  deleteOldTenders,
};
