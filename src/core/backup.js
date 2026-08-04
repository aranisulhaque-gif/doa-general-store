import { storeData, currentStoreId } from './state.js';
import { supabase } from './supabase.js';

/**
 * Imports an old JSON backup file, wipes existing Supabase data
 * for the current store, and re-populates it from the JSON.
 */
export async function importOldJsonBackup(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!currentStoreId) {
        alert('No store selected. Please select a store first.');
        return;
    }

    // Reset the input so the same file can be re-selected if needed
    event.target.value = '';

    const reader = new FileReader();
    reader.onload = async (e) => {
        let parsed;
        try {
            parsed = JSON.parse(e.target.result);
        } catch {
            alert('Invalid JSON file. Please select a valid DOA backup.');
            return;
        }

        // Confirm before wiping
        const confirmMsg =
            `⚠️ This will DELETE all existing data in the current store and replace it with the backup.\n\n` +
            `Store: ${currentStoreId}\n` +
            `Backup contains:\n` +
            `  • Inventory: ${(parsed.inventory || []).length} items\n` +
            `  • Employees: ${(parsed.employees || []).length}\n` +
            `  • Disbursements: ${(parsed.disbursements || []).length}\n` +
            `  • Returns: ${(parsed.returns || []).length}\n` +
            `  • Resupplies: ${(parsed.resupplies || []).length}\n\n` +
            `Are you sure you want to proceed?`;

        if (!window.confirm(confirmMsg)) return;

        try {
            // 1. Wipe all existing data for this store
            const tables = ['inventory', 'employees', 'disbursements', 'returns', 'resupplies'];
            for (const table of tables) {
                const { error } = await supabase.from(table).delete().eq('store_id', currentStoreId);
                if (error) throw new Error(`Failed to clear ${table}: ${error.message}`);
            }

            // 2. Helper to chunk array for batch inserts (Supabase limit: 1000 rows)
            const chunk = (arr, size) => {
                const chunks = [];
                for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
                return chunks;
            };

            // 3. Re-insert each collection, injecting store_id
            const insertAll = async (table, rows) => {
                if (!rows || rows.length === 0) return;
                const tagged = rows.map(r => ({ ...r, store_id: currentStoreId }));
                for (const batch of chunk(tagged, 500)) {
                    const { error } = await supabase.from(table).insert(batch);
                    if (error) throw new Error(`Failed to insert into ${table}: ${error.message}`);
                }
            };

            await insertAll('inventory',     parsed.inventory);
            await insertAll('employees',     parsed.employees);
            await insertAll('disbursements', parsed.disbursements);
            await insertAll('returns',       parsed.returns);
            await insertAll('resupplies',    parsed.resupplies);

            alert('✅ Import successful! The page will now reload to reflect the new data.');
            window.location.reload();

        } catch (err) {
            console.error('Import failed:', err);
            alert(`❌ Import failed: ${err.message}`);
        }
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
