import cron from 'node-cron';
import { HandleAsyncData } from './jobs';

// Preserve the original 10:00 cutoff, using Vietnam dates on every host.
export function getJobDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const value = (name: string) => Number(parts.find((part) => part.type === name)!.value);
  const date = new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
  if (value('hour') >= 10) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function registerCronJobs() {
  let running: Promise<void> | null = null;
  let stopping = false;
  const task = cron.schedule(
    '0 */3 * * *', // Cấu hình thời gian chạy hằng ngày ở đây
    async () => {
      if (stopping) return;
      if (running) {
        console.warn('[CRON] Previous job is still running; skipping this tick');
        return;
      }
      running = (async () => {
        try {
          await HandleAsyncData(
            [getJobDate()],
            [
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
            ],
            ['ChiTieu', 'DoanhThu', 'DoanhThu_NhanVien'],
          );
        } catch (error) {
          console.error('[CRON] Job failed:', error);
        }
      })();
      try {
        await running;
      } finally {
        running = null;
      }
    },
    {
      timezone: 'Asia/Ho_Chi_Minh',
      noOverlap: true,
    },
  );

  console.log('[CRON] Jobs registered');
  return {
    async stop() {
      stopping = true;
      await task.stop();
      await running;
      await task.destroy();
    },
  };
}
