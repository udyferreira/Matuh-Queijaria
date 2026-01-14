import { Link } from "wouter";
import { FileText, ArrowLeft, ChevronDown, ChevronUp, Printer, FileDown, FileSpreadsheet } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompletedBatches } from "@/hooks/use-batches";
import { getCheeseTypeName, formatBatchCode, ProductionBatch } from "@shared/schema";
import { useState, useRef } from "react";
import * as XLSX from "xlsx";

const STAGE_NAMES: Record<number, string> = {
  1: "Recepção do Leite",
  2: "Adição de Fermento",
  3: "Adição de Coalho",
  4: "Coagulação",
  5: "Corte da Coalhada",
  6: "Primeira Mexedura",
  7: "Repouso Inicial",
  8: "Segunda Mexedura",
  9: "Dessoragem Parcial",
  10: "Aquecimento",
  11: "Mexedura Final",
  12: "Dessoragem Final",
  13: "Enformagem",
  14: "Primeira Viragem",
  15: "Viragens Periódicas",
  16: "Salga",
  17: "Secagem",
  18: "Câmara 1",
  19: "Câmara 2",
  20: "Maturação"
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
  loop_exit_reason: "Motivo de Saída do Loop",
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

function exportToExcel(batches: ProductionBatch[]) {
  const data: any[] = [];
  
  batches.forEach((batch) => {
    const measurements = batch.measurements as Record<string, any> || {};
    const history: MeasurementHistoryItem[] = measurements._history || [];
    
    const measurementsByStage = history.reduce((acc, item) => {
      if (!acc[item.stageId]) {
        acc[item.stageId] = [];
      }
      acc[item.stageId].push(item);
      return acc;
    }, {} as Record<number, MeasurementHistoryItem[]>);
    
    const stageIds = Object.keys(measurementsByStage).map(Number).sort((a, b) => a - b);
    
    stageIds.forEach((stageId) => {
      const stageItems = measurementsByStage[stageId].sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      stageItems.forEach((item, idx) => {
        data.push({
          "Lote": formatBatchCode(batch.startedAt),
          "Tipo": getCheeseTypeName(batch.recipeId),
          "Volume (L)": batch.milkVolumeL,
          "Data Conclusão": batch.completedAt ? new Date(batch.completedAt).toLocaleDateString("pt-BR") : "N/A",
          "Etapa": `${stageId} - ${STAGE_NAMES[stageId] || `Etapa ${stageId}`}`,
          "Medição": stageId === 15 ? `Medição ${idx + 1}` : "-",
          "Campo": MEASUREMENT_LABELS[item.key] || item.key,
          "Valor": formatValue(item.key, item.value),
          "Data/Hora Registro": new Date(item.timestamp).toLocaleString("pt-BR")
        });
      });
    });
  });
  
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatório de Lotes");
  
  const colWidths = [
    { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 15 },
    { wch: 25 }, { wch: 12 }, { wch: 25 }, { wch: 15 }, { wch: 20 }
  ];
  ws["!cols"] = colWidths;
  
  XLSX.writeFile(wb, `relatorio_lotes_${new Date().toISOString().split("T")[0]}.xlsx`);
}

function BatchReport({ batch, printRef }: { batch: ProductionBatch; printRef?: React.RefObject<HTMLDivElement> }) {
  const [expanded, setExpanded] = useState(false);
  
  const measurements = batch.measurements as Record<string, any> || {};
  const history: MeasurementHistoryItem[] = measurements._history || [];
  
  const measurementsByStage = history.reduce((acc, item) => {
    if (!acc[item.stageId]) {
      acc[item.stageId] = [];
    }
    acc[item.stageId].push(item);
    return acc;
  }, {} as Record<number, MeasurementHistoryItem[]>);
  
  const stageIds = Object.keys(measurementsByStage).map(Number).sort((a, b) => a - b);

  return (
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
              <CardTitle className="text-lg">
                Lote {formatBatchCode(batch.startedAt)}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {getCheeseTypeName(batch.recipeId)} - {batch.milkVolumeL}L - Concluído em {batch.completedAt ? new Date(batch.completedAt).toLocaleDateString("pt-BR") : "N/A"}
                {batch.chamber2EntryDate && ` | Entrada Câmara 2: ${new Date(batch.chamber2EntryDate).toLocaleDateString("pt-BR")}`}
                {batch.maturationEndDate && ` | Fim Maturação: ${new Date(batch.maturationEndDate).toLocaleDateString("pt-BR")}`}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="print:hidden" data-testid={`button-expand-${batch.id}`}>
            {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </Button>
        </div>
      </CardHeader>
      
      {(expanded || printRef) && (
        <CardContent data-testid={`content-batch-report-${batch.id}`}>
          {stageIds.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              Nenhuma medição registrada para este lote.
            </p>
          ) : (
            <div className="space-y-4">
              {stageIds.map((stageId) => {
                const stageItems = measurementsByStage[stageId].sort((a, b) => 
                  new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
                );
                
                return (
                  <div key={stageId} className="border-l-2 border-primary/30 pl-4 print:border-gray-400">
                    <h4 className="font-semibold text-sm mb-2">
                      Etapa {stageId}: {STAGE_NAMES[stageId] || `Etapa ${stageId}`}
                    </h4>
                    <div className="flex flex-col gap-2">
                      {stageItems.map((item, idx) => (
                        <div 
                          key={idx} 
                          className="flex justify-between items-center bg-secondary/30 rounded-md px-3 py-2 text-sm print:bg-gray-100"
                        >
                          <span className="text-muted-foreground print:text-gray-600">
                            {getMeasurementLabel(item.key, stageId, stageId === 15 ? idx : undefined)}
                          </span>
                          <span className="font-medium">
                            {formatValue(item.key, item.value)}
                          </span>
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
  );
}

function PrintableReport({ batches }: { batches: ProductionBatch[] }) {
  return (
    <div className="p-8">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold">Matuh Queijaria</h1>
        <h2 className="text-xl">Relatório de Lotes Concluídos</h2>
        <p className="text-sm text-gray-600">Gerado em: {new Date().toLocaleString("pt-BR")}</p>
      </div>
      
      {batches.map((batch) => {
        const measurements = batch.measurements as Record<string, any> || {};
        const history: MeasurementHistoryItem[] = measurements._history || [];
        
        const measurementsByStage = history.reduce((acc, item) => {
          if (!acc[item.stageId]) {
            acc[item.stageId] = [];
          }
          acc[item.stageId].push(item);
          return acc;
        }, {} as Record<number, MeasurementHistoryItem[]>);
        
        const stageIds = Object.keys(measurementsByStage).map(Number).sort((a, b) => a - b);
        
        return (
          <div key={batch.id} className="mb-8 break-inside-avoid">
            <div className="border-b-2 border-black pb-2 mb-4">
              <h3 className="text-lg font-bold">Lote {formatBatchCode(batch.startedAt)}</h3>
              <p className="text-sm">
                {getCheeseTypeName(batch.recipeId)} - {batch.milkVolumeL}L - 
                Concluído em {batch.completedAt ? new Date(batch.completedAt).toLocaleDateString("pt-BR") : "N/A"}
              </p>
              {batch.chamber2EntryDate && (
                <p className="text-sm">
                  Entrada na Câmara 2: {new Date(batch.chamber2EntryDate).toLocaleDateString("pt-BR")}
                </p>
              )}
              {batch.maturationEndDate && (
                <p className="text-sm">
                  Fim da Maturação: {new Date(batch.maturationEndDate).toLocaleDateString("pt-BR")}
                </p>
              )}
            </div>
            
            {stageIds.map((stageId) => {
              const stageItems = measurementsByStage[stageId].sort((a, b) => 
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
              );
              
              return (
                <div key={stageId} className="mb-4 pl-4 border-l-2 border-gray-400">
                  <h4 className="font-semibold text-sm mb-2">
                    Etapa {stageId}: {STAGE_NAMES[stageId] || `Etapa ${stageId}`}
                  </h4>
                  <div className="flex flex-col gap-1">
                    {stageItems.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm bg-gray-100 px-2 py-1 rounded">
                        <span>{getMeasurementLabel(item.key, stageId, stageId === 15 ? idx : undefined)}</span>
                        <span className="font-medium">{formatValue(item.key, item.value)}</span>
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

  const handleExportPDF = () => {
    handlePrint();
  };

  const handleExportExcel = () => {
    if (completedBatches && completedBatches.length > 0) {
      exportToExcel(completedBatches);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
          <div>
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
            <p className="text-muted-foreground">
              Visualize o histórico de medições dos lotes concluídos.
            </p>
          </div>
          
          {completedBatches && completedBatches.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button 
                variant="outline" 
                onClick={handlePrint}
                data-testid="button-print"
              >
                <Printer className="w-4 h-4 mr-2" />
                Imprimir
              </Button>
              <Button 
                variant="outline" 
                onClick={handleExportPDF}
                data-testid="button-export-pdf"
              >
                <FileDown className="w-4 h-4 mr-2" />
                Salvar PDF
              </Button>
              <Button 
                variant="outline" 
                onClick={handleExportExcel}
                data-testid="button-export-excel"
              >
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Exportar Excel
              </Button>
            </div>
          )}
        </header>

        <section>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Lotes Concluídos
          </h2>
          
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-secondary/30 animate-pulse" />
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
            <div>
              {completedBatches.map((batch) => (
                <BatchReport key={batch.id} batch={batch} />
              ))}
            </div>
          )}
        </section>
      </main>
      
      <div className="hidden">
        <div ref={printRef}>
          {completedBatches && completedBatches.length > 0 && (
            <PrintableReport batches={completedBatches} />
          )}
        </div>
      </div>
    </div>
  );
}
