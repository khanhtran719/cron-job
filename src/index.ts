import { allBranchs, getInsBranchs } from './branch';
import { INSTANCE_ID, TOTAL_INSTANCES } from './constant';
import { registerCronJobs } from './cron';
import { connection } from './database';

console.log(`[INSTANCE ${INSTANCE_ID}/${TOTAL_INSTANCES}] started`);

async function bootstrap() {
  const branchs = allBranchs.filter(
    (branch: any) => getInsBranchs(branch.code) === INSTANCE_ID,
  );

  await connection.intialize(branchs);

  registerCronJobs();
}

bootstrap();
