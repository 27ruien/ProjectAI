DELETE FROM "sessions"
USING "users"
WHERE "sessions"."user_id" = "users"."id"
  AND lower("users"."email") LIKE '%@test.projectai.local';--> statement-breakpoint
DELETE FROM "accounts"
USING "users"
WHERE "accounts"."user_id" = "users"."id"
  AND "accounts"."provider_id" = 'credential'
  AND lower("users"."email") LIKE '%@test.projectai.local';
