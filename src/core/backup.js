import { storeData, currentStoreId } from './state.js';
import { supabase } from './supabase.js';

// ── Store selector modal for import ────────────────────────────────────────
function buildImportStoreModal(storeMap, onConfirm) {
    const existing = document.getElementById('importStoreSelectModal');
    if (existing) existing.remove();

    const storeIds = Object.keys(storeMap);
    const rows = storeIds.map(id => {
        const s = storeMap[id];
        const inv = (s.inventory || []).length;
        const emp = (s.employees || []).length;
        const dis = (s.disbursements || []).length;
        return `
        <label class="flex items-start gap-3 p-3 rounded-lg border border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors">
          <input type="checkbox" name="importStoreCheck" value="${id}"
            class="mt-0.5 w-4 h-4 accent-amber-600 flex-shrink-0" checked>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-slate-800 text-sm">${s.name || id}</div>
            <div class="text-xs text-slate-500 mt-0.5">${s.location ? s.location + ' · ' : ''}<span class="font-mono text-slate-400">${id}</span></div>
            <div class="flex gap-3 mt-1 text-xs text-slate-500">
              <span><i class="fas fa-boxes mr-1 text-blue-400"></i>${inv} items</span>
              <span><i class="fas fa-users mr-1 text-purple-400"></i>${emp} employees</span>
              <span><i class="fas fa-exchange-alt mr-1 text-green-400"></i>${dis} disbursements</span>
            </div>
          </div>
        </label>`;
    }).join('');

    const modal = document.createElement('div');
    modal.id = 'importStoreSelectModal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div class="p-6 border-b border-slate-100">
          <h3 class="text-xl font-bold text-slate-800">
            <i class="fas fa-file-import mr-2 text-amber-500"></i>Select Stores to Import
          </h3>
          <p class="text-sm text-slate-500 mt-1">
            ${storeIds.length} store(s) found in backup. Check the ones you want to import.
            <br><span class="text-red-500 font-semibold">⚠ Existing data in selected stores will be wiped.</span>
          </p>
        </div>
        <div class="p-4 max-h-80 overflow-y-auto space-y-2">${rows}</div>
        <div class="p-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <label class="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
            <input id="importSelectAllChk" type="checkbox" checked class="accent-amber-600 w-4 h-4">
            Select / Deselect All
          </label>
          <div class="flex gap-2">
            <button id="importCancelBtn"
              class="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button id="importConfirmBtn"
              class="px-5 py-2 rounded-lg bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 transition-colors shadow">
              <i class="fas fa-file-import mr-1"></i>Import Selected
            </button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(modal);

    // Select/Deselect all
    document.getElementById('importSelectAllChk').addEventListener('change', (e) => {
        modal.querySelectorAll('[name="importStoreCheck"]').forEach(cb => cb.checked = e.target.checked);
    });

    document.getElementById('importCancelBtn').addEventListener('click', () => modal.remove());

    document.getElementById('importConfirmBtn').addEventListener('click', () => {
        const selected = [...modal.querySelectorAll('[name="importStoreCheck"]:checked')].map(cb => cb.value);
        if (selected.length === 0) { alert('Please select at least one store.'); return; }
        modal.remove();
        onConfirm(selected);
    });
}

/**
 * Reads an old multi-store JSON backup, shows a store-selection modal,
 * then wipes and re-populates the selected stores in Supabase.
 */
