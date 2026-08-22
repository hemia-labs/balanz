import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1787379919825 implements MigrationInterface {
    name = 'Migration1787379919825'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "audit_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "actor_type" character varying(16) NOT NULL, "actor_user_id" uuid, "actor_membership_id" uuid, "service_principal" character varying(160), "support_grant_id" uuid, "client_account_id" uuid, "legal_entity_id" uuid, "action" character varying(100) NOT NULL, "permission_key" character varying(80), "decision" character varying(32), "object_type" character varying(64) NOT NULL, "object_id" uuid, "reason" character varying(1000), "correlation_id" uuid NOT NULL, "ip_address" inet, "metadata" jsonb NOT NULL DEFAULT '{}', "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_910f64d901a5c3e9878f0d4a407" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "ix_audit_events_correlation" ON "audit_events"  ("correlation_id") `);
        await queryRunner.query(`CREATE INDEX "ix_audit_events_object" ON "audit_events"  ("organization_id", "object_type", "object_id", "occurred_at") `);
        await queryRunner.query(`CREATE INDEX "ix_audit_events_org_time" ON "audit_events"  ("organization_id", "occurred_at") `);
        await queryRunner.query(`CREATE TYPE "public"."auth_factors_status_enum" AS ENUM('pending', 'active', 'revoked')`);
        await queryRunner.query(`CREATE TABLE "auth_factors" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "secret_encrypted" text NOT NULL, "status" "public"."auth_factors_status_enum" NOT NULL, "verified_at" TIMESTAMP WITH TIME ZONE, "last_used_at" TIMESTAMP WITH TIME ZONE, "last_used_counter" bigint, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_27ed6cb91570052a8e43ea4eaba" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_auth_factors_user_current" ON "auth_factors"  ("user_id") WHERE status IN ('pending', 'active')`);
        await queryRunner.query(`CREATE INDEX "idx_auth_factors_user_status" ON "auth_factors"  ("user_id", "status") `);
        await queryRunner.query(`CREATE TABLE "auth_rate_limits" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scope" character varying(40) NOT NULL, "key_hash" character varying(64) NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "window_started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c90ee53e4c13e4c3f61d4f97da0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_auth_rate_limits_expiry" ON "auth_rate_limits"  ("expires_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_auth_rate_limits_scope_key" ON "auth_rate_limits"  ("scope", "key_hash") `);
        await queryRunner.query(`CREATE TABLE "email_verification_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_417a095bbed21c2369a6a01ab9a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_email_verification_tokens_user_expires" ON "email_verification_tokens"  ("user_id", "expires_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_email_verification_tokens_hash" ON "email_verification_tokens"  ("token_hash") `);
        await queryRunner.query(`CREATE TYPE "public"."email_outbox_status_enum" AS ENUM('pending', 'processing', 'sent', 'failed')`);
        await queryRunner.query(`CREATE TABLE "email_outbox" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "token_id" uuid NOT NULL, "kind" character varying(80) NOT NULL, "payload" jsonb NOT NULL DEFAULT '{}', "status" "public"."email_outbox_status_enum" NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "available_at" TIMESTAMP WITH TIME ZONE NOT NULL, "sent_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b6fbfc201f705fbf1ac87bd7197" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_email_outbox_status_available_at" ON "email_outbox"  ("status", "available_at") `);
        await queryRunner.query(`CREATE TYPE "public"."memberships_role_enum" AS ENUM('owner', 'accountant', 'collaborator')`);
        await queryRunner.query(`CREATE TYPE "public"."memberships_status_enum" AS ENUM('pending', 'active', 'suspended', 'revoked')`);
        await queryRunner.query(`CREATE TABLE "memberships" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" "public"."memberships_role_enum" NOT NULL, "status" "public"."memberships_status_enum" NOT NULL, "invited_at" TIMESTAMP WITH TIME ZONE, "joined_at" TIMESTAMP WITH TIME ZONE, "suspended_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_25d28bd932097a9e90495ede7b4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_memberships_organization_user" ON "memberships"  ("organization_id", "user_id") `);
        await queryRunner.query(`CREATE TYPE "public"."organizations_status_enum" AS ENUM('active', 'suspended', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "organizations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(160) NOT NULL, "legal_name" character varying(200), "slug" character varying(100) NOT NULL, "billing_email" character varying(320), "timezone" character varying(64) NOT NULL DEFAULT 'America/Mexico_City', "owner_user_id" uuid NOT NULL, "status" "public"."organizations_status_enum" NOT NULL, "suspended_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6b031fcd0863e3f6b44230163f9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_organizations_slug" ON "organizations"  ("slug") `);
        await queryRunner.query(`CREATE TYPE "public"."auth_sessions_status_enum" AS ENUM('active', 'expired', 'revoked')`);
        await queryRunner.query(`CREATE TABLE "auth_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "session_token_hash" character varying(64) NOT NULL, "user_id" uuid NOT NULL, "membership_id" uuid, "organization_id" uuid, "status" "public"."auth_sessions_status_enum" NOT NULL, "mfa_verified_at" TIMESTAMP WITH TIME ZONE, "requires_mfa" boolean NOT NULL DEFAULT false, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_activity_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ip_address" character varying(45), "user_agent" character varying(512), "revoked_reason" character varying(100), "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_641507381f32580e8479efc36cd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_auth_sessions_membership_status" ON "auth_sessions"  ("organization_id", "membership_id", "status", "expires_at") `);
        await queryRunner.query(`CREATE INDEX "idx_auth_sessions_user_status" ON "auth_sessions"  ("user_id", "status", "expires_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_auth_sessions_token_hash" ON "auth_sessions"  ("session_token_hash") `);
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_status_enum" AS ENUM('pending', 'trialing')`);
        await queryRunner.query(`CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "subscription_type" character varying(100) NOT NULL, "status" "public"."subscriptions_status_enum" NOT NULL, "trial_started_at" TIMESTAMP WITH TIME ZONE, "trial_ends_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_subscriptions_organization_id" ON "subscriptions"  ("organization_id") `);
        await queryRunner.query(`CREATE TYPE "public"."users_status_enum" AS ENUM('active', 'suspended')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "first_name" character varying(100) NOT NULL, "last_name" character varying(100) NOT NULL, "email" character varying(320) NOT NULL, "email_verified_at" TIMESTAMP WITH TIME ZONE, "phone_e164" character varying(16), "phone_verified_at" TIMESTAMP WITH TIME ZONE, "locale" character varying(10) NOT NULL DEFAULT 'es-MX', "timezone" character varying(64) NOT NULL DEFAULT 'America/Mexico_City', "status" "public"."users_status_enum" NOT NULL DEFAULT 'active', "last_login_at" TIMESTAMP WITH TIME ZONE, "password_hash" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_users_status_last_login_at" ON "users"  ("status", "last_login_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."idx_users_status_last_login_at"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."uq_subscriptions_organization_id"`);
        await queryRunner.query(`DROP TABLE "subscriptions"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."uq_auth_sessions_token_hash"`);
        await queryRunner.query(`DROP INDEX "public"."idx_auth_sessions_user_status"`);
        await queryRunner.query(`DROP INDEX "public"."idx_auth_sessions_membership_status"`);
        await queryRunner.query(`DROP TABLE "auth_sessions"`);
        await queryRunner.query(`DROP TYPE "public"."auth_sessions_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."uq_organizations_slug"`);
        await queryRunner.query(`DROP TABLE "organizations"`);
        await queryRunner.query(`DROP TYPE "public"."organizations_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."uq_memberships_organization_user"`);
        await queryRunner.query(`DROP TABLE "memberships"`);
        await queryRunner.query(`DROP TYPE "public"."memberships_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."memberships_role_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_email_outbox_status_available_at"`);
        await queryRunner.query(`DROP TABLE "email_outbox"`);
        await queryRunner.query(`DROP TYPE "public"."email_outbox_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."uq_email_verification_tokens_hash"`);
        await queryRunner.query(`DROP INDEX "public"."idx_email_verification_tokens_user_expires"`);
        await queryRunner.query(`DROP TABLE "email_verification_tokens"`);
        await queryRunner.query(`DROP INDEX "public"."uq_auth_rate_limits_scope_key"`);
        await queryRunner.query(`DROP INDEX "public"."idx_auth_rate_limits_expiry"`);
        await queryRunner.query(`DROP TABLE "auth_rate_limits"`);
        await queryRunner.query(`DROP INDEX "public"."idx_auth_factors_user_status"`);
        await queryRunner.query(`DROP INDEX "public"."uq_auth_factors_user_current"`);
        await queryRunner.query(`DROP TABLE "auth_factors"`);
        await queryRunner.query(`DROP TYPE "public"."auth_factors_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."ix_audit_events_org_time"`);
        await queryRunner.query(`DROP INDEX "public"."ix_audit_events_object"`);
        await queryRunner.query(`DROP INDEX "public"."ix_audit_events_correlation"`);
        await queryRunner.query(`DROP TABLE "audit_events"`);
    }

}
