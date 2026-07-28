/**
 * seed_users.js — Create Supabase Auth users for DOA General Store
 * 
 * Usage:
 *   node supabase/seed_users.js <SERVICE_ROLE_KEY>
 * 
 * The SERVICE_ROLE_KEY can be found in:
 *   Supabase Dashboard → Settings → API → service_role (secret)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qveuxkdkgyamyneaaxkk.supabase.co';

const serviceRoleKey = process.argv[2];
if (!serviceRoleKey) {
    console.error('❌ Usage: node supabase/seed_users.js <SERVICE_ROLE_KEY>');
    console.error('   Find it at: https://supabase.com/dashboard/project/qveuxkdkgyamyneaaxkk/settings/api');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// ── User Roster ──────────────────────────────────────────────
// Default password: "doa2026!" — change in the Supabase Dashboard after creation
const USERS = [
    { email: 'admin@storemanager.app',       password: 'doa2026!', role: 'Admin' },
    { email: 'doa.establishment@gmail.com',   password: 'doa2026!', role: 'Admin' },
    { email: 'raquib@generalstore.app',       password: 'doa2026!', role: 'Admin' },
    { email: 'rubel@generalstore.app',        password: 'doa2026!', role: 'Admin' },
    { email: 'bulbul@generalstore.app',       password: 'doa2026!', role: 'Manager' },
    { email: 'saddam@generalstore.app',       password: 'doa2026!', role: 'Manager' },
];

async function seedUsers() {
    console.log('🔑 Creating Supabase Auth users...\n');
    let created = 0;
    let skipped = 0;

    for (const user of USERS) {
        const { data, error } = await supabase.auth.admin.createUser({
            email: user.email,
            password: user.password,
            email_confirm: true   // Auto-confirm — skip email verification
        });

        if (error) {
            if (error.message?.includes('already been registered') || error.status === 422) {
                console.log(`⏭️  ${user.email} — already exists, skipping`);
                skipped++;
            } else {
                console.error(`❌ ${user.email} — ${error.message}`);
            }
        } else {
            console.log(`✅ ${user.email} — created (uid: ${data.user.id})`);
            created++;
        }
    }

    console.log(`\n📊 Done: ${created} created, ${skipped} skipped.`);
    console.log('🔒 Default password for all users: "doa2026!"');
    console.log('   Change passwords in Supabase Dashboard → Authentication → Users');
}

seedUsers().catch(e => { console.error('Fatal:', e); process.exit(1); });
