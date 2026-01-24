import cron from 'node-cron';
import { HandleAsyncData } from './jobs';

export function registerCronJobs() {
  // Get current date in 'YYYY-MM-DD' format less than 1 day
  const yesterday = new Date(new Date().setDate(new Date().getDate() - 1))
    .toISOString()
    .split('T')[0];

  console.log('yesterday', yesterday);

  cron.schedule(
    '0 4 * * *', // Cấu hình thời gian chạy hằng ngày ở đây
    async () => await HandleAsyncData([yesterday]),

    {
      timezone: 'Asia/Ho_Chi_Minh',
    },
  );

  console.log('[CRON] Jobs registered');
}
