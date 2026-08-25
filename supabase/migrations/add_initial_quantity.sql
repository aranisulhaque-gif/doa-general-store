-- Migration: Add initialQuantity column to inventory table
-- Run this in the Supabase SQL Editor for BOTH projects:
--   store.doa-ailab.com  (project: qveuxkdkgyamyneaaxkk)
--   store2.doa-ailab.com (run on its linked project too)

-- Step 1: Add the column (safe, idempotent)
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS "initialQuantity" INTEGER DEFAULT 0;

-- Step 2: Accurate backfill using transaction history
-- Formula: initialStock = currentStock + totalDisbursed - totalReturned - totalResupplied
-- This reconstructs the true initial stock by reversing all movements recorded since item creation.
UPDATE public.inventory i
SET "initialQuantity" = i.quantity
  + COALESCE((
      -- Add back all disbursements (they reduced stock)
      SELECT SUM((item->>'quantity')::int)
      FROM public.disbursements d,
           jsonb_array_elements(d.items) AS item
      WHERE d.store_id = i.store_id
        AND item->>'id' = i.id
    ), 0)
  - COALESCE((
      -- Subtract all returns (they increased stock)
      SELECT SUM((item->>'quantity')::int)
      FROM public.returns r,
           jsonb_array_elements(r.items) AS item
      WHERE r.store_id = i.store_id
        AND item->>'id' = i.id
    ), 0)
  - COALESCE((
      -- Subtract resupplies that are NOT the initial stock entry
      -- (initial stock resupply has no tenderId and type is null or 'Initial Stock')
      SELECT SUM(s.quantity)
      FROM public.resupplies s
      WHERE s.store_id = i.store_id
        AND s."itemId" = i.id
        AND s."tenderId" IS NOT NULL
    ), 0)
WHERE i."initialQuantity" = 0 OR i."initialQuantity" IS NULL;

-- Step 3: Safety clamp — ensure no negative initialQuantity results
UPDATE public.inventory
SET "initialQuantity" = 0
WHERE "initialQuantity" < 0;
