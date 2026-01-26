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
          'HoaDon_ChiTietHangHoa',
          'HoaDon_Combo_HangHoa',
          'HoaDon_Coupon',
          'HoaDon_Customer',
          'HoaDon_DiscountOnSales',
          'HoaDon_DoanhThu_NhanVien',
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
      );
    },
    {
      timezone: 'Asia/Ho_Chi_Minh',
    },
  );

  console.log('[CRON] Jobs registered');
}
