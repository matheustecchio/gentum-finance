-- Preserve existing categories and references as roots. Existing profiles opt in.
ALTER TABLE category ADD COLUMN parent_id UUID;
ALTER TABLE category ADD CONSTRAINT category_parent_owner FOREIGN KEY(user_id,parent_id) REFERENCES category(user_id,id);
ALTER TABLE category ADD CONSTRAINT category_not_self CHECK(parent_id IS NULL OR parent_id<>id);
ALTER TABLE category DROP CONSTRAINT category_user_id_name_kind_key;
-- Legacy case variants remain intact. Application writes reject normalized duplicates.
CREATE INDEX category_sibling_lookup ON category(user_id,kind,parent_id,lower(btrim(name)));

-- Enforce hierarchy and new normalized siblings without rewriting legacy labels.
CREATE FUNCTION validate_category_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM id FROM gentum_user WHERE id=NEW.user_id FOR UPDATE;
    IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM category WHERE id=NEW.parent_id AND user_id=NEW.user_id
        AND kind=NEW.kind AND parent_id IS NULL AND id<>NEW.id
    ) THEN RAISE EXCEPTION 'Category parent must be an owned root of the same kind'; END IF;
    IF NEW.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM category WHERE parent_id=NEW.id) THEN
        RAISE EXCEPTION 'A root with children cannot become a child';
    END IF;
    IF EXISTS (SELECT 1 FROM category WHERE parent_id=NEW.id AND (kind<>NEW.kind OR user_id<>NEW.user_id)) THEN
        RAISE EXCEPTION 'Category children must retain their owner and kind';
    END IF;
    IF EXISTS (SELECT 1 FROM category WHERE user_id=NEW.user_id AND kind=NEW.kind
        AND parent_id IS NOT DISTINCT FROM NEW.parent_id AND id<>NEW.id
        AND lower(btrim(name))=lower(btrim(NEW.name))) THEN
        RAISE EXCEPTION 'Duplicate category sibling';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER category_hierarchy BEFORE INSERT OR UPDATE ON category
FOR EACH ROW EXECUTE FUNCTION validate_category_hierarchy();
