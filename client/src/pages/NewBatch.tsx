import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Beaker, AlertTriangle, Lock } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStartBatch } from "@/hooks/use-batches";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { getAllCheeseTypes, type CheeseType } from "@shared/schema";

const cheeseTypes = getAllCheeseTypes();

export default function NewBatch() {
  const [milkVolume, setMilkVolume] = useState<string>("50");
  const [milkTemperature, setMilkTemperature] = useState<string>("");
  const [milkPh, setMilkPh] = useState<string>("");
  const [selectedCheese, setSelectedCheese] = useState<string>("QUEIJO_NETE");
  const { mutate, isPending } = useStartBatch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const volume = parseFloat(milkVolume);
    const temperature = parseFloat(milkTemperature);
    const ph = parseFloat(milkPh);
    
    if (isNaN(volume) || volume < 10 || volume > 200) {
      toast({
        title: "Volume Inválido",
        description: "O volume de leite deve estar entre 10L e 200L.",
        variant: "destructive",
      });
      return;
    }

    if (!milkTemperature || isNaN(temperature) || temperature < 0 || temperature > 50) {
      toast({
        title: "Temperatura Inválida",
        description: "A temperatura é obrigatória e deve estar entre 0°C e 50°C.",
        variant: "destructive",
      });
      return;
    }

    if (!milkPh || isNaN(ph) || ph < 0 || ph > 14) {
      toast({
        title: "pH Inválido",
        description: "O pH é obrigatório e deve estar entre 0 e 14.",
        variant: "destructive",
      });
      return;
    }

    mutate({ 
      milkVolumeL: volume, 
      milkTemperatureC: temperature,
      milkPh: ph,
      recipeId: selectedCheese 
    }, {
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
                  Tipo de Queijo
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {cheeseTypes.map((cheese) => (
                    <button
                      key={cheese.id}
                      type="button"
                      disabled={!cheese.available}
                      onClick={() => cheese.available && setSelectedCheese(cheese.id)}
                      className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                        selectedCheese === cheese.id
                          ? "border-primary bg-primary/10"
                          : cheese.available
                          ? "border-border hover:border-primary/50"
                          : "border-border/50 opacity-50 cursor-not-allowed"
                      }`}
                      data-testid={`button-cheese-${cheese.id}`}
                    >
                      {!cheese.available && (
                        <div className="absolute top-2 right-2">
                          <Lock className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="font-bold text-lg">{cheese.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {cheese.available ? cheese.description : "Em breve"}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

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
                  <p>Mín: 10L - Máx: 200L</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                    Temperatura do Leite (°C)
                  </label>
                  <div className="relative">
                    <Input 
                      type="number" 
                      min="0" 
                      max="50"
                      step="0.1"
                      value={milkTemperature}
                      onChange={(e) => setMilkTemperature(e.target.value)}
                      placeholder="Ex: 32"
                      className="h-14 text-2xl font-display font-bold px-4 bg-secondary/50 border-secondary focus:border-primary/50 transition-all"
                      data-testid="input-milk-temperature"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground text-lg font-medium">
                      °C
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                    pH do Leite
                  </label>
                  <div className="relative">
                    <Input 
                      type="number" 
                      min="0" 
                      max="14"
                      step="0.01"
                      value={milkPh}
                      onChange={(e) => setMilkPh(e.target.value)}
                      placeholder="Ex: 6.7"
                      className="h-14 text-2xl font-display font-bold px-4 bg-secondary/50 border-secondary focus:border-primary/50 transition-all"
                      data-testid="input-milk-ph"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground text-lg font-medium">
                      pH
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/5">
                <Button 
                  type="submit" 
                  size="lg" 
                  className="w-full h-16 text-lg font-bold premium-gradient text-amber-400"
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
