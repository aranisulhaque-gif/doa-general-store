import { createClient } from '@supabase/supabase-js';
import { supabase } from '../core/supabase.js';
import { currentUserRole } from '../core/state.js';
import { showMessageModal, showConfirmationModal } from '../utils/helpers.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Temporary non-persisted client for adding users without disrupting current manager session
const tempSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
    }
});

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

        const isSelf = user.email.toLowerCase() === supabase.auth.user?.()?.email?.toLowerCase();
        
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
            ? `<button onclick="deleteUserConfirmation('${user.email}')" class="compact-button btn-danger px-3 py-1 text-xs font-bold" title="Delete User">
                <i class="fas fa-trash mr-1"></i> Delete
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
    const password = form.addUserPassword.value;
    const role = form.addUserRole.value;

    if (!email || !password || !role) {
        return showMessageModal("Error", "All fields are required.");
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Adding...';

    try {
        // 1. Create the user credentials via standard signUp on temp client
        const { data: signUpData, error: signUpError } = await tempSupabase.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    auto_confirm: true // hint for auto-confirm systems
                }
            }
        });

        if (signUpError) throw signUpError;

        // 2. Map their role in public.user_roles
        const { error: roleError } = await supabase
            .from('user_roles')
            .insert({ email, role });

        if (roleError) throw roleError;

        showMessageModal("Success", `User ${email} created successfully.`);
        form.reset();
        window.hideModal('addUserModal');
        await renderUserManagement();
    } catch (err) {
        console.error("Add user failed:", err);
        showMessageModal("Error", err.message || "Failed to create user.");
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
        "Delete User Account",
        `Are you sure you want to delete ${email}? This will permanently remove their credentials and database privileges.`,
        async () => {
            try {
                // Call secure RPC function
                const { data, error } = await supabase.rpc('delete_user_by_email', { target_email: email });
                
                if (error) throw error;

                showMessageModal("Success", `User ${email} has been deleted.`);
                await renderUserManagement();
            } catch (err) {
                console.error("Deletion failed:", err);
                showMessageModal("Error", err.message || "Failed to delete user.");
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
