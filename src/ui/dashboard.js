import Chart from 'chart.js/auto'; // Using auto to get all features simply
import { storeData } from '../core/state.js';
import { showDisbursementForm, showReturnForm, showBatchDisbursementForm, showResupplyForm, showSupplyForm, showAddEmployeeForm } from './modals.js'; // Will create this

let inventoryChartInstance = null;
let consumptionChartInstance = null;
let trendsChartInstance = null;

let lastStatsState = {
    inventory: null,
    transactions: null
};

export function renderDashboard() {
    // Zero-tolerance optimization: Skip all calculations if data hasn't changed
    const currentInventoryStr = JSON.stringify(storeData.inventory);
    const currentTransactionsStr = JSON.stringify(storeData.disbursements) + JSON.stringify(storeData.returns);

    const hasChanged = currentInventoryStr !== lastStatsState.inventory ||
        currentTransactionsStr !== lastStatsState.transactions;

    const dashboardTab = document.getElementById('dashboard');
    const isVisible = dashboardTab && !dashboardTab.classList.contains('hidden');

    if (!hasChanged && !isVisible) return;

    const inventory = storeData.inventory || [];
    const disbursements = storeData.disbursements || [];
    const returns = storeData.returns || [];
    const employees = storeData.employees || [];

    // Only update DOM if data changed AND tab is visible
    if (hasChanged || isVisible) {
        lastStatsState.inventory = currentInventoryStr;
        lastStatsState.transactions = currentTransactionsStr;

        const totalItems = inventory.length;
        const totalStock = inventory.reduce((sum, item) => sum + item.quantity, 0);
        const totalDisbursements = disbursements.length;
        const totalReturns = returns.length;
        const totalEmployees = employees.length;

        const lowStockCount = inventory.filter(item => item.quantity < 10 && item.quantity > 0).length;
        const outOfStockCount = inventory.filter(item => item.quantity <= 0).length;

        const statsGrid = document.getElementById('stats-grid');
        if (statsGrid && isVisible) {
            statsGrid.innerHTML = `
                <!-- Total Items -->
                <button class="glass-card stat-card stat-card-btn" onclick="window.showTab('inventory')" title="Go to Inventory">
                    <div class="stat-icon bg-blue-50 text-blue-600"><i class="fas fa-boxes"></i></div>
                    <div>
                        <p class="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Items</p>
                        <p class="text-2xl font-bold">${totalItems.toLocaleString()}</p>
                    </div>
                    <i class="fas fa-arrow-right stat-card-arrow text-blue-400"></i>
                </button>
                <!-- Total Employees -->
                <button class="glass-card stat-card stat-card-btn" onclick="window.showTab('employees')" title="Go to Employees">
                    <div class="stat-icon bg-indigo-50 text-indigo-600"><i class="fas fa-users"></i></div>
                    <div>
                        <p class="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Employees</p>
                        <p class="text-2xl font-bold">${totalEmployees.toLocaleString()}</p>
                    </div>
                    <i class="fas fa-arrow-right stat-card-arrow text-indigo-400"></i>
                </button>
                <!-- Transactions -->
                <button class="glass-card stat-card stat-card-btn" onclick="window.showTab('disbursements')" title="Go to Disbursements">
                    <div class="stat-icon bg-emerald-50 text-emerald-600"><i class="fas fa-exchange-alt"></i></div>
                    <div>
                        <p class="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Transactions</p>
                        <p class="text-2xl font-bold">${(totalDisbursements + totalReturns).toLocaleString()}</p>
                    </div>
                    <i class="fas fa-arrow-right stat-card-arrow text-emerald-400"></i>
                </button>
                <!-- Low Stock/OOS -->
                <button class="glass-card stat-card stat-card-btn" onclick="(function(){ var f=document.getElementById('inventoryStockFilter'); if(f) f.value='low'; window.showTab('inventory'); })()" title="Go to Low Stock Inventory">
                    <div class="stat-icon bg-orange-50 text-orange-600"><i class="fas fa-exclamation-triangle"></i></div>
                    <div>
                        <p class="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Low Stock/OOS</p>
                        <p class="text-2xl font-bold text-orange-600">${(lowStockCount + outOfStockCount).toLocaleString()}</p>
                    </div>
                    <i class="fas fa-arrow-right stat-card-arrow text-orange-400"></i>
                </button>
            `;
        }
    }

    // Low stock items for inventory chart (always pass current data, renderCharts handles visibility)
    const lowStockItems = inventory
        .filter(item => item.quantity <= 20)
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, 10);

    renderCharts(lowStockItems, disbursements, inventory);
}

