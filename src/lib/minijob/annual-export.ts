import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

import { t } from "@/lib/i18n";

import { formatDate, formatEuro, formatHours, weekdayNames } from "./calc";
import type { AnnualReport } from "./annual";

const TEAL: [number, number, number] = [16, 122, 110];
const TEAL_LIGHT: [number, number, number] = [170, 216, 210];
const GREY: [number, number, number] = [120, 120, 120];

function kpis(report: AnnualReport) {
  return [
    { label: t("annual.kpi.earnings"), value: formatEuro(report.earnings) },
    { label: t("annual.kpi.hours"), value: formatHours(report.hours) },
    { label: t("annual.kpi.avgRate"), value: formatEuro(report.avgRate) },
    { label: t("annual.kpi.workDays"), value: String(report.workDays) },
    { label: t("annual.kpi.bonus"), value: formatEuro(report.bonus) },
    { label: t("annual.kpi.avgMonth"), value: formatEuro(report.avgMonthEarnings) },
    { label: t("annual.kpi.avgDay"), value: formatHours(report.avgDayHours) },
    {
      label: t("annual.kpi.limit"),
      value: report.limit > 0 ? `${Math.round(report.limitShare)} %` : "–",
    },
  ];
}

function drawKpiGrid(doc: jsPDF, report: AnnualReport, top: number): number {
  const items = kpis(report);
  const left = 14;
  const width = 45.5;
  const height = 20;
  const gap = 3;
  items.forEach((item, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = left + col * (width + gap);
    const y = top + row * (height + gap);
    doc.setFillColor(245, 248, 247);
    doc.roundedRect(x, y, width, height, 2, 2, "F");
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text(item.label, x + 3, y + 6, { maxWidth: width - 6 });
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text(item.value, x + 3, y + 15);
  });
  return top + Math.ceil(items.length / 4) * (height + gap);
}

function drawBarChart(
  doc: jsPDF,
  title: string,
  labels: string[],
  values: number[],
  top: number,
  format: (v: number) => string,
): number {
  const left = 14;
  const width = 182;
  const height = 46;
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  doc.text(title, left, top);

  const baseY = top + 6 + height;
  doc.setDrawColor(220, 220, 220);
  doc.line(left, baseY, left + width, baseY);

  const max = Math.max(...values, 0);
  const slot = width / values.length;
  const barWidth = slot * 0.6;
  values.forEach((value, i) => {
    const h = max > 0 ? (value / max) * height : 0;
    const x = left + i * slot + (slot - barWidth) / 2;
    doc.setFillColor(...(value === max && max > 0 ? TEAL : TEAL_LIGHT));
    if (h > 0) doc.roundedRect(x, baseY - h, barWidth, h, 1, 1, "F");
    doc.setFontSize(6.5);
    doc.setTextColor(...GREY);
    doc.text(labels[i] ?? "", x + barWidth / 2, baseY + 4, { align: "center" });
  });

  doc.setFontSize(7);
  doc.setTextColor(...GREY);
  if (max > 0) doc.text(format(max), left, top + 5);
  return baseY + 10;
}

export function exportAnnualPdf(report: AnnualReport) {
  const doc = new jsPDF();
  const title = t("annual.title", { year: report.year });

  doc.setFontSize(17);
  doc.setTextColor(...TEAL);
  doc.text(t("app.name"), 14, 18);
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text(title, 14, 26);
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text(
    t("annual.subtitle", { entries: report.entries, months: report.activeMonths }),
    14,
    31,
  );

  let y = drawKpiGrid(doc, report, 36);
  y = drawBarChart(
    doc,
    t("annual.chart.earnings"),
    report.months.map((m) => m.label.slice(0, 3)),
    report.months.map((m) => m.earnings),
    y + 6,
    formatEuro,
  );
  y = drawBarChart(
    doc,
    t("annual.chart.hours"),
    report.months.map((m) => m.label.slice(0, 3)),
    report.months.map((m) => m.hours),
    y + 4,
    formatHours,
  );
  y = drawBarChart(
    doc,
    t("annual.chart.weekdays"),
    weekdayNames(undefined, "short"),
    report.weekdayHours,
    y + 4,
    formatHours,
  );

  autoTable(doc, {
    startY: y + 4,
    head: [
      [
        t("annual.table.month"),
        t("label.hours"),
        t("annual.table.base"),
        t("label.bonus"),
        t("label.earnings"),
        t("annual.table.entries"),
      ],
    ],
    body: report.months.map((m) => [
      m.label,
      formatHours(m.hours),
      formatEuro(m.base),
      formatEuro(m.bonus),
      formatEuro(m.earnings),
      String(m.entries),
    ]),
    foot: [
      [
        t("label.total"),
        formatHours(report.hours),
        formatEuro(report.base),
        formatEuro(report.bonus),
        formatEuro(report.earnings),
        String(report.entries),
      ],
    ],
    styles: { fontSize: 8 },
    headStyles: { fillColor: TEAL },
    footStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: "bold" },
  });

  if (report.jobs.length > 0) {
    autoTable(doc, {
      head: [[t("label.job"), t("label.hours"), t("label.earnings"), t("annual.table.share")]],
      body: report.jobs.map((j) => [
        j.name,
        formatHours(j.hours),
        formatEuro(j.earnings),
        `${j.share.toFixed(1)} %`,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: TEAL },
    });
  }

  const highlights = [
    report.bestMonth
      ? `${t("annual.best.month")}: ${report.bestMonth.label} · ${formatEuro(report.bestMonth.earnings)}`
      : null,
    report.bestDay
      ? `${t("annual.best.day")}: ${formatDate(report.bestDay.date)} · ${formatEuro(report.bestDay.earnings)}`
      : null,
    report.limit > 0
      ? `${t("annual.kpi.limit")}: ${formatEuro(report.earnings)} / ${formatEuro(report.limit)} (${Math.round(report.limitShare)} %)`
      : null,
  ].filter(Boolean) as string[];

  if (highlights.length > 0) {
    const lastY =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.text(t("annual.best.title"), 14, lastY + 10);
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    highlights.forEach((line, i) => doc.text(line, 14, lastY + 16 + i * 5));
  }

  doc.save(`${title}.pdf`);
}

