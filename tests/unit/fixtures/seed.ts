/**
 * 种子场景：89㎡ 旧房翻新，夫妻 + 女儿 + 猫，与两个 Demo 讲的是同一家人。
 *
 * 刻意留空「是否有老人或行动不便成员」「计划入住时间」与客卫的泡澡需求，
 * 这三项加上「新风：不确定」，构成表格理解里的待确认项。
 *
 * 推导项是模型该给出的东西，这里是它的固定桩（技术方案 4.7：测试用 fake provider）。
 * 档位按产品文档 4.5 对齐，与第八章的种子场景数字（必问 9 条 · 共 18 条）一致。
 */

import type { FormModel } from '@zx/field-spec';
import type { DerivedItem } from '@zx/checklist';

export const SEED_NAME = '张先生';
export const SEED_OVERVIEW = '89㎡ · 旧房翻新 · 预算 20-30万 · 夫妻 + 女儿 + 猫';
export const SEED_SUBMITTED = '2026-09-21 20:14';
/** 生成时刻：泛化「计划入住时间」这类相对时间段以它为基准。 */
export const SEED_NOW = new Date('2026-09-23T10:00:00+08:00');

export const SEED_MODEL: FormModel = {
  values: {
    base_city: '武汉',
    base_community: '万科城市花园',
    base_area: 89,
    base_layout: '3室2厅2卫',
    base_floor_pos: '中间层',
    base_house_state: '旧房翻新',
    base_height: 2.75,
    base_regret: '厨房小、储物不够、采光一般',
    live_type: '长期居住',
    live_members: ['夫妻', '女儿'],
    live_ages: '36岁 / 34岁 / 6岁',
    live_change: ['孩子长大'],
    live_pet: ['猫'],
    live_pet_count: 1,
    live_smoke: '否',
    budget_total: '20-30万',
    budget_focus: ['硬装', '主材', '全屋定制'],
    mode: '半包',
    style_pref: ['现代简约', '原木'],
    color_pref: ['暖色', '浅色系'],
    light_pref: '无主灯',
    office_need: '偶尔',
    hobby: ['阅读', '咖啡'],
    guest_freq: '偶尔',
    clean_who: '扫地机器人为主',
    clean_tools: ['扫地机器人', '吸尘器'],
    pain_points: ['超预算', '增项', '施工质量'],
    old_furniture: '部分沿用',
    cabinets_type: '全屋定制',
    base_other: '我平时上班忙，有事先微信我 13812345678；家里地址是洪山区珞喻路 88 号 3 栋 1502',
    dev_ac: ['中央空调'],
    dev_freshair: '不确定',
    dev_heat: ['地暖'],
    dev_water: ['想喝直饮水（净水）'],
    dev_hotwater: '希望打开就有热水',
    dev_smart: ['智能灯光', '电动窗帘', '全屋WIFI'],
    dev_circuit: ['感应灯', 'USB插座'],
    ex_main: '实用为主',
    ex_coat: '需要',
    ex_mirror: '需要',
    ex_shoe: '需要',
    ex_storage: '需要',
    lv_type: '储物型',
    lv_core: '家人休闲',
    lv_screen: '投影',
    lv_bookshelf: '需要',
    lv_play: '需要',
    lv_sofa: '灵活家具',
    dn_people: 3,
    dn_table: '岛台餐桌结合',
    dn_coffee: '是',
    dn_work: '是',
    kt_freq: '经常',
    kt_form: '开放式',
    kt_hood: '集成灶',
    kt_dishwasher: '前开式',
    kt_fridge: '内嵌',
    kt_sink: '大单槽',
    kt_counter: '需要',
    bl_washer: '是',
    bl_dryer: '是',
    bl_mop: '是',
    bl_hanger: ['以烘干为主'],
    bl_pet: '需要',
    bl_window: '是',
    bl_robot: ['阳台'],
    br_bed: '1.8m',
    br_quiet: '需要',
    br_curtain: '全遮光',
    br_dresser: '需要',
    br_storage: '是',
    br_clothes: ['长衣', '短衣', '叠放', '被褥'],
    br_secondhand: '需要',
    sc_cloakroom: '是',
    sc_cloakroom_form: '封闭式',
    sc_storage_room: '与其他空间融合',
    sc_housekeeping: '需要',
    note_free: '希望厨房能做开放式，但担心油烟；收纳一定要够',
    note_scene: '周末在家做咖啡、陪孩子阅读，猫在阳台晒太阳',
    note_process: '设计方案希望先看平面，不要一上来就出效果图',
  },
  instances: {
    卫生间: [
      {
        key: 'wc1',
        section: '卫生间',
        values: {
          wc_type: '主卫',
          wc_drywet: '是',
          wc_toilet: '智能马桶',
          wc_bath: '浴缸加淋浴',
          wc_shower: '淋浴房玻璃',
          wc_sink: '双盆',
          wc_towel: '需要',
          wc_heater: '需要',
          wc_mirror_cab: '需要',
        },
      },
      {
        key: 'wc2',
        section: '卫生间',
        values: {
          wc_type: '次卫',
          wc_drywet: '是',
          wc_toilet: '普通马桶',
          wc_shower: '淋浴房玻璃',
          wc_sink: '单盆',
          wc_laundry: '需要',
        },
      },
    ],
    其他卧室: [
      {
        key: 'room1',
        section: '其他卧室',
        values: {
          room_type: '儿童房',
          ch_gender_age: '女儿 6 岁',
          ch_activity: '需要',
          ch_read: '需要',
          room_bed: '1.2m',
          room_desk: '可升降书桌',
          room_storage: ['衣柜', '玩具柜'],
        },
      },
    ],
  },
};

