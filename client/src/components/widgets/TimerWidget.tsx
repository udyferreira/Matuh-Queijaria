import { useState, useEffect } from "react";
import { Clock, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";

interface TimerWidgetProps {
  durationMinutes: number;
  startTime: string;
  label: string;
}

export function TimerWidget({ durationMinutes, startTime, label }: TimerWidgetProps) {
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = new Date(startTime).getTime();
    const end = start + durationMinutes * 60 * 1000;

    const interval = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, end - now);
      const total = durationMinutes * 60 * 1000;
      
      setTimeLeft(remaining);
      setProgress(((total - remaining) / total) * 100);

      if (remaining <= 0) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, durationMinutes]);

  const totalMinutes = Math.floor(timeLeft / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = Math.floor((timeLeft % 60000) / 1000);

  const isComplete = timeLeft === 0;
  const showHours = durationMinutes >= 60;

  const formatTime = () => {
    if (showHours) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(totalMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  return (
    <div className="relative overflow-hidden rounded-2xl bg-card border border-border p-6 shadow-xl shadow-black/20">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{label}</h3>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-4xl font-display font-bold tabular-nums">
              {formatTime()}
            </span>
            <span className="text-sm text-muted-foreground">restantes</span>
          </div>
        </div>
        <div className={`p-3 rounded-full ${isComplete ? 'bg-green-500/20 text-green-500' : 'bg-primary/20 text-primary'}`}>
          {isComplete ? <AlertCircle className="w-6 h-6 animate-pulse" /> : <Clock className="w-6 h-6 animate-spin-slow" />}
        </div>
      </div>

      <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
        <motion.div 
          className={`h-full ${isComplete ? 'bg-green-500' : 'bg-primary'}`}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 1, ease: "linear" }}
        />
      </div>
      
      {isComplete && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm font-medium flex items-center justify-center gap-2"
        >
          <AlertCircle className="w-4 h-4" />
          Timer concluído! Prossiga para a próxima etapa.
        </motion.div>
      )}
    </div>
  );
}
