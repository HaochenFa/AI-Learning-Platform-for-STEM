"use client";

import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import type { CanvasSpec } from "@/lib/chat/types";

type ChartCanvasProps = {
  spec: Extract<CanvasSpec, { type: "chart" }>;
};

const CHART_COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4", "#84cc16", "#f97316"];

export default function ChartCanvas({ spec }: ChartCanvasProps) {
  const { chartType, title, data, xLabel, yLabel } = spec;

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-ui-primary">{title}</p>
      <div role="img" aria-label={title}>
      <ResponsiveContainer width="100%" height={220}>
        {chartType === "bar" ? (
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} label={xLabel ? { value: xLabel, position: "insideBottom", offset: -2, fontSize: 11 } : undefined} />
            <YAxis tick={{ fontSize: 11 }} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fontSize: 11 } : undefined} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((_entry, index) => (
                <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        ) : chartType === "line" ? (
          <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="value" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        ) : chartType === "pie" ? (
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
              {data.map((_entry, index) => (
                <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ fontSize: 12 }} />
          </PieChart>
        ) : (
          <ScatterChart margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="x" type="number" tick={{ fontSize: 11 }} name={xLabel ?? "Index"} />
            <YAxis dataKey="value" type="number" tick={{ fontSize: 11 }} name={yLabel ?? "Value"} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              contentStyle={{ fontSize: 12 }}
              formatter={(value: number, name: string, props) => [value, props.payload?.label ?? name]}
            />
            <Scatter
              data={data.map((d, i) => ({ ...d, x: d.x ?? i }))}
              fill={CHART_COLORS[0]}
            />
          </ScatterChart>
        )}
      </ResponsiveContainer>
      </div>
    </div>
  );
}
