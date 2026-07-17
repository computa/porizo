-- Capture the buyer's own name from Stripe Checkout (customer_details.name) so
-- the account isn't nameless in admin ("No name"). Stored on the order because
-- the paid->rendering convergence (handlePaid) may run later via the sweep,
-- where the Stripe session is no longer in hand — mirrors how `email` is
-- persisted on the order and read back at convergence time.
ALTER TABLE web_orders
  ADD COLUMN IF NOT EXISTS buyer_name TEXT;
