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

function isoToDatetimeBRT(isoStr: string | undefined | null): string {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    const datePart = d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const timePart = d.toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false });
    return `${datePart}T${timePart}`;
  } catch {
    return "";
  }
}

function datetimeBRTToISO(localVal: string): string {
  if (!localVal) return "";
  try {
    return new Date(`${localVal}:00-03:00`).toISOString();
  } catch {
    return "";
  }
}

function timestampToDateInput(ts: string | Date | undefined | null): string {
  if (!ts) return "";
  try {
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
  // Nete fermentos
  FERMENT_LR: string;
  FERMENT_DX: string;
  FERMENT_KL: string;
  RENNET: string;
  // Nina fermentos (FERMENT_HT instead of LR/KL)
  FERMENT_HT: string;
  // Nete horários adição (stages 4/5)
  ferment_lr_dx_add_time: string;
  ferment_kl_coalho_add_time: string;
  // Nina horários adição (stages 7/8)
  ferment_add_time: string;
  rennet_add_time: string;
  // Common
  flocculation_time: string;
  cut_point_time: string;
  initial_ph: string;
  pieces_quantity: string;
  press_start_time: string;
  ph_measurements: string[];
  turningCyclesCount: string;
  brine_entry_time_iso: string;
  shelf_start_time_iso: string;
  chamber2EntryDate: string;
  maturationEndDate: string;
  maturationMaxEndDate: string;
  chamber2ExitDate: string;
}

function buildInitialState(batch: ProductionBatch): FormState {
  const m = (batch.measurements as Record<string, any>) || {};
  const calc = (batch.calculatedInputs as Record<string, any>) || {};
  const history: any[] = m._history || [];
  const isNina = (batch as any).recipeId === 'QUEIJO_NINA';
  const loopStageId = isNina ? 20 : 15;
  const initialPhStageId = isNina ? 18 : 13;

  function mOrHistory(key: string): any {
    if (m[key] != null) return m[key];
    const entries = history.filter((h: any) => h.key === key);
    return entries.length > 0 ? entries[entries.length - 1].value : undefined;
  }

  // pH loop measurements — filter by recipe-specific stageId
  const phArr: any[] = m.ph_measurements || [];
  const loopPhArr = phArr.filter((p: any) => p.stageId === loopStageId || p.stageId == null);
  const phMeasurements = loopPhArr.length > 0
    ? loopPhArr.map((p: any) => (p.value != null ? String(p.value) : ""))
    : history
        .filter((h: any) => (h.key === 'ph_value' || h.key === 'ph_measurement') && h.stageId === loopStageId)
        .map((h: any) => String(h.value));

  // initial_ph: prefer measurements.initial_ph, fall back to recipe-specific stageId in history
  const initialPhVal = m.initial_ph != null
    ? m.initial_ph
    : (() => {
        const entry = history.find((h: any) =>
          h.key === 'initial_ph' || (h.key === 'ph_value' && h.stageId === initialPhStageId)
        );
        return entry?.value;
      })();

  return {
    milkVolumeL: batch.milkVolumeL != null ? String(batch.milkVolumeL) : "",
    milk_temperature_c: mOrHistory('milk_temperature_c') != null ? String(mOrHistory('milk_temperature_c')) : "",
    milk_ph: mOrHistory('milk_ph') != null ? String(mOrHistory('milk_ph')) : "",
    // Nete fermentos
    FERMENT_LR: calc.FERMENT_LR != null ? String(calc.FERMENT_LR) : "",
    FERMENT_DX: calc.FERMENT_DX != null ? String(calc.FERMENT_DX) : "",
    FERMENT_KL: calc.FERMENT_KL != null ? String(calc.FERMENT_KL) : "",
    RENNET: calc.RENNET != null ? String(calc.RENNET) : "",
    // Nina fermentos
    FERMENT_HT: calc.FERMENT_HT != null ? String(calc.FERMENT_HT) : "",
    // Nete horários adição
    ferment_lr_dx_add_time: isoToTimeBRT(mOrHistory('ferment_lr_dx_add_time_iso')),
    ferment_kl_coalho_add_time: isoToTimeBRT(mOrHistory('ferment_kl_coalho_add_time_iso')),
    // Nina horários adição
    ferment_add_time: isoToTimeBRT(mOrHistory('ferment_add_time')),
    rennet_add_time: isoToTimeBRT(mOrHistory('rennet_add_time')),
    // Common
    flocculation_time: mOrHistory('flocculation_time') ?? "",
    cut_point_time: mOrHistory('cut_point_time') ?? "",
    initial_ph: initialPhVal != null ? String(initialPhVal) : "",
    pieces_quantity: mOrHistory('pieces_quantity') != null ? String(mOrHistory('pieces_quantity')) : "",
    press_start_time: mOrHistory('press_start_time') ?? "",
    ph_measurements: phMeasurements,
    turningCyclesCount: (batch as any).turningCyclesCount != null
      ? String((batch as any).turningCyclesCount)
      : (mOrHistory('turning_cycles_count') != null ? String(mOrHistory('turning_cycles_count')) : ""),
    brine_entry_time_iso: isoToDatetimeBRT(mOrHistory('brine_entry_time_iso')),
    shelf_start_time_iso: isoToDatetimeBRT(mOrHistory('shelf_start_time_iso')),
    chamber2EntryDate: timestampToDateInput(batch.chamber2EntryDate as any),
    maturationEndDate: timestampToDateInput(batch.maturationEndDate as any),
    maturationMaxEndDate: timestampToDateInput((batch as any).maturationMaxEndDate as any),
    chamber2ExitDate: timestampToDateInput((batch as any).chamber2ExitDate as any),
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
  const isNina = (batch as any).recipeId === 'QUEIJO_NINA';

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

    function numIfChanged(formKey: keyof FormState, setter: (v: number) => void) {
      const cur = form[formKey] as string;
      const prev = initial[formKey] as string;
      if (cur !== "" && cur !== prev) setter(Number(cur));
    }
    function strIfChanged(formKey: keyof FormState, setter: (v: string) => void) {
      const cur = form[formKey] as string;
      const prev = initial[formKey] as string;
      if (cur !== "" && cur !== prev) setter(cur);
    }

    // Stage 1 — parâmetros iniciais (same for both recipes)
    numIfChanged("milk_temperature_c", (v) => { payload.measurements.milk_temperature_c = v; });
    numIfChanged("milk_ph", (v) => { payload.measurements.milk_ph = v; });

    if (isNina) {
      // Stage 2 — Nina: DX + HT + Coalho
      numIfChanged("FERMENT_DX", (v) => { payload.calculatedInputs.FERMENT_DX = v; });
      numIfChanged("FERMENT_HT", (v) => { payload.calculatedInputs.FERMENT_HT = v; });
      numIfChanged("RENNET", (v) => { payload.calculatedInputs.RENNET = v; });

      // Stage 7 — Hora adição DX+HT
      if (form.ferment_add_time !== initial.ferment_add_time && form.ferment_add_time !== "") {
        payload.measurements.ferment_add_time = timeBRTToISO(m.ferment_add_time, form.ferment_add_time);
      }

      // Stage 8 — Hora adição Coalho
      if (form.rennet_add_time !== initial.rennet_add_time && form.rennet_add_time !== "") {
        payload.measurements.rennet_add_time = timeBRTToISO(m.rennet_add_time, form.rennet_add_time);
      }
    } else {
      // Stage 2 — Nete: LR + DX + KL + Coalho
      numIfChanged("FERMENT_LR", (v) => { payload.calculatedInputs.FERMENT_LR = v; });
      numIfChanged("FERMENT_DX", (v) => { payload.calculatedInputs.FERMENT_DX = v; });
      numIfChanged("FERMENT_KL", (v) => { payload.calculatedInputs.FERMENT_KL = v; });
      numIfChanged("RENNET", (v) => { payload.calculatedInputs.RENNET = v; });

      // Stage 4 — Hora adição LR/DX
      if (form.ferment_lr_dx_add_time !== initial.ferment_lr_dx_add_time && form.ferment_lr_dx_add_time !== "") {
        payload.measurements.ferment_lr_dx_add_time_iso = timeBRTToISO(m.ferment_lr_dx_add_time_iso, form.ferment_lr_dx_add_time);
      }

      // Stage 5 — Hora adição KL+Coalho
      if (form.ferment_kl_coalho_add_time !== initial.ferment_kl_coalho_add_time && form.ferment_kl_coalho_add_time !== "") {
        payload.measurements.ferment_kl_coalho_add_time_iso = timeBRTToISO(m.ferment_kl_coalho_add_time_iso, form.ferment_kl_coalho_add_time);
      }
    }

    // Floculação e corte (same keys, different stageIds — handled by backend)
    strIfChanged("flocculation_time", (v) => { payload.measurements.flocculation_time = v; });
    strIfChanged("cut_point_time", (v) => { payload.measurements.cut_point_time = v; });

    // pH inicial + peças (Nete: stage 13 / Nina: stage 18 — handled by backend)
    numIfChanged("initial_ph", (v) => { payload.measurements.initial_ph = v; });
    numIfChanged("pieces_quantity", (v) => { payload.measurements.pieces_quantity = v; });

    // Prensa (Nete: stage 14 / Nina: stage 19 — handled by backend)
    strIfChanged("press_start_time", (v) => { payload.measurements.press_start_time = v; });

    // Viradas + pH loop (Nete: stage 15 / Nina: stage 20 — handled by backend)
    const phEdits = form.ph_measurements
      .map((v, i) => ({ index: i, value: Number(v), changed: v !== (initial.ph_measurements[i] ?? "") && v !== "" }))
      .filter((e) => e.changed)
      .map(({ index, value }) => ({ index, value }));
    if (phEdits.length > 0) payload.measurements.ph_measurements = phEdits;
    numIfChanged("turningCyclesCount", (v) => { payload.topLevel.turningCyclesCount = v; });

    // Salga e secagem (Nete: stages 17/18 / Nina: stages 21/22 — handled by backend)
    if (form.brine_entry_time_iso !== initial.brine_entry_time_iso) {
      payload.measurements.brine_entry_time_iso = form.brine_entry_time_iso
        ? datetimeBRTToISO(form.brine_entry_time_iso)
        : "";
    }
    if (form.shelf_start_time_iso !== initial.shelf_start_time_iso) {
      payload.measurements.shelf_start_time_iso = form.shelf_start_time_iso
        ? datetimeBRTToISO(form.shelf_start_time_iso)
        : "";
    }

    // Câmara 2 e maturação (Nete: stage 19 / Nina: stage 25 — handled by backend)
    strIfChanged("chamber2EntryDate", (v) => { payload.topLevel.chamber2EntryDate = v; });
    strIfChanged("maturationEndDate", (v) => { payload.topLevel.maturationEndDate = v; });
    strIfChanged("maturationMaxEndDate", (v) => { payload.topLevel.maturationMaxEndDate = v; });
    // chamber2ExitDate: always send if changed (including clearing to "")
    {
      const cur = form.chamber2ExitDate;
      const prev = initial.chamber2ExitDate;
      if (cur !== prev) payload.topLevel.chamber2ExitDate = cur || null;
    }

    // Volume de leite
    numIfChanged("milkVolumeL", (v) => { payload.topLevel.milkVolumeL = v; });

    mutation.mutate(payload);
  }

  // ─── Labels de etapa por receita ─────────────────────────────────────────
  const labels = isNina ? {
    fermentStages: "Etapas 7 e 8",
    fermentAddLabel1: "Hora Adição DX+HT",
    fermentAddLabel2: "Hora Adição Coalho",
    flocCutStages: "Etapas 10 e 11",
    phPiecesStages: "Etapas 18 e 19",
    phPiecesLabel: "Etapa 18 — pH Inicial, Peças e Prensagem",
    loopStage: "Etapa 20",
    loopLabel: "Etapa 20 — Viradas e Medições de pH",
    brineShelveStages: "Etapas 23 e 24",
    brineShelveLabel: "Etapas 23 e 24 — Salga e Secagem",
    camStage: "Etapa 25",
    camLabel: "Etapa 25 — Câmara 2 e Maturação",
  } : {
    fermentStages: "Etapas 4 e 5",
    fermentAddLabel1: "Hora Adição LR/DX",
    fermentAddLabel2: "Hora Adição KL + Coalho",
    flocCutStages: "Etapas 6 e 7",
    phPiecesStages: "Etapas 13 e 14",
    phPiecesLabel: "Etapas 13 e 14 — pH Inicial, Peças e Prensagem",
    loopStage: "Etapa 15",
    loopLabel: "Etapa 15 — Viradas e Medições de pH",
    brineShelveStages: "Etapas 17 e 18",
    brineShelveLabel: "Etapas 17 e 18 — Salga e Secagem",
    camStage: "Etapa 19",
    camLabel: "Etapa 19 — Câmara 2 e Maturação",
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
        <div className="px-6 pt-6 pb-4 shrink-0">
          <DialogHeader>
            <DialogTitle>Editar Dados — Lote {formatBatchCode(batch.startedAt)}</DialogTitle>
          </DialogHeader>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 px-6">
        <div className="space-y-6 pb-2">

          {/* Câmara 2 e Maturação */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {labels.camLabel}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-chamber2-exit">Data de Saída da Câmara 2</Label>
                <Input
                  id="edit-chamber2-exit"
                  type="date"
                  value={form.chamber2ExitDate}
                  onChange={(e) => set("chamber2ExitDate", e.target.value)}
                  data-testid="input-edit-chamber2-exit-date"
                />
              </div>
              <div>
                <Label htmlFor="edit-maturation-min">Fim da Maturação Mínima</Label>
                <Input
                  id="edit-maturation-min"
                  type="date"
                  value={form.maturationEndDate}
                  onChange={(e) => set("maturationEndDate", e.target.value)}
                  data-testid="input-edit-maturation-min-date"
                />
              </div>
              <div>
                <Label htmlFor="edit-maturation-max">Fim da Maturação Máxima</Label>
                <Input
                  id="edit-maturation-max"
                  type="date"
                  value={form.maturationMaxEndDate}
                  onChange={(e) => set("maturationMaxEndDate", e.target.value)}
                  data-testid="input-edit-maturation-max-date"
                />
              </div>
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
            </div>
          </section>

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
              {isNina ? (
                <>
                  {[
                    { key: "FERMENT_DX", label: "Fermento DX (mL)", testid: "ferment-dx" },
                    { key: "FERMENT_HT", label: "Fermento HT (mL)", testid: "ferment-ht" },
                    { key: "RENNET", label: "Coalho (mL)", testid: "rennet" },
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
                </>
              ) : (
                <>
                  {[
                    { key: "FERMENT_LR", label: "Fermento LR (mL)", testid: "ferment-lr" },
                    { key: "FERMENT_DX", label: "Fermento DX (mL)", testid: "ferment-dx" },
                    { key: "FERMENT_KL", label: "Fermento KL (mL)", testid: "ferment-kl" },
                    { key: "RENNET", label: "Coalho (mL)", testid: "rennet" },
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
                </>
              )}
            </div>
          </section>

          {/* Horários de Adição de Fermentos */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {labels.fermentStages} — Horários de Adição
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {isNina ? (
                <>
                  <div>
                    <Label htmlFor="edit-ferment-add-time">{labels.fermentAddLabel1}</Label>
                    <Input
                      id="edit-ferment-add-time"
                      type="time"
                      value={form.ferment_add_time}
                      onChange={(e) => set("ferment_add_time", e.target.value)}
                      data-testid="input-edit-ferment-add-time"
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-rennet-add-time">{labels.fermentAddLabel2}</Label>
                    <Input
                      id="edit-rennet-add-time"
                      type="time"
                      value={form.rennet_add_time}
                      onChange={(e) => set("rennet_add_time", e.target.value)}
                      data-testid="input-edit-rennet-add-time"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label htmlFor="edit-lr-time">{labels.fermentAddLabel1}</Label>
                    <Input
                      id="edit-lr-time"
                      type="time"
                      value={form.ferment_lr_dx_add_time}
                      onChange={(e) => set("ferment_lr_dx_add_time", e.target.value)}
                      data-testid="input-edit-lr-dx-time"
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-kl-time">{labels.fermentAddLabel2}</Label>
                    <Input
                      id="edit-kl-time"
                      type="time"
                      value={form.ferment_kl_coalho_add_time}
                      onChange={(e) => set("ferment_kl_coalho_add_time", e.target.value)}
                      data-testid="input-edit-kl-coalho-time"
                    />
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Floculação e Corte */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {labels.flocCutStages} — Floculação e Corte
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

          {/* pH Inicial, Peças e Prensagem */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {labels.phPiecesLabel}
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

          {/* Viradas e pH Loop */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {labels.loopLabel}
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

          {/* Salga e Secagem */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {labels.brineShelveLabel}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-brine-entry">Entrada na Salga (data e hora)</Label>
                <Input
                  id="edit-brine-entry"
                  type="datetime-local"
                  value={form.brine_entry_time_iso}
                  onChange={(e) => set("brine_entry_time_iso", e.target.value)}
                  data-testid="input-edit-brine-entry"
                />
              </div>
              <div>
                <Label htmlFor="edit-shelf-start">Início da Secagem em Prateleiras</Label>
                <Input
                  id="edit-shelf-start"
                  type="datetime-local"
                  value={form.shelf_start_time_iso}
                  onChange={(e) => set("shelf_start_time_iso", e.target.value)}
                  data-testid="input-edit-shelf-start"
                />
              </div>
            </div>
          </section>


        </div>
        </div>

        <div className="px-6 pb-6 pt-3 border-t border-border shrink-0">
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={mutation.isPending} data-testid="button-edit-cancel">
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={mutation.isPending} data-testid="button-edit-save">
              {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salvar Alterações
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
