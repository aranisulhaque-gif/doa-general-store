import { supabase } from '../core/supabase.js';
import { showMessageModal } from '../utils/helpers.js';
import { currentUserRole } from '../core/state.js';

let originalRoles = {};  // { email: role } — snapshot at load time
let pendingChanges = {}; // { email: newRole } — unsaved changes

export async function renderUserManagement() {
    if (currentUserRole !== 'Admin') return;

    const container = document.getElementById('userRolesList');
    if (!container) return;

    container.innerHTML = `
        <tr>
            <td colspan="3" class="text-center py-10 text-slate-400">
                <i class="fas fa-spinner fa-spin mr-2"></i>Loading users…
            </td>
        </tr>`;

    const { data, error } = await supabase
        .from('user_roles')
        .select('email, role')
        .order('email');

    if (error) {
        container.innerHTML = `
            <tr>
                <td colspan="3" class="text-center py-10 text-red-400">
                    <i class="fas fa-exclamation-triangle mr-2"></i>${error.message}
                </td>
            </tr>`;
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="3" class="text-center py-10 text-slate-400">
                    No users found in the roles table.
                </td>
            </tr>`;
        return;
    }

    // Snapshot originals and reset pending changes
    originalRoles = {};
    data.forEach(u => { originalRoles[u.email] = u.role; });
    pendingChanges = {};
    updateActionBar();

    const roleIcon = { Admin: '👑', Manager: '👔', Storekeeper: '📦' };

    container.innerHTML = data.map(u => `
        <tr class="table-row">
            <td class="px-6 py-4 text-sm text-slate-700 font-medium">${u.email}</td>
            <td class="px-6 py-4">
                <select
                    class="text-sm border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-slate-700 outline-none focus:border-violet-400 transition-all cursor-pointer"
                    data-email="${u.email}"
                    onchange="onRoleDropdownChange(this)">
                    <option value="Admin"       ${u.role === 'Admin'       ? 'selected' : ''}>👑 Admin</option>
                    <option value="Manager"     ${u.role === 'Manager'     ? 'selected' : ''}>👔 Manager</option>
                    <option value="Storekeeper" ${u.role === 'Storekeeper' ? 'selected' : ''}>📦 Storekeeper</option>
                </select>
            </td>
            <td class="px-6 py-4 text-center">
                <span class="text-xs text-slate-400" data-badge-email="${u.email}">—</span>
            </td>
        </tr>
    `).join('');
}

function updateActionBar() {
    const bar = document.getElementById('userRolesActionBar');
    if (!bar) return;
    const count = Object.keys(pendingChanges).length;
    if (count > 0) {
        bar.classList.remove('hidden');
        const label = document.getElementById('pendingChangesCount');
        if (label) label.textContent = `${count} unsaved change${count > 1 ? 's' : ''}`;
    } else {
        bar.classList.add('hidden');
    }
}

window.onRoleDropdownChange = function (selectEl) {
    const email = selectEl.dataset.email;
    const newRole = selectEl.value;
    const originalRole = originalRoles[email];
    const badge = document.querySelector(`[data-badge-email="${email}"]`);

    if (newRole !== originalRole) {
        pendingChanges[email] = newRole;
        if (badge) {
            badge.textContent = `${originalRole} → ${newRole}`;
            badge.className = 'text-xs font-semibold text-amber-500';
        }
    } else {
        delete pendingChanges[email];
        if (badge) {
            badge.textContent = '—';
            badge.className = 'text-xs text-slate-400';
        }
    }
    updateActionBar();
};

window.saveRoleChanges = async function () {
    const entries = Object.entries(pendingChanges);
    if (entries.length === 0) return;

    const upsertData = entries.map(([email, role]) => ({ email, role }));

    const { error } = await supabase
        .from('user_roles')
        .upsert(upsertData, { onConflict: 'email' });

    if (error) {
        showMessageModal('❌ Save Failed', `Could not save changes: ${error.message}`);
        return;
    }

    showMessageModal(
        '✅ Roles Saved',
        `Successfully updated ${entries.length} user role${entries.length > 1 ? 's' : ''}.`
    );
    await renderUserManagement();
};

window.revertRoleChanges = function () {
    Object.keys(pendingChanges).forEach(email => {
        const dropdown = document.querySelector(`select[data-email="${email}"]`);
        if (dropdown) dropdown.value = originalRoles[email];
        const badge = document.querySelector(`[data-badge-email="${email}"]`);
        if (badge) {
            badge.textContent = '—';
            badge.className = 'text-xs text-slate-400';
        }
    });
    pendingChanges = {};
    updateActionBar();
    showMessageModal('↩️ Reverted', 'All unsaved changes have been reverted.');
};
