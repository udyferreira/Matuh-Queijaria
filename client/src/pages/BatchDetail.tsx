import { useState, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowRight, ChevronLeft, CheckCircle, AlertCircle, Thermometer, Scale, XCircle, Pencil, Check, X } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useBatch, useAdvanceStage, useRollbackStage, useLogMeasurement, useLogCanonicalInput, useEditMeasurement, useCancelBatch } from "@/hooks/use-batches";
import { TimerWidget } from "@/components/widgets/TimerWidget";
import { IngredientList } from "@/components/widgets/IngredientList";

import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { getCheeseTypeName, formatBatchCode } from "@shared/schema";
import { parseDateOnly } from "@/lib/utils";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Em Produção", variant: "default" },
  completed: { label: "Concluído", variant: "outline" },
  cancelled: { label: "Cancelado", variant: "destructive" },
};

export default function BatchDetail() {
  const [, params] = useRoute("/batch/:id");
  const [, navigate] = useLocation();
  const parsedId = params?.id ? parseInt(params.id) : 0;
  const id = parsedId > 0 ? parsedId : 0;
  
  // Query disabled for id <= 0, preventing GET /api/batches/0
  const { data: batch, isLoading } = useBatch(id, { enabled: id > 0 });
  const { mutate: advance, isPending: isAdvancing } = useAdvanceStage();
  const { mutate: rollback, isPending: isRollingBack } = useRollbackStage();
  const { mutate: logInput, isPending: isLogging } = useLogMeasurement();
  const { mutate: logCanonical, isPending: isLoggingCanonical } = useLogCanonicalInput();
  const { mutate: editMeasurement, isPending: isEditing } = useEditMeasurement();
  const { mutate: cancelBatch, isPending: isCancelling } = useCancelBatch();
  const { toast } = useToast();

  const [inputVal, setInputVal] = useState("");
  const [piecesQuantity, setPiecesQuantity] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  // Heat curd stage (Nina stage 15) — 3-min repeating timer until 38°C is reached
  const [heatCycleStart, setHeatCycleStart] = useState(() => new Date().toISOString());
  const [heatTimerDone, setHeatTimerDone] = useState(false);
  const [heatTempReached, setHeatTempReached] = useState(false);
  const handleHeatTimerComplete = useCallback(() => setHeatTimerDone(true), []);
  const handleHeatRetry = useCallback(() => {
    setHeatCycleStart(new Date().toISOString());
    setHeatTimerDone(false);
    setHeatTempReached(false);
  }, []);
  const handleHeatConfirm = useCallback(() => {
    setHeatTempReached(true);
    handleAdvance();
  }, [handleAdvance]);
  
  // Redirect to home if invalid id (after all hooks are called)
  if (id === 0) {
    navigate("/");
    return null;
  }

  if (isLoading || !batch) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-primary"></div>
      </div>
    );
  }

  const stageInfo = (batch as any).stageInfo;
  const totalStages: number = (batch as any).totalStages || 19;
  const recipeName: string = (batch as any).recipeName || getCheeseTypeName(batch.recipeId);

  const activeTimers = (batch.activeTimers as any[]) || [];
  const currentStageTimer = activeTimers.find((t: any) => t.stageId === batch.currentStageId);
  const isBlockingTimer = currentStageTimer?.blocking === true;
  const isTimerStage = !!currentStageTimer;
  const isTimerComplete = currentStageTimer?.isComplete || (currentStageTimer ? new Date(currentStageTimer.endTime) <= new Date() : false);

  const requiredInputs: string[] = stageInfo?.requiredInputs || [];
  const isInputStage = requiredInputs.length > 0;
  const isMultiInputStage = requiredInputs.includes('ph_value') && requiredInputs.includes('pieces_quantity');
  const isLoopPhStage = stageInfo?.type === 'loop' && requiredInputs.includes('ph_value');
  const isHeatCurdStage = stageInfo?.type === 'heat_curd';
  const isDateInputStage = requiredInputs.includes('chamber_2_entry_date');
  const isFlocculationStage = requiredInputs.includes('flocculation_time');
  const isCutPointStage = requiredInputs.includes('cut_point_time');
  const isPressStartStage = requiredInputs.includes('press_start_time');

  const inputType = (isMultiInputStage || isLoopPhStage || requiredInputs.includes('ph_value')) ? "ph"
    : isDateInputStage ? "date"
    : "time";
  const inputLabel = inputType === "ph" ? "Valor do pH"
    : inputType === "date" ? "Data de entrada na Câmara 2"
    : "Horário (HH:MM)";
  const stageInstructions: string[] = stageInfo?.instructions || [];

  const buildTimerLabel = (timer: any): string => {
    if (!timer) return "Timer da Etapa";
    if (timer.durationMin) return `Timer de ${timer.durationMin} minutos`;
    if (timer.durationHours) return `Timer de ${timer.durationHours} hora${timer.durationHours !== 1 ? 's' : ''}`;
    if (timer.intervalMin) return `Intervalo de ${timer.intervalMin} minutos`;
    if (timer.intervalHours) return `Intervalo de ${timer.intervalHours} hora${timer.intervalHours !== 1 ? 's' : ''}`;
    return "Timer da Etapa";
  };
  const timerLabel = buildTimerLabel(stageInfo?.timer);

  const loopIntervalText = (() => {
    const t = stageInfo?.timer;
    if (!t) return "regularmente";
    if (t.intervalHours === 2) return "a cada 2 horas";
    if (t.intervalHours === 1.5) return "a cada 1 hora e 30 minutos";
    if (t.intervalHours) return `a cada ${t.intervalHours} hora${t.intervalHours !== 1 ? 's' : ''}`;
    if (t.intervalMin) return `a cada ${t.intervalMin} minutos`;
    return "a cada 1 hora e 30 minutos";
  })();

  const handleAdvance = () => {
    advance({ id, data: { stageId: batch.currentStageId } }, {
      onSuccess: () => toast({ title: "Etapa Concluída", description: "Avançando para a próxima etapa." }),
      onError: (err) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };

  const handleRollback = () => {
    rollback({ id }, {
      onSuccess: () => toast({ title: "Etapa Revertida", description: "O lote voltou para a etapa anterior." }),
      onError: (err) => toast({ title: "Não foi possível voltar", description: err.message, variant: "destructive" })
    });
  };

  const handleInputLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal) return;

    // Multi-input: pH + pieces_quantity (initial pH stage — any recipe)
    if (isMultiInputStage) {
      if (!piecesQuantity) {
        toast({ title: "Erro", description: "Informe a quantidade de peças.", variant: "destructive" });
        return;
      }
      logCanonical({ id, data: { key: 'ph_value', value: parseFloat(inputVal), unit: 'pH' } }, {
        onSuccess: () => {
          logCanonical({ id, data: { key: 'pieces_quantity', value: parseInt(piecesQuantity) } }, {
            onSuccess: () => {
              toast({ title: "Registrado", description: "pH e quantidade de peças salvos." });
              setInputVal("");
              setPiecesQuantity("");
              handleAdvance();
            },
            onError: (err) => toast({ title: "Erro", description: err.message, variant: "destructive" })
          });
        },
        onError: (err) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
      return;
    }

    // Loop pH stage: log pH without auto-advance (backend controls loop)
    if (isLoopPhStage) {
      logCanonical({ id, data: { key: 'ph_value', value: parseFloat(inputVal), unit: 'pH' } }, {
        onSuccess: () => {
          toast({ title: "Registrado", description: "Medição de pH registrada." });
          setInputVal("");
        },
        onError: (err) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
      return;
    }

    // Date input stage: chamber entry date (final stage of any recipe)
    if (isDateInputStage) {
      logCanonical({ id, data: { key: 'chamber_2_entry_date', value: inputVal } }, {
        onSuccess: () => {
          toast({ title: "Lote Concluído", description: "Data registrada e lote concluído. Até o próximo queijo!" });
          setInputVal("");
          navigate("/");
        },
        onError: (err) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
      return;
    }

    // Time input stages: validate HH:MM format
    const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
    if ((isFlocculationStage || isCutPointStage || isPressStartStage) && !timeRegex.test(inputVal)) {
      toast({ title: "Erro", description: "Formato inválido. Use HH:MM (ex: 14:30)", variant: "destructive" });
      return;
    }

    if (isFlocculationStage) {
      logCanonical({ id, data: { key: 'flocculation_time', value: inputVal } }, {
        onSuccess: () => {
          toast({ title: "Registrado", description: "Horário de floculação registrado." });
          setInputVal("");
          handleAdvance();
        },
        onError: (err) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
      return;
    }

    if (isCutPointStage) {
      logCanonical({ id, data: { key: 'cut_point_time', value: inputVal } }, {
        onSuccess: () => {
          toast({ title: "Registrado", description: "Horário do ponto de corte registrado." });
          setInputVal("");
          handleAdvance();
        },
        onError: (err) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
      return;
    }

    if (isPressStartStage) {
      logCanonical({ id, data: { key: 'press_start_time', value: inputVal } }, {
        onSuccess: () => {
          toast({ title: "Registrado", description: "Horário da prensa registrado." });
          setInputVal("");
          handleAdvance();
        },
        onError: (err) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
      return;
    }

    toast({ title: "Erro", description: "Etapa não reconhecida.", variant: "destructive" });
  };

  const handleCancel = () => {
    if (!cancelReason.trim()) {
      toast({ title: "Erro", description: "Informe o motivo do cancelamento.", variant: "destructive" });
      return;
    }
    cancelBatch({ id, reason: cancelReason }, {
      onSuccess: () => {
        toast({ title: "Cancelado", description: "Lote cancelado." });
        setShowCancelDialog(false);
        setCancelReason("");
        navigate("/");
      },
      onError: (err) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };
  
  const handleCloseCancelDialog = () => {
    setShowCancelDialog(false);
    setCancelReason("");
  };
  
  const isFinished = batch.status === 'completed' || batch.status === 'cancelled';
  const statusInfo = STATUS_LABELS[batch.status] || STATUS_LABELS.active;

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      
      <main className="container mx-auto px-4 py-4 sm:py-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 sm:mb-8">
          <div>
            <div className="flex items-center gap-2 sm:gap-3 mb-2 flex-wrap">
              <span className="text-xs sm:text-sm font-mono text-primary bg-primary/10 px-2 py-1 rounded">
                LOTE {formatBatchCode(batch.startedAt)}
              </span>
              <Badge variant={statusInfo.variant} data-testid="badge-batch-status">
                {statusInfo.label}
              </Badge>
              <span className="text-xs sm:text-sm text-muted-foreground">
                Iniciado em {new Date(batch.startedAt).toLocaleDateString('pt-BR')}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold">Produção {recipeName}</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap w-full md:w-auto">
            <div className="bg-card px-3 py-2 sm:px-6 sm:py-3 rounded-xl border border-border shadow-lg flex items-center gap-2 sm:gap-4">
               <div className="text-right">
                 <div className="text-xs text-muted-foreground uppercase tracking-wider">Volume Total</div>
                 <div className="text-lg sm:text-xl font-bold">{batch.milkVolumeL}L</div>
               </div>
               <div className="h-8 w-px bg-border" />
               <div className="text-right">
                 <div className="text-xs text-muted-foreground uppercase tracking-wider">Etapa</div>
                 <div className="text-lg sm:text-xl font-bold text-primary">{batch.currentStageId} <span className="text-muted-foreground text-sm font-normal">/ {totalStages}</span></div>
               </div>
            </div>
            
            {!isFinished && (
              <div className="flex items-center gap-2 flex-wrap">
                <Dialog open={showCancelDialog} onOpenChange={(open) => open ? setShowCancelDialog(true) : handleCloseCancelDialog()}>
                  <DialogTrigger asChild>
                    <Button variant="destructive" size="icon" data-testid="button-cancel-open">
                      <XCircle className="w-4 h-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Cancelar Lote</DialogTitle>
                      <DialogDescription>
                        Esta ação não pode ser desfeita. Por favor, informe o motivo do cancelamento.
                      </DialogDescription>
                    </DialogHeader>
                    <Input 
                      placeholder="Motivo do cancelamento..." 
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      data-testid="input-cancel-reason"
                    />
                    <DialogFooter>
                      <Button variant="outline" onClick={handleCloseCancelDialog}>
                        Voltar
                      </Button>
                      <Button variant="destructive" onClick={handleCancel} disabled={isCancelling} data-testid="button-cancel-confirm">
                        {isCancelling ? "Cancelando..." : "Confirmar Cancelamento"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </div>
        </div>
        
        {isFinished && (
          <div className={`p-4 rounded-xl mb-6 flex items-center gap-3 ${batch.status === 'completed' ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
            {batch.status === 'completed' ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <XCircle className="w-5 h-5 flex-shrink-0" />}
            <div>
              <p className="font-medium">{batch.status === 'completed' ? 'Lote Concluído' : 'Lote Cancelado'}</p>
              {batch.cancelReason && <p className="text-sm opacity-80">Motivo: {batch.cancelReason}</p>}
            </div>
          </div>
        )}

        <div className="space-y-8">
          <div className="space-y-6">
            
            <motion.div 
              layoutId="stage-card"
              className="glass-card p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border-l-4 border-l-primary relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-8 opacity-5 hidden sm:block">
                <CheckCircle className="w-48 h-48" />
              </div>

              <div className="relative z-10">
                <h2 className="text-xs sm:text-sm font-medium text-primary uppercase tracking-widest mb-2">Etapa Atual</h2>
                <h3 className="text-xl sm:text-2xl md:text-3xl font-bold mb-4 sm:mb-6 leading-tight">
                  {stageInfo?.name || `Etapa ${batch.currentStageId}`}
                </h3>

                <div className="bg-background/50 backdrop-blur rounded-xl p-3 sm:p-4 md:p-6 border border-white/5 mb-4 sm:mb-8">
                  
                  {/* Instruções da etapa */}
                  {stageInstructions.length > 0 && (
                    <div className="mb-6">
                      <h4 className="text-sm font-medium text-muted-foreground mb-3">Instruções:</h4>
                      <ul className="space-y-2">
                        {stageInstructions.map((instruction, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="bg-primary/20 text-primary rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">{i + 1}</span>
                            <span>{instruction}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {isTimerStage && currentStageTimer && isBlockingTimer ? (
                    <div className="space-y-4">
                      <TimerWidget 
                        durationMinutes={currentStageTimer.durationMinutes || Math.round((new Date(currentStageTimer.endTime).getTime() - new Date(currentStageTimer.startTime).getTime()) / 60000)} 
                        startTime={currentStageTimer.startTime} 
                        label={timerLabel} 
                      />
                      {isTimerComplete && (
                        <div className="text-center text-green-400 font-medium">
                          Timer concluído! Você pode avançar para a próxima etapa.
                        </div>
                      )}
                    </div>
                  ) : isHeatCurdStage ? (
                    <div className="space-y-4">
                      {!heatTempReached ? (
                        <>
                          <TimerWidget
                            key={heatCycleStart}
                            durationMinutes={stageInfo?.timer?.intervalMin || 3}
                            startTime={heatCycleStart}
                            label="Aquecimento — verificar temperatura"
                            onComplete={handleHeatTimerComplete}
                            hideCompletionMessage
                          />
                          {heatTimerDone && (
                            <motion.div
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 space-y-3"
                            >
                              <p className="text-amber-300 font-semibold text-center flex items-center justify-center gap-2">
                                <Thermometer className="w-5 h-5" />
                                A massa atingiu 38°C?
                              </p>
                              <div className="grid grid-cols-2 gap-3">
                                <Button
                                  variant="outline"
                                  size="lg"
                                  className="border-red-400/40 text-red-400 hover:bg-red-400/10"
                                  onClick={handleHeatRetry}
                                  data-testid="button-heat-no"
                                >
                                  Não — mais 3 min
                                </Button>
                                <Button
                                  size="lg"
                                  className="bg-green-600 hover:bg-green-500 text-white"
                                  onClick={handleHeatConfirm}
                                  data-testid="button-heat-yes"
                                >
                                  Sim — 38°C atingidos
                                </Button>
                              </div>
                            </motion.div>
                          )}
                        </>
                      ) : (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-green-400 font-semibold text-center flex items-center justify-center gap-2"
                          data-testid="status-heat-reached"
                        >
                          <CheckCircle className="w-5 h-5" />
                          38°C atingidos! Você pode avançar para a próxima etapa.
                        </motion.div>
                      )}
                    </div>
                  ) : isInputStage ? (
                    <form onSubmit={handleInputLog} className="max-w-md space-y-4">
                       {/* Stage 13: Multi-input (pH + pieces) */}
                       {isMultiInputStage ? (
                         <>
                           <div>
                             <label className="block text-sm font-medium mb-2">Valor do pH</label>
                             <Input 
                               value={inputVal} 
                               onChange={(e) => setInputVal(e.target.value)}
                               type="number"
                               step="0.1"
                               className="text-lg h-12"
                               placeholder="Ex: 6.5"
                               autoFocus
                               data-testid="input-ph-value"
                             />
                           </div>
                           <div>
                             <label className="block text-sm font-medium mb-2">Quantidade de Peças</label>
                             <Input 
                               value={piecesQuantity} 
                               onChange={(e) => setPiecesQuantity(e.target.value)}
                               type="number"
                               className="text-lg h-12"
                               placeholder="Ex: 24"
                               data-testid="input-pieces-quantity"
                             />
                           </div>
                           <Button type="submit" size="lg" disabled={isLoggingCanonical} data-testid="button-log-next" className="w-full">
                             Registrar e Avançar
                           </Button>
                         </>
                       ) : isDateInputStage ? (
                         <>
                           <label className="block text-sm font-medium mb-2">{inputLabel}</label>
                           <div className="flex flex-col sm:flex-row gap-3">
                             <Input 
                               value={inputVal} 
                               onChange={(e) => setInputVal(e.target.value)}
                               type="date"
                               className="text-lg h-12"
                               data-testid="input-date"
                             />
                             <Button type="submit" size="lg" disabled={isLoggingCanonical} className="w-full sm:w-auto" data-testid="button-log-next">
                               Registrar e Avançar
                             </Button>
                           </div>
                         </>
                       ) : (
                         <>
                           <label className="block text-sm font-medium mb-2">{inputLabel}</label>
                           <div className="flex flex-col sm:flex-row gap-3">
                             <Input 
                               value={inputVal} 
                               onChange={(e) => setInputVal(e.target.value)}
                               type={inputType === 'ph' ? 'number' : 'time'}
                               step={inputType === 'ph' ? '0.1' : undefined}
                               className="text-lg h-12"
                               placeholder="Insira o valor..."
                               autoFocus
                               data-testid="input-measurement"
                             />
                             <Button type="submit" size="lg" disabled={isLogging || isLoggingCanonical} className="w-full sm:w-auto" data-testid="button-log-next">
                               {isLoopPhStage ? "Registrar pH" : "Registrar e Avançar"}
                             </Button>
                           </div>
                           {isLoopPhStage && (() => {
                             const m = batch.measurements as Record<string, any> || {};
                             const history: Array<{key: string; value: any; stageId: number; timestamp: string}> = m._history || [];
                             const phEntries = history.filter(e => e.stageId === batch.currentStageId && e.key === 'ph_value').sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                             const lastEntry = phEntries[0];
                             const fmtDt = (iso: string) => {
                               try { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(iso)); } catch { return iso; }
                             };
                             const intervalMs = (() => {
                               const t = stageInfo?.timer;
                               if (!t) return 90 * 60000;
                               if (t.intervalHours) return t.intervalHours * 3600000;
                               if (t.intervalMin) return t.intervalMin * 60000;
                               return 90 * 60000;
                             })();
                             const nextTime = lastEntry?.timestamp ? new Date(new Date(lastEntry.timestamp).getTime() + intervalMs) : null;
                             const isPastDue = nextTime ? nextTime <= new Date() : false;

                             return (
                               <div className="space-y-2 mt-2">
                                 <div className="text-sm text-muted-foreground">
                                   Registre o pH {loopIntervalText}. Quando o pH ficar abaixo de 5.3, clique em "Concluir Etapa" abaixo.
                                 </div>
                                 <div className="grid grid-cols-2 gap-2 mt-2">
                                   <div className="bg-muted/30 border border-border/50 rounded-lg p-2 text-center">
                                     <div className="text-xs text-muted-foreground mb-1">Último registro</div>
                                     <div className="font-mono text-sm font-bold" data-testid="text-last-ph-time">
                                       {lastEntry ? fmtDt(lastEntry.timestamp) : <span className="italic text-muted-foreground">Nenhum</span>}
                                     </div>
                                     {lastEntry && <div className="text-xs text-primary mt-0.5">pH {lastEntry.value}</div>}
                                   </div>
                                   <div className={`border rounded-lg p-2 text-center ${isPastDue ? 'bg-amber-400/10 border-amber-400/30' : 'bg-muted/30 border-border/50'}`}>
                                     <div className="text-xs text-muted-foreground mb-1">Próxima medição</div>
                                     <div className={`font-mono text-sm font-bold ${isPastDue ? 'text-amber-400' : ''}`} data-testid="text-next-ph-time">
                                       {nextTime ? fmtDt(nextTime.toISOString()) : <span className="italic text-muted-foreground">—</span>}
                                     </div>
                                     {isPastDue && <div className="text-xs text-amber-400 mt-0.5">Hora de medir!</div>}
                                   </div>
                                 </div>
                               </div>
                             );
                           })()}
                           {isTimerStage && currentStageTimer && !isBlockingTimer && (
                             <div className="mt-4">
                               <TimerWidget 
                                 durationMinutes={currentStageTimer.durationMinutes || Math.round((new Date(currentStageTimer.endTime).getTime() - new Date(currentStageTimer.startTime).getTime()) / 60000)} 
                                 startTime={currentStageTimer.startTime} 
                                 label={timerLabel} 
                               />
                               {isTimerComplete && (
                                 <div className="text-center text-amber-400 font-medium mt-2">
                                   Tempo de espera concluído. Hora de medir o pH!
                                 </div>
                               )}
                             </div>
                           )}
                         </>
                       )}
                    </form>
                  ) : (
                    <div className="space-y-4 text-lg">
                      <p>Siga o procedimento padrão para esta etapa.</p>
                      {stageInfo?.type === 'add' && batch.calculatedInputs && (
                        <IngredientList inputs={batch.calculatedInputs as Record<string, number>} />
                      )}

                      {stageInfo?.type === 'add' && (() => {
                        const m = batch.measurements as Record<string, any> || {};
                        const history: Array<{key: string; value: any; stageId: number}> = m._history || [];
                        const TIMESTAMP_LABELS: Record<string, string> = {
                          'ferment_lr_dx_add_time_iso': 'Horário de adição dos fermentos LR/DX',
                          'ferment_kl_coalho_add_time_iso': 'Horário de adição do fermento KL + coalho',
                          'ferment_add_time': 'Horário de adição dos fermentos',
                          'rennet_add_time': 'Horário de adição do coalho',
                        };
                        const fmtTime = (iso: string) => {
                          try {
                            return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
                          } catch { return iso; }
                        };
                        const knownTimestampKeys = Object.keys(TIMESTAMP_LABELS);
                        const stageTimestampKeys = history
                          .filter(e => e.stageId === batch.currentStageId && knownTimestampKeys.includes(e.key))
                          .map(e => e.key);
                        const flatTimestampKeys = knownTimestampKeys.filter(k => m[k] !== undefined && !stageTimestampKeys.includes(k));
                        const allTimestampKeys = [...new Set([...stageTimestampKeys, ...flatTimestampKeys])];

                        if (allTimestampKeys.length === 0) return null;

                        return allTimestampKeys.map((fermentKey) => {
                          const fermentLabel = TIMESTAMP_LABELS[fermentKey] || fermentKey.replace(/_/g, ' ');
                          const fermentValue = m[fermentKey];
                          const editKey = `stage-${fermentKey}`;
                          const isEditingThis = editingKey === editKey;

                          return (
                            <div key={fermentKey} className="bg-muted/30 border border-border/50 rounded-lg p-3 sm:p-4 mt-2">
                              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 sm:gap-2">
                                <span className="text-xs sm:text-sm text-muted-foreground">{fermentLabel}</span>
                                {isEditingThis ? (
                                  <div className="flex items-center gap-1">
                                    <Input
                                      data-testid={`input-edit-stage-${fermentKey}`}
                                      type="time"
                                      className="h-8 w-[120px] font-mono text-sm"
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                    />
                                    <Button size="icon" variant="ghost" className="h-8 w-8" disabled={isEditing}
                                      data-testid={`button-save-stage-${fermentKey}`}
                                      onClick={() => {
                                        if (!editValue.trim()) return;
                                        const batchDateStr = (batch.startedAt ? new Date(batch.startedAt) : new Date()).toISOString().split('T')[0];
                                        const isoVal = new Date(`${batchDateStr}T${editValue}:00.000-03:00`).toISOString();
                                        editMeasurement({ id, data: { key: fermentKey, value: isoVal, stageId: batch.currentStageId } }, {
                                          onSuccess: () => { setEditingKey(null); toast({ title: "Horário atualizado" }); },
                                          onError: (e) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
                                        });
                                      }}>
                                      <Check className="w-4 h-4" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-8 w-8"
                                      data-testid={`button-cancel-stage-${fermentKey}`}
                                      onClick={() => setEditingKey(null)}>
                                      <X className="w-4 h-4" />
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <span className={`font-mono text-sm ${fermentValue ? 'font-bold' : 'italic text-muted-foreground'}`}
                                      data-testid={`text-stage-${fermentKey}`}>
                                      {fermentValue ? fmtTime(fermentValue) : "Não registrado"}
                                    </span>
                                    <Button size="icon" variant="ghost" className="h-7 w-7"
                                      data-testid={`button-edit-stage-${fermentKey}`}
                                      onClick={() => {
                                        setEditingKey(editKey);
                                        setEditValue(fermentValue ? fmtTime(fermentValue) : '');
                                      }}>
                                      <Pencil className="w-3 h-3 text-muted-foreground" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        });
                      })()}
                      
                      <div className="flex items-center gap-3 text-amber-400 bg-amber-400/10 p-4 rounded-lg mt-4 text-base border border-amber-400/20">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <p>Certifique-se de que todos os utensílios estão higienizados antes de prosseguir.</p>
                      </div>
                    </div>
                  )}
                </div>

                {(!isInputStage || isLoopPhStage) && (
                  <Button 
                    size="lg" 
                    className="w-full h-16 text-lg font-bold premium-gradient shadow-lg text-amber-400"
                    onClick={handleAdvance}
                    disabled={isAdvancing || (isTimerStage && isBlockingTimer && !isTimerComplete) || (isHeatCurdStage && !heatTempReached)}
                    data-testid="button-complete-step"
                  >
                    {isAdvancing ? "Processando..." 
                      : isTimerStage && isBlockingTimer && !isTimerComplete ? "Aguarde o Timer..." 
                      : isHeatCurdStage && !heatTempReached ? "Aguarde atingir 38°C..."
                      : isLoopPhStage ? "Concluir Viragem (pH atingido)" 
                      : "Marcar Etapa como Concluída"} 
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                )}

                {batch.currentStageId > 3 && batch.status !== "completed" && batch.status !== "cancelled" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2 text-muted-foreground hover:text-foreground"
                    onClick={handleRollback}
                    disabled={isRollingBack}
                    data-testid="button-rollback-step"
                  >
                    <ChevronLeft className="mr-1 w-4 h-4" />
                    {isRollingBack ? "Revertendo..." : "Voltar Etapa Anterior"}
                  </Button>
                )}
              </div>
            </motion.div>

            {batch.currentStageId >= 2 && batch.calculatedInputs && (
               <div className="glass-card p-4 sm:p-6 rounded-2xl">
                 <h3 className="text-base sm:text-lg font-bold mb-4 flex items-center gap-2">
                   <Scale className="w-5 h-5 text-primary" />
                   Receita do Lote
                 </h3>
                 <IngredientList inputs={batch.calculatedInputs as Record<string, number>} />
               </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-2xl p-4 sm:p-6">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <Thermometer className="w-5 h-5 text-primary" />
              Registro de Medições
            </h3>
            
            <div className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b border-border/50 text-sm">
                  <span className="text-muted-foreground">Iniciado</span>
                  <span className="font-mono">{new Date(batch.startedAt).toLocaleTimeString('pt-BR')}</span>
                </div>
                
                {batch.chamber2EntryDate && (
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center items-start py-2 border-b border-border/50 text-sm gap-1 sm:gap-2">
                    <span className="text-muted-foreground flex-shrink-0 text-xs sm:text-sm">Entrada na Câmara 2</span>
                    {editingKey === "chamber_2_entry_date" ? (
                      <div className="flex items-center gap-1">
                        <Input
                          data-testid="input-edit-chamber2"
                          type="date"
                          className="h-7 w-[140px] font-mono text-xs"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                        />
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={isEditing}
                          data-testid="button-save-chamber2"
                          onClick={() => {
                            editMeasurement({ id, data: { key: "chamber_2_entry_date", value: editValue, stageId: 19 } }, {
                              onSuccess: () => { setEditingKey(null); toast({ title: "Data atualizada" }); },
                              onError: (e) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
                            });
                          }}>
                          <Check className="w-3 h-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" data-testid="button-cancel-chamber2"
                          onClick={() => setEditingKey(null)}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="font-mono font-bold">{parseDateOnly(batch.chamber2EntryDate)}</span>
                        <Button size="icon" variant="ghost" className="h-6 w-6" data-testid="button-edit-chamber2"
                          onClick={() => {
                            setEditingKey("chamber_2_entry_date");
                            setEditValue(parseDateOnly(batch.chamber2EntryDate).split('/').reverse().join('-'));
                          }}>
                          <Pencil className="w-3 h-3 text-muted-foreground" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                
                {batch.maturationEndDate && (
                  <div className="flex justify-between items-center py-2 border-b border-border/50 text-sm">
                    <span className="text-muted-foreground">Fim da Maturação</span>
                    <span className="font-mono font-bold">{parseDateOnly(batch.maturationEndDate)}</span>
                  </div>
                )}

                
                {(() => {
                  const measurements = batch.measurements as Record<string, any> || {};
                  const history = measurements._history as Array<{key: string; value: any; stageId: number; timestamp: string}> || [];
                  
                  const labelMap: Record<string, string> = {
                    'ph_value': 'Medição de pH',
                    'ph_measurement': 'Medição de pH',
                    'cut_point_time': 'Horário do Ponto de Corte',
                    'press_start_time': 'Horário de Início da Prensagem',
                    'flocculation_time': 'Horário de Floculação',
                    'temperature': 'Temperatura',
                    'time': 'Horário',
                    'recorded_time': 'Horário Registrado',
                    'milk_volume_l': 'Volume de Leite (L)',
                    'milk_temperature_c': 'Temperatura do Leite (°C)',
                    'milk_ph': 'pH do Leite',
                    'pieces_quantity': 'Quantidade de Peças',
                    'chamber_2_entry_date': 'Data de Entrada na Câmara 2',
                    'initial_ph': 'pH Inicial',
                    'turning_cycles_count': 'Quantidade de Viradas',
                    'ferment_lr_dx_add_time_iso': 'Adição Fermentos LR/DX',
                    'ferment_kl_coalho_add_time_iso': 'Adição Fermento KL + Coalho',
                    'brine_entry_time_iso': 'Entrada na Salga',
                    'shelf_start_time_iso': 'Início da Secagem em Prateleiras',
                  };

                  
                  type MeasurementItem = { label: string; value: string; editKey: string; historyIndex?: number; stageId?: number; editable: boolean };
                  const items: MeasurementItem[] = [];
                  
                  if (history.length > 0) {
                    const phByStage: Record<number, number> = {};
                    
                    history.forEach((entry, idx) => {
                      let label: string;
                      
                      if (entry.key === 'ph_value' || entry.key === 'ph_measurement') {
                        phByStage[entry.stageId] = (phByStage[entry.stageId] || 0) + 1;
                        const count = phByStage[entry.stageId];
                        label = count === 1 
                          ? `Etapa ${entry.stageId} - Medição de pH`
                          : `Etapa ${entry.stageId} - ${count}ª Medição de pH`;
                      } else {
                        label = `Etapa ${entry.stageId} - ${labelMap[entry.key] || entry.key.replace(/_/g, ' ')}`;
                      }
                      
                      if (entry.key === 'loop_exit_reason' || entry.key === 'rollback') return;
                      let displayValue = String(entry.value);
                      if (entry.key.endsWith('_time_iso')) {
                        try {
                          const needsDate = entry.key === 'brine_entry_time_iso' || entry.key === 'shelf_start_time_iso';
                          displayValue = new Intl.DateTimeFormat('pt-BR', {
                            timeZone: 'America/Sao_Paulo',
                            ...(needsDate ? { day: '2-digit', month: '2-digit', year: 'numeric' } : {}),
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(new Date(entry.value));
                        } catch { /* keep raw */ }
                      }
                      
                      items.push({
                        label,
                        value: displayValue,
                        editKey: entry.key,
                        historyIndex: idx,
                        stageId: entry.stageId,
                        editable: true,
                      });
                    });
                  } else {
                    const phArray = measurements.ph as Array<{value: number; timestamp: string; stageId?: number}> || [];
                    const phByStage: Record<number, number> = {};
                    
                    phArray.forEach((entry, idx) => {
                      const stageId = entry.stageId ?? (idx === 0 ? 13 : 15);
                      phByStage[stageId] = (phByStage[stageId] || 0) + 1;
                      const count = phByStage[stageId];
                      const label = count === 1
                        ? `Etapa ${stageId} - Medição de pH`
                        : `Etapa ${stageId} - ${count}ª Medição de pH`;
                      items.push({ label, value: String(entry.value), editKey: 'ph_value', stageId, editable: true });
                    });
                    
                    Object.entries(measurements).forEach(([key, val]) => {
                      if (key.startsWith('_') || key === 'ph_measurements' || key === 'ph' || key === 'ph_value' || key === 'loop_exit_reason') return;
                      const label = labelMap[key] || key.replace(/_/g, ' ');
                      let displayValue: string;
                      if (key.endsWith('_time_iso')) {
                        try {
                          displayValue = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(val as string));
                        } catch { displayValue = String(val); }
                      } else {
                        displayValue = typeof val === 'object' ? String(val?.value ?? val) : String(val);
                      }
                      items.push({ label, value: displayValue, editKey: key, editable: true });
                    });
                  }
                  
                  if (items.length === 0) {
                    return (
                      <div className="text-center text-muted-foreground py-4 text-sm italic">
                        Nenhuma medição registrada ainda.
                      </div>
                    );
                  }
                  
                  return items.map((item, idx) => {
                    const uniqueKey = `${item.editKey}-${item.historyIndex ?? idx}`;
                    const isEditingThis = editingKey === uniqueKey;

                    return (
                      <div key={idx} className="flex flex-col sm:flex-row sm:justify-between sm:items-center items-start py-2 border-b border-border/50 text-sm gap-1 sm:gap-2">
                        <span className="text-muted-foreground flex-shrink-0 text-xs">{item.label}</span>
                        {isEditingThis ? (
                          <div className="flex items-center gap-1">
                            <Input
                              data-testid={`input-edit-${uniqueKey}`}
                              type={item.editKey.endsWith('_time_iso') ? 'time' : undefined}
                              className="h-7 w-20 sm:w-[100px] font-mono text-xs"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && editValue.trim()) {
                                  const isIsoTimeKey = item.editKey.endsWith('_time_iso');
                                  let finalVal: string | number;
                                  if (isIsoTimeKey) {
                                    const batchDateStr = (batch.startedAt ? new Date(batch.startedAt) : new Date()).toISOString().split('T')[0];
                                    finalVal = new Date(`${batchDateStr}T${editValue}:00.000-03:00`).toISOString();
                                  } else {
                                    const stringKeys = new Set(['flocculation_time', 'cut_point_time', 'press_start_time', 'chamber_2_entry_date']);
                                    const keepAsString = stringKeys.has(item.editKey) || editValue.includes(':');
                                    const numVal = parseFloat(editValue);
                                    finalVal = keepAsString || isNaN(numVal) ? editValue : numVal;
                                  }
                                  editMeasurement({ id, data: { key: item.editKey, value: finalVal, historyIndex: item.historyIndex, stageId: item.stageId } }, {
                                    onSuccess: () => { setEditingKey(null); toast({ title: "Medição atualizada" }); },
                                    onError: (e) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
                                  });
                                }
                                if (e.key === 'Escape') setEditingKey(null);
                              }}
                            />
                            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={isEditing || !editValue.trim()}
                              data-testid={`button-save-${uniqueKey}`}
                              onClick={() => {
                                if (!editValue.trim()) return;
                                const isIsoTimeKey = item.editKey.endsWith('_time_iso');
                                let finalVal: string | number;
                                if (isIsoTimeKey) {
                                  const batchDateStr = (batch.startedAt ? new Date(batch.startedAt) : new Date()).toISOString().split('T')[0];
                                  finalVal = new Date(`${batchDateStr}T${editValue}:00.000-03:00`).toISOString();
                                } else {
                                  const stringKeys = new Set(['flocculation_time', 'cut_point_time', 'press_start_time', 'chamber_2_entry_date']);
                                  const keepAsString = stringKeys.has(item.editKey) || editValue.includes(':');
                                  const numVal = parseFloat(editValue);
                                  finalVal = keepAsString || isNaN(numVal) ? editValue : numVal;
                                }
                                editMeasurement({ id, data: { key: item.editKey, value: finalVal, historyIndex: item.historyIndex, stageId: item.stageId } }, {
                                  onSuccess: () => { setEditingKey(null); toast({ title: "Medição atualizada" }); },
                                  onError: (e) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
                                });
                              }}>
                              <Check className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7"
                              data-testid={`button-cancel-${uniqueKey}`}
                              onClick={() => setEditingKey(null)}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="font-mono font-bold">{item.value}</span>
                            {item.editable && (
                              <Button size="icon" variant="ghost" className="h-6 w-6"
                                data-testid={`button-edit-${uniqueKey}`}
                                onClick={() => { setEditingKey(uniqueKey); setEditValue(item.value); }}>
                                <Pencil className="w-3 h-3 text-muted-foreground" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
