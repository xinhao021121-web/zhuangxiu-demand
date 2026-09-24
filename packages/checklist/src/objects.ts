/**
 * 核实对象名归一（badcases.md BC-05）。
 *
 * 合并键是「归属空间 + 核实对象」，而核实对象名是模型给的自由文本。提示词里已经把资产里的
 * 标准对象名作为固定前缀交代给模型，仍然会漏：真机实测出现过「厨房排烟」「封窗」「上水下水」，
 * 规则托底上线后又多了一种——规则给的是标准名（猫砂盆位置），模型用自己的名（猫砂盆）说同一件事，
 * 两条落在不同的键上就并不上，设计师会看到两条各说一半。
 *
 * 所以归一放在代码里，不靠提示词自觉。两条匹配，且只在**唯一命中**时才归：
 *
 * 1. 包含关系：自创名往往是在标准名上加限定词（「厨房排烟」），或去掉后缀（「封窗」→「家政封窗」）；
 * 2. 别名表：与标准名不构成包含关系的叫法（「上水下水」→「上下水」）。
 *
 * 命中多个标准名时不归。「上下水与排烟」「中央空调」这类复合名与歧义名一律并列两条，
 * 交给设计师删——宁可多一条，也不要错合并掉一条真实问题（产品文档 5.5）。
 */

import { UNCLEAR_CHECKLIST } from '@zx/field-spec';
import type { SurveyItem } from '@zx/field-spec';

/** 一份资产声明的核实对象：标准名 + 它声明的归属分区（分区同样以资产为准）。 */
export interface ObjectAsset {
  object: string;
  /** 资产声明的分区；实例分区分到哪个实例由调用方算好（如「次卧1 · 儿童房」） */
  space: string;
  /** 分区名：space 对应的实例在当前需求单里不存在时，退回到这一组（通用清单与待定项资产有） */
  section?: string;
}

/**
 * 别名表：与标准名不构成包含关系、且有实测证据的叫法。
 *
 * 只登记真机实测出现过的（badcases.md BC-05）：猜出来的别名一旦猜错，就是错合并。
 * 与标准名构成包含关系的（「厨房排烟」「封窗」「猫砂盆」）不写在这里，由包含匹配覆盖。
 */
const ALIASES: Record<string, string> = {
  上水下水: '上下水',
};

/**
 * 归一用的资产清单：16 项通用清单 + 待定项资产 + 调用方带来的额外资产（规则托底那些）。
 * 同名以先到的为准：通用清单与待定项资产是随代码发布的，不该被运行期传入的东西改掉分区。
 */
export function objectAssets(
  survey: SurveyItem[],
  extra: readonly ObjectAsset[] = [],
): Map<string, ObjectAsset> {
  const assets = new Map<string, ObjectAsset>();
  const put = (asset: ObjectAsset) => {
    if (!assets.has(asset.object)) assets.set(asset.object, asset);
  };
  survey.forEach((s) => put({ object: s.object, space: s.space, section: s.section }));
  UNCLEAR_CHECKLIST.forEach((u) => put({ object: u.object, space: u.space, section: u.section }));
  extra.forEach(put);
  return assets;
}

/**
 * 把一个核实对象名归到资产的标准名。归不上就原样返回——照旧另起一条。
 *
 * 不做模糊匹配、不做词向量：只有「与某个标准名互相包含」与「别名表命中」两种确定判断，
 * 两者都要唯一命中才归。判不准的并成两条，设计师删一条的成本，远低于漏掉一条真实问题的成本。
 */
export function canonicalObjectName(name: string, assets: Map<string, ObjectAsset>): string {
  const wanted = name.trim();
  if (!wanted) return name;
  if (assets.has(wanted)) return wanted;

  const alias = ALIASES[wanted];
  if (alias && assets.has(alias)) return alias;

  // 短名不参与包含匹配：「水」「门」这类一个字的名字包含关系太宽，容易错并
  const hits = [...assets.keys()].filter(
    (standard) =>
      standard.length >= 2 &&
      wanted.length >= 2 &&
      (wanted.includes(standard) || standard.includes(wanted)),
  );
  return hits.length === 1 ? hits[0]! : wanted;
}
