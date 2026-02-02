import dotenv from 'dotenv';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
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
const DATES: string[] = [
  '2026-01-20',
  '2026-01-21',
  '2026-01-22',
  '2026-01-23',
  '2026-01-24',
  '2026-01-25',
  '2026-01-26',
  '2026-01-27',
];

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

  async intialize(): Promise<void> {
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

    const centralPool = new sql.ConnectionPool({
      user: process.env.CENTRAL_DB_USER,
      password: process.env.CENTRAL_DB_PASSWORD,
      server: process.env.CENTRAL_DB_HOST!,
      database: process.env.CENTRAL_DB_NAME,
      port: Number(process.env.CENTRAL_DB_PORT!),
      options: {
        encrypt: false,
        trustServerCertificate: true,
        requestTimeout: 60000,
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    });

    await centralPool.connect();

    this.dbConnectionMap.set('central', {
      connected: true,
      pool: centralPool,
    });
  }

  async getMasterPool(): Promise<sql.ConnectionPool | null> {
    const connection = this.dbConnectionMap.get('master');
    if (connection && connection.connected) {
      return connection.pool;
    } else {
      await sql
        .connect({
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
        })
        .then((connectionPool) => {
          this.dbConnectionMap.set('master', {
            connected: true,
            pool: connectionPool,
          });
        })
        .catch((error) => {
          console.error('Error connecting to Icool database:', error);
        });

      const newConnection = this.dbConnectionMap.get('master');
      return newConnection ? newConnection.pool : null;
    }
  }

  async getCetralPool(): Promise<sql.ConnectionPool | null> {
    const connection = this.dbConnectionMap.get('central');
    if (connection && connection.connected) {
      return connection.pool;
    } else {
      await sql
        .connect({
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
        })
        .then((connectionPool) => {
          this.dbConnectionMap.set('central', {
            connected: true,
            pool: connectionPool,
          });
        })
        .catch((error) => {
          console.error('Error connecting to Central database:', error);
        });

      const newConnection = this.dbConnectionMap.get('central');
      return newConnection ? newConnection.pool : null;
    }
  }
}

async function getInsertableColumns(
  pool: sql.ConnectionPool,
  tableName: string,
): Promise<IColumnsCache> {
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

    const insertQuery = `
      UPDATE ${tableName}
      SET ${upsertList}
      WHERE ${pkColumn} = @${pkColumn};

      -- 2. If no row updated → INSERT
      IF @@ROWCOUNT = 0
      BEGIN
        INSERT INTO ${tableName} (${columnList})
        VALUES (${paramList});
      END
    `;

    const inserted = await request.query(insertQuery);
    const isInserted = inserted.rowsAffected[0] > 0;

    console.log(
      'Inserted into',
      tableName,
      pkColumn + ':',
      row[pkColumn],
      'Status:',
      isInserted,
    );

    return inserted;
  } catch (err) {
    log(
      `[${
        cuahang_id ?? null
      }] Error inserting row into ${tableName} with ${pkColumn} ${
        row[pkColumn]
      }` + `: ${err}`,
    );
    return null;
  }
}

async function shiftReplication(
  storeConnection: sql.ConnectionPool,
  masterConnection: sql.ConnectionPool,
  columnsCache: IColumnsCache,
  storeCode: string,
  date: string,
) {
  try {
    const { columns, columnList, paramList, upsertList } = columnsCache;

    const data = await storeConnection.request().query(`
      SELECT *
      FROM Ca
      WHERE date = '${date}' and cuahang_id = '${storeCode}'
    `);

    console.log('--------------------SHIFT------------------------');
    console.log(
      `Shifts for store ${storeCode} on date ${date}:`,
      data.recordset.length,
    );

    if (data.recordset.length === 0) return [];
    const shiftIds: string[] = [];
    for (const row of data.recordset) {
      shiftIds.push(row.id);

      await rowInsertion(
        masterConnection,
        'Ca',
        columnList,
        paramList,
        upsertList,
        columns,
        row,
      );
    }

    return shiftIds;
  } catch (err) {
    console.error('Error during shift replication:', err);
    return [];
  }
}

