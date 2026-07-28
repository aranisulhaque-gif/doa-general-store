import { storeData, currentStoreId } from './state.js';

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
