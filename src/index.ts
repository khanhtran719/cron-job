import 'dotenv/config';
import { assignedBranchs } from './branch';
import { INSTANCE_ID, TOTAL_INSTANCES } from './constant';
import { registerCronJobs } from './cron';
import { connection } from './database';
import { HandleAsyncData } from './jobs';

console.log(`[INSTANCE ${INSTANCE_ID}/${TOTAL_INSTANCES}] started`);

async function bootstrap() {
  const mode = process.argv[2] || process.env.JOB_MODE || 'once';
  if (mode !== 'once' && mode !== 'cron') throw new Error('JOB_MODE must be once or cron');
  try {
    await connection.intialize(assignedBranchs);
    if (mode === 'once') {
      await HandleAsyncData(
        ['2026-07-26'],
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
      return;
    }
    const cron = registerCronJobs();
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      try {
        try {
          await cron.stop();
        } finally {
          await connection.closeAll();
        }
      } catch (error) {
        console.error('[SHUTDOWN] Failed:', error);
        process.exitCode = 1;
      }
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    if (mode === 'cron') await connection.closeAll();
    throw error;
  } finally {
    if (mode === 'once') await connection.closeAll();
  }
}

bootstrap().catch((error) => {
  console.error('[BOOTSTRAP] Failed:', error);
  process.exitCode = 1;
});