/** 助手建议写入的字段，界面上标「助手建议」。 */
export const SEED_AI_MARKS = ['kt_fridge', 'br_secondhand', 'bl_hanger'];

export const SEED_DERIVED: DerivedItem[] = [
  {
    object: '层高吊顶',
    question: '层高能不能同时满足无主灯吊顶与中央空调',
    why: '房主填了「照明方式偏好：无主灯」和「空调需求：中央空调」',
    onsiteChecks: ['各房间净高与梁位'],
    relatedFieldIds: ['light_pref', 'dev_ac'],
    impact: ['feasibility'],
  },
  {
    object: '柜体收纳',
    question: '全屋定制 + 强化收纳，现有柜体体积够不够',
    why: '房主填了「柜体制作方式：全屋定制」和「需强化收纳：是」',
    onsiteChecks: ['柜体能否做到顶'],
    relatedFieldIds: ['cabinets_type', 'br_storage'],
    impact: ['feasibility'],
  },
  {
    object: '旧房隐蔽',
    question: '旧房管线、防水与墙体状况要核到什么范围',
    why: '房主填了「房屋现状：旧房翻新」',
    onsiteChecks: ['旧管线年限'],
    relatedFieldIds: ['base_house_state'],
    impact: ['feasibility'],
  },
  {
    object: '排烟',
    question: '厨房是否接受开放式？油烟与燃气条件能不能满足',
    why: '房主填了「厨房形式：开放式」和「下厨频率：经常」',
    onsiteChecks: ['烟道位置与排烟条件', '燃气备案要求'],
    relatedFieldIds: ['kt_form', 'kt_freq'],
    impact: ['feasibility'],
  },
  {
    object: '家政封窗',
    question: '阳台能不能同时放洗衣机、烘干机和猫窝',
    why: '房主填了「洗衣机：是」「烘干机：是」「宠物洗澡或猫窝：需要」「是否封窗：是」',
    onsiteChecks: ['封窗方案'],
    relatedFieldIds: ['bl_washer', 'bl_dryer', 'bl_pet', 'bl_window'],
    impact: ['feasibility'],
  },
  {
    object: '马桶移位',
    question: '两个卫生间的马桶位置能不能调整',
    why: '主卫选了「马桶类型：智能马桶」',
    onsiteChecks: ['排污管位置'],
    relatedFieldIds: ['wc1.wc_toilet'],
    impact: ['cost'],
  },
  {
    object: '猫砂盆位置',
    question: '猫砂盆放哪个卫生间？排水与通风怎么处理',
    why: '房主填了「是否养宠物：猫」',
    onsiteChecks: ['卫生间排水点位与通风条件'],
    relatedFieldIds: ['live_pet'],
    impact: ['cost'],
    space: '卫生间',
  },
  {
    object: '采光噪音',
    question: '主卧的朝向、噪音与采光实际情况',
    why: '房主填了「是否需要隔音：需要」「窗帘需求：全遮光」',
    onsiteChecks: ['窗洞尺寸'],
    relatedFieldIds: ['br_quiet', 'br_curtain'],
    impact: ['cost'],
  },
  {
    object: '亲子阅读',
    question: '客厅的阅读区与亲子活动区怎么划分',
    why: '房主填了「书墙或大长桌：需要」「儿童活动或手工区：需要」',
    onsiteChecks: ['客厅实际净尺寸'],
    relatedFieldIds: ['lv_bookshelf', 'lv_play'],
    impact: ['cost'],
  },
  {
    object: '大件电器',
    question: '内嵌冰箱与洗碗机的尺寸、电源与进水位置',
    why: '房主填了「冰箱形式：内嵌」「洗碗机：前开式」',
    onsiteChecks: ['插座与进水位置'],
    relatedFieldIds: ['kt_fridge', 'kt_dishwasher'],
    impact: ['cost'],
  },
];
