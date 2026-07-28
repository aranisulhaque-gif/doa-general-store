// Admin re-authentication handled by Firebase session
async function handleAdminReauth(event) {
    event.preventDefault();
    // For now, if they are logged in as Admin or Manager, we allow it.
    if (currentUserRole === 'Admin') {
        document.getElementById('reauthError').classList.add('hidden');
        hideModal('adminReauthModal');
        if (adminReauthCallback) {
            adminReauthCallback();
            adminReauthCallback = null;
        }
    } else {
        document.getElementById('reauthError').classList.remove('hidden');
    }
}

// =========================================================================
// 1. FIREBASE SETUP AND GLOBAL STATE
// =========================================================================

// Firebase configuration - Updated with provided config
const firebaseConfig = {
    apiKey: "AIzaSyAIEstUAUtRTmHEy5l8kq1MfgVRl-gLSI4",
    authDomain: "doa-general-store.firebaseapp.com",
    projectId: "doa-general-store",
    storageBucket: "doa-general-store.firebasestorage.app",
    messagingSenderId: "628381673146",
    appId: "1:628381673146:web:dc0406d6de48a8a2168483"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// =========================================================================
// 1.5 GOOGLE APPS SCRIPT API SETUP
// =========================================================================
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbwzbTmqHtumDw5IjW1aTtPYjk1N6z1GS-Bv1RCIsDl8rD-RxVev-sWZfn_ft-uf1Zyq/exec";

async function apiGet(action, params = {}) {
    const url = new URL(GAS_API_URL);
    url.searchParams.append('action', action);
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

    // GAS requires redirect: 'follow'
    const response = await fetch(url.toString(), { redirect: 'follow' });
    const result = await response.json();
    if (result.status === 'error') throw new Error(result.message);
    return result.data;
}

async function apiPost(action, payload = {}) {
    // GAS POST requests with JSON require special handling
    // We send payload directly structured. GAS parses e.postData.contents
    const data = { action, ...payload };
    const response = await fetch(GAS_API_URL, {
        method: 'POST',
        // GAS requires text/plain for complex CORS, handled securely in backend
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(data),
        redirect: 'follow'
    });
    const result = await response.json();
    if (result.status === 'error') throw new Error(result.message);
    return result.data;
}

// Auth State Listener
auth.onAuthStateChanged(user => {
    if (user) {
        console.log("User is signed in:", user.email);
        // Determine role based on email
        const email = user.email.toLowerCase();

        // Define roles list
        const admins = [
            'admin@storemanager.app',
            'doa.establishment@gmail.com',
            'raquib@generalstore.app',
            'rubel@generalstore.app'
        ];
        const managers = [
            'bulbul@generalstore.app',
            'saddam@generalstore.app'
        ];

        if (admins.includes(email)) {
            currentUserRole = 'Admin';
            document.getElementById('userName').textContent = 'Admin User';
            document.getElementById('userRole').textContent = 'Administrator';
            document.getElementById('userInitials').textContent = 'A';
        } else if (managers.includes(email)) {
            currentUserRole = 'Manager';
            const username = email.split('@')[0];
            document.getElementById('userName').textContent = username;
            document.getElementById('userRole').textContent = 'Manager';
            document.getElementById('userInitials').textContent = username.substring(0, 2).toUpperCase();
        } else {
            currentUserRole = null;
            const username = email.split('@')[0];
            document.getElementById('userName').textContent = username;
            document.getElementById('userRole').textContent = 'Restricted';
            document.getElementById('userInitials').textContent = username.substring(0, 2).toUpperCase();
        }

        localStorage.setItem('isLoggedIn', 'true');
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('appContainer').classList.remove('hidden');

        // Initialize app data if not already done
        // We assume initializeApp is defined globally
        if (typeof initializeApp === 'function' && !currentStoreId) {
            initializeApp();
        }

        // Check for auto-backup (Admin and Manager only)
        if (currentUserRole === 'Admin') {
            checkForAutoBackup();
        }
    } else {
        console.log("User is signed out");
        currentUserRole = null;
        localStorage.removeItem('isLoggedIn');
        document.getElementById('appContainer').classList.add('hidden');
        document.getElementById('loginPage').classList.remove('hidden');
    }
});

// Global State Variables
let storeData = {
    name: "DOA Store",
    location: "DOA HQ",
    inventory: [],
    employees: [],
    disbursements: [],
    returns: [],
    resupplies: [],
    savedReports: [],
    eventLogs: [],
    lastBackup: new Date(0)
};

let allStores = {};
let currentStoreId = null;
let currentUserRole = null;

// Pagination State
let inventoryPage = 1;
let inventoryPerPage = 10;
let disbursementPage = 1;
let disbursementPerPage = 10;
let employeePage = 1;
let employeesPerPage = 10;

// Listener Unsubscribe Handle
let storeListenerUnsubscribe = null;

// Store persistence functions
function getStoredStoreId() {
    return localStorage.getItem('lastSelectedStoreId');
}

function setStoredStoreId(storeId) {
    localStorage.setItem('lastSelectedStoreId', storeId);
}

// =========================================================================
// 1.7 SYNC ENGINE (HYBRID ARCHITECTURE)
// =========================================================================
const syncState = {
    isSyncing: false,
    progress: 0,
    lastSyncTime: null
};

async function showSyncSplash() {
    const splash = document.getElementById('syncSplash');
    if (splash) {
        splash.classList.remove('hidden');
        splash.style.opacity = '1';
    }
}

async function hideSyncSplash() {
    const splash = document.getElementById('syncSplash');
    if (splash) {
        splash.style.opacity = '0';
        setTimeout(() => splash.classList.add('hidden'), 500);
    }
}

function updateSyncProgress(progress, status) {
    syncState.progress = progress;
    const bar = document.getElementById('syncProgressBar');
    const text = document.getElementById('syncStatus');
    if (bar) bar.style.width = `${progress}%`;
    if (text) text.textContent = status || "Synchronizing...";
}

async function orchestrateSync() {
    if (!currentStoreId) return;

    syncState.isSyncing = true;
    await showSyncSplash();
    updateSyncProgress(10, "Initializing secure connection...");

    try {
        // 1. Check if Firestore has data
        const storeRef = db.collection('stores').doc(currentStoreId);
        const doc = await storeRef.get();
        const firestoreData = doc.data() || {};

        // Use lastSyncToGAS as the cutoff
        const lastSyncToGAS = firestoreData.lastSyncToGAS ? new Date(firestoreData.lastSyncToGAS).getTime() : 0;

        // 2. Data Migration / Alignment Check
        // Use hasMigratedFromGAS flag to prevent infinite re-migration if inventory is intentionally empty
        if (!firestoreData.hasMigratedFromGAS && (!firestoreData.inventory || firestoreData.inventory.length === 0)) {
            updateSyncProgress(30, "Migrating history from Google Drive...");
            const gasData = await apiGet('getFullStoreData', { storeId: currentStoreId });

            await storeRef.set({
                ...gasData,
                lastSyncTime: new Date().toISOString(),
                lastSyncToGAS: new Date().toISOString(),
                hasMigratedFromGAS: true
            }, { merge: true });

            Object.assign(storeData, gasData);
            renderUI();
            updateSyncProgress(60, "Migration complete. Optimizing local cache...");
        } else {
            updateSyncProgress(40, "Checking for session updates...");

            // 2. Calculate Delta (Items modified or deleted after lastSyncToGAS)
            const updates = {};
            const collections = ['inventory', 'employees', 'disbursements', 'returns', 'resupplies', 'savedReports', 'eventLogs'];
            const pendingDeletions = firestoreData.pendingDeletions || {};

            let hasChanges = false;
            collections.forEach(key => {
                const items = storeData[key] || [];
                const modifiedItems = items.filter(item => {
                    const modifiedTime = item.lastModified ? new Date(item.lastModified).getTime() : 0;
                    return modifiedTime > lastSyncToGAS;
                });

                const deletedIds = pendingDeletions[key] || [];

                if (modifiedItems.length > 0 || deletedIds.length > 0) {
                    updates[key] = {
                        updated: modifiedItems,
                        deleted: deletedIds
                    };
                    hasChanges = true;
                }
            });

            if (hasChanges) {
                updateSyncProgress(70, "Syncing changes to Google Drive...");
                await apiPost('syncIncrementalUpdates', {
                    storeId: currentStoreId,
                    updates: updates
                });

                // Update the lastSyncToGAS timestamp and CLEAR pending deletions
                await storeRef.set({
                    lastSyncToGAS: new Date().toISOString(),
                    pendingDeletions: {} // Clear after successful sync
                }, { merge: true });
                updateSyncProgress(90, "Backup complete.");
            }
        }

        updateSyncProgress(100, "All systems aligned. Welcome back!");
        setTimeout(async () => {
            await hideSyncSplash();
            syncState.isSyncing = false;
        }, 800);

    } catch (error) {
        console.error("Sync orchestration failed:", error);
        updateSyncProgress(100, "Sync bypassed. Offline mode active.");
        setTimeout(() => hideSyncSplash(), 2000);
    }
}

// =========================================================================
// 2. LOGIN HANDLING
// =========================================================================

function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('username').value; // Using username field for email
    const password = document.getElementById('password').value;
    const loginError = document.getElementById('loginError');

    // Simple check to append domain if user just types "admin" or "user01"
    let finalEmail = email;
    if (!email.includes('@')) {
        finalEmail = email + '@storemanager.app';
    }

    // Set persistence to SESSION (clears auth on tab close)
    auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
        .then(() => {
            return auth.signInWithEmailAndPassword(finalEmail, password);
        })
        .then((userCredential) => {
            // Signed in
            loginError.classList.add('hidden');
            // onAuthStateChanged will handle the UI update
        })
        .catch((error) => {
            console.error("Login error:", error);
            loginError.textContent = "Invalid email or password";
            loginError.classList.remove('hidden');
        });
}

function togglePasswordVisibility() {
    const passwordInput = document.getElementById('password');
    const toggleIcon = document.getElementById('passwordToggleIcon');

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleIcon.classList.remove('fa-eye');
        toggleIcon.classList.add('fa-eye-slash');
    } else {
        passwordInput.type = 'password';
        toggleIcon.classList.remove('fa-eye-slash');
        toggleIcon.classList.add('fa-eye');
    }
}

// Chart Tab Switching
function switchChart(chartName) {
    // Hide all chart containers
    document.querySelectorAll('.chart-container').forEach(container => {
        container.style.display = 'none';
    });

    // Remove active class from all tabs
    document.querySelectorAll('.chart-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // Show selected chart
    document.getElementById(`chart-${chartName}`).style.display = 'block';

    // Activate selected tab
    document.getElementById(`tab-${chartName}`).classList.add('active');
}

// TEMPORARY: Create initial users in Firebase Auth
// Initial users creation function removed for security and cleanup

function handleLogout() {
    auth.signOut().then(() => {
        // Sign-out successful.
        // onAuthStateChanged will handle UI
        if (storeListenerUnsubscribe) {
            storeListenerUnsubscribe();
            storeListenerUnsubscribe = null;
        }
        document.body.classList.remove('offline');
    }).catch((error) => {
        console.error("Logout error:", error);
    });
}

// =========================================================================
// 3. CORE DATA MANAGEMENT
// =========================================================================

/**
 * The single source of truth for saving data to the backend.
 */
async function saveStoreData(updates) {
    if (!currentStoreId) return console.error("No store selected for saving.");

    try {
        // Immediate local UI update for responsiveness
        Object.keys(updates).forEach(key => {
            storeData[key] = updates[key];
        });
        renderUI();

        // 1. Primary Write: Firestore (Blazing Fast)
        const storeRef = db.collection('stores').doc(currentStoreId);
        await storeRef.set({
            ...updates,
            lastModified: new Date().toISOString()
        }, { merge: true });

        console.log("Data saved to Firestore successfully.");
    } catch (error) {
        console.error("Error saving data to Firestore:", error);
        showMessageModal("Error", "Failed to save data. Changes might not persist.");
    }
}

/**
 * Fetches and lists all stores for the selector and management tab.
 */
async function populateStoreSelector() {
    const storeSelector = document.getElementById('storeSelector');
    const storeListBody = document.getElementById('storeList');

    storeSelector.innerHTML = '<option value="">Loading stores...</option>';
    storeListBody.innerHTML = '';
    allStores = {};

    try {
        // Fetch stores from Google Apps Script
        const stores = await apiGet('getAllStores');

        if (!stores || Object.keys(stores).length === 0) {
            // No stores exist yet — show a helpful empty state
            storeSelector.innerHTML = '<option value="">No stores — Import JSON first</option>';
            console.log("No stores found in database. Waiting for JSON import.");
            return;
        }

        allStores = stores;

        // Populate store selector
        storeSelector.innerHTML = '';
        Object.entries(allStores).forEach(([id, store]) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = store.name || id;
            storeSelector.appendChild(option);
        });

        // Populate store management table
        storeListBody.innerHTML = '';
        Object.entries(allStores).forEach(([id, store]) => {
            const row = storeListBody.insertRow();
            row.innerHTML = `
                <td class="px-4 py-3 table-cell">${id}</td>
                <td class="px-4 py-3 table-cell">${store.name || 'N/A'}</td>
                <td class="px-4 py-3 table-cell">${store.location || 'N/A'}</td>
                <td class="px-4 py-3 table-cell">
                    <button onclick="switchStore('${id}')" class="compact-button btn-primary mr-1">Select</button>
                    <!-- Delete disabled temporarily during migration phase -->
                    <button class="compact-button btn-danger hidden">Delete</button>
                </td>
            `;
        });

        // Determine which store to select
        const storedStoreId = getStoredStoreId();

        if (storedStoreId && allStores[storedStoreId]) {
            // Use previously selected store
            currentStoreId = storedStoreId;
            storeSelector.value = storedStoreId;
        } else if (Object.keys(allStores).length > 0) {
            // Use first store as default
            currentStoreId = Object.keys(allStores)[0];
            storeSelector.value = currentStoreId;
            setStoredStoreId(currentStoreId);
        }

        // Load store data
        if (currentStoreId) {
            await loadStoreData();
        }

    } catch (error) {
        console.error("Error populating stores:", error);
        storeSelector.innerHTML = '<option value="">Connection error</option>';
        // Do NOT call createDefaultStore here — it causes infinite recursion
    }
}

/**
 * Creates a brand new default store.
 */
async function createDefaultStore() {
    console.log("Creating default store...");
    const defaultId = 'default-store-id';
    currentStoreId = defaultId;
    setStoredStoreId(defaultId);

    const defaultStoreData = {
        name: "DOA Store",
        location: "DOA HQ",
        lastBackup: new Date(0)
    };

    allStores[defaultId] = {
        name: defaultStoreData.name,
        location: defaultStoreData.location
    };

    // Save strictly the top-level keys required for the store overview
    await apiPost('saveStoreDataUpdates', {
        storeId: defaultId,
        updates: defaultStoreData
    });

    await populateStoreSelector();
}

/**
 * Loads full store data from Google Apps Script.
 */
let storeDataLoadedPromise = Promise.resolve(); // Initialize with a resolved promise
let storeDataLoadedResolve; // Function to resolve the promise