export async function importOldJsonBackup(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';

    const reader = new FileReader();
    reader.onload = async (e) => {
        let parsed;
        try { parsed = JSON.parse(e.target.result); }
        catch { alert('Invalid JSON file. Please select a valid DOA backup.'); return; }

        // ── Detect format ──────────────────────────────────────────────────
        // Old multi-store format: { storeId: { name, inventory, employees, … } }
        // New single-store format: { inventory: [], employees: [], … }
        let storeMap = {};
        const isMultiStore = typeof parsed === 'object' && !Array.isArray(parsed)
            && !Array.isArray(parsed.inventory)
            && Object.values(parsed).every(v => typeof v === 'object' && !Array.isArray(v) && ('inventory' in v || 'employees' in v));

        if (isMultiStore) {
            storeMap = parsed;
        } else {
            // Single-store: wrap in a map using currentStoreId
            if (!currentStoreId) { alert('No store selected. Select a store first.'); return; }
            storeMap = { [currentStoreId]: parsed };
        }

        if (Object.keys(storeMap).length === 0) { alert('No stores found in the backup file.'); return; }

        // ── Show store-selection modal ─────────────────────────────────────
        buildImportStoreModal(storeMap, async (selectedIds) => {
            const chunk = (arr, size) => {
                const out = [];
                for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
                return out;
            };

            const schemas = {
                inventory: ['id', 'store_id', 'name', 'specification', 'quantity', 'lastResupplyDate', 'latestTenderId'],
                employees: ['id', 'store_id', 'name', 'designation'],
                disbursements: ['id', 'store_id', 'recipientId', 'recipientName', 'items', 'totalItems', 'timestamp'],
                returns: ['id', 'store_id', 'recipientId', 'recipientName', 'items', 'totalItems', 'timestamp'],
                resupplies: ['id', 'store_id', 'itemId', 'itemName', 'quantity', 'tenderId', 'timestamp']
            };

            const insertAll = async (table, rows, storeId) => {
                if (!rows || rows.length === 0) return;
                const allowedKeys = schemas[table] || [];
                
                const tagged = rows.map(r => {
                    const obj = { ...r, store_id: storeId };
                    // Handle old backups that used 'date' instead of 'timestamp'
                    if (obj.date && !obj.timestamp) obj.timestamp = obj.date;
                    
                    // Robust date normalization for Supabase timestamptz/text columns
                    const dateFields = ['timestamp', 'lastResupplyDate'];
                    dateFields.forEach(field => {
                        if (obj[field] !== undefined && obj[field] !== null && obj[field] !== '') {
                            const val = obj[field];
                            let d = null;

                            if (typeof val === 'number') {
                                d = new Date(val);
                            } else if (typeof val === 'string') {
                                const trimmed = val.trim();
                                if (/^\d+$/.test(trimmed)) {
                                    const num = parseInt(trimmed, 10);
                                    d = new Date(num < 10000000000 ? num * 1000 : num);
                                } else {
                                    d = new Date(trimmed);
                                }
                            }

                            if (d && !isNaN(d.getTime())) {
                                obj[field] = d.toISOString();
                            } else {
                                delete obj[field];
                            }
                        } else {
                            delete obj[field];
                        }
                    });

                    // Ensure numeric fields are numbers
                    if (obj.quantity !== undefined) obj.quantity = parseInt(obj.quantity, 10) || 0;
                    if (obj.totalItems !== undefined) obj.totalItems = parseInt(obj.totalItems, 10) || 0;

                    // Ensure items array for JSONB columns
                    if ((table === 'disbursements' || table === 'returns') && (!obj.items || !Array.isArray(obj.items))) {
                        obj.items = Array.isArray(r.items) ? r.items : [];
                    }

                    // Strip any properties not present in the Supabase schema
                    const cleanObj = {};
                    for (const key of allowedKeys) {
                        if (obj[key] !== undefined) cleanObj[key] = obj[key];
                    }
                    return cleanObj;
                });

                for (const batch of chunk(tagged, 500)) {
                    const { error } = await supabase.from(table).upsert(batch);
                    if (error) throw new Error(`Insert into ${table} failed: ${error.message}`);
                }
            };

            // Show progress overlay
            const overlay = document.createElement('div');
            overlay.id = 'importProgressOverlay';
            overlay.className = 'fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm text-white text-center';
            overlay.innerHTML = `<div class="text-5xl mb-4"><i class="fas fa-spinner fa-spin"></i></div>
              <div class="text-xl font-bold" id="importProgressMsg">Importing stores…</div>
              <div class="text-sm text-white/70 mt-2" id="importProgressSub"></div>`;
            document.body.appendChild(overlay);

            const setProgress = (msg, sub = '') => {
                document.getElementById('importProgressMsg').textContent = msg;
                document.getElementById('importProgressSub').textContent = sub;
            };

            try {
                const tables = ['inventory', 'employees', 'disbursements', 'returns', 'resupplies'];
                let done = 0;

                for (const storeId of selectedIds) {
                    const s = storeMap[storeId];
                    done++;
                    setProgress(`Importing ${s.name || storeId}…`, `Store ${done} of ${selectedIds.length}`);

                    // 1. Upsert the store record itself
                    const { error: storeErr } = await supabase.from('stores').upsert({
                        id: storeId,
                        name: s.name || storeId,
                        location: s.location || '',
                        last_modified: new Date().toISOString()
                    });
                    if (storeErr) throw new Error(`Store upsert failed: ${storeErr.message}`);

                    // 2. Wipe existing collections
                    for (const table of tables) {
                        const { error } = await supabase.from(table).delete().eq('store_id', storeId);
                        if (error) throw new Error(`Clear ${table} failed: ${error.message}`);
                    }

                    // 3. Re-insert from backup concurrently
                    await Promise.all([
                        insertAll('inventory',     s.inventory,     storeId),
                        insertAll('employees',     s.employees,     storeId),
                        insertAll('disbursements', s.disbursements, storeId),
                        insertAll('returns',       s.returns,       storeId),
                        insertAll('resupplies',    s.resupplies,    storeId)
                    ]);
                }

                overlay.remove();
                alert(`✅ Import complete! ${selectedIds.length} store(s) imported successfully.\nThe page will now reload.`);
                window.location.reload();
            } catch (err) {
                overlay.remove();
                console.error('Import failed:', err);
                alert(`❌ Import failed: ${err.message}`);
            }
        });
    };
    reader.readAsText(file);
}


