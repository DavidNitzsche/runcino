CREATE TABLE "race_actuals" (
	"id" text PRIMARY KEY NOT NULL,
	"race_id" text NOT NULL,
	"source" text NOT NULL,
	"actual" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"race_id" text NOT NULL,
	"plan" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"course_slug" text NOT NULL,
	"race_date" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"goal_finish_s" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "race_actuals" ADD CONSTRAINT "race_actuals_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_plans" ADD CONSTRAINT "race_plans_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "races_slug_uq" ON "races" USING btree ("slug");