async function loadStoreData() {
    if (!currentStoreId) return;

    // Create a new promise for this load operation
    storeDataLoadedPromise = new Promise(resolve => {
        storeDataLoadedResolve = resolve;
    });

    try {
        // Show loading indicator
        document.getElementById('currentStoreDisplay').innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> Syncing...`;

        // 1. Initial Load from Firestore (Source of Truth)
        const doc = await db.collection('stores').doc(currentStoreId).get();
        if (doc.exists) {
            storeData = doc.data();
            renderUI();
        }

        // 2. Trigger Sync Engine (Background backup / migration from GAS)
        // If orchestrateSync is not available globally, we'll need to define a simple version here or Ensure it's bundled
        if (typeof orchestrateSync === 'function') {
            await orchestrateSync();
        } else {
            console.log("Sync orchestrator not found. Proceeding with Firestore data.");
        }

        document.getElementById('currentStoreDocId').textContent = currentStoreId;
        document.getElementById('currentStoreDisplay').innerHTML = `<i class="fas fa-store mr-1"></i> ${storeData.name}`;
        document.title = 'DOA | Store Manager';

        // 3. Setup Firestore Real-time Listener
        if (storeListenerUnsubscribe) storeListenerUnsubscribe();
        storeListenerUnsubscribe = db.collection('stores').doc(currentStoreId).onSnapshot(snapshot => {
            if (snapshot.exists) {
                const newData = snapshot.data();
                // Merge carefully or replace
                Object.assign(storeData, newData);
                renderUI();
            }
        });

        // Resolve the promise once data is loaded
        if (storeDataLoadedResolve) {
            storeDataLoadedResolve();
            storeDataLoadedResolve = null;
        }

        updateOfflineStatus();
    } catch (error) {
        console.error("Error specialized store loading:", error);
        showMessageModal("Notice", "Store data loading interrupted. Check console for details.");
        document.getElementById('currentStoreDisplay').innerHTML = `<i class="fas fa-exclamation-triangle text-yellow-500 mr-1"></i> No Data`;

        if (storeDataLoadedResolve) {
            storeDataLoadedResolve();
            storeDataLoadedResolve = null;
        }
    }
}

/**
 * Switches the active store.
 */
function switchStore(newStoreId) {
    if (newStoreId === currentStoreId) return;
    currentStoreId = newStoreId;

    // Persist the store selection
    setStoredStoreId(newStoreId);

    const storeSelector = document.getElementById('storeSelector');
    if (storeSelector.value !== newStoreId) {
        storeSelector.value = newStoreId;
    }

    loadStoreData();

    inventoryPage = 1;
    disbursementPage = 1;
}

// =========================================================================
// 4. UTILITY FUNCTIONS
// =========================================================================

/**
 * Generates a simplified ID
 */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

/**
 * Formats a date string or Date object into dd/mm/yyyy format.
 */
function formatDate(date) {
    if (!date) return 'N/A';
    let d;
    if (date instanceof Date) {
        d = date;
    } else if (typeof date === 'string' || typeof date === 'number') {
        d = new Date(date);
    } else {
        return 'Invalid Date';
    }

    // Ensure we have a valid date
    if (isNaN(d.getTime())) return 'Invalid Date';

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

/**
 * Formats a date and time string or Date object into dd/mm/yyyy hh:mm format.
 */
function formatDateTime(date) {
    if (!date) return 'N/A';
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'Invalid Date';

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');

    return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/**
 * Converts dd/mm/yyyy to yyyy-mm-dd for input fields
 */
function formatDateForInput(dateStr) {
    if (!dateStr || dateStr === 'N/A') return '';
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
}

/**
 * Displays a generic message modal.
 */
function showMessageModal(title, message) {
    document.getElementById('messageTitle').textContent = title;
    document.getElementById('messageContent').textContent = message;
    document.getElementById('messageModal').classList.remove('hidden');
}

/**
 * Displays a generic confirmation modal.
 */
function showConfirmationModal(title, message, callback) {
    document.getElementById('confirmationTitle').textContent = title;
    document.getElementById('confirmationMessage').textContent = message;

    const confirmButton = document.getElementById('confirmActionButton');
    confirmButton.onclick = () => {
        hideModal('confirmationModal');
        callback();
    };

    document.getElementById('confirmationModal').classList.remove('hidden');
}

/**
 * Hides any modal.
 */
function hideModal(id) {
    document.getElementById(id).classList.add('hidden');
}

/**
 * Logs an event to the GAS backend event logs tab.
 */
async function logAuditAction(action, details, metadata = {}) {
    if (!currentStoreId) return;

    const auditEntry = {
        id: generateId(),
        action: action,
        details: details,
        user: currentUserRole === 'Admin' ? 'Admin' : (firebase.auth().currentUser ? firebase.auth().currentUser.email : 'Unknown'),
        userRole: currentUserRole,
        timestamp: new Date().toISOString(),
        metadata: metadata
    };

    try {
        await apiPost('logAuditAction', {
            storeId: currentStoreId,
            logData: auditEntry
        });

        // Optimistically add to local UI state for immediate rendering
        if (!storeData.eventLogs) storeData.eventLogs = [];
        storeData.eventLogs.unshift(auditEntry);
        // Only keep last 50 locally to prevent bloat
        if (storeData.eventLogs.length > 50) storeData.eventLogs.pop();

        if (document.getElementById('data-storage') && !document.getElementById('data-storage').classList.contains('hidden')) {
            renderEventLogs();
        }
        console.log("Audit log recorded to GAS:", action);
    } catch (error) {
        console.error("Failed to record audit log:", error);
    }
}

// Legacy wrapper to maintain compatibility if called elsewhere
async function logEvent(type, details) {
    await logAuditAction(type, details);
}

// =========================================================================
// 5. UI RENDERING & LOGIC
// =========================================================================

/**
 * Rerenders all sections of the UI based on the current global storeData.
 */
function renderUI() {
    if (currentUserRole !== 'Admin') {
        document.getElementById('maintenanceSection')?.classList.add('hidden');
        document.getElementById('batchDeleteBtn')?.classList.add('hidden');
        document.getElementById('exportJsonBtn')?.classList.add('hidden');
        document.getElementById('importJsonBtn')?.classList.add('hidden');
    } else {
        document.getElementById('maintenanceSection')?.classList.remove('hidden');
        document.getElementById('exportJsonBtn')?.classList.remove('hidden');
        document.getElementById('importJsonBtn')?.classList.remove('hidden');
    }

    renderDashboard();
    renderInventory();
    renderEmployees();
    renderDisbursements();
    renderEventLogs();
    renderSavedReports();

    populateEmployeeSelectors();
    populateResupplyItemSelect();
    populateReportSelectors();

    renderBackupList();
}

/**
 * Renders the dashboard statistics and charts.
 */
let inventoryChartInstance = null;
let consumptionChartInstance = null;
let trendsChartInstance = null;

function renderDashboard() {
    const inventory = storeData.inventory || [];
    const disbursements = storeData.disbursements || [];
    const returns = storeData.returns || [];
    const employees = storeData.employees || [];

    const totalItems = inventory.length;
    const totalStock = inventory.reduce((sum, item) => sum + item.quantity, 0);
    const totalDisbursements = disbursements.length;
    const totalReturns = returns.length;
    const totalEmployees = employees.length;

    const lowStockCount = inventory.filter(item => item.quantity < 10 && item.quantity > 0).length;
    const outOfStockCount = inventory.filter(item => item.quantity <= 0).length;

    // Low stock items for inventory chart
    const lowStockItems = inventory
        .filter(item => item.quantity <= 20)
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, 10);

    const statsGrid = document.getElementById('stats-grid');
    statsGrid.innerHTML = `
        <div class="stat-card">
            <div class="flex items-center justify-between mb-2">
                <div class="p-3 rounded-xl bg-[#E0E7FF] shadow-inner">
                    <i class="fas fa-cubes text-[#3C546F] text-xl"></i>
                </div>
                <div class="text-3xl font-extrabold text-gray-800">${totalItems.toLocaleString()}</div>
            </div>
            <h3 class="text-xs font-bold uppercase tracking-wider text-gray-400">Total Items</h3>
            <p class="text-xs text-gray-500 mt-1">Inventory scope</p>
        </div>
        <div class="stat-card">
            <div class="flex items-center justify-between mb-2">
                <div class="p-3 rounded-xl bg-[#DCFCE7] shadow-inner">
                    <i class="fas fa-boxes text-[#10B981] text-xl"></i>
                </div>
                <div class="text-3xl font-extrabold text-gray-800">${totalStock.toLocaleString()}</div>
            </div>
            <h3 class="text-xs font-bold uppercase tracking-wider text-gray-400">Total Stock Units</h3>
            <p class="text-xs text-gray-500 mt-1">Live availability</p>
        </div>
        <div class="stat-card">
            <div class="flex items-center justify-between mb-2">
                <div class="p-3 rounded-xl bg-[#F5F3FF] shadow-inner">
                    <i class="fas fa-exchange-alt text-[#8B5CF6] text-xl"></i>
                </div>
                <div class="text-3xl font-extrabold text-gray-800">${(totalDisbursements + totalReturns).toLocaleString()}</div>
            </div>
            <h3 class="text-xs font-bold uppercase tracking-wider text-gray-400">Total Activities</h3>
            <p class="text-xs text-gray-500 mt-1">Disbursements & Returns</p>
        </div>
        <div class="stat-card">
            <div class="flex items-center justify-between mb-2">
                <div class="p-3 rounded-xl bg-[#FEF2F2] shadow-inner">
                    <i class="fas fa-bell text-[#EF4444] text-xl"></i>
                </div>
                <div class="text-3xl font-extrabold text-gray-800">${(lowStockCount + outOfStockCount).toLocaleString()}</div>
            </div>
            <h3 class="text-xs font-bold uppercase tracking-wider text-gray-400">Issues Flagged</h3>
            <p class="text-xs text-gray-500 mt-1">Low stock or out</p>
        </div>
    `;

    // Inventory Chart (Low Stock)
    const invCtx = document.getElementById('inventoryChart');
    if (invCtx) {
        if (inventoryChartInstance) inventoryChartInstance.destroy();
        inventoryChartInstance = new Chart(invCtx, {
            type: 'bar',
            data: {
                labels: lowStockItems.map(item => wrapLabel(item.name, 15)),
                datasets: [{
                    label: 'Current Quantity',
                    data: lowStockItems.map(item => item.quantity),
                    backgroundColor: lowStockItems.map(item => item.quantity <= 0 ? 'rgba(239, 68, 68, 0.8)' : 'rgba(37, 99, 235, 0.8)'),
                    borderColor: lowStockItems.map(item => item.quantity <= 0 ? 'rgb(239, 68, 68)' : 'rgb(37, 99, 235)'),
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true },
                    x: {
                        ticks: {
                            maxRotation: 0,
                            minRotation: 0,
                            autoSkip: false
                        }
                    }
                },
                plugins: { legend: { display: false }, title: { display: false } }
            }
        });
    }

    // Consumption Chart (Most Consumed Items)
    const consumptionData = calculateMostConsumedItems(disbursements, inventory);
    const consCtx = document.getElementById('consumptionChart');
    if (consCtx) {
        if (consumptionChartInstance) consumptionChartInstance.destroy();
        consumptionChartInstance = new Chart(consCtx, {
            type: 'bar',
            data: {
                labels: consumptionData.map(item => wrapLabel(item.name, 15)),
                datasets: [{
                    label: 'Total Disbursed',
                    data: consumptionData.map(item => item.totalDisbursed),
                    backgroundColor: 'rgba(242, 120, 92, 0.8)',
                    borderColor: 'rgb(242, 120, 92)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true },
                    x: {
                        ticks: {
                            maxRotation: 0,
                            minRotation: 0,
                            autoSkip: false
                        }
                    }
                },
                plugins: { legend: { display: false }, title: { display: false } }
            }
        });
    }

    // Trends Chart (Disbursement Trends)
    const trendsData = calculateDisbursementTrends(disbursements);
    const trendsCtx = document.getElementById('trendsChart');
    if (trendsCtx) {
        if (trendsChartInstance) trendsChartInstance.destroy();
        trendsChartInstance = new Chart(trendsCtx, {
            type: 'line',
            data: {
                labels: trendsData.labels,
                datasets: [{
                    label: 'Items Disbursed',
                    data: trendsData.data,
                    borderColor: 'rgb(60, 84, 111)',
                    backgroundColor: 'rgba(60, 84, 111, 0.1)',
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } },
                plugins: { legend: { display: true }, title: { display: false } }
            }
        });
    }
}

/**
 * Wraps long labels into multiple lines for better chart readability
 */
function wrapLabel(label, maxLength = 15) {
    if (label.length <= maxLength) return label;

    const words = label.split(' ');
    const lines = [];
    let currentLine = '';

    words.forEach(word => {
        if ((currentLine + word).length <= maxLength) {
            currentLine += (currentLine ? ' ' : '') + word;
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }
    });

    if (currentLine) lines.push(currentLine);
    return lines;
}

/**
 * Calculates the most consumed items from disbursements
 */
function calculateMostConsumedItems(disbursements, inventory) {
    const itemConsumption = {};

    disbursements.forEach(d => {
        d.items.forEach(item => {
            if (!itemConsumption[item.itemId]) {
                itemConsumption[item.itemId] = {
                    id: item.itemId,
                    name: item.itemName || 'Unknown',
                    totalDisbursed: 0
                };
            }
            itemConsumption[item.itemId].totalDisbursed += item.quantity;
        });
    });

    return Object.values(itemConsumption)
        .sort((a, b) => b.totalDisbursed - a.totalDisbursed)
        .slice(0, 10);
}

/**
 * Calculates disbursement trends over the last 6 months
 */
function calculateDisbursementTrends(disbursements) {
    const monthlyData = {};
    const now = new Date();

    // Initialize last 6 months
    for (let i = 5; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthlyData[key] = 0;
    }

    // Aggregate disbursements by month
    disbursements.forEach(d => {
        const date = new Date(d.date);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (monthlyData[key] !== undefined) {
            monthlyData[key] += d.totalItems || 0;
        }
    });

    const labels = Object.keys(monthlyData).map(key => {
        const [year, month] = key.split('-');
        const date = new Date(year, month - 1);
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    });

    return {
        labels,
        data: Object.values(monthlyData)
    };
}

/**
 * Renders the inventory table with search and filter functionality
 */
function renderInventory() {
    const inventory = storeData.inventory || [];
    const list = document.getElementById('inventoryList');
    if (!list) return;

    list.innerHTML = '';

    // Apply search and filter
    let filteredInventory = [...inventory];
    const searchTerm = document.getElementById('inventorySearch').value.toLowerCase();
    const stockFilter = document.getElementById('inventoryStockFilter').value;

    if (searchTerm) {
        filteredInventory = filteredInventory.filter(item =>
            item.name.toLowerCase().includes(searchTerm) ||
            (item.specification && item.specification.toLowerCase().includes(searchTerm))
        );
    }

    if (stockFilter) {
        switch (stockFilter) {
            case 'low':
                filteredInventory = filteredInventory.filter(item => item.quantity < 10 && item.quantity > 0);
                break;
            case 'out':
                filteredInventory = filteredInventory.filter(item => item.quantity <= 0);
                break;
            case 'normal':
                filteredInventory = filteredInventory.filter(item => item.quantity >= 10);
                break;
        }
    }

    const start = (inventoryPage - 1) * inventoryPerPage;
    const end = start + inventoryPerPage;
    const paginatedInventory = filteredInventory.slice(start, end);
    const totalPages = Math.ceil(filteredInventory.length / inventoryPerPage);

    document.getElementById('inventoryPageInfo').textContent = `Page ${totalPages > 0 ? inventoryPage : 0} of ${totalPages}`;
    document.getElementById('prevInventoryPage').disabled = inventoryPage === 1;
    document.getElementById('nextInventoryPage').disabled = inventoryPage >= totalPages;

    if (paginatedInventory.length === 0) {
        list.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-gray-500">No items in inventory.</td></tr>`;
        return;
    }

    paginatedInventory.forEach(item => {
        const row = list.insertRow();
        const statusClass = item.quantity <= 0 ? 'bg-red-50' : (item.quantity < 10 ? 'bg-yellow-50' : '');
        row.className = statusClass + ' table-row';

        row.innerHTML = `
            <td class="px-4 py-3"><input type="checkbox" class="inventory-checkbox" data-id="${item.id}"></td>
            <td class="px-4 py-3 text-xs font-mono">${item.id.substring(0, 6)}...</td>
            <td class="px-4 py-3 table-cell">${item.name}</td>
            <td class="px-4 py-3 table-cell">${item.specification || 'N/A'}</td>
            <td class="px-4 py-3 font-bold">
                <span class="${item.quantity <= 0 ? 'text-red-600' : (item.quantity < 10 ? 'text-yellow-600' : 'text-green-600')}">
                    ${item.quantity}
                </span>
            </td>
            <td class="px-4 py-3 text-xs">${formatDate(item.lastResupplyDate)}</td>
            <td class="px-4 py-3 text-xs">${item.latestTenderId || 'N/A'}</td>
            <td class="px-4 py-3">
                <button onclick="showItemDetailsModal('${item.id}')" class="compact-button btn-outline mr-1">
                    <i class="fas fa-edit"></i>
                </button>
                <button onclick="viewSupplySlip('${item.id}')" class="compact-button btn-secondary">
                    <i class="fas fa-receipt"></i>
                </button>
            </td>
        `;
    });

    document.querySelectorAll('.inventory-checkbox').forEach(cb => {
        cb.addEventListener('change', updateBatchDeleteButton);
    });
    document.getElementById('selectAllInventory').checked = false;
    updateBatchDeleteButton();
}

/**
 * Renders the employee table with search and filter functionality
 */
function changeEmployeePage(direction) {
    employeePage += direction;
    renderEmployees();
}

