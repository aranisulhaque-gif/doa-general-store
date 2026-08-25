import { storeData, currentStoreId } from './state.js';
import { supabase } from './supabase.js';
import * as XLSX from 'xlsx';

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
        const ret = (s.returns || []).length;
        const res = (s.resupplies || []).length;

        // Render the store row with individual checkboxes under it
        return `
        <div class="p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors space-y-2">
          <div class="flex items-center gap-3">
            <input type="checkbox" name="importStoreCheck" value="${id}" id="store_${id}"
              class="w-4 h-4 accent-amber-600 flex-shrink-0" checked>
            <div class="flex-1 min-w-0">
              <label for="store_${id}" class="font-semibold text-slate-800 text-sm cursor-pointer">${s.name || id}</label>
              <div class="text-xs text-slate-500 mt-0.5">${s.location ? s.location + ' · ' : ''}<span class="font-mono text-slate-400">${id}</span></div>
            </div>
          </div>
          
          <div class="pl-7 grid grid-cols-2 gap-2 text-xs text-slate-600">
            ${inv > 0 ? `
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="import_col_${id}" value="inventory" class="accent-amber-600" checked>
              <span>Inventory (${inv})</span>
            </label>` : ''}
            ${emp > 0 ? `
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="import_col_${id}" value="employees" class="accent-amber-600" checked>
              <span>Employees (${emp})</span>
            </label>` : ''}
            ${dis > 0 ? `
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="import_col_${id}" value="disbursements" class="accent-amber-600" checked>
              <span>Disbursements (${dis})</span>
            </label>` : ''}
            ${ret > 0 ? `
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="import_col_${id}" value="returns" class="accent-amber-600" checked>
              <span>Returns (${ret})</span>
            </label>` : ''}
            ${res > 0 ? `
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="import_col_${id}" value="resupplies" class="accent-amber-600" checked>
              <span>Resupplies (${res})</span>
            </label>` : ''}
          </div>
        </div>`;
    }).join('');

    const modal = document.createElement('div');
    modal.id = 'importStoreSelectModal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div class="p-6 border-b border-slate-100">
          <h3 class="text-xl font-bold text-slate-800">
            <i class="fas fa-file-import mr-2 text-amber-500"></i>Select Stores and Collections
          </h3>
          <p class="text-sm text-slate-500 mt-1">
            Choose which stores and specific collections to import.
          </p>
        </div>
        <div class="p-4 max-h-80 overflow-y-auto space-y-3">${rows}</div>
        
        <div class="p-4 border-t border-slate-100 bg-slate-50">
          <span class="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Import Mode</span>
          <div class="flex gap-4">
            <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
              <input type="radio" name="importMode" value="update" checked class="accent-amber-600 w-4 h-4">
              Update (Merge)
            </label>
            <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
              <input type="radio" name="importMode" value="replace" class="accent-amber-600 w-4 h-4">
              Replace (Wipe & Reload)
            </label>
          </div>
        </div>

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
              <i class="fas fa-file-import mr-1"></i>Start Import
            </button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(modal);

    // Disable/Enable sub-checkboxes when store checkbox toggled
    storeIds.forEach(id => {
        const storeCb = modal.querySelector(`#store_${id}`);
        storeCb.addEventListener('change', (e) => {
            modal.querySelectorAll(`[name="import_col_${id}"]`).forEach(cb => {
                cb.disabled = !e.target.checked;
                cb.checked = e.target.checked;
            });
        });
    });

    // Select/Deselect all
    document.getElementById('importSelectAllChk').addEventListener('change', (e) => {
        modal.querySelectorAll('[name="importStoreCheck"]').forEach(cb => {
            cb.checked = e.target.checked;
            cb.dispatchEvent(new Event('change'));
        });
    });

    document.getElementById('importCancelBtn').addEventListener('click', () => modal.remove());

    document.getElementById('importConfirmBtn').addEventListener('click', () => {
        const result = {};
        const selectedStores = [...modal.querySelectorAll('[name="importStoreCheck"]:checked')].map(cb => cb.value);
        const mode = modal.querySelector('[name="importMode"]:checked').value;
        
        selectedStores.forEach(sid => {
            const cols = [...modal.querySelectorAll(`[name="import_col_${sid}"]:checked`)].map(cb => cb.value);
            if (cols.length > 0) {
                result[sid] = cols;
            }
        });

        if (Object.keys(result).length === 0) {
            alert('Please select at least one store and one collection to import.');
            return;
        }

        modal.remove();
        onConfirm({ selectedStoreColsMap: result, mode });
    });
}

