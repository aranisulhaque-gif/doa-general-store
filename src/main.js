import './index.css';
import '../css/style.css';
import { supabase } from './core/supabase.js';
import {
    storeData, setCurrentUserRole, setCurrentStoreId, setAllStores, setStoreData,
    currentStoreId, currentUserRole, allStores, pagination, syncState,
    storeListenerUnsubscribe, setStoreListenerUnsubscribe, resetStoreData
} from './core/state.js';
import { exportStoreBackup, checkBackupPolicy, initBackupScheduler, importOldJsonBackup } from './core/backup.js';
import { renderUI } from './ui/render.js';
import * as modals from './ui/modals.js';
import * as dashboard from './ui/dashboard.js';
import * as inventory from './ui/inventory.js';
import * as employees from './ui/employees.js';
import * as disbursements from './ui/disbursements.js';
import * as reports from './ui/reports.js';
import { hideModal, showMessageModal, showConfirmationModal, generateId, togglePasswordVisibility } from './utils/helpers.js';
import { formatDate, formatDateTime } from './utils/formatters.js';

// =========================================================================
// Store persistence
// =========================================================================
function getStoredStoreId() { return localStorage.getItem('lastSelectedStoreId'); }
function setStoredStoreId(id) { localStorage.setItem('lastSelectedStoreId', id); }



// =========================================================================
// CORE DATA MANAGEMENT
// =========================================================================
export async function saveStoreData(updates) {
    if (!currentStoreId) return console.error("No store selected for saving.");
    try {
        // Optimistic UI update
        Object.keys(updates).forEach(key => { storeData[key] = updates[key]; });
        renderUI();

        // 1. Primary Write: Supabase (Upsert stores table)
        const { error } = await supabase
            .from('stores')
            .upsert({
                id: currentStoreId,
                name: storeData.name,
                location: storeData.location,
                last_modified: new Date().toISOString()
            });

        if (error) throw error;
        console.log("Data saved to Supabase successfully.");
    } catch (error) {
        console.error("Error saving data to Supabase:", error);
        showMessageModal("Error", "Failed to save data. Changes might not persist.");
    }
}



let isPopulatingStores = false;
async function populateStoreSelector() {
    if (isPopulatingStores) return;
    isPopulatingStores = true;
    const storeSelector = document.getElementById('storeSelector');
    const storeListBody = document.getElementById('storeList');
    if (!storeSelector) return;

    storeSelector.innerHTML = '<option value="">Loading stores...</option>';
    if (storeListBody) storeListBody.innerHTML = '';
    setAllStores({});

    try {
        console.log("Fetching stores from Supabase...");
        let stores = {};
        const { data, error } = await supabase.from('stores').select('*');
        if (error) throw error;

        if (data && data.length > 0) {
            data.forEach(store => {
                stores[store.id] = { name: store.name || store.id, location: store.location || '' };
            });
        }

        if (Object.keys(stores).length === 0) {
            storeSelector.innerHTML = '<option value="">No stores — Create one first</option>';
            return;
        }
        setAllStores(stores);

        // Populate store selector
        storeSelector.innerHTML = '';
        Object.entries(allStores).forEach(([id, store]) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = store.name || id;
            storeSelector.appendChild(option);
        });

        // Populate store management table
        if (storeListBody) {
            storeListBody.innerHTML = '';
            Object.entries(allStores).forEach(([id, store]) => {
                const row = storeListBody.insertRow();
                const canManage = currentUserRole === 'Admin' || currentUserRole === 'Manager';
                const renameBtn = canManage
                    ? `<button type="button" onclick="renameStore('${id}')" class="compact-button skeuo-btn btn-secondary mr-1" title="Rename Store"><i class="fas fa-edit"></i></button>`
                    : '';
                const deleteBtn = canManage
                    ? `<button type="button" onclick="deleteStore('${id}')" class="compact-button skeuo-btn btn-danger" title="Delete Store"><i class="fas fa-trash"></i></button>`
                    : '';

                row.innerHTML = `
                    <td class="px-4 py-3 table-cell font-mono text-[11px]">${id}</td>
                    <td class="px-4 py-3 table-cell font-semibold text-slate-700">${store.name || 'N/A'}</td>
                    <td class="px-4 py-3 table-cell text-slate-500">${store.location || 'N/A'}</td>
                    <td class="px-4 py-3 table-cell">
                        <div class="flex items-center justify-end gap-1">
                            <button onclick="switchStore('${id}')" class="compact-button btn-primary px-3 mr-2">Select</button>
                            ${renameBtn}
                            ${deleteBtn}
                        </div>
                    </td>
                `;
            });
        }

        // Determine which store to select
        const storedStoreId = getStoredStoreId();
        let selectedId;
        if (storedStoreId && allStores[storedStoreId]) {
            selectedId = storedStoreId;
        } else {
            selectedId = Object.keys(allStores)[0];
            if (selectedId) setStoredStoreId(selectedId);
        }

        if (selectedId) {
            // Only trigger load if it's not already the current store (to avoid redundant loads)
            if (selectedId !== currentStoreId) {
                setCurrentStoreId(selectedId);
                if (storeSelector) storeSelector.value = selectedId;
                await loadStoreData();
            } else {
                if (storeSelector) storeSelector.value = selectedId;
            }
        }
    } catch (error) {
        console.error("Error populating stores:", error);
        storeSelector.innerHTML = '<option value="">Connection error</option>';
    } finally {
        isPopulatingStores = false;
    }
}

