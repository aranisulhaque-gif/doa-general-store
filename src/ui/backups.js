import { getSupabaseSnapshots, downloadSupabaseSnapshot, restoreSupabaseSnapshot, createSupabaseSnapshot } from '../core/backup.js';
import { showMessageModal, showConfirmationModal } from '../utils/helpers.js';

export async function renderBackupList() {
    const listBody = document.getElementById('backupList');
    if (!listBody) return;

    listBody.innerHTML = `
        <tr>
            <td colspan="3" class="text-center py-6 text-slate-500">
                <i class="fas fa-spinner fa-spin mr-2"></i>Loading snapshots...
            </td>
        </tr>
    `;

    try {
        const snapshots = await getSupabaseSnapshots();
        if (snapshots.length === 0) {
            listBody.innerHTML = `
                <tr>
                    <td colspan="3" class="text-center py-6 text-slate-500">
                        <i class="fas fa-info-circle text-slate-400 text-xl mb-1 block"></i>
                        No database snapshots found.
                    </td>
                </tr>
            `;
            return;
        }

        listBody.innerHTML = snapshots.map(s => {
            const date = new Date(s.created_at);
            const timeStr = date.toLocaleTimeString();
            const dateStr = date.toLocaleDateString();
            
            // Format trigger label
            const triggerIcon = s.trigger_type === 'keep_alive' ? 'fa-heartbeat text-rose-500' : 'fa-user text-blue-500';
            const triggerLabel = s.trigger_type === 'keep_alive' ? 'Keep-Alive' : 'User Entry';

            // Counts of tables
            const counts = s.recordCounts || {};
            const summaryParts = [];
            if (counts.stores) summaryParts.push(`${counts.stores} stores`);
            if (counts.inventory) summaryParts.push(`${counts.inventory} items`);
            if (counts.employees) summaryParts.push(`${counts.employees} employees`);
            if (counts.disbursements) summaryParts.push(`${counts.disbursements} txn`);
            const summaryStr = summaryParts.length > 0 ? `(${summaryParts.join(', ')})` : '(Empty)';

            return `
                <tr class="hover:bg-slate-50/50 transition-colors text-slate-700">
                    <td class="px-5 py-3.5 align-middle">
                        <div class="flex items-center gap-2">
                            <i class="fas ${triggerIcon}" title="${triggerLabel}"></i>
                            <span class="font-semibold text-slate-800">${dateStr}</span>
                        </div>
                    </td>
                    <td class="px-5 py-3.5 align-middle">
                        <span class="text-xs text-slate-500 font-mono block">${timeStr}</span>
                        <span class="text-[10px] text-slate-400 font-medium">${summaryStr}</span>
                    </td>
                    <td class="px-5 py-3.5 align-middle text-right space-x-2">
                        <button onclick="downloadSnapshot('${s.id}')" 
                                class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-bold transition-all"
                                title="Download Snapshot JSON">
                            <i class="fas fa-download"></i>
                        </button>
                        <button onclick="triggerRestoreSnapshot('${s.id}')" 
                                class="px-2.5 py-1.5 bg-blue-900 hover:opacity-90 text-white rounded text-xs font-bold transition-all"
                                title="Restore from snapshot">
                            <i class="fas fa-undo"></i> Restore
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        listBody.innerHTML = `
            <tr>
                <td colspan="3" class="text-center py-6 text-red-500">
                    <i class="fas fa-exclamation-triangle mr-2"></i>Failed to load snapshots.
                </td>
            </tr>
        `;
    }
}

// Global functions for inline HTML event handlers
window.downloadSnapshot = async (id) => {
    await downloadSupabaseSnapshot(id);
};

window.triggerRestoreSnapshot = (id) => {
    showConfirmationModal(
        "Restore Database Snapshot?",
        "Warning: Restoring will overwrite current database records with this snapshot's state. Please confirm.",
        async () => {
            // Show custom progress screen
            const listBody = document.getElementById('backupList');
            if (listBody) {
                listBody.innerHTML = `
                    <tr>
                        <td colspan="3" class="text-center py-12 text-slate-700 font-medium">
                            <div class="w-12 h-12 border-4 border-blue-900 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                            <div id="restoreProgressLabel">Restoring database snapshot...</div>
                        </td>
                    </tr>
                `;
            }

            const result = await restoreSupabaseSnapshot(id, 'replace', (label, pct) => {
                const labelEl = document.getElementById('restoreProgressLabel');
                if (labelEl) labelEl.textContent = `${label} (${pct}%)`;
            });

            if (result.success) {
                showMessageModal("Restore Complete", "Database snapshot restored successfully. The application will reload now.");
                setTimeout(() => window.location.reload(), 1500);
            } else {
                showMessageModal("Restore Failed", `Error: ${result.error}`);
                renderBackupList();
            }
        }
    );
};

window.triggerManualSnapshot = async () => {
    const btn = document.getElementById('exportJsonBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> Creating...`;
    }

    const res = await createSupabaseSnapshot('user_activity', true);
    
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-file-export mr-1"></i> Export JSON`;
    }

    if (res.success) {
        showMessageModal("Success", "Manual backup snapshot created successfully.");
        renderBackupList();
    } else {
        if (res.reason === 'paused') {
            showMessageModal("Supabase Paused", "Database is offline. Please unpause from dashboard.");
        } else {
            showMessageModal("Error", `Failed to create snapshot: ${res.error}`);
        }
    }
};
