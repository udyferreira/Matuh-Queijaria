import { Link } from "wouter";
import { FileText, ArrowLeft, ChevronDown, ChevronUp, Printer, FileDown, FileSpreadsheet, Pencil, Layers, Milk, Package } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { useCompletedBatches } from "@/hooks/use-batches";
import { getCheeseTypeName, formatBatchCode, ProductionBatch } from "@shared/schema";
import { parseDateOnly } from "@/lib/utils";
import { useState, useRef } from "react";
import { zipSync, strToU8 } from "fflate";
import { EditBatchModal } from "@/components/EditBatchModal";

const STAGE_NAMES: Record<number, string> = {
  1: "Separar o leite e medir parâmetros iniciais",
  2: "Calcular fermentos e coalho",
  3: "Aquecer o leite",
  4: "Adicionar fermentos LR e DX",
  5: "Adicionar fermento KL e coalho",
  6: "Anotar horário de floculação",
  7: "Anotar horário do ponto de corte",
  8: "Corte da massa com a Lira",
  9: "Corte complementar com espátula",
  10: "Mexedura progressiva da massa",
  11: "Enformagem com peneira e paninho",
  12: "Dessoragem em mesa",
  13: "Medir pH inicial e registrar quantidade de peças",
  14: "Colocar na prensa",
  15: "Virar queijos e medir pH",
  16: "Transferir para câmara de secagem",
  17: "Salga em tanque",
  18: "Secagem em prateleiras",
  19: "Transferir para Câmara 2 (início da maturação)",
};

const MEASUREMENT_LABELS: Record<string, string> = {
  milk_volume_l: "Volume de Leite (L)",
  milk_temperature_c: "Temperatura do Leite (°C)",
  milk_ph: "pH do Leite",
  ph_value: "pH",
  ph_measurement: "Medição de pH",
  initial_ph: "pH Inicial",
  pieces_quantity: "Quantidade de Peças",
  chamber_2_entry_date: "Data Entrada Câmara 2",
  flocculation_time: "Hora da Floculação",
  cut_point_time: "Hora do Corte",
  press_start_time: "Hora da Prensa",
  turning_cycles_count: "Quantidade de Viradas",
  timestamp: "Data/Hora"
};

interface MeasurementHistoryItem {
  key: string;
  value: number | string;
  stageId: number;
  timestamp: string;
}

function formatValue(key: string, value: number | string): string {
  if (key === "chamber_2_entry_date") {
    return new Date(value).toLocaleDateString("pt-BR");
  }
  if (key === "timestamp") {
    return new Date(value).toLocaleString("pt-BR");
  }
  if (typeof value === "number") {
    return value.toString();
  }
  return String(value);
}

function getMeasurementLabel(key: string, stageId: number, measurementIndex?: number): string {
  const baseLabel = MEASUREMENT_LABELS[key] || key;
  if (stageId === 15 && measurementIndex !== undefined) {
    return `Medição ${measurementIndex + 1} - ${baseLabel}`;
  }
  return baseLabel;
}

const REPORT_COLUMNS = [
  "Lote",
  "Tipo",
  "Volume (L)",
  "Data Conclusão",
  "Etapa",
  "Campo",
  "Valor",
];

const REPORT_COLUMN_WIDTHS = [12, 15, 12, 15, 35, 25, 20];

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let name = "";
  let current = index;
  while (current >= 0) {
    name = String.fromCharCode((current % 26) + 65) + name;
    current = Math.floor(current / 26) - 1;
  }
  return name;
}

