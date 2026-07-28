/**
 * Formats a date string or Date object into dd/mm/yyyy format.
 */
export function formatDate(date) {
    if (!date) return 'N/A';
    let d;
    if (date instanceof Date) {
        d = date;
    } else if (typeof date === 'string' || typeof date === 'number') {
        d = new Date(date);
    } else {
        return 'Invalid Date';
    }

    if (isNaN(d.getTime())) return 'Invalid Date';

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

/**
 * Formats a date and time string or Date object into dd/mm/yyyy hh:mm format.
 */
export function formatDateTime(date) {
    if (!date) return 'N/A';
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'Invalid Date';

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');

    return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/**
 * Converts dd/mm/yyyy to yyyy-mm-dd for input fields
 */
export function formatDateForInput(dateStr) {
    if (!dateStr || dateStr === 'N/A') return '';
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
}
