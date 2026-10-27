import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AuditActorType {
  USER = 'user',
  SERVICE = 'service',
  SUPPORT = 'support',
  SYSTEM = 'system',
}

export enum AuditDecision {
  ALLOW = 'ALLOW',
  DENY = 'DENY',
  MFA_REQUIRED = 'MFA_REQUIRED',
  REAUTHENTICATION_REQUIRED = 'REAUTHENTICATION_REQUIRED',
  OUT_OF_SCOPE = 'OUT_OF_SCOPE',
}

@Index('ix_audit_events_org_time', ['organizationId', 'occurredAt'])
@Index('ix_audit_events_object', [
  'organizationId',
  'objectType',
  'objectId',
  'occurredAt',
])
@Index('ix_audit_events_correlation', ['correlationId'])
@Entity('audit_events')
export class AuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null;

  @Column({ name: 'actor_type', type: 'varchar', length: 16 })
  actorType: AuditActorType;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId?: string | null;

  @Column({ name: 'actor_membership_id', type: 'uuid', nullable: true })
  actorMembershipId?: string | null;

  @Column({
    name: 'service_principal',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  servicePrincipal?: string | null;

  @Column({ name: 'support_grant_id', type: 'uuid', nullable: true })
  supportGrantId?: string | null;

  @Column({ name: 'client_account_id', type: 'uuid', nullable: true })
  clientAccountId?: string | null;

  @Column({ name: 'legal_entity_id', type: 'uuid', nullable: true })
  legalEntityId?: string | null;

  @Column({ length: 100 })
  action: string;

  @Column({
    name: 'permission_key',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  permissionKey?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  decision?: AuditDecision | null;

  @Column({ name: 'object_type', length: 64 })
  objectType: string;

  @Column({ name: 'object_id', type: 'uuid', nullable: true })
  objectId?: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  reason?: string | null;

  @Column({ name: 'correlation_id', type: 'uuid' })
  correlationId: string;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress?: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;
}
