import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config();

interface IColumnsCache {
  columns: string[];
  columnList: string;
  paramList: string;
  upsertList: string;
  columnTypes: { [key: string]: string };
}

interface IDBConnection {
  connected: boolean;
  pool: sql.ConnectionPool | null;
}

class ConnectionService {
  private dbConnectionMap: Map<string, IDBConnection> = new Map();

  constructor() {}

  async intialize(): Promise<void> {
    const db100v10Pool = new sql.ConnectionPool({
      user: process.env.MASTER_DB_USER,
      password: process.env.MASTER_DB_PASSWORD,
      server: process.env.MASTER_DB_HOST!,
      database: 'icool_karaoke_v10',
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

    await db100v10Pool.connect();

    this.dbConnectionMap.set('db100v10', {
      connected: true,
      pool: db100v10Pool,
    });

    const db100v11Pool = new sql.ConnectionPool({
      user: process.env.MASTER_DB_USER,
      password: process.env.MASTER_DB_PASSWORD,
      server: process.env.MASTER_DB_HOST!,
      database: 'icool_karaoke_v11',
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

    await db100v11Pool.connect();

    this.dbConnectionMap.set('db100v11', {
      connected: true,
      pool: db100v11Pool,
    });

    // const db219v11Pool = new sql.ConnectionPool({
    //   user: process.env.CENTRAL_DB_USER,
    //   password: process.env.CENTRAL_DB_PASSWORD,
    //   server: process.env.CENTRAL_DB_HOST!,
    //   database: 'icool_karaoke_v11',
    //   port: Number(process.env.CENTRAL_DB_PORT!),
    //   options: {
    //     encrypt: false,
    //     trustServerCertificate: true,
    //   },
    //   pool: {
    //     max: 10,
    //     min: 0,
    //     idleTimeoutMillis: 30000,
    //   },
    // });

    // await db219v11Pool.connect();

    // this.dbConnectionMap.set('db219v11', {
    //   connected: true,
    //   pool: db219v11Pool,
    // });
  }

  async getDb100v10Pool(): Promise<sql.ConnectionPool | null> {
    const connection = this.dbConnectionMap.get('db100v10');
    if (connection && connection.connected) {
      return connection.pool;
    } else {
      const connection = await sql.connect({
        user: process.env.MASTER_DB_USER,
        password: process.env.MASTER_DB_PASSWORD,
        server: process.env.MASTER_DB_HOST!,
        database: 'icool_karaoke_v10',
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

      this.dbConnectionMap.set('db100v10', {
        connected: true,
        pool: connection,
      });

      return connection;
    }
  }

  async getDb100v11Pool(): Promise<sql.ConnectionPool | null> {
    const connection = this.dbConnectionMap.get('db100v11');
    if (connection && connection.connected) {
      return connection.pool;
    } else {
      const connection = await sql.connect({
        user: process.env.MASTER_DB_USER,
        password: process.env.MASTER_DB_PASSWORD,
        server: process.env.MASTER_DB_HOST!,
        database: 'icool_karaoke_v11',
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

      this.dbConnectionMap.set('db100v11', {
        connected: true,
        pool: connection,
      });

      return connection;
    }
  }

  // async getDb219v11Pool(): Promise<sql.ConnectionPool | null> {
  //   const connection = this.dbConnectionMap.get('db219v11');
  //   if (connection && connection.connected) {
  //     return connection.pool;
  //   } else {
  //     const connection = await sql.connect({
  //       user: process.env.CENTRAL_DB_USER,
  //       password: process.env.CENTRAL_DB_PASSWORD,
  //       server: process.env.CENTRAL_DB_HOST!,
  //       database: 'icool_karaoke_v11',
  //       port: Number(process.env.CENTRAL_DB_PORT!),
  //       options: {
  //         encrypt: false,
  //         trustServerCertificate: true,
  //       },
  //       pool: {
  //         max: 10,
  //         min: 0,
  //         idleTimeoutMillis: 30000,
  //       },
  //     });

  //     this.dbConnectionMap.set('db219v11', {
  //       connected: true,
  //       pool: connection,
  //     });

  //     return connection;
  //   }
  // }
}

async function getInsertableColumns(
  pool: sql.ConnectionPool,
  tableName: string,
): Promise<IColumnsCache> {
  const NON_UPDATABLE_COLUMNS = ['id', 'rowguid'];

  const result = await pool.request().query(`
    SELECT c.COLUMN_NAME, DATA_TYPE
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
  const columnTypes: { [key: string]: string } = {};
  result.recordset.forEach((r) => {
    columns.push(r.COLUMN_NAME);
    columnList += `[${r.COLUMN_NAME}], `;
    paramList += `@${r.COLUMN_NAME}, `;
    if (!NON_UPDATABLE_COLUMNS.includes(r.COLUMN_NAME)) {
      upsertList += `[${r.COLUMN_NAME}] = @${r.COLUMN_NAME}, `;
    }

    columnTypes[r.COLUMN_NAME] = r.DATA_TYPE;
  });

  return {
    columns,
    columnList: columnList.slice(0, -2),
    paramList: paramList.slice(0, -2),
    upsertList: upsertList.slice(0, -2),
    columnTypes,
  };
}

async function rowInsertion(
  connection: sql.ConnectionPool,
  tableName: string,
  columnList: string,
  paramList: string,
  upsertList: string,
  columns: string[],
  columnTypes: { [key: string]: string },
  row: any,
  index: number,
) {
  const talbeWithId: string[] = ['Omotenashi_Ranking_IC'];

  let pkColumn = 'id';
  if (!talbeWithId.includes(tableName)) {
    if (columns.includes('rowguid')) {
      pkColumn = 'rowguid';
    }
  }

  try {
    const request = connection.request();

    columns.forEach((col) => {
      const value = row[col];
      const dataType = columnTypes[col];

      if (value === null || value === undefined) {
        request.input(col, value);
        return;
      }

      if (Buffer.isBuffer(value)) {
        request.input(col, sql.VarBinary(sql.MAX), value);
        return;
      }

      if (typeof value === 'string' && dataType === 'varbinary') {
        request.input(col, sql.VarBinary(sql.MAX), Buffer.from(value));
        return;
      }

      request.input(col, value);
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

    console.log(
      index + 1 + '=> Inserted into',
      tableName,
      pkColumn + ':',
      row[pkColumn],
      'Status:',
      isInserted,
    );

    return inserted;
  } catch (err) {
    console.error('Error inserting row into', tableName, 'Error:', err);
    return null;
  }
}

// const tables: string[] = [
//   'Omotenashi_IC',
//   'HoaDon_Combo_HangHoa',
//   'HoaDon_Coupon',
//   'HoaDon_Customer',
//   'HoaDon_DiscountOnSales',
//   'HoaDon_DoanhThu_NhanVien',
//   'HoaDon_HinhThucThanhToan',
//   'HoaDon_GiamGia',
//   'HoaDon_Gift',
//   'HoaDon_Info',
//   'HoaDon_KhachHang',
//   'HoaDon_MIFI',
//   'HoaDon_NVL',
//   'HoaDon_PhuPhi',
//   // 'HoaDon_Sub',
//   'HoaDon_TraMon',
//   'HoaDon_VAT',
// ];

(async () => {
  console.log('Starting complaint replication script...');

  const conn_service = new ConnectionService();
  await conn_service.intialize();

  const original_db = await conn_service.getDb100v10Pool();
  const target_db = await conn_service.getDb100v11Pool();

  if (!original_db || !target_db) {
    console.error('Database connections could not be established.');
    process.exit(1);
  }

  const table_name = 'Omotenashi_Ranking_IC';

  const columnsCache = await getInsertableColumns(target_db!, table_name);

  const { columns, columnList, paramList, upsertList, columnTypes } =
    columnsCache;

  const data = await original_db!.request().query(`
    Select ${table_name}.* 
    From ${table_name} 
    WHERE (${table_name}.created_date >= '2026-01-20 00:00:00' OR ${table_name}.modified_date >= '2026-01-20 00:00:00')
  `);

  console.log(
    `Fetched ${data.recordset.length} complaint social records from v10 database.`,
  );

  if (data.recordset.length === 0) {
    console.log(
      'No complaint social records found for the specified date range.',
    );
    process.exit(0);
  }

  let count = 0;
  for (const row of data.recordset) {
    await rowInsertion(
      target_db!,
      table_name,
      columnList,
      paramList,
      upsertList,
      columns,
      columnTypes,
      row,
      count,
    );
    count++;
  }

  console.log('Complaint replication script completed.');
  process.exit(0);
})();