export function switchStore(newStoreId) {
    if (newStoreId === currentStoreId) return;
    setCurrentStoreId(newStoreId);
    setStoredStoreId(newStoreId);
    const storeSelector = document.getElementById('storeSelector');
    if (storeSelector && storeSelector.value !== newStoreId) storeSelector.value = newStoreId;
    loadStoreData();
    pagination.inventoryPage = 1;
    pagination.disbursementPage = 1;
    pagination.employeePage = 1;
}

export async function deleteStore(storeId) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Only Admin and Managers can delete stores.');

    showConfirmationModal(
        "Delete Entire Store",
        `Are you sure? This will PERMANENTLY delete the store "${storeId}" from the registry. Note: Sub-collections like logs may need manual cleanup in Supabase.`,
        async () => {
            try {
                const { error } = await supabase.from('stores').delete().eq('id', storeId);
                if (error) throw error;

                if (storeId === currentStoreId) {
                    setCurrentStoreId(null);
                    setStoredStoreId(null);
                    resetStoreData();
                }

                await logAuditAction('STORE_DELETED', `Permanently deleted store record: ${storeId}`);
                await populateStoreSelector();
                renderUI();
                showMessageModal("Success", `Store ${storeId} removed.`);
            } catch (e) {
                console.error("Error deleting store:", e);
                showMessageModal("Error", "Failed to delete store.");
            }
        }
    );
}

export async function renameStore(storeId) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Only Admin and Managers can rename stores.');

    const newName = prompt(`Enter new name for store "${storeId}":`);
    if (!newName || !newName.trim()) return;

    try {
        const { error } = await supabase.from('stores').update({
            name: newName.trim(),
            last_modified: new Date().toISOString()
        }).eq('id', storeId);
        
        if (error) throw error;

        await logAuditAction('STORE_RENAMED', `Renamed store ${storeId} to ${newName.trim()}`);
        await populateStoreSelector();
        renderUI();
        
        if (currentStoreId === storeId) {
            const display = document.getElementById('currentStoreDisplay');
            if (display) display.innerHTML = `<i class="fas fa-store mr-1"></i> ${newName.trim()}`;
        }
        
        showMessageModal("Success", `Store renamed to ${newName.trim()}.`);
    } catch (e) {
        console.error("Error renaming store:", e);
        showMessageModal("Error", "Failed to rename store.");
    }
}

