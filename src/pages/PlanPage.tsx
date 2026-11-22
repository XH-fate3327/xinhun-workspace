import { useMemo, useState, type ChangeEvent } from "react";
import { CaretLeft, CaretRight, Plus, Trash, X } from "@phosphor-icons/react";
import { api } from "../api";
import { useWorkspace } from "../WorkspaceContext";
import { classNames } from "../utils";
import { Button, IconButton, Modal, PageHeader } from "../components/ui";
import { ModuleArtwork } from "../components/ModuleArtwork";
import { holidayOf } from "../data/holidays";
import type { Entity } from "../types";

const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const TIME_ROWS = [
  { start: "08:00", end: "08:45" },
  { start: "08:55", end: "09:40" },
  { start: "10:05", end: "10:50" },
  { start: "11:00", end: "11:45" },
  { start: "14:00", end: "14:45" },
  { start: "14:55", end: "15:40" },
  { start: "16:05", end: "16:50" },
  { start: "17:00", end: "17:45" },
];

// 节假日数据见 src/data/holidays.ts（官方 2026 安排，含调休）

type Task = { id: string; text: string };
type EditMode = "global" | "week" | "range";

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function mondayOf(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toYmd(d);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toYmd(d);
}

function dateOf(weekKey: string, dayIndex: number): string {
  return addDays(weekKey, dayIndex);
}

// 用户规定：2026 年第 1 周 = 2026-11-16；年末那一周（周一本年）算本年最后一周。
const ANCHOR_WEEK = "2026-11-16";
// 年份下拉范围：2020-2040（可按需增改）
const YEAR_OPTIONS = Array.from({ length: 21 }, (_, i) => 2020 + i);

function firstMondayOf(year: number): string {
  const jan1 = new Date(year, 0, 1);
  const jan1Weekday = (jan1.getDay() + 6) % 7; // 0=Mon
  return toYmd(new Date(year, 0, 1 + (jan1Weekday === 0 ? 0 : 7 - jan1Weekday)));
}

function weeksBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / (7 * 86400000));
}

function weekInfo(monday: string): { year: number; week: number } {
  const d = new Date(monday + "T00:00:00");
  const year = d.getFullYear();
  if (year === 2026) {
    if (monday >= ANCHOR_WEEK) return { year: 2026, week: weeksBetween(ANCHOR_WEEK, monday) + 1 };
    // 2026 但早于锚点（计划开始前的周）：回退到本年度首个周一规则，避免出现「2025 第97周」
    return { year: 2026, week: weeksBetween(firstMondayOf(2026), monday) + 1 };
  }
  return { year, week: weeksBetween(firstMondayOf(year), monday) + 1 };
}

function weeksOfYear(year: number): string[] {
  const start = year === 2026 ? ANCHOR_WEEK : firstMondayOf(year);
  const out: string[] = [];
  let m = start;
  for (let i = 0; i < 60; i += 1) {
    if (new Date(m + "T00:00:00").getFullYear() > year) break;
    out.push(m);
    m = addDays(m, 7);
  }
  return out;
}

