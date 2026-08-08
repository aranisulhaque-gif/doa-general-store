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
        inventory: ['id', 'store_id', 'name', 'specification', 'quantity', 'lastResupplyDate', 'latestTenderId'],
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

    const insertAll = async (table, rows, storeId) => {
        if (!rows || rows.length === 0) return;
        const allowedKeys = schemas[table] || [];

        const tagged = rows.map(r => {
            // Normalise storeId → store_id (Excel exports use camelCase)
            const obj = { ...r, store_id: storeId };
            if (obj.storeId !== undefined) delete obj.storeId;
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

            if ((table === 'disbursements' || table === 'returns') && (!obj.items || !Array.isArray(obj.items))) {
                if (typeof r.items === 'string') {
                    try {
                        obj.items = JSON.parse(r.items);
                    } catch (e) {
                        obj.items = [];
                    }
                } else {
                    obj.items = Array.isArray(r.items) ? r.items : [];
                }
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

    const processBackupData = async (backupData) => {
        const tables = ['inventory', 'employees', 'disbursements', 'returns', 'resupplies'];
        const availableCollections = tables.filter(t => Array.isArray(backupData[t]) && backupData[t].length > 0);

        if (availableCollections.length === 0) {
            alert('No valid collections found in the file to import.');
            return;
        }

        const showImportSettingsModal = (availableCols, onConfirm) => {
            const existing = document.getElementById('importSettingsModal');
            if (existing) existing.remove();

            const collectionNames = {
                inventory: 'Inventory',
                employees: 'Employees',
                disbursements: 'Disbursements',
                returns: 'Returns',
                resupplies: 'Resupplies'
            };

            const rows = availableCols.map(col => {
                const count = backupData[col].length;
                return `
                <label class="flex items-center gap-3 p-3 rounded-lg border border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors">
                  <input type="checkbox" name="importCollectionCheck" value="${col}"
                    class="w-4 h-4 accent-amber-600 flex-shrink-0" checked>
                  <span class="font-semibold text-slate-800 text-sm">${collectionNames[col] || col} (${count} rows)</span>
                </label>`;
            }).join('');

            const modal = document.createElement('div');
            modal.id = 'importSettingsModal';
            modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
            modal.innerHTML = `
              <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                <div class="p-6 border-b border-slate-100">
                  <h3 class="text-xl font-bold text-slate-800">
                    <i class="fas fa-file-import mr-2 text-amber-500"></i>Import Settings
                  </h3>
                  <p class="text-sm text-slate-500 mt-1">
                    Select collections to import into the current store.
                  </p>
                </div>
                <div class="p-4 space-y-4">
                  <div>
                    <span class="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Collections</span>
                    <div class="space-y-2">
                      <label class="flex items-center gap-3 p-2 rounded hover:bg-slate-50 cursor-pointer">
                        <input id="importSelectAllCols" type="checkbox" checked class="accent-amber-600 w-4 h-4">
                        <span class="text-sm font-bold text-slate-700">Select / Deselect All</span>
                      </label>
                      <div class="border-t border-slate-100 my-1"></div>
                      ${rows}
                    </div>
                  </div>

                  <div>
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
                </div>
                <div class="p-4 border-t border-slate-100 flex justify-end gap-3">
                  <button id="importSettingsCancelBtn"
                    class="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                    Cancel
                  </button>
                  <button id="importSettingsConfirmBtn"
                    class="px-5 py-2 rounded-lg bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 transition-colors shadow">
                    <i class="fas fa-file-import mr-1"></i>Start Import
                  </button>
                </div>
              </div>`;

            document.body.appendChild(modal);

            document.getElementById('importSelectAllCols').addEventListener('change', (e) => {
                modal.querySelectorAll('[name="importCollectionCheck"]').forEach(cb => cb.checked = e.target.checked);
            });

            document.getElementById('importSettingsCancelBtn').addEventListener('click', () => modal.remove());

            document.getElementById('importSettingsConfirmBtn').addEventListener('click', () => {
                const selectedCols = [...modal.querySelectorAll('[name="importCollectionCheck"]:checked')].map(cb => cb.value);
                const mode = modal.querySelector('[name="importMode"]:checked').value;
                if (selectedCols.length === 0) { alert('Please select at least one collection.'); return; }
                modal.remove();
                onConfirm({ selectedCols, mode });
            });
        };

        showImportSettingsModal(availableCollections, async ({ selectedCols, mode }) => {
            const overlay = document.createElement('div');
            overlay.id = 'importProgressOverlay';
            overlay.className = 'fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm text-white text-center';
            overlay.innerHTML = `<div class="text-5xl mb-4"><i class="fas fa-spinner fa-spin"></i></div>
              <div class="text-xl font-bold" id="importProgressMsg">Importing data…</div>`;
            document.body.appendChild(overlay);

            try {
                for (const table of selectedCols) {
                    if (mode === 'replace') {
                        const { error: clearErr } = await supabase.from(table).delete().eq('store_id', currentStoreId);
                        if (clearErr) throw new Error(`Clear ${table} failed: ${clearErr.message}`);
                    }
                    await insertAll(table, backupData[table], currentStoreId);
                }

                overlay.remove();
                alert(`✅ Import complete! Selected collections imported successfully.\nThe page will now reload.`);
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

                // Helper: parse a sheet, auto-detecting blank leading rows
                const parseSheet = (sheetName) => {
                    const ws = workbook.Sheets[sheetName];
                    // Try default parse first
                    let rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
                    // If first row has no recognisable columns (e.g. __EMPTY), scan raw rows
                    // to find the actual header row and re-parse from there
                    if (rows.length > 0 && Object.keys(rows[0]).every(k => k.startsWith('__EMPTY'))) {
                        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                        // Find first row that looks like a real header (contains 'id' or 'storeId')
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

                // Collect all rows per collection, grouped by storeId
                // Structure: storeMap[storeId][collection] = rows[]
                const storeMap = {};
                const flatBackup = {};  // fallback for single-store files

                workbook.SheetNames.forEach(sheetName => {
                    const lowerName = sheetName.toLowerCase().trim();
                    const standardName = sheetMap[lowerName];
                    if (!standardName) return;

                    const rows = parseSheet(sheetName);
                    flatBackup[standardName] = rows;

                    // Check if rows contain a storeId column (multi-store export)
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

                // Also pull store names from STORES sheet if present
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
                    // Show store-selection modal, then import selected stores in sequence
                    buildImportStoreModal(storeMap, async (selectedStoreIds) => {
                        const overlay = document.createElement('div');
                        overlay.id = 'importProgressOverlay';
                        overlay.className = 'fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm text-white text-center';
                        overlay.innerHTML = `<div class="text-5xl mb-4"><i class="fas fa-spinner fa-spin"></i></div>
                          <div class="text-xl font-bold" id="importProgressMsg">Importing data…</div>`;
                        document.body.appendChild(overlay);
                        try {
                            for (const sid of selectedStoreIds) {
                                const msg = document.getElementById('importProgressMsg');
                                if (msg) msg.textContent = `Importing store ${storeMap[sid]?.name || sid}…`;
                                const tables = ['inventory', 'employees', 'disbursements', 'returns', 'resupplies'];
                                for (const table of tables) {
                                    const rows = storeMap[sid][table];
                                    if (rows && rows.length > 0) {
                                        // Wipe existing data for this store+table then re-insert
                                        const { error: clearErr } = await supabase.from(table).delete().eq('store_id', sid);
                                        if (clearErr) throw new Error(`Clear ${table}/${sid} failed: ${clearErr.message}`);
                                        await insertAll(table, rows, sid);
                                    }
                                }
                            }
                            overlay.remove();
                            alert(`✅ Import complete! ${selectedStoreIds.length} store(s) imported.\nThe page will now reload.`);
                            window.location.reload();
                        } catch (err) {
                            overlay.remove();
                            console.error('Import failed:', err);
                            alert(`❌ Import failed: ${err.message}`);
                        }
                    });
                } else {
                    // Single-store file — fall through to the settings modal
                    await processBackupData(flatBackup);
                }
            } catch (err) {
                alert(`Failed to parse Excel file: ${err.message}`);
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        // Fallback to JSON
        const reader = new FileReader();
        reader.onload = async (e) => {
            let parsed;
            try { parsed = JSON.parse(e.target.result); }
            catch { alert('Invalid file format. Please select a valid JSON or Excel backup.'); return; }

            let backupData = parsed;
            const isMultiStore = typeof parsed === 'object' && !Array.isArray(parsed)
                && !Array.isArray(parsed.inventory)
                && Object.values(parsed).every(v => typeof v === 'object' && !Array.isArray(v) && ('inventory' in v || 'employees' in v));

            if (isMultiStore) {
                if (parsed[currentStoreId]) {
                    backupData = parsed[currentStoreId];
                } else {
                    const firstStoreId = Object.keys(parsed)[0];
                    backupData = parsed[firstStoreId];
                }
            }

            await processBackupData(backupData);
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
