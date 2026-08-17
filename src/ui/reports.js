import { storeData, currentUserRole } from '../core/state.js';
import { formatDate, formatDateTime } from '../utils/formatters.js';
import { showMessageModal, hideModal } from '../utils/helpers.js';
import { saveStoreData } from '../main.js';

const getReportHeader = (title) => `
    <div class="print-header" style="text-align: center; margin-bottom: 25px; font-family: Arial, sans-serif; color: #000;">
        <h1 style="font-size: 18pt; margin: 0 0 5px 0; font-weight: bold; text-transform: uppercase;">Department of Architecture</h1>
        <h2 style="font-size: 14pt; margin: 0 0 5px 0; font-weight: normal;">Sthapatya Bhaban</h2>
        <p style="font-size: 11pt; margin: 0 0 15px 0; font-weight: normal;">Segunbagicha, Dhaka-1000</p>
        <h3 style="font-size: 16pt; margin: 0; text-decoration: underline; font-weight: bold;">${title}</h3>
    </div>
`;

/**
 * Enhanced print function that properly includes styles
 */
export function printReportContent(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const printContent = el.innerHTML;
    const originalTitle = document.title;

    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) return showMessageModal("Error", "Please allow popups to print.");

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${originalTitle} - Print</title>
            <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #000; background: white; }
                table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                th, td { border: 1px solid #000; padding: 8px; text-align: left; }
                th { background-color: #f0f0f0 !important; font-weight: bold; }
                .signature-section { margin-top: 40px; display: flex; justify-content: space-between; }
                .signature-box { text-align: center; width: 30%; }
                .signature-line { border-top: 1px solid #000; margin-top: 60px; padding-top: 5px; }
                .footer { margin-top: 40px; padding-top: 20px; border-top: 1px dashed #000; text-align: center; font-size: 10pt; }
                @media print { .no-print { display: none !important; } }
            </style>
        </head>
        <body>
            ${printContent}
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(() => window.close(), 500);
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

/**
 * Generates the HTML content for a transaction slip
 */
export function viewTransactionSlip(transactionId, type) {
    let transaction, slipTitle;
    if (type === 'disbursement') {
        transaction = (storeData.disbursements || []).find(d => d.id === transactionId);
        slipTitle = 'Disbursement Slip';
    } else {
        transaction = (storeData.returns || []).find(r => r.id === transactionId);
        slipTitle = 'Return Slip';
    }

    if (!transaction) return showMessageModal("Error", "Transaction record not found.");

    const recipient = (storeData.employees || []).find(e => e.id === transaction.recipientId);
    const recipientName = recipient ? recipient.name : 'Unknown Recipient';
    const recipientDesignation = recipient ? recipient.designation : 'N/A';

    let itemsTable = (transaction.items || []).map((item, index) => {
        const inventoryItem = (storeData.inventory || []).find(i => i.id === item.id);
        const itemName = inventoryItem ? inventoryItem.name : item.name;
        return `
            <tr>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${index + 1}</td>
                <td style="border: 1px solid #000; padding: 8px;">${itemName}</td>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${item.quantity}</td>
            </tr>
        `;
    }).join('');

    const totalUnits = (transaction.items || []).reduce((sum, item) => sum + item.quantity, 0);
    const currentDate = new Date();
    const nowStr = formatDateTime(currentDate.toISOString());

    const contentHTML = `
        <div class="print-preview-content" style="font-family: Arial, sans-serif; line-height: 1.4;">
            ${getReportHeader(slipTitle)}
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border: 1px solid #000;">
                <tr>
                    <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Name:</td>
                    <td style="border: 1px solid #000; padding: 8px;">${recipientName}</td>
                    <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Record ID:</td>
                    <td style="border: 1px solid #000; padding: 8px;">${transaction.id.substring(0, 8)}</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Designation:</td>
                    <td style="border: 1px solid #000; padding: 8px;">${recipientDesignation}</td>
                    <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Date:</td>
                    <td style="border: 1px solid #000; padding: 8px;">${formatDate(transaction.timestamp)}</td>
                </tr>
            </table>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; border: 1px solid #000;">
                <thead>
                    <tr>
                        <th style="border: 1px solid #000; padding: 10px; background: #f0f0f0;">SL</th>
                        <th style="border: 1px solid #000; padding: 10px; background: #f0f0f0;">Item</th>
                        <th style="border: 1px solid #000; padding: 10px; background: #f0f0f0;">Qty</th>
                    </tr>
                </thead>
                <tbody>${itemsTable}</tbody>
                <tfoot>
                    <tr>
                        <td colspan="2" style="border: 1px solid #000; padding: 10px; text-align: right; font-weight: bold;">Total Unit:</td>
                        <td style="border: 1px solid #000; padding: 10px; text-align: center; font-weight: bold;">${totalUnits}</td>
                    </tr>
                </tfoot>
            </table>
            <div class="signature-section">
                <div class="signature-box"><div class="signature-line">Recipient</div></div>
                <div class="signature-box"><div class="signature-line">Store In Charge</div></div>
                <div class="signature-box"><div class="signature-line">Officer In Charge</div></div>
            </div>
            <div class="footer">
                <p>Generated by Store Management System</p>
                <p>Generated on: ${nowStr}</p>
            </div>
        </div>
    `;

    document.getElementById('viewReportTitle').textContent = slipTitle;
    document.getElementById('viewReportContent').innerHTML = contentHTML;
    document.getElementById('viewReportModal').classList.remove('hidden');
}

export function viewSupplySlip(itemId) {
    const item = (storeData.inventory || []).find(i => i.id === itemId);
    if (!item) return showMessageModal("Error", "Item not found.");

    const resupplies = (storeData.resupplies || []).filter(r => r.itemId === itemId)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5);

    let resupplyTable = resupplies.length > 0 ? `
        <h4 style="font-size: 14pt; margin-top: 20px;">Recent Resupplies</h4>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #000;">
            <thead>
                <tr style="background:#f0f0f0">
                    <th style="border: 1px solid #000; padding: 8px;">Date</th>
                    <th style="border: 1px solid #000; padding: 8px;">Qty</th>
                    <th style="border: 1px solid #000; padding: 8px;">Tender ID</th>
                </tr>
            </thead>
            <tbody>
                ${resupplies.map(r => `
                    <tr>
                        <td style="border: 1px solid #000; padding: 8px;">${formatDate(r.date)}</td>
                        <td style="border: 1px solid #000; padding: 8px; text-align: center;">${r.quantity}</td>
                        <td style="border: 1px solid #000; padding: 8px;">${r.tenderId || 'N/A'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    ` : '<p>No resupply history available.</p>';

    const contentHTML = `
        <div class="print-preview-content" style="font-family: Arial, sans-serif; line-height: 1.4;">
            ${getReportHeader('Supply/Resupply Slip: ' + item.name)}
            <table style="width: 100%; border-collapse: collapse; border: 1px solid #000; margin-bottom: 20px;">
                <tr>
                    <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Current Stock:</td>
                    <td style="border: 1px solid #000; padding: 8px;">${item.quantity}</td>
                    <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Last Resupply:</td>
                    <td style="border: 1px solid #000; padding: 8px;">${formatDate(item.lastResupplyDate)}</td>
                </tr>
            </table>
            ${resupplyTable}
        </div>
    `;

    document.getElementById('viewReportTitle').textContent = `Supply Slip: ${item.name}`;
    document.getElementById('viewReportContent').innerHTML = contentHTML;
    document.getElementById('viewReportModal').classList.remove('hidden');
}

export function generateEmployeeReport() {
    document.getElementById('generateReportTitle').textContent = 'Generate Employee Report';

    document.getElementById('reportEmployeeSelectContainer').classList.remove('hidden');
    document.getElementById('reportItemSelectContainer').classList.add('hidden');

    document.getElementById('reportFromDate').parentElement.classList.remove('hidden');
    document.getElementById('reportToDate').parentElement.classList.remove('hidden');

    document.getElementById('generateReportModal').classList.remove('hidden');

    document.getElementById('reportFromDate').value = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    document.getElementById('reportToDate').value = new Date().toISOString().split('T')[0];

    document.getElementById('generateReportForm').onsubmit = (e) => {
        e.preventDefault();
        renderEmployeeReport();
    };
}

export function generateItemReport() {
    document.getElementById('generateReportTitle').textContent = 'Generate Item Report';
    document.getElementById('reportItemSelectContainer').classList.remove('hidden');
    document.getElementById('reportEmployeeSelectContainer').classList.add('hidden');

    // Hide date fields
    document.getElementById('reportFromDate').parentElement.classList.add('hidden');
    document.getElementById('reportToDate').parentElement.classList.add('hidden');

    document.getElementById('generateReportModal').classList.remove('hidden');

    document.getElementById('generateReportForm').onsubmit = (e) => {
        e.preventDefault();
        renderItemReport();
    };
}

export function showDisbursementReportModal() {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    document.getElementById('disbursementReportFrom').value = thirtyDaysAgo;
    document.getElementById('disbursementReportTo').value = today;
    document.getElementById('disbursementReportModal').classList.remove('hidden');

    document.getElementById('disbursementReportForm').onsubmit = (e) => {
        e.preventDefault();
        renderDisbursementReport();
    };
}

export function showStoreReportModal() {
    document.getElementById('generateReportTitle').textContent = 'Generate Store Report';
    document.getElementById('reportItemSelectContainer').classList.add('hidden');
    document.getElementById('reportEmployeeSelectContainer').classList.add('hidden');

    // Show date fields
    document.getElementById('reportFromDate').parentElement.classList.remove('hidden');
    document.getElementById('reportToDate').parentElement.classList.remove('hidden');

    document.getElementById('generateReportModal').classList.remove('hidden');

    document.getElementById('reportFromDate').value = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    document.getElementById('reportToDate').value = new Date().toISOString().split('T')[0];

    document.getElementById('generateReportForm').onsubmit = (e) => {
        e.preventDefault();
        renderStoreReport();
    };
}

function renderEmployeeReport() {
    const employeeId = document.getElementById('reportEmployeeSelect').value;
    const fromDate = new Date(document.getElementById('reportFromDate').value).getTime();
    const toDate = new Date(document.getElementById('reportToDate').value).getTime() + 86400000;

    let filteredDisbursements = storeData.disbursements || [];
    let filteredReturns = storeData.returns || [];

    filteredDisbursements = filteredDisbursements.filter(d => {
        const dateMatch = new Date(d.date || d.timestamp).getTime() >= fromDate && new Date(d.date || d.timestamp).getTime() <= toDate;
        const empMatch = employeeId ? d.recipientId === employeeId : true;
        return dateMatch && empMatch;
    });

    filteredReturns = filteredReturns.filter(r => {
        const dateMatch = new Date(r.date || r.timestamp).getTime() >= fromDate && new Date(r.date || r.timestamp).getTime() <= toDate;
        const empMatch = employeeId ? r.recipientId === employeeId : true;
        return dateMatch && empMatch;
    });

    const allTransactions = [
        ...filteredDisbursements.map(d => ({ ...d, type: 'DISBURSEMENT' })),
        ...filteredReturns.map(r => ({ ...r, type: 'RETURN' }))
    ].sort((a, b) => new Date(b.date || b.timestamp) - new Date(a.date || a.timestamp)); // Newest first

    const selectedEmployee = employeeId ? storeData.employees.find(e => e.id === employeeId) : null;
    const employeeName = selectedEmployee ? selectedEmployee.name : 'All Employees';
    const employeeDesignation = selectedEmployee ? selectedEmployee.designation : 'Various Designations';

    let tableRows = '';
    let totalItems = 0;

    allTransactions.forEach((t, idx) => {
        t.items.forEach(item => {
            const inventoryItem = storeData.inventory.find(i => i.id === (item.id || item.itemId));
            const itemName = inventoryItem ? inventoryItem.name : (item.name || item.itemName);
            tableRows += `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${formatDate(t.date || t.timestamp)}</td>
                    <td>${t.id.substring(0, 8)}</td>
                    <td>${itemName}</td>
                    <td class="${t.type === 'DISBURSEMENT' ? 'text-red-600' : 'text-green-600'}">${t.type === 'DISBURSEMENT' ? '-' : '+'}${item.quantity}</td>
                    <td>${t.type}</td>
                </tr>
            `;
            if (t.type === 'DISBURSEMENT') totalItems -= item.quantity;
            else totalItems += item.quantity;
        });
    });

    const content = `
        <div class="print-preview-content">
            ${getReportHeader(`Employee Transaction Report: ${employeeName}`)}
            <div class="mb-4 text-sm text-slate-700">
                <p><strong>Designation:</strong> ${employeeDesignation}</p>
                <p><strong>Net Balance:</strong> ${totalItems} items</p>
            </div>
            <table class="w-full border-collapse border border-slate-300" style="color: #000;">
            <thead class="bg-slate-100">
                <tr><th>SL</th><th>Date</th><th>Record ID</th><th>Item name</th><th>Qty Change</th><th>Type</th></tr>
            </thead>
            <tbody>${tableRows}</tbody>
        </table>
        </div>
    `;

    document.getElementById('viewReportContent').innerHTML = content;
    hideModal('generateReportModal');
    document.getElementById('viewReportModal').classList.remove('hidden');
}

function renderDisbursementReport() {
    const fromDate = new Date(document.getElementById('disbursementReportFrom').value);
    const toDate = new Date(document.getElementById('disbursementReportTo').value);
    const type = document.getElementById('disbursementReportType').value;

    const transactions = (type === 'disbursement' ? storeData.disbursements : storeData.returns)
        .filter(t => {
            const date = new Date(t.timestamp);
            return date >= fromDate && date <= toDate;
        });

    const content = `
        <div class="print-preview-content">
            ${getReportHeader(`${type === 'disbursement' ? 'Disbursement' : 'Return'} Report (${formatDate(fromDate)} - ${formatDate(toDate)})`)}
            <table class="w-full border-collapse border border-slate-300" style="color: #000;">
            <thead class="bg-slate-100">
                <tr><th>Date</th><th>Recipient</th><th>Total Items</th></tr>
            </thead>
            <tbody>
                ${transactions.map(t => `
                    <tr>
                        <td>${formatDate(t.timestamp)}</td>
                        <td>${t.recipientName}</td>
                        <td>${t.items.reduce((sum, i) => sum + i.quantity, 0)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        </div>
    `;

    document.getElementById('viewReportContent').innerHTML = content;
    hideModal('disbursementReportModal');
    document.getElementById('viewReportModal').classList.remove('hidden');
}

function renderStoreReport() {
    const fromStr = document.getElementById('reportFromDate').value;
    const toStr = document.getElementById('reportToDate').value;

    if (!fromStr || !toStr) return showMessageModal("Error", "Please select both start and end dates.");

    const fromDate = new Date(fromStr);
    const toDate = new Date(toStr);

    const fromTime = fromDate.getTime();
    // To date includes the full day
    const toTime = toDate.getTime() + 86400000;

    const flows = [];

    // 1. Resupplies (Supply / Resupply)
    (storeData.resupplies || []).forEach(r => {
        const dateObj = new Date(r.date || r.timestamp);
        const time = dateObj.getTime();
        if (time >= fromTime && time <= toTime) {
            const isInitial = r.type === 'Initial Stock' || (!r.tenderId && !r.type);
            flows.push({
                date: r.date || r.timestamp,
                itemId: r.itemId,
                itemName: r.itemName || (storeData.inventory.find(i => i.id === r.itemId)?.name || 'Unknown Item'),
                qty: r.quantity, // Positive for inflow
                type: isInitial ? 'Initial Supply' : 'Resupply',
                details: isInitial ? 'Initial Stock' : (r.tenderId ? `Tender ID: ${r.tenderId}` : 'N/A')
            });
        }
    });

    // Helper: resolve employee name
    const resolveRecipientName = (recipientId, recipientName) => {
        const employees = storeData.employees || [];
        if (recipientId) {
            const emp = employees.find(e => e.id === recipientId);
            if (emp && emp.name) return emp.name;
        }
        if (recipientName && !recipientName.includes(' ')) {
            const emp = employees.find(e => e.id === recipientName);
            if (emp && emp.name) return emp.name;
        }
        return recipientName || 'Unknown';
    };

    // 2. Disbursements (Outflow)
    (storeData.disbursements || []).forEach(d => {
        const dateObj = new Date(d.timestamp || d.date);
        const time = dateObj.getTime();
        if (time >= fromTime && time <= toTime) {
            const recipient = resolveRecipientName(d.recipientId, d.recipientName);
            (d.items || []).forEach(item => {
                flows.push({
                    date: d.timestamp || d.date,
                    itemId: item.id || item.itemId,
                    itemName: item.name || (storeData.inventory.find(i => i.id === (item.id || item.itemId))?.name || 'Unknown Item'),
                    qty: -item.quantity, // Negative for outflow
                    type: 'Disbursement',
                    details: `Recipient: ${recipient}`
                });
            });
        }
    });

    // 3. Returns (Inflow)
    (storeData.returns || []).forEach(r => {
        const dateObj = new Date(r.timestamp || r.date);
        const time = dateObj.getTime();
        if (time >= fromTime && time <= toTime) {
            const recipient = resolveRecipientName(r.recipientId, r.recipientName);
            (r.items || []).forEach(item => {
                flows.push({
                    date: r.timestamp || r.date,
                    itemId: item.id || item.itemId,
                    itemName: item.name || (storeData.inventory.find(i => i.id === (item.id || item.itemId))?.name || 'Unknown Item'),
                    qty: item.quantity, // Positive for inflow
                    type: 'Return',
                    details: `Recipient: ${recipient}`
                });
            });
        }
    });

    // Sort chronologically: newest first (latest on top)
    flows.sort((a, b) => new Date(b.date) - new Date(a.date));

    const content = `
        <div class="print-preview-content">
            ${getReportHeader(`Store Inventory Flow Report (${formatDate(fromDate)} - ${formatDate(toDate)})`)}
            <table class="w-full border-collapse border border-slate-300" style="color: #000;">
            <thead class="bg-slate-100">
                <tr><th>Date</th><th>Item Name</th><th>Qty Change</th><th>Type</th><th>Details</th></tr>
            </thead>
            <tbody>
                ${flows.map(f => `
                        <tr>
                            <td>${formatDate(f.date)}</td>
                            <td>${f.itemName}</td>
                            <td class="${f.qty < 0 ? 'text-red-600 font-bold' : 'text-green-600 font-bold'}">${f.qty > 0 ? '+' : ''}${f.qty}</td>
                            <td>${f.type}</td>
                            <td>${f.details}</td>
                        </tr>
                    `).join('')}
            </tbody>
        </table>
        </div>
    `;

    document.getElementById('viewReportContent').innerHTML = content;
    hideModal('generateReportModal');
    document.getElementById('viewReportModal').classList.remove('hidden');
}

function renderItemReport() {
    const itemId = document.getElementById('reportItemSelect').value;
    if (!itemId) return showMessageModal("Error", "Please select an item.");
    const item = storeData.inventory.find(i => i.id === itemId);

    // Helper: resolve employee name — 3-tier fallback
    // 1) Look up by recipientId in employees list
    // 2) If recipientName looks like an ID (no spaces), search employees by that value
    // 3) Last resort: return recipientName as-is or 'Unknown'
    const resolveRecipientName = (recipientId, recipientName) => {
        const employees = storeData.employees || [];
        // Tier 1: direct recipientId lookup
        if (recipientId) {
            const emp = employees.find(e => e.id === recipientId);
            if (emp && emp.name) return emp.name;
        }
        // Tier 2: treat recipientName as an employee ID and search
        if (recipientName && !recipientName.includes(' ')) {
            const emp = employees.find(e => e.id === recipientName);
            if (emp && emp.name) return emp.name;
        }
        // Tier 3: last resort — return stored string or 'Unknown'
        return recipientName || 'Unknown';
    };

    const transactions = [];
    (storeData.disbursements || []).forEach(d => {
        const row = d.items.find(i => i.id === itemId);
        if (row) transactions.push({ date: d.timestamp, type: 'DISBURSEMENT', qty: -row.quantity, details: resolveRecipientName(d.recipientId, d.recipientName) });
    });
    (storeData.returns || []).forEach(r => {
        const row = r.items.find(i => i.id === itemId);
        if (row) transactions.push({ date: r.timestamp, type: 'RETURN', qty: row.quantity, details: resolveRecipientName(r.recipientId, r.recipientName) });
    });
    (storeData.resupplies || []).forEach(rs => {
        if (rs.itemId === itemId) {
            const isInitial = rs.type === 'Initial Stock' || (!rs.tenderId && !rs.type);
            transactions.push({ 
                date: rs.date || rs.timestamp, 
                type: isInitial ? 'INITIAL_STOCK' : 'RESUPPLY', 
                qty: rs.quantity, 
                details: isInitial ? 'N/A' : (rs.tenderId || 'N/A') 
            });
        }
    });

    // Sort chronologically (oldest first) so that the latest transaction is at the bottom
    transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

    // The user wants the last row's balance to match the current stock (item.quantity) exactly.
    // To achieve this, we can calculate the running balances by working backward from the current stock.
    // Let's first calculate the balances backward.
    const balances = new Array(transactions.length);
    let currentTempBalance = item.quantity;
    
    // Work backward from the final balance
    for (let i = transactions.length - 1; i >= 0; i--) {
        balances[i] = currentTempBalance;
        // Undo the transaction's quantity change to get the previous balance
        currentTempBalance -= transactions[i].qty;
    }

    const tableRows = transactions.map((t, idx) => {
        let changeStr = '';
        let typeDisplay = t.type;
        const rowBalance = balances[idx];

        if (t.type === 'INITIAL_STOCK') {
            return `
                <tr>
                    <td>${t.date ? formatDate(t.date) : 'N/A'}</td>
                    <td>Initial Stock</td>
                    <td>+${t.qty}</td>
                    <td>${rowBalance}</td>
                    <td>N/A</td>
                </tr>
            `;
        }

        if (t.type === 'DISBURSEMENT') {
            changeStr = `${t.qty}`; // negative (e.g. -1, -10)
            typeDisplay = 'Disbursement';
        } else if (t.type === 'RETURN') {
            changeStr = `+${t.qty}`;
            typeDisplay = 'Return';
        } else if (t.type === 'RESUPPLY') {
            changeStr = `+${t.qty}`;
            typeDisplay = 'Resupply';
        }

        return `
            <tr>
                <td>${formatDate(t.date)}</td>
                <td>${typeDisplay}</td>
                <td>${changeStr}</td>
                <td>${rowBalance}</td>
                <td>${t.details}</td>
            </tr>
        `;
    }).join('');

    let initialQty;
    if (item.initialQuantity !== undefined) {
        initialQty = item.initialQuantity;
    } else {
        // Fallback for old items: initial qty = first disbursement qty (abs) + balance after that disbursement
        const firstDisbIdx = transactions.findIndex(t => t.type === 'DISBURSEMENT');
        if (firstDisbIdx !== -1) {
            initialQty = Math.abs(transactions[firstDisbIdx].qty) + balances[firstDisbIdx];
        } else {
            // No disbursements at all — stock has never gone out, so current qty = initial qty
            initialQty = item.quantity;
        }
    }
    const createdAtStr = item.createdAt ? formatDate(item.createdAt) : (item.lastResupplyDate ? formatDate(item.lastResupplyDate) : 'N/A');

    const content = `
        <div class="print-preview-content">
            ${getReportHeader(`Transaction Report: ${item.name}`)}
            <table class="w-full border-collapse border border-slate-300" style="color: #000; margin-bottom: 15px;">
                <tbody>
                    <tr>
                        <td style="padding: 6px 10px; font-weight: bold; width: 30%;">Item Name:</td>
                        <td style="padding: 6px 10px;">${item.name}</td>
                        <td style="padding: 6px 10px; font-weight: bold; width: 30%;">Specification:</td>
                        <td style="padding: 6px 10px;">${item.specification || 'N/A'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 10px; font-weight: bold;">Initial Quantity:</td>
                        <td style="padding: 6px 10px;">${initialQty}</td>
                        <td style="padding: 6px 10px; font-weight: bold;">Date Added:</td>
                        <td style="padding: 6px 10px;">${createdAtStr}</td>
                    </tr>
                </tbody>
            </table>
            <table class="w-full border-collapse border border-slate-300" style="color: #000; margin-bottom: 15px;">
            <thead class="bg-slate-100">
                <tr><th>Date</th><th>Type</th><th>Change</th><th>Balance</th><th>Details</th></tr>
            </thead>
            <tbody>${tableRows}</tbody>
        </table>
        <div style="font-weight: bold; font-size: 11pt; color: #000; margin-top: 15px; display: flex; flex-direction: column;">
            <div>Current Stock:</div>
            <div style="padding-left: 20px; font-size: 14pt;">${item.quantity}</div>
        </div>
        </div>
    `;

    document.getElementById('viewReportContent').innerHTML = content;
    hideModal('generateReportModal');
    document.getElementById('viewReportModal').classList.remove('hidden');
}

export function renderSavedReports() {
    const list = document.getElementById('savedReportsList');
    if (!list) return;
    const reports = storeData.savedReports || [];
    list.innerHTML = reports.map(r => `
        <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 font-medium text-slate-900">${r.title}</td>
            <td class="px-6 py-4 text-slate-500">${r.type}</td>
            <td class="px-6 py-4 text-slate-500">${formatDate(r.generatedAt)}</td>
            <td class="px-6 py-4 text-right">
                <button onclick="viewSavedReport('${r.id}')" class="text-blue-600 hover:text-blue-800 font-bold mr-3">View</button>
                <button onclick="deleteSavedReport('${r.id}')" class="text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

export function viewSavedReport(id) {
    const report = (storeData.savedReports || []).find(r => r.id === id);
    if (!report) return;
    document.getElementById('viewReportTitle').textContent = report.title;
    document.getElementById('viewReportContent').innerHTML = report.summary + report.data;
    document.getElementById('viewReportModal').classList.remove('hidden');
}

export async function deleteSavedReport(id) {
    const updated = (storeData.savedReports || []).filter(r => r.id !== id);
    await saveStoreData({ savedReports: updated });
    renderSavedReports();
}

export function generateCurrentStockReport() {
    if (!storeData || !storeData.inventory) {
        return showMessageModal("Error", "No inventory data available for this store.");
    }

    const currentDate = new Date();
    const nowStr = formatDateTime(currentDate.toISOString());
    const storeName = storeData.name || 'Unknown Store';

    let tableRows = '';
    let totalItems = 0;
    
    // Sort inventory alphabetically by name
    const sortedInventory = [...storeData.inventory].sort((a, b) => a.name.localeCompare(b.name));

    sortedInventory.forEach((item, index) => {
        tableRows += `
            <tr>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${index + 1}</td>
                <td style="border: 1px solid #000; padding: 8px;">${item.name}</td>
                <td style="border: 1px solid #000; padding: 8px;">${item.specification || 'N/A'}</td>
                <td style="border: 1px solid #000; padding: 8px; text-align: center;">${item.quantity}</td>
            </tr>
        `;
        totalItems += item.quantity;
    });

    const content = `
        <div class="print-preview-content" style="font-family: Arial, sans-serif; line-height: 1.4;">
            ${getReportHeader(`Current Stock Statement`)}
            <div style="margin-bottom: 20px; font-weight: bold; font-size: 11pt; color: #000;">
                <p>Store: ${storeName}</p>
                <p>Date & Time: ${nowStr}</p>
            </div>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; border: 1px solid #000; color: #000;">
                <thead>
                    <tr>
                        <th style="border: 1px solid #000; padding: 10px; background: #f0f0f0; width: 5%;">SL</th>
                        <th style="border: 1px solid #000; padding: 10px; background: #f0f0f0; width: 45%;">Item Name</th>
                        <th style="border: 1px solid #000; padding: 10px; background: #f0f0f0; width: 35%;">Specification</th>
                        <th style="border: 1px solid #000; padding: 10px; background: #f0f0f0; width: 15%;">Stock Qty</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                    <tr>
                        <td colspan="3" style="border: 1px solid #000; padding: 10px; text-align: right; font-weight: bold;">Total Units:</td>
                        <td style="border: 1px solid #000; padding: 10px; text-align: center; font-weight: bold;">${totalItems}</td>
                    </tr>
                </tbody>
            </table>
            <div class="footer" style="color: #000;">
                <p>Generated by Store Management System</p>
                <p>Generated on: ${nowStr}</p>
            </div>
        </div>
    `;

    document.getElementById('viewReportTitle').textContent = "Current Stock Report";
    document.getElementById('viewReportContent').innerHTML = content;
    document.getElementById('viewReportModal').classList.remove('hidden');
}
