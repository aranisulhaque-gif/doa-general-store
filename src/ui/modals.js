import { storeData, currentUserRole, pagination } from '../core/state.js';
import { formatDate } from '../utils/formatters.js';
import { showMessageModal, showConfirmationModal, hideModal } from '../utils/helpers.js';
import { updateBatchDeleteButton } from './inventory.js';
import { renderUI } from './render.js';
import { renderEventLog } from './eventLog.js';

export function populateEmployeeSelectors() {
    const options = (storeData.employees || []).map(e => `<option value="${e.id}">${e.name} (${e.designation})</option>`).join('');

    const recipients = document.getElementById('disbursementRecipient');
    if (recipients) recipients.innerHTML = '<option value="">Select Employee/Recipient</option>' + options;

    const returnRecipients = document.getElementById('returnRecipient');
    if (returnRecipients) returnRecipients.innerHTML = '<option value="">Select Employee/Recipient</option>' + options;

    const batchRecipients = document.getElementById('batchRecipientList');
    if (batchRecipients) batchRecipients.innerHTML = options;

    const reportEmployeeSelect = document.getElementById('reportEmployeeSelect');
    if (reportEmployeeSelect) reportEmployeeSelect.innerHTML = '<option value="">All Employees</option>' + options;

    initializeSearchableDropdowns();
}

export function populateResupplyItemSelect() {
    const options = (storeData.inventory || []).map(i => `<option value="${i.id}">${i.name} (Stock: ${i.quantity})</option>`).join('');

    const select = document.getElementById('resupplyItemSelect');
    if (select) select.innerHTML = '<option value="">Select Item</option>' + options;

    const reportSelect = document.getElementById('reportItemSelect');
    if (reportSelect) reportSelect.innerHTML = '<option value="">Select Item</option>' + options;

    initializeSearchableDropdowns();
}

export function addDisbursementItemRow() {
    const container = document.getElementById('disbursementItemsContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'flex space-x-3 disbursement-item-row';
    row.innerHTML = `
        <div class="searchable-select flex-1 min-w-[200px]">
            <input type="text" placeholder="Search items..." class="form-input">
            <div class="dropdown-arrow"><i class="fas fa-chevron-down"></i></div>
            <div class="dropdown-options"></div>
            <select class="item-select form-input hidden">
                <option value="">Select Item</option>
                ${getInventoryOptions()}
            </select>
        </div>
        <input type="number" class="quantity-input w-24 form-input" placeholder="Qty" min="1" required>
        <button type="button" onclick="this.parentNode.remove()" class="compact-button skeuo-btn btn-danger">
            <i class="fas fa-times"></i>
        </button>
    `;
    container.appendChild(row);
    initializeSearchableDropdowns();
}

export function getInventoryOptions(excludeId = null) {
    return (storeData.inventory || [])
        .map(item => `<option value="${item.id}" ${item.id === excludeId ? 'disabled' : ''}>${item.name} (Stock: ${item.quantity})</option>`)
        .join('');
}

export function initializeSearchableDropdowns() {
    document.querySelectorAll('.searchable-select').forEach(container => {
        const input = container.querySelector('input');
        const select = container.querySelector('select');
        const optionsContainer = container.querySelector('.dropdown-options');

        if (!input || !select || !optionsContainer) return;

        function populateOptions() {
            optionsContainer.innerHTML = '';
            Array.from(select.options).forEach(option => {
                if (option.value === '') return;
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

        input.onfocus = () => container.classList.add('active');

        input.oninput = () => {
            const filter = input.value.toLowerCase();
            Array.from(optionsContainer.children).forEach(option => {
                const text = option.textContent.toLowerCase();
                option.style.display = text.includes(filter) ? 'block' : 'none';
            });
        };

        optionsContainer.onclick = (e) => {
            if (e.target.classList.contains('dropdown-option')) {
                const value = e.target.dataset.value;
                const text = e.target.textContent;
                select.value = value;
                input.value = text;
                container.classList.remove('active');
                populateOptions();
                select.dispatchEvent(new Event('change'));
            }
        };
    });
}

// Modal Toggle Functions
export function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));

    const tabEl = document.getElementById(tabId);
    if (tabEl) tabEl.classList.remove('hidden');

    const navEl = document.querySelector(`.sidebar-item[data-tab="${tabId}"]`);
    if (navEl) navEl.classList.add('active');

    // Trigger render to ensure charts/tables are current for the visible tab
    renderUI();

    // Specific logic for Data & Storage tab
    if (tabId === 'data-storage') {
        renderEventLog();
    }
}

export function showDisbursementForm() {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager' && currentUserRole !== 'Storekeeper') return showMessageModal('Denied', 'Permission denied.');
    document.getElementById('disbursementModal')?.classList.remove('hidden');
}
export function showReturnForm() {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager' && currentUserRole !== 'Storekeeper') return showMessageModal('Denied', 'Permission denied.');
    document.getElementById('returnModal')?.classList.remove('hidden');
}
export function showBatchDisbursementForm() {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager' && currentUserRole !== 'Storekeeper') return showMessageModal('Denied', 'Permission denied.');
    document.getElementById('batchDisbursementModal')?.classList.remove('hidden');
}
export function showSupplyForm() {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager' && currentUserRole !== 'Storekeeper') return showMessageModal('Denied', 'Permission denied.');
    document.getElementById('addItemCard')?.classList.remove('hidden');
}
export function hideSupplyForm() { document.getElementById('addItemCard')?.classList.add('hidden'); }
export function showResupplyForm() {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager' && currentUserRole !== 'Storekeeper') return showMessageModal('Denied', 'Permission denied.');
    document.getElementById('resupplyCard')?.classList.remove('hidden');
}
export function hideResupplyForm() { document.getElementById('resupplyCard')?.classList.add('hidden'); }
export function showAddEmployeeForm() {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager' && currentUserRole !== 'Storekeeper') return showMessageModal('Denied', 'Permission denied.');
    document.getElementById('addEmployeeCard')?.classList.remove('hidden');
}
export function hideAddEmployeeForm() { document.getElementById('addEmployeeCard')?.classList.add('hidden'); }

export function showItemDetailsModal(itemId) {
    const item = storeData.inventory?.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById('editItemId').value = item.id;
    document.getElementById('detailItemId').textContent = item.id;
    document.getElementById('editItemName').value = item.name;
    document.getElementById('editItemSpec').value = item.specification || '';
    document.getElementById('editItemQuantity').value = item.quantity;

    document.getElementById('itemDetailsModal')?.classList.remove('hidden');
}

export function showEmployeeDetailsModal(employeeId) {
    const emp = storeData.employees?.find(e => e.id === employeeId);
    if (!emp) return;

    document.getElementById('editEmployeeId').value = emp.id;
    document.getElementById('detailEmployeeId').textContent = emp.id;
    document.getElementById('editEmployeeName').value = emp.name;
    document.getElementById('editEmployeeDesignation').value = emp.designation;

    document.getElementById('employeeDetailsModal')?.classList.remove('hidden');
}

export function showPruneDataModal() {
    if (currentUserRole !== 'Admin') return showMessageModal('Denied', 'Only Admin can prune data.');
    document.getElementById('pruneDataModal')?.classList.remove('hidden');
}