async function invoiceReplication(
  storeConnection: sql.ConnectionPool,
  masterConnection: sql.ConnectionPool,
  columnsCache: IColumnsCache,
  shiftIds: string[],
  storeCode?: string,
) {
  const { columns, columnList, paramList, upsertList } = columnsCache;

  try {
    const data = await storeConnection.request().query(`
      SELECT *
      FROM HoaDon
      WHERE ca_id IN (${shiftIds.map((id) => `'${id}'`).join(', ')})
    `);

    console.log('--------------------INVOICE------------------------');
    console.log(
      `Invoices for shifts [${shiftIds.join(', ')}]:`,
      data.recordset.length,
    );

    if (data.recordset.length === 0) return [];

    const ids: string[] = [];
    for (const row of data.recordset) {
      ids.push(row.id);

      await rowInsertion(
        masterConnection,
        'HoaDon',
        columnList,
        paramList,
        upsertList,
        columns,
        row,
        storeCode,
      );
    }

    return ids;
  } catch (error) {
    console.error('Error during invoice replication:', error);
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
      WHERE coso = '${storeCode}' and created_date >= '${date}'
    `);

    console.log('--------------------CUSTOMER------------------------');
    console.log(
      `Customers for store ${storeCode} on date ${date}:`,
      data.recordset.length,
    );

    if (data.recordset.length === 0) return;

    for (const row of data.recordset) {
      await rowInsertion(
        masterConnection,
        'KhachHang',
        columnList,
        paramList,
        upsertList,
        columns,
        row,
        storeCode,
      );
    }
  } catch (error) {
    console.error('Error during customer replication:', error);
  }
}

async function chiphiReplication(
  storeConnection: sql.ConnectionPool,
  masterConnection: sql.ConnectionPool,
  columnsCache: IColumnsCache,
  date: string,
) {
  const { columns, columnList, paramList, upsertList } = columnsCache;

  const month = new Date(date).getMonth() + 1;
  const year = new Date(date).getFullYear();

  try {
    const data = await storeConnection.request().query(`
      SELECT *
      FROM ChiPhi
      WHERE month = ${month} AND year = ${year}
    `);

    console.log('--------------------CUSTOMER------------------------');
    console.log(
      `ChiPhi for month ${month} and year ${year}:`,
      data.recordset.length,
    );

    if (data.recordset.length === 0) return;

    for (const row of data.recordset) {
      await rowInsertion(
        masterConnection,
        'ChiPhi',
        columnList,
        paramList,
        upsertList,
        columns,
        row,
      );
    }
  } catch (error) {
    console.error('Error during customer replication:', error);
  }
}

async function fullTablesReplication(
  storeConnection: sql.ConnectionPool,
  masterConnection: sql.ConnectionPool,
  columnsCache: IColumnsCache,
  invoiceIds: string[],
  tableName: string,
  storeCode: string,
) {
  const { columns, columnList, paramList, upsertList } = columnsCache;

  try {
    let field = 'bill_id';
    if (tableName === 'HoaDon_Sub') field = 'source_id';

    const data = await storeConnection.request().query(`
      SELECT *
      FROM ${tableName} 
      WHERE ${field} IN (${invoiceIds.map((b) => `'${b}'`).join(', ')})
    `);

    console.log(
      '--------------------' + tableName + '------------------------',
    );
    console.log(
      `Records for table ${tableName} and invoices [${invoiceIds.join(', ')}]:`,
      data.recordset.length,
    );
    if (data.recordset.length === 0) return;

    for (const row of data.recordset) {
      await rowInsertion(
        masterConnection,
        tableName,
        columnList,
        paramList,
        upsertList,
        columns,
        row,
        storeCode,
      );
    }
  } catch (error) {
    console.error(
      `Error during full replication of table ${tableName}:`,
      error,
    );
  }
}

async function revenueTablesReplication(
  storeConnection: sql.ConnectionPool,
  masterConnection: sql.ConnectionPool,
  columnsCache: IColumnsCache,
  date: string,
  tableName: string,
  storeCode: string,
) {
  const { columns, columnList, paramList, upsertList } = columnsCache;

  try {
    const data = await storeConnection.request().query(`
      SELECT *
      FROM ${tableName} 
      WHERE cuahang_id = '${storeCode}' and date = '${date}'
    `);

    console.log(
      '--------------------' + tableName + '------------------------',
    );
    console.log(
      `Records for table ${tableName} and date [${date}]:`,
      data.recordset.length,
    );
    if (data.recordset.length === 0) return;

    for (const row of data.recordset) {
      await rowInsertion(
        masterConnection,
        tableName,
        columnList,
        paramList,
        upsertList,
        columns,
        row,
        storeCode,
      );
    }
  } catch (error) {
    console.error(
      `Error during revenue replication of table ${tableName}:`,
      error,
    );
  }
}

// Replicate from Store to Master
(async () => {
  const tables: string[] = [
    'HoaDon_ChiTietHangHoa',
    'HoaDon_Combo_HangHoa',
    'HoaDon_Coupon',
    'HoaDon_Customer',
    'HoaDon_DiscountOnSales',
    'HoaDon_DoanhThu_NhanVien',
    'HoaDon_HinhThucThanhToan',
    'HoaDon_GiamGia',
    'HoaDon_Gift',
    'HoaDon_Info',
    'HoaDon_KhachHang',
    'HoaDon_MIFI',
    'HoaDon_NVL',
    'HoaDon_PhuPhi',
    'HoaDon_Sub',
    'HoaDon_TraMon',
    'HoaDon_VAT',
  ];

  const revenueTables: string[] = ['ChiTieu', 'DoanhThu', 'DoanhThu_NhanVien'];

  const service = new ConnectionService();
  await service.intialize();

  const originalConn = await service.getMasterPool();
  const targeConn = await service.getCetralPool();
  if (!targeConn || !originalConn) {
    console.error('Database connections could not be established.');
    return;
  }

  const columnsCache = new Map<string, IColumnsCache>();
  for (const table of [
    ...tables,
    ...revenueTables,
    'Ca',
    'HoaDon',
    'KhachHang',
    'ChiPhi',
  ]) {
    const columns = await getInsertableColumns(targeConn!, table);
    columnsCache.set(table, columns);
  }

  for (const date of DATES) {
    try {
      const [shiftIds] = await Promise.all([
        shiftReplication(
          originalConn,
          targeConn,
          columnsCache.get('Ca')!,
          '25',
          date,
        ),
        // customerReplication(
        //   originalConn,
        //   targeConn,
        //   columnsCache.get('KhachHang')!,
        //   branch.code,
        //   date,
        // ),
        chiphiReplication(
          originalConn,
          targeConn,
          columnsCache.get('ChiPhi')!,
          date,
        ),
      ]);
      if (!shiftIds?.length) continue;

      const invoiceIds = await invoiceReplication(
        originalConn,
        targeConn,
        columnsCache.get('HoaDon')!,
        shiftIds,
        '25',
      );
      if (!invoiceIds || !invoiceIds.length) continue;

      for (const table of tables) {
        await fullTablesReplication(
          originalConn,
          targeConn,
          columnsCache.get(table)!,
          invoiceIds,
          table,
          '25',
        );
      }

      for (const table of revenueTables) {
        await revenueTablesReplication(
          originalConn,
          targeConn,
          columnsCache.get(table)!,
          date,
          table,
          '25',
        );
      }
    } catch (error) {
      console.error(`Error processing branch 25:`, error);
    }
  }
})();