function fmtMD(ymd: string): string {
  const d = new Date(ymd + "T00:00:00");
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function parseTasks(raw: unknown): (Task & { done?: boolean })[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function coversWeek(slot: Entity, week: string): boolean {
  if (slot.mode === "global") return true;
  return String(slot.start_week) <= week && week <= String(slot.end_week);
}

function effectiveSlot(slots: Entity[], week: string, day: number, row: number): Entity | null {
  const candidates = slots.filter(
    (slot) => Number(slot.day_index) === day && Number(slot.slot_row) === row && coversWeek(slot, week),
  );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0];
}

function modeLabel(mode: string, startWeek: string, endWeek: string): string {
  if (mode === "global") return "全局模式";
  if (mode === "week") return "本周模式";
  const weeks = Math.round((new Date(endWeek + "T00:00:00").getTime() - new Date(startWeek + "T00:00:00").getTime()) / (7 * 86400000)) + 1;
  return `自定义 ${Math.max(1, weeks)} 周`;
}

export function PlanPage() {
  const { data, run } = useWorkspace();
  const thisWeek = useMemo(() => mondayOf(new Date()), []);
  const [weekKey, setWeekKey] = useState<string>(thisWeek);
  const [editing, setEditing] = useState<{ day: number; row: number } | null>(null);
  const [editTasks, setEditTasks] = useState<Task[]>([]);
  const [editMode, setEditMode] = useState<EditMode>("week");
  const [editWeeks, setEditWeeks] = useState(1);
  const [editSlotId, setEditSlotId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterYear, setFilterYear] = useState<number>(() => new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [noteEdit, setNoteEdit] = useState<{ date: string; text: string } | null>(null);
  const [jumpYear, setJumpYear] = useState<number>(() => weekInfo(thisWeek).year);
  const [jumpWeek, setJumpWeek] = useState<number>(() => weekInfo(thisWeek).week);

  const slots = data.planSlots;
  const completions = data.planCompletions;
  const calendarNotes = data.calendarNotes;
  const isPast = weekKey < thisWeek;

  const weekDefault = useMemo<{ mode: EditMode; weeks: number }>(() => {
    const raw = data.settings[`planDefaultMode:${weekKey}`];
    if (raw && typeof raw === "object" && typeof (raw as any).mode === "string") {
      return { mode: (raw as any).mode as EditMode, weeks: Number((raw as any).weeks) || 1 };
    }
    return { mode: "week", weeks: 1 };
  }, [data.settings, weekKey]);

  const goWeek = (delta: number) => setWeekKey((key) => addDays(key, delta * 7));
  const weekRange = `${fmtMD(weekKey)} - ${fmtMD(addDays(weekKey, 6))}`;
  const jumpWeeks = weeksOfYear(jumpYear);
  const changeJumpYear = (year: number) => {
    setJumpYear(year);
    const list = weeksOfYear(year);
    setJumpWeek((w) => Math.min(w, list.length) || 1);
  };
  const doJump = () => {
    const list = weeksOfYear(jumpYear);
    const target = list[jumpWeek - 1];
    if (target) setWeekKey(target);
  };

  const setWeekDefault = async (mode: EditMode, weeks = 1) => {
    await run(() => api.saveSettings({ [`planDefaultMode:${weekKey}`]: { mode, weeks } }));
  };

  const openCell = (day: number, row: number) => {
    if (isPast) {
      // 过去周：只读查看
      const slot = effectiveSlot(slots, weekKey, day, row);
      setEditing({ day, row });
      setEditSlotId(slot?.id ?? null);
      setEditTasks(parseTasks(slot?.tasks));
      setEditMode((slot?.mode as EditMode) ?? weekDefault.mode);
      setEditWeeks(1);
      return;
    }
    const slot = effectiveSlot(slots, weekKey, day, row);
    setEditing({ day, row });
    if (slot) {
      setEditSlotId(slot.id);
      setEditTasks(parseTasks(slot.tasks).map((task) => ({ id: task.id, text: task.text })));
      setEditMode((slot.mode as EditMode) ?? weekDefault.mode);
      setEditWeeks(1);
    } else {
      setEditSlotId(null);
      setEditTasks([{ id: newId(), text: "" }]);
      setEditMode(weekDefault.mode);
      setEditWeeks(weekDefault.weeks);
    }
  };

  const save = async () => {
    if (!editing || isPast) return;
    const { day, row } = editing;
    const tasks = editTasks.filter((t) => t.text.trim()).map((t) => ({ id: t.id, text: t.text.trim() }));
    let startWeek = weekKey;
    let endWeek = weekKey;
    if (editMode === "global") {
      startWeek = "1970-01-01";
      endWeek = "2099-12-31";
    } else if (editMode === "range") {
      endWeek = addDays(weekKey, (Math.max(1, editWeeks) - 1) * 7);
    }
    setSaving(true);
    try {
      const existing = slots.find(
        (s) => Number(s.day_index) === day && Number(s.slot_row) === row && s.mode === editMode &&
          String(s.start_week) === startWeek &&
          (editMode === "range" ? String(s.end_week) === endWeek : true),
      );
      if (existing) {
        await run(() =>
          api.update("planSlots", existing.id, {
            mode: editMode, start_week: startWeek, end_week: endWeek,
            tasks: JSON.stringify(tasks),
          }),
        );
      } else {
        await run(() =>
          api.create("planSlots", {
            day_index: day, slot_row: row, mode: editMode,
            start_week: startWeek, end_week: endWeek,
            tasks: JSON.stringify(tasks),
          }),
        );
      }
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const toggleDone = async (slot: Entity, taskId: string) => {
    const existing = completions.find(
      (c) => c.week === weekKey && c.slot_id === slot.id && c.task_id === taskId,
    );
    if (existing) {
      await run(() => api.update("planCompletions", existing.id, { done: existing.done ? 0 : 1 }));
    } else {
      await run(() => api.create("planCompletions", { week: weekKey, slot_id: slot.id, task_id: taskId, done: 1 }));
    }
  };

  const doneOf = (slot: Entity, taskId: string): boolean => {
    const c = completions.find((x) => x.week === weekKey && x.slot_id === slot.id && x.task_id === taskId);
    return Boolean(c?.done);
  };

  // 日历：当前筛选月份
  const filteredMonthDays = useMemo(() => {
    const first = new Date(filterYear, filterMonth - 1, 1);
    const last = new Date(filterYear, filterMonth, 0);
    const days: Array<{ ymd: string; day: number; weekday: number }> = [];
    for (let d = 1; d <= last.getDate(); d += 1) {
      const date = new Date(filterYear, filterMonth - 1, d);
      days.push({ ymd: toYmd(date), day: d, weekday: (date.getDay() + 6) % 7 });
    }
    return { firstWeekday: (first.getDay() + 6) % 7, days };
  }, [filterYear, filterMonth]);

  // 日历备注：按日期独立存储，与时间块无关
  const noteOfDate = (ymd: string): string => String(calendarNotes.find((n) => n.date === ymd)?.text ?? "").trim();

  const openNote = (ymd: string) => {
    setNoteEdit({ date: ymd, text: noteOfDate(ymd) });
  };

  const saveNote = async () => {
    if (!noteEdit) return;
    const text = noteEdit.text.trim();
    const existing = calendarNotes.find((n) => n.date === noteEdit.date);
    if (existing) {
      if (text) await run(() => api.update("calendarNotes", existing.id, { text }));
      else await run(() => api.remove("calendarNotes", existing.id));
    } else if (text) {
      await run(() => api.create("calendarNotes", { date: noteEdit.date, text }));
    }
    setNoteEdit(null);
  };

  const clearNote = async () => {
    if (!noteEdit) return;
    const existing = calendarNotes.find((n) => n.date === noteEdit.date);
    if (existing) await run(() => api.remove("calendarNotes", existing.id));
    setNoteEdit(null);
  };

  const jumpToDate = (ymd: string) => {
    setWeekKey(mondayOf(new Date(ymd + "T00:00:00")));
  };

  return (
    <div className="plan-page">
      <PageHeader
        icon={<ModuleArtwork module="plan" />}
        eyebrow="日常"
        title="任务计划"
        description="一周七天的课表式任务安排，支持全局 / 本周 / 自定义周期三种编辑模式。"
        actions={<Button variant="secondary" onClick={() => setWeekKey(thisWeek)}><CaretLeft size={15} />回到本周</Button>}
      />

      <div className="plan-toolbar">
        <button className="plan-nav-btn" onClick={() => goWeek(-1)} aria-label="上一周"><CaretLeft size={18} /></button>
        <div className="plan-week-label">
          <strong>第 {weekInfo(weekKey).week} 周</strong>
          <span>{weekRange}{isPast ? " · 已过去（只读）" : weekKey === thisWeek ? " · 本周" : ""}</span>
        </div>
        <button className="plan-nav-btn" onClick={() => goWeek(1)} aria-label="下一周"><CaretRight size={18} /></button>
        <div className="plan-jump">
          <span>快速跳转</span>
          <select value={jumpYear} onChange={(e) => changeJumpYear(Number(e.target.value))}>
            {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y} 年</option>)}
          </select>
          <select value={jumpWeek} onChange={(e) => setJumpWeek(Number(e.target.value))}>
            {jumpWeeks.map((w, i) => <option key={w} value={i + 1}>第 {i + 1} 周（{fmtMD(w)}）</option>)}
          </select>
          <Button size="sm" variant="secondary" onClick={doJump}>跳转</Button>
        </div>
        {!isPast ? (
          <label className="plan-default-mode">
            本周默认编辑模式
            <select value={weekDefault.mode} onChange={(e) => void setWeekDefault(e.target.value as EditMode, weekDefault.weeks)}>
              <option value="week">本周编辑</option>
              <option value="global">全局编辑</option>
              <option value="range">自定义周期</option>
            </select>
            {weekDefault.mode === "range" ? (
              <select value={weekDefault.weeks} onChange={(e) => void setWeekDefault("range", Number(e.target.value))}>
                {[2, 3, 4, 6, 8, 12, 16].map((n) => <option key={n} value={n}>持续 {n} 周</option>)}
              </select>
            ) : null}
          </label>
        ) : null}
      </div>

      <div className="plan-grid">
        <div className="plan-corner" />
        {DAY_NAMES.map((name, index) => (
          <div className="plan-day-head" key={name}>
            <strong>{name}</strong>
            <small>{fmtMD(dateOf(weekKey, index))}</small>
          </div>
        ))}
        {TIME_ROWS.map((row, rowIndex) => (
          <div className="plan-row-fragment" key={rowIndex}>
            <div className="plan-row-head">
              <strong>{rowIndex + 1}</strong>
              <small>{row.start}</small>
              <small>{row.end}</small>
            </div>
            {DAY_NAMES.map((_, dayIndex) => {
              const slot = effectiveSlot(slots, weekKey, dayIndex, rowIndex);
              const tasks = slot ? parseTasks(slot.tasks) : [];
              const retro = isPast && slot && String(slot.updated_at ?? "").slice(0, 10) > addDays(weekKey, 6);
              return (
                <div
                  key={dayIndex}
                  className={classNames("plan-cell", slot && "has-content", isPast && "is-past", retro && "is-retro")}
                  onClick={() => openCell(dayIndex, rowIndex)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") openCell(dayIndex, rowIndex); }}
                >
                  {slot ? (
                    <div className="plan-cell-body">
                      {tasks.map((task, i) => (
                        <label key={task.id} className="plan-task-line" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={doneOf(slot, task.id)}
                            onChange={() => void toggleDone(slot, task.id)}
                            aria-label={`完成任务 ${task.text}`}
                          />
                          <span className={classNames(doneOf(slot, task.id) && "is-done")}>{task.text}</span>
                        </label>
                      ))}
                      {slot.mode === "global" ? <span className="plan-mode-tag">全局</span> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="plan-lower">
        <div className="plan-filter">
          <div className="plan-filter-row">
            <span>快速定位</span>
            <select value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))}>
              {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y} 年</option>)}
            </select>
            <select value={filterMonth} onChange={(e) => setFilterMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m} 月</option>)}
            </select>
            <Button variant="secondary" size="sm" onClick={() => jumpToDate(`${filterYear}-${String(filterMonth).padStart(2, "0")}-01`)}>跳转到该月</Button>
          </div>
          <div className="plan-calendar">
            <div className="plan-calendar-head">
              {DAY_NAMES.map((n) => <span key={n}>{n}</span>)}
            </div>
            <div className="plan-calendar-grid">
              {Array.from({ length: filteredMonthDays.firstWeekday }).map((_, i) => <span key={`e${i}`} className="plan-calendar-empty" />)}
              {filteredMonthDays.days.map(({ ymd, day, weekday }) => {
                const note = noteOfDate(ymd);
                const holiday = holidayOf(ymd);
                const isWeekend = weekday >= 5;
                const isOff = holiday?.off === true;
                const isWork = holiday != null && holiday.off === false;
                return (
                  <button
                    key={ymd}
                    className={classNames("plan-calendar-day", isWeekend && "is-weekend", isOff && "is-holiday", isWork && "is-workday", note && "has-note")}
                    onClick={() => openNote(ymd)}
                    title={note || (holiday ? holiday.name : undefined)}
                  >
                    <span className="plan-calendar-num">{day}</span>
                    {isOff ? <span className="plan-calendar-holiday">{holiday?.name}<em>休</em></span> : null}
                    {isWork ? <span className="plan-calendar-work">班</span> : null}
                    {note ? <span className="plan-calendar-note">{note}</span> : null}
                  </button>
                );
              })}
            </div>
            {noteEdit ? (
              <div className="plan-note-editor">
                <span className="plan-note-date">{fmtMD(noteEdit.date)} · 备注</span>
                <input
                  autoFocus
                  value={noteEdit.text}
                  onChange={(e) => setNoteEdit({ date: noteEdit.date, text: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") void saveNote(); if (e.key === "Escape") setNoteEdit(null); }}
                  placeholder="写点备注，比如：交作业 / 带教材 / 会议"
                />
                <Button size="sm" onClick={() => void saveNote()}>保存</Button>
                {noteOfDate(noteEdit.date) ? <Button size="sm" variant="ghost" onClick={() => void clearNote()}>清除</Button> : null}
                <Button size="sm" variant="secondary" onClick={() => setNoteEdit(null)}>取消</Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {editing ? (
        <Modal open onClose={() => setEditing(null)} title={`${DAY_NAMES[editing.day]} · ${TIME_ROWS[editing.row].start}-${TIME_ROWS[editing.row].end}`} wide draggable>
          <div className="plan-edit">
            {isPast ? (
              <div className="plan-edit-readonly">
                过去周只读查看（内容所属：{editSlotId ? modeLabel(editMode, String(slots.find((s) => s.id === editSlotId)?.start_week ?? weekKey), String(slots.find((s) => s.id === editSlotId)?.end_week ?? weekKey)) : "未填写"}）
              </div>
            ) : (
              <div className="plan-edit-mode">
                <span>编辑模式</span>
                <select value={editMode} onChange={(e) => setEditMode(e.target.value as EditMode)}>
                  <option value="week">本周编辑（只改本周）</option>
                  <option value="global">全局编辑（每周同步）</option>
                  <option value="range">自定义周期</option>
                </select>
                {editMode === "range" ? (
                  <select value={editWeeks} onChange={(e) => setEditWeeks(Number(e.target.value))}>
                    {[2, 3, 4, 6, 8, 12, 16].map((n) => <option key={n} value={n}>从本周起持续 {n} 周</option>)}
                  </select>
                ) : null}
              </div>
            )}

            <div className="plan-edit-section">
              <span>任务清单</span>
              {editTasks.map((task, index) => (
                <div className="plan-edit-task" key={task.id}>
                  <input
                    value={task.text}
                    onChange={(e) => setEditTasks((current) => current.map((t, i) => i === index ? { ...t, text: e.target.value } : t))}
                    placeholder="任务内容，如：计算机网络技术 @行者楼201"
                    disabled={isPast}
                  />
                  {!isPast ? <IconButton label="删除任务" onClick={() => setEditTasks((current) => current.filter((_, i) => i !== index))}><Trash size={14} /></IconButton> : null}
                </div>
              ))}
              {!isPast ? <Button variant="ghost" size="sm" onClick={() => setEditTasks((current) => [...current, { id: newId(), text: "" }])}><Plus size={14} />添加任务</Button> : null}
            </div>

            {!isPast ? (
              <div className="plan-edit-actions">
                <Button variant="secondary" onClick={() => setEditing(null)}>取消</Button>
                <Button onClick={() => void save()} loading={saving}>保存</Button>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
