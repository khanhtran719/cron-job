import { readFileSync } from 'fs';
import sql from 'mssql';
import { join } from 'path';
import { connection } from '../database';
import { log } from '../log';

const NON_UPDATABLE_COLUMNS = ['id', 'rowguid'];

interface IColumnsCache {
  columns: string[];
  columnList: string;
  paramList: string;
  upsertList: string;
}

export async function HandleAsyncData(dates: string[], tables: string[]) {
  log('Start job store to central');

  const jsonData = readFileSync(
    join(process.cwd(), 'secret', 'branch.json'),
    'utf-8',
  );

  const branchs = JSON.parse(jsonData);

  const masterCon = await connection.getMasterPool();
  if (!masterCon) {
    log('Master connection not established');
    return;
  }

  const columnsCache = new Map<string, IColumnsCache>();
  for (const table of [...tables, 'Ca', 'ChiTieu', 'HoaDon', 'KhachHang']) {
    const columns = await getInsertableColumns(masterCon!, table);
    columnsCache.set(table, columns);
  }

  for (const branch of branchs) {
    console.log(`Processing branch: ${branch.code}`);

    for (const date of dates) {
      try {
        const storeCon = await connection.getStorePool(branch);

        if (!storeCon) {
          log(`Connection not established for branch ${branch.code}`);
          continue;
        }

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
        log(`Error processing branch ${branch.code} on date ${date}`);
        console.error(`Error processing branch ${branch.code}:`, error);
      }
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
    log(`Error inserting row into ${tableName} with ID ${row['id']}`);
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
  const { columns, columnList, paramList, upsertList } = columnsCache;
  try {
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
    log('Error during shift replication: ' + storeCode + ' - ' + date);
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
    log('Error during fee replication: ' + storeCode + ' - ' + date);
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
    log('Error during invoice replication with shifts: ' + shiftIds.join(', '));
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
    log('Error during customer replication: ' + storeCode + ' - ' + date);
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
    log(
      'Error during table replication: ' +
        tableName +
        ' - ' +
        invoiceIds.join(', '),
    );
  }
}
