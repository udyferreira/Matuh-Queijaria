import { useState, useEffect } from "react";
import { Link, useParams, useLocation } from "wouter";
import { ArrowLeft, Save, Trash2, Plus, Minus, ChevronUp, ChevronDown } from "lucide-react";
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

// ─── Types ────────────────────────────────────────────────────────────────────

type Dosing = { mode?: string; value?: number };

type Ingredient = {
  id: string;
  name: string;
  unit: string;
  required?: boolean;
  storage?: string;
  dosing?: Dosing;
};

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
  expected_intent?: string;
  expected_time_type?: string;
  loop_condition?: { until?: string };
  loop_actions?: string[];
  [key: string]: any;
};

// ─── Meta Form ────────────────────────────────────────────────────────────────

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
        <Input value={f("schemaVersion")} onChange={e => onChange("schemaVersion", e.target.value)} placeholder="1.0" data-testid="input-recipe-schema-version" />
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

// ─── Ingredient Row ───────────────────────────────────────────────────────────

function IngredientRow({ item, index, total, onMove, onChange, onRemove }: {
  item: Ingredient;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onChange: (i: number, v: Ingredient) => void;
  onRemove: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const set = (key: keyof Ingredient, val: any) => onChange(index, { ...item, [key]: val });
  const setDosing = (key: keyof Dosing, val: any) => onChange(index, { ...item, dosing: { ...(item.dosing || {}), [key]: val } });

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center bg-card hover:bg-accent/20 transition-colors px-3 py-2">
        <div className="flex flex-col gap-0.5 mr-2">
          <button type="button" onClick={() => onMove(index, index - 1)} disabled={index === 0}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30" data-testid={`button-input-up-${index}`}>
            <ChevronUp className="w-3 h-3" />
          </button>
          <button type="button" onClick={() => onMove(index, index + 1)} disabled={index === total - 1}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30" data-testid={`button-input-down-${index}`}>
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
        <button type="button" onClick={() => setOpen(!open)} className="flex-1 flex items-center gap-3 text-left" data-testid={`button-input-expand-${index}`}>
          <span className="font-medium flex-1">{item.name || item.id || "Ingrediente"}</span>
          <span className="text-xs text-muted-foreground mr-2">{item.unit}</span>
          {item.required && <Badge variant="outline" className="text-xs">obrigatório</Badge>}
        </button>
        <button type="button" onClick={() => onRemove(index)} className="text-destructive hover:text-destructive/70 ml-2 p-1" data-testid={`button-input-remove-${index}`}>
          <Minus className="w-4 h-4" />
        </button>
      </div>
      {open && (
        <div className="px-4 py-3 bg-secondary/10 border-t border-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">ID</label>
              <Input value={item.id} onChange={e => set("id", e.target.value)} data-testid={`input-ingredient-id-${index}`} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Nome</label>
              <Input value={item.name} onChange={e => set("name", e.target.value)} data-testid={`input-ingredient-name-${index}`} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Unidade</label>
              <Input value={item.unit} onChange={e => set("unit", e.target.value)} data-testid={`input-ingredient-unit-${index}`} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Armazenamento</label>
              <Input value={item.storage || ""} onChange={e => set("storage", e.target.value)} placeholder="geladeira, freezer…" data-testid={`input-ingredient-storage-${index}`} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id={`req-${index}`} checked={!!item.required} onChange={e => set("required", e.target.checked)} data-testid={`checkbox-ingredient-required-${index}`} />
            <label htmlFor={`req-${index}`} className="text-xs text-muted-foreground">Obrigatório</label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Dosagem — modo</label>
              <Input value={item.dosing?.mode || ""} onChange={e => setDosing("mode", e.target.value)} placeholder="per_2_liters" data-testid={`input-ingredient-dosing-mode-${index}`} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Dosagem — valor</label>
              <Input type="number" step="0.001" value={item.dosing?.value ?? ""} onChange={e => setDosing("value", e.target.value ? Number(e.target.value) : undefined)} data-testid={`input-ingredient-dosing-value-${index}`} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stage Row ────────────────────────────────────────────────────────────────

function StageRow({ stage, index, total, onMove, onChange, onRemove }: {
  stage: Stage;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onChange: (index: number, updated: Stage) => void;
  onRemove: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const set = (key: string, value: any) => onChange(index, { ...stage, [key]: value });
  const setTimer = (key: string, value: any) => onChange(index, { ...stage, timer: { ...(stage.timer || {}), [key]: value } });
  const setLines = (key: string, raw: string) => set(key, raw.split("\n").map(s => s.trim()).filter(Boolean));

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center bg-card hover:bg-accent/20 transition-colors px-3 py-2">
        <div className="flex flex-col gap-0.5 mr-2">
          <button type="button" onClick={() => onMove(index, index - 1)} disabled={index === 0}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30" data-testid={`button-stage-up-${index}`}>
            <ChevronUp className="w-3 h-3" />
          </button>
          <button type="button" onClick={() => onMove(index, index + 1)} disabled={index === total - 1}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30" data-testid={`button-stage-down-${index}`}>
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
        <button type="button" onClick={() => setOpen(!open)} className="flex-1 flex items-center gap-3 text-left" data-testid={`button-stage-expand-${index}`}>
          <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
            {stage.id}
          </span>
          <span className="font-medium flex-1">{stage.name || "Nova Etapa"}</span>
          <Badge variant="outline" className="text-xs capitalize mr-2">{stage.type || "action"}</Badge>
        </button>
        <button type="button" onClick={() => onRemove(index)} className="text-destructive hover:text-destructive/70 ml-2 p-1" data-testid={`button-stage-remove-${index}`}>
          <Minus className="w-4 h-4" />
        </button>
      </div>

      {open && (
        <div className="px-4 py-3 bg-secondary/10 border-t border-border space-y-3">
          {/* Identity */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">ID</label>
              <Input type="number" value={stage.id} onChange={e => set("id", Number(e.target.value))} data-testid={`input-stage-id-${index}`} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Nome</label>
              <Input value={stage.name || ""} onChange={e => set("name", e.target.value)} data-testid={`input-stage-name-${index}`} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Tipo</label>
              <select value={stage.type || "action"} onChange={e => set("type", e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm" data-testid={`select-stage-type-${index}`}>
                <option value="action">action</option>
                <option value="wait">wait</option>
                <option value="measure">measure</option>
                <option value="loop">loop</option>
                <option value="input">input</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Max loop (horas)</label>
              <Input type="number" step="0.5" value={stage.max_loop_duration_hours ?? ""}
                onChange={e => set("max_loop_duration_hours", e.target.value ? Number(e.target.value) : undefined)}
                data-testid={`input-stage-loop-${index}`} />
            </div>
          </div>

          {/* Instructions */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Instruções (uma por linha)</label>
            <Textarea rows={3} value={(stage.instructions || []).join("\n")}
              onChange={e => setLines("instructions", e.target.value)} data-testid={`textarea-stage-instructions-${index}`} />
          </div>

          {/* Timer */}
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1">Timer</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Duração (min)</label>
              <Input type="number" value={stage.timer?.duration_min ?? ""}
                onChange={e => setTimer("duration_min", e.target.value ? Number(e.target.value) : undefined)}
                data-testid={`input-stage-timer-min-${index}`} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Duração (horas)</label>
              <Input type="number" step="0.5" value={stage.timer?.duration_hours ?? ""}
                onChange={e => setTimer("duration_hours", e.target.value ? Number(e.target.value) : undefined)}
                data-testid={`input-stage-timer-hours-${index}`} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Intervalo (horas)</label>
              <Input type="number" step="0.5" value={stage.timer?.interval_hours ?? ""}
                onChange={e => setTimer("interval_hours", e.target.value ? Number(e.target.value) : undefined)}
                data-testid={`input-stage-timer-interval-${index}`} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id={`blocking-${index}`} checked={stage.timer?.blocking ?? false}
              onChange={e => setTimer("blocking", e.target.checked)} data-testid={`checkbox-stage-blocking-${index}`} />
            <label htmlFor={`blocking-${index}`} className="text-xs text-muted-foreground">Timer bloqueante</label>
          </div>

          {/* Loop */}
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1">Loop</p>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Condição de saída (loop_condition.until)</label>
            <Input value={stage.loop_condition?.until || ""}
              onChange={e => set("loop_condition", e.target.value ? { until: e.target.value } : undefined)}
              placeholder="ph_value < 5.3" data-testid={`input-stage-loop-condition-${index}`} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Ações do loop (loop_actions, uma por linha)</label>
            <Textarea rows={2} value={(stage.loop_actions || []).join("\n")}
              onChange={e => setLines("loop_actions", e.target.value)} data-testid={`textarea-stage-loop-actions-${index}`} />
          </div>

          {/* Intent / time type */}
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1">Alexa / Intents</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">expected_intent</label>
              <Input value={stage.expected_intent || ""}
                onChange={e => set("expected_intent", e.target.value || undefined)}
                placeholder="LogTimeIntent" data-testid={`input-stage-expected-intent-${index}`} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">expected_time_type</label>
              <Input value={stage.expected_time_type || ""}
                onChange={e => set("expected_time_type", e.target.value || undefined)}
                placeholder="floculação" data-testid={`input-stage-expected-time-type-${index}`} />
            </div>
          </div>

          {/* Inputs / stored values */}
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1">Entradas e Valores</p>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Entradas obrigatórias (uma por linha)</label>
            <Textarea rows={2} value={(stage.operator_input_required || []).join("\n")}
              onChange={e => setLines("operator_input_required", e.target.value)} data-testid={`textarea-stage-inputs-${index}`} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Valores armazenados (stored_values, um por linha)</label>
            <Textarea rows={2} value={(stage.stored_values || []).join("\n")}
              onChange={e => setLines("stored_values", e.target.value)} data-testid={`textarea-stage-stored-${index}`} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Prompt de entrada (input_prompt)</label>
            <Input value={stage.input_prompt || ""} onChange={e => set("input_prompt", e.target.value || undefined)}
              data-testid={`input-stage-input-prompt-${index}`} />
          </div>

          {/* LLM guidance */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Orientação LLM (llm_guidance)</label>
            <Textarea rows={2} value={stage.llm_guidance || ""} onChange={e => set("llm_guidance", e.target.value || undefined)}
              data-testid={`textarea-stage-llm-guidance-${index}`} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyStage(id: number): Stage {
  return { id, name: "", type: "action", instructions: [], operator_input_required: [], stored_values: [] };
}

function emptyIngredient(): Ingredient {
  return { id: "", name: "", unit: "", required: false };
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

// ─── Main Component ───────────────────────────────────────────────────────────

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
  const [inputs, setInputs] = useState<Ingredient[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Reset all state on recipe navigation
  useEffect(() => {
    setMeta({});
    setStages([]);
    setInputs([]);
    setInitialized(false);
  }, [recipeId]);

  // Populate from loaded recipe
  useEffect(() => {
    if (recipe && !initialized) {
      setStages(recipe.stages || []);
      setInputs(recipe.inputs || []);
      setInitialized(true);
    }
  }, [recipe, initialized]);

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

  // ── Mutations ──

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
      setInitialized(false);
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

  // ── Payload builder ──

  const buildPayload = () => {
    const cleanStages = stages.map(s => {
      const c: any = { ...s };
      if (c.timer) {
        const t: any = {};
        if (c.timer.duration_min != null && c.timer.duration_min !== "") t.duration_min = Number(c.timer.duration_min);
        if (c.timer.duration_hours != null && c.timer.duration_hours !== "") t.duration_hours = Number(c.timer.duration_hours);
        if (c.timer.interval_hours != null && c.timer.interval_hours !== "") t.interval_hours = Number(c.timer.interval_hours);
        if (c.timer.blocking != null) t.blocking = c.timer.blocking;
        c.timer = Object.keys(t).length > 0 ? t : null;
      }
      if (c.max_loop_duration_hours === "" || c.max_loop_duration_hours === undefined) delete c.max_loop_duration_hours;
      if (!c.loop_condition?.until) delete c.loop_condition;
      if (!c.loop_actions?.length) delete c.loop_actions;
      if (!c.expected_intent) delete c.expected_intent;
      if (!c.expected_time_type) delete c.expected_time_type;
      return c;
    });

    const cleanInputs = inputs.map(i => {
      const c: any = { ...i };
      if (!c.storage) delete c.storage;
      if (!c.dosing?.mode && !c.dosing?.value) delete c.dosing;
      return c;
    });

    const payload: Record<string, any> = {
      ...metaValues,
      stages: cleanStages,
      inputs: cleanInputs,
    };
    if (metaValues.batchMinL) payload.batchMinL = metaValues.batchMinL;
    if (metaValues.batchMaxL) payload.batchMaxL = metaValues.batchMaxL;
    if (metaValues.targetTemperatureC) payload.targetTemperatureC = metaValues.targetTemperatureC;
    if (metaValues.targetFinalPh) payload.targetFinalPh = metaValues.targetFinalPh;
    if (metaValues.maturationTargetDays) payload.maturationTargetDays = Number(metaValues.maturationTargetDays);
    return payload;
  };

  // ── Actions ──

  const handleSave = () => {
    if (isNew) {
      if (!metaValues.recipeId || !metaValues.name) {
        toast({ title: "Recipe ID e Nome são obrigatórios", variant: "destructive" });
        return;
      }
      createMutation.mutate(buildPayload());
    } else {
      updateMutation.mutate({ ...meta, stages, inputs });
    }
  };

  const handleDelete = () => {
    if (!confirm("Excluir esta receita? Esta ação não pode ser desfeita.")) return;
    deleteMutation.mutate();
  };

  // ── Loading / not-found states ──

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
          {/* Metadata */}
          <div className="glass-card p-6 rounded-2xl border border-white/10">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-4">Informações Gerais</h2>
            <MetaForm values={metaValues} onChange={setMetaField} />
          </div>

          {/* Inputs / Ingredients */}
          <div className="glass-card p-6 rounded-2xl border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Ingredientes ({inputs.length})
              </h2>
              <Button variant="outline" size="sm" onClick={() => setInputs(prev => [...prev, emptyIngredient()])} data-testid="button-add-ingredient">
                <Plus className="w-4 h-4 mr-1" /> Adicionar Ingrediente
              </Button>
            </div>
            {inputs.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">Nenhum ingrediente ainda.</div>
            ) : (
              <div className="space-y-2">
                {inputs.map((item, i) => (
                  <IngredientRow
                    key={i}
                    item={item}
                    index={i}
                    total={inputs.length}
                    onMove={(from, to) => setInputs(arr => moveItem(arr, from, to))}
                    onChange={(idx, val) => setInputs(arr => { const n = [...arr]; n[idx] = val; return n; })}
                    onRemove={idx => setInputs(arr => arr.filter((_, j) => j !== idx))}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Stages */}
          <div className="glass-card p-6 rounded-2xl border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Etapas ({stages.length})
              </h2>
              <Button variant="outline" size="sm" onClick={() => {
                const nextId = stages.length > 0 ? Math.max(...stages.map(s => s.id)) + 1 : 1;
                setStages(prev => [...prev, emptyStage(nextId)]);
              }} data-testid="button-add-stage">
                <Plus className="w-4 h-4 mr-1" /> Adicionar Etapa
              </Button>
            </div>
            {stages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Nenhuma etapa ainda. Clique em "Adicionar Etapa" para começar.</div>
            ) : (
              <div className="space-y-2">
                {stages.map((stage, i) => (
                  <StageRow
                    key={`${i}-${stage.id}`}
                    stage={stage}
                    index={i}
                    total={stages.length}
                    onMove={(from, to) => setStages(arr => moveItem(arr, from, to))}
                    onChange={(idx, val) => setStages(arr => { const n = [...arr]; n[idx] = val; return n; })}
                    onRemove={idx => setStages(arr => arr.filter((_, j) => j !== idx))}
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