function createWorksheetXml(rows: Array<Record<string, unknown>>): string {
  const headerRow = REPORT_COLUMNS.map((column, columnIndex) => {
    const cellRef = `${columnName(columnIndex)}1`;
    return `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(column)}</t></is></c>`;
  }).join("");

  const bodyRows = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const cells = REPORT_COLUMNS.map((column, columnIndex) => {
      const cellRef = `${columnName(columnIndex)}${rowNumber}`;
      return `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(row[column])}</t></is></c>`;
    }).join("");
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join("");

  const cols = REPORT_COLUMN_WIDTHS.map((width, index) => {
    const columnIndex = index + 1;
    return `<col min="${columnIndex}" max="${columnIndex}" width="${width}" customWidth="1"/>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <cols>${cols}</cols>
  <sheetData>
    <row r="1">${headerRow}</row>
    ${bodyRows}
  </sheetData>
</worksheet>`;
}

function downloadXlsx(rows: Array<Record<string, unknown>>, filename: string) {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Relatório de Lotes" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(createWorksheetXml(rows)),
  };

  const zipped = zipSync(files);
  const blob = new Blob([zipped], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportToExcel(batches: ProductionBatch[], stageTimers: Record<number, number> = {}) {
  const data: any[] = [];
  const allStageIds = Array.from({ length: 19 }, (_, i) => i + 1);
  
  batches.forEach((batch) => {
    const measurements = batch.measurements as Record<string, any> || {};
    const history: MeasurementHistoryItem[] = (measurements._history || []).filter((item: any) => item.key !== 'rollback' && item.key !== 'loop_exit_reason');
    
    const measurementsByStage = history.reduce((acc, item) => {
      if (!acc[item.stageId]) acc[item.stageId] = [];
      acc[item.stageId].push(item);
      return acc;
    }, {} as Record<number, MeasurementHistoryItem[]>);
    
    allStageIds.forEach((stageId) => {
      const stageRows = getStageData(batch, stageId, measurementsByStage, stageTimers);
      stageRows.forEach((row) => {
        data.push({
          "Lote": formatBatchCode(batch.startedAt),
          "Tipo": (batch as any).recipeName || getCheeseTypeName(batch.recipeId),
          "Volume (L)": batch.milkVolumeL,
          "Data Conclusão": batch.completedAt ? new Date(batch.completedAt).toLocaleDateString("pt-BR") : "N/A",
          "Etapa": `${stageId} - ${STAGE_NAMES[stageId] || `Etapa ${stageId}`}`,
          "Campo": row.label,
          "Valor": row.value,
        });
      });
    });
  });

  downloadXlsx(data, `relatorio_lotes_${new Date().toISOString().split("T")[0]}.xlsx`);
}

function getStageData(batch: ProductionBatch, stageId: number, measurementsByStage: Record<number, MeasurementHistoryItem[]>, stageTimers: Record<number, number> = {}) {
  const measurements = batch.measurements as Record<string, any> || {};
  const calculatedInputs = batch.calculatedInputs as Record<string, number> || {};
  const stageHistory = measurementsByStage[stageId] || [];
  const rows: Array<{ label: string; value: string }> = [];

  // Helper: prefer measurements field (always up-to-date after edits) over history
  function fromMeasurementsOrHistory(key: string): any {
    if (measurements[key] != null) return measurements[key];
    return stageHistory.find(i => i.key === key)?.value;
  }

  if (stageId === 1) {
    if (batch.milkVolumeL) rows.push({ label: "Volume de Leite", value: `${batch.milkVolumeL} L` });
    const temp = measurements.milk_temperature_c ?? stageHistory.find(h => h.key === 'milk_temperature_c')?.value;
    if (temp != null) rows.push({ label: "Temperatura do Leite", value: `${temp} °C` });
    const ph = measurements.milk_ph ?? stageHistory.find(h => h.key === 'milk_ph')?.value;
    if (ph != null) rows.push({ label: "pH do Leite", value: String(ph) });
  }

  if (stageId === 4) {
    const isoVal = measurements.ferment_lr_dx_add_time_iso || stageHistory.find(i => i.key === 'ferment_lr_dx_add_time_iso')?.value;
    if (isoVal) {
      try {
        const formatted = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(isoVal));
        rows.push({ label: "Horário de Adição (Fermentos LR/DX)", value: formatted });
      } catch { rows.push({ label: "Horário de Adição (Fermentos LR/DX)", value: String(isoVal) }); }
    }
  }

  if (stageId === 5) {
    const isoVal = measurements.ferment_kl_coalho_add_time_iso || stageHistory.find(i => i.key === 'ferment_kl_coalho_add_time_iso')?.value;
    if (isoVal) {
      try {
        const formatted = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(isoVal));
        rows.push({ label: "Horário de Adição (Fermento KL + Coalho)", value: formatted });
      } catch { rows.push({ label: "Horário de Adição (Fermento KL + Coalho)", value: String(isoVal) }); }
    }
  }

  if (stageId === 17) {
    const isoVal = measurements.brine_entry_time_iso || stageHistory.find(i => i.key === 'brine_entry_time_iso')?.value;
    let displayVal = "—";
    if (isoVal) {
      try {
        displayVal = new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        }).format(new Date(isoVal));
      } catch { displayVal = String(isoVal); }
    }
    rows.push({ label: "Entrada na Salga", value: displayVal });
  }

  if (stageId === 18) {
    const isoVal = measurements.shelf_start_time_iso || stageHistory.find(i => i.key === 'shelf_start_time_iso')?.value;
    let displayVal = "—";
    if (isoVal) {
      try {
        displayVal = new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        }).format(new Date(isoVal));
      } catch { displayVal = String(isoVal); }
    }
    rows.push({ label: "Início da Secagem em Prateleiras", value: displayVal });
  }

  if (stageId === 2 && Object.keys(calculatedInputs).length > 0) {
    const inputLabels: Record<string, string> = {
      FERMENT_LR: "Fermento LR (mL)",
      FERMENT_DX: "Fermento DX (mL)",
      FERMENT_KL: "Fermento KL (mL)",
      RENNET: "Coalho (mL)",
    };
    ['FERMENT_LR', 'FERMENT_DX', 'FERMENT_KL', 'RENNET'].forEach((k) => {
      if (k in calculatedInputs) {
        rows.push({ label: inputLabels[k] || k, value: String(calculatedInputs[k]) });
      }
    });
  }

  if (stageId === 10) {
    const durationMin = stageTimers[10];
    if (durationMin !== undefined) {
      rows.push({ label: "Tempo de Mexedura da Massa", value: `${durationMin} minutos` });
    }
  }

  if (stageId === 6) {
    const val = fromMeasurementsOrHistory('flocculation_time');
    if (val != null) rows.push({ label: "Horário de Floculação", value: String(val) });
  }

  if (stageId === 7) {
    const val = fromMeasurementsOrHistory('cut_point_time');
    if (val != null) rows.push({ label: "Horário do Ponto de Corte", value: String(val) });
  }

  if (stageId === 13) {
    const phVal = measurements.initial_ph ?? stageHistory.find(i => i.key === 'ph_value' || i.key === 'initial_ph')?.value;
    if (phVal != null) rows.push({ label: "pH Inicial", value: String(phVal) });
    const piecesVal = measurements.pieces_quantity ?? stageHistory.find(i => i.key === 'pieces_quantity')?.value;
    if (piecesVal != null) rows.push({ label: "Quantidade de Peças", value: String(piecesVal) });
  }

  if (stageId === 14) {
    const val = fromMeasurementsOrHistory('press_start_time');
    if (val != null) rows.push({ label: "Início da Prensagem", value: String(val) });
  }

  if (stageId === 15) {
    // Use ph_measurements array (always updated on edit) as primary source
    const phArr: any[] = measurements.ph_measurements || [];
    const stage15PhArr = phArr.filter((p: any) => p.stageId === 15 || p.stageId == null);
    if (stage15PhArr.length > 0) {
      stage15PhArr.forEach((item: any, idx: number) => {
        rows.push({ label: `${idx + 1}ª Medição de pH`, value: String(item.value) });
      });
    } else {
      // Fallback: read from history for older batches that pre-date ph_measurements array
      const phItems = stageHistory.filter(i => i.key === 'ph_value' || i.key === 'ph_measurement');
      phItems.forEach((item, idx) => {
        rows.push({ label: `${idx + 1}ª Medição de pH`, value: String(item.value) });
      });
    }
    // turningCyclesCount is a top-level batch column (updated on edit)
    const turningCount = (batch as any).turningCyclesCount ?? measurements.turning_cycles_count
      ?? stageHistory.find(i => i.key === 'turning_cycles_count')?.value;
    if (turningCount != null) rows.push({ label: "Viradas Realizadas", value: String(turningCount) });
  }

  if (stageId === 19) {
    if (batch.chamber2EntryDate) {
      rows.push({ label: "Data de Entrada na Câmara 2", value: parseDateOnly(batch.chamber2EntryDate) });
    }
    if (batch.maturationEndDate) {
      rows.push({ label: "Fim da Maturação (90 dias)", value: parseDateOnly(batch.maturationEndDate) });
    }
    if (batch.completedAt) {
      rows.push({ label: "Data de Conclusão", value: new Date(batch.completedAt).toLocaleDateString("pt-BR") });
    }
  }

  return rows;
}

