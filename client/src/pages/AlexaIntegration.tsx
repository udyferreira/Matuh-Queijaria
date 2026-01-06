import { Navbar } from "@/components/layout/Navbar";
import { Mic, Check, Wifi, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AlexaIntegration() {
  const webhookUrl = `${window.location.origin}/api/alexa/webhook`;

  return (
    <div className="min-h-screen bg-background pb-20">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="text-center mb-12">
          <div className="w-20 h-20 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-6 text-blue-400">
            <Mic className="w-10 h-10" />
          </div>
          <h1 className="text-4xl font-display font-bold mb-4">Controle por Voz</h1>
          <p className="text-xl text-muted-foreground">
            Conecte a Alexa para controlar a produção com as mãos livres.
          </p>
        </div>

        <div className="grid gap-8">
          <div className="glass-card p-8 rounded-2xl border border-white/10">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Wifi className="w-5 h-5 text-primary" />
              Detalhes de Conexão
            </h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2 text-muted-foreground">URL do Webhook</label>
                <div className="flex gap-2">
                  <Input readOnly value={webhookUrl} className="font-mono bg-secondary/50" data-testid="input-webhook-url" />
                  <Button variant="outline" onClick={() => navigator.clipboard.writeText(webhookUrl)} data-testid="button-copy-url">
                    Copiar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Cole esta URL no console de configuração da sua Alexa Skill.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-muted-foreground">Token de Acesso</label>
                <div className="flex gap-2">
                   <div className="relative flex-1">
                      <Input readOnly value="sk_production_88291..." type="password" className="font-mono bg-secondary/50 pr-10" />
                      <Key className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                   </div>
                   <Button variant="outline">Regenerar</Button>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h3 className="font-bold text-lg">Comandos Suportados</h3>
            
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-primary mb-3">Iniciar e Gerenciar Lote</h4>
                <div className="grid md:grid-cols-2 gap-3">
                  {[
                    { cmd: 'Alexa, diga ao Nete para iniciar lote com 50 litros', desc: 'Inicia novo lote' },
                    { cmd: 'Alexa, pergunte ao Nete o status', desc: 'Status do lote ativo' },
                    { cmd: 'Alexa, diga ao Nete para pausar', desc: 'Pausa a produção' },
                    { cmd: 'Alexa, diga ao Nete para retomar', desc: 'Retoma produção pausada' },
                  ].map((item, i) => (
                    <div key={i} className="bg-secondary/30 p-3 rounded-xl border border-white/5">
                      <div className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium italic text-muted-foreground text-sm">"{item.cmd}"</p>
                          <p className="text-xs text-muted-foreground/70 mt-1">{item.desc}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-primary mb-3">Navegação de Etapas</h4>
                <div className="grid md:grid-cols-2 gap-3">
                  {[
                    { cmd: 'Alexa, pergunte ao Nete qual é a próxima etapa', desc: 'Ouvir instruções da etapa atual' },
                    { cmd: 'Alexa, diga ao Nete para avançar', desc: 'Avança para próxima etapa' },
                    { cmd: 'Alexa, pergunte ao Nete para repetir', desc: 'Repete instruções da etapa' },
                    { cmd: 'Alexa, pergunte ao Nete quanto tempo falta', desc: 'Tempo restante do timer' },
                  ].map((item, i) => (
                    <div key={i} className="bg-secondary/30 p-3 rounded-xl border border-white/5">
                      <div className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium italic text-muted-foreground text-sm">"{item.cmd}"</p>
                          <p className="text-xs text-muted-foreground/70 mt-1">{item.desc}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-primary mb-3">Registrar Medições</h4>
                <div className="grid md:grid-cols-2 gap-3">
                  {[
                    { cmd: 'Alexa, diga ao Nete que o pH é 5.2', desc: 'Registra valor de pH' },
                    { cmd: 'Alexa, diga ao Nete que floculou às 10:30', desc: 'Registra horário de floculação' },
                    { cmd: 'Alexa, diga ao Nete que cortou às 11:15', desc: 'Registra horário de corte' },
                    { cmd: 'Alexa, diga ao Nete que prensou às 14:00', desc: 'Registra início da prensa' },
                  ].map((item, i) => (
                    <div key={i} className="bg-secondary/30 p-3 rounded-xl border border-white/5">
                      <div className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium italic text-muted-foreground text-sm">"{item.cmd}"</p>
                          <p className="text-xs text-muted-foreground/70 mt-1">{item.desc}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-primary mb-3">Ajuda</h4>
                <div className="grid md:grid-cols-2 gap-3">
                  {[
                    { cmd: 'Alexa, pergunte ao Nete ajuda', desc: 'Lista comandos disponíveis' },
                  ].map((item, i) => (
                    <div key={i} className="bg-secondary/30 p-3 rounded-xl border border-white/5">
                      <div className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium italic text-muted-foreground text-sm">"{item.cmd}"</p>
                          <p className="text-xs text-muted-foreground/70 mt-1">{item.desc}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
