import { Link } from "wouter";
import { Plus, ArrowRight, Activity, Clock, CheckCircle } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { useBatches } from "@/hooks/use-batches";
import { ChatAssistant } from "@/components/widgets/ChatAssistant";
import { getCheeseTypeName, formatBatchCode } from "@shared/schema";

export default function Home() {
  const { data: batches, isLoading } = useBatches();

  return (
    <div className="min-h-screen bg-background pb-20">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div>
            <h1 className="text-4xl md:text-5xl font-display font-bold mb-2">
              Painel de <span className="text-primary text-glow">Produção</span>
            </h1>
            <p className="text-muted-foreground text-lg max-w-2xl">
              Acompanhe os lotes ativos, monitore as etapas de fermentação e garanta o controle de qualidade.
            </p>
          </div>
          
          <Link href="/new">
            <Button size="lg" className="premium-gradient border border-white/10 shadow-xl group text-amber-400">
              <Plus className="mr-2 w-5 h-5 group-hover:rotate-90 transition-transform" />
              Novo Lote
            </Button>
          </Link>
        </header>

        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-64 rounded-2xl bg-secondary/30 animate-pulse" />
            ))}
          </div>
        ) : batches?.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-border rounded-3xl bg-secondary/5">
            <div className="w-20 h-20 bg-secondary/50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Activity className="w-10 h-10 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-bold mb-2">Nenhum Lote Ativo</h3>
            <p className="text-muted-foreground mb-8">Inicie uma nova produção para começar o acompanhamento.</p>
            <Link href="/new">
              <Button>Iniciar Primeiro Lote</Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {batches?.map((batch) => (
              <Link key={batch.id} href={`/batch/${batch.id}`} className="group">
                <div className="h-full glass-card p-6 rounded-2xl hover:border-primary/50 transition-all duration-300 hover:-translate-y-1 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Activity className="w-24 h-24 rotate-12" />
                  </div>

                  <div className="relative z-10">
                    <div className="flex justify-between items-start mb-4">
                      <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border border-primary/20">
                        {batch.status === 'active' ? 'Ativo' : batch.status === 'completed' ? 'Concluído' : 'Pausado'}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {formatBatchCode(batch.startedAt)}
                      </span>
                    </div>

                    <h3 className="text-2xl font-bold mb-1">Queijo {getCheeseTypeName(batch.recipeId)}</h3>
                    <div className="text-sm text-muted-foreground mb-6">
                      Vol: <span className="text-foreground font-medium">{batch.milkVolumeL}L</span> • Iniciado em {new Date(batch.startedAt).toLocaleDateString('pt-BR')}
                    </div>

                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-muted-foreground">Progresso</span>
                          <span className="font-medium">{Math.round((batch.currentStageId / 20) * 100)}%</span>
                        </div>
                        <div className="h-2 bg-secondary rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary transition-all duration-500" 
                            style={{ width: `${(batch.currentStageId / 20) * 100}%` }} 
                          />
                        </div>
                      </div>

                      <div className="pt-4 border-t border-white/5 flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground group-hover:text-primary transition-colors">
                          <Clock className="w-4 h-4" />
                          <span>Atualizado agora</span>
                        </div>
                        <ArrowRight className="w-4 h-4 -translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all text-primary" />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <ChatAssistant />
    </div>
  );
}
