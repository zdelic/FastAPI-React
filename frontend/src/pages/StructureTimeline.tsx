// src/pages/StructureTimeline.tsx
import React, { useState } from "react";
import FullCalendar from "@fullcalendar/react";
import resourceTimelinePlugin from "@fullcalendar/resource-timeline";
import interactionPlugin from "@fullcalendar/interaction";
import dayGridPlugin from "@fullcalendar/daygrid";
import deLocale from "@fullcalendar/core/locales/de";
import { getProjectName } from "../api/project";
import { Printer } from "lucide-react";


import {
  fetchStructureTimeline,
  type StructureTimelineResponse,
} from "../api/structure";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import "./TaskCalendar.css";

// ⬇️ isto kao u TaskCalendar – koristimo utils za Austriju
import {
  makeHolidayEventsForRange,
  makeWeekendEventsForRange,
  toYMD,
  type BgEvent,
} from "../utils/calendarAT"; // koristi iste utilse kao TaskCalendar

type Level = "ebene" | "stiege" | "bauteil";

function pct(n: number) {
  const p = Math.round((n || 0) * 100);
  return isNaN(p) ? 0 : p;
}
function isColorDark(hex: string): boolean {
  if (!hex) return false;
  let c = hex.replace("#", "");
  if (c.length === 3)
    c = c
      .split("")
      .map((ch) => ch + ch)
      .join("");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq < 128;
}

