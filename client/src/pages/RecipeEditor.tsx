import { useState, useEffect } from "react";
import { Link, useParams, useLocation } from "wouter";
import { ArrowLeft, Save, Trash2, AlertTriangle, Plus, Minus, ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

type Stage = {
  id: number;
  name: string;
  type: string;
  instructions?: string[];
  timer?: {
    duration_min?: number;
    duration_hours?: number;
    blocking?: boolean;
    interval_hours?: number;
  } | null;
  operator_input_required?: string[];
  stored_values?: string[];
  llm_guidance?: string;
  input_prompt?: string;
  max_loop_duration_hours?: number;
  [key: string]: any;
};

function MetaForm({ values, onChange }: { values: Record<string, string>; onChange: (k: string, v: string) => void }) {
  const f = (k: string) => values[k] ?? "";
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2 space-y-1">
        <label className="text-xs text-muted-foreground">Recipe ID *</label>
        <Input value={f("recipeId")} onChange={e => onChange("recipeId", e.target.value)} placeholder="QUEIJO_NETE" data-testid="input-recipe-id" />
      </div>
      <div className="col-span-2 space-y-1">
        <label className="text-xs text-muted-foreground">Nome *</label>
        <Input value={f("name")} onChange={e => onChange("name", e.target.value)} placeholder="Nete" data-testid="input-recipe-name" />
      </div>
      <div className="col-span-2 space-y-1">
        <label className="text-xs text-muted-foreground">Descrição</label>
        <Input value={f("description")} onChange={e => onChange("description", e.target.value)} data-testid="input-recipe-description" />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Família</label>
        <Input value={f("family")} onChange={e => onChange("family", e.target.value)} data-testid="input-recipe-family" />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Versão do Schema</label>
        <Input value={f("schemaVersion")} onChange={e => onChange("schemaVersion", e.target.value)} defaultValue="1.0" data-testid="input-recipe-schema-version" />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Volume Mín (L)</label>
        <Input type="number" value={f("batchMinL")} onChange={e => onChange("batchMinL", e.target.value)} data-testid="input-recipe-batch-min" />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Volume Máx (L)</label>
        <Input type="number" value={f("batchMaxL")} onChange={e => onChange("batchMaxL", e.target.value)} data-testid="input-recipe-batch-max" />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Temperatura Alvo (°C)</label>
        <Input type="number" step="0.1" value={f("targetTemperatureC")} onChange={e => onChange("targetTemperatureC", e.target.value)} data-testid="input-recipe-target-temp" />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">pH Final Alvo</label>
        <Input type="number" step="0.01" value={f("targetFinalPh")} onChange={e => onChange("targetFinalPh", e.target.value)} data-testid="input-recipe-target-ph" />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Dias de Maturação</label>
        <Input type="number" value={f("maturationTargetDays")} onChange={e => onChange("maturationTargetDays", e.target.value)} data-testid="input-recipe-maturation-days" />
      </div>
    </div>
  );
}