async function loadStoreData() {
    if (!currentStoreId) return;
    const display = document.getElementById('currentStoreDisplay');
    try {
        if (display) display.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> Loading...`;

        // 1. Fetch store metadata
        const { data: storeInfo, error: storeError } = await supabase.from('stores').select('*').eq('id', currentStoreId).maybeSingle();
        if (storeError) throw storeError;
        if (!storeInfo) {
            // Stale store ID in localStorage — clear it and refresh selector
            setStoredStoreId(null);
            setCurrentStoreId(null);
            if (display) display.innerHTML = `<i class="fas fa-store mr-1"></i> Select a store`;
            await populateStoreSelector();
            return;
        }

        if (storeInfo) {
            resetStoreData();
            storeData.name = storeInfo.name;
            storeData.location = storeInfo.location;

            // Fetch all related collections in parallel
            const [inv, emp, disb, ret, resup] = await Promise.all([
                supabase.from('inventory').select('*').eq('store_id', currentStoreId),
                supabase.from('employees').select('*').eq('store_id', currentStoreId),
                supabase.from('disbursements').select('*').eq('store_id', currentStoreId),
                supabase.from('returns').select('*').eq('store_id', currentStoreId),
                supabase.from('resupplies').select('*').eq('store_id', currentStoreId)
            ]);

            storeData.inventory = inv.data || [];
            storeData.employees = emp.data || [];
            storeData.disbursements = disb.data || [];
            storeData.returns = ret.data || [];
            storeData.resupplies = resup.data || [];
        }

        // 2. Render UI immediately from Supabase data
        renderUI();

        // 3. Enforce 36-hour backup policy
        checkBackupPolicy();

        // 4. Update header with store name
        if (display) display.innerHTML = `<i class="fas fa-store mr-1"></i> ${storeData.name || 'Store'}`;

        const docId = document.getElementById('currentStoreDocId');
        if (docId) docId.textContent = currentStoreId;

        // 5. Setup Real-time Listener for this store (with cleanup)
        if (storeListenerUnsubscribe) {
            console.log("Unsubscribing from previous store listener...");
            storeListenerUnsubscribe();
        }

        let renderDebounceTimer = null;
        const channel = supabase.channel(`store_changes_${currentStoreId}`)
            .on('postgres_changes', { event: '*', schema: 'public', filter: `store_id=eq.${currentStoreId}` }, payload => {
                if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
                renderDebounceTimer = setTimeout(async () => {
                    // Simple refresh on external change
                    await loadStoreData();
                }, 500);
            })
            .subscribe();

        setStoreListenerUnsubscribe(() => supabase.removeChannel(channel));

    } catch (error) {
        console.error("Error loading store data:", error);
        if (display) display.innerHTML = `<i class="fas fa-store mr-1"></i> ${storeData.name || 'Store'}`;
    }
}

async function createStore(event) {
    event.preventDefault();
    const form = event.target;
    const storeId = form.newStoreId?.value?.trim();
    const storeName = form.newStoreName?.value?.trim();
    const storeLocation = form.newStoreLocation?.value?.trim();

    if (!storeId || !storeName) return showMessageModal("Error", "Store ID and Name are required.");

    try {
        const { error } = await supabase.from('stores').insert({
            id: storeId,
            name: storeName,
            location: storeLocation || '',
            last_modified: new Date().toISOString()
        });

        if (error) throw error;

        showMessageModal("Success", `Store "${storeName}" created.`);
        form.reset();
        await populateStoreSelector();
    } catch (error) {
        console.error("Error creating store:", error);
        showMessageModal("Error", "Failed to create store.");
    }
}

// =========================================================================
// AUDIT LOGGING
// =========================================================================
export async function logAuditAction(action, details, metadata = {}) {
    if (!currentStoreId) return;
    try {
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('event_logs').insert({
            store_id: currentStoreId,
            action,
            details,
            metadata,
            "user": user?.email || 'unknown',
            user_role: currentUserRole || 'unknown'
        });
    } catch (e) { console.error("Supabase audit log failed:", e); }
}

function logEvent(type, details) {
    logAuditAction(type, details);
}

function checkForAutoBackup() { /* Disabled for hybrid migration */ }
function updateOfflineStatus() { /* Placeholder */ }

// =========================================================================
// EXPOSE ALL FUNCTIONS TO WINDOW for HTML onclick compatibility
// =========================================================================
window.showTab = modals.showTab;
window.showDisbursementForm = modals.showDisbursementForm;
window.showReturnForm = modals.showReturnForm;
window.showBatchDisbursementForm = modals.showBatchDisbursementForm;
window.showSupplyForm = modals.showSupplyForm;
window.hideSupplyForm = modals.hideSupplyForm;
window.showResupplyForm = modals.showResupplyForm;
window.hideResupplyForm = modals.hideResupplyForm;
window.showAddEmployeeForm = modals.showAddEmployeeForm;
window.hideAddEmployeeForm = modals.hideAddEmployeeForm;
window.showItemDetailsModal = modals.showItemDetailsModal;
window.showEmployeeDetailsModal = modals.showEmployeeDetailsModal;
window.hideModal = hideModal;
window.switchChart = dashboard.switchChart;
window.handleLogout = async () => {
    console.log("Logging out, cleaning up listeners...");
    if (storeListenerUnsubscribe) {
        try { storeListenerUnsubscribe(); } catch (e) { console.error("Unsubscribe failed:", e); }
    }
    await supabase.auth.signOut();
};
window.togglePasswordVisibility = togglePasswordVisibility;
window.switchStore = switchStore;
window.addItem = inventory.addItem;
window.resupplyItem = inventory.resupplyItem;
window.addEmployee = employees.addEmployee;
window.deleteStore = deleteStore;
window.renameStore = renameStore;
window.filterEmployees = employees.renderEmployees;
window.editItem = inventory.editItem;
window.editEmployee = employees.editEmployee;
window.deleteItemConfirmation = inventory.deleteItemConfirmation;
window.checkBackupPolicy = checkBackupPolicy;
window.deleteEmployeeConfirmation = employees.deleteEmployeeConfirmation;
window.recordDisbursement = disbursements.recordDisbursement;
window.recordReturn = disbursements.recordReturn;
window.deleteTransaction = disbursements.deleteTransaction;
window.deleteSelectedInventoryItems = inventory.deleteSelectedInventoryItems;
window.addDisbursementItemRow = modals.addDisbursementItemRow;
window.addReturnItemRow = disbursements.addReturnItemRow;
window.addBatchDisbursementItemRow = disbursements.addBatchDisbursementItemRow;
window.filterBatchRecipientsByDesignation = disbursements.filterBatchRecipientsByDesignation;
window.recordBatchDisbursement = disbursements.recordBatchDisbursement;
window.filterInventory = inventory.renderInventory;
window.clearInventoryFilters = () => {
    const search = document.getElementById('inventorySearch');
    const filter = document.getElementById('inventoryStockFilter');
    if (search) search.value = '';
    if (filter) filter.value = '';
    inventory.renderInventory();
};
window.changeInventoryPage = inventory.changeInventoryPage;
window.changeEmployeePage = (dir) => {
    pagination.employeePage += dir;
    if (pagination.employeePage < 1) pagination.employeePage = 1;
    employees.renderEmployees();
};
window.changeDisbursementPage = (dir) => {
    pagination.disbursementPage += dir;
    if (pagination.disbursementPage < 1) pagination.disbursementPage = 1;
    disbursements.renderDisbursements();
};
window.showPruneDataModal = modals.showPruneDataModal;
window.printReportContent = reports.printReportContent;
window.viewTransactionSlip = reports.viewTransactionSlip;
window.viewSupplySlip = reports.viewSupplySlip;
window.generateItemReport = reports.generateItemReport;
window.generateEmployeeReport = reports.generateEmployeeReport;
window.showDisbursementReportModal = reports.showDisbursementReportModal;
window.showStoreReportModal = reports.showStoreReportModal;
window.generateCurrentStockReport = reports.generateCurrentStockReport;
window.renderSavedReports = reports.renderSavedReports;
window.viewSavedReport = reports.viewSavedReport;
window.deleteSavedReport = reports.deleteSavedReport;
window.forceSyncToDrive = exportStoreBackup;
window.importOldJsonBackup = importOldJsonBackup;
window.saveStoreData = saveStoreData;
window.populateStoreSelector = populateStoreSelector;
window.showMessageModal = showMessageModal;
window.showConfirmationModal = showConfirmationModal;

// =========================================================================
// AUTH STATE LISTENER
// =========================================================================
import * as userManagement from './ui/userManagement.js';

supabase.auth.onAuthStateChange(async (event, session) => {
    const user = session?.user;
    if (user) {
        console.log("User is signed in:", user.email);
        const email = user.email.toLowerCase();

        // Query user_roles table
        const { data: roleData, error } = await supabase
            .from('user_roles')
            .select('role')
            .eq('email', email)
            .maybeSingle();

        let role = 'Restricted';
        if (!error && roleData) {
            role = roleData.role;
        }

        setCurrentUserRole(role === 'Restricted' ? null : role);
        const username = email.split('@')[0];
        document.getElementById('userName').textContent = role === 'Admin' ? 'Admin User' : username;
        document.getElementById('userRole').textContent = role === 'Admin' ? 'Administrator' : role;
        document.getElementById('userInitials').textContent = role === 'Admin' ? 'A' : username.substring(0, 2).toUpperCase();

        // Control User Management sidebar visibility
        const navUserMgmt = document.getElementById('navUserManagement');
        if (navUserMgmt) {
            if (role === 'Admin' || role === 'Manager') {
                navUserMgmt.classList.remove('hidden');
            } else {
                navUserMgmt.classList.add('hidden');
            }
        }

        localStorage.setItem('isLoggedIn', 'true');
        document.getElementById('loginPage')?.classList.add('hidden');
        document.getElementById('appContainer')?.classList.remove('hidden');

        // Fast Track
        const lastId = getStoredStoreId();
        if (lastId) {
            console.log("Fast Track: Loading last store", lastId);
            setCurrentStoreId(lastId);
            const storeSelector = document.getElementById('storeSelector');
            if (storeSelector) {
                storeSelector.innerHTML = `<option value="${lastId}">Last used store...</option>`;
                storeSelector.value = lastId;
            }
            loadStoreData();
        }

        populateStoreSelector();
    } else {
        console.log("User is signed out");
        setCurrentUserRole(null);
        localStorage.removeItem('isLoggedIn');
        document.getElementById('appContainer')?.classList.add('hidden');
        document.getElementById('loginPage')?.classList.remove('hidden');
        const navUserMgmt = document.getElementById('navUserManagement');
        if (navUserMgmt) navUserMgmt.classList.add('hidden');
    }
});

// Use event delegation for all sidebar navigation - works regardless of timing
document.addEventListener('click', (e) => {
    const sidebarItem = e.target.closest('.sidebar-item');
    if (sidebarItem && sidebarItem.dataset.tab) {
        window.showTab(sidebarItem.dataset.tab);
    }
});

// Form bindings - modules are deferred so DOM is already ready
{

    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();
            const email = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const loginError = document.getElementById('loginError');

            let finalEmail = email.includes('@') ? email : email + '@storemanager.app';

            const { error } = await supabase.auth.signInWithPassword({
                email: finalEmail,
                password: password
            });

            if (error) {
                console.error("Login error:", error);
                if (loginError) {
                    loginError.textContent = "Invalid email or password";
                    loginError.classList.remove('hidden');
                }
            } else {
                if (loginError) loginError.classList.add('hidden');
            }
        };
    }

    // Store selector change
    const storeSelector = document.getElementById('storeSelector');
    if (storeSelector) {
        storeSelector.onchange = (e) => {
            if (e.target.value) switchStore(e.target.value);
        };
    }

    // Create store form
    const createStoreForm = document.getElementById('addStoreForm');
    if (createStoreForm) {
        createStoreForm.onsubmit = createStore;
    }

    // Add item form
    const addItemForm = document.getElementById('addItemForm');
    if (addItemForm) addItemForm.onsubmit = addItem;

    // Resupply form
    const resupplyForm = document.getElementById('resupplyForm');
    if (resupplyForm) resupplyForm.onsubmit = resupplyItem;

    // Add employee form
    const addEmployeeForm = document.getElementById('addEmployeeForm');
    if (addEmployeeForm) addEmployeeForm.onsubmit = addEmployee;

    // Edit item form
    const editItemForm = document.getElementById('editItemForm');
    if (editItemForm) editItemForm.onsubmit = editItem;

    // Edit employee form
    const editEmployeeForm = document.getElementById('editEmployeeForm');
    if (editEmployeeForm) editEmployeeForm.onsubmit = editEmployee;

    // Disbursement form
    const disbursementForm = document.getElementById('disbursementForm');
    if (disbursementForm) disbursementForm.onsubmit = disbursements.recordDisbursement;

    // Batch Disbursement form
    const batchDisbursementForm = document.getElementById('batchDisbursementForm');
    if (batchDisbursementForm) batchDisbursementForm.onsubmit = disbursements.recordBatchDisbursement;

    // Return form
    const returnForm = document.getElementById('returnForm');
    if (returnForm) returnForm.onsubmit = recordReturn;
}
