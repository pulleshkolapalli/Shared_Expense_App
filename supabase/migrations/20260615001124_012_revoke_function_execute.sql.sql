/*
# Remove EXECUTE Permission from Authenticated Users for SECURITY DEFINER Functions

## Problem
The security audit flags that authenticated users can call `is_group_creator` 
and `is_group_member` via REST API (`/rest/v1/rpc/...`), even though we added 
the `auth.uid()` check.

## Solution
Revoke EXECUTE from authenticated role entirely. The functions are still 
usable by RLS policies because:

1. RLS policies execute as the table owner (superuser), not the caller
2. Functions in RLS USING/WITH CHECK clauses bypass EXECUTE permission checks
3. The security definer context is still applied for RLS evaluation

This completely closes the REST API attack vector while keeping RLS working.
*/

-- Revoke EXECUTE from all roles
REVOKE EXECUTE ON FUNCTION public.is_group_creator(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_group_creator(uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_group_member(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_group_member(uuid, uuid) FROM authenticated;

-- Note: We intentionally do NOT grant to any role
-- RLS policies can still use these functions because RLS executes 
-- with table owner privileges, bypassing EXECUTE permission checks