import { supabase } from '../core/supabase.js';
import { currentUserRole } from '../core/state.js';
import { showMessageModal, showConfirmationModal } from '../utils/helpers.js';

export async function fetchUsers() {
    try {
        const { data, error } = await supabase
            .from('user_roles')
            .select('*')
            .order('email');
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error("Error fetching users:", err);
        return [];
    }
}

export async function renderUserManagement() {
    const listBody = document.getElementById('userList');
    if (!listBody) return;

    listBody.innerHTML = '<tr><td colspan="3" class="px-6 py-4 text-center text-sm text-slate-500"><i class="fas fa-spinner fa-spin mr-2"></i>Loading users...</td></tr>';

    const users = await fetchUsers();
    listBody.innerHTML = '';

    if (users.length === 0) {
        listBody.innerHTML = '<tr><td colspan="3" class="px-6 py-4 text-center text-sm text-slate-500">No users found.</td></tr>';
        return;
    }

    users.forEach(user => {
        const row = listBody.insertRow();
        row.className = "hover:bg-slate-50/50 transition-colors";

        const currentUserEmail = supabase.auth.user?.()?.email;
        const isSelf = user.email.toLowerCase() === currentUserEmail?.toLowerCase();
        
        let roleOptions = ['Admin', 'Manager', 'Storekeeper', 'Restricted']
            .map(r => `<option value="${r}" ${user.role === r ? 'selected' : ''}>${r}</option>`)
            .join('');

        const canManage = currentUserRole === 'Admin' || (currentUserRole === 'Manager' && user.role !== 'Admin');

        const roleSelect = canManage && !isSelf
            ? `<select onchange="updateUserRole('${user.email}', this.value)" class="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-500">
                ${roleOptions}
               </select>`
            : `<span class="px-2 py-1 bg-slate-100 rounded-lg text-xs font-bold text-slate-650">${user.role}</span>`;

        const deleteBtn = canManage && !isSelf
            ? `<button onclick="deleteUserConfirmation('${user.email}')" class="compact-button btn-danger px-3 py-1 text-xs font-bold" title="Remove Role">
                <i class="fas fa-user-minus mr-1"></i> Remove
               </button>`
            : (isSelf ? `<span class="text-xs text-slate-400 font-medium italic">You</span>` : '');

        row.innerHTML = `
            <td class="px-6 py-4 table-cell font-medium text-slate-700">${user.email}</td>
            <td class="px-6 py-4 table-cell">${roleSelect}</td>
            <td class="px-6 py-4 table-cell text-right">${deleteBtn}</td>
        `;
    });
}

export async function addUser(event) {
    event.preventDefault();
    const form = event.target;
    const email = form.addUserEmail.value.trim().toLowerCase();
    const role = form.addUserRole.value;

    if (!email || !role) {
        return showMessageModal("Error", "All fields are required.");
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Adding...';

    try {
        // Option 2: Directly assign role mapping. Account must be manually created in Supabase Auth first.
        const { error } = await supabase
            .from('user_roles')
            .upsert({ email, role }, { onConflict: 'email' });

        if (error) throw error;

        showMessageModal("Success", `Assigned role "${role}" to ${email}.`);
        form.reset();
        window.hideModal('addUserModal');
        await renderUserManagement();
    } catch (err) {
        console.error("Assign role failed:", err);
        showMessageModal("Error", err.message || "Failed to assign role.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

export async function updateUserRole(email, newRole) {
    try {
        const { error } = await supabase
            .from('user_roles')
            .update({ role: newRole })
            .eq('email', email);

        if (error) throw error;

        showMessageModal("Success", `Role updated to ${newRole} for ${email}.`);
        await renderUserManagement();
    } catch (err) {
        console.error("Role update failed:", err);
        showMessageModal("Error", err.message || "Failed to update role.");
    }
}

export function deleteUserConfirmation(email) {
    showConfirmationModal(
        "Remove User Role",
        `Are you sure you want to remove the role for ${email}? They will immediately be set to Restricted access.`,
        async () => {
            try {
                // Option 2: Simply delete their role row from public.user_roles
                const { error } = await supabase
                    .from('user_roles')
                    .delete()
                    .eq('email', email);
                
                if (error) throw error;

                showMessageModal("Success", `Role removed for ${email}.`);
                await renderUserManagement();
            } catch (err) {
                console.error("Role removal failed:", err);
                showMessageModal("Error", err.message || "Failed to remove role.");
            }
        }
    );
}

// Expose functions globally for HTML compatibility
window.addUser = addUser;
window.updateUserRole = updateUserRole;
window.deleteUserConfirmation = deleteUserConfirmation;
window.showAddUserModal = () => {
    const modal = document.getElementById('addUserModal');
    if (modal) modal.classList.remove('hidden');
};
