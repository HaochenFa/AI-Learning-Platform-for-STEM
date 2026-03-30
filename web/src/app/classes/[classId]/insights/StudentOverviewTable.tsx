"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StudentDrillDownSheet from "./StudentDrillDownSheet";
import type { ClassInsightsPayload } from "@/lib/actions/insights";

type Props = {
  students: ClassInsightsPayload["students"];
};

function RiskBadge({ level }: { level: "low" | "medium" | "high" }) {
  const classes = {
    high: "bg-[var(--status-error-bg)] text-[var(--status-error-fg)]",
    medium: "bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]",
    low: "bg-[var(--status-success-bg)] text-[var(--status-success-fg)]",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classes[level]}`}
    >
      {level.charAt(0).toUpperCase() + level.slice(1)}
    </span>
  );
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

/**
 * Overview table of all enrolled students.
 *
 * Clicking any row opens the `StudentDrillDownSheet` for that student,
 * showing their per-activity breakdown, AI mini-summary, and a bar chart
 * of individual activity scores.
 *
 * @param students Array of student performance rows from the insights snapshot.
 */
export default function StudentOverviewTable({ students }: Props) {
  const [selectedStudent, setSelectedStudent] = useState<
    ClassInsightsPayload["students"][number] | null
  >(null);

  if (students.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Students</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ui-muted">No student data yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Students</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2 pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Avg Score</TableHead>
                <TableHead>Completion</TableHead>
                <TableHead>Chat</TableHead>
                <TableHead>Risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((student) => (
                <TableRow
                  key={student.student_id}
                  className="cursor-pointer hover:bg-[var(--surface-muted)]"
                  onClick={() => setSelectedStudent(student)}
                >
                  <TableCell className="font-medium">{student.display_name}</TableCell>
                  <TableCell>{pct(student.avg_score)}</TableCell>
                  <TableCell>{pct(student.completion_rate)}</TableCell>
                  <TableCell>{student.chat_message_count}</TableCell>
                  <TableCell>
                    <RiskBadge level={student.risk_level} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedStudent ? (
        <StudentDrillDownSheet
          student={selectedStudent}
          open
          onClose={() => setSelectedStudent(null)}
        />
      ) : null}
    </>
  );
}
