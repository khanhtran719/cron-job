import sql from 'mssql';
import { randomUUID } from 'node:crypto';
import { assignedBranchs } from '../branch';
import { connection } from '../database';

const NON_UPDATABLE_COLUMNS = ['id', 'rowguid'];
// Parent IDs must stay aligned with HoaDon.ca_id and detail bill_id/source_id.
const TABLES_WITH_ID = ['Ca', 'HoaDon', 'HoaDon_Sub', 'HoaDon_Gift', 'HoaDon_MIFI', 'HoaDon_KhachHang', 'Phong'];

interface IReplicationSummary {
  read: number;
  written: number;
  failed: number;
}

interface IColumnsCache {
  columns: string[];
  columnList: string;
  paramList: string;
  upsertList: string;
}

export async function HandleAsyncData(dates: string[], tables: string[], revenueTables: string[]) {
  console.log('Start job store to central');
  const summary = { read: 0, written: 0, failed: 0 };
  if (assignedBranchs.length === 0) return summary;

  const masterCon = await connection.getMasterPool();
  if (!masterCon) {
    throw new Error('Master connection not established');
  }

  const columnsCache = new Map<string, IColumnsCache>();
  for (const table of new Set(['Ca', 'HoaDon', ...tables])) {
    const columns = await getInsertableColumns(masterCon!, table);
    columnsCache.set(table, columns);
  }

  for (const branch of assignedBranchs) {
    console.log(`Processing branch: ${branch.code}`);
    for (const date of dates) {
      try {
        const storeCon = await connection.getStorePool(branch);
        if (!storeCon) {
          throw new Error(`Connection not established for branch ${branch.code}`);
        }

        // await phongReplication(storeCon, masterCon, columnsCache.get('Phong')!, branch.code);

        const [shiftIds] = await Promise.all([
          shiftReplication(storeCon, masterCon, columnsCache.get('Ca')!, branch.code, date, summary),
          // customerReplication(storeCon, masterCon, columnsCache.get('KhachHang')!, branch.code, date),
          // chiphiReplication(storeCon, masterCon, columnsCache.get('ChiPhi')!, date),
        ]);
        if (!shiftIds?.length) continue;

        const invoiceIds = await invoiceReplication(storeCon, masterCon, columnsCache.get('HoaDon')!, shiftIds, branch.code, summary);
        if (!invoiceIds || !invoiceIds.length) continue;

        for (const table of tables) {
          const result = await fullTablesReplication(
            storeCon,
            masterCon,
            columnsCache.get(table)!,
            invoiceIds,
            table,
            branch.code,
          );
          summary.read += result.read;
          summary.written += result.written;
          summary.failed += result.failed;
        }

        // for (const table of revenueTables) {
        //   await revenueTablesReplication(storeCon, masterCon, columnsCache.get(table)!, date, table, branch.code);
        // }
      } catch (error) {
        summary.failed++;
        console.log(`Error processing branch ${branch.code} on date ${date}`);
        console.error(`Error processing branch ${branch.code}:`, error);
      }
    }
  }
  console.log('[JOB] Result:', summary);
  if (summary.failed)
    throw new Error(`Job failed: ${summary.failed} error(s), ${summary.written}/${summary.read} rows written`);
  return summary;
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

  if (result.recordset.length === 0) {
    throw new Error(`No insertable columns found for target table ${tableName}`);
  }

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
  cuahang_id?: string,
) {
  let pkColumn = 'id';
  if (!TABLES_WITH_ID.includes(tableName)) {
    if (columns.includes('rowguid')) {
      pkColumn = 'rowguid';
    }
  }

  try {
    if (row[pkColumn] === null || row[pkColumn] === undefined || row[pkColumn] === '') {
      throw new Error(`Missing stable key ${pkColumn} for ${tableName}`);
    }
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

    console.log('Inserted into', tableName, pkColumn + ':', row[pkColumn], 'Status:', isInserted);

    return inserted;
  } catch (err) {
    console.log(
      `[${cuahang_id ?? null}] Error inserting row into ${tableName} with ${pkColumn} ${row[pkColumn]}` + `: ${err}`,
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
  summary: IReplicationSummary,
) {
  const { columns, columnList, paramList, upsertList } = columnsCache;
  try {
    const data = await storeConnection.request().query(`
      SELECT *
      FROM Ca
      WHERE date = '${date}' and cuahang_id = '${storeCode}'
    `);

    console.log('--------------------SHIFT------------------------');
    console.log(`Shifts for store ${storeCode} on date ${date}:`, data.recordset.length);

    if (data.recordset.length === 0) return [];

    const shiftIds: string[] = [];
    summary.read += data.recordset.length;
    for (const row of data.recordset) {
      const inserted = await rowInsertion(masterConnection, 'Ca', columnList, paramList, upsertList, columns, row, storeCode);
      if (inserted) {
        shiftIds.push(row.id);
        summary.written++;
      } else {
        summary.failed++;
      }
    }

    return shiftIds;
  } catch (err) {
    console.log('Error during shift replication: ' + storeCode + ' - ' + date);
    throw err;
  }
}

async function phongReplication(
  storeConnection: sql.ConnectionPool,
  masterConnection: sql.ConnectionPool,
  columnsCache: IColumnsCache,
  storeCode: string,
) {
  const { columns, columnList, paramList, upsertList } = columnsCache;

  try {
    const data = await storeConnection.request().query(`
      SELECT *
      FROM Phong
      WHERE cuahang_id = '${storeCode}'
    `);

    console.log('--------------------CUSTOMER------------------------');
    console.log(`Phong for cuahang ${storeCode}:`, data.recordset.length);

    if (data.recordset.length === 0) return;

    for (const row of data.recordset) {
      await rowInsertion(masterConnection, 'Phong', columnList, paramList, upsertList, columns, row);
    }
  } catch (error) {
    console.log('Error during Phong replication: ' + storeCode);
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
    console.log(`ChiPhi for month ${month} and year ${year}:`, data.recordset.length);

    if (data.recordset.length === 0) return;

    for (const row of data.recordset) {
      await rowInsertion(masterConnection, 'ChiPhi', columnList, paramList, upsertList, columns, row);
    }
  } catch (error) {
    console.log('Error during chiphi replication: ' + date);
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

    console.log('--------------------' + tableName + '------------------------');
    console.log(`Records for table ${tableName} and date [${date}]:`, data.recordset.length);
    if (data.recordset.length === 0) return;

    for (const row of data.recordset) {
      await rowInsertion(masterConnection, tableName, columnList, paramList, upsertList, columns, row, storeCode);
    }
  } catch (error) {
    console.log('Error during revenue table replication: ' + tableName + ' - ' + storeCode + ' - ' + date);
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
    console.log(`Fees for store ${storeCode} on date ${date}:`, data.recordset.length);
    if (data.recordset.length === 0) return;

    for (const row of data.recordset) {
      await rowInsertion(masterConnection, 'ChiTieu', columnList, paramList, upsertList, columns, row, storeCode);
    }
  } catch (error) {
    console.log('Error during fee replication: ' + storeCode + ' - ' + date);
  }
}

async function invoiceReplication(
  storeConnection: sql.ConnectionPool,
  masterConnection: sql.ConnectionPool,
  columnsCache: IColumnsCache,
  shiftIds: string[],
  storeCode: string,
  summary: IReplicationSummary,
) {
  const { columns, columnList, paramList, upsertList } = columnsCache;
  try {
    const data = await storeConnection.request().query(`
      SELECT *
      FROM HoaDon
      WHERE ca_id IN (${shiftIds.map((id) => `'${id}'`).join(', ')})
    `);

    console.log('--------------------INVOICE------------------------');
    console.log(`Invoices for shifts [${shiftIds.join(', ')}]:`, data.recordset.length);

    if (data.recordset.length === 0) return [];

    const ids: string[] = [];
    summary.read += data.recordset.length;
    for (const row of data.recordset) {
      const inserted = await rowInsertion(masterConnection, 'HoaDon', columnList, paramList, upsertList, columns, row, storeCode);
      if (inserted) {
        ids.push(row.id);
        summary.written++;
      } else {
        summary.failed++;
      }
    }

    return ids;
  } catch (error) {
    console.log('Error during invoice replication with shifts: ' + shiftIds.join(', '));
    throw error;
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
    console.log(`Customers for store ${storeCode} on date ${date}:`, data.recordset.length);

    if (data.recordset.length === 0) return;

    for (const row of data.recordset) {
      await rowInsertion(masterConnection, 'KhachHang', columnList, paramList, upsertList, columns, row, storeCode);
    }
  } catch (error) {
    console.log('Error during customer replication: ' + storeCode + ' - ' + date);
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
  const summary = { read: 0, written: 0, failed: 0 };

  try {
    let field = 'bill_id';
    if (tableName === 'HoaDon_Sub') field = 'source_id';

    const data = await storeConnection.request().query(`
      SELECT *
      FROM ${tableName} 
      WHERE ${field} IN (${invoiceIds.map((b) => `'${b}'`).join(', ')})
    `);

    console.log('--------------------' + tableName + '------------------------');
    console.log(`Records for table ${tableName} and invoices [${invoiceIds.join(', ')}]:`, data.recordset.length);
    summary.read = data.recordset.length;

    for (const row of data.recordset) {
      if (!row['rowguid'] && (TABLES_WITH_ID.includes(tableName) || !columns.includes('rowguid'))) {
        row['rowguid'] = randomUUID();
      }
      const inserted = await rowInsertion(
        masterConnection,
        tableName,
        columnList,
        paramList,
        upsertList,
        columns,
        row,
        storeCode,
      );
      if (inserted) summary.written++;
      else summary.failed++;
    }
    return summary;
  } catch (error) {
    console.log('Error during table replication: ' + tableName + ' - ' + invoiceIds.join(', '));
    throw error;
  }
}