/**
 * Reads a JSON or Excel backup, shows a settings modal to configure import scope and mode,
 * then updates or replaces the data in Supabase.
 */
export async function handleBackupImport(event) {
    if (!currentStoreId) {
        alert('No store selected. Select a store first.');
        return;
    }
    const file = event.target.files[0];
    if (!file) return;
    const fileName = file.name.toLowerCase();
    event.target.value = '';

    const schemas = {
        inventory: ['id', 'store_id', 'name', 'specification', 'quantity', 'initialQuantity', 'lastResupplyDate', 'latestTenderId'],
        employees: ['id', 'store_id', 'name', 'designation'],
        disbursements: ['id', 'store_id', 'recipientId', 'recipientName', 'items', 'totalItems', 'timestamp'],
        returns: ['id', 'store_id', 'recipientId', 'recipientName', 'items', 'totalItems', 'timestamp'],
        resupplies: ['id', 'store_id', 'itemId', 'itemName', 'quantity', 'tenderId', 'timestamp']
    };

    const chunk = (arr, size) => {
        const out = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
    };

    // Build an inventory name-lookup map from the current import batch (for resupplies)
    const buildInventoryNameMap = (inventoryRows) => {
        const map = {};
        if (!Array.isArray(inventoryRows)) return map;
        inventoryRows.forEach(r => { if (r.id) map[String(r.id)] = r.name || ''; });
        return map;
    };

    const insertAll = async (table, rows, storeId, inventoryRows = []) => {
        if (!rows || rows.length === 0) return;
        const allowedKeys = schemas[table] || [];
        const invNameMap = table === 'resupplies' ? buildInventoryNameMap(inventoryRows) : {};

        const tagged = rows.map(r => {
            // Normalise storeId → store_id (Excel exports use camelCase)
            const obj = { ...r, store_id: storeId };
            if (obj.storeId !== undefined) delete obj.storeId;

            // ── Fix 1: Prefix id with storeId to prevent cross-store PK collisions ──
            // e.g. id "abc123" in Store 1 becomes "1_abc123" so it won't overwrite
            // the same id from Store 3 in the shared Supabase table.
            if (obj.id) obj.id = `${storeId}_${String(obj.id)}`;

            // ── Fix 2: Map 'date' → 'timestamp' (Excel resupplies/disbursements use 'date') ──
            if (obj.date && !obj.timestamp) obj.timestamp = obj.date;

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

            if (obj.quantity !== undefined) obj.quantity = parseInt(obj.quantity, 10) || 0;
            if (obj.totalItems !== undefined) obj.totalItems = parseInt(obj.totalItems, 10) || 0;

            // ── Fix 3: Resolve itemName for resupplies (Excel has no itemName column) ──
            // Look up the item name from the inventory rows included in this import batch.
            if (table === 'resupplies') {
                if (!obj.itemName || String(obj.itemName).trim() === '') {
                    const rawItemId = r.itemId || '';
                    obj.itemName = invNameMap[String(rawItemId)] || invNameMap[`${storeId}_${rawItemId}`] || obj.note || '';
                }
                // Also prefix itemId the same way we prefixed id
                if (obj.itemId) obj.itemId = `${storeId}_${String(obj.itemId)}`;
            }

            // ── Fix 4: disbursements/returns — translate itemId/itemName to id/name inside items array,
            //    and derive recipientName from items if missing ──
            if (table === 'disbursements' || table === 'returns') {
                let parsedItems = [];
                if (typeof r.items === 'string') {
                    try { parsedItems = JSON.parse(r.items); }
                    catch (e) { parsedItems = []; }
                } else if (Array.isArray(r.items)) {
                    parsedItems = r.items;
                } else if (Array.isArray(obj.items)) {
                    parsedItems = obj.items;
                }

                // Map keys: in the app, items must have { id, name, quantity }
                obj.items = parsedItems.map(item => {
                    const rawId = item.id || item.itemId || '';
                    return {
                        id: rawId ? `${storeId}_${String(rawId)}` : '',
                        name: item.name || item.itemName || 'Unknown',
                        quantity: parseInt(item.quantity, 10) || 0
                    };
                });

                // recipientName missing from Excel — set a placeholder from recipientId
                // so the app can display something meaningful instead of blank
                if (!obj.recipientName || String(obj.recipientName).trim() === '') {
                    obj.recipientName = obj.recipientId ? `Employee (${String(obj.recipientId).slice(-6)})` : 'Unknown';
                }
                // Also prefix recipientId
                if (obj.recipientId) obj.recipientId = `${storeId}_${String(obj.recipientId)}`;
            }

            const cleanObj = {};
            for (const key of allowedKeys) {
                if (obj[key] !== undefined) cleanObj[key] = obj[key];
            }
            return cleanObj;
        });

        const uniqueMap = new Map();
        tagged.forEach(item => {
            if (item.id) {
                uniqueMap.set(item.id, item);
            }
        });
        const deduplicated = Array.from(uniqueMap.values());

        for (const batch of chunk(deduplicated, 500)) {
            const { error } = await supabase.from(table).upsert(batch);
            if (error) throw new Error(`Insert into ${table} failed: ${error.message}`);
        }
    };



    const runImportPipeline = (storeMap) => {
        buildImportStoreModal(storeMap, async ({ selectedStoreColsMap, mode }) => {
            const overlay = document.createElement('div');
            overlay.id = 'importProgressOverlay';
            overlay.className = 'fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm text-white text-center';
            overlay.innerHTML = `<div class="text-5xl mb-4"><i class="fas fa-spinner fa-spin"></i></div>
              <div class="text-xl font-bold" id="importProgressMsg">Importing data…</div>`;
            document.body.appendChild(overlay);
            try {
                const sids = Object.keys(selectedStoreColsMap);
                for (const sid of sids) {
                    const msg = document.getElementById('importProgressMsg');
                    if (msg) msg.textContent = `Importing store ${storeMap[sid]?.name || sid}…`;
                    const tables = selectedStoreColsMap[sid];
                    for (const table of tables) {
                        const rows = storeMap[sid][table];
                        if (rows && rows.length > 0) {
                            if (mode === 'replace') {
                                const { error: clearErr } = await supabase.from(table).delete().eq('store_id', sid);
                                if (clearErr) throw new Error(`Clear ${table}/${sid} failed: ${clearErr.message}`);
                            }
                            await insertAll(table, rows, sid, storeMap[sid]['inventory']);
                        }
                    }
                }
                overlay.remove();
                alert(`✅ Import complete!\nThe page will now reload.`);
                window.location.reload();
            } catch (err) {
                overlay.remove();
                console.error('Import failed:', err);
                alert(`❌ Import failed: ${err.message}`);
            }
        });
    };

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                const sheetMap = {
                    inventory: 'inventory',
                    employees: 'employees',
                    disbursements: 'disbursements',
                    returns: 'returns',
                    resupplies: 'resupplies'
                };

                const parseSheet = (sheetName) => {
                    const ws = workbook.Sheets[sheetName];
                    let rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
                    if (rows.length > 0 && Object.keys(rows[0]).every(k => k.startsWith('__EMPTY'))) {
                        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                        const headerIdx = raw.findIndex(r =>
                            r.some(cell => typeof cell === 'string' && ['id','storeId','store_id'].includes(cell.trim()))
                        );
                        if (headerIdx !== -1) {
                            const headers = raw[headerIdx];
                            rows = raw.slice(headerIdx + 1)
                                .filter(r => r.some(cell => cell !== ''))
                                .map(r => {
                                    const obj = {};
                                    headers.forEach((h, i) => { if (h) obj[h] = r[i] ?? ''; });
                                    return obj;
                                });
                        }
                    }
                    return rows;
                };

                const storeMap = {};
                const flatBackup = {};

                workbook.SheetNames.forEach(sheetName => {
                    const lowerName = sheetName.toLowerCase().trim();
                    const standardName = sheetMap[lowerName];
                    if (!standardName) return;

                    const rows = parseSheet(sheetName);
                    flatBackup[standardName] = rows;

                    if (rows.length > 0 && (rows[0].storeId !== undefined || rows[0].store_id !== undefined)) {
                        rows.forEach(row => {
                            const sid = String(row.storeId ?? row.store_id ?? '').trim();
                            if (!sid) return;
                            if (!storeMap[sid]) storeMap[sid] = {};
                            if (!storeMap[sid][standardName]) storeMap[sid][standardName] = [];
                            storeMap[sid][standardName].push(row);
                        });
                    }
                });

                if (workbook.SheetNames.some(s => s.toLowerCase() === 'stores')) {
                    const storesWs = workbook.Sheets[workbook.SheetNames.find(s => s.toLowerCase() === 'stores')];
                    const storeRows = XLSX.utils.sheet_to_json(storesWs, { defval: '' });
                    storeRows.forEach(sr => {
                        const sid = String(sr.storeId ?? sr.store_id ?? sr.id ?? '').trim();
                        if (sid && storeMap[sid]) {
                            storeMap[sid].name = sr.name || sid;
                            storeMap[sid].location = sr.location || '';
                        }
                    });
                }

                const isMultiStore = Object.keys(storeMap).length > 1;
                if (isMultiStore) {
                    runImportPipeline(storeMap);
                } else {
                    const finalMap = { [currentStoreId]: flatBackup };
                    runImportPipeline(finalMap);
                }
            } catch (err) {
                alert(`Failed to parse Excel file: ${err.message}`);
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        const reader = new FileReader();
        reader.onload = async (e) => {
            let parsed;
            try { parsed = JSON.parse(e.target.result); }
            catch { alert('Invalid file format. Please select a valid JSON or Excel backup.'); return; }

            const isMultiStore = typeof parsed === 'object' && !Array.isArray(parsed)
                && !Array.isArray(parsed.inventory)
                && Object.values(parsed).every(v => typeof v === 'object' && !Array.isArray(v) && ('inventory' in v || 'employees' in v));

            if (isMultiStore) {
                runImportPipeline(parsed);
            } else {
                runImportPipeline({ [currentStoreId]: parsed });
            }
        };
        reader.readAsText(file);
    }
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

