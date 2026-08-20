INSERT INTO "stage_durations" ("stage", "standard_days") VALUES
  ('RECEIVED', 1),
  ('EXTRACTION', 5),
  ('QUANTIFICATION', 2),
  ('LIBRARY_PREP', 6),
  ('SEQUENCING', 3),
  ('BIOINFORMATICS', 2),
  ('REVIEW', 2),
  ('DELIVERED', 0)
ON CONFLICT ("stage") DO UPDATE
SET "standard_days" = EXCLUDED."standard_days";
