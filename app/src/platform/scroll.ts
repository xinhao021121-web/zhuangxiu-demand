import Taro from '@tarojs/taro';

/** 滚动到指定节点：两端都用选择器查询，不在字段层做平台判断。 */
export function scrollToNode(id: string): void {
  const query = Taro.createSelectorQuery();
  query.select(`#${id}`).boundingClientRect();
  query.selectViewport().scrollOffset();
  query.exec((res) => {
    const rect = res?.[0] as { top: number } | undefined;
    const viewport = res?.[1] as { scrollTop: number } | undefined;
    if (!rect || !viewport) return;
    Taro.pageScrollTo({ scrollTop: Math.max(0, rect.top + viewport.scrollTop - 96), duration: 300 });
  });
}
