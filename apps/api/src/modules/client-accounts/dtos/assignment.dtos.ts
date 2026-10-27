import { IsEnum, IsUUID } from 'class-validator';
import { AssignmentResponsibility } from '../entities/account-assignment.entity';

export class CreateAccountAssignmentDto {
  @IsUUID(undefined, { message: 'Selecciona un integrante válido.' })
  membershipId: string;

  @IsEnum(AssignmentResponsibility, {
    message: 'Selecciona una responsabilidad válida.',
  })
  responsibility: AssignmentResponsibility;
}
