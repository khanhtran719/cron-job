import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import sql from 'mssql';
import { join } from 'path';

dotenv.config();

// SETTING DATE TO REPLICATE
const DATES: string[] = [
  '2026-01-19',
  '2026-01-20',
  '2026-01-21',
  '2026-01-22',
  '2026-01-23',
];

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

const NON_UPDATABLE_COLUMNS = ['id', 'rowguid'];

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
        requestTimeout: 60000,
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

  async getStorePool(branch: any): Promise<sql.ConnectionPool | null> {
    const connection = this.dbConnectionMap.get(branch.code);
    if (connection && connection.connected) {
      return connection.pool;
    } else {
      await sql
        .connect({
          user: branch.username,
          password: branch.password,
          server: branch.host,
          database: branch.database,
          port: branch.port,
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
        })
        .then((connectionPool) => {
          this.dbConnectionMap.set(branch.code, {
            connected: true,
            pool: connectionPool,
          });
        })
        .catch((error) => {
          console.error('Error connecting to Icool database:', error);
        });

      const newConnection = this.dbConnectionMap.get(branch.code);
      return newConnection ? newConnection.pool : null;
    }
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
            requestTimeout: 60000,
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
            requestTimeout: 60000,
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

  const columns: string[] = [];
  let columnList = '';
  let paramList = '';
  let upsertList = '';
  result.recordset.forEach((r) => {
    columns.push(r.COLUMN_NAME);
    columnList += `[${r.COLUMN_NAME}], `;
    paramList += `@${r.COLUMN_NAME}, `;
    if (!NON_UPDATABLE_COLUMNS.includes(r.COLUMN_NAME)) {
      upsertList += `[${r.COLUMN_NAME}] = @${r.COLUMN_NAME}, `;
    }
  });

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
) {
  try {
    const request = masterConnection.request();

    columns.forEach((col) => {
      request.input(col, row[col]);
    });

    const insertQuery = `
      MERGE ${tableName} AS target
      USING (SELECT @id AS id) AS source
        ON target.id = source.id
      WHEN MATCHED THEN
        UPDATE SET ${upsertList}
      WHEN NOT MATCHED THEN
        INSERT (${columnList})
        VALUES (${paramList});
    `;

    const inserted = await request.query(insertQuery);
    const isInserted = inserted.rowsAffected[0] > 0;

    console.log(
      'Inserted into',
      tableName,
      'ID:',
      row['id'],
      'Status:',
      isInserted,
    );

    return inserted;
  } catch (err) {
    console.error(`Error inserting row into ${tableName}:`, err);
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

async function feeReplication(
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
      FROM ChiTieu
      WHERE cuahang_id = '${storeCode}' and date = '${date}'
    `);

    console.log('--------------------CHIPHI------------------------');
    console.log(
      `Fees for store ${storeCode} on date ${date}:`,
      data.recordset.length,
    );
    if (data.recordset.length === 0) return;

    for (const row of data.recordset) {
      await rowInsertion(
        masterConnection,
        'ChiTieu',
        columnList,
        paramList,
        upsertList,
        columns,
        row,
      );
    }
  } catch (error) {
    console.error('Error during fee replication:', error);
  }
}

async function invoiceReplication(
  storeConnection: sql.ConnectionPool,
  masterConnection: sql.ConnectionPool,
  columnsCache: IColumnsCache,
  shiftIds: string[],
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
      );
    }
  } catch (error) {
    console.error(
      `Error during full replication of table ${tableName}:`,
      error,
    );
  }
}

// Replicate from Store to Master
(async () => {
  const jsonData = readFileSync(
    join(process.cwd(), 'secret', 'branch.json'),
    'utf-8',
  );

  const tables: string[] = [
    'HoaDon_ChiTietHangHoa',
    'HoaDon_Combo_HangHoa',
    'HoaDon_Coupon',
    'HoaDon_Customer',
    'HoaDon_DiscountOnSales',
    'HoaDon_DoanhThu_NhanVien',
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

  const branchs = JSON.parse(jsonData);

  const service = new ConnectionService();
  await service.intialize(branchs);

  const masterCon = await service.getCetralPool();
  const storeCon = await service.getMasterPool();
  if (!masterCon || !storeCon) {
    console.error('Master database connection failed.');
    return;
  }

  const columnsCache = new Map<string, IColumnsCache>();
  for (const table of [...tables, 'Ca', 'ChiTieu', 'HoaDon', 'KhachHang']) {
    const columns = await getInsertableColumns(masterCon!, table);
    columnsCache.set(table, columns);
  }

  for (const branch of branchs) {
    for (const date of DATES) {
      try {
        const [shiftIds] = await Promise.all([
          shiftReplication(
            storeCon,
            masterCon,
            columnsCache.get('Ca')!,
            branch.code,
            date,
          ),
          feeReplication(
            storeCon,
            masterCon,
            columnsCache.get('ChiTieu')!,
            branch.code,
            date,
          ),
          customerReplication(
            storeCon,
            masterCon,
            columnsCache.get('KhachHang')!,
            branch.code,
            date,
          ),
        ]);
        if (!shiftIds?.length) continue;

        const invoiceIds = await invoiceReplication(
          storeCon,
          masterCon,
          columnsCache.get('HoaDon')!,
          shiftIds,
        );
        if (!invoiceIds || !invoiceIds.length) continue;

        for (const table of tables) {
          await fullTablesReplication(
            storeCon,
            masterCon,
            columnsCache.get(table)!,
            invoiceIds,
            table,
          );
        }
      } catch (error) {
        console.error(`Error processing branch ${branch.code}:`, error);
      }
    }
  }
})();
