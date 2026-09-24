/**
 * 规则库：MVP 用纯规则实现，不做模型调用。
 *
 * 每条规则由作用域、触发条件、文案、目标字段、写入动作、优先级与依据组成。
 * 三类机制：关联推导（有 A 通常需要 B）、冲突风险（已填内容之间存在矛盾）、
 * 场景挖掘（家庭结构与生活方式推导场景）。
 */

import { anyOf, filled, has, num } from './context';
import type { Rule, RuleContext, RuleHit, RuleMeta } from './types';

// 计划时间的依据文案：条件允许只填一个时间，说法要跟实际填的对上。
// 元信息不能替条件说话——「为什么问」里写「填了两个时间」而实际只填一个，就是编依据。
function scheduleWhy(c: RuleContext): string {
  const finish = filled(c.values.date_finish);
  const movein = filled(c.values.date_movein);
  if (finish && movein) return '因为你填了计划完工与计划入住两个时间';
  return finish ? '因为你填了计划完工时间' : '因为你填了计划入住时间';
}

const hit = (h: RuleHit | false | null | undefined): RuleHit[] => (h ? [h] : []);

export const RULES: Rule[] = [
  /* ==================== 认识你家 ==================== */
  {
    id: 'pet-cat',
    p: 'P1',
    section: '认识你家',
    target: 'base_other',
    trigger: '是否养宠物包含「猫」',
    run: (c) =>
      hit(
        has(c.values.live_pet, '猫') && {
          title: '养猫家庭的专属空间与材质',
          text: '建议在阳台或卫生间预留猫砂盆位置与附近插座，避免大面积绒面与皮质家具，猫爬架附近也留一个插座。',
          why: `因为你填了「是否养宠物：${(c.values.live_pet as string[]).join('、')}」`,
        },
      ),
  },
  {
    id: 'pet-robot',
    p: 'P2',
    section: '阳台',
    target: 'bl_robot',
    value: '阳台',
    trigger: '养猫或养狗',
    run: (c) =>
      hit(
        anyOf(c.values.live_pet, ['猫', '狗']) && {
          title: '预留扫地机器人位置与回充点位',
          text: '养宠家庭地面清洁频率高，建议明确扫地机器人的位置并预留插座，避免后期从别处拉线。',
          why: '因为你养了宠物',
        },
      ),
  },
  {
    id: 'elder-home',
    p: 'P0',
    section: '认识你家',
    target: 'base_other',
    trigger: '有老人或行动不便成员 = 是',
    run: (c) =>
      hit(
        has(c.values.live_elder, '是') && {
          title: '适老安全设施',
          text: '建议长辈房与卫生间增加紧急按钮、防滑扶手与感应夜灯，通道净宽不小于 80cm，地面避免高差与门槛。',
          why: '因为你填了「有老人或行动不便成员：是」',
        },
      ),
  },
  {
    id: 'allergy-home',
    p: 'P1',
    section: '认识你家',
    target: 'base_other',
    trigger: '有鼻炎或过敏成员 = 是',
    run: (c) =>
      hit(
        has(c.values.live_allergy, '是') && {
          title: '过敏成员的材质与空气处理',
          text: '有过敏成员时，软装避免长毛地毯与绒面沙发，优先可擦洗材质，并考虑新风与除螨方案。',
          why: '因为你填了「有鼻炎或过敏成员：是」',
        },
      ),
  },
  {
    id: 'smoke-area',
    p: 'P2',
    section: '认识你家',
    target: 'base_other',
    trigger: '有吸烟成员 = 是',
    run: (c) =>
      hit(
        has(c.values.live_smoke, '是') && {
          title: '吸烟区与独立排风',
          text: '建议明确一个可以关门的吸烟位置并做独立排风，避免烟味扩散到卧室与衣物。',
          why: '因为你填了「有吸烟成员：是」',
        },
      ),
  },
  {
    id: 'budget-reserve',
    p: 'P0',
    kind: 'risk',
    section: '认识你家',
    target: 'budget_reserve',
    value: '是',
    action: 'replace',
    trigger: '已填预算与建筑面积',
    run: (c) =>
      hit(
        (filled(c.values.budget_total) || num(c.values.base_area) > 0) && {
          title: '预算与面积匹配度提醒',
          text: '建议在预算之外单独预留 20% 作为增项备用金，装修过程中增项很难完全避免。',
          why: `因为你填了「建筑面积：${c.values.base_area ?? '-'}㎡」和「预算：${c.values.budget_total ?? '-'}」`,
        },
      ),
  },
  {
    id: 'schedule-conflict',
    p: 'P0',
    kind: 'risk',
    section: '认识你家',
    target: 'date_start',
    trigger: '填了计划完工或计划入住时间',
    run: (c) =>
      hit(
        (filled(c.values.date_finish) || filled(c.values.date_movein)) && {
          title: '入住时间与定制家具周期冲突',
          text: '定制柜与木作的制作安装通常需要 45-60 天，建议把下单时间提前，并在工期表里预留至少两周缓冲。',
          why: scheduleWhy(c),
        },
      ),
  },
  {
    id: 'old-house',
    p: 'P1',
    section: '认识你家',
    target: 'base_other',
    trigger: '房屋现状 = 旧房翻新',
    run: (c) =>
      hit(
        has(c.values.base_house_state, '旧房翻新') && {
          title: '旧房翻新的隐蔽工程',
          text: '旧房建议先确认原有水电管线年限与防水状况，这部分通常是预算最容易超的地方。',
          why: '因为你填了「房屋现状：旧房翻新」',
        },
      ),
  },
  {
    id: 'guest-stay',
    p: 'P2',
    section: '认识你家',
    target: 'stay_need',
    value: '需要',
    trigger: '聚会与来客频率 = 经常',
    run: (c) =>
      hit(
        has(c.values.guest_freq, '经常') && {
          title: '常来客人的留宿规划',
          text: '客人常来建议保留独立客房或可展开的沙发床，同时兼顾日常的储物与办公需求。',
          why: '因为你填了「聚会与来客频率：经常」',
        },
      ),
  },


  /* ==================== 设备与系统 ==================== */
  {
    id: 'ac-central',
    p: 'P1',
    section: '设备与系统',
    target: 'dev_other',
    trigger: '空调需求包含中央空调',
    run: (c) =>
      hit(
        has(c.values.dev_ac, '中央空调') && {
          title: '中央空调的吊顶与检修口',
          text: '中央空调需要吊顶包裹风管，请在需要的位置预留检修口，并确认层高是否满足。',
          why: `因为你填了「空调需求：${(c.values.dev_ac as string[]).join('、')}」`,
        },
      ),
  },
  {
    id: 'floor-heating',
    p: 'P1',
    section: '设备与系统',
    target: 'dev_other',
    trigger: '取暖方式包含地暖',
    run: (c) =>
      hit(
        has(c.values.dev_heat, '地暖') && {
          title: '地暖带来的地面抬高',
          text: '地暖完成面通常抬高 8-10cm，木地板建议选地暖专用款，量房时需要确认与入户门槛的高度衔接。',
          why: '因为你填了「取暖方式：地暖」',
        },
      ),
  },
  {
    id: 'fresh-air',
    p: 'P1',
    section: '设备与系统',
    target: 'dev_other',
    trigger: '新风系统 = 需要',
    run: (c) =>
      hit(
        has(c.values.dev_freshair, '需要') && {
          title: '新风的主机与检修位置',
          text: '新风主机与检修口需要落在可维护的位置（阳台或卫生间吊顶内），并确认送排风不会直吹床头。',
          why: '因为你填了「新风系统：需要」',
        },
      ),
  },
  {
    id: 'home-office-net',
    p: 'P1',
    section: '设备与系统',
    target: 'dev_smart',
    value: '全屋WIFI',
    trigger: '办公需求 = 长期居家办公',
    run: (c) =>
      hit(
        has(c.values.office_need, '长期居家办公') && {
          title: '居家办公的网络与隔音',
          text: '建议工位预留有线网口并规划全屋 WIFI 覆盖，会议频繁时给书房做隔音与独立照明。',
          why: '因为你填了「办公需求：长期居家办公」',
        },
      ),
  },
  {
    id: 'instant-hot-water',
    p: 'P2',
    section: '设备与系统',
    target: 'dev_other',
    trigger: '生活热水偏好 = 希望打开就有热水',
    run: (c) =>
      hit(
        has(c.values.dev_hotwater, '希望打开就有热水') && {
          title: '零冷水需要回水管',
          text: '想要打开就有热水，需要在改造阶段预留回水管或加装循环泵，后期再补会很受限。',
          why: '因为你填了「生活热水偏好：希望打开就有热水」',
        },
      ),
  },
  {
    id: 'smart-security',
    p: 'P2',
    section: '设备与系统',
    target: 'dev_other',
    trigger: '智能与网络需求包含全屋监控或智能门锁',
    run: (c) =>
      hit(
        (has(c.values.dev_smart, '全屋监控') || has(c.values.dev_smart, '智能门锁')) && {
          title: '监控与门锁的电位预留',
          text: '摄像头与智能门锁需要就近供电与稳定网络，建议在玄关与主要通道预留插座与弱电点位。',
          why: '因为你填了全屋监控或智能门锁',
        },
      ),
  },

  /* ==================== 玄关 ==================== */
  {
    id: 'boots-shelf',
    p: 'P2',
    section: '玄关',
    target: 'ex_shoe',
    value: '需要',
    trigger: '高筒靴数量大于 0',
    run: (c) =>
      hit(
        num(c.values.ex_boots) > 0 && {
          title: '高筒靴需要活动层板',
          text: '有高筒靴时鞋柜建议做活动层板，留出 30cm 以上层高，不要全做均分格。',
          why: `因为你填了「高筒靴数量：${c.values.ex_boots} 双」`,
        },
      ),
  },
  {
    id: 'shoe-amount',
    p: 'P2',
    section: '玄关',
    target: 'ex_shoe_count',
    trigger: '鞋子数量大于 60 双',
    run: (c) =>
      hit(
        num(c.values.ex_shoe_count) > 60 && {
          title: '鞋量决定玄关柜的分区方式',
          text: '鞋子较多时建议把玄关柜做到顶并分区：常穿区开放、换季区封闭、儿童鞋放低格。',
          why: `因为你填了「鞋子数量：${c.values.ex_shoe_count} 双」`,
        },
      ),
  },
  {
    id: 'entry-wardrobe',
    p: 'P1',
    section: '玄关',
    target: 'ex_wardrobe',
    value: '需要',
    trigger: '回家第一件事 = 立即换家居服',
    run: (c) =>
      hit(
        has(c.values.ex_first, '立即换家居服') && {
          title: '入户动线上的临时挂衣区',
          text: '回家先换衣服，建议在玄关做一小段挂衣区或入户衣柜，脏衣篓也放在同一动线上。',
          why: '因为你填了「回家第一件事：立即换家居服」',
        },
      ),
  },
  {
    id: 'entry-bench',
    p: 'P2',
    section: '玄关',
    target: 'ex_bench',
    value: '固定',
    trigger: '玄关定位 = 实用为主',
    run: (c) =>
      hit(
        has(c.values.ex_main, '实用为主') && {
          title: '换鞋凳与置物台的取舍',
          text: '实用为主的玄关建议把换鞋凳做成柜体一体式，下面留空放常穿鞋，台面留给钥匙与快递。',
          why: '因为你填了「玄关定位：实用为主」',
        },
      ),
  },
  {
    id: 'entry-pet-walk',
    p: 'P2',
    section: '玄关',
    target: 'ex_other',
    trigger: '养狗',
    run: (c) =>
      hit(
        has(c.values.live_pet, '狗') && {
          title: '遛狗动线上的收纳',
          text: '养狗家庭建议在玄关留一格放牵引绳、湿巾与捡便袋，并在地面材料上选耐刮擦、易冲洗的。',
          why: '因为你填了「是否养宠物」包含狗',
        },
      ),
  },

  /* ==================== 客厅 ==================== */
  {
    id: 'bookshelf-living',
    p: 'P2',
    section: '客厅',
    target: 'lv_sofa',
    value: '灵活家具',
    trigger: '书墙或大长桌 = 需要',
    run: (c) =>
      hit(
        has(c.values.lv_bookshelf, '需要') && {
          title: '学习型客厅的家具取舍',
          text: '做整墙书柜时建议减少沙发体量与茶几，用大长桌替代，客厅使用率会明显提高。',
          why: '因为你填了「书墙或大长桌：需要」',
        },
      ),
  },
  {
    id: 'kids-play-zone',
    p: 'P1',
    section: '客厅',
    target: 'lv_other',
    trigger: '有孩子且客厅需要儿童活动区',
    run: (c) =>
      hit(
        (has(c.values.live_members, '儿子') || has(c.values.live_members, '女儿') || has(c.values.live_members, '未来成员')) &&
          has(c.values.lv_play, '需要') && {
            title: '儿童活动区要留可改造余地',
            text: '建议活动区做可移除的软垫与低矮收纳，家具倒圆角，等孩子长大后这里能直接改成阅读或办公区。',
            why: '因为你家有三口及以上成员，且客厅需要儿童活动区',
          },
      ),
  },
  {
    id: 'piano-place',
    p: 'P2',
    section: '客厅',
    target: 'lv_piano',
    value: '需要',
    trigger: '兴趣爱好包含钢琴',
    run: (c) =>
      hit(
        has(c.values.hobby, '钢琴') && {
          title: '钢琴的位置与地面承重',
          text: '钢琴不要贴着外墙与窗边放置，避免阳光直射与温差，并注意楼下对传声的敏感度。',
          why: '因为你填了「兴趣爱好：钢琴」',
        },
      ),
  },
  {
    id: 'fitness-living',
    p: 'P2',
    section: '客厅',
    target: 'lv_fitness',
    value: '需要',
    trigger: '兴趣爱好包含健身或瑜伽',
    run: (c) =>
      hit(
        (has(c.values.hobby, '健身') || has(c.values.hobby, '瑜伽')) && {
          title: '健身区的减震与镜面',
          text: '家中健身建议地面做减震垫层，靠近邻居的一侧避免硬物直接落地，需要镜面时提前定位置。',
          why: '因为你填了健身或瑜伽',
        },
      ),
  },
  {
    id: 'living-reading',
    p: 'P1',
    section: '客厅',
    target: 'lv_other',
    trigger: '核心功能 = 学习阅读',
    run: (c) =>
      hit(
        has(c.values.lv_core, '学习阅读') && {
          title: '客厅的照明与安静需求',
          text: '以阅读为核心功能时，建议主灯做可调亮度、阅读位补独立光源，并尽量把低频噪音源（冰箱、空调外机）远离客厅。',
          why: '因为你填了「核心功能：学习阅读」',
        },
      ),
  },
  {
    id: 'snack-cabinet',
    p: 'P2',
    section: '客厅',
    target: 'lv_snack',
    value: '需要',
    trigger: '成员包含孩子',
    run: (c) =>
      hit(
        (has(c.values.live_members, '儿子') || has(c.values.live_members, '女儿')) && {
          title: '零食柜与零散物品的收纳',
          text: '有孩子时建议单独留一组零食与玩具柜（带门），避免生活物品长期堆在茶几上。',
          why: '因为家里有孩子',
        },
      ),
  },

  /* ==================== 餐厅 ==================== */
  {
    id: 'coffee-machine',
    p: 'P2',
    section: '餐厅',
    target: 'dn_coffee',
    value: '是',
    trigger: '兴趣爱好包含咖啡',
    run: (c) =>
      hit(
        has(c.values.hobby, '咖啡') && {
          title: '咖啡角的台面与插座',
          text: '咖啡机需要稳定台面与就近插座，建议与水槽保持一臂距离，方便接水与清洁。',
          why: '因为你填了「兴趣爱好：咖啡」',
        },
      ),
  },
  {
    id: 'dining-party',
    p: 'P1',
    section: '餐厅',
    target: 'dn_party',
    trigger: '聚会或派对需求 = 经常',
    run: (c) =>
      hit(
        has(c.values.dn_party, '经常') && {
          title: '多人用餐的桌椅与走道',
          text: '经常聚会建议餐桌选可加长款或圆桌，桌边留出 90cm 以上通道，餐边柜按冷餐、酒具分区。',
          why: '因为你填了「聚会或派对需求：经常」',
        },
      ),
  },
  {
    id: 'dining-work',
    p: 'P1',
    section: '餐厅',
    target: 'dn_work',
    value: '是',
    trigger: '家庭成员需要在家办公或写作业',
    run: (c) =>
      hit(
        (has(c.values.office_need, '长期居家办公') || has(c.values.office_need, '偶尔')) && {
          title: '餐桌兼做工作台',
          text: '餐桌兼办公时，建议在餐桌侧预留插座与网络，并考虑一盏可移动的读写台灯。',
          why: `因为你填了「办公需求：${c.values.office_need}」`,
        },
      ),
  },
  {
    id: 'dining-bar',
    p: 'P2',
    section: '餐厅',
    target: 'dn_bar',
    value: '是',
    trigger: '厨房为开放式或半开放式',
    run: (c) =>
      hit(
        (has(c.values.kt_form, '开放式') || has(c.values.kt_form, '半开放式')) && {
          title: '岛台或吧台的落位',
          text: '开放式厨房可顺手加一段岛台或吧台，既挡油烟又当传菜台，记得预留两侧走道宽度。',
          why: `因为你填了「厨房形式：${c.values.kt_form}」`,
        },
      ),
  },
  {
    id: 'dining-cabinet',
    p: 'P2',
    section: '餐厅',
    target: 'dn_cabinet',
    value: '餐边柜',
    trigger: '厨房小电器较多',
    run: (c) =>
      hit(
        Array.isArray(c.values.kt_appliances) &&
          c.values.kt_appliances.length >= 4 && {
            title: '餐边柜承接厨房外溢的电器',
            text: '厨房小电器超过四件时，建议在餐边柜预留一段台面与插座，把咖啡机与电饭煲外移。',
            why: `因为你填了「厨房小电器」${c.values.kt_appliances.length} 项`,
          },
      ),
  },

  /* ==================== 厨房 ==================== */
  {
    id: 'open-kitchen-risk',
    p: 'P0',
    kind: 'risk',
    section: '厨房',
    target: 'kt_hood',
    value: '侧吸',
    action: 'replace',
    trigger: '厨房形式 = 开放式 且 下厨频率 = 经常',
    run: (c) =>
      hit(
        has(c.values.kt_form, '开放式') &&
          has(c.values.kt_freq, '经常') && {
            title: '开放式厨房遇到高频下厨，油烟方案要先定',
            text: '建议确认油烟机形式与风量（大风量侧吸更合适），并提前了解当地燃气公司与物业对开放厨房的备案要求。',
            why: '因为你填了「厨房形式：开放式」和「下厨频率：经常」',
          },
      ),
  },
  {
    id: 'kitchen-counter-height',
    p: 'P1',
    section: '厨房',
    target: 'kt_counter',
    value: '需要',
    trigger: '已填做饭人身高',
    run: (c) =>
      hit(
        (num(c.values.kt_height_m) > 0 || num(c.values.kt_height_f) > 0) && {
          title: '按身高做高低台面',
          text: '洗切区比烹饪区高 8-10cm 更省腰，建议按主要做饭人身高做高低台面，水槽高度单独定。',
          why: `因为你填了身高「${c.values.kt_height_m ?? '-'} / ${c.values.kt_height_f ?? '-'} cm」`,
        },
      ),
  },
  {
    id: 'kitchen-dishwasher',
    p: 'P2',
    section: '厨房',
    target: 'kt_dishwasher',
    trigger: '洗碗机选择前开式或水槽式',
    run: (c) =>
      hit(
        anyOf(c.values.kt_dishwasher, ['前开式', '水槽式']) && {
          title: '洗碗机的水电与橱柜尺寸',
          text: '洗碗机需要进水、排水与插座，建议在橱柜设计前确定型号与开孔尺寸，避免后期改柜。',
          why: `因为你填了「洗碗机：${c.values.kt_dishwasher}」`,
        },
      ),
  },
  {
    id: 'kitchen-elder-cook',
    p: 'P1',
    section: '厨房',
    target: 'kt_other',
    trigger: '主要做饭人包含父母',
    run: (c) =>
      hit(
        has(c.values.kt_cooker, '父母') && {
          title: '给长辈做饭人留出省力动线',
          text: '父母做饭时，建议备餐台面加宽、常用调料放腰部高度、照明整体提亮，并把燃气灶放在靠近窗户的位置。',
          why: '因为你填了「主要做饭人：父母」',
        },
      ),
  },
  {
    id: 'kitchen-fridge-embedded',
    p: 'P1',
    section: '厨房',
    target: 'kt_fridge',
    trigger: '冰箱形式 = 内嵌',
    run: (c) =>
      hit(
        has(c.values.kt_fridge, '内嵌') && {
          title: '内嵌冰箱的散热与插座',
          text: '内嵌冰箱需要按型号预留散热空间与专属回路插座，建议先定型号再做柜体。',
          why: '因为你填了「冰箱形式：内嵌」',
        },
      ),
  },
  {
    id: 'kitchen-small-appliances',
    p: 'P2',
    section: '厨房',
    target: 'kt_other',
    trigger: '厨房小电器包含蒸烤箱或空气炸锅等台面电器',
    run: (c) =>
      hit(
        (has(c.values.kt_appliances, '蒸烤箱') || has(c.values.kt_appliances, '空气炸锅') || has(c.values.kt_appliances, '微波炉')) && {
          title: '台面电器的收纳与插座数量',
          text: '台面电器多时建议做一组电器高柜并单独排插座回路，避免同一条插座线路上插满大功率设备。',
          why: '因为你填了蒸烤箱或空气炸锅等台面电器',
        },
      ),
  },
  {
    id: 'kitchen-under-cabinet-light',
    p: 'P2',
    section: '厨房',
    target: 'kt_light',
    value: '需要',
    trigger: '下厨频率 = 经常',
    run: (c) =>
      hit(
        has(c.values.kt_freq, '经常') && {
          title: '吊柜下照明要在改电阶段预留',
          text: '经常下厨建议加吊柜下照明，改电阶段就要在吊柜位置留线，装完柜子再补只能走明线。',
          why: '因为你填了「下厨频率：经常」',
        },
      ),
  },

  /* ==================== 阳台 ==================== */
  {
    id: 'balcony-dryer',
    p: 'P1',
    section: '阳台',
    target: 'bl_hanger',
    value: '以烘干为主',
    trigger: '烘干机 = 是',
    run: (c) =>
      hit(
        has(c.values.bl_dryer, '是') && {
          title: '有烘干机后，阳台可以重新规划',
          text: '以烘干为主可以减少晾晒空间，把阳台改成家政柜加收纳，或做成休闲区。',
          why: '因为你填了「烘干机：是」',
        },
      ),
  },
  {
    id: 'balcony-washer-top',
    p: 'P2',
    section: '阳台',
    target: 'bl_washer_top',
    value: '需要',
    trigger: '洗衣机 = 是 且未填上方空间利用',
    run: (c) =>
      hit(
        has(c.values.bl_washer, '是') &&
          !filled(c.values.bl_washer_top) && {
            title: '洗衣机上方空间利用',
            text: '洗衣机上方可做吊柜或台面，增加收纳与分拣空间；注意龙头与插座高度要避开机器顶面。',
            why: '因为你填了「洗衣机：是」，但还没说上方空间怎么用',
          },
      ),
  },
  {
    id: 'balcony-pet',
    p: 'P1',
    section: '阳台',
    target: 'bl_pet',
    value: '需要',
    trigger: '养宠物且阳台需要养花或休闲',
    run: (c) =>
      hit(
        (has(c.values.live_pet, '猫') || has(c.values.live_pet, '狗')) &&
          (has(c.values.bl_func, '休闲') || has(c.values.bl_func, '养花')) && {
            title: '宠物与绿植共处一个阳台',
            text: '宠物与绿植同处一个阳台时，建议绿植上墙或抬高，地面选防滑耐冲洗材质，并留出宠物活动通道。',
            why: '因为家里养宠物，阳台又计划做养花或休闲',
          },
      ),
  },
  {
    id: 'balcony-mop-sink',
    p: 'P2',
    section: '阳台',
    target: 'bl_other',
    trigger: '拖把池 = 是',
    run: (c) =>
      hit(
        has(c.values.bl_mop, '是') && {
          title: '拖把池的下水与位置',
          text: '拖把池需要就近下水与防水收边，若阳台未做水，建议改成带轮拖把桶并预留一个地漏。',
          why: '因为你填了「拖把池：是」',
        },
      ),
  },
  {
    id: 'balcony-enclosed-func',
    p: 'P2',
    section: '阳台',
    target: 'bl_other',
    trigger: '阳台封窗且计划做咖啡角或健身',
    run: (c) =>
      hit(
        has(c.values.bl_window, '是') &&
          (has(c.values.bl_func, '咖啡角') || has(c.values.bl_func, '健身')) && {
            title: '封窗阳台的温度与用电',
            text: '封窗阳台做咖啡角或健身时，建议考虑夏季隔热与冬季保温，并预留插座与地插位置。',
            why: '因为你填了「是否封窗：是」，阳台还要做咖啡角或健身',
          },
      ),
  },

  /* ==================== 主卧 ==================== */
  {
    id: 'bedroom-secondhand',
    p: 'P2',
    section: '主卧',
    target: 'br_clothes',
    value: '长衣',
    trigger: '次净衣区 = 需要',
    run: (c) =>
      hit(
        has(c.values.br_secondhand, '需要') && {
          title: '次净衣区的落位',
          text: '建议在衣柜侧边留出次净衣区，底部配脏衣篓，入住后衣物不容易堆在椅子或床尾。',
          why: '因为你选择了「次净衣区：需要」',
        },
      ),
  },
  {
    id: 'bedroom-night-light',
    p: 'P1',
    section: '主卧',
    target: 'br_other',
    trigger: '起夜习惯 = 频繁起夜',
    run: (c) =>
      hit(
        has(c.values.br_night, '频繁起夜') && {
          title: '起夜时的照明与通道',
          text: '频繁起夜建议做床下感应灯与夜灯回路，通往卫生间的通道不要有门槛与台阶。',
          why: '因为你填了「起夜习惯：频繁起夜」',
        },
      ),
  },
  {
    id: 'bedroom-quiet',
    p: 'P1',
    section: '主卧',
    target: 'br_quiet',
    value: '需要',
    trigger: '家庭成员包含老人或孩子，或临街噪音敏感',
    run: (c) =>
      hit(
        (has(c.values.live_members, '父母') || has(c.values.live_members, '儿子') || has(c.values.live_members, '女儿')) &&
          has(c.values.br_night, '偶尔喝水') && {
            title: '卧室隔音与门缝处理',
            text: '多成员家庭建议主卧做隔音门与门底密封，靠近走廊的墙面加一层隔音棉，空调孔也要做密封。',
            why: '因为你家成员较多，主卧又有起夜习惯',
          },
      ),
  },
  {
    id: 'bedroom-curtain',
    p: 'P2',
    section: '主卧',
    target: 'br_curtain',
    value: '全遮光',
    trigger: '办公需求为长期居家办公或起夜频繁',
    run: (c) =>
      hit(
        (has(c.values.office_need, '长期居家办公') || has(c.values.br_night, '频繁起夜')) && {
          title: '全遮光窗帘的安装方式',
          text: '睡眠质量要求高时建议做全遮光窗帘并预留窗帘盒，遮光布要与墙面交接处压边，避免漏光。',
          why: '因为你填了「办公需求」或「起夜习惯」',
        },
      ),
  },
  {
    id: 'bedroom-storage-boost',
    p: 'P1',
    section: '主卧',
    target: 'br_clothes',
    trigger: '需强化收纳 = 是，或衣物类型超过 4 类',
    run: (c) =>
      hit(
        (has(c.values.br_storage, '是') ||
          (Array.isArray(c.values.br_clothes) && c.values.br_clothes.length >= 4)) && {
          title: '衣柜按衣物类型分区',
          text: '衣物类型多时建议衣柜按长短衣、叠放、被褥与配饰分区，被褥区放在最上层，配饰做抽屉分隔。',
          why: '因为你填了「需强化收纳：是」或衣物类型较多',
        },
      ),
  },

  /* ==================== 其他卧室（空间实例） ==================== */
  {
    id: 'room-kid',
    p: 'P1',
    section: '其他卧室',
    target: 'room_other',
    trigger: '实例房型 = 儿童房',
    run: (c) =>
      c
        .inst('其他卧室')
        .filter((r) => has(c.type(r), '儿童房'))
        .map((r) => ({
          instKey: r.key,
          title: '儿童房要留成长空间',
          text: '建议预留可升降书桌与活动空间，家具做倒圆角处理，衣柜 1.2m 以下留给孩子自己收纳。',
          why: `因为你把「${c.name(r)}」设为儿童房`,
        })),
  },
  {
    id: 'room-elder',
    p: 'P1',
    section: '其他卧室',
    target: 'room_other',
    trigger: '实例房型 = 长辈房',
    run: (c) =>
      c
        .inst('其他卧室')
        .filter((r) => has(c.type(r), '长辈房'))
        .map((r) => ({
          instKey: r.key,
          title: '长辈房的适老细节',
          text: '建议床头留出储物与紧急按钮位置，通道净宽不小于 80cm，地面避免高差与门槛。',
          why: `因为你把「${c.name(r)}」设为长辈房`,
        })),
  },
  {
    id: 'room-bunk',
    p: 'P2',
    section: '其他卧室',
    target: 'room_other',
    trigger: '实例床型 = 高低床',
    run: (c) =>
      c
        .inst('其他卧室')
        .filter((r) => has(r.values.room_bed, '高低床'))
        .map((r) => ({
          instKey: r.key,
          title: '高低床的安全与层高',
          text: '高低床需要确认层高与护栏高度，上铺建议靠墙布置并预留插座与阅读灯。',
          why: `因为你为「${c.name(r)}」选了高低床`,
        })),
  },
  {
    id: 'room-flex',
    p: 'P2',
    section: '其他卧室',
    target: 'room_other',
    trigger: '实例房型 = 多功能房或书房',
    run: (c) =>
      c
        .inst('其他卧室')
        .filter((r) => has(c.type(r), '多功能房') || has(c.type(r), '书房'))
        .map((r) => ({
          instKey: r.key,
          title: '多功能房的可变性',
          text: '多功能房建议用壁床或折叠桌，柜体尽量贴墙做满，留出中间一块能自由变动的空间。',
          why: `因为你把「${c.name(r)}」设为${c.type(r)}`,
        })),
  },
  {
    id: 'room-guest-storage',
    p: 'P2',
    section: '其他卧室',
    target: 'room_other',
    trigger: '实例房型 = 客房 且使用频率极少',
    run: (c) =>
      c
        .inst('其他卧室')
        .filter((r) => has(c.type(r), '客房') && has(r.values.gh_freq, '极少'))
        .map((r) => ({
          instKey: r.key,
          title: '使用频率极低的客房别浪费',
          text: '客房极少用于留宿时，建议兼作储物或书房，床做可折叠或榻榻米，避免一整间房长期闲置。',
          why: `因为你为「${c.name(r)}」填了客房使用频率：极少`,
        })),
  },

  /* ==================== 书房与电竞房（空间实例） ==================== */
  {
    id: 'study-network',
    p: 'P1',
    section: '书房与电竞房',
    target: 'st_network',
    value: '有线上网口',
    trigger: '实例有台式机或笔记本，但未说网络与插座需求',
    run: (c) =>
      c
        .inst('书房与电竞房')
        .filter((r) => (has(r.values.st_desktop, '1台') || has(r.values.st_desktop, '2台') || has(r.values.st_laptop, '1台') || has(r.values.st_laptop, '2台')) && !filled(r.values.st_network))
        .map((r) => ({
          instKey: r.key,
          title: '书房的网口与插座数量',
          text: '设备多时建议每个工位留有线网口与至少四个插座，桌面走线用线槽或线管收口，避免后期拉插线板。',
          why: `因为你为「${c.name(r)}」填了台式机或笔记本，但还没说网络与插座需求`,
        })),
  },
  {
    id: 'study-live',
    p: 'P1',
    section: '书房与电竞房',
    target: 'st_other',
    trigger: '实例需要直播或录音',
    run: (c) =>
      c
        .inst('书房与电竞房')
        .filter((r) => has(r.values.st_live, '需要'))
        .map((r) => ({
          instKey: r.key,
          title: '直播与录音的房间处理',
          text: '直播或录音需要房间做吸音（软包、地毯、窗帘）与专用照明回路，门的密封也要一并考虑。',
          why: `因为你为「${c.name(r)}」选了「直播或录音：需要」`,
        })),
  },
  {
    id: 'study-cloakroom',
    p: 'P2',
    section: '书房与电竞房',
    target: 'st_other',
    trigger: '实例与衣帽间一体化',
    run: (c) =>
      c
        .inst('书房与电竞房')
        .filter((r) => has(r.values.st_cloakroom, '是'))
        .map((r) => ({
          instKey: r.key,
          title: '书房与衣帽间共用一间',
          text: '同处一间时建议用通顶柜体做分隔，柜体背面加一层隔音，避免取衣与用电脑互相干扰。',
          why: `因为你把「${c.name(r)}」设成与衣帽间一体化`,
        })),
  },
  {
    id: 'study-open',
    p: 'P2',
    section: '书房与电竞房',
    target: 'st_other',
    trigger: '实例开放度 = 开放',
    run: (c) =>
      c
        .inst('书房与电竞房')
        .filter((r) => has(r.values.st_open, '开放'))
        .map((r) => ({
          instKey: r.key,
          title: '开放式书房的干扰与隔音',
          text: '开放书房要注意家人走动与电视声的干扰，建议地面加地毯吸音，桌面朝向以背对活动区为宜。',
          why: `因为你把「${c.name(r)}」设为开放`,
        })),
  },
  {
    id: 'study-books',
    p: 'P2',
    section: '书房与电竞房',
    target: 'st_other',
    trigger: '实例藏书量多或定期买书',
    run: (c) =>
      c
        .inst('书房与电竞房')
        .filter((r) => has(r.values.st_books, '多') || has(r.values.st_buybooks, '是'))
        .map((r) => ({
          instKey: r.key,
          title: '藏书量的承重与防潮',
          text: '书多时书架要做通顶并加固层板（每层承重按 30kg 计），靠外墙的一侧注意防潮与防晒。',
          why: `因为「${c.name(r)}」的藏书量较多`,
        })),
  },

  /* ==================== 卫生间（空间实例） ==================== */
  {
    id: 'bath-tub',
    p: 'P1',
    section: '卫生间',
    target: 'wc_other',
    trigger: '实例泡澡需求包含浴缸',
    run: (c) =>
      c
        .inst('卫生间')
        .filter((b) => has(b.values.wc_bath, '浴缸'))
        .map((b) => ({
          instKey: b.key,
          title: '浴缸尺寸与给排水需要现场确认',
          text: '常见浴缸长度 1.5-1.7m，需要确认空间尺寸与给排水位置，建议在量房时一起定。',
          why: `因为你为「${c.name(b)}」选了「泡澡需求：${b.values.wc_bath}」`,
        })),
  },
  {
    id: 'bath-smart-toilet',
    p: 'P1',
    section: '卫生间',
    target: 'wc_other',
    trigger: '实例马桶类型 = 智能马桶',
    run: (c) =>
      c
        .inst('卫生间')
        .filter((b) => has(b.values.wc_toilet, '智能马桶'))
        .map((b) => ({
          instKey: b.key,
          title: '智能马桶的插座与防溅',
          text: '智能马桶需要在马桶侧预留插座并做好防溅；如考虑移位，需现场确认排污条件。',
          why: `因为你为「${c.name(b)}」选了智能马桶`,
        })),
  },
  {
    id: 'bath-elder-safe',
    p: 'P1',
    section: '卫生间',
    target: 'wc_safe',
    value: '需要',
    trigger: '有老人或行动不便成员',
    run: (c) =>
      has(c.values.live_elder, '是')
        ? c.inst('卫生间').map((b) => ({
            instKey: b.key,
            title: '老人使用的卫生间要加扶手',
            text: '建议在坐便器与淋浴位加装防滑扶手、地面选防滑砖，并留出紧急拉绳按钮的位置。',
            why: '因为你填了「有老人或行动不便成员：是」',
          }))
        : [],
  },
  {
    id: 'bath-dry-wet',
    p: 'P2',
    section: '卫生间',
    target: 'wc_other',
    trigger: '实例干湿分离 = 否',
    run: (c) =>
      c
        .inst('卫生间')
        .filter((b) => has(b.values.wc_drywet, '否'))
        .map((b) => ({
          instKey: b.key,
          title: '不做干湿分离的取舍',
          text: '不做干湿分离时，建议浴室柜选防潮材质，把插座与镜柜尽量外移，地面坡度加大到 1.5% 以上。',
          why: `因为你为「${c.name(b)}」选了「干湿分离：否」`,
        })),
  },
  {
    id: 'bath-double-sink',
    p: 'P2',
    section: '卫生间',
    target: 'wc_other',
    trigger: '实例洗手盆 = 双盆',
    run: (c) =>
      c
        .inst('卫生间')
        .filter((b) => has(b.values.wc_sink, '双盆'))
        .map((b) => ({
          instKey: b.key,
          title: '双盆洗手台的长度要求',
          text: '双盆洗手台至少需要 1.4-1.6m 台面，建议两边各留一个插座，并确认镜前灯的位置不与镜柜冲突。',
          why: `因为你为「${c.name(b)}」选了「洗手盆：双盆」`,
        })),
  },
  {
    id: 'bath-laundry',
    p: 'P2',
    section: '卫生间',
    target: 'wc_laundry',
    value: '需要',
    trigger: '家庭成员较多或需要干湿分区收纳',
    run: (c) => {
      const members = Array.isArray(c.values.live_members) ? c.values.live_members : [];
      if (members.length < 3) return [];
      return c.inst('卫生间').map((b) => ({
        instKey: b.key,
        title: '多成员家庭的脏衣区',
        text: '成员多时建议在卫生间或淋浴区外侧留脏衣区，分深浅两格，并考虑一个可移动的收纳篮位置。',
        why: `因为你家填了 ${members.length} 类常住成员`,
      }));
    },
  },

  /* ==================== 收纳与家政 ==================== */
  {
    id: 'housekeeping-cabinet',
    p: 'P2',
    section: '收纳与家政',
    target: 'sc_housekeeping',
    value: '需要',
    trigger: '常用清洁工具包含洗地机或扫地机器人',
    run: (c) =>
      hit(
        (has(c.values.clean_tools, '洗地机') || has(c.values.clean_tools, '扫地机器人')) && {
          title: '家政柜与清洁工具收纳',
          text: '建议做一组家政柜集中收纳清洁工具，并在柜内预留插座给吸尘器与洗地机充电。',
          why: `因为你填了清洁工具：${(c.values.clean_tools as string[]).join('、')}`,
        },
      ),
  },
  {
    id: 'storage-room',
    p: 'P1',
    section: '收纳与家政',
    target: 'sc_storage_room',
    value: '独立储物间',
    trigger: '行李箱数量 ≥ 2 或需要存放露营装备',
    run: (c) =>
      hit(
        (num(c.values.sc_luggage) >= 2 || has(c.values.sc_storage_items, '露营装备')) && {
          title: '行李箱与户外装备的收纳位置',
          text: '建议在储物间或衣柜顶柜预留大件存放区，避免 28 寸行李箱堆在玄关。',
          why: '因为你填了大件物品的收纳需求',
        },
      ),
  },
  {
    id: 'collection-display',
    p: 'P2',
    section: '收纳与家政',
    target: 'sc_collection',
    value: '需要',
    trigger: '兴趣爱好包含手办、盲盒或收藏',
    run: (c) =>
      hit(
        (has(c.values.hobby, '手办') || has(c.values.hobby, '盲盒') || has(c.values.hobby, '收藏')) && {
          title: '收藏品的展示与防尘',
          text: '建议做带玻璃门的展示柜并预留柜内灯带电源，避免开放式格子长期积灰。',
          why: '因为你填了手办、盲盒或收藏类爱好',
        },
      ),
  },
  {
    id: 'cloakroom-need',
    p: 'P1',
    section: '收纳与家政',
    target: 'sc_cloakroom',
    value: '是',
    trigger: '主卧需强化收纳，或衣物类型 ≥ 4 类',
    run: (c) =>
      hit(
        (has(c.values.br_storage, '是') ||
          (Array.isArray(c.values.br_clothes) && c.values.br_clothes.length >= 4) ||
          has(c.values.live_members, '保姆或其他同住')) && {
          title: '衣帽间还是卧室通顶衣柜',
          text: '衣物量大的家庭建议评估做独立衣帽间，空间不足时优先把主卧衣柜做通顶并增加抽屉与挂杆分区。',
          why: '因为你填了「需强化收纳：是」或衣物类型较多',
        },
      ),
  },
  {
    id: 'seasonal-storage',
    p: 'P2',
    section: '收纳与家政',
    target: 'sc_storage_items',
    value: '换季被褥',
    trigger: '填了换季物品存放',
    run: (c) =>
      hit(
        Array.isArray(c.values.sc_seasonal) &&
          c.values.sc_seasonal.length > 0 && {
            title: '换季物品要有专门位置',
            text: '换季物品数量大且不方便搬动，建议固定一处高位储物柜（顶柜或储物间上层），不要分散在各个房间。',
            why: `因为你填了换季物品：${c.values.sc_seasonal.join('、')}`,
          },
      ),
  },

  /* ==================== 补充说明 ==================== */
  {
    id: 'reference-case',
    p: 'P1',
    section: '补充说明',
    target: 'note_ref',
    value: '有',
    trigger: '装修风格偏好包含「说不好，想看参考案例」',
    run: (c) =>
      hit(
        has(c.values.style_pref, '说不好，想看参考案例') && {
          title: '先定参考图再定风格',
          text: '建议收集 3-5 张喜欢的参考图并标注喜欢的是颜色、柜体还是灯光，比文字描述风格更准确。',
          why: '因为你填了「装修风格偏好：说不好，想看参考案例」',
        },
      ),
  },
  {
    id: 'budget-communication',
    p: 'P1',
    section: '补充说明',
    target: 'note_process',
    trigger: '最担心的问题包含超预算或增项',
    run: (c) =>
      hit(
        (has(c.values.pain_points, '超预算') || has(c.values.pain_points, '增项')) && {
          title: '把沟通方式写进需求',
          text: '担心超预算或增项时，建议在需求里写明：任何增项先出书面确认再施工，并在合同里约定变更流程。',
          why: `因为你填了「最担心的问题」包含${has(c.values.pain_points, '超预算') ? '超预算' : '增项'}`,
        },
      ),
  },
  {
    id: 'design-mode-unknown',
    p: 'P2',
    section: '补充说明',
    target: 'note_process',
    trigger: '装修模式 = 还不了解，需要设计师建议',
    run: (c) =>
      hit(
        has(c.values.mode, '还不了解，需要设计师建议') && {
          title: '装修模式需要一次专门的讲解',
          text: '建议请设计师用一页纸讲清纯设计、半包与全包各自的材料与责任边界，再决定模式。',
          why: '因为你填了「装修模式：还不了解，需要设计师建议」',
        },
      ),
  },
];

/** 规则的元信息（不含谓词），可序列化、可被云端覆盖。 */
export function ruleMeta(rule: Rule): RuleMeta {
  return {
    id: rule.id,
    p: rule.p,
    kind: rule.kind ?? 'discover',
    section: rule.section,
    target: rule.target,
    action: rule.action ?? 'append',
    trigger: rule.trigger,
  };
}