export default function StructureTimelinePage() {
  // ruta: podrži i :id i :projectId
  const params = useParams();
  const routeProjectId = params.projectId ?? params.id;
  const [search] = useSearchParams();
  const initialLevel = (search.get("level") as Level) || "ebene";
  const [projectName, setProjectName] = React.useState<string>("");
  const calRef = React.useRef<FullCalendar | null>(null);
  const navigate = useNavigate();  const [level, setLevel] = React.useState<Level>(initialLevel);
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<StructureTimelineResponse | null>(
    null
  );
  const [title, setTitle] = React.useState<string>("");
  const [projRange, setProjRange] = React.useState<{
    start: Date;
    end: Date;
  } | null>(null);

  const projectDays = React.useMemo(() => {
    if (!projRange) return null;
    const ms = projRange.end.getTime() - projRange.start.getTime();
    return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }, [projRange]);

  const [activeView, setActiveView] = useState("resourceTimelineMonth");
  // background eventi (praznici + vikendi), kao u TaskCalendar
  const [holidayEvents, setHolidayEvents] = React.useState<BgEvent[]>([]);
  const [weekendEvents, setWeekendEvents] = React.useState<BgEvent[]>([]);
  const holidayMap = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const h of holidayEvents) {
      if (h.title) m.set(h.start, h.title); // start je "YYYY-MM-DD"
    }
    return m;
  }, [holidayEvents]);
  const lastRangeRef = React.useRef<{ start: string; end: string } | null>(
    null
  );

  const projectIdNum = React.useMemo(() => {
    const n = Number(routeProjectId);
    return Number.isFinite(n) ? n : null;
  }, [routeProjectId]);

  const load = React.useCallback(async () => {
    if (!projectIdNum) return;
    setLoading(true);
    try {
      const res = await fetchStructureTimeline(projectIdNum, { level });
      setData(res);
      // izračun najmanjeg starta i najvećeg enda
      const starts: number[] = [];
      const ends: number[] = [];
      for (const seg of res.segments) {
        for (const a of seg.activities) {
          if (a.start) starts.push(new Date(a.start).getTime());
          if (a.end) ends.push(new Date(a.end).getTime());
        }
      }

      if (starts.length && ends.length) {
        const start = new Date(Math.min(...starts));
        const end = new Date(Math.max(...ends));
        setProjRange({ start, end });

        // auto scroll na početak projekta
        const api = calRef.current?.getApi?.();
        api?.gotoDate(new Date());
      } else {
        // fallback: 6 sedmica od danas, da kalendar ipak nešto prikaže
        const start = new Date();
        const end = new Date();
        end.setDate(start.getDate() + 42);
        setProjRange({ start, end });
      }

      const api = calRef.current?.getApi?.();
      if (api?.view) setTitle(api.view.title);
    } finally {
      setLoading(false);
    }
  }, [projectIdNum, level]);

  React.useEffect(() => {
    load();
    if (projectIdNum) {
      getProjectName(projectIdNum)
        .then(setProjectName)
        .catch(() => setProjectName(""));
    }
  }, [load, projectIdNum]);
  

  // ======== RESOURCE redovi =========
  const resources = React.useMemo(() => {
    if (!data) return [];
    return data.segments
      .map((s) => {
        const totalTasks = s.activities.reduce((a, t) => a + t.total_tasks, 0);
        const doneTasks = s.activities.reduce((a, t) => a + t.done_tasks, 0);
        const delayedCnt = s.activities.reduce(
          (a, t) => a + (t.delayed ? 1 : 0),
          0
        );
        return {
          id: String(s.id),
          title: s.name,
          extendedProps: {
            level: s.level,
            totalTasks,
            doneTasks,
            delayedCnt,
            structurePath: s.structure_path, // 👈 OVO DODAJ
          },
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title, "de", { numeric: true }));
  }, [data]);
  

  // ======== EVENTS =========
  const events = React.useMemo(() => {
    if (!data) return [];
    const evs: any[] = [];
    for (const seg of data.segments) {
      for (const a of seg.activities) {
        if (!a.start || !a.end) continue;
        const color = a.color || "#60a5fa";
        evs.push({
          id: `seg${seg.id}-${a.activity}`,
          title: `${a.activity} • ${a.done_tasks}/${a.total_tasks} (${pct(
            a.progress
          )}%)`,
          start: a.start,
          end: a.end,
          resourceId: String(seg.id),
          editable: false,
          classNames: a.delayed ? [] : [],
          backgroundColor: color,
          borderColor: color,
          extendedProps: {
            delayed: a.delayed,
            progress: a.progress,
            segment: seg.name,
            level: seg.level,
            color,
          },
        });
      }
    }
    return evs;
  }, [data]);

  // ======== EVENT prikaz =========
  const eventContent = (arg: any) => {
    const p = pct(arg.event.extendedProps.progress || 0);
    const bg = arg.event.extendedProps.color as string | undefined;
    const useWhite = bg ? isColorDark(bg) : false;
    const textStyle = { color: useWhite ? "#fff" : "#111827" };
    return (
      <div className="fc-event-main" style={textStyle}>
        <div className="text-xs">{arg.event.title}</div>
        <div className="h-1 w-full mt-1" style={{ backgroundColor: bg }}>
          <div
            className="h-1"
            style={{
              width: `${p}%`,
              backgroundColor: useWhite ? "#fff" : "#111827",
              opacity: 0.3,
            }}
          />
        </div>
      </div>
    );
  };

  // ======== RESOURCE label (lijevi stupac) =========
  const resourceLabelContent = (arg: any) => {
    const { title } = arg.resource;
    const {
      doneTasks = 0,
      totalTasks = 0,
      delayedCnt = 0,
      structurePath,
    } = arg.resource.extendedProps || {};

    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "2px";

    const line1 = document.createElement("div");
    line1.textContent = String(title ?? "");
    line1.style.fontWeight = "600";
    line1.style.fontSize = "12px";
    wrap.appendChild(line1);

    if (structurePath) {
      const linePath = document.createElement("div");
      linePath.textContent = structurePath; // npr. "Bauteil-1 - Stiege-1"
      linePath.style.fontSize = "10px";
      linePath.style.opacity = "0.8";
      wrap.appendChild(linePath);
    }

    const line2 = document.createElement("div");
    line2.style.fontSize = "10px";
    line2.style.opacity = "0.85";
    line2.textContent =
      `✔ ${doneTasks}/${totalTasks}` +
      (delayedCnt ? `   •   ⚠ ${delayedCnt}` : "");
    wrap.appendChild(line2);

    return { domNodes: [wrap] };
  };
  
  // ======== Custom toolbar =========
  const goPrev = () => calRef.current?.getApi()?.prev();
  const goNext = () => calRef.current?.getApi()?.next();
  const goToday = () => calRef.current?.getApi()?.today();
  const setView = (v: string) => calRef.current?.getApi()?.changeView(v);

  // eventSources: korisnički eventi + praznici + vikendi (background)
  const eventSources = React.useMemo(
    () => [
      { id: "struct-events", events }, // tvoje agregirane aktivnosti
      { id: "at-holidays", events: holidayEvents }, // praznici (bg)
      { id: "weekends", events: weekendEvents }, // vikendi (bg)
    ],
    [events, holidayEvents, weekendEvents]
  );

  return (
    <div className="p-4 space-y-3">
      {/* Gornji red */}
      <div className="flex items-center gap-2">
        <h2 className="text-2xl font-bold text-cyan-400">
          🗓 Struktur-Timeline: <span className="text-black">{projectName}</span>
        </h2>

        <select
          className="ml-4 border border-gray-300 rounded-lg px-3 py-2 text-base font-medium text-gray-800 shadow-sm 
             focus:outline-none focus:ring-2 focus:ring-sky-400 hover:border-sky-300 transition-colors"
          value={level}
          onChange={(e) => setLevel(e.target.value as Level)}
          disabled={loading}
        >
          <option value="ebene">Ebene</option>
          <option value="stiege">Stiege</option>
          <option value="bauteil">Bauteil</option>
        </select>

        {/* 👉 desna grupa dugmadi */}
        <div className="flex gap-2 ml-auto no-print">
          <button
            className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1 rounded"
            onClick={() => navigate("/dashboard")}
            title="Dashboard"
          >
            ◀ Zurück zum Dashboard
          </button>
          <button
            onClick={() => navigate(`/projekt/${routeProjectId}`)}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1 rounded"
          >
            ◀ Zurück zum Projekt
          </button>

          <button
            onClick={() => navigate(`/projekt/${routeProjectId}/timeline`)}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1 rounded"
          >
            ◀ Timeline
          </button>

          <button
            onClick={() => window.print()}
            className="flex items-center gap-1 text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded"
          >
            <Printer size={14} /> Drucken
          </button>
        </div>
      </div>

      {/* Toolbar (DE) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-1 rounded border hover:bg-gray-50"
            onClick={goPrev}
            title="Zurück"
            aria-label="Zurück"
          >
            ‹
          </button>
          <button
            className="px-2 py-1 rounded border hover:bg-gray-50"
            onClick={goToday}
            title="Heute"
            aria-label="Heute"
          >
            heute
          </button>
          <button
            className="px-2 py-1 rounded border hover:bg-gray-50"
            onClick={goNext}
            title="Weiter"
            aria-label="Weiter"
          >
            ›
          </button>
        </div>

        <div className="text-xl font-semibold select-none">{title}</div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setView("resourceTimelineDay");
              setActiveView("resourceTimelineDay");
            }}
            className={`px-3 py-1 rounded border ${
              activeView === "resourceTimelineDay"
                ? "bg-blue-600 text-white border-blue-600"
                : "hover:bg-gray-50"
            }`}
          >
            Tag
          </button>

          <button
            onClick={() => {
              setView("resourceTimelineWeek");
              setActiveView("resourceTimelineWeek");
            }}
            className={`px-3 py-1 rounded border ${
              activeView === "resourceTimelineWeek"
                ? "bg-blue-600 text-white border-blue-600"
                : "hover:bg-gray-50"
            }`}
          >
            Woche
          </button>

          <button
            onClick={() => {
              setView("resourceTimelineMonth");
              setActiveView("resourceTimelineMonth");
            }}
            className={`px-3 py-1 rounded border ${
              activeView === "resourceTimelineMonth"
                ? "bg-blue-600 text-white border-blue-600"
                : "hover:bg-gray-50"
            }`}
          >
            Monat
          </button>
        </div>
      </div>

      {/* Legende (DE) */}
      <div className="text-xs text-gray-600 flex items-center gap-4">
        <span>
          <b>Legende:</b>
        </span>
        <span>✔ erledigt / gesamte Aktivitäten im Segment</span>
        <span>⚠ Anzahl überfälliger Aktivitäten</span>

        <span>Fortschrittsbalken = % der abgeschlossenen Aktivitäten</span>
      </div>

      {/* Calendar */}
      <FullCalendar
        ref={calRef}
        plugins={[resourceTimelinePlugin, interactionPlugin, dayGridPlugin]}
        locales={[deLocale]}
        locale="de"
        // 👇 ostaviš ako želiš alatke "Tag/Woche/Monat" – ali baza će biti timeline
        initialView="resourceTimelineMonth"
        // ✅ uži stupci + jedan slot = 1 dan
        slotDuration={{ days: 1 }}
        slotMinWidth={28}
        // ✅ raspon od početka do kraja projekta (kad ga znamo)
        stickyHeaderDates={true}
        // globalni visibleRange ostavi kako je (po projRange)
        visibleRange={
          projRange
            ? () => ({ start: projRange.start, end: projRange.end })
            : undefined
        }
        views={{
          projectTimeline: {
            type: "resourceTimeline",
            // ako hoćeš da view sam “zakači” raspon projekta (neovisno o globalnom)
            visibleRange: projRange
              ? { start: projRange.start, end: projRange.end }
              : undefined,
            slotDuration: { days: 1 },
            slotMinWidth: 28, // usko kao u Monat
          },
        }}
        headerToolbar={false}
        resourceAreaWidth="140px"
        resources={resources}
        eventSources={eventSources}
        resourceAreaHeaderContent={
          level === "ebene"
            ? "Ebene"
            : level === "stiege"
            ? "Stiege"
            : "Bauteil"
        }
        resourceLabelContent={resourceLabelContent}
        eventContent={eventContent}
        editable={false}
        eventOverlap={true}
        height="auto"
        slotLabelFormat={[
          { year: "numeric", month: "long" },
          { day: "2-digit" },
        ]}
        slotLabelContent={(arg) => {
          if (!/^\d+$/.test(arg.text)) return arg.text;
          const dayNum = arg.text;
          const d = arg.date;
          const ymd = toYMD(d);
          const weekday = d.toLocaleDateString("de-AT", { weekday: "short" });
          const holiday = holidayMap.get(ymd);
          return (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                lineHeight: 1.1,
              }}
              title={holiday || undefined}
            >
              <div style={{ fontWeight: 600 }}>{dayNum}</div>
              <div
                style={{
                  fontSize: holiday ? 8 : 11,
                  whiteSpace: "nowrap",
                  opacity: 0.85,
                  textAlign: "left",
                  width: "100%",
                  alignSelf: "flex-start",
                }}
              >
                {weekday}
                {holiday && (
                  <span
                    style={{ marginLeft: 4, color: "#8b0000", fontWeight: 700 }}
                  >
                    • {holiday}
                  </span>
                )}
              </div>
            </div>
          );
        }}
        datesSet={(arg) => {
          setTitle(arg.view.title);
          const startStr = arg.startStr.slice(0, 10);
          const endStr = arg.endStr.slice(0, 10);
          const last = lastRangeRef.current;
          if (last && last.start === startStr && last.end === endStr) return;
          lastRangeRef.current = { start: startStr, end: endStr };
          const rangeStart = new Date(startStr);
          const rangeEnd = new Date(endStr);
          setHolidayEvents(makeHolidayEventsForRange(rangeStart, rangeEnd));
          setWeekendEvents(makeWeekendEventsForRange(rangeStart, rangeEnd));
        }}
      />
    </div>
  );
}
