DROP TABLE IF EXISTS desk_images;
DROP TABLE IF EXISTS desk_notes;
DELETE FROM trash_entries WHERE collection IN ('deskImages', 'deskNotes');
