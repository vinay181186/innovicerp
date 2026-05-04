ALTER TABLE "job_cards" ADD COLUMN "parent_nc_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_parent_nc_id_nc_register_id_fk" FOREIGN KEY ("parent_nc_id") REFERENCES "public"."nc_register"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_cards_parent_nc_idx" ON "job_cards" USING btree ("parent_nc_id") WHERE "job_cards"."parent_nc_id" is not null;