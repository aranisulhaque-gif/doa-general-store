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
            'navDataStorage', 'navStoreManagement'
        ];

        gatedElements.forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });

        if (currentUserRole === 'Admin') {
            gatedElements.forEach(id => {
                document.getElementById(id)?.classList.remove('hidden');
            });
        } else if (currentUserRole === 'Manager') {
            const managerAllowed = [
                'exportJsonBtn', 'addEmployeeBtn', 'addItemBtn', 'resupplyBtn',
                'dashResupplyBtn', 'dashAddItemBtn', 'dashAddEmployeeBtn',
                'dashNewDisbursementBtn', 'dashBatchDisbursementBtn', 'newDisbursementBtn',
                'batchDisbursementBtn', 'recordReturnBtn', 'itemReportBtn',
                'inventoryStoreReportBtn', 'employeeReportBtn', 'disbursementStoreReportBtn',
                'csvImportBtn', 'navStoreManagement'
            ];
            managerAllowed.forEach(id => {
                document.getElementById(id)?.classList.remove('hidden');
            });

            // Ensure strictly admin-only features remain hidden
            document.getElementById('maintenanceSection')?.classList.add('hidden');
            document.getElementById('importJsonBtn')?.classList.add('hidden');
            document.getElementById('batchDeleteBtn')?.classList.add('hidden');
            document.getElementById('csvImportBtn')?.classList.add('hidden'); // Managers can't bulk import employees unless specified
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
