import { useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Save, Trash2, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

function StageCard({ stage }: { stage: any }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-accent/30 transition-colors text-left"
        data-testid={`button-stage-${stage.id}`}
      >
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
            {stage.id}
          </span>
          <span className="font-medium">{stage.name}</span>
          <Badge variant="outline" className="text-xs capitalize">{stage.type}</Badge>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 py-3 bg-secondary/20 border-t border-border">
          {stage.instructions?.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Instruções</div>
              <ul className="text-sm space-y-1">
                {stage.instructions.map((ins: string, i: number) => (
                  <li key={i} className="text-foreground/80">• {ins}</li>
                ))}
              </ul>
            </div>
          )}
          {stage.timer && (
            <div className="text-xs text-muted-foreground mt-2">
              Timer: {stage.timer.duration_min ? `${stage.timer.duration_min} min` : stage.timer.duration_hours ? `${stage.timer.duration_hours}h` : "—"}
              {stage.timer.blocking ? " (bloqueante)" : " (não-bloqueante)"}
            </div>
          )}
          {stage.operator_input_required?.length > 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              Entradas: {stage.operator_input_required.join(", ")}
            </div>
          )}
          {stage.llm_guidance && (
            <div className="mt-2 p-2 bg-primary/5 rounded-lg border border-primary/10">
              <div className="text-xs font-medium text-primary mb-1">Orientação LLM</div>
              <div className="text-xs text-muted-foreground">{stage.llm_guidance}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RecipeEditor() {
  const { recipeId } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: recipe, isLoading } = useQuery<any>({
    queryKey: ["/api/recipes", recipeId],
    queryFn: async () => {
      const res = await fetch(`/api/recipes/${recipeId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Receita não encontrada");
      return res.json();
    },
    enabled: !!recipeId,
  });

  const [form, setForm] = useState<Record<string, string>>({});
  const isDirty = Object.keys(form).length > 0;

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("PUT", `/api/recipes/${recipeId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes", recipeId] });
      setForm({});
      toast({ title: "Receita atualizada com sucesso!" });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/recipes/${recipeId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      toast({ title: "Receita excluída" });
      setLocation("/recipes");
    },
    onError: (err: any) => {
      toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    updateMutation.mutate(form);
  };

  const handleDelete = () => {
    if (!confirm("Tem certeza que deseja excluir esta receita? Esta ação não pode ser desfeita.")) return;
    deleteMutation.mutate();
  };

  const field = (key: string) => (key in form ? form[key] : (recipe?.[key] ?? ""));
  const setField = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }));

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container mx-auto px-4 py-8 max-w-3xl">
          <Skeleton className="h-8 w-48 mb-8" />
          <div className="space-y-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        </main>
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container mx-auto px-4 py-8 max-w-3xl text-center py-20">
          <p className="text-muted-foreground">Receita não encontrada.</p>
          <Link href="/recipes"><Button className="mt-4">Voltar às Receitas</Button></Link>
        </main>
      </div>
    );
  }

  const stages: any[] = recipe.stages || [];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <Link href="/recipes">
          <Button variant="ghost" className="mb-8 pl-0 hover:pl-2 transition-all">
            <ArrowLeft className="mr-2 w-4 h-4" /> Receitas
          </Button>
        </Link>

        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-display font-bold">{recipe.name}</h1>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline">{recipe.recipeId}</Badge>
              {recipe.family && <Badge variant="secondary">{recipe.family}</Badge>}
            </div>
          </div>
          <div className="flex gap-2">
            {isDirty && (
              <Button onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save-recipe">
                <Save className="w-4 h-4 mr-2" />
                {updateMutation.isPending ? "Salvando..." : "Salvar"}
              </Button>
            )}
            <Button variant="destructive" size="icon" onClick={handleDelete} disabled={deleteMutation.isPending} data-testid="button-delete-recipe">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-card p-6 rounded-2xl border border-white/10">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-4">Informações Gerais</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1">
                <label className="text-xs text-muted-foreground">Nome</label>
                <Input
                  value={field("name")}
                  onChange={e => setField("name", e.target.value)}
                  data-testid="input-recipe-name"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <label className="text-xs text-muted-foreground">Descrição</label>
                <Input
                  value={field("description")}
                  onChange={e => setField("description", e.target.value)}
                  data-testid="input-recipe-description"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Família</label>
                <Input
                  value={field("family")}
                  onChange={e => setField("family", e.target.value)}
                  data-testid="input-recipe-family"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Versão do Schema</label>
                <Input
                  value={field("schemaVersion")}
                  onChange={e => setField("schemaVersion", e.target.value)}
                  data-testid="input-recipe-schema-version"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Volume Mín (L)</label>
                <Input
                  type="number"
                  value={field("batchMinL")}
                  onChange={e => setField("batchMinL", e.target.value)}
                  data-testid="input-recipe-batch-min"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Volume Máx (L)</label>
                <Input
                  type="number"
                  value={field("batchMaxL")}
                  onChange={e => setField("batchMaxL", e.target.value)}
                  data-testid="input-recipe-batch-max"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Temperatura Alvo (°C)</label>
                <Input
                  type="number"
                  step="0.1"
                  value={field("targetTemperatureC")}
                  onChange={e => setField("targetTemperatureC", e.target.value)}
                  data-testid="input-recipe-target-temp"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">pH Final Alvo</label>
                <Input
                  type="number"
                  step="0.01"
                  value={field("targetFinalPh")}
                  onChange={e => setField("targetFinalPh", e.target.value)}
                  data-testid="input-recipe-target-ph"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Dias de Maturação</label>
                <Input
                  type="number"
                  value={field("maturationTargetDays")}
                  onChange={e => setField("maturationTargetDays", e.target.value)}
                  data-testid="input-recipe-maturation-days"
                />
              </div>
            </div>
          </div>

          {stages.length > 0 && (
            <div className="glass-card p-6 rounded-2xl border border-white/10">
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-4">
                Etapas da Receita ({stages.length})
              </h2>
              <div className="flex items-center gap-2 mb-4 text-xs text-amber-500/80 bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>As etapas são gerenciadas via YAML. Edição direta disponível em versão futura.</span>
              </div>
              <div className="space-y-2">
                {stages.map((stage: any) => (
                  <StageCard key={stage.id} stage={stage} />
                ))}
              </div>
            </div>
          )}

          {isDirty && (
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setForm({})} data-testid="button-cancel-recipe">
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save-recipe-bottom">
                <Save className="w-4 h-4 mr-2" />
                {updateMutation.isPending ? "Salvando..." : "Salvar Alterações"}
              </Button>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
