/**
 * 交接文件（产品文档 5.1 的「文件导入」那一端）：把需求单存成一份 JSON 交到设计师手上。
 *
 * 两种端各按自己的能力来：H5 直接下载一个 `.json`；小程序端没有「下载文件」这个动作，
 * 退成把 JSON 复制到剪贴板，设计师那边粘进导入框——是同一份东西，两条输入方式共用一份契约。
 */

import Taro from '@tarojs/taro';
import { isH5 } from './env';

export type HandoffResult = 'download' | 'clipboard';

export async function saveHandoff(fileName: string, text: string): Promise<HandoffResult> {
  if (isH5 && typeof document !== 'undefined' && typeof URL !== 'undefined') {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // 立刻回收会让部分浏览器来不及取数据，挪到下一轮事件循环
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return 'download';
  }
  await Taro.setClipboardData({ data: text });
  return 'clipboard';
}
