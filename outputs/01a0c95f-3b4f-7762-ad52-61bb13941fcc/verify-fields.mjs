import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const dir = "D:/项目/装修需求采集助手/outputs/01a0c95f-3b4f-7762-ad52-61bb13941fcc";
const input = await FileBlob.load(`${dir}/装修需求采集表_字段清单_V1.xlsx`);
const wb = await SpreadsheetFile.importXlsx(input);
const sheet = wb.worksheets.getItem("字段总表");

const used = sheet.getUsedRange();
console.log("used range:", used.address);
console.log("gridlines:", sheet.showGridLines);

const headStyle = await wb.inspect({ kind: "computedStyle", sheetId: "字段总表", range: "A4:J4", maxChars: 1200 });
console.log("HEADER STYLE:", headStyle.ndjson.slice(0, 900));

const heights = [4, 5, 6, 30, 60, 100, 200, 205].map((r) => `${r}:${sheet.getRange(`A${r}`).format.rowHeightPx}`).join("  ");
console.log("row heights px ->", heights);

const widths = ["A", "C", "F", "H", "J"].map((c) => `${c}:${sheet.getRange(`${c}5`).format.columnWidth}`).join("  ");
console.log("col widths ->", widths);

const f6 = sheet.getRange("F30").format;
console.log("F30 wrap:", f6.wrapText, "| H30 wrap:", sheet.getRange("H30").format.wrapText);

const tail = sheet.getRange("A201:J201").values;
console.log("row201:", JSON.stringify(tail));
const legend = sheet.getRange("A203:A212").values.flat().filter(Boolean);
console.log("legend codes:", legend.join(","));
console.log("A2 title:", sheet.getRange("A2").values[0][0]);
console.log("freeze:", JSON.stringify(sheet.freezePanes));
