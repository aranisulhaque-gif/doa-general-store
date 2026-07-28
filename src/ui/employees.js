import { storeData, currentUserRole, pagination, trackAddition, trackUpdate, trackDeletion } from '../core/state.js';
import { formatDate } from '../utils/formatters.js';
import { showMessageModal, showConfirmationModal, generateId, hideModal } from '../utils/helpers.js';
import { renderUI } from './render.js';
import { showEmployeeDetailsModal } from './modals.js';
import { saveStoreData, logAuditAction } from '../main.js';

export function renderEmployees() {
    const employees = storeData.employees || [];
    const list = document.getElementById('employeeList');
    if (!list) return;

    list.innerHTML = '';

    let filteredEmployees = [...employees];
    const searchTerm = document.getElementById('employeeSearch')?.value.toLowerCase() || '';
    const designationFilter = document.getElementById('employeeDesignationFilter')?.value || '';

    if (searchTerm) {
        filteredEmployees = filteredEmployees.filter(emp => emp.name.toLowerCase().includes(searchTerm));
    }
    if (designationFilter) {
        filteredEmployees = filteredEmployees.filter(emp => emp.designation === designationFilter);
    }

    const start = (pagination.employeePage - 1) * pagination.employeesPerPage;
    const end = start + pagination.employeesPerPage;
    const paginatedEmployees = filteredEmployees.slice(start, end);
    const totalPages = Math.ceil(filteredEmployees.length / pagination.employeesPerPage);

    const pageInfo = document.getElementById('employeePageInfo');
    if (pageInfo) pageInfo.textContent = `Page ${totalPages > 0 ? pagination.employeePage : 0} of ${totalPages}`;

    if (paginatedEmployees.length === 0) {
        list.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-gray-500">No employees found.</td></tr>`;
        return;
    }

    paginatedEmployees.forEach(emp => {
        const row = list.insertRow();
        row.className = 'table-row';
        row.innerHTML = `
            <td class="px-4 py-3 text-xs font-mono">${emp.id.substring(0, 6)}...</td>
            <td class="px-4 py-3">${emp.name}</td>
            <td class="px-4 py-3">${emp.designation}</td>
            <td class="px-4 py-3 table-cell text-xs">N/A</td>
            <td class="px-4 py-3">
                <button class="compact-button skeuo-btn btn-outline mr-1 edit-emp-btn" data-id="${emp.id}" ${currentUserRole === 'Admin' ? '' : 'style="display:none"'}>
                    <i class="fas fa-edit"></i>
                </button>
                <button class="compact-button skeuo-btn btn-danger delete-emp-btn" data-id="${emp.id}" ${currentUserRole === 'Admin' ? '' : 'style="display:none"'}>
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
    });

    document.querySelectorAll('.edit-emp-btn').forEach(btn => {
        btn.onclick = () => showEmployeeDetailsModal(btn.dataset.id);
    });

    document.querySelectorAll('.delete-emp-btn').forEach(btn => {
        btn.onclick = () => {
            const empId = btn.dataset.id;
            const emp = employees.find(e => e.id === empId);
            showConfirmationModal(
                "Delete Employee",
                `Are you sure you want to delete ${emp ? emp.name : 'this employee'}?`,
                () => deleteEmployee(empId)
            );
        };
    });
}

export async function addEmployee(event) {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return showMessageModal('Denied', 'Permission denied.');
    event.preventDefault();
    const form = event.target;
    const name = form.employeeName.value.trim();
    const designation = form.employeeDesignation.value;

    if (storeData.employees.find(e => e.name.toLowerCase() === name.toLowerCase()))
        return showMessageModal("Error", `Employee "${name}" already exists.`);

    const newEmp = { id: generateId(), name, designation };

    try {
        trackAddition('employees', newEmp);
        await saveStoreData({ employees: [...storeData.employees, newEmp] });
        await logAuditAction('EMPLOYEE_ADDED', `Added: ${name} (${designation})`, { employeeId: newEmp.id });
        form.reset();
        hideModal('addEmployeeCard');
        showMessageModal("Success", `Employee "${name}" added.`);
    } catch (e) {
        showMessageModal("Error", "Failed to add employee.");
    }
}

export async function editEmployee(event) {
    if (currentUserRole !== 'Admin') return showMessageModal('Denied', 'Only Admin can edit.');
    event.preventDefault();
    const form = event.target;
    const empId = form.editEmployeeId.value;
    const newName = form.editEmployeeName.value.trim();
    const newDesignation = form.editEmployeeDesignation.value;
    const idx = storeData.employees.findIndex(e => e.id === empId);
    if (idx === -1) return showMessageModal("Error", "Employee not found.");

    const updated = [...storeData.employees];
    updated[idx] = { ...updated[idx], name: newName, designation: newDesignation };

    try {
        trackUpdate('employees', updated[idx]);
        await saveStoreData({ employees: updated });
        await logAuditAction('EMPLOYEE_EDITED', `Edited: ${newName}`, { empId });
        hideModal('employeeDetailsModal');
        showMessageModal("Success", `Employee "${newName}" updated.`);
    } catch (e) {
        showMessageModal("Error", "Failed to update employee.");
    }
}

export function deleteEmployeeConfirmation() {
    const empId = document.getElementById('editEmployeeId')?.value;
    if (!empId) return;
    showConfirmationModal("Delete Employee", "Are you sure? This cannot be undone.", () => deleteEmployee(empId));
}

export async function deleteEmployee(empId) {
    if (currentUserRole !== 'Admin') return showMessageModal('Denied', 'Only Admin can delete employees.');
    const employee = storeData.employees.find(e => e.id === empId);
    
    const idx = storeData.employees.findIndex(e => e.id === empId);
    if (idx === -1) return;
    const updated = [...storeData.employees];
    updated.splice(idx, 1);

    try {
        trackDeletion('employees', empId);
        await saveStoreData({ employees: updated });
        await logAuditAction('EMPLOYEE_DELETED', `Deleted: ${employee?.name || empId}`, { empId });
        hideModal('employeeDetailsModal');
        showMessageModal("Success", "Employee deleted.");
    } catch (e) {
        showMessageModal("Error", "Failed to delete employee.");
    }
}
