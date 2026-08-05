import { renderDashboard } from './dashboard.js';
import { renderInventory } from './inventory.js';
import { renderEmployees } from './employees.js';
import { renderDisbursements } from './disbursements.js';
import { populateEmployeeSelectors, populateResupplyItemSelect } from './modals.js';
import { currentUserRole, storeData } from '../core/state.js';

let lastRenderedData = {
    inventory: null,
    employees: null,
    disbursements: null,
    returns: null,
    role: null
};

export function renderUI() {
    const hasRoleChanged = currentUserRole !== lastRenderedData.role;

    // 1. Role-based UI gating (only if role changed)
    if (hasRoleChanged) {
        lastRenderedData.role = currentUserRole;
        const gatedElements = [
            'maintenanceSection', 'batchDeleteBtn', 'exportJsonBtn', 'importJsonBtn',
            'addEmployeeBtn', 'addItemBtn', 'resupplyBtn', 'csvImportBtn',
            'dashResupplyBtn', 'dashAddItemBtn', 'dashAddEmployeeBtn',
            'dashNewDisbursementBtn', 'dashBatchDisbursementBtn', 'newDisbursementBtn',
            'batchDisbursementBtn', 'recordReturnBtn', 'itemReportBtn',
            'inventoryStoreReportBtn', 'employeeReportBtn', 'disbursementStoreReportBtn',
            'navDataStorage', 'navStoreManagement', 'navUserRoles'
        ];

        gatedElements.forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });

        if (currentUserRole === 'Admin') {
            // Admin: everything
            gatedElements.forEach(id => {
                document.getElementById(id)?.classList.remove('hidden');
            });
        } else if (currentUserRole === 'Manager') {
            // Manager: everything except prune data (maintenanceSection)
            const managerAllowed = [
                'exportJsonBtn', 'importJsonBtn', 'addEmployeeBtn', 'addItemBtn',
                'resupplyBtn', 'csvImportBtn', 'batchDeleteBtn',
                'dashResupplyBtn', 'dashAddItemBtn', 'dashAddEmployeeBtn',
                'dashNewDisbursementBtn', 'dashBatchDisbursementBtn', 'newDisbursementBtn',
                'batchDisbursementBtn', 'recordReturnBtn', 'itemReportBtn',
                'inventoryStoreReportBtn', 'employeeReportBtn', 'disbursementStoreReportBtn',
                'navStoreManagement', 'navDataStorage'
            ];
            managerAllowed.forEach(id => {
                document.getElementById(id)?.classList.remove('hidden');
            });
            // Prune data is Admin-only
            document.getElementById('maintenanceSection')?.classList.add('hidden');
        } else if (currentUserRole === 'Storekeeper') {
            // Storekeeper: add/record/report buttons only — no delete, no data/store management
            const storekeeperAllowed = [
                'addItemBtn', 'resupplyBtn', 'addEmployeeBtn',
                'dashResupplyBtn', 'dashAddItemBtn', 'dashAddEmployeeBtn',
                'dashNewDisbursementBtn', 'dashBatchDisbursementBtn', 'newDisbursementBtn',
                'batchDisbursementBtn', 'recordReturnBtn', 'itemReportBtn',
                'inventoryStoreReportBtn', 'employeeReportBtn', 'disbursementStoreReportBtn'
            ];
            storekeeperAllowed.forEach(id => {
                document.getElementById(id)?.classList.remove('hidden');
            });
        }
    }

    // 2. Targeted Section Rendering
    // Using string representation for quick deep comparison
    const currentInventoryStr = JSON.stringify(storeData.inventory);
    const currentEmployeesStr = JSON.stringify(storeData.employees);
    const currentDisbursementsStr = JSON.stringify(storeData.disbursements);
    const currentReturnsStr = JSON.stringify(storeData.returns);

    const hasInventoryChanged = currentInventoryStr !== lastRenderedData.inventory;
    const hasEmployeesChanged = currentEmployeesStr !== lastRenderedData.employees;
    const hasTransactionsChanged = currentDisbursementsStr !== lastRenderedData.disbursements || currentReturnsStr !== lastRenderedData.returns;

    // Dashboard always updates (fast stats), but content-heavy charts have internal check
    renderDashboard();

    if (hasInventoryChanged) {
        lastRenderedData.inventory = currentInventoryStr;
        renderInventory();
        populateResupplyItemSelect();
    }

    if (hasEmployeesChanged) {
        lastRenderedData.employees = currentEmployeesStr;
        renderEmployees();
        populateEmployeeSelectors();
    }

    if (hasTransactionsChanged) {
        lastRenderedData.disbursements = currentDisbursementsStr;
        lastRenderedData.returns = currentReturnsStr;
        renderDisbursements();
    }
}
