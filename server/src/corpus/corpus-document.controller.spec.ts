import { BadRequestException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import {
  CorpusDocumentController,
  PublicCorpusDocumentController,
} from './corpus-document.controller';

describe('Corpus document page query validation', () => {
  const user = {
    rol: { nombre: 'LECTOR' },
  } as AuthenticatedUser;

  it.each(['0', '-1', '1.5', 'NaN', '100001'])(
    'rejects invalid authenticated pageNumber %s before reading the document',
    (pageNumber) => {
      const documents = { metadata: jest.fn() };
      const controller = new CorpusDocumentController(documents as never);

      expect(() => controller.metadata('doc-1', pageNumber, user)).toThrow(
        BadRequestException,
      );
      expect(documents.metadata).not.toHaveBeenCalled();
    },
  );

  it('passes a positive physical page to the authorized metadata reader', async () => {
    const documents = { metadata: jest.fn() };
    const controller = new CorpusDocumentController(documents as never);

    await controller.metadata('doc-1', '17', user);

    expect(documents.metadata).toHaveBeenCalledWith('doc-1', 'INTERNAL', 17);
  });

  it('rejects invalid public pageNumber before reading document metadata', () => {
    const documents = { metadata: jest.fn() };
    const controller = new PublicCorpusDocumentController(documents as never);

    expect(() => controller.metadata('doc-public', '2.2')).toThrow(
      BadRequestException,
    );
    expect(documents.metadata).not.toHaveBeenCalled();
  });
});
