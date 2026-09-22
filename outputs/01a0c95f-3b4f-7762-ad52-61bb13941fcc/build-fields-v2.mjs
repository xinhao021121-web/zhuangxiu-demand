import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const DIR = "D:/项目/装修需求采集助手/outputs/01a0c95f-3b4f-7762-ad52-61bb13941fcc";
const SRC = `${DIR}/装修需求采集表_字段清单_V1.xlsx`;
const OUT = `${DIR}/装修需求采集表_字段清单_V2.xlsx`;
const FONT = "Microsoft YaHei";

/* ---------- 读取 V1 作为底稿 ---------- */
const wbV1 = await SpreadsheetFile.importXlsx(await FileBlob.load(SRC));
const rowsV1 = wbV1.worksheets.getItem("字段总表").getRange("A5:J203").values.filter((r) => r && r[0]);
const byId = new Map(rowsV1.map((r) => [r[0], r]));

/* ---------- 移出表单：量房阶段由设计师现场确认 ---------- */
const SURVEY = [
  ["各房间实际净尺寸与层高", "定家具尺寸、吊顶与中央空调可行性", "层高（原 base_height）"],
  ["承重墙、梁位与门窗洞口位置", "判断可拆改范围，避免违规", "结构类，业主无法判断"],
  ["上下水点位、排水立管与管井", "厨卫布局与设备落位", "排水点位（原 dev_drain）"],
  ["同层排水与马桶移位条件", "决定马桶位置能否调整", "马桶类型（原 wc_toilet）"],
  ["燃气表位置与排烟条件", "开放式厨房的合规与油烟方案", "厨房形式（原 kt_form）"],
  ["配电箱回路容量、弱电箱与入户网络", "决定电路改造与网络方案", "电路细节、网络需求"],
  ["空调外机位与冷凝水排放", "确认中央空调或分体机可行性", "空调类型（原 dev_ac）"],
  ["采暖分水器与暖气片位置", "地暖或暖气片的施工条件", "取暖方式（原 dev_heat）"],
  ["阳台承重、封窗与排水条件", "封窗方案与洗衣机、拖把池落位", "是否封窗、阳台功能"],
  ["墙体材质与可开槽条件", "决定开槽与墙面处理方式", "结构类，业主无法判断"],
  ["旧房管线年限、防水与墙体状况", "翻新项目的隐蔽工程范围", "房屋现状（原 base_house_state）"],
  ["采光朝向与噪音源", "窗帘、隔音与灯光方案", "是否需要隔音（原 br_quiet）"],
  ["定制柜安装深度与墙面垂直度", "柜体能否做到顶、是否需补板", "柜体制作方式"],
  ["地面完成面高度衔接", "地暖、地板的完成面与门槛关系", "取暖方式（原 dev_heat）"],
  ["大件电器型号与尺寸确认", "冰箱、洗碗机、热水器的预留条件", "冰箱与洗碗机需求"],
  ["入户门与窗户是否更换及尺寸", "更换周期与施工顺序", "门窗相关需求"],
];

/* ---------- 合并与删除（避免重复填报） ---------- */
const DROP = new Set([
  "base_floor",       // 与「楼层位置」合并
  "dissatisfy",       // 与「对现在住房不满意的地方」合并
  "dev_floorheat",    // 合并为「取暖方式」
  "dev_wallheat",     // 合并为「取暖方式」
  "dev_wifi",         // 合并进「智能家居」
  "ch_need", "el_need", "gh_need",   // 实例存在即表达，不需要「是否需要」
  "ch_bed", "gh_bed",                // 合并为通用「床型与尺寸」
  "ch_desk", "gh_desk",              // 合并为通用「书桌」
  "ch_storage", "gh_wardrobe",       // 合并为通用「收纳需求」
  "el_storage",                      // 合并进通用「收纳需求」
  "note_special",                    // 合并进「其他补充需求」
  "st_need",                         // 实例存在即表达
]);