function renderEmployees() {
    const employees = storeData.employees || [];
    const disbursements = storeData.disbursements || [];
    const returns = storeData.returns || [];
    const list = document.getElementById('employeeList');
    if (!list) return;

    list.innerHTML = '';

    // Apply search and filter
    let filteredEmployees = [...employees];
    const searchTerm = document.getElementById('employeeSearch').value.toLowerCase();
    const designationFilter = document.getElementById('employeeDesignationFilter').value;

    if (searchTerm) {
        filteredEmployees = filteredEmployees.filter(emp =>
            emp.name.toLowerCase().includes(searchTerm)
        );
    }

    if (designationFilter) {
        filteredEmployees = filteredEmployees.filter(emp => emp.designation === designationFilter);
    }

    const start = (employeePage - 1) * employeesPerPage;
    const end = start + employeesPerPage;
    const paginatedEmployees = filteredEmployees.slice(start, end);
    const totalPages = Math.ceil(filteredEmployees.length / employeesPerPage);

    document.getElementById('employeePageInfo').textContent = `Page ${totalPages > 0 ? employeePage : 0} of ${totalPages}`;
    document.getElementById('prevEmployeePage').disabled = employeePage === 1;
    document.getElementById('nextEmployeePage').disabled = employeePage >= totalPages;

    if (paginatedEmployees.length === 0) {
        list.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-gray-500">No employees found.</td></tr>`;
        return;
    }

    paginatedEmployees.forEach(emp => {
        const lastDisbursement = disbursements
            .filter(d => d.recipientId === emp.id)
            .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

        const lastReturn = returns
            .filter(r => r.recipientId === emp.id)
            .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

        let lastTransactionInfo = 'None';
        if (lastDisbursement && lastReturn) {
            const lastDisbursementDate = new Date(lastDisbursement.date);
            const lastReturnDate = new Date(lastReturn.date);
            if (lastDisbursementDate > lastReturnDate) {
                lastTransactionInfo = `${formatDate(lastDisbursement.date)} (Disbursed ${lastDisbursement.totalItems} items)`;
            } else {
                lastTransactionInfo = `${formatDate(lastReturn.date)} (Returned ${lastReturn.totalItems} items)`;
            }
        } else if (lastDisbursement) {
            lastTransactionInfo = `${formatDate(lastDisbursement.date)} (Disbursed ${lastDisbursement.totalItems} items)`;
        } else if (lastReturn) {
            lastTransactionInfo = `${formatDate(lastReturn.date)} (Returned ${lastReturn.totalItems} items)`;
        }

        const row = list.insertRow();
        row.className = 'table-row';
        row.innerHTML = `
            <td class="px-4 py-3 text-xs font-mono">${emp.id.substring(0, 6)}...</td>
            <td class="px-4 py-3">${emp.name}</td>
            <td class="px-4 py-3">${emp.designation}</td>
            <td class="px-4 py-3 table-cell text-xs">${lastTransactionInfo}</td>
            <td class="px-4 py-3">
                <button onclick="showEmployeeDetailsModal('${emp.id}')" class="compact-button btn-outline mr-1 ${currentUserRole === 'Admin' ? '' : 'hidden'}">
                    <i class="fas fa-edit"></i>
                </button>
                <button onclick="deleteEmployeeConfirmation('${emp.id}', '${emp.name}')" class="compact-button btn-danger ${currentUserRole === 'Admin' ? '' : 'hidden'}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
    });
}

/**
 * Renders the disbursement and return log table with search and filter functionality
 */
function renderDisbursements() {
    const disbursements = storeData.disbursements || [];
    const returns = storeData.returns || [];

    // Combine and sort all transactions
    const allTransactions = [
        ...disbursements.map(d => ({ ...d, type: 'disbursement' })),
        ...returns.map(r => ({ ...r, type: 'return' }))
    ].sort((a, b) => b.timestamp - a.timestamp);

    const list = document.getElementById('disbursementList');
    if (!list) return;

    list.innerHTML = '';

    // Apply search and filter
    let filteredTransactions = [...allTransactions];
    const searchTerm = document.getElementById('disbursementSearch').value.toLowerCase();
    const dateFrom = document.getElementById('disbursementDateFrom').value;
    const dateTo = document.getElementById('disbursementDateTo').value;
    const typeFilter = document.getElementById('disbursementTypeFilter').value;

    if (searchTerm) {
        filteredTransactions = filteredTransactions.filter(t => {
            const recipient = storeData.employees.find(e => e.id === t.recipientId);
            const recipientName = recipient ? recipient.name.toLowerCase() : '';
            return recipientName.includes(searchTerm);
        });
    }

    if (dateFrom) {
        filteredTransactions = filteredTransactions.filter(t => new Date(t.date) >= new Date(dateFrom));
    }

    if (dateTo) {
        filteredTransactions = filteredTransactions.filter(t => new Date(t.date) <= new Date(dateTo));
    }

    if (typeFilter) {
        filteredTransactions = filteredTransactions.filter(t => t.type === typeFilter);
    }

    const start = (disbursementPage - 1) * disbursementPerPage;
    const end = start + disbursementPerPage;
    const paginatedTransactions = filteredTransactions.slice(start, end);
    const totalPages = Math.ceil(filteredTransactions.length / disbursementPerPage);

    document.getElementById('pageInfo').textContent = `Page ${totalPages > 0 ? disbursementPage : 0} of ${totalPages}`;
    document.getElementById('prevPage').disabled = disbursementPage === 1;
    document.getElementById('nextPage').disabled = disbursementPage >= totalPages;

    if (paginatedTransactions.length === 0) {
        list.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-gray-500">No transactions found.</td></tr>`;
        return;
    }

    paginatedTransactions.forEach(t => {
        const recipient = storeData.employees.find(e => e.id === t.recipientId);
        const recipientName = recipient ? `${recipient.name} (${recipient.designation})` : 'Unknown/Batch';
        const typeBadge = t.type === 'return' ?
            '<span class="badge badge-success">Return</span>' :
            '<span class="badge badge-primary">Disbursement</span>';

        const row = list.insertRow();
        row.className = 'table-row';
        row.innerHTML = `
            <td class="px-4 py-3 text-xs font-mono">${t.id.substring(0, 6)}...</td>
            <td class="px-4 py-3 text-xs">${formatDate(t.date)}</td>
            <td class="px-4 py-3 table-cell">${recipientName}</td>
            <td class="px-4 py-3">${typeBadge}</td>
            <td class="px-4 py-3">${t.totalItems}</td>
            <td class="px-4 py-3">
                <button onclick="viewTransactionSlip('${t.id}', '${t.type}')" class="compact-button btn-outline mr-1">
                    <i class="fas fa-receipt"></i>
                </button>
                <button onclick="cloneTransaction('${t.id}', '${t.type}')" class="compact-button btn-secondary mr-1">
                    <i class="fas fa-copy"></i>
                </button>
                <button onclick="deleteTransactionConfirmation('${t.id}', '${t.type}')" class="compact-button btn-danger ${currentUserRole === 'Admin' ? '' : 'hidden'}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
    });
}

/**
 * Renders the event log table from local data (no separate collection fetch needed anymore).
 */
async function renderEventLogs() {
    const list = document.getElementById('eventLogList');
    if (!list) return;

    const logs = storeData.eventLogs || [];

    if (logs.length === 0) {
        list.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-gray-500">No events logged yet.</td></tr>`;
        return;
    }

    // Sort by timestamp descending
    const sortedLogs = [...logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 50);

    list.innerHTML = '';
    sortedLogs.forEach(event => {
        const row = list.insertRow();
        row.className = 'table-row';
        row.innerHTML = `
            <td class="px-4 py-3 text-xs">${formatDateTime(event.timestamp)}</td>
            <td class="px-4 py-3">${event.user || 'System'}</td>
            <td class="px-4 py-3"><span class="badge badge-outline">${event.action}</span></td>
            <td class="px-4 py-3 table-cell text-sm">${event.details}</td>
        `;
    });
}

/**
 * Legacy backup functions disabled for Hybrid Migration.
 * Google Sheets handles data integrity via native Version History.
 */
async function checkForAutoBackup() {
    console.log("Auto-backup handled natively by Google Drive version history.");
}

async function pruneOldBackups() {
    // Disabled
}

async function renderBackupList() {
    const list = document.getElementById('backupList');
    if (!list) return;

    list.innerHTML = `
        <tr>
            <td colspan="3" class="text-center py-8 text-gray-500">
                <i class="fas fa-info-circle text-blue-500 text-2xl mb-2"></i>
                <p>Backups are now handled automatically by Google Drive.</p>
                <p class="text-sm mt-2">Open your Google Sheet and click <b>File > Version history</b> to restore any previous state.</p>
            </td>
        </tr>`;
}

async function restoreBackup(backupId) {
    showMessageModal("Info", "Please use Google Sheets 'File > Version history' to restore data.");
}

// =========================================================================
// 6. ACTION FUNCTIONS
// =========================================================================

/**
 * Adds a new item to the inventory array.
 */
async function addItem(event) {
    if (currentUserRole !== 'Admin') return showMessageModal('Denied', 'Only Admin can add items.');
    event.preventDefault();
    const form = event.target;
    const name = form.itemName.value.trim();
    const specification = form.itemSpecification.value.trim();
    const quantity = parseInt(form.itemQuantity.value, 10);
    const tenderId = form.tenderId.value.trim();

    if (quantity <= 0) return showMessageModal("Error", "Quantity must be greater than zero.");

    // Check for duplicate item name
    const existingItem = storeData.inventory.find(item =>
        item.name.toLowerCase() === name.toLowerCase()
    );

    if (existingItem) {
        return showMessageModal("Error", `An item with the name "${name}" already exists.`);
    }

    const newItem = {
        id: generateId(),
        name,
        specification,
        quantity,
        lastResupplyDate: new Date().toISOString().split('T')[0],
        latestTenderId: tenderId || null,
        lastModified: new Date().toISOString()
    };

    await saveStoreData({
        inventory: [...storeData.inventory, newItem]
    });
    await recordResupplyLog(newItem.id, quantity, tenderId, "Initial Stock");
    await logAuditAction('ITEM_ADDED', `Added new item: ${name} (${quantity} units)`, { itemId: newItem.id, quantity });

    form.reset();
    hideSupplyForm();
    showMessageModal("Success", `Item "${name}" added to inventory.`);
}

/**
 * Resupplies an existing item by updating its quantity.
 */
async function resupplyItem(event) {
    if (currentUserRole !== 'Admin') return showMessageModal('Denied', 'Only Admin can resupply items.');
    event.preventDefault();
    const form = event.target;
    const itemId = form.resupplyItemSelect.value;
    const quantityToAdd = parseInt(form.resupplyQuantity.value, 10);
    const tenderId = form.resupplyTenderId.value.trim();

    if (quantityToAdd <= 0) return showMessageModal("Error", "Quantity to add must be greater than zero.");
    if (!itemId) return showMessageModal("Error", "Please select an item to resupply.");

    const item = storeData.inventory.find(i => i.id === itemId);
    if (!item) return showMessageModal("Error", "Item not found.");

    const newQuantity = item.quantity + quantityToAdd;
    const updatedItem = {
        ...item,
        quantity: newQuantity,
        lastResupplyDate: new Date().toISOString().split('T')[0],
        latestTenderId: tenderId || item.latestTenderId,
        lastModified: new Date().toISOString()
    };

    const newInventory = storeData.inventory.map(i => i.id === itemId ? updatedItem : i);

    await saveStoreData({ inventory: newInventory });
    await recordResupplyLog(itemId, quantityToAdd, tenderId, "Resupply");
    await logAuditAction('ITEM_RESUPPLIED', `Resupplied ${quantityToAdd} units of ${item.name}. New stock: ${newQuantity}`, { itemId, quantityAdded: quantityToAdd, newStock: newQuantity });

    form.reset();
    hideResupplyForm();
    showMessageModal("Success", `${quantityToAdd} units of "${item.name}" added. New stock: ${newQuantity}.`);
}

/**
 * Shows confirmation dialog for disbursement/return operations
 * @param {Object} data - Contains items, recipient(s), totalItems, and operation details
 * @param {string} type - 'disbursement', 'return', or 'batch'
 * @param {string} previousModalId - ID of the modal to show if cancelled
 */
function showDisbursementConfirmation(data, type, previousModalId) {
    const modal = document.getElementById('disbursementConfirmationModal');
    const titleEl = document.getElementById('confirmDisbursementTitle');
    const messageEl = document.getElementById('confirmDisbursementMessage');
    const confirmBtn = document.getElementById('confirmDisbursementButton');
    const cancelBtn = modal.querySelector('.btn-outline'); // Get the cancel button

    let title, message, buttonText;

    if (type === 'disbursement') {
        title = 'Confirm Disbursement';
        const recipient = storeData.employees.find(e => e.id === data.recipientId);
        const recipientName = recipient ? recipient.name : 'Unknown';
        message = `<p><strong>${data.totalItems}</strong> item(s) disbursed to <strong>${recipientName}</strong></p>`;
        buttonText = 'Make Disbursement';
    } else if (type === 'return') {
        title = 'Confirm Return';
        const recipient = storeData.employees.find(e => e.id === data.recipientId);
        const recipientName = recipient ? recipient.name : 'Unknown';
        message = `<p><strong>${data.totalItems}</strong> item(s) returned from <strong>${recipientName}</strong></p>`;
        buttonText = 'Make Return';
    } else if (type === 'batch') {
        title = 'Confirm Batch Disbursement';
        let lines = '';
        data.recipients.forEach(recipientId => {
            const recipient = storeData.employees.find(e => e.id === recipientId);
            const recipientName = recipient ? recipient.name : 'Unknown';
            lines += `<p><strong>${data.totalItemsPerRecipient}</strong> item(s) disbursed to <strong>${recipientName}</strong></p>`;
        });
        message = lines;
        buttonText = 'Make Disbursement';
    }

    titleEl.textContent = title;
    messageEl.innerHTML = message;
    confirmBtn.textContent = buttonText;

    // Set up confirmation button click handler
    confirmBtn.onclick = async () => {
        hideModal('disbursementConfirmationModal');
        await confirmDisbursementAction(data, type);
    };

    // Set up cancel button click handler to re-show previous modal
    cancelBtn.onclick = () => {
        hideModal('disbursementConfirmationModal');
        if (previousModalId) {
            document.getElementById(previousModalId).classList.remove('hidden');
        }
    };

    modal.classList.remove('hidden');
}

/**
 * Executes the actual disbursement/return operation after confirmation
 */
async function confirmDisbursementAction(data, type) {
    if (type === 'disbursement') {
        // Execute disbursement
        const newInventory = storeData.inventory.map(item => {
            if (data.inventoryUpdates[item.id] !== undefined) {
                return { ...item, quantity: data.inventoryUpdates[item.id], lastModified: new Date().toISOString() };
            }
            return item;
        });

        const newDisbursement = { ...data.disbursement, lastModified: new Date().toISOString() };

        await saveStoreData({
            inventory: newInventory,
            disbursements: [...storeData.disbursements, newDisbursement]
        });

        const recipient = storeData.employees.find(e => e.id === data.recipientId);
        const recipientName = recipient ? recipient.name : 'Unknown';
        await logAuditAction('DISBURSEMENT_RECORDED', `Disbursed ${data.totalItems} items to ${recipientName}`, { recipientId: data.recipientId, totalItems: data.totalItems, disbursementId: data.disbursement.id });

        document.getElementById('disbursementForm').reset();
        hideModal('disbursementModal');
        showMessageModal("Success", `Disbursement recorded successfully for ${data.totalItems} items.`);

    } else if (type === 'return') {
        // Execute return
        const newInventory = storeData.inventory.map(item => {
            if (data.inventoryUpdates[item.id] !== undefined) {
                return { ...item, quantity: data.inventoryUpdates[item.id], lastModified: new Date().toISOString() };
            }
            return item;
        });

        const newReturnRecord = { ...data.returnRecord, lastModified: new Date().toISOString() };

        await saveStoreData({
            inventory: newInventory,
            returns: [...(storeData.returns || []), newReturnRecord]
        });

        const recipient = storeData.employees.find(e => e.id === data.recipientId);
        const recipientName = recipient ? recipient.name : 'Unknown';
        await logAuditAction('RETURN_RECORDED', `Returned ${data.totalItems} items from ${recipientName}`, { recipientId: data.recipientId, totalItems: data.totalItems, returnId: data.returnRecord.id });

        document.getElementById('returnForm').reset();
        hideModal('returnModal');
        showMessageModal("Success", `Return recorded successfully for ${data.totalItems} items.`);

    } else if (type === 'batch') {
        // Execute batch disbursement
        const newInventory = storeData.inventory.map(item => {
            const totalDisbursed = (data.inventoryUpdates[item.id] || 0) * data.recipients.length;
            if (totalDisbursed > 0) {
                return { ...item, quantity: item.quantity - totalDisbursed, lastModified: new Date().toISOString() };
            }
            return item;
        });

        const batchDisbursements = data.disbursements.map(d => ({ ...d, lastModified: new Date().toISOString() }));

        await saveStoreData({
            inventory: newInventory,
            disbursements: [...storeData.disbursements, ...batchDisbursements]
        });

        await logEvent('BATCH_DISBURSEMENT_RECORDED', `Batch disbursed ${data.totalItemsPerRecipient} items each to ${data.recipients.length} recipients`);

        document.getElementById('batchDisbursementForm').reset();
        hideModal('batchDisbursementModal');
        showMessageModal("Success", `Batch disbursement recorded successfully for ${data.recipients.length} recipients.`);
    }
}

/**
 * Records a single disbursement and updates inventory quantity.
 * Automatically combines same items in the disbursement slip.
 */
async function recordDisbursement(event) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Permission denied.');
    event.preventDefault();
    const recipientId = document.getElementById('disbursementRecipient').value;
    const itemsContainer = document.getElementById('disbursementItemsContainer');
    const itemRows = itemsContainer.querySelectorAll('.disbursement-item-row');

    let disbursementItems = [];
    let totalItems = 0;
    const inventoryUpdates = {};

    // First pass: collect all items and quantities
    for (const row of itemRows) {
        const itemId = row.querySelector('.item-select').value;
        const quantity = parseInt(row.querySelector('.quantity-input').value, 10);

        if (!itemId || quantity <= 0) continue;

        // Combine same items
        if (disbursementItems.find(item => item.itemId === itemId)) {
            const existingItem = disbursementItems.find(item => item.itemId === itemId);
            existingItem.quantity += quantity;
        } else {
            const item = storeData.inventory.find(i => i.id === itemId);
            if (!item) return showMessageModal("Error", `Item ID ${itemId} not found.`);

            disbursementItems.push({
                itemId,
                quantity,
                itemName: item.name
            });
        }
    }

    // Second pass: check stock availability and prepare inventory updates
    for (const item of disbursementItems) {
        const inventoryItem = storeData.inventory.find(i => i.id === item.itemId);
        if (inventoryItem.quantity < item.quantity) {
            return showMessageModal("Error", `Insufficient stock for "${inventoryItem.name}". Available: ${inventoryItem.quantity}, Requested: ${item.quantity}`);
        }

        inventoryUpdates[item.itemId] = inventoryItem.quantity - item.quantity;
        totalItems += item.quantity;
    }

    if (disbursementItems.length === 0) return showMessageModal("Error", "No items specified for disbursement.");

    const newDisbursement = {
        id: generateId(),
        date: new Date().toISOString().split('T')[0],
        recipientId: recipientId,
        items: disbursementItems,
        totalItems: totalItems,
        timestamp: Date.now()
    };

    // Show confirmation dialog instead of directly saving
    hideModal('disbursementModal');
    showDisbursementConfirmation({
        recipientId,
        totalItems,
        inventoryUpdates,
        disbursement: newDisbursement
    }, 'disbursement', 'disbursementModal');
}

/**
 * Records an item return and updates inventory quantity.
 * FIXED: Now properly handles item returns
 */
async function recordReturn(event) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Permission denied.');
    event.preventDefault();
    const recipientId = document.getElementById('returnRecipient').value;
    const itemsContainer = document.getElementById('returnItemsContainer');
    const itemRows = itemsContainer.querySelectorAll('.return-item-row');

    let returnItems = [];
    let totalItems = 0;
    const inventoryUpdates = {};

    // First pass: collect all items and quantities
    for (const row of itemRows) {
        const itemId = row.querySelector('.item-select').value;
        const quantity = parseInt(row.querySelector('.quantity-input').value, 10);

        if (!itemId || quantity <= 0) continue;

        // Combine same items
        if (returnItems.find(item => item.itemId === itemId)) {
            const existingItem = returnItems.find(item => item.itemId === itemId);
            existingItem.quantity += quantity;
        } else {
            const item = storeData.inventory.find(i => i.id === itemId);
            if (!item) return showMessageModal("Error", `Item ID ${itemId} not found.`);

            returnItems.push({
                itemId,
                quantity,
                itemName: item.name
            });
        }
    }

    // Second pass: prepare inventory updates (increase stock for returns)
    for (const item of returnItems) {
        const inventoryItem = storeData.inventory.find(i => i.id === item.itemId);
        inventoryUpdates[item.itemId] = inventoryItem.quantity + item.quantity;
        totalItems += item.quantity;
    }

    if (returnItems.length === 0) return showMessageModal("Error", "No items specified for return.");

    const newReturn = {
        id: generateId(),
        date: new Date().toISOString().split('T')[0],
        recipientId: recipientId,
        items: returnItems,
        totalItems: totalItems,
        timestamp: Date.now()
    };

    // Show confirmation dialog instead of directly saving
    hideModal('returnModal');
    showDisbursementConfirmation({
        recipientId,
        totalItems,
        inventoryUpdates,
        returnRecord: newReturn
    }, 'return', 'returnModal');
}

