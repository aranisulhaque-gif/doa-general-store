-- ============================================================
-- DOA General Store — Supabase Database Schema
-- Run against linked project: qveuxkdkgyamyneaaxkk
-- ============================================================

-- 1. STORES
CREATE TABLE IF NOT EXISTS public.stores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT DEFAULT '',
    last_modified TIMESTAMPTZ DEFAULT now()
);

-- 2. INVENTORY
CREATE TABLE IF NOT EXISTS public.inventory (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES public.stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    specification TEXT DEFAULT '',
    quantity INTEGER DEFAULT 0,
    "lastResupplyDate" TEXT,
    "latestTenderId" TEXT
);

-- 3. EMPLOYEES
CREATE TABLE IF NOT EXISTS public.employees (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES public.stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    designation TEXT DEFAULT ''
);

-- 4. DISBURSEMENTS
CREATE TABLE IF NOT EXISTS public.disbursements (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES public.stores(id) ON DELETE CASCADE,
    "recipientId" TEXT,
    "recipientName" TEXT,
    items JSONB DEFAULT '[]',
    "totalItems" INTEGER DEFAULT 0,
    timestamp TIMESTAMPTZ DEFAULT now()
);

-- 5. RETURNS
CREATE TABLE IF NOT EXISTS public.returns (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES public.stores(id) ON DELETE CASCADE,
    "recipientId" TEXT,
    "recipientName" TEXT,
    items JSONB DEFAULT '[]',
    "totalItems" INTEGER DEFAULT 0,
    timestamp TIMESTAMPTZ DEFAULT now()
);

-- 6. RESUPPLIES
CREATE TABLE IF NOT EXISTS public.resupplies (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES public.stores(id) ON DELETE CASCADE,
    "itemId" TEXT,
    "itemName" TEXT,
    quantity INTEGER DEFAULT 0,
    "tenderId" TEXT,
    timestamp TIMESTAMPTZ DEFAULT now()
);

-- 7. EVENT LOGS
CREATE TABLE IF NOT EXISTS public.event_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT REFERENCES public.stores(id) ON DELETE CASCADE,
    action TEXT,
    details TEXT,
    metadata JSONB DEFAULT '{}',
    "user" TEXT,
    user_role TEXT,
    timestamp TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. USER ROLES (role-based access mapping)
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'Restricted'
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Enable RLS on all tables
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resupplies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Permissive policies: any authenticated user can CRUD all rows
-- (fine-grained role checks are handled client-side in the app)
CREATE POLICY "Authenticated users full access" ON public.stores
    FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON public.inventory
    FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON public.employees
    FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON public.disbursements
    FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON public.returns
    FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON public.resupplies
    FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON public.event_logs
    FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users read own role" ON public.user_roles
    FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- INDEXES for common queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_inventory_store ON public.inventory(store_id);
CREATE INDEX IF NOT EXISTS idx_employees_store ON public.employees(store_id);
CREATE INDEX IF NOT EXISTS idx_disbursements_store ON public.disbursements(store_id);
CREATE INDEX IF NOT EXISTS idx_returns_store ON public.returns(store_id);
CREATE INDEX IF NOT EXISTS idx_resupplies_store ON public.resupplies(store_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_store ON public.event_logs(store_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_timestamp ON public.event_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_user_roles_email ON public.user_roles(email);

-- ============================================================
-- SEED: User Roles
-- ============================================================
INSERT INTO public.user_roles (email, role) VALUES
    ('admin.general@doa-ailab.com', 'Admin'),
    ('manager.general@doa-ailab.com', 'Manager'),
    ('storekeeper.general@doa-ailab.com', 'Storekeeper')
ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role;

-- ============================================================
-- 9. BACKUPS (Adhoc Snapshot system)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    trigger_type TEXT NOT NULL, -- 'user_activity' or 'keep_alive'
    snapshot_data JSONB NOT NULL
);

ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read backup list and Admins to manage
CREATE POLICY "Authenticated users read backups" ON public.backups
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin full access backups" ON public.backups
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_roles 
            WHERE email = auth.email() AND role = 'Admin'
        )
    );

CREATE INDEX IF NOT EXISTS idx_backups_created_at ON public.backups(created_at DESC);

