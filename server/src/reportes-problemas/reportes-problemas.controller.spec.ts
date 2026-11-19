import { ROLES_KEY } from '../auth/constants';
import {
  AdminReportesProblemaController,
  ReportesProblemaController,
} from './reportes-problemas.controller';

describe('report problem access policy', () => {
  it('allows authenticated roles to submit but reserves management for ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ReportesProblemaController)).toEqual([
      'ADMIN',
      'OPERADOR',
      'LECTOR',
      'REVISOR',
      'JURISPRUDENCIA',
      'DIGESTO',
    ]);
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminReportesProblemaController),
    ).toEqual(['ADMIN']);
  });
});
