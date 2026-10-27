import { IsUUID } from 'class-validator';

export class ChangeOrganizationDto {
  @IsUUID()
  organizationId: string;
}
