import { readFileSync } from 'fs';
import { join } from 'path';
import { registerCronJobs } from './cron';
import { connection } from './database';

async function bootstrap() {
  const jsonData = readFileSync(
    join(process.cwd(), 'secret', 'branch.json'),
    'utf-8',
  );

  const branchs = JSON.parse(jsonData);

  await connection.intialize(branchs);

  registerCronJobs();
}

bootstrap();
