import cron from 'node-cron';
import { HandleAsyncData } from './jobs';

export function registerCronJobs() {
  cron.schedule(
    '0 */3 * * *', // Cấu hình thời gian chạy hằng ngày ở đây
    async () => {
      let date = new Date().toISOString().split('T')[0];
      if (new Date().getHours() + 7 >= 10) {
        date = new Date(new Date().setDate(new Date().getDate() - 1))
          .toISOString()
          .split('T')[0];
      }

      await HandleAsyncData(
        [date],
        [
          'HoaDon_Coupon',
          'HoaDon_Customer',
          'HoaDon_GiamGia',
          'HoaDon_Gift',
          'HoaDon_Info',
          'HoaDon_KhachHang',
          'HoaDon_MIFI',
          'HoaDon_PhuPhi',
          'HoaDon_VAT',
        ],
      );
    },
    {
      timezone: 'Asia/Ho_Chi_Minh',
    },
  );

  cron.schedule(
    '0 7 * * *', // Cấu hình thời gian chạy hằng ngày ở đây
    async () => {
      const yesterday = new Date(new Date().setDate(new Date().getDate() - 1))
        .toISOString()
        .split('T')[0];

      await HandleAsyncData(
        [yesterday],
        [
          'HoaDon_ChiTietHangHoa',
          'HoaDon_Combo_HangHoa',
          'HoaDon_DiscountOnSales',
          'HoaDon_DoanhThu_NhanVien',
          'HoaDon_NVL',
          'HoaDon_Sub',
          'HoaDon_TraMon',
        ],
      );
    },
    {
      timezone: 'Asia/Ho_Chi_Minh',
    },
  );

  console.log('[CRON] Jobs registered');
}
