const STORAGE_KEY = 'doa_delta_tracker';

export let storeData = {
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

export let allStores = {};
export let currentStoreId = null;
export let currentUserRole = null;

export let pagination = {
    inventoryPage: 1,
    inventoryPerPage: 10,
    employeePage: 1,
    employeesPerPage: 10,
    disbursementPage: 1,
    disbursementsPerPage: 10
};

export let syncState = {
    isSyncing: false,
    lastSyncTime: null,
    progress: 0
};


export let storeListenerUnsubscribe = null;

export const setStoreData = (newData) => { storeData = newData; };
export const setCurrentStoreId = (id) => { currentStoreId = id; };
export const setCurrentUserRole = (role) => { currentUserRole = role; };
export const setAllStores = (stores) => { allStores = stores; };
export const setStoreListenerUnsubscribe = (unsub) => { storeListenerUnsubscribe = unsub; };

// Legacy delta tracking functions (no-op for Supabase migration)
export const trackAddition = () => {};
export const trackUpdate = () => {};
export const trackDeletion = () => {};

/**
 * Resets storeData to its default structure while maintaining the same object reference.
 * Essential for robust synchronization from external sources.
 */
export const resetStoreData = () => {
    Object.keys(storeData).forEach(key => delete storeData[key]);
    Object.assign(storeData, {
        inventory: [],
        employees: [],
        disbursements: [],
        returns: [],
        resupplies: [],
        savedReports: [],
        eventLogs: [],
        lastBackup: new Date(0)
    });
};