/**
 * Records a batch disbursement for multiple recipients.
 */
async function recordBatchDisbursement(event) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Permission denied.');
    event.preventDefault();
    const recipientSelect = document.getElementById('batchRecipientList');
    const recipientIds = Array.from(recipientSelect.selectedOptions).map(opt => opt.value);

    if (recipientIds.length === 0) return showMessageModal("Error", "Please select at least one recipient.");

    const itemsContainer = document.getElementById('batchDisbursementItemsContainer');
    const itemRows = itemsContainer.querySelectorAll('.batch-disbursement-item-row');

    let itemTemplates = [];
    let inventoryUpdates = {};
    let totalItemsPerRecipient = 0;

    for (const row of itemRows) {
        const itemId = row.querySelector('.item-select').value;
        const quantity = parseInt(row.querySelector('.quantity-input').value, 10);

        if (!itemId || quantity <= 0) continue;

        const item = storeData.inventory.find(i => i.id === itemId);
        if (!item) continue;

        const totalStockNeeded = quantity * recipientIds.length;
        if (item.quantity < totalStockNeeded) {
            return showMessageModal("Error", `Insufficient stock for "${item.name}". Available: ${item.quantity}, Required for batch (${recipientIds.length} users): ${totalStockNeeded}`);
        }

        itemTemplates.push({ itemId, quantity, itemName: item.name });
        inventoryUpdates[itemId] = (inventoryUpdates[itemId] || 0) + quantity;
        totalItemsPerRecipient += quantity;
    }

    if (itemTemplates.length === 0) return showMessageModal("Error", "No items specified for batch disbursement.");

    let newDisbursements = [];
    recipientIds.forEach(recipientId => {
        newDisbursements.push({
            id: generateId(),
            date: new Date().toISOString().split('T')[0],
            recipientId: recipientId,
            items: itemTemplates.map(t => ({ itemId: t.itemId, quantity: t.quantity, itemName: t.itemName })),
            totalItems: totalItemsPerRecipient,
            timestamp: Date.now()
        });
    });

    // Show confirmation dialog instead of directly saving
    hideModal('batchDisbursementModal');
    showDisbursementConfirmation({
        recipients: recipientIds,
        totalItemsPerRecipient,
        inventoryUpdates,
        disbursements: newDisbursements
    }, 'batch', 'batchDisbursementModal');
}

/**
 * Records a resupply event to the resupplies log array.
 */
async function recordResupplyLog(itemId, quantity, tenderId, type = "Resupply") {
    const newResupply = {
        id: generateId(),
        date: new Date().toISOString().split('T')[0],
        itemId: itemId,
        quantity: quantity,
        tenderId: tenderId || null,
        type: type,
        timestamp: Date.now()
    };
    await saveStoreData({
        resupplies: [...storeData.resupplies, newResupply]
    });
}

/**
 * Adds a new employee to the employees array.
 */
async function addEmployee(event) {
    event.preventDefault();
    const form = event.target;
    const name = form.employeeName.value.trim();
    const designation = form.employeeDesignation.value;

    // Check for duplicate employee name
    const existingEmployee = storeData.employees.find(emp =>
        emp.name.toLowerCase() === name.toLowerCase()
    );

    if (existingEmployee) {
        return showMessageModal("Error", `An employee with the name "${name}" already exists.`);
    }

    const newEmployee = {
        id: generateId(),
        name,
        designation,
        lastModified: new Date().toISOString()
    };

    await saveStoreData({
        employees: [...storeData.employees, newEmployee]
    });
    await logAuditAction('EMPLOYEE_ADDED', `Added new employee: ${name} (${designation})`, { employeeId: newEmployee.id, designation });
    form.reset();
    hideAddEmployeeForm();
    showMessageModal("Success", `Employee "${name}" added.`);
}

/**
 * Helper to track deletions for incremental sync
 */
async function trackDeletion(collection, idOrIds) {
    if (!currentStoreId) return;
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    const storeRef = db.collection('stores').doc(currentStoreId);

    // We update pendingDeletions map in Firestore document
    const doc = await storeRef.get();
    const data = doc.data() || {};
    const pendingDeletions = data.pendingDeletions || {};

    if (!pendingDeletions[collection]) pendingDeletions[collection] = [];

    ids.forEach(id => {
        if (!pendingDeletions[collection].includes(id)) {
            pendingDeletions[collection].push(id);
        }
    });

    await storeRef.set({ pendingDeletions }, { merge: true });
}

/**
 * Updates an existing item in the inventory array.
 */
async function editItem(event) {
    if (currentUserRole !== 'Admin') return showMessageModal('Denied', 'Only Admin can edit items.');
    event.preventDefault();
    const form = event.target;
    const itemId = form.editItemId.value;
    const newName = form.editItemName.value.trim();
    const newSpec = form.editItemSpec.value.trim();

    const itemIndex = storeData.inventory.findIndex(i => i.id === itemId);
    if (itemIndex === -1) return showMessageModal("Error", "Item not found.");

    // Check for duplicate item name (excluding the current item)
    const existingItem = storeData.inventory.find(item =>
        item.id !== itemId && item.name.toLowerCase() === newName.toLowerCase()
    );

    if (existingItem) {
        return showMessageModal("Error", `An item with the name "${newName}" already exists.`);
    }

    const updatedItem = {
        ...storeData.inventory[itemIndex],
        name: newName,
        specification: newSpec,
        lastModified: new Date().toISOString()
    };

    const newInventory = [...storeData.inventory];
    newInventory[itemIndex] = updatedItem;

    await saveStoreData({ inventory: newInventory });
    await logEvent('ITEM_UPDATED', `Updated item: ${newName}`);
    hideModal('itemDetailsModal');
    showMessageModal("Success", `Item "${newName}" updated.`);
}

/**
 * Updates an existing employee in the employees array.
 */
async function editEmployee(event) {
    if (currentUserRole !== 'Admin') return showMessageModal('Denied', 'Only Admin can edit employees.');
    event.preventDefault();
    const form = event.target;
    const employeeId = form.editEmployeeId.value;
    const newName = form.editEmployeeName.value.trim();
    const newDesignation = form.editEmployeeDesignation.value;

    const employeeIndex = storeData.employees.findIndex(e => e.id === employeeId);
    if (employeeIndex === -1) return showMessageModal("Error", "Employee not found.");

    // Check for duplicate employee name (excluding the current employee)
    const existingEmployee = storeData.employees.find(emp =>
        emp.id !== employeeId && emp.name.toLowerCase() === newName.toLowerCase()
    );

    if (existingEmployee) {
        return showMessageModal("Error", `An employee with the name "${newName}" already exists.`);
    }

    const updatedEmployee = {
        ...storeData.employees[employeeIndex],
        name: newName,
        designation: newDesignation,
        lastModified: new Date().toISOString()
    };

    const newEmployees = [...storeData.employees];
    newEmployees[employeeIndex] = updatedEmployee;

    await saveStoreData({ employees: newEmployees });
    await logEvent('EMPLOYEE_UPDATED', `Updated employee: ${newName}`);
    hideModal('employeeDetailsModal');
    showMessageModal("Success", `Employee "${newName}" updated.`);
}

/**
 * Deletes an item from the inventory array.
 */
async function deleteItem(itemId) {
    if (currentUserRole !== 'Admin') return showMessageModal('Denied', 'Only Admin can delete items.');
    const item = storeData.inventory.find(i => i.id === itemId);
    if (!item) return;

    const newInventory = storeData.inventory.filter(i => i.id !== itemId);

    await trackDeletion('inventory', itemId);
    await saveStoreData({ inventory: newInventory });
    await logEvent('ITEM_DELETED', `Deleted item: ${item.name}`);
    showMessageModal("Success", `Item "${item.name}" permanently deleted.`);
}

/**
 * Deletes selected items from inventory.
 */
async function deleteSelectedInventoryItems() {
    const checkboxes = document.querySelectorAll('.inventory-checkbox:checked');
    const itemIdsToDelete = Array.from(checkboxes).map(cb => cb.dataset.id);

    if (itemIdsToDelete.length === 0) return showMessageModal("Error", "No items selected for deletion.");

    showConfirmationModal("Confirm Batch Deletion", `Are you sure you want to permanently delete ${itemIdsToDelete.length} selected item(s)? This action cannot be undone.`, async () => {
        const newInventory = storeData.inventory.filter(item => !itemIdsToDelete.includes(item.id));
        await trackDeletion('inventory', itemIdsToDelete);
        await saveStoreData({ inventory: newInventory });
        await logEvent('ITEMS_BATCH_DELETED', `Deleted ${itemIdsToDelete.length} items`);
        showMessageModal("Success", `${itemIdsToDelete.length} item(s) deleted.`);
    });
}

/**
 * Deletes an employee from the employees array.
 */
async function deleteEmployee(employeeId) {
    const employee = storeData.employees.find(e => e.id === employeeId);
    if (!employee) return;

    const newEmployees = storeData.employees.filter(e => e.id !== employeeId);
    await trackDeletion('employees', employeeId);
    await saveStoreData({ employees: newEmployees });
    await logEvent('EMPLOYEE_DELETED', `Deleted employee: ${employee.name}`);
    showMessageModal("Success", `Employee "${employee.name}" deleted.`);
}

/**
 * Deletes a transaction record (disbursement or return) and updates inventory accordingly
 */
async function deleteTransaction(transactionId, type) {
    let transaction;
    let transactionArray;

    if (type === 'disbursement') {
        transaction = storeData.disbursements.find(d => d.id === transactionId);
        transactionArray = 'disbursements';
    } else {
        transaction = storeData.returns.find(r => r.id === transactionId);
        transactionArray = 'returns';
    }

    if (!transaction) return;

    // Update inventory based on transaction type
    const inventoryUpdates = {};

    transaction.items.forEach(item => {
        if (type === 'disbursement') {
            // For disbursement deletion, add items back to inventory
            inventoryUpdates[item.itemId] = (inventoryUpdates[item.itemId] || 0) + item.quantity;
        } else {
            // For return deletion, remove items from inventory
            inventoryUpdates[item.itemId] = (inventoryUpdates[item.itemId] || 0) - item.quantity;
        }
    });

    const newInventory = storeData.inventory.map(item => {
        if (inventoryUpdates[item.id] !== undefined) {
            return { ...item, quantity: item.quantity + inventoryUpdates[item.id] };
        }
        return item;
    });

    let newTransactions;
    if (type === 'disbursement') {
        newTransactions = storeData.disbursements.filter(d => d.id !== transactionId);
    } else {
        newTransactions = storeData.returns.filter(r => r.id !== transactionId);
    }

    const updateData = {
        inventory: newInventory,
        [transactionArray]: newTransactions
    };

    await trackDeletion(transactionArray, transactionId);
    await saveStoreData(updateData);
    await logEvent('TRANSACTION_DELETED', `Deleted ${type} record ${transactionId.substring(0, 4)}...`);
    showMessageModal("Success", `${type === 'disbursement' ? 'Disbursement' : 'Return'} record ${transactionId.substring(0, 4)}... deleted.`);
}

/**
 * Deletes a store document via Google Apps Script.
 */
async function deleteStore(storeId) {
    try {
        if (storeId === currentStoreId) {
            // If deleting current store, switch to another one first
            const otherStores = Object.keys(allStores).filter(id => id !== storeId);
            if (otherStores.length > 0) {
                switchStore(otherStores[0]);
            } else {
                // No other stores, create a default one
                await createDefaultStore();
            }
        }

        await apiPost('deleteStore', { storeId: storeId });
        delete allStores[storeId];

        await logAuditAction('STORE_DELETED', `Deleted store: ${storeId}`);
        showMessageModal("Success", `Store ${storeId} deleted.`);

        await populateStoreSelector();
    } catch (error) {
        showMessageModal("Error", `Failed to delete store: ${error.message}`);
        console.error("Error deleting store:", error);
    }
}

/**
 * Prunes old data (disbursements, returns and resupplies) before a cutoff date.
 */
async function pruneData(event) {
    event.preventDefault();
    const cutoffDate = new Date(document.getElementById('pruneCutoffDate').value).getTime();

    const newDisbursements = (storeData.disbursements || []).filter(d => d.timestamp >= cutoffDate);
    const newReturns = (storeData.returns || []).filter(r => r.timestamp >= cutoffDate);
    const newResupplies = (storeData.resupplies || []).filter(r => r.timestamp >= cutoffDate);

    const deletedDisbursements = (storeData.disbursements || []).length - newDisbursements.length;
    const deletedReturns = (storeData.returns || []).length - newReturns.length;
    const deletedResupplies = (storeData.resupplies || []).length - newResupplies.length;

    if (deletedDisbursements + deletedReturns + deletedResupplies === 0) {
        hideModal('pruneDataModal');
        return showMessageModal("Info", "No data found to prune before the cutoff date.");
    }

    await saveStoreData({
        disbursements: newDisbursements,
        returns: newReturns,
        resupplies: newResupplies
    });

    await logEvent('DATA_PRUNED', `Pruned ${deletedDisbursements} disbursements, ${deletedReturns} returns and ${deletedResupplies} resupplies before ${formatDate(cutoffDate)}`);

    hideModal('pruneDataModal');
    showMessageModal("Success", `Pruning complete. Deleted ${deletedDisbursements} disbursement(s), ${deletedReturns} return(s) and ${deletedResupplies} resupply log(s).`);
}

/**
 * Clones an existing transaction for easy re-issuing
 */
async function cloneTransaction(transactionId, type) {
    let transaction;
    if (type === 'disbursement') {
        transaction = storeData.disbursements.find(d => d.id === transactionId);
    } else {
        transaction = storeData.returns.find(r => r.id === transactionId);
    }

    if (!transaction) return showMessageModal("Error", "Transaction not found.");

    if (type === 'disbursement') {
        // Pre-fill the disbursement form with the cloned data
        document.getElementById('disbursementRecipient').value = transaction.recipientId;

        // Clear existing items
        const itemsContainer = document.getElementById('disbursementItemsContainer');
        itemsContainer.innerHTML = '';

        // Add items from the cloned disbursement
        transaction.items.forEach(item => {
            addDisbursementItemRow();
            const lastRow = itemsContainer.lastElementChild;
            lastRow.querySelector('.item-select').value = item.itemId;
            lastRow.querySelector('.quantity-input').value = item.quantity;
        });

        hideModal('itemDetailsModal');
        document.getElementById('disbursementModal').classList.remove('hidden');
    } else {
        // Pre-fill the return form with the cloned data
        document.getElementById('returnRecipient').value = transaction.recipientId;

        // Clear existing items
        const itemsContainer = document.getElementById('returnItemsContainer');
        itemsContainer.innerHTML = '';

        // Add items from the cloned return
        transaction.items.forEach(item => {
            addReturnItemRow();
            const lastRow = itemsContainer.lastElementChild;
            lastRow.querySelector('.item-select').value = item.itemId;
            lastRow.querySelector('.quantity-input').value = item.quantity;
        });

        hideModal('itemDetailsModal');
        document.getElementById('returnModal').classList.remove('hidden');
    }
}

/**
 * Filters batch recipients by designation
 */
function filterBatchRecipientsByDesignation() {
    const designationFilter = document.getElementById('batchDesignationFilter').value;
    const recipientSelect = document.getElementById('batchRecipientList');

    // Clear current selection
    recipientSelect.innerHTML = '';

    // Filter employees by designation
    const filteredEmployees = storeData.employees.filter(emp =>
        !designationFilter || emp.designation === designationFilter
    );

    // Populate the select with filtered employees
    filteredEmployees.forEach(emp => {
        const option = document.createElement('option');
        option.value = emp.id;
        option.textContent = `${emp.name} (${emp.designation})`;
        recipientSelect.appendChild(option);
    });
}

// =========================================================================
// 7. CSV IMPORT FUNCTIONALITY
// =========================================================================

/**
 * Shows the CSV import modal
 */
function showCSVImportModal() {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') {
        return showMessageModal('Denied', 'Only Admin and Managers can import employees.');
    }

    document.getElementById('csvImportForm').reset();
    document.getElementById('csvPreview').classList.add('hidden');
    document.getElementById('csvValidationErrors').textContent = '';
    document.getElementById('csvImportModal').classList.remove('hidden');

    // Set up file input event listener
    document.getElementById('csvFileInput').addEventListener('change', handleCSVFileSelect);
}

/**
 * Handles CSV file selection and preview
 */
function handleCSVFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const csvText = e.target.result;
        parseCSVPreview(csvText);
    };
    reader.readAsText(file);
}

/**
 * Parses CSV text and shows preview
 */
function parseCSVPreview(csvText) {
    const hasHeader = document.getElementById('csvHasHeader').checked;
    const rows = csvText.split('\n').filter(row => row.trim() !== '');

    if (rows.length === 0) {
        document.getElementById('csvPreview').classList.add('hidden');
        return;
    }

    // Parse CSV rows
    const parsedRows = rows.map(row => {
        // Simple CSV parsing - handles quoted fields with commas
        const fields = [];
        let currentField = '';
        let inQuotes = false;

        for (let i = 0; i < row.length; i++) {
            const char = row[i];

            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                fields.push(currentField.trim());
                currentField = '';
            } else {
                currentField += char;
            }
        }

        fields.push(currentField.trim());
        return fields;
    });

    // Determine if we have a header row
    let startIndex = 0;
    let headers = ['Name', 'Designation'];

    if (hasHeader && parsedRows.length > 0) {
        headers = parsedRows[0];
        startIndex = 1;
    }

    // Show preview (max 5 rows)
    const previewRows = parsedRows.slice(startIndex, startIndex + 5);
    showCSVPreviewTable(headers, previewRows);

    // Validate CSV data
    validateCSVData(parsedRows, hasHeader);
}

/**
 * Shows CSV preview table
 */
function showCSVPreviewTable(headers, rows) {
    const table = document.getElementById('csvPreviewTable');
    table.innerHTML = '';

    // Create header row
    const headerRow = document.createElement('tr');
    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    // Create data rows
    rows.forEach(row => {
        const tr = document.createElement('tr');
        row.forEach(cell => {
            const td = document.createElement('td');
            td.textContent = cell;
            tr.appendChild(td);
        });
        table.appendChild(tr);
    });

    document.getElementById('csvPreview').classList.remove('hidden');
}

