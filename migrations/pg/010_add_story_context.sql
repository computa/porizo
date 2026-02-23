-- Add story context JSON column to tracks table
-- Stores: relationship_type, years_known, specific_memory, special_phrases, what_makes_them_special
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS story_context_json TEXT;
