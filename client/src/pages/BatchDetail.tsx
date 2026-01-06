import { useState } from "react";
import { useRoute } from "wouter";
import { ArrowRight, CheckCircle, AlertCircle, Thermometer, Clock, Scale } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBatch, useAdvanceStage, useLogMeasurement } from "@/hooks/use-batches";
import { TimerWidget } from "@/components/widgets/TimerWidget";
import { IngredientList } from "@/components/widgets/IngredientList";
import { ChatAssistant } from "@/components/widgets/ChatAssistant";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

export default function BatchDetail() {
  const [, params] = useRoute("/batch/:id");
  const id = parseInt(params?.id || "0");
  const { data: batch, isLoading } = useBatch(id);
  const { mutate: advance, isPending: isAdvancing } = useAdvanceStage();
  const { mutate: logInput, isPending: isLogging } = useLogMeasurement();
  const { toast } = useToast();

  const [inputVal, setInputVal] = useState("");

  if (isLoading || !batch) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-primary"></div>
      </div>
    );
  }

  // --- Derived State ---
  // In a real app, these mappings would come from the API (recipe definition)
  // For this demo, we'll infer UI state from the simple stage ID
  const isTimerStage = batch.activeTimers && batch.activeTimers.length > 0;
  const isInputStage = [1, 6, 7, 13, 19].includes(batch.currentStageId);
  const inputType = batch.currentStageId === 13 ? "ph" : "time"; 
  const inputLabel = inputType === "ph" ? "pH Value" : "Time (HH:MM)";

  const handleAdvance = () => {
    advance({ id, data: { stageId: batch.currentStageId } }, {
      onSuccess: () => toast({ title: "Stage Complete", description: "Moving to next step." }),
      onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" })
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
        toast({ title: "Logged", description: "Measurement saved." });
        setInputVal("");
        // Auto advance after logging if it's a simple input stage
        handleAdvance(); 
      }
    });
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8">
        {/* Header Summary */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm font-mono text-primary bg-primary/10 px-2 py-1 rounded">
                BATCH #{batch.id.toString().padStart(4, '0')}
              </span>
              <span className="text-sm text-muted-foreground">
                Started {new Date(batch.startedAt).toLocaleDateString()}
              </span>
            </div>
            <h1 className="text-3xl font-display font-bold">Queijo Nete Production</h1>
          </div>
          <div className="bg-card px-6 py-3 rounded-xl border border-border shadow-lg flex items-center gap-4">
             <div className="text-right">
               <div className="text-xs text-muted-foreground uppercase tracking-wider">Total Volume</div>
               <div className="text-xl font-bold">{batch.milkVolumeL}L</div>
             </div>
             <div className="h-8 w-px bg-border" />
             <div className="text-right">
               <div className="text-xs text-muted-foreground uppercase tracking-wider">Stage</div>
               <div className="text-xl font-bold text-primary">{batch.currentStageId} <span className="text-muted-foreground text-sm font-normal">/ 20</span></div>
             </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* LEFT: Main Action Area */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Current Stage Card */}
            <motion.div 
              layoutId="stage-card"
              className="glass-card p-8 rounded-3xl border-l-4 border-l-primary relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <CheckCircle className="w-48 h-48" />
              </div>

              <div className="relative z-10">
                <h2 className="text-sm font-medium text-primary uppercase tracking-widest mb-2">Current Step</h2>
                <h3 className="text-3xl font-bold mb-6 leading-tight">
                  {/* Mock stage names based on ID - in real app comes from API */}
                  {batch.currentStageId === 1 ? "Verify Milk Volume" :
                   batch.currentStageId === 2 ? "Calculate Ingredients" :
                   batch.currentStageId === 3 ? "Heat Milk" :
                   batch.currentStageId === 4 ? "Add Ferments (LR & DX)" :
                   batch.currentStageId === 13 ? "Measure Initial pH" :
                   `Production Stage ${batch.currentStageId}`}
                </h3>

                {/* Dynamic Content Based on Stage Type */}
                <div className="bg-background/50 backdrop-blur rounded-xl p-6 border border-white/5 mb-8">
                  
                  {isTimerStage ? (
                    // Timer View
                    <div className="space-y-4">
                      {batch.activeTimers.map((timer: any, i: number) => (
                        <TimerWidget 
                          key={i} 
                          durationMinutes={timer.duration} 
                          startTime={timer.startTime} 
                          label="Fermentation Phase" 
                        />
                      ))}
                    </div>
                  ) : isInputStage ? (
                    // Input Form View
                    <form onSubmit={handleInputLog} className="max-w-md">
                       <label className="block text-sm font-medium mb-2">{inputLabel}</label>
                       <div className="flex gap-4">
                         <Input 
                           value={inputVal} 
                           onChange={(e) => setInputVal(e.target.value)}
                           type={inputType === 'ph' ? 'number' : 'time'}
                           step={inputType === 'ph' ? '0.1' : undefined}
                           className="text-lg h-12"
                           placeholder="Enter value..."
                           autoFocus
                         />
                         <Button type="submit" size="lg" disabled={isLogging}>
                           Log & Next
                         </Button>
                       </div>
                    </form>
                  ) : (
                    // Generic Instruction View
                    <div className="space-y-4 text-lg">
                      <p>Follow the standard operating procedure for this step.</p>
                      {batch.calculatedInputs && <IngredientList inputs={batch.calculatedInputs as any} />}
                      
                      <div className="flex items-center gap-3 text-amber-400 bg-amber-400/10 p-4 rounded-lg mt-4 text-base border border-amber-400/20">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <p>Ensure all tools are sanitized before proceeding.</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Primary Action Button */}
                {!isInputStage && (
                  <Button 
                    size="lg" 
                    className="w-full h-16 text-lg font-bold premium-gradient shadow-lg"
                    onClick={handleAdvance}
                    disabled={isAdvancing || (isTimerStage && !/* check timer done logic */ true)}
                  >
                    {isAdvancing ? "Processing..." : "Mark Step Complete"} 
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                )}
              </div>
            </motion.div>

            {/* Ingredients Summary (if applicable) */}
            {batch.currentStageId >= 2 && batch.calculatedInputs && (
               <div className="glass-card p-6 rounded-2xl">
                 <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                   <Scale className="w-5 h-5 text-primary" />
                   Batch Recipe
                 </h3>
                 <IngredientList inputs={batch.calculatedInputs as any} />
               </div>
            )}
          </div>

          {/* RIGHT: Sidebar Info */}
          <div className="space-y-6">
            
            {/* Measurements Log */}
            <div className="bg-card border border-border rounded-2xl p-6">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <Thermometer className="w-5 h-5 text-primary" />
                Measurement Log
              </h3>
              
              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                {/* Mock log data - in real app use batchLogs */}
                <div className="flex justify-between items-center py-2 border-b border-border/50 text-sm">
                  <span className="text-muted-foreground">Started</span>
                  <span className="font-mono">{new Date(batch.startedAt).toLocaleTimeString()}</span>
                </div>
                {Object.entries(batch.measurements as Record<string, any> || {}).map(([key, val]) => (
                  <div key={key} className="flex justify-between items-center py-2 border-b border-border/50 text-sm">
                    <span className="capitalize text-muted-foreground">{key}</span>
                    <span className="font-mono font-bold">{val}</span>
                  </div>
                ))}
                {(!batch.measurements || Object.keys(batch.measurements as object).length === 0) && (
                   <div className="text-center text-muted-foreground py-4 text-sm italic">
                     No measurements yet.
                   </div>
                )}
              </div>
            </div>

            {/* Help Card */}
            <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6">
              <h3 className="font-bold mb-2 text-primary">Need Help?</h3>
              <p className="text-sm text-muted-foreground mb-4">
                The Nete Assistant is active. Use the chat bubble for questions about recipe adjustments or timing.
              </p>
            </div>
          </div>
        </div>
      </main>

      <ChatAssistant context={`Batch #${batch.id}, Stage ${batch.currentStageId}`} />
    </div>
  );
}