function renderCharts(lowStockItems, disbursements, inventory) {
    // Optimization: Skip chart rendering if dashboard is not visible
    const dashboardTab = document.getElementById('dashboard');
    if (dashboardTab && dashboardTab.classList.contains('hidden')) return;

    // Inventory Chart (Low Stock)
    const invCtx = document.getElementById('inventoryChart');
    if (invCtx) {
        const labels = lowStockItems.map(item => wrapLabel(item.name, 15));
        const data = lowStockItems.map(item => item.quantity);
        const backgroundColors = lowStockItems.map(item => item.quantity <= 0 ? 'rgba(239, 68, 68, 0.8)' : 'rgba(37, 99, 235, 0.8)');
        const borderColors = lowStockItems.map(item => item.quantity <= 0 ? 'rgb(239, 68, 68)' : 'rgb(37, 99, 235)');

        if (inventoryChartInstance) {
            inventoryChartInstance.data.labels = labels;
            inventoryChartInstance.data.datasets[0].data = data;
            inventoryChartInstance.data.datasets[0].backgroundColor = backgroundColors;
            inventoryChartInstance.data.datasets[0].borderColor = borderColors;
            inventoryChartInstance.update('none'); // Update without animation for performance
        } else {
            inventoryChartInstance = new Chart(invCtx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Current Quantity',
                        data: data,
                        backgroundColor: backgroundColors,
                        borderColor: borderColors,
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true },
                        x: { ticks: { maxRotation: 0, minRotation: 0, autoSkip: false } }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        }
    }

    // Consumption Chart (Most Consumed Items)
    const consumptionData = calculateMostConsumedItems(disbursements, inventory);
    const consCtx = document.getElementById('consumptionChart');
    if (consCtx) {
        const labels = consumptionData.map(item => wrapLabel(item.name, 15));
        const data = consumptionData.map(item => item.totalDisbursed);

        if (consumptionChartInstance) {
            consumptionChartInstance.data.labels = labels;
            consumptionChartInstance.data.datasets[0].data = data;
            consumptionChartInstance.update('none');
        } else {
            consumptionChartInstance = new Chart(consCtx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Total Disbursed',
                        data: data,
                        backgroundColor: 'rgba(242, 120, 92, 0.8)',
                        borderColor: 'rgb(242, 120, 92)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true },
                        x: { ticks: { maxRotation: 0, minRotation: 0, autoSkip: false } }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        }
    }

    // Trends Chart
    const trendsData = calculateDisbursementTrends(disbursements);
    const trendsCtx = document.getElementById('trendsChart');
    if (trendsCtx) {
        if (trendsChartInstance) {
            trendsChartInstance.data.labels = trendsData.labels;
            trendsChartInstance.data.datasets[0].data = trendsData.data;
            trendsChartInstance.update('none');
        } else {
            trendsChartInstance = new Chart(trendsCtx, {
                type: 'line',
                data: {
                    labels: trendsData.labels,
                    datasets: [{
                        label: 'Items Disbursed',
                        data: trendsData.data,
                        borderColor: 'rgb(60, 84, 111)',
                        backgroundColor: 'rgba(60, 84, 111, 0.1)',
                        tension: 0.3,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true } }
                }
            });
        }
    }
}

export function switchChart(chartName) {
    document.querySelectorAll('.chart-container').forEach(container => container.style.display = 'none');
    document.querySelectorAll('.chart-tab').forEach(tab => {
        tab.classList.remove('active', 'bg-white', 'shadow-sm', 'border', 'border-slate-100');
        tab.classList.add('text-slate-400');
    });

    const container = document.getElementById(`chart-${chartName}`);
    if (container) container.style.display = 'block';

    const tab = document.getElementById(`tab-${chartName}`);
    if (tab) {
        tab.classList.add('active', 'bg-white', 'shadow-sm', 'border', 'border-slate-100');
        tab.classList.remove('text-slate-400');
    }

    // Re-render dashboard to ensure chart instances are correctly sized for visible container
    renderDashboard();
}

function wrapLabel(label, maxLength = 15) {
    if (label.length <= maxLength) return label;
    const words = label.split(' ');
    const lines = [];
    let currentLine = '';
    words.forEach(word => {
        if ((currentLine + word).length <= maxLength) {
            currentLine += (currentLine ? ' ' : '') + word;
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }
    });
    if (currentLine) lines.push(currentLine);
    return lines;
}

function calculateMostConsumedItems(disbursements, inventory) {
    const itemConsumption = {};
    disbursements.forEach(d => {
        if (d.items && Array.isArray(d.items)) {
            d.items.forEach(item => {
                if (!itemConsumption[item.id]) {
                    const invItem = inventory.find(i => i.id === item.id);
                    itemConsumption[item.id] = { name: invItem ? invItem.name : 'Unknown', totalDisbursed: 0 };
                }
                itemConsumption[item.id].totalDisbursed += parseInt(item.quantity) || 0;
            });
        }
    });
    return Object.values(itemConsumption).sort((a, b) => b.totalDisbursed - a.totalDisbursed).slice(0, 10);
}

function calculateDisbursementTrends(disbursements) {
    const months = [];
    const counts = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
        months.push(label);
        const monthDisbursements = disbursements.filter(disb => {
            const disbDate = new Date(disb.timestamp || disb.date);
            return disbDate.getMonth() === d.getMonth() && disbDate.getFullYear() === d.getFullYear();
        });
        const totalItems = monthDisbursements.reduce((sum, d) => sum + (parseInt(d.totalItems) || 0), 0);
        counts.push(totalItems);
    }
    return { labels: months, data: counts };
}