export function exportStoreBackup() {
    if (!currentStoreId || !storeData) {
        console.warn("No store selected or data missing for backup");
        return;
    }

    const storeName = storeData.name ? storeData.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'unknown';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `DOA_Store_${storeName}_${timestamp}.json`;

    const dataToExport = JSON.stringify(storeData, null, 2);
    const blob = new Blob([dataToExport], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Update last backup timestamp
    localStorage.setItem(`doa_last_backup_${currentStoreId}`, new Date().toISOString());
    checkBackupPolicy();
}

export function checkBackupPolicy() {
    if (!currentStoreId) return;

    const lastBackupStr = localStorage.getItem(`doa_last_backup_${currentStoreId}`);
    const overlay = document.getElementById('backupEnforcementOverlay');
    const display = document.getElementById('lastBackupTimeDisplay');

    if (!lastBackupStr) {
        if (display) display.textContent = "Never Backed Up";
        return; // initial state
    }

    const lastBackupTime = new Date(lastBackupStr).getTime();
    const now = new Date().getTime();
    const diffHours = (now - lastBackupTime) / (1000 * 60 * 60);

    if (display) {
        display.textContent = new Date(lastBackupTime).toLocaleString();
    }

    if (diffHours >= 36) {
        if (overlay) overlay.classList.remove('hidden');
    } else {
        if (overlay) overlay.classList.add('hidden');
    }
}

export function initBackupScheduler() {
    // Check every 30 minutes
    setInterval(() => {
        if (!currentStoreId) return;
        
        const lastBackupStr = localStorage.getItem(`doa_last_backup_${currentStoreId}`);
        if (!lastBackupStr) return;

        const lastBackupTime = new Date(lastBackupStr).getTime();
        const now = new Date().getTime();
        const diffHours = (now - lastBackupTime) / (1000 * 60 * 60);

        if (diffHours >= 36) {
            checkBackupPolicy(); // will trigger the overlay
        } else if (diffHours >= 30) {
            // Optional: show a non-blocking toast warning
            console.log("Backup recommended soon. Last backup was > 30 hours ago.");
        }
    }, 30 * 60 * 1000);
}
