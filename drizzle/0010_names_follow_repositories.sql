-- A project is named after its repository (decided 2026-10-08).
UPDATE "projects" SET "name" = split_part("repository", '/', 2);
