/**
 * 生成《设计需求解读台》Demo：把真实字段规格、16 项通用清单与模拟需求单注入模板。
 * 用法：node tools/build_designer_demo.mjs
 * 模板：tools/_designer_template.html（勿直接打开，字段数据是空的）
 * 产物：designer/设计需求解读台_Demo_V0.1.html
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const SPEC = read('packages/field-spec/src/field-spec.json');
const SURVEY = read('packages/field-spec/src/survey-checklist.json');
const IDS = new Set(SPEC.map((f) => f.id));

const unknown = [];
const pick = (obj) => {
  const out = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (!IDS.has(k)) unknown.push(k);
    else out[k] = v;
  });
  return out;
};

/* 主场景：89㎡ 旧房翻新，夫妻 + 女儿 + 猫。刻意留空「是否有老人或行动不便成员」「计划入住时间」与客卫的泡澡需求。 */
const D1 = pick({
  base_city: '武汉', base_community: '万科城市花园', base_area: 89, base_layout: '3室2厅2卫',
  base_floor_pos: '中间层', base_house_state: '旧房翻新', base_height: 2.75,
  base_regret: '厨房小、储物不够、采光一般',
  live_type: '长期居住', live_members: ['夫妻', '女儿'], live_ages: '36岁 / 34岁 / 6岁',
  live_change: ['孩子长大'], live_pet: ['猫'], live_pet_count: 1, live_smoke: '否',
  budget_total: '20-30万', budget_focus: ['硬装', '主材', '全屋定制'], mode: '半包',
  style_pref: ['现代简约', '原木'], color_pref: ['暖色', '浅色系'], light_pref: '无主灯',
  office_need: '偶尔', hobby: ['阅读', '咖啡'], guest_freq: '偶尔',
  clean_who: '扫地机器人为主', clean_tools: ['扫地机器人', '吸尘器'],
  pain_points: ['超预算', '增项', '施工质量'], old_furniture: '部分沿用', cabinets_type: '全屋定制',
  base_other: '我平时上班忙，有事先微信我 13812345678；家里地址是洪山区珞喻路 88 号 3 栋 1502',
  dev_ac: ['中央空调'], dev_freshair: '不确定', dev_heat: ['地暖'],
  dev_water: ['想喝直饮水（净水）'], dev_hotwater: '希望打开就有热水',
  dev_smart: ['智能灯光', '电动窗帘', '全屋WIFI'], dev_circuit: ['感应灯', 'USB插座'],
  ex_main: '实用为主', ex_coat: '需要', ex_mirror: '需要', ex_shoe: '需要', ex_storage: '需要',
  lv_type: '储物型', lv_core: '家人休闲', lv_screen: '投影', lv_bookshelf: '需要', lv_play: '需要', lv_sofa: '灵活家具',
  dn_people: 3, dn_table: '岛台餐桌结合', dn_coffee: '是', dn_work: '是',
  kt_freq: '经常', kt_form: '开放式', kt_hood: '集成灶', kt_dishwasher: '前开式',
  kt_fridge: '内嵌', kt_sink: '大单槽', kt_counter: '需要',
  bl_washer: '是', bl_dryer: '是', bl_mop: '是', bl_hanger: ['以烘干为主'],
  bl_pet: '需要', bl_window: '是', bl_robot: ['阳台'],
  br_bed: '1.8m', br_quiet: '需要', br_curtain: '全遮光', br_dresser: '需要',
  br_storage: '是', br_clothes: ['长衣', '短衣', '叠放', '被褥'], br_secondhand: '需要',
  sc_cloakroom: '是', sc_cloakroom_form: '封闭式', sc_storage_room: '与其他空间融合', sc_housekeeping: '需要',
  note_free: '希望厨房能做开放式，但担心油烟；收纳一定要够',
  note_scene: '周末在家做咖啡、陪孩子阅读，猫在阳台晒太阳',
  note_process: '设计方案希望先看平面，不要一上来就出效果图',
});
const D2 = pick({
  base_city: '杭州', base_area: 120, base_house_state: '毛坯', live_members: ['夫妻', '儿子'],
  budget_total: '30-50万', date_movein: '2026-12', kt_freq: '偶尔', kt_form: '封闭式',
  style_pref: ['奶油'], dev_ac: ['中央空调'], bl_window: '是', light_pref: '主灯', cabinets_type: '全屋定制',
});
const D3 = pick({
  base_city: '长沙', base_area: 65, base_house_state: '旧房翻新', live_members: ['独居'],
  budget_total: '10-20万', kt_form: '封闭式', light_pref: '主灯',
});

const DEMANDS = [
  {
    id: 'd1', name: '张先生', status: 'done', submitted: '2026-09-21 20:14',
    overview: '89㎡ · 旧房翻新 · 预算 20-30万 · 夫妻 + 女儿 + 猫',
    values: D1, aiMarks: ['kt_fridge', 'br_secondhand', 'bl_hanger'],
    instances: {
      卫生间: [
        { key: 'wc1', type: '主卫', values: pick({ wc_type: '主卫', wc_drywet: '是', wc_toilet: '智能马桶', wc_bath: '浴缸加淋浴', wc_shower: '淋浴房玻璃', wc_sink: '双盆', wc_towel: '需要', wc_heater: '需要', wc_mirror_cab: '需要' }) },
        { key: 'wc2', type: '客卫', values: pick({ wc_type: '客卫', wc_drywet: '是', wc_toilet: '普通马桶', wc_shower: '淋浴房玻璃', wc_sink: '单盆', wc_laundry: '需要' }) },
      ],
      其他卧室: [
        { key: 'room1', type: '儿童房', values: pick({ room_type: '儿童房', ch_gender_age: '女儿 6 岁', ch_activity: '需要', ch_read: '需要', room_bed: '1.2m', room_desk: '可升降书桌', room_storage: ['衣柜', '玩具柜'] }) },
      ],
    },
  },
  {
    id: 'd2', name: '李女士', status: 'wait', submitted: '2026-09-22 09:40',
    overview: '120㎡ · 毛坯 · 预算 30-50万 · 夫妻 + 儿子',
    values: D2, aiMarks: [],
    instances: { 卫生间: [{ key: 'wc1', type: '主卫', values: pick({ wc_type: '主卫', wc_drywet: '是', wc_toilet: '智能马桶', wc_bath: '淋浴' }) }] },
  },
  {
    id: 'd3', name: '陈先生', status: 'wait', submitted: '2026-09-22 21:05',
    overview: '65㎡ · 老房翻新 · 预算 10-20万 · 独居',
    values: D3, aiMarks: [], instances: {},
  },
];

if (unknown.length) {
  console.error('以下字段 ID 不存在于字段规格：', [...new Set(unknown)].join(', '));
  process.exit(1);
}

const tplPath = path.join(ROOT, 'tools', '_designer_template.html');
const outPath = path.join(ROOT, 'designer', '设计需求解读台_Demo_V0.1.html');
let html = fs.readFileSync(tplPath, 'utf8');
const inject = (token, data) => {
  if (!html.includes(token)) { console.error('模板缺少占位符：' + token); process.exit(1); }
  html = html.replace(token, JSON.stringify(data));
};
inject('/*__FIELD_SPEC__*/[]', SPEC);
inject('/*__SURVEY__*/[]', SURVEY);
inject('/*__DEMANDS__*/[]', DEMANDS);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log('生成 ' + path.basename(outPath) + '：' + SPEC.length + ' 个字段、' + SURVEY.length + ' 项通用清单、' + DEMANDS.length + ' 份需求单，' + fs.statSync(outPath).size + ' 字节');