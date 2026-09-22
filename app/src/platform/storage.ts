import Taro from '@tarojs/taro';
import type { StorageAdapter } from '@zx/data';

/** H5 端映射到 localStorage，小程序端映射到 wx.storage，由 Taro 统一。 */
export const taroStorage: StorageAdapter = {
  getItem(key: string): string | null {
    try {
      const value = Taro.getStorageSync(key);
      return value === '' || value === undefined || value === null ? null : String(value);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      Taro.setStorageSync(key, value);
    } catch {
      /* 存储不可用时忽略，不打断填写 */
    }
  },
  removeItem(key: string): void {
    try {
      Taro.removeStorageSync(key);
    } catch {
      /* 同上 */
    }
  },
};
