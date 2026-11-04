-- Demo (practice) data.
-- A demo CRP holds only made-up contracts. WVARF admins can practice inside a
-- demo CRP, and demo CRPs are kept out of the real statewide numbers.
ALTER TABLE crps ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contracts ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE;
