import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config();

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
      pool: masterPool,
    });
  }

  async getStorePool(branch: any): Promise<sql.ConnectionPool | null> {
    const connection = this.dbConnectionMap.get(branch.code);
    if (connection && connection.connected) {
      return connection.pool;
    } else {
      const connectionPool = await sql.connect({
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

      this.dbConnectionMap.set(branch.code, {
        connected: true,
        pool: connectionPool,
      });

      return connectionPool;
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

export const connection = new ConnectionService();