function StageRow({ stage, index, total, onMove, onChange, onRemove }: {
  stage: Stage;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onChange: (index: number, updated: Stage) => void;
  onRemove: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);

  const setField = (key: string, value: any) => {
    onChange(index, { ...stage, [key]: value });
  };

  const setTimerField = (key: string, value: any) => {
    onChange(index, { ...stage, timer: { ...(stage.timer || {}), [key]: value } });
  };

  const setArrayField = (key: string, raw: string) => {
    const arr = raw.split("\n").map(s => s.trim()).filter(Boolean);
    onChange(index, { ...stage, [key]: arr });
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center bg-card hover:bg-accent/20 transition-colors px-3 py-2">
        <div className="flex flex-col gap-0.5 mr-2">
          <button
            type="button"
            onClick={() => onMove(index, index - 1)}
            disabled={index === 0}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            data-testid={`button-stage-up-${index}`}
          ><ChevronUp className="w-3 h-3" /></button>
          <button
            type="button"
            onClick={() => onMove(index, index + 1)}
            disabled={index === total - 1}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            data-testid={`button-stage-down-${index}`}
          ><ChevronDown className="w-3 h-3" /></button>
        </div>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex-1 flex items-center gap-3 text-left"
          data-testid={`button-stage-expand-${index}`}
        >
          <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
            {stage.id}
          </span>
          <span className="font-medium flex-1">{stage.name || "Nova Etapa"}</span>
          <Badge variant="outline" className="text-xs capitalize mr-2">{stage.type || "action"}</Badge>
        </button>

        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-destructive hover:text-destructive/70 ml-2 p-1"
          data-testid={`button-stage-remove-${index}`}
        ><Minus className="w-4 h-4" /></button>
      </div>

      {open && (
        <div className="px-4 py-3 bg-secondary/10 border-t border-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">ID</label>
              <Input type="number" value={stage.id} onChange={e => setField("id", Number(e.target.value))}
                data-testid={`input-stage-id-${index}`} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Nome</label>
              <Input value={stage.name || ""} onChange={e => setField("name", e.target.value)}
                data-testid={`input-stage-name-${index}`} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Tipo</label>
              <select
                value={stage.type || "action"}
                onChange={e => setField("type", e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                data-testid={`select-stage-type-${index}`}
              >
                <option value="action">action</option>
                <option value="wait">wait</option>
                <option value="measure">measure</option>
                <option value="loop">loop</option>
                <option value="input">input</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Max loop (horas)</label>
              <Input type="number" step="0.5"
                value={stage.max_loop_duration_hours ?? ""}
                onChange={e => setField("max_loop_duration_hours", e.target.value ? Number(e.target.value) : undefined)}
                data-testid={`input-stage-loop-${index}`} />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Instruções (uma por linha)</label>
            <Textarea
              rows={3}
              value={(stage.instructions || []).join("\n")}
              onChange={e => setArrayField("instructions", e.target.value)}
              data-testid={`textarea-stage-instructions-${index}`}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Timer (min)</label>
              <Input type="number"
                value={stage.timer?.duration_min ?? ""}
                onChange={e => setTimerField("duration_min", e.target.value ? Number(e.target.value) : undefined)}
                data-testid={`input-stage-timer-min-${index}`} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Timer (horas)</label>
              <Input type="number" step="0.5"
                value={stage.timer?.duration_hours ?? ""}
                onChange={e => setTimerField("duration_hours", e.target.value ? Number(e.target.value) : undefined)}
                data-testid={`input-stage-timer-hours-${index}`} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Intervalo (horas)</label>
              <Input type="number" step="0.5"
                value={stage.timer?.interval_hours ?? ""}
                onChange={e => setTimerField("interval_hours", e.target.value ? Number(e.target.value) : undefined)}
                data-testid={`input-stage-timer-interval-${index}`} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`blocking-${index}`}
              checked={stage.timer?.blocking ?? false}
              onChange={e => setTimerField("blocking", e.target.checked)}
              data-testid={`checkbox-stage-blocking-${index}`}
            />
            <label htmlFor={`blocking-${index}`} className="text-xs text-muted-foreground">Timer bloqueante</label>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Entradas obrigatórias (uma por linha)</label>
            <Textarea
              rows={2}
              value={(stage.operator_input_required || []).join("\n")}
              onChange={e => setArrayField("operator_input_required", e.target.value)}
              data-testid={`textarea-stage-inputs-${index}`}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Valores armazenados (stored_values, um por linha)</label>
            <Textarea
              rows={2}
              value={(stage.stored_values || []).join("\n")}
              onChange={e => setArrayField("stored_values", e.target.value)}
              data-testid={`textarea-stage-stored-${index}`}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Prompt de entrada (input_prompt)</label>
            <Input
              value={stage.input_prompt || ""}
              onChange={e => setField("input_prompt", e.target.value)}
              data-testid={`input-stage-input-prompt-${index}`}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Orientação LLM (llm_guidance)</label>
            <Textarea
              rows={2}
              value={stage.llm_guidance || ""}
              onChange={e => setField("llm_guidance", e.target.value)}
              data-testid={`textarea-stage-llm-guidance-${index}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function emptyStage(id: number): Stage {
  return { id, name: "", type: "action", instructions: [], operator_input_required: [], stored_values: [] };
}

export default function RecipeEditor() {
  const { recipeId } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isNew = recipeId === "new";

  const { data: recipe, isLoading } = useQuery<any>({
    queryKey: ["/api/recipes", recipeId],
    queryFn: async () => {
      const res = await fetch(`/api/recipes/${recipeId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Receita não encontrada");
      return res.json();
    },
    enabled: !!recipeId && !isNew,
  });

  const [meta, setMeta] = useState<Record<string, string>>({});
  const [stages, setStages] = useState<Stage[]>([]);
  const [stagesInitialized, setStagesInitialized] = useState(false);

  // Reset state when navigating between recipes
  useEffect(() => {
    setMeta({});
    setStages([]);
    setStagesInitialized(false);
  }, [recipeId]);

  useEffect(() => {
    if (recipe && !stagesInitialized) {
      setStages(recipe.stages || []);
      setStagesInitialized(true);
    }
  }, [recipe, stagesInitialized]);

  const setMetaField = (k: string, v: string) => setMeta(f => ({ ...f, [k]: v }));

  const metaValues: Record<string, string> = recipe
    ? {
        recipeId: recipe.recipeId,
        name: recipe.name,
        description: recipe.description || "",
        family: recipe.family || "",
        schemaVersion: recipe.schemaVersion || "1.0",
        batchMinL: recipe.batchMinL ?? "",
        batchMaxL: recipe.batchMaxL ?? "",
        targetTemperatureC: recipe.targetTemperatureC ?? "",
        targetFinalPh: recipe.targetFinalPh ?? "",
        maturationTargetDays: recipe.maturationTargetDays != null ? String(recipe.maturationTargetDays) : "",
        ...meta,
      }
    : meta;

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", "/api/recipes", data);
      return res.json();
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      toast({ title: "Receita criada com sucesso!" });
      setLocation(`/recipes/${created.recipeId}`);
    },
    onError: (err: any) => {
      toast({ title: "Erro ao criar receita", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("PUT", `/api/recipes/${recipeId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes", recipeId] });
      setMeta({});
      setStagesInitialized(false);
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

  const buildPayload = () => {
    const cleanStages = stages.map(s => {
      const clean: any = { ...s };
      if (clean.timer) {
        const t: any = {};
        if (clean.timer.duration_min != null && clean.timer.duration_min !== "") t.duration_min = Number(clean.timer.duration_min);
        if (clean.timer.duration_hours != null && clean.timer.duration_hours !== "") t.duration_hours = Number(clean.timer.duration_hours);
        if (clean.timer.interval_hours != null && clean.timer.interval_hours !== "") t.interval_hours = Number(clean.timer.interval_hours);
        if (clean.timer.blocking != null) t.blocking = clean.timer.blocking;
        clean.timer = Object.keys(t).length > 0 ? t : null;
      }
      if (clean.max_loop_duration_hours === "" || clean.max_loop_duration_hours === undefined) delete clean.max_loop_duration_hours;
      return clean;
    });

    const payload: Record<string, any> = {
      ...metaValues,
      stages: cleanStages,
    };
    if (metaValues.batchMinL) payload.batchMinL = metaValues.batchMinL;
    if (metaValues.batchMaxL) payload.batchMaxL = metaValues.batchMaxL;
    if (metaValues.targetTemperatureC) payload.targetTemperatureC = metaValues.targetTemperatureC;
    if (metaValues.targetFinalPh) payload.targetFinalPh = metaValues.targetFinalPh;
    if (metaValues.maturationTargetDays) payload.maturationTargetDays = Number(metaValues.maturationTargetDays);
    return payload;
  };

  const handleSave = () => {
    if (isNew) {
      if (!metaValues.recipeId || !metaValues.name) {
        toast({ title: "Recipe ID e Nome são obrigatórios", variant: "destructive" });
        return;
      }
      createMutation.mutate(buildPayload());
    } else {
      updateMutation.mutate({ ...meta, stages });
    }
  };

  const handleDelete = () => {
    if (!confirm("Excluir esta receita? Esta ação não pode ser desfeita.")) return;
    deleteMutation.mutate();
  };

  const moveStage = (from: number, to: number) => {
    if (to < 0 || to >= stages.length) return;
    const arr = [...stages];
    [arr[from], arr[to]] = [arr[to], arr[from]];
    setStages(arr);
  };

  const addStage = () => {
    const nextId = stages.length > 0 ? Math.max(...stages.map(s => s.id)) + 1 : 1;
    setStages([...stages, emptyStage(nextId)]);
  };

  const removeStage = (index: number) => {
    setStages(stages.filter((_, i) => i !== index));
  };

  const updateStage = (index: number, updated: Stage) => {
    const arr = [...stages];
    arr[index] = updated;
    setStages(arr);
  };

  if (!isNew && isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container mx-auto px-4 py-8 max-w-3xl">
          <Skeleton className="h-8 w-48 mb-8" />
          <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
        </main>
      </div>
    );
  }

  if (!isNew && !recipe) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container mx-auto px-4 py-8 max-w-3xl text-center pt-20">
          <p className="text-muted-foreground">Receita não encontrada.</p>
          <Link href="/recipes"><Button className="mt-4">Voltar às Receitas</Button></Link>
        </main>
      </div>
    );
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

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
            <h1 className="text-3xl font-display font-bold">
              {isNew ? "Nova Receita" : (recipe?.name || "Editar Receita")}
            </h1>
            {!isNew && recipe && (
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="outline">{recipe.recipeId}</Badge>
                {recipe.family && <Badge variant="secondary">{recipe.family}</Badge>}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={isSaving} data-testid="button-save-recipe">
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? "Salvando..." : isNew ? "Criar Receita" : "Salvar"}
            </Button>
            {!isNew && (
              <Button variant="destructive" size="icon" onClick={handleDelete} disabled={deleteMutation.isPending} data-testid="button-delete-recipe">
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-card p-6 rounded-2xl border border-white/10">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-4">Informações Gerais</h2>
            <MetaForm values={metaValues} onChange={setMetaField} />
          </div>

          <div className="glass-card p-6 rounded-2xl border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Etapas ({stages.length})
              </h2>
              <Button variant="outline" size="sm" onClick={addStage} data-testid="button-add-stage">
                <Plus className="w-4 h-4 mr-1" /> Adicionar Etapa
              </Button>
            </div>

            {stages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Nenhuma etapa ainda. Clique em "Adicionar Etapa" para começar.
              </div>
            ) : (
              <div className="space-y-2">
                {stages.map((stage, index) => (
                  <StageRow
                    key={`${index}-${stage.id}`}
                    stage={stage}
                    index={index}
                    total={stages.length}
                    onMove={moveStage}
                    onChange={updateStage}
                    onRemove={removeStage}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Link href="/recipes">
              <Button variant="outline" data-testid="button-cancel-recipe">Cancelar</Button>
            </Link>
            <Button onClick={handleSave} disabled={isSaving} data-testid="button-save-recipe-bottom">
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? "Salvando..." : isNew ? "Criar Receita" : "Salvar Alterações"}
            </Button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
