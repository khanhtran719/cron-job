import dotenv from 'dotenv';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import sql from 'mssql';
import { join } from 'path';

dotenv.config();

export function log(message: string) {
  const timestamp = new Date().toISOString();
  const day = new Date().toISOString().split('T')[0];

  const path = join(process.cwd(), 'logs', `app-${day}.log`);

  if (!existsSync(join(process.cwd(), 'logs'))) {
    mkdirSync(join(process.cwd(), 'logs'), { recursive: true });
  }

  appendFileSync(path, `[${timestamp}] ${message}\n`);
}

// SETTING DATE TO REPLICATE
const DATES: string[] = ['2026-01-20', '2026-01-21', '2026-01-22', '2026-01-23', '2026-01-24', '2026-01-25'];

const NON_UPDATABLE_COLUMNS = ['id', 'rowguid'];

interface IColumnsCache {
  columns: string[];
  columnList: string;
  paramList: string;
  upsertList: string;
}
interface IDBConnection {
  connected: boolean;
  pool: sql.ConnectionPool | null;
}

class ConnectionService {
  private dbConnectionMap: Map<string, IDBConnection> = new Map();

  constructor() {}

  async intialize(branchs: any[]): Promise<void> {
    for (const branch of branchs) {
      try {
        const branchPool = new sql.ConnectionPool({
          user: branch.username,
          password: branch.password,
          server: branch.host,
          database: branch.database,
          port: branch.port,
          options: {
            encrypt: false,
            trustServerCertificate: true,
            requestTimeout: 60000,
            connectTimeout: 60000,
          },
          pool: {
            max: 10,
            min: 0,
            idleTimeoutMillis: 30000,
          },
        });

        await branchPool.connect();

        this.dbConnectionMap.set(branch.code, {
          connected: true,
          pool: branchPool,
        });
      } catch (err) {
        process.exitCode = 1;
        console.log(`Connecting to store: ${branch.code}`);
        console.log(`Error connecting to store:`, err);
      }
    }

    const masterPool = new sql.ConnectionPool({
      user: process.env.MASTER_DB_USER,
      password: process.env.MASTER_DB_PASSWORD,
      server: process.env.MASTER_DB_HOST!,
      database: process.env.MASTER_DB_NAME,
      port: Number(process.env.MASTER_DB_PORT!),
      options: {
        encrypt: false,
        trustServerCertificate: true,
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    });

    await masterPool.connect();

    this.dbConnectionMap.set('master', {
      connected: true,
      pool: masterPool,
    });
  }

  async getStorePool(branch: any): Promise<sql.ConnectionPool | null> {
    const connection = this.dbConnectionMap.get(branch.code);
    if (connection?.pool && !connection.pool.connected) await connection.pool.close();
    if (connection?.pool?.connected) {
      return connection.pool;
    } else {
      await new sql.ConnectionPool({
        user: branch.username,
        password: branch.password,
        server: branch.host,
        database: branch.database,
        port: branch.port,
        options: {
          encrypt: false,
          trustServerCertificate: true,
          requestTimeout: 60000,
          connectTimeout: 60000,
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
      }).connect()
        .then((connectionPool) => {
          this.dbConnectionMap.set(branch.code, {
            connected: true,
            pool: connectionPool,
          });
        })
        .catch((error) => {
          process.exitCode = 1;
          console.error('Error connecting to Icool database:', error);
        });

      const newConnection = this.dbConnectionMap.get(branch.code);
      return newConnection ? newConnection.pool : null;
    }
  }

  async getMasterPool(): Promise<sql.ConnectionPool | null> {
    const connection = this.dbConnectionMap.get('master');
    if (connection?.pool && !connection.pool.connected) await connection.pool.close();
    if (connection?.pool?.connected) {
      return connection.pool;
    } else {
      await new sql.ConnectionPool({
        user: process.env.MASTER_DB_USER,
        password: process.env.MASTER_DB_PASSWORD,
        server: process.env.MASTER_DB_HOST!,
        database: process.env.MASTER_DB_NAME,
        port: Number(process.env.MASTER_DB_PORT!),
        options: {
          encrypt: false,
          trustServerCertificate: true,
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
      }).connect()
        .then((connectionPool) => {
          this.dbConnectionMap.set('master', {
            connected: true,
            pool: connectionPool,
          });
        })
        .catch((error) => {
          process.exitCode = 1;
          console.error('Error connecting to Icool database:', error);
        });

      const newConnection = this.dbConnectionMap.get('master');
      return newConnection ? newConnection.pool : null;
    }
  }

  async getCetralPool(): Promise<sql.ConnectionPool | null> {
    const connection = this.dbConnectionMap.get('central');
    if (connection?.pool && !connection.pool.connected) await connection.pool.close();
    if (connection?.pool?.connected) {
      return connection.pool;
    } else {
      await new sql.ConnectionPool({
        user: process.env.CENTRAL_DB_USER,
        password: process.env.CENTRAL_DB_PASSWORD,
        server: process.env.CENTRAL_DB_HOST!,
        database: process.env.CENTRAL_DB_NAME,
        port: Number(process.env.CENTRAL_DB_PORT!),
        options: {
          encrypt: false,
          trustServerCertificate: true,
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
      }).connect()
        .then((connectionPool) => {
          this.dbConnectionMap.set('central', {
            connected: true,
            pool: connectionPool,
          });
        })
        .catch((error) => {
          process.exitCode = 1;
          console.error('Error connecting to Central database:', error);
        });

      const newConnection = this.dbConnectionMap.get('central');
      return newConnection ? newConnection.pool : null;
    }
  }
  async closeAll(): Promise<void> {
    const pools = [...new Set([...this.dbConnectionMap.values()].map((value) => value.pool))];
    this.dbConnectionMap.clear();
    const results = await Promise.allSettled(pools.map((pool) => pool?.close()));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
}

async function getInsertableColumns(pool: sql.ConnectionPool, tableName: string): Promise<IColumnsCache> {
  const result = await pool.request().query(`
    SELECT c.COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS c
    LEFT JOIN sys.columns sc
      ON sc.object_id = OBJECT_ID('${tableName}')
     AND sc.name = c.COLUMN_NAME
    WHERE c.TABLE_NAME = '${tableName}'
      AND sc.is_identity = 0
      AND c.DATA_TYPE <> 'timestamp'
    ORDER BY c.ORDINAL_POSITION
  `);

  const talbeWithId: string[] = ['HoaDon_Sub', 'HoaDon_Gift', 'HoaDon_MIFI'];
  if (!result.recordset.length) throw new Error(`No insertable columns found for ${tableName}`);

  const columns: string[] = [];

  let columnList = '';
  let paramList = '';
  let upsertList = '';

  if (talbeWithId.includes(tableName)) {
    result.recordset
      .filter((r) => r.COLUMN_NAME !== 'rowguid')
      .forEach((r) => {
        columns.push(r.COLUMN_NAME);
        columnList += `[${r.COLUMN_NAME}], `;
        paramList += `@${r.COLUMN_NAME}, `;
        if (!NON_UPDATABLE_COLUMNS.includes(r.COLUMN_NAME)) {
          upsertList += `[${r.COLUMN_NAME}] = @${r.COLUMN_NAME}, `;
        }
      });
  } else {
    result.recordset.forEach((r) => {
      columns.push(r.COLUMN_NAME);
      columnList += `[${r.COLUMN_NAME}], `;
      paramList += `@${r.COLUMN_NAME}, `;
      if (!NON_UPDATABLE_COLUMNS.includes(r.COLUMN_NAME)) {
        upsertList += `[${r.COLUMN_NAME}] = @${r.COLUMN_NAME}, `;
      }
    });
  }

  return {
    columns,
    columnList: columnList.slice(0, -2),
    paramList: paramList.slice(0, -2),
    upsertList: upsertList.slice(0, -2),
  };
}

async function rowInsertion(
  masterConnection: sql.ConnectionPool,
  tableName: string,
  columnList: string,
  paramList: string,
  upsertList: string,
  columns: string[],
  row: any,
  cuahang_id?: string,
) {
  const talbeWithId: string[] = ['HoaDon_Sub', 'HoaDon_Gift', 'HoaDon_MIFI'];

  let pkColumn = 'id';
  if (!talbeWithId.includes(tableName)) {
    if (columns.includes('rowguid')) {
      pkColumn = 'rowguid';
    }
  }

  try {
    const request = masterConnection.request();

    columns.forEach((col) => {
      request.input(col, row[col]);
    });

    // const insertQuery = `
    //   UPDATE ${tableName}
    //   SET ${upsertList}
    //   WHERE ${pkColumn} = @${pkColumn};

    //   -- 2. If no row updated → INSERT
    //   IF @@ROWCOUNT = 0
    //   BEGIN
    //     INSERT INTO ${tableName} (${columnList})
    //     VALUES (${paramList});
    //   END
    // `;

    const insertQuery = `
    IF NOT EXISTS (
        SELECT 1
        FROM ${tableName}
        WHERE ${pkColumn} = @${pkColumn}
    )
    BEGIN
        INSERT INTO ${tableName} (${columnList})
        VALUES (${paramList});
    END
  `;

    const inserted = await request.query(insertQuery);
    const isInserted = inserted.rowsAffected[0] > 0;

    console.log('Inserted into', tableName, pkColumn + ':', row[pkColumn], 'Status:', isInserted);

    return inserted;
  } catch (err) {
    process.exitCode = 1;
    log(`[${cuahang_id ?? null}] Error inserting row into ${tableName} with ${pkColumn} ${row[pkColumn]}` + `: ${err}`);
    return null;
  }
}

async function customerReplication(
  storeConnection: sql.ConnectionPool,
  masterConnection: sql.ConnectionPool,
  columnsCache: IColumnsCache,
  storeCode: string,
  date: string,
) {
  const { columns, columnList, paramList, upsertList } = columnsCache;

  try {
    const data = await storeConnection.request().query(`
      SELECT *
      FROM KhachHang
      WHERE coso = '${storeCode}' and created_date >= '${date} 00:00:00'
    `);

    console.log('--------------------CUSTOMER------------------------');
    console.log(`Customers for store ${storeCode} on date ${date}:`, data.recordset.length);

    if (data.recordset.length === 0) return;

    for (const row of data.recordset) {
      await rowInsertion(masterConnection, 'KhachHang', columnList, paramList, upsertList, columns, row);
    }
  } catch (error) {
    process.exitCode = 1;
    console.error('Error during customer replication:', error);
  }
}

// Replicate from Store to Master
export async function main() {
  const service = new ConnectionService();
  try {
    const jsonData = readFileSync(join(process.cwd(), 'secret', 'old-branchs.json'), 'utf-8');

    const branchs = JSON.parse(jsonData);

    await service.intialize(branchs);

    const targeConn = await service.getMasterPool();
    if (!targeConn) {
      throw new Error('Database connections could not be established.');
    }

    const columnsCache = new Map<string, IColumnsCache>();
    for (const table of ['KhachHang']) {
      const columns = await getInsertableColumns(targeConn!, table);
      columnsCache.set(table, columns);
    }

    for (const branch of branchs) {
      const originalConn = await service.getStorePool(branch);
      if (!originalConn) {
        process.exitCode = 1;
        console.error(`Connection to store ${branch.code} could not be established.`);
        continue;
      }

      for (const date of DATES) {
        await customerReplication(originalConn, targeConn, columnsCache.get('KhachHang')!, branch.code, date);
      }
    }
  } finally {
    await service.closeAll();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