export function exportAnnualXlsx(report: AnnualReport) {
  const title = t("annual.title", { year: report.year });
  const book = XLSX.utils.book_new();

  const overview = kpis(report).map((k) => ({
    [t("annual.table.metric")]: k.label,
    [t("annual.table.value")]: k.value,
  }));
  overview.push(
    {
      [t("annual.table.metric")]: t("annual.best.month"),
      [t("annual.table.value")]: report.bestMonth
        ? `${report.bestMonth.label} · ${formatEuro(report.bestMonth.earnings)}`
        : "–",
    },
    {
      [t("annual.table.metric")]: t("annual.best.day"),
      [t("annual.table.value")]: report.bestDay
        ? `${formatDate(report.bestDay.date)} · ${formatEuro(report.bestDay.earnings)}`
        : "–",
    },
  );
  const overviewSheet = XLSX.utils.json_to_sheet(overview);
  overviewSheet["!cols"] = [{ wch: 28 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(book, overviewSheet, t("annual.sheet.overview"));

  const monthRows = report.months.map((m) => ({
    [t("annual.table.month")]: m.label,
    [t("label.hours")]: Number(m.hours.toFixed(2)),
    [t("annual.table.base")]: Number(m.base.toFixed(2)),
    [t("report.bonusEur")]: Number(m.bonus.toFixed(2)),
    [t("report.earningsEur")]: Number(m.earnings.toFixed(2)),
    [t("annual.table.entries")]: m.entries,
  }));
  monthRows.push({
    [t("annual.table.month")]: t("label.total"),
    [t("label.hours")]: Number(report.hours.toFixed(2)),
    [t("annual.table.base")]: Number(report.base.toFixed(2)),
    [t("report.bonusEur")]: Number(report.bonus.toFixed(2)),
    [t("report.earningsEur")]: Number(report.earnings.toFixed(2)),
    [t("annual.table.entries")]: report.entries,
  });
  const monthSheet = XLSX.utils.json_to_sheet(monthRows);
  monthSheet["!cols"] = [18, 10, 14, 14, 16, 12].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(book, monthSheet, t("annual.sheet.months"));

  if (report.jobs.length > 0) {
    const jobSheet = XLSX.utils.json_to_sheet(
      report.jobs.map((j) => ({
        [t("label.job")]: j.name,
        [t("label.hours")]: Number(j.hours.toFixed(2)),
        [t("report.earningsEur")]: Number(j.earnings.toFixed(2)),
        [t("annual.table.share")]: Number(j.share.toFixed(1)),
      })),
    );
    jobSheet["!cols"] = [22, 10, 16, 12].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(book, jobSheet, t("annual.sheet.jobs"));
  }

  const days = weekdayNames();
  const weekdaySheet = XLSX.utils.json_to_sheet(
    report.weekdayHours.map((h, i) => ({
      [t("annual.table.weekday")]: days[i] ?? "",
      [t("label.hours")]: Number(h.toFixed(2)),
    })),
  );
  weekdaySheet["!cols"] = [{ wch: 18 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(book, weekdaySheet, t("annual.sheet.weekdays"));

  XLSX.writeFile(book, `${title}.xlsx`);
}
