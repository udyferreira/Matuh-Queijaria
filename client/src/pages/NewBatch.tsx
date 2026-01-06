import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Beaker, AlertTriangle } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStartBatch } from "@/hooks/use-batches";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

export default function NewBatch() {
  const [milkVolume, setMilkVolume] = useState<string>("50");
  const { mutate, isPending } = useStartBatch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const volume = parseFloat(milkVolume);
    
    if (isNaN(volume) || volume < 10 || volume > 200) {
      toast({
        title: "Volume Inválido",
        description: "O volume de leite deve estar entre 10L e 200L.",
        variant: "destructive",
      });
      return;
    }

    mutate({ milkVolumeL: volume }, {
      onSuccess: (batch) => {
        toast({ title: "Lote Criado", description: `Lote #${batch.id} iniciado com sucesso.` });
        setLocation(`/batch/${batch.id}`);
      },
      onError: (err) => {
        toast({ title: "Erro", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Link href="/">
          <Button variant="ghost" className="mb-8 pl-0 hover:pl-2 transition-all">
            <ArrowLeft className="mr-2 w-4 h-4" /> Voltar ao Painel
          </Button>
        </Link>

        <div className="glass-card p-8 rounded-3xl border border-white/10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

          <div className="relative z-10">
            <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mb-6 text-primary">
              <Beaker className="w-8 h-8" />
            </div>

            <h1 className="text-3xl font-display font-bold mb-2">Novo Lote de Produção</h1>
            <p className="text-muted-foreground mb-8">
              Inicie uma nova produção da "Matuh Queijaria". O sistema calculará automaticamente as 
              proporções de fermentos e coalho com base no volume de leite.
            </p>

            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="space-y-4">
                <label className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                  Volume de Leite (Litros)
                </label>
                <div className="relative">
                  <Input 
                    type="number" 
                    min="10" 
                    max="200"
                    step="0.1"
                    value={milkVolume}
                    onChange={(e) => setMilkVolume(e.target.value)}
                    className="h-20 text-4xl font-display font-bold px-6 bg-secondary/50 border-secondary focus:border-primary/50 transition-all"
                    data-testid="input-milk-volume"
                  />
                  <span className="absolute right-6 top-1/2 -translate-y-1/2 text-muted-foreground text-xl font-medium">
                    L
                  </span>
                </div>
                <div className="flex items-center gap-2 text-amber-500/80 text-sm bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <p>Mín: 10L • Máx: 200L</p>
                </div>
              </div>

              <div className="pt-4 border-t border-white/5">
                <Button 
                  type="submit" 
                  size="lg" 
                  className="w-full h-16 text-lg font-bold premium-gradient"
                  disabled={isPending}
                  data-testid="button-start-production"
                >
                  {isPending ? "Inicializando..." : "Iniciar Produção"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
