import { storeData, currentUserRole, pagination, trackAddition, trackUpdate, trackDeletion } from '../core/state.js';
import { formatDate } from '../utils/formatters.js';
import { showMessageModal, showConfirmationModal, generateId, hideModal } from '../utils/helpers.js';
import { renderUI } from './render.js';
import { showItemDetailsModal } from './modals.js';
import { saveStoreData, logAuditAction } from '../main.js';

export function renderInventory() {
    const inventory = storeData.inventory || [];
    const list = document.getElementById('inventoryList');
    if (!list) return;

    list.innerHTML = '';

    let filteredInventory = [...inventory];
    const searchTerm = document.getElementById('inventorySearch')?.value.toLowerCase() || '';
    const stockFilter = document.getElementById('inventoryStockFilter')?.value || '';

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

    const start = (pagination.inventoryPage - 1) * pagination.inventoryPerPage;
    const end = start + pagination.inventoryPerPage;
    const paginatedInventory = filteredInventory.slice(start, end);
    const totalPages = Math.ceil(filteredInventory.length / pagination.inventoryPerPage);

    const pageInfo = document.getElementById('inventoryPageInfo');
    if (pageInfo) pageInfo.textContent = `Page ${totalPages > 0 ? pagination.inventoryPage : 0} of ${totalPages}`;

    const prevBtn = document.getElementById('prevInventoryPage');
    if (prevBtn) prevBtn.disabled = pagination.inventoryPage === 1;

    const nextBtn = document.getElementById('nextInventoryPage');
    if (nextBtn) nextBtn.disabled = pagination.inventoryPage >= totalPages;

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
                <button onclick="viewSupplySlip('${item.id}')" class="compact-button skeuo-btn btn-outline-v8 mr-1">
                    <i class="fas fa-eye text-blue-500"></i>
                </button>
                <button class="compact-button skeuo-btn btn-outline-v8 mr-1 edit-item-btn" data-id="${item.id}" ${(currentUserRole === 'Admin' || currentUserRole === 'Manager') ? '' : 'style="display:none"'}>
                    <i class="fas fa-edit text-amber-500"></i>
                </button>
            </td>
        `;
    });

    document.querySelectorAll('.inventory-checkbox').forEach(cb => {
        cb.onchange = updateBatchDeleteButton;
    });

    document.querySelectorAll('.edit-item-btn').forEach(btn => {
        btn.onclick = () => showItemDetailsModal(btn.dataset.id);
    });

    updateBatchDeleteButton();
}

export function updateBatchDeleteButton() {
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

export function changeInventoryPage(delta) {
    const totalPages = Math.ceil(storeData.inventory.length / pagination.inventoryPerPage);
    const newPage = pagination.inventoryPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        pagination.inventoryPage = newPage;
        renderInventory();
    }
}

export async function addItem(event) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager' && currentUserRole !== 'Storekeeper') return showMessageModal('Denied', 'Permission denied.');
    event.preventDefault();
    const form = event.target;
    const name = form.itemName.value.trim();
    const specification = form.itemSpecification.value.trim();
    const quantity = parseInt(form.itemQuantity.value, 10);
    const tenderId = form.tenderId?.value?.trim();

    if (quantity <= 0) return showMessageModal("Error", "Quantity must be greater than zero.");
    if (storeData.inventory.find(i => i.name.toLowerCase() === name.toLowerCase()))
        return showMessageModal("Error", `An item named "${name}" already exists.`);

    const newItem = {
        id: generateId(), name, specification, quantity,
        lastResupplyDate: new Date().toISOString().split('T')[0], latestTenderId: tenderId || null
    };

    try {
        trackAddition('inventory', newItem);
        await saveStoreData({ inventory: [...storeData.inventory, newItem] });
        await logAuditAction('ITEM_ADDED', `Added: ${name} (${quantity} units)`, { itemId: newItem.id, quantity });
        form.reset();
        hideModal('addItemCard');
        showMessageModal("Success", `Item "${name}" added.`);
    } catch (e) {
        console.error("Add item failed:", e);
        showMessageModal("Error", "Failed to add item.");
    }
}

export async function resupplyItem(event) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager' && currentUserRole !== 'Storekeeper') return showMessageModal('Denied', 'Permission denied.');
    event.preventDefault();
    const form = event.target;
    const itemId = form.resupplyItemSelect.value;
    const quantity = parseInt(form.resupplyQuantity.value, 10);
    const tenderId = form.resupplyTenderId?.value?.trim();

    if (!itemId) return showMessageModal("Error", "Please select an item.");
    if (quantity <= 0) return showMessageModal("Error", "Quantity must be greater than zero.");

    const idx = storeData.inventory.findIndex(i => i.id === itemId);
    if (idx === -1) return showMessageModal("Error", "Item not found.");

    const updated = [...storeData.inventory];
    updated[idx] = {
        ...updated[idx], quantity: updated[idx].quantity + quantity,
        lastResupplyDate: new Date().toISOString().split('T')[0], latestTenderId: tenderId || updated[idx].latestTenderId
    };

    const resupplyLog = {
        id: generateId(), itemId, itemName: updated[idx].name,
        quantity, tenderId: tenderId || null, date: new Date().toISOString(), type: "Resupply"
    };

    try {
        trackUpdate('inventory', updated[idx]);
        trackAddition('resupplies', resupplyLog); // Log the resupply event too
        await saveStoreData({ inventory: updated, resupplies: [...(storeData.resupplies || []), resupplyLog] });
        await logAuditAction('ITEM_RESUPPLIED', `Resupplied ${updated[idx].name}: +${quantity}`, { itemId, quantity });
        form.reset();
        hideModal('resupplyCard');
        showMessageModal("Success", `Resupplied ${quantity} units.`);
    } catch (e) {
        console.error("Resupply failed:", e);
        showMessageModal("Error", "Failed to record resupply.");
    }
}

export async function editItem(event) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Only Admin and Manager can edit.');
    event.preventDefault();
    const form = event.target;
    const itemId = form.editItemId.value;
    const newName = form.editItemName.value.trim();
    const newSpec = form.editItemSpec.value.trim();
    const idx = storeData.inventory.findIndex(i => i.id === itemId);
    if (idx === -1) return showMessageModal("Error", "Item not found.");
    if (storeData.inventory.find(i => i.id !== itemId && i.name.toLowerCase() === newName.toLowerCase()))
        return showMessageModal("Error", `Item "${newName}" already exists.`);

    const updated = [...storeData.inventory];
    updated[idx] = { ...updated[idx], name: newName, specification: newSpec };

    try {
        trackUpdate('inventory', updated[idx]);
        await saveStoreData({ inventory: updated });
        await logAuditAction('ITEM_EDITED', `Edited: ${newName}`, { itemId });
        hideModal('itemDetailsModal');
        showMessageModal("Success", `Item "${newName}" updated.`);
    } catch (e) {
        showMessageModal("Error", "Failed to update item.");
    }
}

export function deleteItemConfirmation() {
    const itemId = document.getElementById('editItemId')?.value;
    if (!itemId) return;
    showConfirmationModal("Delete Item", "Are you sure? This cannot be undone.", () => deleteItem(itemId));
}

export async function deleteItem(itemId) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Only Admin and Manager can delete items.');
    const item = storeData.inventory.find(i => i.id === itemId);
    const updated = storeData.inventory.filter(i => i.id !== itemId);

    try {
        trackDeletion('inventory', itemId);
        await saveStoreData({ inventory: updated });
        await logAuditAction('ITEM_DELETED', `Deleted: ${item?.name || itemId}`, { itemId });
        hideModal('itemDetailsModal');
        showMessageModal("Success", "Item deleted.");
    } catch (e) {
        showMessageModal("Error", "Failed to delete item.");
    }
}

export function deleteSelectedInventoryItems() {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Only Admin and Manager can delete items.');
    const checked = document.querySelectorAll('.inventory-checkbox:checked');
    if (checked.length === 0) return showMessageModal("No Selection", "Please select items to delete.");

    showConfirmationModal("Delete Items", `Delete ${checked.length} selected items?`, async () => {
        const ids = Array.from(checked).map(cb => cb.dataset.id);
        const updated = storeData.inventory.filter(i => !ids.includes(i.id));

        try {
            ids.forEach(id => trackDeletion('inventory', id));
            await saveStoreData({ inventory: updated });
            await logAuditAction('BATCH_DELETE', `Deleted ${ids.length} items from inventory`);
            showMessageModal("Success", `${ids.length} items deleted.`);
            renderInventory(); // Refresh view
        } catch (e) {
            showMessageModal("Error", "Failed to delete items.");
        }
    });
}