/* ---------- 改写：生活语言 + 允许「不确定」 ---------- */
const REWRITE = {
  base_area: { label: "建筑面积（大致即可）", note: "可填大概值；不确定可跳过" },
  base_house_state: { options: ["毛坯", "旧房翻新", "精装改造", "不清楚"] },
  base_floor_pos: { label: "楼层位置", options: ["顶楼", "中间层", "底层", "不清楚"] },
  base_regret: { label: "对现在住房或户型不满意的地方" },
  budget_total: {
    label: "装修预算（大致范围）",
    type: "单选",
    options: ["10万以下", "10-20万", "20-30万", "30-50万", "50万以上", "还没想好"],
    note: "改成区间选择，业主更容易回答",
  },
  mode: { options: ["纯设计", "半包", "全包", "拎包", "还不了解，需要设计师建议"] },
  style_pref: { options: ["现代简约", "美式", "轻奢", "原木", "新中式", "法式", "中古", "奶油", "侘寂", "工业风", "说不好，想看参考案例"] },
  pain_points: { options: ["超预算", "工期延误", "增项", "施工质量", "环保污染", "效果不符", "说不上来"] },
  dev_ac: { label: "空调需求", options: ["中央空调", "普通空调（挂机柜机）", "不确定，听设计师建议"] },
  dev_heat: { label: "取暖方式", type: "多选", options: ["地暖", "暖气片墙暖", "只靠空调", "不确定"] },
  dev_freshair: { options: ["需要", "不需要", "不确定"] },
  dev_water: { label: "水质与饮水需求", options: ["想喝直饮水（净水）", "水垢重，想做软水", "不清楚，听设计师建议"] },
  dev_hotwater: { label: "生活热水偏好", type: "单选", options: ["希望打开就有热水", "无所谓", "不确定"] },
  dev_smart: { label: "智能与网络需求", options: ["智能灯光", "电动窗帘", "全屋WIFI", "全屋监控", "智能门锁", "背景音响"] },
  dev_circuit: { label: "生活便利类电路需求", options: ["起夜灯", "感应灯", "USB插座", "背景音乐"] },
  note_free: { label: "其他补充需求" },
  dev_other: { label: "其他补充", type: "长文本" },
  kt_other: { label: "其他补充", type: "长文本" },
};

/* ---------- 新增字段 ---------- */
const NEW_ROWS = [
  // 基础信息
  // 设备与系统
  ["dev_heat", "设备与系统", "空调与采暖", "取暖方式", "多选", "地暖 / 暖气片墙暖 / 只靠空调 / 不确定", "选填", "地面抬高与地板材质", "本次重构", "原「地暖」「墙暖」两项合并"],
  // 其他卧室（可增删实例）
  ["room_type", "其他卧室", "房间定义", "这个房间主要用来做什么", "单选", "儿童房 / 长辈房 / 客房 / 书房 / 电竞房 / 多功能房 / 其他", "推荐填写", "决定该房间渲染哪些字段", "本次重构", "选完类型后只显示相关字段"],
  ["room_bed", "其他卧室", "通用", "床型与尺寸", "单选", "不需要 / 1.2m / 1.5m / 1.8m / 高低床 / 沙发床 / 榻榻米", "选填", "房间尺寸匹配", "本次重构", "各类型通用"],
  ["room_desk", "其他卧室", "通用", "书桌", "单选", "不需要 / 固定书桌 / 可升降书桌", "选填", "学习与办公需求", "本次重构", "各类型通用"],
  ["room_storage", "其他卧室", "通用", "收纳需求", "多选", "衣柜 / 书柜 / 玩具柜 / 杂物柜", "选填", "柜体规划", "本次重构", "各类型通用"],
  ["room_other", "其他卧室", "其他", "其他补充", "长文本", "文本", "选填", "-", "本次重构", "助手建议会写回这里"],
  // 卫生间（可增删实例）
  ["wc_type", "卫生间", "房间定义", "这间卫生间", "单选", "主卫 / 客卫 / 次卫 / 其他", "推荐填写", "决定显示名称与差异化建议", "本次重构", "默认主卫、客卫两间"],
  // 厨房
  // 收纳与家政
  ["sc_other", "收纳与家政", "其他", "其他补充", "长文本", "文本", "选填", "-", "本次重构", "助手建议会写回这里"],
];

/* ---------- 推荐填写（高影响且业主一定答得上） ---------- */
const SUGGEST = new Set([
  "live_members", "budget_total", "live_pet", "pain_points",
  "kt_freq", "kt_form", "wc_bath",
  "room_type", "wc_type",
]);

/* ---------- 空间实例作用域 ---------- */
const SCOPE = {};
rowsV1.forEach(([id, section]) => {
  if (section === "卫生间") SCOPE[id] = "卫生间";
  if (section === "其他卧室") SCOPE[id] = "次卧";
  if (section === "书房与电竞房") SCOPE[id] = "书房";
});
SCOPE.wc_type = "卫生间";
SCOPE.room_type = "次卧";
["room_bed", "room_desk", "room_storage", "room_other"].forEach((id) => { SCOPE[id] = "次卧"; });

/* ---------- 按房型显示的字段 ---------- */
const APPLIES = {
  ch_gender_age: "儿童房", ch_activity: "儿童房", ch_read: "儿童房",
  el_twin: "长辈房", el_safety: "长辈房", el_equip: "长辈房",
  gh_freq: "客房",
};

