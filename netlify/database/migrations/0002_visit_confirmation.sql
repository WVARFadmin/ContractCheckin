-- Record which customer contact confirmed a fix, and when.
-- A visit can only change a contract's color when both are filled in.
ALTER TABLE visits ADD COLUMN confirmed_by TEXT;
ALTER TABLE visits ADD COLUMN confirmed_on DATE;
