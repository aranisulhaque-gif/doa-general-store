import { supabase } from '../core/supabase.js';
import { currentStoreId } from '../core/state.js';
import { formatDateTime } from '../utils/formatters.js';

export async function renderEventLog() {
    const listBody = document.getElementById('eventLogList');
    if (!listBody || !currentStoreId) return;

    try {
        if (listBody.children.length === 0) {
            listBody.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-center text-slate-400"><i class="fas fa-spinner fa-spin mr-2"></i>Loading history...</td></tr>`;
        }

        const { data: snapshot, error } = await supabase
            .from('event_logs')
            .select('*')
            .eq('store_id', currentStoreId)
            .order('timestamp', { ascending: false })
            .limit(100);

        if (error) throw error;

        if (!snapshot || snapshot.length === 0) {
            listBody.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-center text-slate-400">No events recorded yet.</td></tr>`;
            return;
        }

        listBody.innerHTML = '';
        snapshot.forEach(log => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-slate-50/50 transition-all border-b border-slate-100/50';

            const timestamp = new Date(log.created_at || log.timestamp);

            row.innerHTML = `
                <td class="px-5 py-3 whitespace-nowrap text-[11px] font-medium text-slate-500">${formatDateTime(timestamp)}</td>
                <td class="px-5 py-3">
                    <div class="flex items-center">
                        <div class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600 mr-2 border border-slate-200">${(log.user || '?').charAt(0).toUpperCase()}</div>
                        <span class="text-xs font-semibold text-slate-700">${log.user || 'Unknown'}</span>
                    </div>
                </td>
                <td class="px-5 py-3">
                    <span class="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-bold uppercase tracking-wider border border-indigo-100">${log.action || 'Event'}</span>
                </td>
                <td class="px-5 py-3 text-xs text-slate-600 font-medium">${log.details || ''}</td>
            `;
            listBody.appendChild(row);
        });
    } catch (error) {
        console.error("Error rendering event log:", error);
        listBody.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-center text-red-500 text-xs">Failed to load logs.</td></tr>`;
    }
}