const SECTION_LABEL = {
  基础信息: "认识你家",
  设备与系统: "设备与系统",
  玄关: "玄关", 客厅: "客厅", 餐厅: "餐厅", 厨房: "厨房", 阳台: "阳台",
  主卧: "主卧", 其他卧室: "其他卧室", 书房与电竞房: "书房与电竞房",
  卫生间: "卫生间", 收纳与家政: "收纳与家政", 补充说明: "补充说明",
};

/* ---------- 组装字段行 ---------- */
const HEAD = ["字段ID", "大类", "空间 / 分组", "字段名", "控件类型", "选项 / 单位", "填写建议", "空间类型", "适用房型", "发现规则触发", "来源", "备注"];
const out = [];

function fromV1(r) {
  const [id, section, group, label, type, opts, required, rule, source, note] = r;
  const rw = REWRITE[id] || {};
  return [
    id,
    SECTION_LABEL[section] || section,
    group,
    rw.label || label,
    rw.type || type,
    rw.options ? rw.options.join(" / ") : opts,
    SUGGEST.has(id) ? "推荐填写" : "选填",
    SCOPE[id] || "固定",
    APPLIES[id] || "全部",
    rule || "-",
    source,
    rw.note || note || "",
  ];
}

rowsV1.forEach((r) => {
  if (DROP.has(r[0]) || !byId.has(r[0])) return;
  out.push(fromV1(r));
});

NEW_ROWS.forEach((row) => {
  if (byId.has(row[0])) return;                       // 已存在于 V1 的改写字段不重复添加
  const section = row[1];
  let idx = -1;
  out.forEach((r, i) => { if (r[1] === (SECTION_LABEL[section] || section)) idx = i; });
  const rowOut = [row[0], SECTION_LABEL[section] || section, row[2], row[3], row[4], row[5], row[6], SCOPE[row[0]] || "固定", APPLIES[row[0]] || "全部", row[7], row[8], row[9]];
  if (idx >= 0) out.splice(idx + 1, 0, rowOut);
  else out.push(rowOut);
});

/* V1 中没有、但需要按新逻辑改写的字段（就地覆盖） */
const PATCH = {
  dev_floorheat: null, dev_wallheat: null,
};
void PATCH;

/* ---------- 生成工作簿 ---------- */
const wb = Workbook.create();
const s1 = wb.worksheets.add("表单字段");
const s2 = wb.worksheets.add("量房确认清单");
s1.showGridLines = false;
s2.showGridLines = false;

const HEADER_ROW = 4;
const FIRST = 5;
const LAST_COL = "L";
const last = FIRST + out.length - 1;

s1.getRange(`A2:${LAST_COL}2`).merge();
s1.getRange("A2").values = [["装修需求采集表 · 字段清单 V2（量房前采集 · 业主可答字段）"]];
s1.getRange(`A2:${LAST_COL}2`).format.font = { name: FONT, size: 14, bold: true, color: "#1F3864" };
s1.getRange(`A2:${LAST_COL}2`).format.rowHeightPx = 26;
s1.getRange(`A2:${LAST_COL}2`).format.borders = { bottom: { style: "thin", color: "#B7C0CC" } };

s1.getRange(`A${HEADER_ROW}:${LAST_COL}${HEADER_ROW}`).values = [HEAD];
s1.getRange(`A${HEADER_ROW}:${LAST_COL}${HEADER_ROW}`).format = {
  fill: "#1F3864",
  font: { name: FONT, size: 10, bold: true, color: "#FFFFFF" },
  verticalAlignment: "center", horizontalAlignment: "center", rowHeightPx: 26,
  borders: { insideVertical: { style: "thin", color: "#FFFFFF" }, bottom: { style: "medium", color: "#1F3864" } },
};

s1.getRange(`A${FIRST}:${LAST_COL}${last}`).values = out;
const body = s1.getRange(`A${FIRST}:${LAST_COL}${last}`);
body.format = {
  font: { name: FONT, size: 10, color: "#16181C" },
  verticalAlignment: "center",
  borders: { insideHorizontal: { style: "thin", color: "#E8EBEF" } },
};
s1.getRange(`F${FIRST}:F${last}`).format.wrapText = true;
s1.getRange(`J${FIRST}:J${last}`).format.wrapText = true;
s1.getRange(`L${FIRST}:L${last}`).format.wrapText = true;
s1.getRange(`G${FIRST}:I${last}`).format.horizontalAlignment = "center";
body.format.autofitRows();

