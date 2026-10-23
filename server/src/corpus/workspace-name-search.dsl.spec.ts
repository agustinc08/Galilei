import { buildWorkspaceNameSearchDsl } from './workspace-name-search.dsl';

describe('workspace document name search DSL', () => {
  it('uses case-insensitive literal contains matching with workspace and ACL scope', () => {
    const query = buildWorkspaceNameSearchDsl({
      workspaceId: 'workspace-1',
      userId: 19,
      term: 'Acta 50%_?',
      dateRange: {},
    });
    const serialized = JSON.stringify(query);
    expect(serialized).toContain('"workspaceId":"workspace-1"');
    expect(serialized).toContain('"aclPrincipalIds":"19"');
    expect(serialized).toContain('"documentScope":"PRIVATE_WORKSPACE"');
    expect(serialized).toContain('"field":"ownerUserId"');
    expect(serialized).toContain('"value":"*Acta 50%_\\\\?*"');
    expect(serialized).toContain('"case_insensitive":true');
    expect(serialized).toContain('workspaceNameFields.title');
    expect(serialized).toContain('workspaceNameFields.filename');
  });

  it('constrains root folder, manual uploads, MIME and inclusive date range', () => {
    const query = buildWorkspaceNameSearchDsl({
      workspaceId: 'workspace-1',
      userId: 19,
      term: 'civil',
      folderId: null,
      sourceId: '__manual_upload__',
      types: ['PDF'],
      dateRange: { dateFrom: '2024-01-01', dateTo: '2024-12-31' },
    });
    const serialized = JSON.stringify(query);
    expect(serialized).toContain('"field":"folderId"');
    expect(serialized).toContain('"sourceWorkspaceIds":"workspace-1"');
    expect(serialized).toContain('"mimeType":["application/pdf"]');
    expect(serialized).toContain('"gte":"2024-01-01"');
    expect(serialized).toContain('"lt":"2025-01-01"');
  });

  it('matches descendants of a normalized source folder and an exact source ID', () => {
    const query = buildWorkspaceNameSearchDsl({
      workspaceId: 'workspace-1',
      userId: 19,
      term: 'memo',
      sourceId: 'source-1',
      sourceFolder: 'Juzgado\\Civil',
      dateRange: {},
    });
    const serialized = JSON.stringify(query);
    expect(serialized).toContain('"path":"sourceFileScopes"');
    expect(serialized).toContain('"sourceFileScopes.sourceId":"source-1"');
    expect(serialized).toContain(
      '"sourceFileScopes.workspaceId":"workspace-1"',
    );
    expect(serialized).toContain(
      '"sourceFileScopes.normalizedPath":"Juzgado\\\\Civil"',
    );
    expect(serialized).toContain(
      '"prefix":{"sourceFileScopes.normalizedPath":"Juzgado\\\\Civil\\\\"}',
    );
  });
});
