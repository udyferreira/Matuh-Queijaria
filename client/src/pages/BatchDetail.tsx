import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowRight, CheckCircle, AlertCircle, Thermometer, Scale, Pause, Play, XCircle, Flag } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useBatch, useAdvanceStage, useLogMeasurement, usePauseBatch, useResumeBatch, useCompleteBatch, useCancelBatch } from "@/hooks/use-batches";
import { TimerWidget } from "@/components/widgets/TimerWidget";
import { IngredientList } from "@/components/widgets/IngredientList";
import { ChatAssistant } from "@/components/widgets/ChatAssistant";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";

const STAGE_NAMES: Record<number, string> = {
  1: "Separar o leite",
  2: "Calcular fermentos e coalho",
  3: "Aquecer o leite a 32°C",
  4: "Adicionar fermentos LR e DX e mexer",
  5: "Adicionar fermento KL e coalho",
  6: "Anotar horário de floculação",
  7: "Anotar horário do ponto de corte",
  8: "Corte da massa com a Lira",
  9: "Corte complementar com espátula",
  10: "Mexedura progressiva da massa",
  11: "Enformagem com peneira e paninho",
  12: "Dessoragem em mesa",
  13: "Medir e anotar pH inicial",
  14: "Colocar na prensa",
  15: "Virar queijos e medir pH",
  16: "Transferir para câmara de secagem",
  17: "Salga em tanque",
  18: "Secagem em prateleiras",
  19: "Transferir para Câmara 2",
  20: "Virar queijos diariamente na Câmara 2",
};

const STAGE_INSTRUCTIONS: Record<number, string[]> = {
  4: ["Adicione o fermento LR", "Adicione o fermento DX", "Mexa bem o leite", "Aguarde 30 minutos mexendo ocasionalmente"],
  5: ["Adicione o fermento KL", "Adicione o coalho", "Mexa bem", "Coloque a Lira e aguarde floculação"],
  10: ["Comece devagar e aumente o vigor progressivamente", "Aguarde 30 minutos de mexedura"],
  17: ["Mergulhe os queijos no tanque de salmoura", "Tempo de salga: 8 horas"],
};

const TIMER_LABELS: Record<number, string> = {
  4: "Maturação dos fermentos LR/DX",
  10: "Mexedura progressiva",
  17: "Salga em salmoura",
  19: "Secagem na Câmara 2",
};

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Em Produção", variant: "default" },
  paused: { label: "Pausado", variant: "secondary" },
  completed: { label: "Concluído", variant: "outline" },
  cancelled: { label: "Cancelado", variant: "destructive" },
};