/**
 * Validates CSV data
 */
function validateCSVData(parsedRows, hasHeader) {
    const startIndex = hasHeader ? 1 : 0;
    const validationErrors = [];

    for (let i = startIndex; i < parsedRows.length; i++) {
        const row = parsedRows[i];

        // Check if row has at least one column
        if (row.length < 1) {
            validationErrors.push(`Row ${i + 1}: Missing employee name`);
            continue;
        }

        const name = row[0].trim();
        const designation = row.length > 1 ? row[1].trim() : '';

        // Validate name
        if (!name) {
            validationErrors.push(`Row ${i + 1}: Employee name is required`);
        }

        // Validate designation (if provided)
        if (designation) {
            const validDesignations = [
                'Chief Architect', 'Additional Chief Architect', 'Superintending Architect',
                'Executive Architect', 'Senior Assistant Architect', 'Assistant Architect',
                'Admin. Officer', 'Sub-Assistant Architect', 'Staff-Technical',
                'Staff-Non-technical', 'Driver', 'Superintending Engineer', 'Executive Engineer',
                'Sub Divisional Engineer', 'Assistant Engineer', 'Sub Assistant Engineer'
            ];

            if (!validDesignations.includes(designation)) {
                validationErrors.push(`Row ${i + 1}: Invalid designation "${designation}"`);
            }
        }
    }

    const errorsContainer = document.getElementById('csvValidationErrors');
    if (validationErrors.length > 0) {
        errorsContainer.innerHTML = '<strong>Validation Errors:</strong><br>' +
            validationErrors.map(err => `• ${err}`).join('<br>');
    } else {
        errorsContainer.textContent = 'CSV data is valid. Ready to import.';
        errorsContainer.className = 'mt-2 text-sm text-green-600';
    }
}

/**
 * Handles CSV import form submission
 */
async function importEmployeesFromCSV(event) {
    event.preventDefault();

    const fileInput = document.getElementById('csvFileInput');
    const hasHeader = document.getElementById('csvHasHeader').checked;

    if (!fileInput.files.length) {
        return showMessageModal("Error", "Please select a CSV file.");
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async function (e) {
        const csvText = e.target.result;
        const rows = csvText.split('\n').filter(row => row.trim() !== '');

        if (rows.length === 0) {
            return showMessageModal("Error", "CSV file is empty.");
        }

        // Parse CSV rows
        const parsedRows = rows.map(row => {
            const fields = [];
            let currentField = '';
            let inQuotes = false;

            for (let i = 0; i < row.length; i++) {
                const char = row[i];

                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    fields.push(currentField.trim());
                    currentField = '';
                } else {
                    currentField += char;
                }
            }

            fields.push(currentField.trim());
            return fields;
        });

        const startIndex = hasHeader ? 1 : 0;
        const newEmployees = [];

        for (let i = startIndex; i < parsedRows.length; i++) {
            const row = parsedRows[i];

            // Skip empty rows
            if (row.length < 1 || !row[0].trim()) continue;

            const name = row[0].trim();
            const designation = row.length > 1 ? row[1].trim() : '';

            // Skip if employee with same name already exists
            const existingEmployee = storeData.employees.find(emp =>
                emp.name.toLowerCase() === name.toLowerCase()
            );

            if (existingEmployee) {
                console.log(`Skipping duplicate employee: ${name}`);
                continue;
            }

            newEmployees.push({
                id: generateId(),
                name,
                designation: designation || 'Staff-Non-technical' // Default designation
            });
        }

        if (newEmployees.length === 0) {
            hideModal('csvImportModal');
            return showMessageModal("Info", "No new employees to import (all employees already exist or CSV is empty).");
        }

        // Add new employees to store
        await saveStoreData({
            employees: [...storeData.employees, ...newEmployees]
        });

        await logEvent('EMPLOYEES_IMPORTED', `Imported ${newEmployees.length} employees from CSV`);

        hideModal('csvImportModal');
        showMessageModal("Success", `Successfully imported ${newEmployees.length} employees.`);
    };

    reader.readAsText(file);
}

// =========================================================================
// 8. TAB/MODAL CONTROL AND MISC UI
// =========================================================================

/**
 * Switches the main content tab.
 */
function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(tabId).classList.remove('hidden');

    document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`.sidebar-item[data-tab="${tabId}"]`).classList.add('active');

    // Force inventory pagination to reset on tab switch
    if (tabId === 'inventory') {
        inventoryPage = 1;
        renderInventory();
    }
    if (tabId === 'disbursements') {
        disbursementPage = 1;
        renderDisbursements();
    }
}

/**
 * Toggles the batch delete button visibility.
 */
function updateBatchDeleteButton() {
    const checkedCount = document.querySelectorAll('.inventory-checkbox:checked').length;
    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    if (!batchDeleteBtn) return;
    if (checkedCount > 0 && (currentUserRole === 'Admin' || currentUserRole === 'Manager')) {
        batchDeleteBtn.textContent = `Delete Selected (${checkedCount})`;
        batchDeleteBtn.classList.remove('hidden');
    } else {
        batchDeleteBtn.classList.add('hidden');
    }
}

// Pagination logic
function changeInventoryPage(delta) {
    const totalPages = Math.ceil(storeData.inventory.length / inventoryPerPage);
    const newPage = inventoryPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        inventoryPage = newPage;
        renderInventory();
    }
}

function changeDisbursementPage(delta) {
    const totalPages = Math.ceil(([...storeData.disbursements, ...storeData.returns].length) / disbursementPerPage);
    const newPage = disbursementPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        disbursementPage = newPage;
        renderDisbursements();
    }
}

// Show modals functions
function showDisbursementForm() {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Only Admin and Managers can record disbursements.');
    if ((storeData.employees || []).length === 0) return showMessageModal('Error', 'Please add employees before recording a disbursement.');
    document.getElementById('disbursementForm').reset();
    document.getElementById('disbursementItemsContainer').innerHTML = '';
    addDisbursementItemRow();
    document.getElementById('disbursementModal').classList.remove('hidden');
}

function showReturnForm() {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Only Admin and Managers can record returns.');
    if ((storeData.employees || []).length === 0) return showMessageModal('Error', 'Please add employees before recording a return.');
    document.getElementById('returnForm').reset();
    document.getElementById('returnItemsContainer').innerHTML = '';
    addReturnItemRow();
    document.getElementById('returnModal').classList.remove('hidden');
}

function showBatchDisbursementForm() {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Only Admin and Managers can record batch disbursements.');
    if ((storeData.employees || []).length < 2) return showMessageModal('Error', 'Requires at least two employees for batch disbursement.');
    document.getElementById('batchDisbursementForm').reset();
    document.getElementById('batchDisbursementItemsContainer').innerHTML = '';
    addBatchDisbursementItemRow();
    document.getElementById('batchDisbursementModal').classList.remove('hidden');
}

function showSupplyForm() {
    if (currentUserRole !== 'Admin') return showMessageModal('Denied', 'Only Admin can add items.');
    showTab('inventory');
    document.getElementById('addItemCard').classList.remove('hidden');
    document.getElementById('resupplyCard').classList.add('hidden');
}

function hideSupplyForm() {
    document.getElementById('addItemCard').classList.add('hidden');
}

function showResupplyForm() {
    if (currentUserRole !== 'Admin') return showMessageModal('Denied', 'Only Admin can record resupplies.');
    if ((storeData.inventory || []).length === 0) return showMessageModal('Error', 'Please add items to inventory before recording a resupply.');
    showTab('inventory');
    document.getElementById('resupplyCard').classList.remove('hidden');
    document.getElementById('addItemCard').classList.add('hidden');
    document.getElementById('resupplyForm').reset();
}

function hideResupplyForm() {
    document.getElementById('resupplyCard').classList.add('hidden');
}

function showAddEmployeeForm() {
    if (currentUserRole !== 'Admin') return showMessageModal('Denied', 'Only Admin can add employees.');
    showTab('employees');
    document.getElementById('addEmployeeCard').classList.remove('hidden');
}

function hideAddEmployeeForm() {
    document.getElementById('addEmployeeCard').classList.add('hidden');
}

function showPruneDataModal() {
    if (currentUserRole !== 'Admin') return showMessageModal('Denied', 'Only Admin can prune data.');
    showAdminReauthModal(() => {
        document.getElementById('pruneDataForm').reset();
        document.getElementById('pruneCutoffDate').valueAsDate = new Date();
        document.getElementById('pruneDataModal').classList.remove('hidden');
    });
}

function showItemDetailsModal(itemId) {
    const item = storeData.inventory.find(i => i.id === itemId);
    if (!item) return showMessageModal("Error", "Item not found.");

    document.getElementById('editItemId').value = item.id;
    document.getElementById('detailItemId').textContent = item.id;
    document.getElementById('editItemName').value = item.name;
    document.getElementById('editItemSpec').value = item.specification;
    document.getElementById('editItemQuantity').value = item.quantity;

    document.getElementById('itemDetailsModal').classList.remove('hidden');
}

function showEmployeeDetailsModal(employeeId) {
    const employee = storeData.employees.find(e => e.id === employeeId);
    if (!employee) return showMessageModal("Error", "Employee not found.");

    document.getElementById('editEmployeeId').value = employee.id;
    document.getElementById('detailEmployeeId').textContent = employee.id;
    document.getElementById('editEmployeeName').value = employee.name;
    document.getElementById('editEmployeeDesignation').value = employee.designation;

    document.getElementById('employeeDetailsModal').classList.remove('hidden');
}

// =========================================================================
// 9. DYNAMIC FORM ROW MANAGEMENT
// =========================================================================

function getInventoryOptions(excludeId = null) {
    return (storeData.inventory || [])
        .map(item => `<option value="${item.id}" ${item.id === excludeId ? 'disabled' : ''}>${item.name} (Stock: ${item.quantity})</option>`)
        .join('');
}

function addDisbursementItemRow() {
    const container = document.getElementById('disbursementItemsContainer');
    const row = document.createElement('div');
    row.className = 'flex space-x-3 disbursement-item-row';
    row.innerHTML = `
        <div class="searchable-select flex-1 min-w-[200px]">
            <input type="text" placeholder="Search items..." class="form-input">
            <div class="dropdown-arrow"><i class="fas fa-chevron-down"></i></div>
            <div class="dropdown-options">
                <!-- Options will be populated dynamically -->
            </div>
            <select class="item-select form-input hidden" required>
                <option value="">Select Item</option>
                ${getInventoryOptions()}
            </select>
        </div>
        <input type="number" class="quantity-input w-24 form-input" placeholder="Qty" min="1" required>
        <button type="button" onclick="this.parentNode.remove()" class="compact-button btn-danger">
            <i class="fas fa-times"></i>
        </button>
    `;
    container.appendChild(row);
    initializeSearchableDropdowns();
}

function addReturnItemRow() {
    const container = document.getElementById('returnItemsContainer');
    const row = document.createElement('div');
    row.className = 'flex space-x-3 return-item-row';
    row.innerHTML = `
        <div class="searchable-select flex-1 min-w-[200px]">
            <input type="text" placeholder="Search items..." class="form-input">
            <div class="dropdown-arrow"><i class="fas fa-chevron-down"></i></div>
            <div class="dropdown-options">
                <!-- Options will be populated dynamically -->
            </div>
            <select class="item-select form-input hidden" required>
                <option value="">Select Item</option>
                ${getInventoryOptions()}
            </select>
        </div>
        <input type="number" class="quantity-input w-24 form-input" placeholder="Qty" min="1" required>
        <button type="button" onclick="this.parentNode.remove()" class="compact-button btn-danger">
            <i class="fas fa-times"></i>
        </button>
    `;
    container.appendChild(row);
    initializeSearchableDropdowns();
}

function addBatchDisbursementItemRow() {
    const container = document.getElementById('batchDisbursementItemsContainer');
    const row = document.createElement('div');
    row.className = 'flex space-x-3 batch-disbursement-item-row';
    row.innerHTML = `
        <div class="searchable-select flex-1">
            <input type="text" placeholder="Search items..." class="form-input">
            <div class="dropdown-arrow"><i class="fas fa-chevron-down"></i></div>
            <div class="dropdown-options">
                <!-- Options will be populated dynamically -->
            </div>
            <select class="item-select form-input hidden" required>
                <option value="">Select Item</option>
                ${getInventoryOptions()}
            </select>
        </div>
        <input type="number" class="quantity-input w-32 form-input" placeholder="Qty per person" min="1" required>
        <button type="button" onclick="this.parentNode.remove()" class="compact-button btn-danger">
            <i class="fas fa-times"></i>
        </button>
    `;
    container.appendChild(row);
    initializeSearchableDropdowns();
}

// Populate selectors
function populateEmployeeSelectors() {
    const options = (storeData.employees || []).map(e => `<option value="${e.id}">${e.name} (${e.designation})</option>`).join('');

    const recipients = document.getElementById('disbursementRecipient');
    if (recipients) recipients.innerHTML = '<option value="">Select Employee/Recipient</option>' + options;

    const returnRecipients = document.getElementById('returnRecipient');
    if (returnRecipients) returnRecipients.innerHTML = '<option value="">Select Employee/Recipient</option>' + options;

    const batchRecipients = document.getElementById('batchRecipientList');
    if (batchRecipients) batchRecipients.innerHTML = options;

    const reportEmployeeSelect = document.getElementById('reportEmployeeSelect');
    if (reportEmployeeSelect) reportEmployeeSelect.innerHTML = '<option value="">All Employees</option>' + options;

    // Initialize searchable dropdowns after populating
    initializeSearchableDropdowns();
}

function populateResupplyItemSelect() {
    const options = (storeData.inventory || []).map(i => `<option value="${i.id}">${i.name} (Stock: ${i.quantity})</option>`).join('');
    const select = document.getElementById('resupplyItemSelect');
    if (select) select.innerHTML = '<option value="">Select Item</option>' + options;

    // Initialize searchable dropdowns after populating
    initializeSearchableDropdowns();
}

function populateReportSelectors() {
    const itemOptions = (storeData.inventory || []).map(i => `<option value="${i.id}">${i.name}</option>`).join('');
    const itemSelect = document.getElementById('reportItemSelect');
    if (itemSelect) itemSelect.innerHTML = '<option value="">Select Item</option>' + itemOptions;

    // Initialize searchable dropdowns after populating
    initializeSearchableDropdowns();
}

// =========================================================================
// 10. SEARCHABLE DROPDOWN FUNCTIONALITY - ENHANCED
// =========================================================================

/**
 * Initialize all searchable dropdowns with improved functionality
 */
function initializeSearchableDropdowns() {
    document.querySelectorAll('.searchable-select').forEach(container => {
        const input = container.querySelector('input');
        const select = container.querySelector('select');
        const optionsContainer = container.querySelector('.dropdown-options');

        if (!input || !select || !optionsContainer) return;

        // Populate options from select
        function populateOptions() {
            optionsContainer.innerHTML = '';
            Array.from(select.options).forEach(option => {
                if (option.value === '') return; // Skip placeholder
                const div = document.createElement('div');
                div.className = 'dropdown-option';
                div.textContent = option.textContent;
                div.dataset.value = option.value;
                if (option.value === select.value) {
                    div.classList.add('selected');
                    input.value = option.textContent;
                }
                optionsContainer.appendChild(div);
            });
        }

        populateOptions();

        // Show/hide dropdown on input focus
        input.addEventListener('focus', () => {
            container.classList.add('active');
        });

        // Hide dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) {
                container.classList.remove('active');
            }
        });

        // Filter options on input
        input.addEventListener('input', () => {
            const filter = input.value.toLowerCase();
            Array.from(optionsContainer.children).forEach(option => {
                const text = option.textContent.toLowerCase();
                option.style.display = text.includes(filter) ? 'block' : 'none';
            });
        });

        // Select option on click
        optionsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('dropdown-option')) {
                const value = e.target.dataset.value;
                const text = e.target.textContent;
                select.value = value;
                input.value = text;
                container.classList.remove('active');
                populateOptions(); // to update the selected style
                // Trigger change event on the select in case other code is listening
                select.dispatchEvent(new Event('change'));
            }
        });

        // Also, when the select is programmatically changed, update the input and options
        const observer = new MutationObserver(populateOptions);
        observer.observe(select, { childList: true, subtree: true });

        // Handle keyboard navigation
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const options = Array.from(optionsContainer.querySelectorAll('.dropdown-option:not([style*="display: none"])'));
                if (options.length === 0) return;

                let currentIndex = options.findIndex(opt => opt.classList.contains('selected'));

                if (e.key === 'ArrowDown') {
                    currentIndex = (currentIndex + 1) % options.length;
                } else if (e.key === 'ArrowUp') {
                    currentIndex = (currentIndex - 1 + options.length) % options.length;
                }

                // Remove selected class from all options
                options.forEach(opt => opt.classList.remove('selected'));

                // Add selected class to current option
                options[currentIndex].classList.add('selected');

                // Scroll into view
                options[currentIndex].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const selectedOption = optionsContainer.querySelector('.dropdown-option.selected');
                if (selectedOption) {
                    selectedOption.click();
                }
            }
        });
    });
}

// =========================================================================
// 11. REPORTING & PRINTING (Data Generation Logic)
// =========================================================================

/**
 * Enhanced print function that properly includes styles
 */
