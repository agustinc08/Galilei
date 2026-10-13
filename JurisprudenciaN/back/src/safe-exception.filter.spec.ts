import { InternalServerErrorException } from '@nestjs/common';
import { SafeExceptionFilter } from './safe-exception.filter';

function hostFor(response: { headersSent?: boolean } = {}) {
  const output: { status?: number; body?: unknown } = {};
  const responseMock = {
    ...response,
    getHeader: (name: string) => name === 'X-Request-Id' ? 'test-request-123' : undefined,
    status: (status: number) => { output.status = status; return responseMock; },
    json: (body: unknown) => { output.body = body; return body; },
    end: jest.fn(),
  };
  const requestMock = { method: 'GET', route: { path: '/api/corpus/documents/:id' } };
  const context = {
    switchToHttp: () => ({ getRequest: () => requestMock, getResponse: () => responseMock }),
  };
  return { context: context as never, output, responseMock };
}

describe('SafeExceptionFilter', () => {
  it('hides internal 5xx details and returns a request ID', () => {
    const filter = new SafeExceptionFilter();
    const { context, output } = hostFor();
    filter.catch(new InternalServerErrorException('SELECT * FROM private_table at C:\\secret\\file.ts'), context);
    expect(output.status).toBe(500);
    expect(output.body).toEqual({ statusCode: 500, message: 'No se pudo completar la solicitud. Informá el identificador de seguimiento.', requestId: 'test-request-123' });
    expect(JSON.stringify(output.body)).not.toContain('private_table');
  });

  it('ends safely when the response already started', () => {
    const filter = new SafeExceptionFilter();
    const { context, output, responseMock } = hostFor({ headersSent: true });
    filter.catch(new Error('secret'), context);
    expect(responseMock.end).toHaveBeenCalled();
    expect(output.body).toBeUndefined();
  });
});
