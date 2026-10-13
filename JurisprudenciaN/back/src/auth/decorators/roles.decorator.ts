import { SetMetadata } from '@nestjs/common';
import { RoleName, ROLES_KEY } from '../constants';

export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