function printReportContent(elementId) {
    const printContent = document.getElementById(elementId).innerHTML;
    const originalTitle = document.title;

    // Create a new window for printing
    const printWindow = window.open('', '_blank', 'width=800,height=600');

    // Write the print content with proper styles
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${originalTitle} - Print</title>
            <link href="https://cdn.jsdelivr.net/npm/tailwindcss@^2/dist/tailwind.min.css" rel="stylesheet">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    margin: 0;
                    padding: 20px;
                    color: #000;
                    background: white;
                }
                .print-preview-content {
                    width: 100%;
                    max-width: 100%;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 15px 0;
                }
                th, td {
                    border: 1px solid #000;
                    padding: 8px;
                    text-align: left;
                }
                th {
                    background-color: #f0f0f0 !important;
                    font-weight: bold;
                }
                .signature-section {
                    margin-top: 40px;
                    display: flex;
                    justify-content: space-between;
                }
                .signature-box {
                    text-align: center;
                    width: 30%;
                }
                .signature-line {
                    border-top: 1px solid #000;
                    margin-top: 60px;
                    padding-top: 5px;
                }
                .footer {
                    margin-top: 40px;
                    padding-top: 20px;
                    border-top: 1px dashed #000;
                    text-align: center;
                    font-size: 10pt;
                }
                @media print {
                    body { margin: 0; }
                    .no-print { display: none !important; }
                }
            </style>
        </head>
        <body>
            ${printContent}
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() {
                        window.close();
                    }, 500);
                };
            </script>
        </body>
        </html>
    `);

    printWindow.document.close();
}

/**
 * Generates the HTML content for a transaction slip (disbursement or return)
 */
function viewTransactionSlip(transactionId, type) {
    let transaction, slipTitle;

    if (type === 'disbursement') {
        transaction = storeData.disbursements.find(d => d.id === transactionId);
        slipTitle = 'Disbursement Slip';
    } else {
        transaction = storeData.returns.find(r => r.id === transactionId);
        slipTitle = 'Return Slip';
    }

    if (!transaction) return showMessageModal("Error", "Transaction record not found.");

    const recipient = storeData.employees.find(e => e.id === transaction.recipientId);
    const recipientName = recipient ? recipient.name : 'Unknown Recipient';
    const recipientDesignation = recipient ? recipient.designation : 'N/A';

    // Combine same items in the transaction slip
    const combinedItems = [];
    transaction.items.forEach(item => {
        const existingItem = combinedItems.find(i => i.itemId === item.itemId);
        if (existingItem) {
            existingItem.quantity += item.quantity;
        } else {
            combinedItems.push({ ...item });
        }
    });

    let itemsTable = '';
    combinedItems.forEach((item, index) => {
        const inventoryItem = storeData.inventory.find(i => i.id === item.itemId);
        const itemName = inventoryItem ? inventoryItem.name : item.itemName;
        itemsTable += `
            <tr>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${index + 1}</td>
                <td style="border: 1px solid #000; padding: 8px;">${itemName}</td>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${item.quantity}</td>
            </tr>
        `;
    });

    const totalUnits = combinedItems.reduce((sum, item) => sum + item.quantity, 0);
    const currentDate = new Date();
    const formattedDate = `${String(currentDate.getDate()).padStart(2, '0')}/${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
    const formattedTime = `${String(currentDate.getHours()).padStart(2, '0')}:${String(currentDate.getMinutes()).padStart(2, '0')}:${String(currentDate.getSeconds()).padStart(2, '0')}`;

    const recipientLabel = type === 'return' ? 'Returned By' : 'Recipient Name';
    const signatureLabel = type === 'return' ? 'Returned By' : 'Recipient';

    const contentHTML = `
        <div class="print-preview-content" style="font-family: Arial, sans-serif; line-height: 1.4;">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="font-size: 20pt; margin: 0 0 5px 0; font-weight: bold;">Department of Architecture</h1>
                <h2 style="font-size: 14pt; margin: 0 0 15px 0; font-weight: normal;">Sthapatya Bhaban<br>Segunbagicha, Dhaka-1000</h2>
                <h3 style="font-size: 16pt; margin: 0; text-decoration: underline; font-weight: bold;">${slipTitle}</h3>
            </div>

            <!-- Recipient Information Table -->
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #000;">
                <tr>
                    <td style="border: 1px solid #000; padding: 8px; width: 25%; font-weight: bold;">${recipientLabel}:</td>
                    <td style="border: 1px solid #000; padding: 8px; width: 25%;">${recipientName}</td>
                    <td style="border: 1px solid #000; padding: 8px; width: 25%; font-weight: bold;">Record ID:</td>
                    <td style="border: 1px solid #000; padding: 8px; width: 25%;">${transaction.id.substring(0, 8)}</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Designation:</td>
                    <td style="border: 1px solid #000; padding: 8px;">${recipientDesignation}</td>
                    <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Date:</td>
                    <td style="border: 1px solid #000; padding: 8px;">${formatDate(transaction.date)}</td>
                </tr>
            </table>

            <!-- Items Table -->
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; border: 1px solid #000;">
                <thead>
                    <tr>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">SL</th>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">${type === 'return' ? 'Returned Item' : 'Issued Item'}</th>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Number of unit</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsTable}
                    <tr>
                        <td colspan="2" style="border: 1px solid #000; padding: 10px; text-align: right; font-weight: bold;">Total Unit:</td>
                        <td style="border: 1px solid #000; padding: 10px; text-align: center; font-weight: bold;">${totalUnits}</td>
                    </tr>
                </tbody>
            </table>

            <!-- Signature Section -->
            <div class="signature-section">
                <div class="signature-box">
                    <div class="signature-line">Signature of the ${signatureLabel}</div>
                </div>
                <div class="signature-box">
                    <div class="signature-line">Signature of the Store In Charge</div>
                </div>
                <div class="signature-box">
                    <div class="signature-line">Signature and seal of Officer In Charge</div>
                </div>
            </div>

            <!-- Footer -->
            <div class="footer">
                <p>Generated by Store Management system of Department of Architecture, Segunbagicha, Dhaka-1000</p>
                <p>Generated on: ${formattedDate} at ${formattedTime}</p>
            </div>
        </div>
    `;

    document.getElementById('viewReportTitle').textContent = `${slipTitle}: ${transaction.id.substring(0, 8)}`;
    document.getElementById('viewReportContent').innerHTML = contentHTML;
    document.getElementById('viewReportModal').classList.remove('hidden');
}

/**
 * Generates the HTML content for a supply/resupply slip.
 */
