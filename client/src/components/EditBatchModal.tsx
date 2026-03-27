import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ProductionBatch, formatBatchCode } from "@shared/schema";
import { Loader2 } from "lucide-react";

// ─── Helpers ───────────────────────────────────────────────────────────────

function isoToTimeBRT(isoStr: string | undefined | null): string {
  if (!isoStr) return "";
  try {
    const formatted = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(isoStr));
    return formatted === "24:00" ? "00:00" : formatted;
  } catch {
    return "";
  }
}

function timeBRTToISO(originalISO: string | undefined | null, newTime: string): string {
  if (!newTime) return originalISO ?? "";
  try {
    const ref = originalISO ? new Date(originalISO) : new Date();
    const dateBRT = ref.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    return new Date(`${dateBRT}T${newTime}:00-03:00`).toISOString();
  } catch {
    return originalISO ?? "";
  }
}

function timestampToDateInput(ts: string | Date | undefined | null): string {
  if (!ts) return "";
  try {
    // Extract YYYY-MM-DD from ISO string directly (no TZ conversion)
    // Matches parseDateOnly in utils.ts — avoids off-by-one near UTC midnight
    const str = typeof ts === "string" ? ts : (ts as Date).toISOString();
    return str.split("T")[0] ?? "";
  } catch {
    return "";
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface FormState {
  milkVolumeL: string;
  milk_temperature_c: string;
  milk_ph: string;
  FERMENT_LR: string;
  FERMENT_DX: string;
  FERMENT_KL: string;
  RENNET: string;
  SALT: string;
  CALCIUM: string;
  ferment_lr_dx_add_time: string;
  ferment_kl_coalho_add_time: string;
  flocculation_time: string;
  cut_point_time: string;
  initial_ph: string;
  pieces_quantity: string;
  press_start_time: string;
  ph_measurements: string[];
  turningCyclesCount: string;
  chamber2EntryDate: string;
  maturationEndDate: string;
}

function buildInitialState(batch: ProductionBatch): FormState {
  const m = (batch.measurements as Record<string, any>) || {};
  const calc = (batch.calculatedInputs as Record<string, any>) || {};
  const history: any[] = m._history || [];

  // Prefer measurements field, fall back to last matching history entry (for legacy batches)
  function mOrHistory(key: string): any {
    if (m[key] != null) return m[key];
    const entries = history.filter((h: any) => h.key === key);
    return entries.length > 0 ? entries[entries.length - 1].value : undefined;
  }

  // Stage 15 pH measurements: prefer ph_measurements array (current format),
  // fall back to history entries with ph_measurement/ph_value keys for legacy batches
  const phArr: any[] = m.ph_measurements || [];
  const stage15PhArr = phArr.filter((p: any) => p.stageId === 15 || p.stageId == null);
  const phMeasurements = stage15PhArr.length > 0
    ? stage15PhArr.map((p: any) => (p.value != null ? String(p.value) : ""))
    : history
        .filter((h: any) => (h.key === 'ph_value' || h.key === 'ph_measurement') && h.stageId === 15)
        .map((h: any) => String(h.value));

  // initial_ph: prefer measurements.initial_ph, fall back to stageId=13 ph_value in history
  const initialPhVal = m.initial_ph != null
    ? m.initial_ph
    : (() => {
        const entry = history.find((h: any) => (h.key === 'initial_ph' || (h.key === 'ph_value' && h.stageId === 13)));
        return entry?.value;
      })();

  return {
    milkVolumeL: batch.milkVolumeL != null ? String(batch.milkVolumeL) : "",
    milk_temperature_c: mOrHistory('milk_temperature_c') != null ? String(mOrHistory('milk_temperature_c')) : "",
    milk_ph: mOrHistory('milk_ph') != null ? String(mOrHistory('milk_ph')) : "",
    FERMENT_LR: calc.FERMENT_LR != null ? String(calc.FERMENT_LR) : "",
    FERMENT_DX: calc.FERMENT_DX != null ? String(calc.FERMENT_DX) : "",
    FERMENT_KL: calc.FERMENT_KL != null ? String(calc.FERMENT_KL) : "",
    RENNET: calc.RENNET != null ? String(calc.RENNET) : "",
    SALT: calc.SALT != null ? String(calc.SALT) : "",
    CALCIUM: calc.CALCIUM != null ? String(calc.CALCIUM) : "",
    ferment_lr_dx_add_time: isoToTimeBRT(mOrHistory('ferment_lr_dx_add_time_iso')),
    ferment_kl_coalho_add_time: isoToTimeBRT(mOrHistory('ferment_kl_coalho_add_time_iso')),
    flocculation_time: mOrHistory('flocculation_time') ?? "",
    cut_point_time: mOrHistory('cut_point_time') ?? "",
    initial_ph: initialPhVal != null ? String(initialPhVal) : "",
    pieces_quantity: mOrHistory('pieces_quantity') != null ? String(mOrHistory('pieces_quantity')) : "",
    press_start_time: mOrHistory('press_start_time') ?? "",
    ph_measurements: phMeasurements,
    turningCyclesCount: (batch as any).turningCyclesCount != null
      ? String((batch as any).turningCyclesCount)
      : (mOrHistory('turning_cycles_count') != null ? String(mOrHistory('turning_cycles_count')) : ""),
    chamber2EntryDate: timestampToDateInput(batch.chamber2EntryDate as any),
    maturationEndDate: timestampToDateInput(batch.maturationEndDate as any),
  };
}

// ─── Component ─────────────────────────────────────────────────────────────

interface Props {
  batch: ProductionBatch;
  open: boolean;
  onClose: () => void;
}

export function EditBatchModal({ batch, open, onClose }: Props) {
  const { toast } = useToast();
  const initialRef = useRef<FormState>(buildInitialState(batch));
  const [form, setForm] = useState<FormState>(() => buildInitialState(batch));

  const m = (batch.measurements as Record<string, any>) || {};

  const mutation = useMutation({
    mutationFn: async (payload: any) =>
      apiRequest("PATCH", `/api/batches/${batch.id}/report-edit`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/batches/completed"] });
      toast({ title: "Dados atualizados com sucesso." });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message ?? "Erro desconhecido", variant: "destructive" });
    },
  });

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function setPh(index: number, value: string) {
    setForm((prev) => {
      const arr = [...prev.ph_measurements];
      arr[index] = value;
      return { ...prev, ph_measurements: arr };
    });
  }

  function handleSave() {
    const initial = initialRef.current;
    const payload: any = { measurements: {}, calculatedInputs: {}, topLevel: {} };

    // Helper: only include numeric field if changed and non-empty
    function numIfChanged(formKey: keyof FormState, setter: (v: number) => void) {
      const cur = form[formKey] as string;
      const prev = initial[formKey] as string;
      if (cur !== "" && cur !== prev) setter(Number(cur));
    }
    // Helper: only include string field if changed and non-empty
    function strIfChanged(formKey: keyof FormState, setter: (v: string) => void) {
      const cur = form[formKey] as string;
      const prev = initial[formKey] as string;
      if (cur !== "" && cur !== prev) setter(cur);
    }

    // Stage 1 measurements
    numIfChanged("milk_temperature_c", (v) => { payload.measurements.milk_temperature_c = v; });
    numIfChanged("milk_ph", (v) => { payload.measurements.milk_ph = v; });

    // Stage 2 calculatedInputs
    numIfChanged("FERMENT_LR", (v) => { payload.calculatedInputs.FERMENT_LR = v; });
    numIfChanged("FERMENT_DX", (v) => { payload.calculatedInputs.FERMENT_DX = v; });
    numIfChanged("FERMENT_KL", (v) => { payload.calculatedInputs.FERMENT_KL = v; });
    numIfChanged("RENNET", (v) => { payload.calculatedInputs.RENNET = v; });
    numIfChanged("SALT", (v) => { payload.calculatedInputs.SALT = v; });
    numIfChanged("CALCIUM", (v) => { payload.calculatedInputs.CALCIUM = v; });

    // Stage 4 (time input, compare HH:MM strings)
    if (form.ferment_lr_dx_add_time !== initial.ferment_lr_dx_add_time && form.ferment_lr_dx_add_time !== "") {
      payload.measurements.ferment_lr_dx_add_time_iso = timeBRTToISO(m.ferment_lr_dx_add_time_iso, form.ferment_lr_dx_add_time);
    }

    // Stage 5
    if (form.ferment_kl_coalho_add_time !== initial.ferment_kl_coalho_add_time && form.ferment_kl_coalho_add_time !== "") {
      payload.measurements.ferment_kl_coalho_add_time_iso = timeBRTToISO(m.ferment_kl_coalho_add_time_iso, form.ferment_kl_coalho_add_time);
    }

    // Stage 6
    strIfChanged("flocculation_time", (v) => { payload.measurements.flocculation_time = v; });

    // Stage 7
    strIfChanged("cut_point_time", (v) => { payload.measurements.cut_point_time = v; });

    // Stage 13
    numIfChanged("initial_ph", (v) => { payload.measurements.initial_ph = v; });
    numIfChanged("pieces_quantity", (v) => { payload.measurements.pieces_quantity = v; });

    // Stage 14
    strIfChanged("press_start_time", (v) => { payload.measurements.press_start_time = v; });

    // Stage 15 - pH measurements (only changed entries)
    const phEdits = form.ph_measurements
      .map((v, i) => ({ index: i, value: Number(v), changed: v !== (initial.ph_measurements[i] ?? "") && v !== "" }))
      .filter((e) => e.changed)
      .map(({ index, value }) => ({ index, value }));
    if (phEdits.length > 0) payload.measurements.ph_measurements = phEdits;

    // Stage 15 - viradas
    numIfChanged("turningCyclesCount", (v) => { payload.topLevel.turningCyclesCount = v; });

    // Stage 19 - dates (only if changed)
    strIfChanged("chamber2EntryDate", (v) => { payload.topLevel.chamber2EntryDate = v; });
    strIfChanged("maturationEndDate", (v) => { payload.topLevel.maturationEndDate = v; });

    // Top-level milk volume
    numIfChanged("milkVolumeL", (v) => { payload.topLevel.milkVolumeL = v; });

    mutation.mutate(payload);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Dados — Lote {formatBatchCode(batch.startedAt)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">

          {/* Etapa 1 — Parâmetros Iniciais */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Etapa 1 — Parâmetros Iniciais
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-milk-vol">Volume de Leite (L)</Label>
                <Input
                  id="edit-milk-vol"
                  type="number"
                  step="0.1"
                  value={form.milkVolumeL}
                  onChange={(e) => set("milkVolumeL", e.target.value)}
                  data-testid="input-edit-milk-volume"
                />
              </div>
              <div>
                <Label htmlFor="edit-milk-temp">Temperatura do Leite (°C)</Label>
                <Input
                  id="edit-milk-temp"
                  type="number"
                  step="0.1"
                  value={form.milk_temperature_c}
                  onChange={(e) => set("milk_temperature_c", e.target.value)}
                  data-testid="input-edit-milk-temperature"
                />
              </div>
              <div>
                <Label htmlFor="edit-milk-ph">pH do Leite</Label>
                <Input
                  id="edit-milk-ph"
                  type="number"
                  step="0.01"
                  value={form.milk_ph}
                  onChange={(e) => set("milk_ph", e.target.value)}
                  data-testid="input-edit-milk-ph"
                />
              </div>
            </div>
          </section>

          {/* Etapa 2 — Fermentos e Coalho */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Etapa 2 — Fermentos e Coalho
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                { key: "FERMENT_LR", label: "Fermento LR (mL)", testid: "ferment-lr" },
                { key: "FERMENT_DX", label: "Fermento DX (mL)", testid: "ferment-dx" },
                { key: "FERMENT_KL", label: "Fermento KL (mL)", testid: "ferment-kl" },
                { key: "RENNET", label: "Coalho (mL)", testid: "rennet" },
                { key: "SALT", label: "Sal (g)", testid: "salt" },
                { key: "CALCIUM", label: "Cloreto de Cálcio (mL)", testid: "calcium" },
              ].map(({ key, label, testid }) => (
                <div key={key}>
                  <Label htmlFor={`edit-${testid}`}>{label}</Label>
                  <Input
                    id={`edit-${testid}`}
                    type="number"
                    step="0.01"
                    value={form[key as keyof FormState] as string}
                    onChange={(e) => set(key as keyof FormState, e.target.value)}
                    data-testid={`input-edit-${testid}`}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Etapas 4 e 5 — Horários de Adição */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Etapas 4 e 5 — Horários de Adição
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-lr-time">Hora Adição LR/DX</Label>
                <Input
                  id="edit-lr-time"
                  type="time"
                  value={form.ferment_lr_dx_add_time}
                  onChange={(e) => set("ferment_lr_dx_add_time", e.target.value)}
                  data-testid="input-edit-lr-dx-time"
                />
              </div>
              <div>
                <Label htmlFor="edit-kl-time">Hora Adição KL + Coalho</Label>
                <Input
                  id="edit-kl-time"
                  type="time"
                  value={form.ferment_kl_coalho_add_time}
                  onChange={(e) => set("ferment_kl_coalho_add_time", e.target.value)}
                  data-testid="input-edit-kl-coalho-time"
                />
              </div>
            </div>
          </section>

          {/* Etapas 6 e 7 — Floculação e Corte */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Etapas 6 e 7 — Floculação e Corte
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-floc">Hora de Floculação</Label>
                <Input
                  id="edit-floc"
                  type="time"
                  value={form.flocculation_time}
                  onChange={(e) => set("flocculation_time", e.target.value)}
                  data-testid="input-edit-flocculation-time"
                />
              </div>
              <div>
                <Label htmlFor="edit-cut">Hora do Corte</Label>
                <Input
                  id="edit-cut"
                  type="time"
                  value={form.cut_point_time}
                  onChange={(e) => set("cut_point_time", e.target.value)}
                  data-testid="input-edit-cut-point-time"
                />
              </div>
            </div>
          </section>

          {/* Etapas 13 e 14 — pH Inicial, Peças e Prensagem */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Etapas 13 e 14 — pH Inicial, Peças e Prensagem
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-init-ph">pH Inicial</Label>
                <Input
                  id="edit-init-ph"
                  type="number"
                  step="0.01"
                  value={form.initial_ph}
                  onChange={(e) => set("initial_ph", e.target.value)}
                  data-testid="input-edit-initial-ph"
                />
              </div>
              <div>
                <Label htmlFor="edit-pieces">Quantidade de Peças</Label>
                <Input
                  id="edit-pieces"
                  type="number"
                  step="1"
                  value={form.pieces_quantity}
                  onChange={(e) => set("pieces_quantity", e.target.value)}
                  data-testid="input-edit-pieces-quantity"
                />
              </div>
              <div>
                <Label htmlFor="edit-press">Hora Início da Prensagem</Label>
                <Input
                  id="edit-press"
                  type="time"
                  value={form.press_start_time}
                  onChange={(e) => set("press_start_time", e.target.value)}
                  data-testid="input-edit-press-start-time"
                />
              </div>
            </div>
          </section>

          {/* Etapa 15 — Viradas e pH */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Etapa 15 — Viradas e Medições de pH
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-turns">Viradas Realizadas</Label>
                <Input
                  id="edit-turns"
                  type="number"
                  step="1"
                  value={form.turningCyclesCount}
                  onChange={(e) => set("turningCyclesCount", e.target.value)}
                  data-testid="input-edit-turning-cycles"
                />
              </div>
            </div>
            {form.ph_measurements.length > 0 && (
              <div className="grid grid-cols-2 gap-4 mt-4">
                {form.ph_measurements.map((val, idx) => (
                  <div key={idx}>
                    <Label htmlFor={`edit-ph-${idx}`}>{idx + 1}ª Medição de pH</Label>
                    <Input
                      id={`edit-ph-${idx}`}
                      type="number"
                      step="0.01"
                      value={val}
                      onChange={(e) => setPh(idx, e.target.value)}
                      data-testid={`input-edit-ph-measurement-${idx}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Etapa 19 — Câmara 2 e Maturação */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Etapa 19 — Câmara 2 e Maturação
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-chamber2">Data Entrada Câmara 2</Label>
                <Input
                  id="edit-chamber2"
                  type="date"
                  value={form.chamber2EntryDate}
                  onChange={(e) => set("chamber2EntryDate", e.target.value)}
                  data-testid="input-edit-chamber2-date"
                />
              </div>
              <div>
                <Label htmlFor="edit-maturation">Fim da Maturação (90 dias)</Label>
                <Input
                  id="edit-maturation"
                  type="date"
                  value={form.maturationEndDate}
                  onChange={(e) => set("maturationEndDate", e.target.value)}
                  data-testid="input-edit-maturation-date"
                />
              </div>
            </div>
          </section>

        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending} data-testid="button-edit-cancel">
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={mutation.isPending} data-testid="button-edit-save">
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Salvar Alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
