import { supabase } from './supabase.js';

/**
 * Checks if a keep-alive snapshot is needed and creates one.
 * Pings both General and Services Supabase databases.
 */
async function runKeepAlive() {
  console.log(`[${new Date().toISOString()}] Starting Keep-Alive and Idle-Backup check...`);
  
  // 1. Fetch current database schema name / project reference from environment or config
  // For the GitHub Action, we will read environment variables:
  // SUPABASE_URL, SUPABASE_ANON_KEY (for General)
  // SERVICES_SUPABASE_URL, SERVICES_SUPABASE_ANON_KEY (for Services)
  
  const targets = [
    {
      name: 'general',
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY
    },
    {
      name: 'services',
      url: process.env.SERVICES_SUPABASE_URL,
      anonKey: process.env.SERVICES_SUPABASE_ANON_KEY
    }
  ];

  for (const target of targets) {
    if (!target.url || !target.anonKey) {
      console.log(`[${target.name}] Skipping: URL or Anon Key missing in environment.`);
      continue;
    }

    try {
      console.log(`[${target.name}] Querying last snapshot...`);
      
      // We initialize a temporary client fetch to act as the REST API call (keep-alive)
      // This is a direct REST API call. Querying the backups table.
      const headers = {
        'apikey': target.anonKey,
        'Authorization': `Bearer ${target.anonKey}`,
        'Content-Type': 'application/json'
      };

      // Query the backups table order by created_at desc limit 1
      const queryUrl = `${target.url}/rest/v1/backups?select=created_at&order=created_at.desc&limit=1`;
      const response = await fetch(queryUrl, { headers });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch last backup: ${response.statusText} (${response.status})`);
      }

      const backups = await response.json();
      console.log(`[${target.name}] Active keep-alive API call successful.`);

      let needsBackup = false;
      if (backups.length === 0) {
        console.log(`[${target.name}] No prior backup found. Creating initial keep-alive backup.`);
        needsBackup = true;
      } else {
        const lastBackupDate = new Date(backups[0].created_at);
        const now = new Date();
        const diffMs = now - lastBackupDate;
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        
        console.log(`[${target.name}] Last snapshot was created ${diffDays.toFixed(2)} days ago.`);
        
        // If no backup in last 5 days, trigger a new keepalive backup
        if (diffDays >= 5.0) {
          console.log(`[${target.name}] DB has been idle for >= 5 days. Generating keepalive snapshot...`);
          needsBackup = true;
        } else {
          console.log(`[${target.name}] Snapshot is recent. No keepalive backup needed.`);
        }
      }

      if (needsBackup) {
        // Fetch all tables to create snapshot
        const snapshot = await fetchAllTableData(target.url, target.anonKey);
        
        // Insert new snapshot
        const insertUrl = `${target.url}/rest/v1/backups`;
        const insertResponse = await fetch(insertUrl, {
          method: 'POST',
          headers: {
            ...headers,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            trigger_type: 'keep_alive',
            snapshot_data: snapshot
          })
        });

        if (!insertResponse.ok) {
          throw new Error(`Failed to save backup: ${insertResponse.statusText} (${insertResponse.status})`);
        }
        console.log(`[${target.name}] Keep-alive backup snapshot saved successfully.`);

        // Prune older backups if they exceed 30
        await pruneOldBackups(target.url, target.anonKey, headers);
      }

    } catch (err) {
      console.error(`[${target.name}] Error during keep-alive run:`, err.message);
    }
  }
}

/**
 * Fetches all user data tables from Supabase to construct a JSON snapshot
 */
async function fetchAllTableData(url, anonKey) {
  const headers = {
    'apikey': anonKey,
    'Authorization': `Bearer ${anonKey}`
  };

  const tables = ['stores', 'inventory', 'employees', 'disbursements', 'returns', 'resupplies', 'event_logs', 'user_roles'];
  const snapshot = {
    manifest: {
      version: '1.0',
      createdAt: new Date().toISOString(),
      recordCounts: {}
    },
    data: {}
  };

  for (const table of tables) {
    let queryUrl = `${url}/rest/v1/${table}?select=*`;
    
    // For event_logs, keep only last 30 days of data in the snapshot to prevent bloat
    if (table === 'event_logs') {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      queryUrl += `&timestamp=gt.${cutoffDate.toISOString()}`;
    }

    const res = await fetch(queryUrl, { headers });
    if (!res.ok) {
      console.error(`Warning: Failed to fetch table ${table}: ${res.statusText}`);
      snapshot.data[table] = [];
      snapshot.manifest.recordCounts[table] = 0;
      continue;
    }

    const data = await res.json();
    snapshot.data[table] = data;
    snapshot.manifest.recordCounts[table] = data.length;
  }

  return snapshot;
}

/**
 * Prunes backups so that we only keep the latest 30 snapshots
 */
async function pruneOldBackups(url, anonKey, headers) {
  try {
    // Get all backup IDs ordered by created_at desc
    const listUrl = `${url}/rest/v1/backups?select=id&order=created_at.desc`;
    const res = await fetch(listUrl, { headers });
    if (!res.ok) return;

    const backups = await res.json();
    if (backups.length > 30) {
      const idsToDelete = backups.slice(30).map(b => b.id);
      console.log(`Pruning ${idsToDelete.length} old backup snapshots...`);

      // Delete request
      const deleteUrl = `${url}/rest/v1/backups?id=in.(${idsToDelete.join(',')})`;
      const delRes = await fetch(deleteUrl, {
        method: 'DELETE',
        headers
      });
      if (delRes.ok) {
        console.log("Old backups pruned successfully.");
      } else {
        console.error("Failed to prune old backups:", delRes.statusText);
      }
    }
  } catch (err) {
    console.error("Error pruning old backups:", err.message);
  }
}

// Run keepalive
runKeepAlive();
