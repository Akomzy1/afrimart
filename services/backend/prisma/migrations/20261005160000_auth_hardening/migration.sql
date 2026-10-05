-- AlterTable
ALTER TABLE "StaffUser" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failedMfaAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);


-- Append-only audit trail, enforced by the database rather than by convention.
--
-- A REVOKE on UPDATE/DELETE would be bypassed by a superuser, and this app
-- connects as one in development, so a revoke alone would give false comfort.
-- A trigger fires regardless of role, including for the owner, so it is the
-- control that actually holds. Inserts are untouched.
CREATE OR REPLACE FUNCTION afrimart_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLogEntry is append-only: % is not permitted', TG_OP
    USING HINT = 'Correct the record by writing a new entry, never by editing history.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_append_only ON "AuditLogEntry";
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLogEntry"
  FOR EACH ROW EXECUTE FUNCTION afrimart_audit_append_only();

-- Belt as well as braces: a non-superuser application role gets no grant for
-- these at all, so the trigger is the second line rather than the only one.
REVOKE UPDATE, DELETE ON "AuditLogEntry" FROM PUBLIC;