export default function BatchDetail() {
  const [, params] = useRoute("/batch/:id");
  const [, navigate] = useLocation();
  const id = parseInt(params?.id || "0");
  const { data: batch, isLoading } = useBatch(id);
  const { mutate: advance, isPending: isAdvancing } = useAdvanceStage();
  const { mutate: logInput, isPending: isLogging } = useLogMeasurement();
  const { mutate: pauseBatch, isPending: isPausing } = usePauseBatch();
  const { mutate: resumeBatch, isPending: isResuming } = useResumeBatch();
  const { mutate: completeBatch, isPending: isCompleting } = useCompleteBatch();
  const { mutate: cancelBatch, isPending: isCancelling } = useCancelBatch();
  const { toast } = useToast();

  const [inputVal, setInputVal] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [pauseReason, setPauseReason] = useState("");
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showPauseDialog, setShowPauseDialog] = useState(false);

  if (isLoading || !batch) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-primary"></div>
      </div>
    );
  }

  const activeTimers = (batch.activeTimers as any[]) || [];
  const currentStageTimer = activeTimers.find((t: any) => t.stageId === batch.currentStageId);
  const isTimerStage = !!currentStageTimer;
  const isTimerComplete = currentStageTimer?.isComplete || (currentStageTimer ? new Date(currentStageTimer.endTime) <= new Date() : false);
  const isInputStage = [6, 7, 13, 14].includes(batch.currentStageId);
  const inputType = batch.currentStageId === 13 ? "ph" : "time"; 
  const inputLabel = inputType === "ph" ? "Valor do pH" : "Horário (HH:MM)";
  const stageInstructions = STAGE_INSTRUCTIONS[batch.currentStageId] || [];
  const timerLabel = TIMER_LABELS[batch.currentStageId] || "Timer da Etapa";

  const handleAdvance = () => {
    advance({ id, data: { stageId: batch.currentStageId } }, {
      onSuccess: () => toast({ title: "Etapa Concluída", description: "Avançando para a próxima etapa." }),
      onError: (err) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };

  const handleInputLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal) return;

    logInput({ 
      id, 
      data: { 
        type: inputType, 
        value: inputType === 'ph' ? parseFloat(inputVal) : inputVal 
      } 
    }, {
      onSuccess: () => {
        toast({ title: "Registrado", description: "Medição salva com sucesso." });
        setInputVal("");
        handleAdvance(); 
      }
    });
  };

  const handlePause = () => {
    pauseBatch({ id, reason: pauseReason || undefined }, {
      onSuccess: () => {
        toast({ title: "Pausado", description: "Produção pausada. Retome quando estiver pronto." });
        setShowPauseDialog(false);
        setPauseReason("");
      },
      onError: (err) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };

  const handleResume = () => {
    resumeBatch({ id }, {
      onSuccess: () => toast({ title: "Retomado", description: "Produção retomada com sucesso." }),
      onError: (err) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };

  const handleComplete = () => {
    completeBatch({ id }, {
      onSuccess: () => {
        toast({ title: "Concluído", description: "Lote marcado como concluído." });
        navigate("/");
      },
      onError: (err) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
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
  
  const handleClosePauseDialog = () => {
    setShowPauseDialog(false);
    setPauseReason("");
  };

  const isFinished = batch.status === 'completed' || batch.status === 'cancelled';
  const isPaused = batch.status === 'paused';
  const statusInfo = STATUS_LABELS[batch.status] || STATUS_LABELS.active;

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="text-sm font-mono text-primary bg-primary/10 px-2 py-1 rounded">
                LOTE #{batch.id.toString().padStart(4, '0')}
              </span>
              <Badge variant={statusInfo.variant} data-testid="badge-batch-status">
                {statusInfo.label}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Iniciado em {new Date(batch.startedAt).toLocaleDateString('pt-BR')}
              </span>
            </div>
            <h1 className="text-3xl font-display font-bold">Produção Matuh Queijaria</h1>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="bg-card px-6 py-3 rounded-xl border border-border shadow-lg flex items-center gap-4">
               <div className="text-right">
                 <div className="text-xs text-muted-foreground uppercase tracking-wider">Volume Total</div>
                 <div className="text-xl font-bold">{batch.milkVolumeL}L</div>
               </div>
               <div className="h-8 w-px bg-border" />
               <div className="text-right">
                 <div className="text-xs text-muted-foreground uppercase tracking-wider">Etapa</div>
                 <div className="text-xl font-bold text-primary">{batch.currentStageId} <span className="text-muted-foreground text-sm font-normal">/ 20</span></div>
               </div>
            </div>
            
            {!isFinished && (
              <div className="flex items-center gap-2">
                {isPaused ? (
                  <Button onClick={handleResume} disabled={isResuming} variant="outline" data-testid="button-resume">
                    <Play className="w-4 h-4 mr-2" />
                    {isResuming ? "Retomando..." : "Retomar"}
                  </Button>
                ) : (
                  <Dialog open={showPauseDialog} onOpenChange={(open) => open ? setShowPauseDialog(true) : handleClosePauseDialog()}>
                    <DialogTrigger asChild>
                      <Button variant="outline" data-testid="button-pause">
                        <Pause className="w-4 h-4 mr-2" />
                        Pausar
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Pausar Produção</DialogTitle>
                        <DialogDescription>
                          Você pode informar um motivo para a pausa (opcional).
                        </DialogDescription>
                      </DialogHeader>
                      <Input 
                        placeholder="Motivo da pausa (opcional)..." 
                        value={pauseReason}
                        onChange={(e) => setPauseReason(e.target.value)}
                        data-testid="input-pause-reason"
                      />
                      <DialogFooter>
                        <Button variant="outline" onClick={handleClosePauseDialog}>
                          Voltar
                        </Button>
                        <Button onClick={handlePause} disabled={isPausing} data-testid="button-pause-confirm">
                          {isPausing ? "Pausando..." : "Confirmar Pausa"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
                
                <Button onClick={handleComplete} disabled={isCompleting} variant="outline" data-testid="button-complete">
                  <Flag className="w-4 h-4 mr-2" />
                  {isCompleting ? "..." : "Concluir"}
                </Button>
                
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
        
        {isPaused && (
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 p-4 rounded-xl mb-6 flex items-center gap-3">
            <Pause className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-medium">Produção Pausada</p>
              {batch.pauseReason && <p className="text-sm opacity-80">Motivo: {batch.pauseReason}</p>}
            </div>
          </div>
        )}
        
        {isFinished && (
          <div className={`p-4 rounded-xl mb-6 flex items-center gap-3 ${batch.status === 'completed' ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
            {batch.status === 'completed' ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <XCircle className="w-5 h-5 flex-shrink-0" />}
            <div>
              <p className="font-medium">{batch.status === 'completed' ? 'Lote Concluído' : 'Lote Cancelado'}</p>
              {batch.cancelReason && <p className="text-sm opacity-80">Motivo: {batch.cancelReason}</p>}
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            
            <motion.div 
              layoutId="stage-card"
              className="glass-card p-8 rounded-3xl border-l-4 border-l-primary relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <CheckCircle className="w-48 h-48" />
              </div>

              <div className="relative z-10">
                <h2 className="text-sm font-medium text-primary uppercase tracking-widest mb-2">Etapa Atual</h2>
                <h3 className="text-3xl font-bold mb-6 leading-tight">
                  {STAGE_NAMES[batch.currentStageId] || `Etapa ${batch.currentStageId}`}
                </h3>

                <div className="bg-background/50 backdrop-blur rounded-xl p-6 border border-white/5 mb-8">
                  
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

                  {isTimerStage && currentStageTimer ? (
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
                  ) : isInputStage ? (
                    <form onSubmit={handleInputLog} className="max-w-md">
                       <label className="block text-sm font-medium mb-2">{inputLabel}</label>
                       <div className="flex gap-4">
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
                         <Button type="submit" size="lg" disabled={isLogging} data-testid="button-log-next">
                           Registrar e Avançar
                         </Button>
                       </div>
                    </form>
                  ) : (
                    <div className="space-y-4 text-lg">
                      <p>Siga o procedimento padrão para esta etapa.</p>
                      {batch.calculatedInputs && <IngredientList inputs={batch.calculatedInputs as Record<string, number>} />}
                      
                      <div className="flex items-center gap-3 text-amber-400 bg-amber-400/10 p-4 rounded-lg mt-4 text-base border border-amber-400/20">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <p>Certifique-se de que todos os utensílios estão higienizados antes de prosseguir.</p>
                      </div>
                    </div>
                  )}
                </div>

                {!isInputStage && (
                  <Button 
                    size="lg" 
                    className="w-full h-16 text-lg font-bold premium-gradient shadow-lg text-amber-400"
                    onClick={handleAdvance}
                    disabled={isAdvancing || (isTimerStage && !isTimerComplete)}
                    data-testid="button-complete-step"
                  >
                    {isAdvancing ? "Processando..." : isTimerStage && !isTimerComplete ? "Aguarde o Timer..." : "Marcar Etapa como Concluída"} 
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                )}
              </div>
            </motion.div>

            {batch.currentStageId >= 2 && batch.calculatedInputs && (
               <div className="glass-card p-6 rounded-2xl">
                 <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                   <Scale className="w-5 h-5 text-primary" />
                   Receita do Lote
                 </h3>
                 <IngredientList inputs={batch.calculatedInputs as Record<string, number>} />
               </div>
            )}
          </div>

          <div className="space-y-6">
            
            <div className="bg-card border border-border rounded-2xl p-6">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <Thermometer className="w-5 h-5 text-primary" />
                Registro de Medições
              </h3>
              
              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                <div className="flex justify-between items-center py-2 border-b border-border/50 text-sm">
                  <span className="text-muted-foreground">Iniciado</span>
                  <span className="font-mono">{new Date(batch.startedAt).toLocaleTimeString('pt-BR')}</span>
                </div>
                {Object.entries(batch.measurements as Record<string, any> || {}).map(([key, val]) => (
                  <div key={key} className="flex justify-between items-center py-2 border-b border-border/50 text-sm">
                    <span className="capitalize text-muted-foreground">{key.replace(/_/g, ' ')}</span>
                    <span className="font-mono font-bold">{typeof val === 'object' ? JSON.stringify(val) : val}</span>
                  </div>
                ))}
                {(!batch.measurements || Object.keys(batch.measurements as object).length === 0) && (
                   <div className="text-center text-muted-foreground py-4 text-sm italic">
                     Nenhuma medição registrada ainda.
                   </div>
                )}
              </div>
            </div>

            <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6">
              <h3 className="font-bold mb-2 text-primary">Precisa de Ajuda?</h3>
              <p className="text-sm text-muted-foreground mb-4">
                O Assistente Nete está ativo. Use o botão de chat para perguntas sobre ajustes da receita ou tempos.
              </p>
            </div>
          </div>
        </div>
      </main>

      <ChatAssistant context={`Lote #${batch.id}, Etapa ${batch.currentStageId}`} />
    </div>
  );
}
