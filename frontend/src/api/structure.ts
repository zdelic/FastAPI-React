// src/api/structure.ts
import axios from "./axios";

export type StructActivity = {
  activity: string;
  start: string | null;
  end: string | null;
  total_tasks: number;
  done_tasks: number;
  progress: number;
  delayed: boolean;
  color?: string;
  gewerk?: string;
};

export type StructSegment = {
  level: "ebene" | "stiege" | "bauteil";
  id: number;
  name: string;
  structure_path?: string;
  activities: StructActivity[];
};

export type StructureTimelineResponse = {
  project_id: number;
  level: "ebene" | "stiege" | "bauteil";
  segments: StructSegment[];
};

type Params = Partial<{
  level: "ebene" | "stiege" | "bauteil";
  gewerk: string[];
  status: string[];
  startDate: string;
  endDate: string;
  delayed: boolean;
  taskName: string;
  topIds: number[];
  tops: string[];
  ebenen: string[];
  stiegen: string[];
  bauteile: string[];
  activities: string[];
  processModels: string[];
}>;

export async function fetchStructureTimeline(
  projectId: number,
  p: Params = {}
) {
  const params = new URLSearchParams();

  const set = (k: string, v?: string | number | boolean | null) => {
    if (v === undefined || v === null || v === "") return;
    params.set(k, String(v));
  };
  const addAll = (k: string, arr?: (string | number)[]) => {
    if (!Array.isArray(arr) || arr.length === 0) return;
    for (const x of arr) {
      if (x === undefined || x === null || x === "") continue;
      params.append(k, String(x));
    }
  };

  set("level", p.level ?? "ebene");
  set("startDate", p.startDate);
  set("endDate", p.endDate);
  set("delayed", typeof p.delayed === "boolean" ? p.delayed : undefined);
  set("taskName", p.taskName);

  addAll("gewerk", p.gewerk);
  addAll("status", p.status);
  addAll("topIds", p.topIds as number[] | undefined);
  addAll("tops", p.tops);
  addAll("ebenen", p.ebenen);
  addAll("stiegen", p.stiegen);
  addAll("bauteile", p.bauteile);
  addAll("activities", p.activities);
  addAll("processModels", p.processModels);

  const url = `/projects/${projectId}/structure-timeline`;
  const { data } = await axios.get<StructureTimelineResponse>(
    `${url}?${params.toString()}`
  );
  return data;
}
