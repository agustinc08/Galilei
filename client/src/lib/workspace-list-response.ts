export type PaginatedList<T> = {
  page: number;
  pageSize: number;
  total: number;
  results: T[];
};

/** Office's installed runtime returns a plain array; newer APIs return paging metadata. */
export function normalizeWorkspaceListResponse<T>(
  response: PaginatedList<T> | T[],
  requestedPageSize: number,
): PaginatedList<T> {
  if (Array.isArray(response)) {
    return {
      page: 1,
      pageSize: response.length || requestedPageSize,
      total: response.length,
      results: response,
    };
  }

  return response as PaginatedList<T>;
}
