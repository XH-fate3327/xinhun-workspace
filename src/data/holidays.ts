// 2026 年节假日安排（国务院办公厅 2025-11-04 通知）
// 数据来源：中国政府网 / 光明网转载的官方通知
// 结构：放假区间 + 调休上班日，日历上按「休 / 班」标注。
// 跨年后如需更新，在此追加 YEAR 区间即可。

export type HolidayInfo = { name: string; off: boolean };

type Range = { start: string; end: string; name: string; off: boolean };

const RANGES_2026: Range[] = [
  // 元旦：1/1(周四)-1/3(周六) 放假，1/4(周日) 上班
  { start: "2026-01-01", end: "2026-01-03", name: "元旦", off: true },
  { start: "2026-01-04", end: "2026-01-04", name: "上班", off: false },
  // 春节：2/15(周日)-2/23(周一) 放假，2/14、2/28 上班
  { start: "2026-02-14", end: "2026-02-14", name: "上班", off: false },
  { start: "2026-02-15", end: "2026-02-23", name: "春节", off: true },
  { start: "2026-02-28", end: "2026-02-28", name: "上班", off: false },
  // 清明：4/4-4/6 放假
  { start: "2026-04-04", end: "2026-04-06", name: "清明", off: true },
  // 劳动节：5/1-5/5 放假，5/9 上班
  { start: "2026-05-01", end: "2026-05-05", name: "劳动节", off: true },
  { start: "2026-05-09", end: "2026-05-09", name: "上班", off: false },
  // 端午：6/19-6/21 放假
  { start: "2026-06-19", end: "2026-06-21", name: "端午", off: true },
  // 中秋：9/25-9/27 放假；国庆调休 9/20 上班
  { start: "2026-09-20", end: "2026-09-20", name: "上班", off: false },
  { start: "2026-09-25", end: "2026-09-27", name: "中秋", off: true },
  // 国庆：10/1-10/7 放假，10/10 上班
  { start: "2026-10-01", end: "2026-10-07", name: "国庆", off: true },
  { start: "2026-10-10", end: "2026-10-10", name: "上班", off: false },
];

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(start + "T00:00:00");
  const last = new Date(end + "T00:00:00");
  while (cursor <= last) {
    out.push(toYmd(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function build(ranges: Range[]): Record<string, HolidayInfo> {
  const map: Record<string, HolidayInfo> = {};
  for (const range of ranges) {
    for (const day of eachDay(range.start, range.end)) {
      map[day] = { name: range.name, off: range.off };
    }
  }
  return map;
}

export const HOLIDAYS: Record<string, HolidayInfo> = build(RANGES_2026);

export function holidayOf(ymd: string): HolidayInfo | null {
  return HOLIDAYS[ymd] ?? null;
}

// ——— 二十四节气 ———
// 2026 年精确日期（来源：chinese_lunar_calendar solarTermsData2026，北京时间）
const SOLAR_TERMS_2026: Record<string, string> = {
  "2026-01-05": "小寒",
  "2026-01-20": "大寒",
  "2026-02-04": "立春",
  "2026-02-18": "雨水",
  "2026-03-05": "惊蛰",
  "2026-03-20": "春分",
  "2026-04-05": "清明",
  "2026-04-20": "谷雨",
  "2026-05-05": "立夏",
  "2026-05-21": "小满",
  "2026-06-05": "芒种",
  "2026-06-21": "夏至",
  "2026-07-07": "小暑",
  "2026-07-23": "大暑",
  "2026-08-07": "立秋",
  "2026-08-23": "处暑",
  "2026-09-07": "白露",
  "2026-09-23": "秋分",
  "2026-10-08": "寒露",
  "2026-10-23": "霜降",
  "2026-11-07": "立冬",
  "2026-11-22": "小雪",
  "2026-12-07": "大雪",
  "2026-12-22": "冬至",
};

// 其他年份用通用公式 day = floor(Y*0.2422 + C) - floor((Y-1)/4)（21 世纪，误差 ±1 天）
const SOLAR_TERM_C: Array<{ name: string; month: number; c: number }> = [
  { name: "小寒", month: 1, c: 5.4055 },
  { name: "大寒", month: 1, c: 20.12 },
  { name: "立春", month: 2, c: 3.87 },
  { name: "雨水", month: 2, c: 18.73 },
  { name: "惊蛰", month: 3, c: 5.63 },
  { name: "春分", month: 3, c: 20.646 },
  { name: "清明", month: 4, c: 4.81 },
  { name: "谷雨", month: 4, c: 20.1 },
  { name: "立夏", month: 5, c: 5.52 },
  { name: "小满", month: 5, c: 21.04 },
  { name: "芒种", month: 6, c: 5.678 },
  { name: "夏至", month: 6, c: 21.37 },
  { name: "小暑", month: 7, c: 7.108 },
  { name: "大暑", month: 7, c: 22.83 },
  { name: "立秋", month: 8, c: 7.5 },
  { name: "处暑", month: 8, c: 23.13 },
  { name: "白露", month: 9, c: 7.646 },
  { name: "秋分", month: 9, c: 23.042 },
  { name: "寒露", month: 10, c: 8.318 },
  { name: "霜降", month: 10, c: 23.438 },
  { name: "立冬", month: 11, c: 7.438 },
  { name: "小雪", month: 11, c: 22.36 },
  { name: "大雪", month: 12, c: 7.18 },
  { name: "冬至", month: 12, c: 21.94 },
];

export function solarTermOf(ymd: string): string | null {
  if (SOLAR_TERMS_2026[ymd]) return SOLAR_TERMS_2026[ymd];
  const d = new Date(ymd + "T00:00:00");
  const year = d.getFullYear();
  if (year === 2026) return null; // 2026 已用精确表
  const Y = year % 100;
  const leap = Math.floor((Y - 1) / 4);
  const month = d.getMonth() + 1;
  for (const term of SOLAR_TERM_C) {
    if (term.month !== month) continue;
    const day = Math.floor(Y * 0.2422 + term.c) - leap;
    if (d.getDate() === day) return term.name;
  }
  return null;
}