function BatchReport({ batch, printRef, stageTimers = {} }: { batch: ProductionBatch; printRef?: React.RefObject<HTMLDivElement>; stageTimers?: Record<number, number> }) {
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  
  const measurements = batch.measurements as Record<string, any> || {};
  const history: MeasurementHistoryItem[] = (measurements._history || []).filter((item: any) => item.key !== 'rollback' && item.key !== 'loop_exit_reason');
  const wasEdited = (measurements._history || []).some((item: any) => item.action === 'post_completion_edit');
  
  const measurementsByStage = history.reduce((acc, item) => {
    if (!acc[item.stageId]) {
      acc[item.stageId] = [];
    }
    acc[item.stageId].push(item);
    return acc;
  }, {} as Record<number, MeasurementHistoryItem[]>);

  const allStageIds = Array.from({ length: 19 }, (_, i) => i + 1);
  const stagesWithData = allStageIds.filter((stageId) => getStageData(batch, stageId, measurementsByStage, stageTimers).length > 0);

  return (
    <>
      {editOpen && (
        <EditBatchModal batch={batch} open={editOpen} onClose={() => setEditOpen(false)} />
      )}
    <Card className="mb-4 print:break-inside-avoid">
      <CardHeader 
        className="cursor-pointer hover-elevate print:cursor-default" 
        onClick={() => setExpanded(!expanded)}
        data-testid={`card-batch-report-${batch.id}`}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center print:bg-gray-100">
              <FileText className="w-6 h-6 text-primary print:text-gray-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">
                  Lote {formatBatchCode(batch.startedAt)}
                </CardTitle>
                {wasEdited && (
                  <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/50 print:hidden" data-testid={`badge-edited-${batch.id}`}>
                    Editado
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {(batch as any).recipeName || getCheeseTypeName(batch.recipeId)} - {batch.milkVolumeL}L - Concluído em {batch.completedAt ? new Date(batch.completedAt).toLocaleDateString("pt-BR") : "N/A"}
                {batch.chamber2EntryDate && ` | Entrada Câmara 2: ${parseDateOnly(batch.chamber2EntryDate)}`}
                {batch.maturationEndDate && ` | Fim Maturação: ${parseDateOnly(batch.maturationEndDate)}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 print:hidden" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              title="Editar dados"
              onClick={() => setEditOpen(true)}
              data-testid={`button-edit-batch-${batch.id}`}
            >
              <Pencil className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setExpanded(!expanded)} data-testid={`button-expand-${batch.id}`}>
              {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      
      {(expanded || printRef) && (
        <CardContent data-testid={`content-batch-report-${batch.id}`}>
          {stagesWithData.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              Nenhuma medição registrada para este lote.
            </p>
          ) : (
            <div className="space-y-3">
              {stagesWithData.map((stageId) => {
                const stageRows = getStageData(batch, stageId, measurementsByStage, stageTimers);

                return (
                  <div key={stageId} className="border-l-2 border-primary/50 pl-4 print:border-gray-400">
                    <h4 className="font-semibold text-sm mb-1">
                      {stageId}. {STAGE_NAMES[stageId] || `Etapa ${stageId}`}
                    </h4>
                    <div className="flex flex-col gap-1">
                      {stageRows.map((row, idx) => (
                        <div 
                          key={idx} 
                          className="flex justify-between items-center bg-secondary/30 rounded-md px-3 py-1.5 text-sm print:bg-gray-100"
                        >
                          <span className="text-muted-foreground print:text-gray-600">{row.label}</span>
                          <span className="font-medium">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}
    </Card>
    </>
  );
}

// ─── KPI utilities ───────────────────────────────────────────────────────────

type MonthKpi = {
  key: string;
  label: string;
  batches: number;
  pecas: number;
  leite: number;
};

function computeKpiByMonth(batches: ProductionBatch[]): MonthKpi[] {
  const monthMap = new Map<string, MonthKpi>();

  for (const batch of batches) {
    if (!batch.completedAt) continue;
    const d = new Date(batch.completedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

    if (!monthMap.has(key)) {
      monthMap.set(key, { key, label, batches: 0, pecas: 0, leite: 0 });
    }

    const entry = monthMap.get(key)!;
    entry.batches += 1;

    const measurements = (batch.measurements as Record<string, any>) || {};
    const piecesRaw = measurements.pieces_quantity;
    if (piecesRaw != null && !isNaN(Number(piecesRaw))) {
      entry.pecas += Number(piecesRaw);
    }

    if (batch.milkVolumeL) {
      entry.leite += Number(batch.milkVolumeL);
    }
  }

  return Array.from(monthMap.values()).sort((a, b) => b.key.localeCompare(a.key));
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  icon: React.ReactNode;
  currentValue: string;
  unit?: string;
  months: MonthKpi[];
  getValue: (m: MonthKpi) => number | string;
  formatValue?: (v: number) => string;
  testId: string;
}

function KpiCard({ title, icon, currentValue, unit, months, getValue, testId }: KpiCardProps) {
  const [expanded, setExpanded] = useState(false);
  const priorMonths = months.slice(1);

  return (
    <Card
      className="cursor-pointer select-none hover-elevate transition-all"
      onClick={() => priorMonths.length > 0 && setExpanded((v) => !v)}
      data-testid={`card-kpi-${testId}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium uppercase tracking-wider">
            {icon}
            {title}
          </div>
          {priorMonths.length > 0 && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {expanded ? "Menos" : "Histórico"}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-1">
          <span className="text-4xl font-bold tracking-tight text-foreground" data-testid={`value-kpi-${testId}`}>
            {currentValue}
          </span>
          {unit && <span className="text-muted-foreground text-base ml-1">{unit}</span>}
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {months[0]?.label ?? "mês corrente"}
        </p>

        {expanded && priorMonths.length > 0 && (
          <div
            className="border-t border-border pt-3 mt-2 space-y-1"
            onClick={(e) => e.stopPropagation()}
          >
            {priorMonths.map((m) => (
              <div
                key={m.key}
                className="flex justify-between items-center text-sm px-2 py-1 rounded bg-secondary/30"
                data-testid={`row-kpi-${testId}-${m.key}`}
              >
                <span className="text-muted-foreground">{m.label.charAt(0).toUpperCase() + m.label.slice(1)}</span>
                <span className="font-medium">
                  {getValue(m)}
                  {unit ? ` ${unit}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── KPI Dashboard ───────────────────────────────────────────────────────────

function KpiDashboard({ batches }: { batches: ProductionBatch[] }) {
  const months = computeKpiByMonth(batches);
  const curKey = currentMonthKey();
  const curMonthIdx = months.findIndex((m) => m.key === curKey);

  const sortedMonths =
    curMonthIdx === -1
      ? [{ key: curKey, label: new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" }), batches: 0, pecas: 0, leite: 0 }, ...months]
      : [months[curMonthIdx], ...months.filter((_, i) => i !== curMonthIdx)];

  const cur = sortedMonths[0];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="section-kpi-dashboard">
        <KpiCard
          title="Lotes"
          icon={<Layers className="w-4 h-4" />}
          currentValue={String(cur.batches)}
          months={sortedMonths}
          getValue={(m) => m.batches}
          testId="lotes"
        />
        <KpiCard
          title="Peças"
          icon={<Package className="w-4 h-4" />}
          currentValue={String(cur.pecas)}
          months={sortedMonths}
          getValue={(m) => m.pecas}
          testId="pecas"
        />
        <KpiCard
          title="Leite"
          icon={<Milk className="w-4 h-4" />}
          currentValue={cur.leite % 1 === 0 ? String(cur.leite) : cur.leite.toFixed(1)}
          unit="L"
          months={sortedMonths}
          getValue={(m) => (m.leite % 1 === 0 ? m.leite : Number(m.leite.toFixed(1)))}
          testId="leite"
        />
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function PrintableReport({ batches, stageTimers = {} }: { batches: ProductionBatch[]; stageTimers?: Record<number, number> }) {
  return (
    <div className="p-8">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold">Matuh Queijaria</h1>
        <h2 className="text-xl">Relatório de Lotes Concluídos</h2>
        <p className="text-sm text-gray-600">Gerado em: {new Date().toLocaleString("pt-BR")}</p>
      </div>
      
      {batches.map((batch) => {
        const measurements = batch.measurements as Record<string, any> || {};
        const history: MeasurementHistoryItem[] = (measurements._history || []).filter((item: any) => item.key !== 'rollback' && item.key !== 'loop_exit_reason');
        
        const measurementsByStage = history.reduce((acc, item) => {
          if (!acc[item.stageId]) acc[item.stageId] = [];
          acc[item.stageId].push(item);
          return acc;
        }, {} as Record<number, MeasurementHistoryItem[]>);

        const allStageIds = Array.from({ length: 19 }, (_, i) => i + 1);
        
        return (
          <div key={batch.id} className="mb-8 break-inside-avoid">
            <div className="border-b-2 border-black pb-2 mb-4">
              <h3 className="text-lg font-bold">Lote {formatBatchCode(batch.startedAt)}</h3>
              <p className="text-sm">
                {(batch as any).recipeName || getCheeseTypeName(batch.recipeId)} - {batch.milkVolumeL}L - 
                Concluído em {batch.completedAt ? new Date(batch.completedAt).toLocaleDateString("pt-BR") : "N/A"}
              </p>
            </div>
            
            {allStageIds.map((stageId) => {
              const stageRows = getStageData(batch, stageId, measurementsByStage, stageTimers);
              if (stageRows.length === 0) return null;
              
              return (
                <div key={stageId} className="mb-3 pl-4 border-l-2 border-gray-400">
                  <h4 className="font-semibold text-sm mb-1">
                    {stageId}. {STAGE_NAMES[stageId] || `Etapa ${stageId}`}
                  </h4>
                  <div className="flex flex-col gap-1">
                    {stageRows.map((row, idx) => (
                      <div key={idx} className="flex justify-between text-sm bg-gray-100 px-2 py-1 rounded">
                        <span>{row.label}</span>
                        <span className="font-medium">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export default function Reports() {
  const { data: completedBatches, isLoading } = useCompletedBatches();
  const printRef = useRef<HTMLDivElement>(null);

  const { data: recipeData } = useQuery<{ stages: Array<{ stageId: number; timer?: { durationMin?: number } }> }>({
    queryKey: ['/api/recipe'],
  });

  const stageTimers: Record<number, number> = {};
  if (recipeData?.stages) {
    for (const stage of recipeData.stages) {
      if (stage.timer?.durationMin !== undefined) {
        stageTimers[stage.stageId] = stage.timer.durationMin;
      }
    }
  }

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;
    
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Relatório de Lotes - Matuh Queijaria</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
            .text-center { text-align: center; }
            .mb-8 { margin-bottom: 2rem; }
            .mb-4 { margin-bottom: 1rem; }
            .pb-2 { padding-bottom: 0.5rem; }
            .pl-4 { padding-left: 1rem; }
            .px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
            .py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
            .text-2xl { font-size: 1.5rem; }
            .text-xl { font-size: 1.25rem; }
            .text-lg { font-size: 1.125rem; }
            .text-sm { font-size: 0.875rem; }
            .font-bold { font-weight: bold; }
            .font-semibold { font-weight: 600; }
            .font-medium { font-weight: 500; }
            .text-gray-600 { color: #4b5563; }
            .bg-gray-100 { background-color: #f3f4f6; }
            .border-b-2 { border-bottom: 2px solid black; }
            .border-l-2 { border-left: 2px solid #9ca3af; }
            .rounded { border-radius: 0.25rem; }
            .flex { display: flex; }
            .flex-col { flex-direction: column; }
            .justify-between { justify-content: space-between; }
            .gap-1 { gap: 0.25rem; }
            .break-inside-avoid { break-inside: avoid; }
            @media print {
              .break-inside-avoid { break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleExportPDF = () => handlePrint();

  const handleExportExcel = () => {
    if (completedBatches && completedBatches.length > 0) {
      exportToExcel(completedBatches, stageTimers);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back-home">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <h1 className="text-3xl md:text-4xl font-display font-bold">
              <span className="text-primary text-glow">Relatórios</span>
            </h1>
          </div>
          <p className="text-muted-foreground">Acompanhe a produção mensal e os lotes concluídos.</p>
        </header>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-xl bg-secondary/30 animate-pulse" />
            ))}
          </div>
        ) : !completedBatches || completedBatches.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="w-16 h-16 bg-secondary/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Nenhum Lote Concluído</h3>
              <p className="text-muted-foreground">
                Quando um lote for concluído, ele aparecerá aqui com todas as medições registradas.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="kpi" data-testid="tabs-reports">
            <TabsList className="mb-6" data-testid="tabslist-reports">
              <TabsTrigger value="kpi" data-testid="tab-kpi">KPIs</TabsTrigger>
              <TabsTrigger value="lotes" data-testid="tab-lotes">Lotes</TabsTrigger>
            </TabsList>

            <TabsContent value="kpi">
              <KpiDashboard batches={completedBatches} />
            </TabsContent>

            <TabsContent value="lotes">
              <div className="flex flex-wrap gap-2 mb-6">
                <Button variant="outline" onClick={handlePrint} data-testid="button-print">
                  <Printer className="w-4 h-4 mr-2" />
                  Imprimir
                </Button>
                <Button variant="outline" onClick={handleExportPDF} data-testid="button-export-pdf">
                  <FileDown className="w-4 h-4 mr-2" />
                  Salvar PDF
                </Button>
                <Button variant="outline" onClick={handleExportExcel} data-testid="button-export-excel">
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Exportar Excel
                </Button>
              </div>
              <div>
                {completedBatches.map((batch) => (
                  <BatchReport key={batch.id} batch={batch} stageTimers={stageTimers} />
                ))}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </main>
      
      <div className="hidden">
        <div ref={printRef}>
          {completedBatches && completedBatches.length > 0 && (
            <PrintableReport batches={completedBatches} stageTimers={stageTimers} />
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