// =========================================================================
// ADHOC SUPABASE SNAPSHOT & RESTORE CORE
// =========================================================================

/**
 * Checks connection health to detect if Supabase is cold/paused.
 */
export async function testSupabaseConnection() {
    try {
        const { data, error } = await supabase.from('stores').select('id').limit(1);
        if (error) throw error;
        return true;
    } catch (err) {
        console.error("Supabase connection check failed:", err);
        return false;
    }
}

/**
 * Creates a database-wide JSON snapshot and saves it into public.backups table.
 * Debounced to maximum of one snapshot per 24 hours for user activity.
 */
export async function createSupabaseSnapshot(triggerType = 'user_activity', force = false) {
    try {
        const isConnected = await testSupabaseConnection();
        if (!isConnected) {
            console.warn("Cannot create snapshot: Supabase is unreachable (likely paused).");
            return { success: false, reason: 'paused' };
        }

        if (triggerType === 'user_activity' && !force) {
            // Check last snapshot date to enforce 24h debounce
            const { data: lastBackup, error: fetchErr } = await supabase
                .from('backups')
                .select('created_at')
                .order('created_at', { ascending: false })
                .limit(1);

            if (!fetchErr && lastBackup && lastBackup.length > 0) {
                const lastTime = new Date(lastBackup[0].created_at).getTime();
                const diffMs = new Date().getTime() - lastTime;
                const diffHours = diffMs / (1000 * 60 * 60);
                if (diffHours < 24) {
                    console.log(`Snapshot skipped: Last backup was only ${diffHours.toFixed(1)}h ago (limit: 1 per 24h).`);
                    return { success: true, reason: 'debounced' };
                }
            }
        }

        console.log("Generating database snapshot data...");
        const tables = ['stores', 'inventory', 'employees', 'disbursements', 'returns', 'resupplies', 'event_logs', 'user_roles'];
        const snapshot = {
            manifest: {
                version: '1.0',
                createdAt: new Date().toISOString(),
                recordCounts: {}
            },
            data: {}
        };

        for (const table of tables) {
            let query = supabase.from(table).select('*');
            if (table === 'event_logs') {
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - 30);
                query = query.gt('timestamp', cutoff.toISOString());
            }

            const { data, error } = await query;
            if (error) {
                console.error(`Error backing up table ${table}:`, error);
                snapshot.data[table] = [];
                snapshot.manifest.recordCounts[table] = 0;
            } else {
                snapshot.data[table] = data || [];
                snapshot.manifest.recordCounts[table] = data ? data.length : 0;
            }
        }

        // Save snapshot
        const { error: insertErr } = await supabase
            .from('backups')
            .insert({
                trigger_type: triggerType,
                snapshot_data: snapshot
            });

        if (insertErr) throw insertErr;
        console.log("Database backup snapshot saved successfully.");

        // Prune old snapshots (keep latest 30)
        const { data: backups, error: listErr } = await supabase
            .from('backups')
            .select('id')
            .order('created_at', { ascending: false });

        if (!listErr && backups && backups.length > 30) {
            const idsToDelete = backups.slice(30).map(b => b.id);
            await supabase.from('backups').delete().in('id', idsToDelete);
            console.log(`Pruned ${idsToDelete.length} oldest backup snapshots.`);
        }

        return { success: true };
    } catch (err) {
        console.error("Failed to create Supabase snapshot:", err);
        return { success: false, error: err.message };
    }
}

