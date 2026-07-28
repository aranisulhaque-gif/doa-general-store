/**
 * Generates a simplified ID
 */
export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

/**
 * Displays a generic message modal.
 */
export function showMessageModal(title, message) {
    document.getElementById('messageTitle').textContent = title;
    document.getElementById('messageContent').textContent = message;
    document.getElementById('messageModal').classList.remove('hidden');
}

/**
 * Displays a generic confirmation modal.
 */
export function showConfirmationModal(title, message, callback) {
    document.getElementById('confirmationTitle').textContent = title;
    document.getElementById('confirmationMessage').textContent = message;

    const confirmButton = document.getElementById('confirmActionButton');
    confirmButton.onclick = () => {
        hideModal('confirmationModal');
        callback();
    };

    document.getElementById('confirmationModal').classList.remove('hidden');
}

/**
 * Hides any modal.
 */
export function hideModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('hidden');
}

export function togglePasswordVisibility() {
    const passwordInput = document.getElementById('password');
    const toggleIcon = document.getElementById('passwordToggleIcon');

    if (passwordInput && toggleIcon) {
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            toggleIcon.classList.remove('fa-eye');
            toggleIcon.classList.add('fa-eye-slash');
        } else {
            passwordInput.type = 'password';
            toggleIcon.classList.remove('fa-eye-slash');
            toggleIcon.classList.add('fa-eye');
        }
    }
}
