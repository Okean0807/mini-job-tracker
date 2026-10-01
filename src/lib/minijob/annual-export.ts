import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { td, DOCUMENT_LOCALE } from "./document-i18n";
import { appendXlsxSheet, createXlsxBook, createXlsxSheet, writeXlsx } from "./xlsx-export";

import { formatDate, formatEuro, formatHours, monthNames, weekdayNames } from "./calc";
import { saveAndRegisterBytes } from "./generated-docs";
import type { AnnualReport } from "./annual";

const TEAL: [number, number, number] = [16, 122, 110];
const TEAL_LIGHT: [number, number, number] = [170, 216, 210];
const GREY: [number, number, number] = [120, 120, 120];

function docMonthLabel(monthIndex: number): string {
  return monthNames(DOCUMENT_LOCALE)[monthIndex] ?? "";
}

function docFormatEuro(v: number): string {
  return formatEuro(v, DOCUMENT_LOCALE);
}

function docFormatHours(v: number): string {
  return formatHours(v, DOCUMENT_LOCALE);
}


function kpis(report: AnnualReport) {
  return [
    { label: td("annual.kpi.earnings"), value: formatEuro(report.earnings, DOCUMENT_LOCALE) },
    { label: td("annual.kpi.hours"), value: formatHours(report.hours, DOCUMENT_LOCALE) },
    { label: td("annual.kpi.avgRate"), value: formatEuro(report.avgRate, DOCUMENT_LOCALE) },
    { label: td("annual.kpi.workDays"), value: String(report.workDays) },
    { label: td("annual.kpi.bonus"), value: formatEuro(report.bonus, DOCUMENT_LOCALE) },
    { label: td("annual.kpi.avgMonth"), value: formatEuro(report.avgMonthEarnings, DOCUMENT_LOCALE) },
    { label: td("annual.kpi.avgDay"), value: formatHours(report.avgDayHours, DOCUMENT_LOCALE) },
    {
      label: td("annual.kpi.limit"),
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
  const title = td("annual.title", { year: report.year });

  doc.setFontSize(17);
  doc.setTextColor(...TEAL);
  doc.text(td("app.name"), 14, 18);
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text(title, 14, 26);
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text(td("annual.subtitle", { entries: report.entries, months: report.activeMonths }), 14, 31);

  let y = drawKpiGrid(doc, report, 36);
  y = drawBarChart(
    doc,
    td("annual.chart.earnings"),
    report.months.map((m) => docMonthLabel(m.month).slice(0, 3)),
    report.months.map((m) => m.earnings),
    y + 6,
    docFormatEuro,
  );
  y = drawBarChart(
    doc,
    td("annual.chart.hours"),
    report.months.map((m) => docMonthLabel(m.month).slice(0, 3)),
    report.months.map((m) => m.hours),
    y + 4,
    docFormatHours,
  );
  y = drawBarChart(
    doc,
    td("annual.chart.weekdays"),
    weekdayNames(DOCUMENT_LOCALE, "short"),
    report.weekdayHours,
    y + 4,
    docFormatHours,
  );

  autoTable(doc, {
    startY: y + 4,
    head: [
      [
        td("annual.table.month"),
        td("label.hours"),
        td("annual.table.base"),
        td("label.bonus"),
        td("label.earnings"),
        td("annual.table.entries"),
      ],
    ],
    body: report.months.map((m) => [
      docMonthLabel(m.month),
      formatHours(m.hours, DOCUMENT_LOCALE),
      formatEuro(m.base, DOCUMENT_LOCALE),
      formatEuro(m.bonus, DOCUMENT_LOCALE),
      formatEuro(m.earnings, DOCUMENT_LOCALE),
      String(m.entries),
    ]),
    foot: [
      [
        td("label.total"),
        formatHours(report.hours, DOCUMENT_LOCALE),
        formatEuro(report.base, DOCUMENT_LOCALE),
        formatEuro(report.bonus, DOCUMENT_LOCALE),
        formatEuro(report.earnings, DOCUMENT_LOCALE),
        String(report.entries),
      ],
    ],
    styles: { fontSize: 8 },
    headStyles: { fillColor: TEAL },
    footStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: "bold" },
  });

  if (report.jobs.length > 0) {
    autoTable(doc, {
      head: [[td("label.job"), td("label.hours"), td("label.earnings"), td("annual.table.share")]],
      body: report.jobs.map((j) => [
        j.name,
        formatHours(j.hours, DOCUMENT_LOCALE),
        formatEuro(j.earnings, DOCUMENT_LOCALE),
        `${j.share.toFixed(1)} %`,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: TEAL },
    });
  }

  const highlights = [
    report.bestMonth
      ? `${td("annual.best.month")}: ${docMonthLabel(report.bestMonth.month)} · ${formatEuro(report.bestMonth.earnings, DOCUMENT_LOCALE)}`
      : null,
    report.bestDay
      ? `${td("annual.best.day")}: ${formatDate(report.bestDay.date, DOCUMENT_LOCALE)} · ${formatEuro(report.bestDay.earnings, DOCUMENT_LOCALE)}`
      : null,
    report.limit > 0
      ? `${td("annual.kpi.limit")}: ${formatEuro(report.earnings, DOCUMENT_LOCALE)} / ${formatEuro(report.limit, DOCUMENT_LOCALE)} (${Math.round(report.limitShare)} %)`
      : null,
  ].filter(Boolean) as string[];

  if (highlights.length > 0) {
    const lastY =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.text(td("annual.best.title"), 14, lastY + 10);
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    highlights.forEach((line, i) => doc.text(line, 14, lastY + 16 + i * 5));
  }

  const filename = `${title}.pdf`;
  const buffer = doc.output("arraybuffer") as ArrayBuffer;
  saveAndRegisterBytes({
    bytes: buffer,
    filename,
    category: "annual_pdf",
    mimeType: "application/pdf",
  });
}


export function exportAnnualXlsx(report: AnnualReport) {
  const title = td("annual.title", { year: report.year });
  const book = createXlsxBook();

  const overview = kpis(report).map((k) => ({
    [td("annual.table.metric")]: k.label,
    [td("annual.table.value")]: k.value,
  }));
  overview.push(
    {
      [td("annual.table.metric")]: td("annual.best.month"),
      [td("annual.table.value")]: report.bestMonth
        ? `${docMonthLabel(report.bestMonth.month)} · ${formatEuro(report.bestMonth.earnings, DOCUMENT_LOCALE)}`
        : "–",
    },
    {
      [td("annual.table.metric")]: td("annual.best.day"),
      [td("annual.table.value")]: report.bestDay
        ? `${formatDate(report.bestDay.date, DOCUMENT_LOCALE)} · ${formatEuro(report.bestDay.earnings, DOCUMENT_LOCALE)}`
        : "–",
    },
  );
  const overviewSheet = createXlsxSheet(overview);
  overviewSheet["!cols"] = [{ wch: 28 }, { wch: 24 }];
  appendXlsxSheet(book, overviewSheet, td("annual.sheet.overview"));

  const monthRows = report.months.map((m) => ({
    [td("annual.table.month")]: docMonthLabel(m.month),
    [td("label.hours")]: Number(m.hours.toFixed(2)),
    [td("annual.table.base")]: Number(m.base.toFixed(2)),
    [td("report.bonusEur")]: Number(m.bonus.toFixed(2)),
    [td("report.earningsEur")]: Number(m.earnings.toFixed(2)),
    [td("annual.table.entries")]: m.entries,
  }));
  monthRows.push({
    [td("annual.table.month")]: td("label.total"),
    [td("label.hours")]: Number(report.hours.toFixed(2)),
    [td("annual.table.base")]: Number(report.base.toFixed(2)),
    [td("report.bonusEur")]: Number(report.bonus.toFixed(2)),
    [td("report.earningsEur")]: Number(report.earnings.toFixed(2)),
    [td("annual.table.entries")]: report.entries,
  });
  const monthSheet = createXlsxSheet(monthRows);
  monthSheet["!cols"] = [18, 10, 14, 14, 16, 12].map((wch) => ({ wch }));
  appendXlsxSheet(book, monthSheet, td("annual.sheet.months"));

  if (report.jobs.length > 0) {
    const jobSheet = createXlsxSheet(
      report.jobs.map((j) => ({
        [td("label.job")]: j.name,
        [td("label.hours")]: Number(j.hours.toFixed(2)),
        [td("report.earningsEur")]: Number(j.earnings.toFixed(2)),
        [td("annual.table.share")]: Number(j.share.toFixed(1)),
      })),
    );
    jobSheet["!cols"] = [22, 10, 16, 12].map((wch) => ({ wch }));
    appendXlsxSheet(book, jobSheet, td("annual.sheet.jobs"));
  }

  const days = weekdayNames(DOCUMENT_LOCALE);
  const weekdaySheet = createXlsxSheet(
    report.weekdayHours.map((h, i) => ({
      [td("annual.table.weekday")]: days[i] ?? "",
      [td("label.hours")]: Number(h.toFixed(2)),
    })),
  );
  weekdaySheet["!cols"] = [{ wch: 18 }, { wch: 10 }];
  appendXlsxSheet(book, weekdaySheet, td("annual.sheet.weekdays"));

  const filename = `${title}.xlsx`;
  const buffer = writeXlsx(book) as ArrayBuffer;
  saveAndRegisterBytes({
    bytes: buffer,
    filename,
    category: "annual_xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

