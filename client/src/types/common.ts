export type ApiResponse<T> = {
  data: T;
};

export type PaginatedResponse<T> = {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
    totalExact?: boolean;
    hasMore?: boolean;
    sortUsed?: string;
    tiempoMs?: number;
    expandedTerms?: string[];
    facets?: {
      salas: Array<{ value: string; count: number }>;
      years: Array<{ value: number; count: number }>;
    };
  };
};

export type ListResponse<T> = {
  data: T[];
};

export type Option = {
  label: string;
  value: string;
};
