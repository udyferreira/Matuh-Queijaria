import { Link } from "wouter";
import { FileText, ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompletedBatches } from "@/hooks/use-batches";
import { getCheeseTypeName, formatBatchCode, ProductionBatch } from "@shared/schema";
import { useState } from "react";

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
  pieces_quantity: "Quantidade de Peças",
  chamber_2_entry_date: "Data Entrada Câmara 2",
  timestamp: "Data/Hora"
};

interface MeasurementHistoryItem {
  key: string;
  value: number | string;
  stageId: number;
  timestamp: string;
}

function formatValue(key: string, value: number | string): string {
  if (key === "chamber_2_entry_date" || key === "timestamp") {
    return new Date(value).toLocaleString("pt-BR");
  }
  if (typeof value === "number") {
    return value.toString();
  }
  return String(value);
}

function BatchReport({ batch }: { batch: ProductionBatch }) {
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
    <Card className="mb-4">
      <CardHeader 
        className="cursor-pointer hover-elevate" 
        onClick={() => setExpanded(!expanded)}
        data-testid={`card-batch-report-${batch.id}`}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="w-6 h-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">
                Lote {formatBatchCode(batch.startedAt)}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {getCheeseTypeName(batch.recipeId)} - {batch.milkVolumeL}L - Concluído em {batch.completedAt ? new Date(batch.completedAt).toLocaleDateString("pt-BR") : "N/A"}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" data-testid={`button-expand-${batch.id}`}>
            {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </Button>
        </div>
      </CardHeader>
      
      {expanded && (
        <CardContent data-testid={`content-batch-report-${batch.id}`}>
          {stageIds.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              Nenhuma medição registrada para este lote.
            </p>
          ) : (
            <div className="space-y-4">
              {stageIds.map((stageId) => (
                <div key={stageId} className="border-l-2 border-primary/30 pl-4">
                  <h4 className="font-semibold text-sm mb-2">
                    Etapa {stageId}: {STAGE_NAMES[stageId] || `Etapa ${stageId}`}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {measurementsByStage[stageId].map((item, idx) => (
                      <div 
                        key={idx} 
                        className="flex justify-between items-center bg-secondary/30 rounded-md px-3 py-2 text-sm"
                      >
                        <span className="text-muted-foreground">
                          {MEASUREMENT_LABELS[item.key] || item.key}
                        </span>
                        <span className="font-medium">
                          {formatValue(item.key, item.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function Reports() {
  const { data: completedBatches, isLoading } = useCompletedBatches();

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
    </div>
  );
}