/**
 * Returns summary list of backups currently in the database.
 */
export async function getSupabaseSnapshots() {
    try {
        const { data, error } = await supabase
            .from('backups')
            .select('id, created_at, trigger_type, snapshot_data')
            .order('created_at', { ascending: false });

        if (error) throw error;
        
        return data.map(b => {
            const manifest = b.snapshot_data?.manifest || {};
            return {
                id: b.id,
                created_at: b.created_at,
                trigger_type: b.trigger_type,
                recordCounts: manifest.recordCounts || {}
            };
        });
    } catch (err) {
        console.error("Error fetching snapshots:", err);
        return [];
    }
}

/**
 * Downloads a snapshot from Supabase as a JSON file.
 */
export async function downloadSupabaseSnapshot(snapshotId) {
    try {
        const { data, error } = await supabase
            .from('backups')
            .select('snapshot_data, created_at')
            .eq('id', snapshotId)
            .single();

        if (error) throw error;

        const timestamp = new Date(data.created_at).toISOString().replace(/[:.]/g, '-');
        const filename = `DOA_Database_Backup_${timestamp}.json`;
        const blob = new Blob([JSON.stringify(data.snapshot_data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error("Failed to download snapshot:", err);
        alert("Failed to download snapshot: " + err.message);
    }
}

/**
 * Restores a snapshot into Supabase database with ordered FK checks and batching.
 */
export async function restoreSupabaseSnapshot(snapshotId, mode = 'merge', onProgress) {
    try {
        const isConnected = await testSupabaseConnection();
        if (!isConnected) {
            throw new Error("Supabase is offline or paused. Please resume the database project first.");
        }

        const { data: backup, error: fetchErr } = await supabase
            .from('backups')
            .select('snapshot_data')
            .eq('id', snapshotId)
            .single();

        if (fetchErr || !backup) throw new Error("Could not load snapshot data.");

        const snapshot = backup.snapshot_data;
        const tablesData = snapshot.data || {};
        
        // Define cleanup and restore steps in FK order
        // Order: user_roles -> stores -> inventory, employees -> disbursements, returns, resupplies -> event_logs
        const orderedTables = [
            'user_roles',
            'stores',
            'inventory',
            'employees',
            'disbursements',
            'returns',
            'resupplies',
            'event_logs'
        ];

        if (mode === 'replace') {
            if (onProgress) onProgress('Clearing existing records for full replacement...', 5);
            // Delete data in reverse FK order to prevent violation
            const reverseTables = [...orderedTables].reverse();
            for (const table of reverseTables) {
                // Keep Admin role mapping intact so we don't lock ourselves out of RLS
                if (table === 'user_roles') {
                    const { error: delErr } = await supabase
                        .from(table)
                        .delete()
                        .not('role', 'eq', 'Admin');
                    if (delErr) console.warn(`Clean warning on ${table}:`, delErr);
                } else {
                    const { error: delErr } = await supabase.from(table).delete().neq('id', '_dummy_non_existent');
                    if (delErr) console.warn(`Clean warning on ${table}:`, delErr);
                }
            }
        }

        let stepIndex = 0;
        for (const table of orderedTables) {
            stepIndex++;
            const percent = Math.round((stepIndex / orderedTables.length) * 90) + 5;
            const rows = tablesData[table] || [];

            if (onProgress) onProgress(`Restoring ${table} (${rows.length} rows)...`, percent);

            if (rows.length === 0) continue;

            // Batch upsert in chunks of 500
            const chunkSize = 500;
            for (let i = 0; i < rows.length; i += chunkSize) {
                const chunk = rows.slice(i, i + chunkSize);
                const { error: upsertErr } = await supabase
                    .from(table)
                    .upsert(chunk);
                if (upsertErr) {
                    console.error(`Error upserting chunk in ${table}:`, upsertErr);
                    throw new Error(`Restore failed on table ${table}: ${upsertErr.message}`);
                }
            }
        }

        if (onProgress) onProgress('Restore complete!', 100);
        return { success: true };
    } catch (err) {
        console.error("Restore failed:", err);
        return { success: false, error: err.message };
    }
}