function viewSupplySlip(itemId) {
    const item = storeData.inventory.find(i => i.id === itemId);
    if (!item) return showMessageModal("Error", "Item not found.");

    const resupplies = storeData.resupplies.filter(r => r.itemId === itemId)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5); // Show last 5 resupplies

    let resupplyTable = '';
    if (resupplies.length > 0) {
        resupplyTable = `
            <h4 style="font-size: 14pt; margin-top: 20px;">Recent Resupplies</h4>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #000;">
                <thead>
                    <tr>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Date</th>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Quantity</th>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Tender ID</th>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Type</th>
                    </tr>
                </thead>
                <tbody>
                    ${resupplies.map(r => `
                        <tr>
                            <td style="border: 1px solid #000; padding: 8px;">${formatDate(r.date)}</td>
                            <td style="border: 1px solid #000; padding: 8px; text-align: center;">${r.quantity}</td>
                            <td style="border: 1px solid #000; padding: 8px;">${r.tenderId || 'N/A'}</td>
                            <td style="border: 1px solid #000; padding: 8px;">${r.type}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    const currentDate = new Date();
    const formattedDate = `${String(currentDate.getDate()).padStart(2, '0')}/${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
    const formattedTime = `${String(currentDate.getHours()).padStart(2, '0')}:${String(currentDate.getMinutes()).padStart(2, '0')}:${String(currentDate.getSeconds()).padStart(2, '0')}`;

    const contentHTML = `
        <div class="print-preview-content" style="font-family: Arial, sans-serif; line-height: 1.4;">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="font-size: 20pt; margin: 0 0 5px 0; font-weight: bold;">Department of Architecture</h1>
                <h2 style="font-size: 14pt; margin: 0 0 15px 0; font-weight: normal;">Sthapatya Bhaban<br>Segunbagicha, Dhaka-1000</h2>
                <h3 style="font-size: 16pt; margin: 0; text-decoration: underline; font-weight: bold;">Supply/Resupply Slip</h3>
            </div>

            <!-- Item Information Table -->
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #000;">
                <tr>
                    <td style="border: 1px solid #000; padding: 8px; width: 25%; font-weight: bold;">Item Name:</td>
                    <td style="border: 1px solid #000; padding: 8px; width: 25%;">${item.name}</td>
                    <td style="border: 1px solid #000; padding: 8px; width: 25%; font-weight: bold;">Current Stock:</td>
                    <td style="border: 1px solid #000; padding: 8px; width: 25%;">${item.quantity}</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Specification:</td>
                    <td style="border: 1px solid #000; padding: 8px;">${item.specification || 'N/A'}</td>
                    <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Last Resupply:</td>
                    <td style="border: 1px solid #000; padding: 8px;">${formatDate(item.lastResupplyDate)}</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Latest Tender ID:</td>
                    <td style="border: 1px solid #000; padding: 8px;" colspan="3">${item.latestTenderId || 'N/A'}</td>
                </tr>
            </table>

            ${resupplyTable}

            <!-- Footer -->
            <div class="footer">
                <p>This slip shows the current status and recent resupply history for the item.</p>
                <p>Generated by Store Management system of Department of Architecture, Segunbagicha, Dhaka-1000</p>
                <p>Generated on: ${formattedDate} at ${formattedTime}</p>
            </div>
        </div>
    `;

    document.getElementById('viewReportTitle').textContent = `Supply/Resupply Slip: ${item.name}`;
    document.getElementById('viewReportContent').innerHTML = contentHTML;
    document.getElementById('viewReportModal').classList.remove('hidden');
}

/**
 * Shows the generate report modal for items
 */
async function generateItemReport() {
    document.getElementById('generateReportTitle').textContent = 'Generate Item Report';
    document.getElementById('reportItemSelectContainer').classList.remove('hidden');
    document.getElementById('reportEmployeeSelectContainer').classList.add('hidden');

    // Set default dates (last 30 days)
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    document.getElementById('reportFromDate').value = thirtyDaysAgo.toISOString().split('T')[0];
    document.getElementById('reportToDate').value = today.toISOString().split('T')[0];

    document.getElementById('generateReportModal').classList.remove('hidden');

    // Set up form submission
    document.getElementById('generateReportForm').onsubmit = async function (e) {
        e.preventDefault();
        await storeDataLoadedPromise; // Ensure storeData is loaded
        generateItemReportData();
    };
}

/**
 * Shows the generate report modal for employees
 */
async function generateEmployeeReport() {
    document.getElementById('generateReportTitle').textContent = 'Generate Employee Report';
    document.getElementById('reportEmployeeSelectContainer').classList.remove('hidden');
    document.getElementById('reportItemSelectContainer').classList.add('hidden');

    // Set default dates (last 30 days)
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    document.getElementById('reportFromDate').value = thirtyDaysAgo.toISOString().split('T')[0];
    document.getElementById('reportToDate').value = today.toISOString().split('T')[0];

    document.getElementById('generateReportModal').classList.remove('hidden');

    // Set up form submission
    document.getElementById('generateReportForm').onsubmit = async function (e) {
        e.preventDefault();
        await storeDataLoadedPromise; // Ensure storeData is loaded
        generateEmployeeReportData();
    };
}

/**
 * Generates the Item Transaction History Report (Item Report).
 * Maintains serial with entry date and time and keeps latest entry at the bottom.
 */
function generateItemReportData() {
    const itemId = document.getElementById('reportItemSelect').value;
    const fromDate = new Date(document.getElementById('reportFromDate').value).getTime();
    const toDate = new Date(document.getElementById('reportToDate').value).getTime() + 86400000;

    if (!itemId) return showMessageModal("Error", "Please select a specific item for the report.");

    const item = storeData.inventory.find(i => i.id === itemId);
    if (!item) return showMessageModal("Error", "Selected item not found.");

    const allTransactions = [];

    // Add disbursements
    storeData.disbursements.forEach(d => {
        const itemEntry = d.items.find(i => i.itemId === itemId);
        if (itemEntry && new Date(d.date).getTime() >= fromDate && new Date(d.date).getTime() <= toDate) {
            const recipient = storeData.employees.find(e => e.id === d.recipientId);
            allTransactions.push({
                date: d.date,
                timestamp: d.timestamp,
                type: 'DISBURSEMENT',
                quantity: -itemEntry.quantity,
                recipient: recipient ? recipient.name : 'Unknown',
                logId: d.id
            });
        }
    });

    // Add returns
    storeData.returns.forEach(r => {
        const itemEntry = r.items.find(i => i.itemId === itemId);
        if (itemEntry && new Date(r.date).getTime() >= fromDate && new Date(r.date).getTime() <= toDate) {
            const recipient = storeData.employees.find(e => e.id === r.recipientId);
            allTransactions.push({
                date: r.date,
                timestamp: r.timestamp,
                type: 'RETURN',
                quantity: itemEntry.quantity,
                recipient: recipient ? recipient.name : 'Unknown',
                logId: r.id
            });
        }
    });

    // Add resupplies
    storeData.resupplies.forEach(r => {
        if (r.itemId === itemId && new Date(r.date).getTime() >= fromDate && new Date(r.date).getTime() <= toDate) {
            allTransactions.push({
                date: r.date,
                timestamp: r.timestamp,
                type: (r.type || 'RESUPPLY').toUpperCase(),
                quantity: r.quantity,
                tenderId: r.tenderId || 'N/A',
                logId: r.id
            });
        }
    });

    // Sort by timestamp in ascending order (oldest first, newest at bottom)
    allTransactions.sort((a, b) => a.timestamp - b.timestamp);

    let tableRows = '';
    let balance = 0;
    let totalIn = 0;
    let totalOut = 0;

    allTransactions.forEach(t => {
        balance += t.quantity;
        if (t.quantity > 0) totalIn += t.quantity;
        else totalOut += t.quantity;

        tableRows += `
            <tr>
                <td style="border: 1px solid #000; padding: 8px;">${formatDateTime(t.timestamp)}</td>
                <td style="border: 1px solid #000; padding: 8px;">${t.type}</td>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;" class="${t.quantity > 0 ? 'text-green-600' : 'text-red-600'}">${t.quantity > 0 ? '+' : ''}${t.quantity}</td>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${balance}</td>
                <td style="border: 1px solid #000; padding: 8px;">${t.recipient || t.tenderId || 'N/A'}</td>
            </tr>
        `;
    });

    const currentDate = new Date();
    const formattedDate = `${String(currentDate.getDate()).padStart(2, '0')}/${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
    const formattedTime = `${String(currentDate.getHours()).padStart(2, '0')}:${String(currentDate.getMinutes()).padStart(2, '0')}:${String(currentDate.getSeconds()).padStart(2, '0')}`;

    const reportTitle = `Item Transaction Report for ${item.name}`;
    const reportSummary = `
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #000;">
            <tr>
                <td style="border: 1px solid #000; padding: 8px; width: 25%; font-weight: bold;">Item Name:</td>
                <td style="border: 1px solid #000; padding: 8px; width: 25%;">${item.name}</td>
                <td style="border: 1px solid #000; padding: 8px; width: 25%; font-weight: bold;">Start Date:</td>
                <td style="border: 1px solid #000; padding: 8px; width: 25%;">${formatDate(document.getElementById('reportFromDate').value)}</td>
            </tr>
            <tr>
                <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Specification:</td>
                <td style="border: 1px solid #000; padding: 8px;">${item.specification || 'N/A'}</td>
                <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">End Date:</td>
                <td style="border: 1px solid #000; padding: 8px;">${formatDate(document.getElementById('reportToDate').value)}</td>
            </tr>
            <tr>
                <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Total Inflow:</td>
                <td style="border: 1px solid #000; padding: 8px;">${totalIn} units</td>
                <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Total Outflow:</td>
                <td style="border: 1px solid #000; padding: 8px;">${Math.abs(totalOut)} units</td>
            </tr>
            <tr>
                <td colspan="3" style="border: 1px solid #000; padding: 8px; font-weight: bold; text-align: right;">Closing Balance for Period:</td>
                <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">${balance} units</td>
            </tr>
        </table>
    `;

    const reportTable = `
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #000;">
            <thead>
                <tr>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Date & Time</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Type</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Change</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Running Balance</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Details (Recipient/Tender ID)</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows || '<tr><td colspan="5" style="border: 1px solid #000; padding: 8px; text-align: center;">No transactions in this period.</td></tr>'}
            </tbody>
        </table>
    `;

    const contentHTML = `
        <div class="print-preview-content" style="font-family: Arial, sans-serif; line-height: 1.4;">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="font-size: 20pt; margin: 0 0 5px 0; font-weight: bold;">Department of Architecture</h1>
                <h2 style="font-size: 14pt; margin: 0 0 15px 0; font-weight: normal;">Sthapatya Bhaban<br>Segunbagicha, Dhaka-1000</h2>
                <h3 style="font-size: 16pt; margin: 0; text-decoration: underline; font-weight: bold;">${reportTitle}</h3>
            </div>

            <!-- Summary Table -->
            ${reportSummary}

            <!-- Transaction Table -->
            ${reportTable}

            <!-- Footer -->
            <div class="footer">
                <p>Generated by Store Management system of Department of Architecture, Segunbagicha, Dhaka-1000</p>
                <p>Generated on: ${formattedDate} at ${formattedTime}</p>
            </div>
        </div>
    `;

    document.getElementById('viewReportTitle').textContent = reportTitle;
    document.getElementById('viewReportContent').innerHTML = contentHTML;

    hideModal('generateReportModal');
    document.getElementById('viewReportModal').classList.remove('hidden');

    // Auto-save the report
    autoSaveReport(reportTitle, 'item', reportSummary, reportTable);
}

/**
 * Generates the Employee Disbursement Report.
 */
function generateEmployeeReportData() {
    const employeeId = document.getElementById('reportEmployeeSelect').value;
    const fromDate = new Date(document.getElementById('reportFromDate').value).getTime();
    const toDate = new Date(document.getElementById('reportToDate').value).getTime() + 86400000;

    const employees = storeData.employees || [];
    let filteredDisbursements = storeData.disbursements || [];
    let filteredReturns = storeData.returns || [];

    filteredDisbursements = filteredDisbursements.filter(d => {
        const dateMatch = new Date(d.date).getTime() >= fromDate && new Date(d.date).getTime() <= toDate;
        const empMatch = employeeId ? d.recipientId === employeeId : true;
        return dateMatch && empMatch;
    });

    filteredReturns = filteredReturns.filter(r => {
        const dateMatch = new Date(r.date).getTime() >= fromDate && new Date(r.date).getTime() <= toDate;
        const empMatch = employeeId ? r.recipientId === employeeId : true;
        return dateMatch && empMatch;
    });

    let tableRows = '';
    let slNo = 1;
    let totalDisbursed = 0;
    let totalReturned = 0;

    // Sort disbursements by date (oldest first)
    filteredDisbursements.sort((a, b) => new Date(a.date) - new Date(b.date));
    filteredReturns.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Combine and sort all transactions
    const allTransactions = [
        ...filteredDisbursements.map(d => ({ ...d, type: 'DISBURSEMENT' })),
        ...filteredReturns.map(r => ({ ...r, type: 'RETURN' }))
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    allTransactions.forEach(t => {
        t.items.forEach(item => {
            const inventoryItem = storeData.inventory.find(i => i.id === item.itemId);
            const itemName = inventoryItem ? inventoryItem.name : item.itemName;
            tableRows += `
                <tr>
                    <td style="border: 1px solid #000; padding: 8px; text-align: center;">${slNo}</td>
                    <td style="border: 1px solid #000; padding: 8px;">${formatDate(t.date)}</td>
                    <td style="border: 1px solid #000; padding: 8px;">${t.id.substring(0, 8)}</td>
                    <td style="border: 1px solid #000; padding: 8px;">${itemName}</td>
                    <td style="border: 1px solid #000; padding: 8px; text-align: center;">${item.quantity}</td>
                    <td style="border: 1px solid #000; padding: 8px;">${t.type}</td>
                </tr>
            `;
            slNo++;

            if (t.type === 'DISBURSEMENT') {
                totalDisbursed += item.quantity;
            } else {
                totalReturned += item.quantity;
            }
        });
    });

    const selectedEmployee = employeeId ? employees.find(e => e.id === employeeId) : null;
    const employeeName = selectedEmployee ? selectedEmployee.name : 'All Employees';
    const employeeDesignation = selectedEmployee ? selectedEmployee.designation : 'Various Designations';

    const currentDate = new Date();
    const formattedDate = `${String(currentDate.getDate()).padStart(2, '0')}/${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
    const formattedTime = `${String(currentDate.getHours()).padStart(2, '0')}:${String(currentDate.getMinutes()).padStart(2, '0')}:${String(currentDate.getSeconds()).padStart(2, '0')}`;

    const reportTitle = `Employee Transaction Report for ${employeeName}`;
    const reportSummary = `
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #000;">
            <tr>
                <td style="border: 1px solid #000; padding: 8px; width: 25%; font-weight: bold;">Recipient Name:</td>
                <td style="border: 1px solid #000; padding: 8px; width: 25%;">${employeeName}</td>
                <td style="border: 1px solid #000; padding: 8px; width: 25%; font-weight: bold;">Start Date:</td>
                <td style="border: 1px solid #000; padding: 8px; width: 25%;">${formatDate(document.getElementById('reportFromDate').value)}</td>
            </tr>
            <tr>
                <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Designation:</td>
                <td style="border: 1px solid #000; padding: 8px;">${employeeDesignation}</td>
                <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">End Date:</td>
                <td style="border: 1px solid #000; padding: 8px;">${formatDate(document.getElementById('reportToDate').value)}</td>
            </tr>
            <tr>
                <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Total Disbursed:</td>
                <td style="border: 1px solid #000; padding: 8px;">${totalDisbursed} units</td>
                <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Total Returned:</td>
                <td style="border: 1px solid #000; padding: 8px;">${totalReturned} units</td>
            </tr>
            <tr>
                <td colspan="3" style="border: 1px solid #000; padding: 8px; font-weight: bold; text-align: right;">Net Transaction:</td>
                <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">${totalDisbursed - totalReturned} units</td>
            </tr>
        </table>
    `;

    const reportTable = `
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #000;">
            <thead>
                <tr>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">SL</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Date</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Transaction ID</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Item</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Number of unit</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Type</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows || '<tr><td colspan="6" style="border: 1px solid #000; padding: 8px; text-align: center;">No transactions recorded for this filter.</td></tr>'}
            </tbody>
        </table>
    `;

    const contentHTML = `
        <div class="print-preview-content" style="font-family: Arial, sans-serif; line-height: 1.4;">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="font-size: 20pt; margin: 0 0 5px 0; font-weight: bold;">Department of Architecture</h1>
                <h2 style="font-size: 14pt; margin: 0 0 15px 0; font-weight: normal;">Sthapatya Bhaban<br>Segunbagicha, Dhaka-1000</h2>
                <h3 style="font-size: 16pt; margin: 0; text-decoration: underline; font-weight: bold;">${reportTitle}</h3>
            </div>

            <!-- Summary Table -->
            ${reportSummary}

            <!-- Transaction Table -->
            ${reportTable}

            <!-- Signature Section -->
            <div class="signature-section" style="margin-top: 40px;">
                <div class="signature-box">
                    <div class="signature-line">Signature of the Store In Charge</div>
                </div>
                <div class="signature-box">
                    <div class="signature-line">Signature and seal of Officer In Charge</div>
                </div>
            </div>

            <!-- Footer -->
            <div class="footer">
                <p>Generated by Store Management system of Department of Architecture, Segunbagicha, Dhaka-1000</p>
                <p>Generated on: ${formattedDate} at ${formattedTime}</p>
            </div>
        </div>
    `;

    document.getElementById('viewReportTitle').textContent = reportTitle;
    document.getElementById('viewReportContent').innerHTML = contentHTML;

    hideModal('generateReportModal');
    document.getElementById('viewReportModal').classList.remove('hidden');

    // Auto-save the report
    autoSaveReport(reportTitle, 'employee', reportSummary, reportTable);
}

/**
 * Auto-saves reports to the savedReports array.
 */
async function autoSaveReport(title, type, summary, data) {
    // Check if identical report already exists
    const existingReport = (storeData.savedReports || []).find(r =>
        r.title === title &&
        r.type === type &&
        r.summary === summary
    );

    if (existingReport) {
        showMessageModal("Info", `The report "${title}" has already been created on the "Saved Reports" page.`);
        return;
    }

    const newReport = {
        id: generateId(),
        title: title,
        type: type,
        generatedAt: new Date().toISOString().split('T')[0],
        data: data,
        summary: summary,
        timestamp: Date.now()
    };

    await saveStoreData({
        savedReports: [...storeData.savedReports, newReport]
    });

    // Refresh the saved reports list
    renderSavedReports();
}

/**
 * Renders the list of saved reports.
 */
function renderSavedReports() {
    const reports = storeData.savedReports || [];
    const list = document.getElementById('savedReportsList');
    if (!list) return;

    list.innerHTML = '';

    if (reports.length === 0) {
        list.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-500">No saved reports.</td></tr>`;
        return;
    }

    // Apply filters if any
    let filteredReports = [...reports];
    const searchTerm = document.getElementById('reportSearch').value.toLowerCase();
    const typeFilter = document.getElementById('reportTypeFilter').value;
    const fromDate = document.getElementById('reportFilterFrom').value;
    const toDate = document.getElementById('reportFilterTo').value;

    if (searchTerm) {
        filteredReports = filteredReports.filter(r =>
            r.title.toLowerCase().includes(searchTerm)
        );
    }

    if (typeFilter) {
        filteredReports = filteredReports.filter(r => r.type === typeFilter);
    }

    if (fromDate) {
        filteredReports = filteredReports.filter(r => new Date(r.generatedAt) >= new Date(fromDate));
    }

    if (toDate) {
        filteredReports = filteredReports.filter(r => new Date(r.generatedAt) <= new Date(toDate));
    }

    // Sort by timestamp (newest first)
    filteredReports.sort((a, b) => b.timestamp - a.timestamp);

    filteredReports.forEach(r => {
        const row = list.insertRow();
        row.className = 'table-row';
        row.innerHTML = `
            <td class="px-4 py-3 table-cell">${r.title}</td>
            <td class="px-4 py-3 text-xs">${r.type.toUpperCase()}</td>
            <td class="px-4 py-3 text-xs">${formatDate(r.generatedAt)}</td>
            <td class="px-4 py-3">
                <button onclick="viewSavedReport('${r.id}')" class="compact-button btn-outline mr-1">
                    <i class="fas fa-eye"></i>
                </button>
                <button onclick="deleteSavedReportConfirmation('${r.id}')" class="compact-button btn-danger ${currentUserRole === 'Admin' ? '' : 'hidden'}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
    });
}

function viewSavedReport(reportId) {
    const r = storeData.savedReports.find(r => r.id === reportId);
    if (!r) return showMessageModal("Error", "Report not found.");

    const contentHTML = `
        <div class="print-preview-content" style="font-family: Arial, sans-serif; line-height: 1.4;">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="font-size: 20pt; margin: 0 0 5px 0; font-weight: bold;">Department of Architecture</h1>
                <h2 style="font-size: 14pt; margin: 0 0 15px 0; font-weight: normal;">Sthapatya Bhaban<br>Segunbagicha, Dhaka-1000</h2>
                <h3 style="font-size: 16pt; margin: 0; text-decoration: underline; font-weight: bold;">${r.title}</h3>
                <p style="font-size: 12pt; margin-top: 5px;">Generated: ${formatDate(r.generatedAt)}</p>
            </div>
            ${r.summary}
            ${r.data}
            <div class="footer">
                <p>Report Snapshot ID: ${r.id.substring(0, 8)}</p>
                <p>Generated by Store Management system of Department of Architecture, Segunbagicha, Dhaka-1000</p>
            </div>
        </div>
    `;

    document.getElementById('viewReportTitle').textContent = `Report: ${r.title}`;
    document.getElementById('viewReportContent').innerHTML = contentHTML;
    document.getElementById('viewReportModal').classList.remove('hidden');
}

async function deleteSavedReport(reportId) {
    if (currentUserRole !== 'Admin') return showMessageModal('Denied', 'Only Admin can delete reports.');
    const newReports = storeData.savedReports.filter(r => r.id !== reportId);
    await saveStoreData({ savedReports: newReports });
    renderSavedReports(); // Refresh the list
    showMessageModal("Success", `Report deleted.`);
}

function deleteSavedReportConfirmation(reportId) {
    showConfirmationModal("Confirm Deletion", `Permanently delete this saved report?`, () => deleteSavedReport(reportId));
}

function printDisbursementLog() {
    if ((storeData.disbursements || []).length === 0 && (storeData.returns || []).length === 0) {
        return showMessageModal('Error', 'No transaction records to print.');
    }

    let tableRows = '';

    // Add disbursements
    storeData.disbursements.forEach(d => {
        const recipient = storeData.employees.find(e => e.id === d.recipientId);
        const recipientName = recipient ? recipient.name : 'Unknown/Batch';
        tableRows += `
            <tr>
                <td style="border: 1px solid #000; padding: 8px;">${formatDate(d.date)}</td>
                <td style="border: 1px solid #000; padding: 8px;">${recipientName}</td>
                <td style="border: 1px solid #000; padding: 8px;">Disbursement</td>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${d.totalItems}</td>
                <td style="border: 1px solid #000; padding: 8px;">${d.items.map(i => `${i.itemName}(${i.quantity})`).join('; ')}</td>
            </tr>
        `;
    });

    // Add returns
    storeData.returns.forEach(r => {
        const recipient = storeData.employees.find(e => e.id === r.recipientId);
        const recipientName = recipient ? recipient.name : 'Unknown/Batch';
        tableRows += `
            <tr>
                <td style="border: 1px solid #000; padding: 8px;">${formatDate(r.date)}</td>
                <td style="border: 1px solid #000; padding: 8px;">${recipientName}</td>
                <td style="border: 1px solid #000; padding: 8px;">Return</td>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${r.totalItems}</td>
                <td style="border: 1px solid #000; padding: 8px;">${r.items.map(i => `${i.itemName}(${i.quantity})`).join('; ')}</td>
            </tr>
        `;
    });

    const currentDate = new Date();
    const formattedDate = `${String(currentDate.getDate()).padStart(2, '0')}/${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
    const formattedTime = `${String(currentDate.getHours()).padStart(2, '0')}:${String(currentDate.getMinutes()).padStart(2, '0')}:${String(currentDate.getSeconds()).padStart(2, '0')}`;

    const contentHTML = `
        <div class="print-preview-content" style="font-family: Arial, sans-serif; line-height: 1.4;">
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="font-size: 20pt; margin: 0 0 5px 0; font-weight: bold;">Department of Architecture</h1>
                <h2 style="font-size: 14pt; margin: 0 0 15px 0; font-weight: normal;">Sthapatya Bhaban<br>Segunbagicha, Dhaka-1000</h2>
                <h3 style="font-size: 16pt; margin: 0; text-decoration: underline; font-weight: bold;">Transaction Log</h3>
                <p style="font-size: 12pt; margin-top: 5px;">As of: ${formattedDate}</p>
            </div>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #000;">
                <tr>
                    <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Total Disbursements:</td>
                    <td style="border: 1px solid #000; padding: 8px;">${storeData.disbursements.length}</td>
                    <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Total Returns:</td>
                    <td style="border: 1px solid #000; padding: 8px;">${storeData.returns.length}</td>
                </tr>
            </table>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #000;">
                <thead>
                    <tr>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Date</th>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Recipient</th>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Type</th>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Total Items</th>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Item Details</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
            <div class="footer">
                <p>Generated by Store Management system of Department of Architecture, Segunbagicha, Dhaka-1000</p>
                <p>Generated on: ${formattedDate} at ${formattedTime}</p>
            </div>
        </div>
    `;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = contentHTML;
    document.body.appendChild(tempDiv);
    printReportContent(tempDiv.id);
    document.body.removeChild(tempDiv);
}

/**
 * Filters the saved reports based on search and filter criteria
 */
function filterReports() {
    renderSavedReports();
}

/**
 * Clears all report filters
 */
function clearReportFilters() {
    document.getElementById('reportSearch').value = '';
    document.getElementById('reportFilterFrom').value = '';
    document.getElementById('reportFilterTo').value = '';
    document.getElementById('reportTypeFilter').value = '';
    renderSavedReports();
}

/**
 * Shows the Store Report Modal
 */
function showStoreReportModal() {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    document.getElementById('storeReportFromDate').value = thirtyDaysAgo;
    document.getElementById('storeReportToDate').value = today;
    document.getElementById('storeReportModal').classList.remove('hidden');
}

/**
 * Generates a store-wide report of added/resupplied items within a date range
 */
async function generateStoreReport(event) {
    event.preventDefault();

    const fromDate = new Date(document.getElementById('storeReportFromDate').value);
    const toDate = new Date(document.getElementById('storeReportToDate').value);

    if (fromDate > toDate) {
        return showMessageModal("Error", "Start date cannot be after end date.");
    }

    // Filter resupplies within date range
    const resuppliesInRange = (storeData.resupplies || []).filter(resupply => {
        const resupplyDate = new Date(resupply.date);
        return resupplyDate >= fromDate && resupplyDate <= toDate;
    });

    if (resuppliesInRange.length === 0) {
        hideModal('storeReportModal');
        return showMessageModal("Info", "No items were added or resupplied within the selected date range.");
    }

    // Build report data
    let reportRows = '';
    let totalQuantity = 0;

    resuppliesInRange.forEach((resupply, index) => {
        const item = storeData.inventory.find(i => i.id === resupply.itemId);
        const itemName = item ? item.name : 'Unknown Item';
        const specification = item ? (item.specification || 'N/A') : 'N/A';
        const tenderId = resupply.tenderId || 'N/A';

        totalQuantity += resupply.quantity;

        reportRows += `
            <tr>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${index + 1}</td>
                <td style="border: 1px solid #000; padding: 8px;">${itemName}</td>
                <td style="border: 1px solid #000; padding: 8px;">${specification}</td>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${resupply.quantity}</td>
                <td style="border: 1px solid #000; padding: 8px;">${tenderId}</td>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${formatDate(resupply.date)}</td>
            </tr>
        `;
    });

    const currentDate = new Date();
    const formattedDate = `${String(currentDate.getDate()).padStart(2, '0')}/${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
    const formattedTime = `${String(currentDate.getHours()).padStart(2, '0')}:${String(currentDate.getMinutes()).padStart(2, '0')}:${String(currentDate.getSeconds()).padStart(2, '0')}`;

    const reportHTML = `
        <div class="print-preview-content" style="font-family: Arial, sans-serif; line-height: 1.4;">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="font-size: 20pt; margin: 0 0 5px 0; font-weight: bold;">Department of Architecture</h1>
                <h2 style="font-size: 14pt; margin: 0 0 15px 0; font-weight: normal;">Sthapatya Bhaban<br>Segunbagicha, Dhaka-1000</h2>
                <h3 style="font-size: 16pt; margin: 0; text-decoration: underline; font-weight: bold;">Store Inventory Report</h3>
                <p style="margin: 10px 0;">Items Added/Resupplied from ${formatDate(fromDate)} to ${formatDate(toDate)}</p>
            </div>

            <!-- Report Table -->
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; border: 1px solid #000;">
                <thead>
                    <tr>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">SL</th>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Item Name</th>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Specification</th>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Quantity</th>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Tender ID</th>
                        <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Date</th>
                    </tr>
                </thead>
                <tbody>
                    ${reportRows}
                    <tr>
                        <td colspan="3" style="border: 1px solid #000; padding: 10px; text-align: right; font-weight: bold;">Total Quantity:</td>
                        <td style="border: 1px solid #000; padding: 10px; text-align: center; font-weight: bold;">${totalQuantity}</td>
                        <td colspan="2" style="border: 1px solid #000; padding: 10px;"></td>
                    </tr>
                </tbody>
            </table>

            <!-- Footer -->
            <div class="footer">
                <p>Generated by Store Management system of Department of Architecture, Segunbagicha, Dhaka-1000</p>
                <p>Generated on: ${formattedDate} at ${formattedTime}</p>
            </div>
        </div>
    `;

    const reportTitle = `${storeData.name} Supply/Resupply Report: ${formatDate(fromDate)} to ${formatDate(toDate)}`;
    // Create summary table
    const reportSummary = `
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #000;">
            <tr>
                <td style="border: 1px solid #000; padding: 8px; width: 25%; font-weight: bold;">Report Type:</td>
                <td style="border: 1px solid #000; padding: 8px; width: 25%;">Inventory Report</td>
                <td style="border: 1px solid #000; padding: 8px; width: 25%; font-weight: bold;">Start Date:</td>
                <td style="border: 1px solid #000; padding: 8px; width: 25%;">${formatDate(fromDate)}</td>
            </tr>
            <tr>
                <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Total Items:</td>
                <td style="border: 1px solid #000; padding: 8px;">${totalQuantity}</td>
                <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">End Date:</td>
                <td style="border: 1px solid #000; padding: 8px;">${formatDate(toDate)}</td>
            </tr>
        </table>
    `;

    // Extract just the table part for saving
    const reportTable = `
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; border: 1px solid #000;">
            <thead>
                <tr>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">SL</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Item Name</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Specification</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Quantity</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Tender ID</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Date</th>
                </tr>
            </thead>
            <tbody>
                ${reportRows}
                <tr>
                    <td colspan="3" style="border: 1px solid #000; padding: 10px; text-align: right; font-weight: bold;">Total Quantity:</td>
                    <td style="border: 1px solid #000; padding: 10px; text-align: center; font-weight: bold;">${totalQuantity}</td>
                    <td colspan="2" style="border: 1px solid #000; padding: 10px;"></td>
                </tr>
            </tbody>
        </table>
    `;

    // Show report
    document.getElementById('viewReportTitle').textContent = reportTitle;
    document.getElementById('viewReportContent').innerHTML = reportHTML;
    hideModal('storeReportModal');
    document.getElementById('viewReportModal').classList.remove('hidden');

    // Auto-save the report using the standard function
    await autoSaveReport(reportTitle, 'inventory_store', reportSummary, reportTable);

    showMessageModal("Success", `Store report generated successfully with ${resuppliesInRange.length} entries.`);
}

// =========================================================================
// 12. SEARCH AND FILTER FUNCTIONS
// =========================================================================

/**
 * Filters inventory based on search and filter criteria
 */
function filterInventory() {
    inventoryPage = 1;
    renderInventory();
}

/**
 * Clears inventory filters
 */
function clearInventoryFilters() {
    document.getElementById('inventorySearch').value = '';
    document.getElementById('inventoryStockFilter').value = '';
    inventoryPage = 1;
    renderInventory();
}

/**
 * Filters employees based on search and filter criteria
 */
function filterEmployees() {
    renderEmployees();
}

/**
 * Clears employee filters
 */
function clearEmployeeFilters() {
    document.getElementById('employeeSearch').value = '';
    document.getElementById('employeeDesignationFilter').value = '';
    renderEmployees();
}

/**
 * Filters transactions based on search and filter criteria
 */
function filterDisbursements() {
    disbursementPage = 1;
    renderDisbursements();
}

/**
 * Clears transaction filters
 */
function clearDisbursementFilters() {
    document.getElementById('disbursementSearch').value = '';
    document.getElementById('disbursementDateFrom').value = '';
    document.getElementById('disbursementDateTo').value = '';
    document.getElementById('disbursementTypeFilter').value = '';
    disbursementPage = 1;
    renderDisbursements();
}

// =========================================================================
// 13. CONFIRMATION DIALOGS
// =========================================================================

// Confirmation wrappers for CRUD operations
function deleteItemConfirmation() {
    const itemId = document.getElementById('editItemId').value;
    const item = storeData.inventory.find(i => i.id === itemId);
    hideModal('itemDetailsModal');
    showConfirmationModal("Confirm Deletion", `Are you sure you want to delete item "${item.name}"? This will remove it permanently.`, () => deleteItem(itemId));
}

function deleteEmployeeConfirmation(id, name) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Only Admin and Managers can delete employees.');
    showConfirmationModal("Confirm Deletion", `Permanently delete employee "${name}"?`, () => deleteEmployee(id));
}

function deleteTransactionConfirmation(id, type) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Only Admin and Managers can delete records.');
    showConfirmationModal("Confirm Deletion", `Permanently delete ${type} record ${id.substring(0, 4)}...?`, () => deleteTransaction(id, type));
}

let adminReauthCallback = null;

function showAdminReauthModal(callback) {
    adminReauthCallback = callback;
    document.getElementById('reauthPassword').value = '';
    document.getElementById('reauthError').classList.add('hidden');
    document.getElementById('adminReauthModal').classList.remove('hidden');
}

function deleteStoreConfirmation(id, name) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Only Admin and Managers can delete stores.');
    showAdminReauthModal(() => {
        showConfirmationModal("Confirm Store Deletion", `Are you sure you want to PERMANENTLY delete the store "${name}" and all its data?`, () => deleteStore(id));
    });
}

// =========================================================================
// 14. INITIALIZATION
// =========================================================================

async function initializeApp() {
    // Set up ALL event listeners FIRST, before any async data loading.
    // This ensures the UI is always interactive even if the network call fails.
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    document.querySelectorAll('.sidebar-item').forEach(button => {
        button.addEventListener('click', (e) => showTab(e.currentTarget.dataset.tab));
    });

    // Form event listeners
    document.getElementById('addItemForm').addEventListener('submit', addItem);
    document.getElementById('resupplyForm').addEventListener('submit', resupplyItem);
    document.getElementById('disbursementForm').addEventListener('submit', recordDisbursement);
    document.getElementById('returnForm').addEventListener('submit', recordReturn);
    document.getElementById('batchDisbursementForm').addEventListener('submit', recordBatchDisbursement);
    document.getElementById('addEmployeeForm').addEventListener('submit', addEmployee);
    document.getElementById('editItemForm').addEventListener('submit', editItem);
    document.getElementById('editEmployeeForm').addEventListener('submit', editEmployee);




    document.getElementById('addStoreForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = e.target.newStoreId.value.trim();
        const name = e.target.newStoreName.value.trim();
        const location = e.target.newStoreLocation.value.trim();

        if (allStores[id]) return showMessageModal("Error", `Store ID "${id}" already exists.`);

        allStores[id] = { name, location };

        // Create empty store data
        const newStoreData = {
            name,
            location,
            lastBackup: new Date(0)
        };

        await apiPost('saveStoreDataUpdates', {
            storeId: id,
            updates: newStoreData
        });

        e.target.reset();
        await populateStoreSelector();
        switchStore(id);
        showMessageModal("Success", `New store "${name}" created.`);
    });
    document.getElementById('pruneDataForm').addEventListener('submit', pruneData);
    document.getElementById('adminReauthForm').addEventListener('submit', handleAdminReauth);
    document.getElementById('csvImportForm').addEventListener('submit', importEmployeesFromCSV);
    document.getElementById('storeReportForm').addEventListener('submit', generateStoreReport);

    const selectAllInventoryEl = document.getElementById('selectAllInventory');
    if (selectAllInventoryEl) {
        selectAllInventoryEl.addEventListener('change', (e) => {
            document.querySelectorAll('.inventory-checkbox').forEach(cb => {
                if (!cb.disabled) cb.checked = e.target.checked;
            });
            updateBatchDeleteButton();
        });
    }
    const batchDeleteBtnEl = document.getElementById('batchDeleteBtn');
    if (batchDeleteBtnEl) {
        batchDeleteBtnEl.addEventListener('click', deleteSelectedInventoryItems);
    }

    // Report filter event listeners
    document.getElementById('reportSearch').addEventListener('input', filterReports);
    document.getElementById('reportFilterFrom').addEventListener('change', filterReports);
    document.getElementById('reportFilterTo').addEventListener('change', filterReports);
    document.getElementById('reportTypeFilter').addEventListener('change', filterReports);

    // Search and filter event listeners
    document.getElementById('inventorySearch').addEventListener('input', filterInventory);
    document.getElementById('inventoryStockFilter').addEventListener('change', filterInventory);
    document.getElementById('employeeSearch').addEventListener('input', filterEmployees);
    document.getElementById('employeeDesignationFilter').addEventListener('change', filterEmployees);
    document.getElementById('disbursementSearch').addEventListener('input', filterDisbursements);
    document.getElementById('disbursementDateFrom').addEventListener('change', filterDisbursements);
    document.getElementById('disbursementDateTo').addEventListener('change', filterDisbursements);
    document.getElementById('disbursementTypeFilter').addEventListener('change', filterDisbursements);

    const today = new Date().toISOString().split('T')[0];
    document.querySelectorAll('input[type="date"]').forEach(input => {
        if (!input.value) {
            input.value = today;
        }
    });

    // Initialize searchable dropdowns
    initializeSearchableDropdowns();

    window.addEventListener('online', () => {
        document.body.classList.remove('offline');
    });
    window.addEventListener('offline', () => {
        document.body.classList.add('offline');
    });

    // NOW load data from the backend (after all listeners are attached)
    try {
        if (!currentStoreId) {
            await populateStoreSelector();
        }
    } catch (error) {
        console.error("Failed to load initial store data:", error);
        showMessageModal("Connection Error", "Could not connect to the database. You can still navigate the app. Try reloading or use 'Import Master JSON' from Data & Storage.");
    }
}

function updateOfflineStatus() {
    if (navigator.onLine) {
        document.body.classList.remove('offline');
    } else {
        document.body.classList.add('offline');
    }
}

/**
 * Triggers the file input click for importing the master JSON
 */
function triggerImportJSON() {
    if (currentUserRole !== 'Admin') {
        return showMessageModal("Denied", "Only Administrators can import master data.");
    }

    // Create a hidden file input element dynamically
    let fileInput = document.getElementById('hiddenJSONImportInput');
    if (!fileInput) {
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'hiddenJSONImportInput';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', handleJSONImport);
        document.body.appendChild(fileInput);
    }
    // Reset the value so it can be re-selected if needed
    fileInput.value = '';
    fileInput.click();
}

/**
 * Handles the selected JSON file and sends it to GAS for full migration import.
 */
async function handleJSONImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    showMessageModal("Importing", "Reading JSON file and updating Firestore. This will sync with Google Drive on next login.");

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const masterData = JSON.parse(e.target.result);

            // Validate format
            if (typeof masterData !== 'object' || Array.isArray(masterData)) {
                throw new Error("Invalid format. Expected a Store Map object.");
            }

            const storeIds = Object.keys(masterData);
            let processed = 0;

            for (const storeId of storeIds) {
                // Primary Write: Firestore
                await db.collection('stores').doc(storeId).set({
                    ...masterData[storeId],
                    lastModified: new Date().toISOString()
                });
                processed++;
                console.log(`Imported store ${storeId} to Firestore (${processed}/${storeIds.length})`);
            }

            hideModal('messageModal');
            setTimeout(() => {
                showMessageModal("Success", `Import successful! ${processed} stores imported to Firestore. They will synchronize with Google Drive automatically.`);
                setTimeout(() => window.location.reload(), 3000);
            }, 500);

            await logAuditAction("DATA_IMPORTED", `Admin imported database to Firestore from JSON file: ${file.name}`);

        } catch (error) {
            console.error("Import failed:", error);
            hideModal('messageModal');
            setTimeout(() => showMessageModal("Error", "Failed to parse or import data: " + error.message), 500);
        }
    };

    reader.onerror = function () {
        console.error("File reading failed");
        hideModal('messageModal');
        setTimeout(() => showMessageModal("Error", "Failed to read the file."), 500);
    };

    reader.readAsText(file);
}

/**
 * Triggers the export of all store data to a Master JSON file.
 */
async function triggerExportJSON() {
    if (currentUserRole !== 'Admin') {
        return showMessageModal("Denied", "Only Administrators can export master data.");
    }

    showMessageModal("Exporting", "Fetching all database records from Firestore. This is near-instant...");

    try {
        // Fetch all stores from Firestore
        const snapshot = await db.collection('stores').get();
        const masterData = {};

        snapshot.forEach(doc => {
            masterData[doc.id] = doc.data();
        });

        // Convert to JSON string and trigger download
        const jsonString = JSON.stringify(masterData, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `doa-store-manager-firestore-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();

        // Clean up
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            hideModal('messageModal');
        }, 100);

        await logAuditAction("DATA_EXPORTED", `Admin exported Firestore database to JSON`);

    } catch (error) {
        console.error("Export failed:", error);
        hideModal('messageModal');
        setTimeout(() => showMessageModal("Error", "Failed to export data: " + error.message), 500);
    }
}

// Initialize the login form when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is already logged in
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    const userRole = localStorage.getItem('userRole');
    const userName = localStorage.getItem('userName');

    if (isLoggedIn === 'true' && userRole) {
        currentUserRole = userRole;
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('appContainer').classList.remove('hidden');
        document.getElementById('userName').textContent = userName || 'User';
        document.getElementById('userRole').textContent = userRole;
        document.getElementById('userInitials').textContent = userName ? userName.charAt(0) : 'U';
        initializeApp();
    } else {
        // Set up login form event listener
        document.getElementById('loginForm').addEventListener('submit', handleLogin);

        // Always show login page by default
        document.getElementById('loginPage').classList.remove('hidden');
        document.getElementById('appContainer').classList.add('hidden');
    }
});

