import { storeData, currentUserRole, pagination, trackAddition, trackUpdate, trackDeletion } from '../core/state.js';
import { formatDate } from '../utils/formatters.js';
import { showMessageModal, showConfirmationModal, generateId, hideModal } from '../utils/helpers.js';
import { saveStoreData, logAuditAction } from '../main.js';
import { initializeSearchableDropdowns, getInventoryOptions } from './modals.js';

export function renderDisbursements() {
    const disbursements = storeData.disbursements || [];
    const returns = storeData.returns || [];

    const allTransactions = [
        ...disbursements.map(d => ({ ...d, type: 'disbursement' })),
        ...returns.map(r => ({ ...r, type: 'return' }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const list = document.getElementById('disbursementList');
    if (!list) return;

    list.innerHTML = '';

    let filteredTransactions = [...allTransactions];
    const searchTerm = document.getElementById('disbursementSearch')?.value.toLowerCase() || '';
    const typeFilter = document.getElementById('disbursementTypeFilter')?.value || '';

    if (searchTerm) {
        filteredTransactions = filteredTransactions.filter(t => {
            const recipient = storeData.employees.find(e => e.id === t.recipientId);
            return recipient ? recipient.name.toLowerCase().includes(searchTerm) : false;
        });
    }

    if (typeFilter) {
        filteredTransactions = filteredTransactions.filter(t => t.type === typeFilter);
    }

    const start = (pagination.disbursementPage - 1) * pagination.disbursementsPerPage;
    const end = start + pagination.disbursementsPerPage;
    const paginatedTransactions = filteredTransactions.slice(start, end);
    const totalPages = Math.ceil(filteredTransactions.length / pagination.disbursementsPerPage);

    const pageInfo = document.getElementById('disbursementPageInfo');
    if (pageInfo) pageInfo.textContent = `Page ${totalPages > 0 ? pagination.disbursementPage : 0} of ${totalPages}`;

    const prevBtn = document.getElementById('prevDisbursementPage');
    if (prevBtn) prevBtn.disabled = pagination.disbursementPage === 1;

    const nextBtn = document.getElementById('nextDisbursementPage');
    if (nextBtn) nextBtn.disabled = pagination.disbursementPage >= totalPages;

    if (paginatedTransactions.length === 0) {
        list.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-gray-500">No transactions found.</td></tr>`;
        return;
    }

    paginatedTransactions.forEach(t => {
        const recipient = storeData.employees.find(e => e.id === t.recipientId);
        const recipientName = recipient ? `${recipient.name} (${recipient.designation})` : 'Unknown/Batch';
        const typeBadge = t.type === 'return' ?
            '<span class="badge badge-warning">Return</span>' :
            '<span class="badge badge-primary">Disbursement</span>';

        const row = list.insertRow();
        row.className = 'table-row';
        row.innerHTML = `
            <td class="px-4 py-3 text-xs font-mono">${t.id.substring(0, 6)}...</td>
            <td class="px-4 py-3 text-xs">${formatDate(t.timestamp || t.date)}</td>
            <td class="px-4 py-3 table-cell">${recipientName}</td>
            <td class="px-4 py-3">${typeBadge}</td>
            <td class="px-4 py-3">${t.totalItems}</td>
            <td class="px-4 py-3">
                <button onclick="viewTransactionSlip('${t.id}', '${t.type}')" class="compact-button skeuo-btn btn-outline-v8 mr-1">
                    <i class="fas fa-eye text-blue-500"></i>
                </button>
                <button onclick="deleteTransaction('${t.id}', '${t.type}')" class="compact-button skeuo-btn btn-danger" ${currentUserRole === 'Admin' ? '' : 'style="display:none"'}>
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
    });
}

export async function recordDisbursement(event) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Permission denied.');
    event.preventDefault();
    const recipientId = document.getElementById('disbursementRecipient')?.value;
    if (!recipientId) return showMessageModal("Error", "Please select a recipient.");
    const recipient = storeData.employees.find(e => e.id === recipientId);
    const rows = document.querySelectorAll('#disbursementItemsContainer .disbursement-item-row');
    if (rows.length === 0) return showMessageModal("Error", "Please add at least one item.");

    const items = [];
    let totalQty = 0;
    for (const row of rows) {
        const itemId = row.querySelector('.item-select')?.value;
        const qty = parseInt(row.querySelector('.quantity-input')?.value, 10);
        if (!itemId || !qty || qty <= 0) return showMessageModal("Error", "Each item must have a valid selection and quantity.");
        const invItem = storeData.inventory.find(i => i.id === itemId);
        if (!invItem || invItem.quantity < qty) return showMessageModal("Error", `Not enough stock for "${invItem?.name || 'unknown'}".`);
        items.push({ id: itemId, name: invItem.name, quantity: qty });
        totalQty += qty;
    }

    const updatedInv = [...storeData.inventory];
    items.forEach(item => {
        const idx = updatedInv.findIndex(i => i.id === item.id);
        if (idx !== -1) updatedInv[idx] = { ...updatedInv[idx], quantity: updatedInv[idx].quantity - item.quantity };
    });

    const record = {
        id: generateId(), recipientId, recipientName: recipient?.name || 'Unknown',
        items, totalItems: totalQty, timestamp: new Date().toISOString()
    };

    try {
        items.forEach(item => {
            const invIdx = updatedInv.findIndex(i => i.id === item.id);
            if (invIdx !== -1) trackUpdate('inventory', updatedInv[invIdx]);
        });
        trackAddition('disbursements', record);

        await saveStoreData({ inventory: updatedInv, disbursements: [...(storeData.disbursements || []), record] });
        await logAuditAction('DISBURSEMENT', `Disbursed ${totalQty} items to ${recipient?.name}`, { items });
        hideModal('disbursementModal');
        showMessageModal("Success", `Disbursed ${totalQty} items to ${recipient?.name}.`);
    } catch (e) {
        showMessageModal("Error", "Failed to record disbursement.");
    }
}

export async function recordReturn(event) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Permission denied.');
    event.preventDefault();
    const recipientId = document.getElementById('returnRecipient')?.value;
    if (!recipientId) return showMessageModal("Error", "Please select who is returning.");
    const recipient = storeData.employees.find(e => e.id === recipientId);
    const rows = document.querySelectorAll('#returnItemsContainer .return-item-row');
    if (rows.length === 0) return showMessageModal("Error", "Please add at least one item.");

    const items = [];
    let totalQty = 0;
    for (const row of rows) {
        const itemId = row.querySelector('.item-select')?.value;
        const qty = parseInt(row.querySelector('.quantity-input')?.value, 10);
        if (!itemId || !qty || qty <= 0) return showMessageModal("Error", "Each item must have a valid selection and quantity.");
        const invItem = storeData.inventory.find(i => i.id === itemId);
        items.push({ id: itemId, name: invItem?.name || 'Unknown', quantity: qty });
        totalQty += qty;
    }

    const updatedInv = [...storeData.inventory];
    items.forEach(item => {
        const idx = updatedInv.findIndex(i => i.id === item.id);
        if (idx !== -1) updatedInv[idx] = { ...updatedInv[idx], quantity: updatedInv[idx].quantity + item.quantity };
    });

    const record = {
        id: generateId(), recipientId, recipientName: recipient?.name || 'Unknown',
        items, totalItems: totalQty, timestamp: new Date().toISOString()
    };

    try {
        items.forEach(item => {
            const invIdx = updatedInv.findIndex(i => i.id === item.id);
            if (invIdx !== -1) trackUpdate('inventory', updatedInv[invIdx]);
        });
        trackAddition('returns', record);

        await saveStoreData({ inventory: updatedInv, returns: [...(storeData.returns || []), record] });
        await logAuditAction('RETURN', `Returned ${totalQty} items from ${recipient?.name}`, { items });
        hideModal('returnModal');
        showMessageModal("Success", `Returned ${totalQty} items from ${recipient?.name}.`);
    } catch (e) {
        showMessageModal("Error", "Failed to record return.");
    }
}

export function addReturnItemRow() {
    const container = document.getElementById('returnItemsContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'flex space-x-3 return-item-row';
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

export function addBatchDisbursementItemRow() {
    const container = document.getElementById('batchDisbursementItemsContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'flex space-x-3 batch-item-row';
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
        <input type="number" class="quantity-input w-24 form-input" placeholder="Qty per person" min="1" required>
        <button type="button" onclick="this.parentNode.remove()" class="compact-button skeuo-btn btn-danger">
            <i class="fas fa-times"></i>
        </button>
    `;
    container.appendChild(row);
    initializeSearchableDropdowns();
}

export function filterBatchRecipientsByDesignation() {
    const filter = document.getElementById('batchDesignationFilter')?.value;
    const list = document.getElementById('batchRecipientList');
    if (!list) return;
    const emps = storeData.employees || [];
    const filtered = filter ? emps.filter(e => e.designation === filter) : emps;
    list.innerHTML = filtered.map(e => `<option value="${e.id}">${e.name} (${e.designation})</option>`).join('');
}

export async function clearDisbursementFilters() {
    const search = document.getElementById('disbursementSearch');
    const filter = document.getElementById('disbursementTypeFilter');
    if (search) search.value = '';
    if (filter) filter.value = '';
    renderDisbursements();
}

export async function deleteTransaction(id, type) {
    if (currentUserRole !== 'Admin') return showMessageModal('Denied', 'Only Admin can delete transactions.');

    showConfirmationModal("Delete Transaction", "Are you sure? This will permanently delete the transaction AND revert the stock changes automatically.", async () => {
        const isDisbursement = type === 'disbursement';
        const updatedInv = [...storeData.inventory];

        let targetList = isDisbursement ? (storeData.disbursements || []) : (storeData.returns || []);
        const transactionIndex = targetList.findIndex(t => t.id === id);

        if (transactionIndex === -1) return showMessageModal("Error", "Transaction not found.");

        const transaction = targetList[transactionIndex];

        // Revert stock automatically
        transaction.items.forEach(item => {
            const invIndex = updatedInv.findIndex(i => i.id === item.id || i.id === item.itemId);
            if (invIndex !== -1) {
                updatedInv[invIndex] = {
                    ...updatedInv[invIndex],
                    quantity: updatedInv[invIndex].quantity + (isDisbursement ? item.quantity : -item.quantity)
                };
            }
        });

        const updatedList = targetList.filter(t => t.id !== id);

        try {
            trackDeletion(isDisbursement ? 'disbursements' : 'returns', id);
            transaction.items.forEach(item => {
                const invIdx = updatedInv.findIndex(i => i.id === item.id || i.id === item.itemId);
                if (invIdx !== -1) trackUpdate('inventory', updatedInv[invIdx]);
            });

            if (isDisbursement) {
                await saveStoreData({ inventory: updatedInv, disbursements: updatedList });
            } else {
                await saveStoreData({ inventory: updatedInv, returns: updatedList });
            }
            await logAuditAction('TRANSACTION_DELETED', `Deleted ${type} record (${id}) and reverted stock.`);
            showMessageModal("Success", `Transaction deleted and ${transaction.items.length} items' stock reverted.`);
            renderDisbursements();
        } catch (e) {
            console.error("Deletion failed", e);
            showMessageModal("Error", "Failed to delete transaction and revert stock.");
        }
    });
}

export async function recordBatchDisbursement(event) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Permission denied.');
    if (event) event.preventDefault();

    const recipientSelect = document.getElementById('batchRecipientList');
    if (!recipientSelect) return;
    const recipientIds = Array.from(recipientSelect.selectedOptions).map(opt => opt.value);

    if (recipientIds.length === 0) return showMessageModal("Error", "Please select at least one recipient.");

    const itemsContainer = document.getElementById('batchDisbursementItemsContainer');
    const itemRows = itemsContainer.querySelectorAll('.batch-item-row');
    if (itemRows.length === 0) return showMessageModal("Error", "Please add at least one item.");

    let itemTemplates = [];
    let inventoryUpdates = {};
    let totalItemsPerRecipient = 0;

    for (const row of itemRows) {
        const itemId = row.querySelector('.item-select')?.value;
        const quantity = parseInt(row.querySelector('.quantity-input')?.value, 10);

        if (!itemId || !quantity || quantity <= 0) continue;

        const item = storeData.inventory.find(i => i.id === itemId);
        if (!item) continue;

        const totalStockNeeded = quantity * recipientIds.length;
        if (item.quantity < totalStockNeeded) {
            return showMessageModal("Error", `Insufficient stock for "${item.name}". Available: ${item.quantity}, Required for batch (${recipientIds.length} users): ${totalStockNeeded}`);
        }

        itemTemplates.push({ id: itemId, name: item.name, quantity });
        inventoryUpdates[itemId] = (inventoryUpdates[itemId] || 0) + totalStockNeeded;
        totalItemsPerRecipient += quantity;
    }

    if (itemTemplates.length === 0) return showMessageModal("Error", "No valid items specified.");

    showConfirmationModal("Confirm Batch", `Disburse a total of ${totalItemsPerRecipient * recipientIds.length} items across ${recipientIds.length} recipients?`, async () => {
        const updatedInv = [...storeData.inventory];
        const currentDisbursements = storeData.disbursements || [];
        const newBatchRecords = [];

        // Process stock deduction
        for (const [id, totalUsed] of Object.entries(inventoryUpdates)) {
            const idx = updatedInv.findIndex(i => i.id === id);
            if (idx !== -1) updatedInv[idx].quantity -= totalUsed;
        }

        // Generate independent records
        recipientIds.forEach(recipientId => {
            const recipient = storeData.employees.find(e => e.id === recipientId);
            const record = {
                id: generateId(),
                recipientId,
                recipientName: recipient?.name || 'Unknown',
                items: JSON.parse(JSON.stringify(itemTemplates)),
                totalItems: totalItemsPerRecipient,
                timestamp: new Date().toISOString()
            };
            newBatchRecords.push(record);
        });

        try {
            // Track deltas
            Object.keys(inventoryUpdates).forEach(itemId => {
                const item = updatedInv.find(i => i.id === itemId);
                if (item) trackUpdate('inventory', item);
            });
            newBatchRecords.forEach(d => trackAddition('disbursements', d));

            await saveStoreData({ inventory: updatedInv, disbursements: [...currentDisbursements, ...newBatchRecords] });
            await logAuditAction('BATCH_DISBURSEMENT', `Batch disbursed to ${recipientIds.length} employees`);
            hideModal('batchDisbursementModal');
            showMessageModal("Success", "Batch disbursement recorded.");
        } catch (e) {
            console.error("Batch failed", e);
            showMessageModal("Error", "Failed to record batch.");
        }
    });
}
