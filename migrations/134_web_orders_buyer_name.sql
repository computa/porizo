-- SQLite twin of pg/134. Capture the buyer's own name from Stripe Checkout
-- (customer_details.name) on the order so admin isn't nameless. See the pg
-- file for rationale.
ALTER TABLE web_orders
  ADD COLUMN buyer_name TEXT;
