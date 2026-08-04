-- ============================================================
-- SQL Script for User Management API Setup
-- Run this in your Supabase SQL Editor for the linked project
-- (qveuxkdkgyamyneaaxkk / Services Store)
-- ============================================================

-- 1. Enable Managers and Admins to modify the user_roles table
CREATE POLICY "Managers and Admins can insert roles" ON public.user_roles
    FOR INSERT WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE email = auth.email() AND (role = 'Admin' OR role = 'Manager')
      )
    );

CREATE POLICY "Managers and Admins can update roles" ON public.user_roles
    FOR UPDATE USING (
      EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE email = auth.email() AND (role = 'Admin' OR role = 'Manager')
      )
    );

CREATE POLICY "Managers and Admins can delete roles" ON public.user_roles
    FOR DELETE USING (
      EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE email = auth.email() AND (role = 'Admin' OR role = 'Manager')
      )
    );

-- 2. Secure function to delete a user from auth.users by email
CREATE OR REPLACE FUNCTION public.delete_user_by_email(target_email text)
RETURNS json SECURITY DEFINER AS $$
DECLARE
  caller_role text;
BEGIN
  -- Verify caller is logged in and is a Manager or Admin in this database
  SELECT role INTO caller_role FROM public.user_roles WHERE email = auth.email();
  
  IF caller_role IS NULL OR caller_role NOT IN ('Admin', 'Manager') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Delete from public mapping
  DELETE FROM public.user_roles WHERE email = target_email;

  -- Delete from auth system
  DELETE FROM auth.users WHERE email = target_email;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql;
