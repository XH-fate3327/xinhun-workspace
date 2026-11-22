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