// =========================================================================
// DISBURSEMENT REPORT BY STORE
// =========================================================================

/**
 * Shows the modal for generating disbursement/return reports.
 */
function showDisbursementReportModal() {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    document.getElementById('disbursementReportFrom').value = thirtyDaysAgo.toISOString().split('T')[0];
    document.getElementById('disbursementReportTo').value = today.toISOString().split('T')[0];
    document.getElementById('disbursementReportType').value = 'disbursement';

    document.getElementById('disbursementReportModal').classList.remove('hidden');
}

/**
 * Generates the Disbursement/Return Report by Store.
 */
function generateDisbursementReport(event) {
    event.preventDefault();
    const type = document.getElementById('disbursementReportType').value;
    const fromDate = new Date(document.getElementById('disbursementReportFrom').value).getTime();
    const toDate = new Date(document.getElementById('disbursementReportTo').value).getTime() + 86400000; // End of day

    const sourceData = type === 'disbursement' ? storeData.disbursements : storeData.returns;
    const reportTitle = type === 'disbursement' ? `${storeData.name} Disbursement Report` : `${storeData.name} Return Report`;

    let tableRows = '';
    let slNo = 1;
    let totalQuantity = 0;

    // Filter and process data
    const filteredData = sourceData.filter(d => {
        const dDate = new Date(d.date).getTime();
        return dDate >= fromDate && dDate <= toDate;
    });

    // Aggregate items by itemId
    const itemMap = new Map();

    filteredData.forEach(record => {
        record.items.forEach(item => {
            const inventoryItem = storeData.inventory.find(i => i.id === item.itemId);
            const itemName = inventoryItem ? inventoryItem.name : item.itemName;
            const specification = inventoryItem ? inventoryItem.specification : 'N/A';
            const recordDate = new Date(record.date);

            if (itemMap.has(item.itemId)) {
                const existing = itemMap.get(item.itemId);
                existing.quantity += item.quantity;
                // Update to most recent date
                if (recordDate > new Date(existing.lastDate)) {
                    existing.lastDate = record.date;
                }
            } else {
                itemMap.set(item.itemId, {
                    itemName,
                    specification,
                    quantity: item.quantity,
                    lastDate: record.date
                });
            }
        });
    });

    const reportItems = Array.from(itemMap.values());

    // Sort by item name
    reportItems.sort((a, b) => a.itemName.localeCompare(b.itemName));

    reportItems.forEach(item => {
        tableRows += `
            <tr>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${slNo++}</td>
                <td style="border: 1px solid #000; padding: 8px;">${item.itemName}</td>
                <td style="border: 1px solid #000; padding: 8px;">${item.specification || 'N/A'}</td>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${item.quantity}</td>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${formatDate(item.lastDate)}</td>
            </tr>
        `;
        totalQuantity += item.quantity;
    });

    const currentDate = new Date();
    const formattedDate = `${String(currentDate.getDate()).padStart(2, '0')}/${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
    const formattedTime = `${String(currentDate.getHours()).padStart(2, '0')}:${String(currentDate.getMinutes()).padStart(2, '0')}:${String(currentDate.getSeconds()).padStart(2, '0')}`;

    const reportSummary = `
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #000;">
            <tr>
                <td style="border: 1px solid #000; padding: 8px; width: 25%; font-weight: bold;">Report Type:</td>
                <td style="border: 1px solid #000; padding: 8px; width: 25%;">${type === 'disbursement' ? 'Disbursement' : 'Return'}</td>
                <td style="border: 1px solid #000; padding: 8px; width: 25%; font-weight: bold;">Start Date:</td>
                <td style="border: 1px solid #000; padding: 8px; width: 25%;">${formatDate(document.getElementById('disbursementReportFrom').value)}</td>
            </tr>
            <tr>
                <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Total Items:</td>
                <td style="border: 1px solid #000; padding: 8px;">${totalQuantity}</td>
                <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">End Date:</td>
                <td style="border: 1px solid #000; padding: 8px;">${formatDate(document.getElementById('disbursementReportTo').value)}</td>
            </tr>
        </table>
    `;

    const reportTable = `
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #000;">
            <thead>
                <tr>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">SL</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Name of the Items</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Specification</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Quantity</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #f0f0f0; font-weight: bold;">Last ${type === 'disbursement' ? 'Disbursement' : 'Return'}</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows || '<tr><td colspan="5" style="border: 1px solid #000; padding: 8px; text-align: center;">No records found for this period.</td></tr>'}
            </tbody>
        </table>
    `;

    const contentHTML = `
        <div class="print-preview-content" style="font-family: Arial, sans-serif; line-height: 1.4;">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="font-size: 20pt; margin: 0 0 5px 0; font-weight: bold;">Department of Architecture</h1>
                <h2 style="font-size: 14pt; margin: 0 0 15px 0; font-weight: normal;">Sthapatya Bhaban<br>Segunbagicha, Dhaka-1000</h2>
                <h3 style="font-size: 16pt; margin: 0; text-decoration: underline; font-weight: bold;">${reportTitle}</h3>
            </div>

            <!-- Summary Table -->
            ${reportSummary}

            <!-- Transaction Table -->
            ${reportTable}

            <!-- Footer -->
            <div class="footer">
                <p>Generated by Store Management system of Department of Architecture, Segunbagicha, Dhaka-1000</p>
                <p>Generated on: ${formattedDate} at ${formattedTime}</p>
            </div>
        </div>
    `;

    document.getElementById('viewReportTitle').textContent = reportTitle;
    document.getElementById('viewReportContent').innerHTML = contentHTML;

    hideModal('disbursementReportModal');
    document.getElementById('viewReportModal').classList.remove('hidden');

    // Auto-save the report
    autoSaveReport(reportTitle, 'store_transaction', reportSummary, reportTable);
}

// Add event listener
document.getElementById('disbursementReportForm').addEventListener('submit', generateDisbursementReport);
