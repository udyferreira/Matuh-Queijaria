import { Link } from "wouter";
import { FileText, ArrowLeft, ChevronDown, ChevronUp, Printer, FileDown, FileSpreadsheet, Pencil, Layers, Milk, Package, FlaskConical, X, Calendar } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery } from "@tanstack/react-query";
import { useCompletedBatches } from "@/hooks/use-batches";
import { getCheeseTypeName, formatBatchCode, ProductionBatch } from "@shared/schema";
import { parseDateOnly } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import { zipSync, strToU8 } from "fflate";
import { EditBatchModal } from "@/components/EditBatchModal";

const STAGE_NAMES_NETE: Record<number, string> = {
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

const STAGE_NAMES_NINA: Record<number, string> = {
  1: "Separar o leite e medir parâmetros iniciais",
  2: "Calcular fermentos, coalho e volumes derivados",
  3: "Retirar 10% do leite e aquecer no tanque pequeno",
  4: "Aquecer o leite no tanque de queijo até 32 graus",
  5: "Desnatar tanque pequeno e juntar ao tanque de queijo",
  6: "Lavar o tanque pequeno",
  7: "Adicionar fermentos DX e HT",
  8: "Adicionar coalho e colocar a Lira",
  9: "Aquecer água a 60 graus no tanque pequeno",
  10: "Anotar horário da floculação",
  11: "Anotar horário do ponto de corte da massa",
  12: "Cortar a massa com a Lira",
  13: "Mexer a massa por 5 minutos",
  14: "Retirar 20% do soro",
  15: "Aquecer massa com água quente até 38 graus",
  16: "Retirar todo o soro do tanque",
  17: "Cortar a massa e colocar nas formas",
  18: "Medir pH inicial e registrar quantidade de peças",
  19: "Colocar na prensa e registrar horário",
  20: "Virar queijos e medir pH",
  21: "Entrada na salmoura",
  22: "Secagem em prateleira",
  23: "Transferir para Câmara 2 de maturação",
};

function getStageNames(recipeId: string | undefined): Record<number, string> {
  return recipeId === "QUEIJO_NINA" ? STAGE_NAMES_NINA : STAGE_NAMES_NETE;
}

function getTotalStages(recipeId: string | undefined): number {
  return recipeId === "QUEIJO_NINA" ? 23 : 19;
}

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
  
  batches.forEach((batch) => {
    const recipeId = (batch as any).recipeId;
    const stageNames = getStageNames(recipeId);
    const allStageIds = Array.from({ length: getTotalStages(recipeId) }, (_, i) => i + 1);
    const measurements = batch.measurements as Record<string, any> || {};
    const history: MeasurementHistoryItem[] = (measurements._history || []).filter((item: any) => item.key !== 'rollback' && item.key !== 'loop_exit_reason');
    
    const measurementsByStage = history.reduce((acc, item) => {
      if (!acc[item.stageId]) acc[item.stageId] = [];
      acc[item.stageId].push(item);
      return acc;
    }, {} as Record<number, MeasurementHistoryItem[]>);
    
    allStageIds.forEach((stageId) => {
      const stageRows = getStageData(batch, stageId, measurementsByStage, stageTimers, recipeId);
      stageRows.forEach((row) => {
        data.push({
          "Lote": formatBatchCode(batch.startedAt),
          "Tipo": (batch as any).recipeName || getCheeseTypeName(batch.recipeId),
          "Volume (L)": batch.milkVolumeL,
          "Data Conclusão": batch.completedAt ? new Date(batch.completedAt).toLocaleDateString("pt-BR") : "N/A",
          "Etapa": `${stageId} - ${stageNames[stageId] || `Etapa ${stageId}`}`,
          "Campo": row.label,
          "Valor": row.value,
        });
      });
    });
  });

  downloadXlsx(data, `relatorio_lotes_${new Date().toISOString().split("T")[0]}.xlsx`);
}

function formatTimeIso(isoVal: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(isoVal));
  } catch { return isoVal; }
}

function formatDateTimeIso(isoVal: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(isoVal));
  } catch { return isoVal; }
}

