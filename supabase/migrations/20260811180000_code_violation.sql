-- Syracuse publishes code violations daily with the cited owner's name and
-- mailing address, which no other feed in this project does. A violation is not
-- a permit and not a sale: it is the city recording that something is wrong
-- with a property, which is the signal a restoration company or a flipper acts
-- on, so it gets its own value rather than being folded into an existing one.
--
-- Adding an enum value is a migration by design, see the note in the init
-- migration. The scoring presets key off these names.
alter type event_type add value if not exists 'CODE_VIOLATION';