for (let i = 1; i < out.length; i += 1) {
  if (out[i][1] !== out[i - 1][1]) {
    s1.getRange(`A${FIRST + i}:${LAST_COL}${FIRST + i}`).format.borders = { top: { style: "medium", color: "#B7C0CC" } };
  }
}
[16, 12, 12, 24, 10, 46, 10, 10, 10, 30, 9, 24].forEach((w, i) => {
  const col = String.fromCharCode(65 + i);
  if (col === "M") return;
  s1.getRange(`${col}${HEADER_ROW}:${col}${last}`).format.columnWidth = w;
});
s1.freezePanes.freezeRows(HEADER_ROW);
s1.freezePanes.freezeColumns(2);

const noteRow = last + 2;
s1.getRange(`A${noteRow}`).values = [["采集原则（量房前）"]];
s1.getRange(`A${noteRow}`).format.font = { name: FONT, size: 11, bold: true, color: "#1F3864" };
const notes = [
  "1. 只问业主答得上来的：凭生活经验能回答、答错不会更糟、量房时由设计师问更合适的，移入「量房确认清单」。",
  "2. 没有必填项：全部为「推荐填写」或「选填」，推荐填写不阻断提交，只影响完整度与侧栏提示。",
  "3. 每个大类末尾都有「其他补充」，用户自由填写；助手采纳的建议也写回所属大类的「其他补充」并保留来源标记。",
  "4. 可增删的空间实例：次卧（≤4）、卫生间（≤3，默认主卫与客卫）、书房/电竞房（≤2）；其余空间固定一个。",
  "5. 选项与填写并用：能被规则消费的用选项，无法枚举的用填写；不确定的地方提供「不清楚 / 听设计师建议」选项。",
];
s1.getRange(`A${noteRow + 1}:A${noteRow + notes.length}`).values = notes.map((n) => [n]);
s1.getRange(`A${noteRow + 1}:A${noteRow + notes.length}`).format.font = { name: FONT, size: 9, color: "#5A5F66" };

/* ---------- sheet2：量房确认清单 ---------- */
s2.getRange("A2:E2").merge();
s2.getRange("A2").values = [["量房确认清单（设计师现场确认，不由业主填写）"]];
s2.getRange("A2:E2").format.font = { name: FONT, size: 14, bold: true, color: "#1F3864" };
s2.getRange("A2:E2").format.rowHeightPx = 26;
s2.getRange("A2:E2").format.borders = { bottom: { style: "thin", color: "#B7C0CC" } };

const h2 = ["序号", "现场确认项", "确认目的", "来源（业主已表达的相关需求）", "备注"];
s2.getRange("A4:E4").values = [h2];
s2.getRange("A4:E4").format = {
  fill: "#1F3864", font: { name: FONT, size: 10, bold: true, color: "#FFFFFF" },
  verticalAlignment: "center", horizontalAlignment: "center", rowHeightPx: 26,
  borders: { insideVertical: { style: "thin", color: "#FFFFFF" } },
};
const s2rows = SURVEY.map((r, i) => [i + 1, r[0], r[1], r[2], ""]);
s2.getRange(`A5:E${4 + s2rows.length}`).values = s2rows;
const b2 = s2.getRange(`A5:E${4 + s2rows.length}`);
b2.format = { font: { name: FONT, size: 10, color: "#16181C" }, verticalAlignment: "center", borders: { insideHorizontal: { style: "thin", color: "#E8EBEF" } } };
s2.getRange(`B5:D${4 + s2rows.length}`).format.wrapText = true;
s2.getRange(`A5:A${4 + s2rows.length}`).format.horizontalAlignment = "center";
b2.format.autofitRows();
[7, 34, 30, 34, 16].forEach((w, i) => {
  s2.getRange(`${String.fromCharCode(65 + i)}4:${String.fromCharCode(65 + i)}${4 + s2rows.length}`).format.columnWidth = w;
});
s2.freezePanes.freezeRows(4);

wb.recalculate();
await fs.mkdir(DIR, { recursive: true });
const preview = await wb.render({ sheetName: "表单字段", autoCrop: "all", scale: 1, format: "png" });
await fs.writeFile(`${DIR}/fields-v2-preview.png`, new Uint8Array(await preview.arrayBuffer()));
const xlsx = await SpreadsheetFile.exportXlsx(wb);
await xlsx.save(OUT);

const counts = {};
out.forEach((r) => { counts[r[1]] = (counts[r[1]] || 0) + 1; });
console.log("V2 表单字段:", out.length);
console.log("分区:", JSON.stringify(counts, null, 0));
console.log("推荐填写:", out.filter((r) => r[6] === "推荐填写").length);
console.log("量房确认项:", s2rows.length);
