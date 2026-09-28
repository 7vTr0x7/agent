declare module "pg" {
  export interface QueryResultRow {
    [column: string]: any;
  }

  export interface QueryResult<T extends QueryResultRow = any> {
    command: string;
    rowCount: number | null;
    oid: number;
    fields: Array<{ name: string; dataTypeID: number }>;
    rows: T[];
  }

  export interface PoolConfig {
    connectionString?: string;
    max?: number;
    idleTimeoutMillis?: number;
    [key: string]: any;
  }

  export interface PoolClient {
    query<T extends QueryResultRow = any>(text: string, values?: any[]): Promise<QueryResult<T>>;
    release(error?: Error | boolean): void;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    query<T extends QueryResultRow = any>(text: string, values?: any[]): Promise<QueryResult<T>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}