function batchMonthInfo(batchCode: string): { key: string; label: string } | null {
  const match = batchCode.replace(/\D/g, "");
  if (match.length < 6) return null;
  const mm = match.slice(2, 4);
  const aa = match.slice(4, 6);
  const year = 2000 + parseInt(aa, 10);
  const month = parseInt(mm, 10);
  if (month < 1 || month > 12) return null;
  const key = `${mm}/${year}`;
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1)
  );
  return { key, label: label.charAt(0).toUpperCase() + label.slice(1) };
}

function getStageData(batch: ProductionBatch, stageId: number, measurementsByStage: Record<number, MeasurementHistoryItem[]>, stageTimers: Record<number, number> = {}, recipeId?: string) {
  const isNina = (recipeId ?? (batch as any).recipeId) === "QUEIJO_NINA";
  const measurements = batch.measurements as Record<string, any> || {};
  const calculatedInputs = batch.calculatedInputs as Record<string, number> || {};
  const stageHistory = measurementsByStage[stageId] || [];
  const rows: Array<{ label: string; value: string }> = [];

  function fromMeasurementsOrHistory(key: string): any {
    if (measurements[key] != null) return measurements[key];
    return stageHistory.find(i => i.key === key)?.value;
  }

  // ── Etapa 1: parâmetros iniciais do leite (ambas as receitas) ─────────────
  if (stageId === 1) {
    if (batch.milkVolumeL) rows.push({ label: "Volume de Leite", value: `${batch.milkVolumeL} L` });
    const temp = measurements.milk_temperature_c ?? stageHistory.find(h => h.key === 'milk_temperature_c')?.value;
    if (temp != null) rows.push({ label: "Temperatura do Leite", value: `${temp} °C` });
    const ph = measurements.milk_ph ?? stageHistory.find(h => h.key === 'milk_ph')?.value;
    if (ph != null) rows.push({ label: "pH do Leite", value: String(ph) });
  }

  // ── Etapa 2: fermentos calculados (receitas têm fermentos diferentes) ──────
  if (stageId === 2 && Object.keys(calculatedInputs).length > 0) {
    if (isNina) {
      const ninaLabels: Record<string, string> = {
        FERMENT_DX: "Fermento DX (mL)",
        FERMENT_HT: "Fermento HT (mL)",
        RENNET: "Coalho (mL)",
      };
      ['FERMENT_DX', 'FERMENT_HT', 'RENNET'].forEach((k) => {
        if (k in calculatedInputs) rows.push({ label: ninaLabels[k], value: String(calculatedInputs[k]) });
      });
    } else {
      const neteLabels: Record<string, string> = {
        FERMENT_LR: "Fermento LR (mL)",
        FERMENT_DX: "Fermento DX (mL)",
        FERMENT_KL: "Fermento KL (mL)",
        RENNET: "Coalho (mL)",
      };
      ['FERMENT_LR', 'FERMENT_DX', 'FERMENT_KL', 'RENNET'].forEach((k) => {
        if (k in calculatedInputs) rows.push({ label: neteLabels[k] || k, value: String(calculatedInputs[k]) });
      });
    }
  }

  // ── Nete: etapa 4 → horário adição fermentos LR/DX ──────────────────────
  if (!isNina && stageId === 4) {
    const isoVal = measurements.ferment_lr_dx_add_time_iso || stageHistory.find(i => i.key === 'ferment_lr_dx_add_time_iso')?.value;
    if (isoVal) rows.push({ label: "Horário de Adição (Fermentos LR/DX)", value: formatTimeIso(String(isoVal)) });
  }

  // ── Nete: etapa 5 → horário adição KL + coalho ───────────────────────────
  if (!isNina && stageId === 5) {
    const isoVal = measurements.ferment_kl_coalho_add_time_iso || stageHistory.find(i => i.key === 'ferment_kl_coalho_add_time_iso')?.value;
    if (isoVal) rows.push({ label: "Horário de Adição (Fermento KL + Coalho)", value: formatTimeIso(String(isoVal)) });
  }

  // ── Nina: etapa 7 → horário adição fermentos DX + HT ────────────────────
  if (isNina && stageId === 7) {
    const isoVal = measurements.ferment_add_time || stageHistory.find(i => i.key === 'ferment_add_time')?.value;
    if (isoVal) rows.push({ label: "Horário de Adição (Fermentos DX + HT)", value: formatTimeIso(String(isoVal)) });
  }

  // ── Nina: etapa 8 → horário adição coalho ────────────────────────────────
  if (isNina && stageId === 8) {
    const isoVal = measurements.rennet_add_time || stageHistory.find(i => i.key === 'rennet_add_time')?.value;
    if (isoVal) rows.push({ label: "Horário de Adição do Coalho", value: formatTimeIso(String(isoVal)) });
  }

  // ── Floculação: Nete etapa 6, Nina etapa 10 ──────────────────────────────
  if ((!isNina && stageId === 6) || (isNina && stageId === 10)) {
    const val = fromMeasurementsOrHistory('flocculation_time');
    if (val != null) rows.push({ label: "Horário de Floculação", value: String(val) });
  }

  // ── Ponto de corte: Nete etapa 7, Nina etapa 11 ──────────────────────────
  if ((!isNina && stageId === 7) || (isNina && stageId === 11)) {
    const val = fromMeasurementsOrHistory('cut_point_time');
    if (val != null) rows.push({ label: "Horário do Ponto de Corte", value: String(val) });
  }

  // ── Timer de mexedura: Nete etapa 10, Nina etapa 13 ──────────────────────
  if ((!isNina && stageId === 10) || (isNina && stageId === 13)) {
    const timerKey = isNina ? 13 : 10;
    const durationMin = stageTimers[timerKey];
    if (durationMin !== undefined) rows.push({ label: "Tempo de Mexedura da Massa", value: `${durationMin} minutos` });
  }

  // ── pH inicial + peças: Nete etapa 13, Nina etapa 18 ─────────────────────
  if ((!isNina && stageId === 13) || (isNina && stageId === 18)) {
    const phVal = measurements.initial_ph ?? stageHistory.find(i => i.key === 'ph_value' || i.key === 'initial_ph')?.value;
    if (phVal != null) rows.push({ label: "pH Inicial", value: String(phVal) });
    const piecesVal = measurements.pieces_quantity ?? stageHistory.find(i => i.key === 'pieces_quantity')?.value;
    if (piecesVal != null) rows.push({ label: "Quantidade de Peças", value: String(piecesVal) });
  }

  // ── Prensa: Nete etapa 14, Nina etapa 19 ─────────────────────────────────
  if ((!isNina && stageId === 14) || (isNina && stageId === 19)) {
    const val = fromMeasurementsOrHistory('press_start_time');
    if (val != null) rows.push({ label: "Início da Prensagem", value: String(val) });
  }

  // ── Loop pH/viradas: Nete etapa 15, Nina etapa 20 ────────────────────────
  if ((!isNina && stageId === 15) || (isNina && stageId === 20)) {
    const loopStageId = isNina ? 20 : 15;
    const phArr: any[] = measurements.ph_measurements || [];
    const loopPhArr = phArr.filter((p: any) => p.stageId === loopStageId || p.stageId == null);
    if (loopPhArr.length > 0) {
      loopPhArr.forEach((item: any, idx: number) => {
        rows.push({ label: `${idx + 1}ª Medição de pH`, value: String(item.value) });
      });
    } else {
      const phItems = stageHistory.filter(i => i.key === 'ph_value' || i.key === 'ph_measurement');
      phItems.forEach((item, idx) => {
        rows.push({ label: `${idx + 1}ª Medição de pH`, value: String(item.value) });
      });
    }
    const turningCount = (batch as any).turningCyclesCount ?? measurements.turning_cycles_count
      ?? stageHistory.find(i => i.key === 'turning_cycles_count')?.value;
    if (turningCount != null) rows.push({ label: "Viradas Realizadas", value: String(turningCount) });
  }

  // ── Salga: Nete etapa 17, Nina etapa 21 ──────────────────────────────────
  if ((!isNina && stageId === 17) || (isNina && stageId === 21)) {
    const isoVal = measurements.brine_entry_time_iso || stageHistory.find(i => i.key === 'brine_entry_time_iso')?.value;
    if (isoVal) rows.push({ label: "Entrada na Salga", value: formatDateTimeIso(String(isoVal)) });
  }

  // ── Secagem prateleiras: Nete etapa 18, Nina etapa 22 ────────────────────
  if ((!isNina && stageId === 18) || (isNina && stageId === 22)) {
    const isoVal = measurements.shelf_start_time_iso || stageHistory.find(i => i.key === 'shelf_start_time_iso')?.value;
    if (isoVal) rows.push({ label: "Início da Secagem em Prateleiras", value: formatDateTimeIso(String(isoVal)) });
  }

  // ── Câmara 2: Nete etapa 19, Nina etapa 23 ───────────────────────────────
  if ((!isNina && stageId === 19) || (isNina && stageId === 23)) {
    if (batch.chamber2EntryDate) {
      rows.push({ label: "Data de Entrada na Câmara 2", value: parseDateOnly(batch.chamber2EntryDate) });
    }
    if (batch.maturationEndDate) {
      const maturacaoLabel = isNina ? "Fim da Maturação (180 dias)" : "Fim da Maturação (90 dias)";
      rows.push({ label: maturacaoLabel, value: parseDateOnly(batch.maturationEndDate) });
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

  const batchRecipeId = (batch as any).recipeId;
  const stageNames = getStageNames(batchRecipeId);
  const allStageIds = Array.from({ length: getTotalStages(batchRecipeId) }, (_, i) => i + 1);
  const stagesWithData = allStageIds.filter((stageId) => getStageData(batch, stageId, measurementsByStage, stageTimers, batchRecipeId).length > 0);

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
                const stageRows = getStageData(batch, stageId, measurementsByStage, stageTimers, batchRecipeId);

                return (
                  <div key={stageId} className="border-l-2 border-primary/50 pl-4 print:border-gray-400">
                    <h4 className="font-semibold text-sm mb-1">
                      {stageId}. {stageNames[stageId] || `Etapa ${stageId}`}
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

type RecipeKpi = { batches: number; pecas: number; leite: number };

type MonthKpi = {
  key: string;
  label: string;
  nete: RecipeKpi;
  nina: RecipeKpi;
};

function emptyRecipeKpi(): RecipeKpi {
  return { batches: 0, pecas: 0, leite: 0 };
}

function computeKpiByMonth(batches: ProductionBatch[]): MonthKpi[] {
  const monthMap = new Map<string, MonthKpi>();

  for (const batch of batches) {
    if (!batch.completedAt) continue;
    const d = new Date(batch.completedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

    if (!monthMap.has(key)) {
      monthMap.set(key, { key, label, nete: emptyRecipeKpi(), nina: emptyRecipeKpi() });
    }

    const entry = monthMap.get(key)!;
    const target = (batch as any).recipeId === "QUEIJO_NINA" ? entry.nina : entry.nete;

    target.batches += 1;
    const measurements = (batch.measurements as Record<string, any>) || {};
    const piecesRaw = measurements.pieces_quantity;
    if (piecesRaw != null && !isNaN(Number(piecesRaw))) {
      target.pecas += Number(piecesRaw);
    }
    if (batch.milkVolumeL) {
      target.leite += Number(batch.milkVolumeL);
    }
  }

  return Array.from(monthMap.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Fermentos 2026 ───────────────────────────────────────────────────────────

interface NeteFermentos { lr: number; dx: number; kl: number; rennet: number }
interface NinaFermentos { dx: number; ht: number; rennet: number }

interface MonthFermentos {
  key: string;
  label: string;
  nete: NeteFermentos;
  nina: NinaFermentos;
}

function computeFermentosByMonth(batches: ProductionBatch[]): MonthFermentos[] {
  const monthMap = new Map<string, MonthFermentos>();

  for (const batch of batches) {
    if (!batch.completedAt) continue;
    const d = new Date(batch.completedAt);
    if (d.getFullYear() !== 2026) continue;

    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

    if (!monthMap.has(key)) {
      monthMap.set(key, {
        key, label,
        nete: { lr: 0, dx: 0, kl: 0, rennet: 0 },
        nina: { dx: 0, ht: 0, rennet: 0 },
      });
    }

    const entry = monthMap.get(key)!;
    const ci = (batch.calculatedInputs as Record<string, any>) || {};
    const isNina = (batch as any).recipeId === "QUEIJO_NINA";

    if (isNina) {
      entry.nina.dx     += Number(ci["FERMENT_DX"] ?? 0);
      entry.nina.ht     += Number(ci["FERMENT_HT"] ?? 0);
      entry.nina.rennet += Number(ci["RENNET"]      ?? 0);
    } else {
      entry.nete.lr     += Number(ci["FERMENT_LR"] ?? 0);
      entry.nete.dx     += Number(ci["FERMENT_DX"] ?? 0);
      entry.nete.kl     += Number(ci["FERMENT_KL"] ?? 0);
      entry.nete.rennet += Number(ci["RENNET"]      ?? 0);
    }
  }

  return Array.from(monthMap.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function fmtMl(v: number): string {
  return v % 1 === 0 ? String(v) : v.toFixed(1);
}

// ─── Fermentos Card ───────────────────────────────────────────────────────────

function FermentosCard({ batches, forceExpanded }: { batches: ProductionBatch[]; forceExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const months = computeFermentosByMonth(batches);

  useEffect(() => {
    if (forceExpanded !== undefined) setExpanded(forceExpanded);
  }, [forceExpanded]);

  const totNete = months.reduce(
    (acc, m) => ({ lr: acc.lr + m.nete.lr, dx: acc.dx + m.nete.dx, kl: acc.kl + m.nete.kl, rennet: acc.rennet + m.nete.rennet }),
    { lr: 0, dx: 0, kl: 0, rennet: 0 }
  );
  const totNina = months.reduce(
    (acc, m) => ({ dx: acc.dx + m.nina.dx, ht: acc.ht + m.nina.ht, rennet: acc.rennet + m.nina.rennet }),
    { dx: 0, ht: 0, rennet: 0 }
  );

  return (
    <Card
      className="cursor-pointer select-none hover-elevate transition-all"
      onClick={() => !forceExpanded && months.length > 0 && setExpanded((v) => !v)}
      data-testid="card-kpi-fermentos"
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium uppercase tracking-wider">
            <FlaskConical className="w-4 h-4" />
            Fermentos 2026
          </div>
          {months.length > 0 && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {expanded ? "Menos" : "Histórico"}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4" data-testid="fermentos-totais">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Nete</p>
            <div className="grid grid-cols-4 gap-1">
              {([ 
                { label: "LR",     value: totNete.lr,     id: "nete-lr" },
                { label: "DX",     value: totNete.dx,     id: "nete-dx" },
                { label: "KL",     value: totNete.kl,     id: "nete-kl" },
                { label: "Coalho", value: totNete.rennet, id: "nete-coalho" },
              ] as const).map((f) => (
                <div key={f.id} className="text-center" data-testid={`value-kpi-fermentos-${f.id}`}>
                  <p className="text-xs font-bold text-muted-foreground">{f.label}</p>
                  <p className="text-base font-bold tracking-tight text-foreground">{fmtMl(f.value)}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Nina</p>
            <div className="grid grid-cols-3 gap-1">
              {([
                { label: "DX",     value: totNina.dx,     id: "nina-dx" },
                { label: "HT",     value: totNina.ht,     id: "nina-ht" },
                { label: "Coalho", value: totNina.rennet, id: "nina-coalho" },
              ] as const).map((f) => (
                <div key={f.id} className="text-center" data-testid={`value-kpi-fermentos-${f.id}`}>
                  <p className="text-xs font-bold text-muted-foreground">{f.label}</p>
                  <p className="text-base font-bold tracking-tight text-foreground">{fmtMl(f.value)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">mL — acumulado anual</p>

        {expanded && months.length > 0 && (
          <div
            className="border-t border-border pt-3 mt-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Nete</p>
            <div className="grid grid-cols-5 text-xs text-muted-foreground font-medium px-2 pb-1">
              <span>Mês</span>
              <span className="text-right">LR</span>
              <span className="text-right">DX</span>
              <span className="text-right">KL</span>
              <span className="text-right">Coalho</span>
            </div>
            <div className="space-y-1 mb-3">
              {months.map((m) => (
                <div
                  key={m.key}
                  className="grid grid-cols-5 text-sm px-2 py-1 rounded bg-secondary/30"
                  data-testid={`row-kpi-fermentos-nete-${m.key}`}
                >
                  <span className="text-muted-foreground">{m.label.charAt(0).toUpperCase() + m.label.slice(1)}</span>
                  <span className="text-right font-medium">{fmtMl(m.nete.lr)}</span>
                  <span className="text-right font-medium">{fmtMl(m.nete.dx)}</span>
                  <span className="text-right font-medium">{fmtMl(m.nete.kl)}</span>
                  <span className="text-right font-medium">{fmtMl(m.nete.rennet)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Nina</p>
            <div className="grid grid-cols-4 text-xs text-muted-foreground font-medium px-2 pb-1">
              <span>Mês</span>
              <span className="text-right">DX</span>
              <span className="text-right">HT</span>
              <span className="text-right">Coalho</span>
            </div>
            <div className="space-y-1">
              {months.map((m) => (
                <div
                  key={m.key}
                  className="grid grid-cols-4 text-sm px-2 py-1 rounded bg-secondary/30"
                  data-testid={`row-kpi-fermentos-nina-${m.key}`}
                >
                  <span className="text-muted-foreground">{m.label.charAt(0).toUpperCase() + m.label.slice(1)}</span>
                  <span className="text-right font-medium">{fmtMl(m.nina.dx)}</span>
                  <span className="text-right font-medium">{fmtMl(m.nina.ht)}</span>
                  <span className="text-right font-medium">{fmtMl(m.nina.rennet)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  icon: React.ReactNode;
  curNete: string;
  curNina: string;
  unit?: string;
  curLabel: string;
  months: MonthKpi[];
  getNete: (m: MonthKpi) => number;
  getNina: (m: MonthKpi) => number;
  fmt?: (v: number) => string;
  testId: string;
  forceExpanded?: boolean;
}

function KpiCard({ title, icon, curNete, curNina, unit, curLabel, months, getNete, getNina, fmt, testId, forceExpanded }: KpiCardProps) {
  const [expanded, setExpanded] = useState(false);
  const priorMonths = months.slice(1);

  useEffect(() => {
    if (forceExpanded !== undefined) setExpanded(forceExpanded);
  }, [forceExpanded]);

  const fmtVal = (v: number) => fmt ? fmt(v) : String(v);
  const unitStr = unit ? ` ${unit}` : "";

  return (
    <Card
      className="cursor-pointer select-none hover-elevate transition-all"
      onClick={() => !forceExpanded && priorMonths.length > 0 && setExpanded((v) => !v)}
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
        <div className="grid grid-cols-2 gap-2 mb-1">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Nete</p>
            <div>
              <span className="text-3xl font-bold tracking-tight text-foreground" data-testid={`value-kpi-${testId}-nete`}>
                {curNete}
              </span>
              {unit && <span className="text-muted-foreground text-sm ml-1">{unit}</span>}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Nina</p>
            <div>
              <span className="text-3xl font-bold tracking-tight text-foreground" data-testid={`value-kpi-${testId}-nina`}>
                {curNina}
              </span>
              {unit && <span className="text-muted-foreground text-sm ml-1">{unit}</span>}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {curLabel}
        </p>

        {expanded && priorMonths.length > 0 && (
          <div
            className="border-t border-border pt-3 mt-2 space-y-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-3 text-xs text-muted-foreground font-medium px-2 pb-1">
              <span>Mês</span>
              <span className="text-right">Nete</span>
              <span className="text-right">Nina</span>
            </div>
            {priorMonths.map((m) => (
              <div
                key={m.key}
                className="grid grid-cols-3 text-sm px-2 py-1 rounded bg-secondary/30"
                data-testid={`row-kpi-${testId}-${m.key}`}
              >
                <span className="text-muted-foreground">{m.label.charAt(0).toUpperCase() + m.label.slice(1)}</span>
                <span className="text-right font-medium">{fmtVal(getNete(m))}{unitStr}</span>
                <span className="text-right font-medium">{fmtVal(getNina(m))}{unitStr}</span>
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
  const [expandAll, setExpandAll] = useState(false);
  const months = computeKpiByMonth(batches);
  const curKey = currentMonthKey();
  const curMonthIdx = months.findIndex((m) => m.key === curKey);

  const sortedMonths =
    curMonthIdx === -1
      ? [{ key: curKey, label: new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" }), nete: emptyRecipeKpi(), nina: emptyRecipeKpi() }, ...months]
      : [months[curMonthIdx], ...months.filter((_, i) => i !== curMonthIdx)];

  const cur = sortedMonths[0];
  const fmtL = (v: number) => (v % 1 === 0 ? String(v) : v.toFixed(1));

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          onClick={() => setExpandAll((v) => !v)}
          data-testid="button-expand-all"
        >
          {expandAll ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expandAll ? "Recolher tudo" : "Expandir tudo"}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="section-kpi-dashboard">
        <KpiCard
          title="Lotes"
          icon={<Layers className="w-4 h-4" />}
          curNete={String(cur.nete.batches)}
          curNina={String(cur.nina.batches)}
          curLabel={cur.label}
          months={sortedMonths}
          getNete={(m) => m.nete.batches}
          getNina={(m) => m.nina.batches}
          testId="lotes"
          forceExpanded={expandAll}
        />
        <KpiCard
          title="Peças"
          icon={<Package className="w-4 h-4" />}
          curNete={String(cur.nete.pecas)}
          curNina={String(cur.nina.pecas)}
          curLabel={cur.label}
          months={sortedMonths}
          getNete={(m) => m.nete.pecas}
          getNina={(m) => m.nina.pecas}
          testId="pecas"
          forceExpanded={expandAll}
        />
        <KpiCard
          title="Leite"
          icon={<Milk className="w-4 h-4" />}
          curNete={fmtL(cur.nete.leite)}
          curNina={fmtL(cur.nina.leite)}
          unit="L"
          curLabel={cur.label}
          months={sortedMonths}
          getNete={(m) => m.nete.leite}
          getNina={(m) => m.nina.leite}
          fmt={fmtL}
          testId="leite"
          forceExpanded={expandAll}
        />
      </div>

      <FermentosCard batches={batches} forceExpanded={expandAll} />
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

        const printRecipeId = (batch as any).recipeId;
        const printStageNames = getStageNames(printRecipeId);
        const allStageIds = Array.from({ length: getTotalStages(printRecipeId) }, (_, i) => i + 1);
        
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
              const stageRows = getStageData(batch, stageId, measurementsByStage, stageTimers, printRecipeId);
              if (stageRows.length === 0) return null;
              
              return (
                <div key={stageId} className="mb-3 pl-4 border-l-2 border-gray-400">
                  <h4 className="font-semibold text-sm mb-1">
                    {stageId}. {printStageNames[stageId] || `Etapa ${stageId}`}
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

  const { data: recipeDataNete } = useQuery<{ stages: Array<{ stageId: number; timer?: { durationMin?: number } }> }>({
    queryKey: ['/api/recipe'],
  });

  const { data: recipeDataNina } = useQuery<{ stages: Array<{ stageId: number; timer?: { durationMin?: number } }> }>({
    queryKey: ['/api/recipe?recipeId=QUEIJO_NINA'],
  });

  const stageTimers: Record<number, number> = {};
  for (const recipeData of [recipeDataNete, recipeDataNina]) {
    if (recipeData?.stages) {
      for (const stage of recipeData.stages) {
        if (stage.timer?.durationMin !== undefined) {
          stageTimers[stage.stageId] = stage.timer.durationMin;
        }
      }
    }
  }

  const [selectedRecipe, setSelectedRecipe] = useState<"all" | "QUEIJO_NETE" | "QUEIJO_NINA">("all");
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  const availableMonths: Array<{ key: string; label: string }> = (() => {
    if (!completedBatches) return [];
    const seen = new Map<string, string>();
    for (const b of completedBatches) {
      const code = formatBatchCode(b.startedAt);
      const info = batchMonthInfo(code);
      if (info && !seen.has(info.key)) seen.set(info.key, info.label);
    }
    return Array.from(seen.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => {
        const [amm, ayy] = a.key.split("/").map(Number);
        const [bmm, byy] = b.key.split("/").map(Number);
        return byy !== ayy ? byy - ayy : bmm - amm;
      });
  })();

  const filteredBatches = (completedBatches ?? []).filter((b) => {
    if (selectedRecipe !== "all" && (b as any).recipeId !== selectedRecipe) return false;
    if (selectedMonths.size > 0) {
      const code = formatBatchCode(b.startedAt);
      const info = batchMonthInfo(code);
      if (!info || !selectedMonths.has(info.key)) return false;
    }
    return true;
  });

  function toggleMonth(key: string) {
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
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
    if (filteredBatches.length > 0) {
      exportToExcel(filteredBatches, stageTimers);
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
              {/* ── Filtros ─────────────────────────────────────────────── */}
              <div className="flex flex-wrap items-start gap-6 mb-6 p-4 rounded-xl bg-secondary/20 border border-border">
                {/* Filtro de receita */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Queijo
                  </p>
                  <div className="flex gap-1" data-testid="filter-recipe">
                    {(["all", "QUEIJO_NETE", "QUEIJO_NINA"] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setSelectedRecipe(r)}
                        data-testid={`filter-recipe-${r}`}
                        className={[
                          "px-3 py-1 rounded-md text-sm font-medium transition-colors",
                          selectedRecipe === r
                            ? "bg-primary text-primary-foreground"
                            : "bg-background border border-border text-muted-foreground hover:text-foreground",
                        ].join(" ")}
                      >
                        {r === "all" ? "Todos" : r === "QUEIJO_NETE" ? "Nete" : "Nina"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Filtro de mês — picklist */}
                {availableMonths.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Mês
                    </p>
                    <div className="flex flex-col gap-2">
                      <Popover open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
                        <PopoverTrigger asChild>
                          <button
                            data-testid="button-month-picker"
                            className="flex items-center gap-2 px-3 py-1 rounded-md text-sm font-medium border border-border bg-background text-muted-foreground hover:text-foreground transition-colors w-fit"
                          >
                            <Calendar className="w-3.5 h-3.5" />
                            {selectedMonths.size > 0
                              ? `Mês (${selectedMonths.size})`
                              : "Mês"}
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="p-2 w-52"
                          data-testid="popover-month-picker"
                        >
                          <div className="space-y-1 max-h-64 overflow-y-auto">
                            {availableMonths.map((m) => {
                              const checked = selectedMonths.has(m.key);
                              return (
                                <label
                                  key={m.key}
                                  className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-secondary/50 transition-colors"
                                  data-testid={`filter-month-${m.key}`}
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => toggleMonth(m.key)}
                                    id={`month-${m.key}`}
                                  />
                                  <span className="text-sm">{m.label}</span>
                                </label>
                              );
                            })}
                          </div>
                          {selectedMonths.size > 0 && (
                            <div className="border-t border-border mt-2 pt-2">
                              <button
                                className="text-xs text-muted-foreground hover:text-foreground w-full text-left px-2 transition-colors"
                                onClick={() => setSelectedMonths(new Set())}
                                data-testid="button-clear-months"
                              >
                                Limpar seleção
                              </button>
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>

                      {/* Chips dos meses selecionados */}
                      {selectedMonths.size > 0 && (
                        <div className="flex flex-wrap gap-1" data-testid="selected-month-chips">
                          {availableMonths
                            .filter((m) => selectedMonths.has(m.key))
                            .map((m) => (
                              <button
                                key={m.key}
                                onClick={() => toggleMonth(m.key)}
                                aria-label={`Remover ${m.label}`}
                                data-testid={`chip-month-${m.key}`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-xs font-medium hover:bg-primary/25 transition-colors"
                              >
                                {m.label}
                                <X className="w-3 h-3 shrink-0" />
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Barra de ações + contagem ───────────────────────────── */}
              <div className="flex flex-wrap items-center gap-2 mb-6">
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
                <span
                  className="ml-auto text-sm text-muted-foreground"
                  data-testid="text-batch-count"
                >
                  {filteredBatches.length === completedBatches.length
                    ? `${completedBatches.length} lote${completedBatches.length !== 1 ? "s" : ""}`
                    : `${filteredBatches.length} de ${completedBatches.length} lote${completedBatches.length !== 1 ? "s" : ""}`}
                </span>
              </div>

              {/* ── Lista de lotes ──────────────────────────────────────── */}
              {filteredBatches.length === 0 ? (
                <Card data-testid="card-empty-filter">
                  <CardContent className="py-10 text-center">
                    <p className="text-muted-foreground text-sm">
                      Nenhum lote encontrado com os filtros selecionados. Ajuste o queijo ou os meses.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div>
                  {filteredBatches.map((batch) => (
                    <BatchReport key={batch.id} batch={batch} stageTimers={stageTimers} />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </main>
      
      <div className="hidden">
        <div ref={printRef}>
          {filteredBatches.length > 0 && (
            <PrintableReport batches={filteredBatches} stageTimers={stageTimers} />
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
