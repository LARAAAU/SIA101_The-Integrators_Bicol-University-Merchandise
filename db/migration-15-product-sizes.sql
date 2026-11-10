-- BU Merch migration 15: sizes that the admin can edit per product (Admin > Products > Edit).
-- Run in Supabase SQL Editor. Safe to run more than once.
--   sizes = null     -> automatic (clothes get S, M, L, XL, 2XL like before)
--   sizes = '{}'     -> this item has no sizes
--   sizes = '{S,M}'  -> only these sizes can be chosen
alter table public.products add column if not exists sizes text[];
