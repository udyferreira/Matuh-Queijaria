import { useState } from "react";
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
    return new Date(ts as string).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
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
  const phArr: any[] = m.ph_measurements || [];

  return {
    milkVolumeL: batch.milkVolumeL != null ? String(batch.milkVolumeL) : "",
    milk_temperature_c: m.milk_temperature_c != null ? String(m.milk_temperature_c) : "",
    milk_ph: m.milk_ph != null ? String(m.milk_ph) : "",
    FERMENT_LR: calc.FERMENT_LR != null ? String(calc.FERMENT_LR) : "",
    FERMENT_DX: calc.FERMENT_DX != null ? String(calc.FERMENT_DX) : "",
    FERMENT_KL: calc.FERMENT_KL != null ? String(calc.FERMENT_KL) : "",
    RENNET: calc.RENNET != null ? String(calc.RENNET) : "",
    SALT: calc.SALT != null ? String(calc.SALT) : "",
    CALCIUM: calc.CALCIUM != null ? String(calc.CALCIUM) : "",
    ferment_lr_dx_add_time: isoToTimeBRT(m.ferment_lr_dx_add_time_iso),
    ferment_kl_coalho_add_time: isoToTimeBRT(m.ferment_kl_coalho_add_time_iso),
    flocculation_time: m.flocculation_time ?? "",
    cut_point_time: m.cut_point_time ?? "",
    initial_ph: m.initial_ph != null ? String(m.initial_ph) : "",
    pieces_quantity: m.pieces_quantity != null ? String(m.pieces_quantity) : "",
    press_start_time: m.press_start_time ?? "",
    ph_measurements: phArr.map((p: any) => (p.value != null ? String(p.value) : "")),
    turningCyclesCount: (batch as any).turningCyclesCount != null ? String((batch as any).turningCyclesCount) : "",
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
    const payload: any = { measurements: {}, calculatedInputs: {}, topLevel: {} };

    // Stage 1 measurements
    if (form.milk_temperature_c !== "") payload.measurements.milk_temperature_c = Number(form.milk_temperature_c);
    if (form.milk_ph !== "") payload.measurements.milk_ph = Number(form.milk_ph);

    // Stage 2 calculatedInputs
    if (form.FERMENT_LR !== "") payload.calculatedInputs.FERMENT_LR = Number(form.FERMENT_LR);
    if (form.FERMENT_DX !== "") payload.calculatedInputs.FERMENT_DX = Number(form.FERMENT_DX);
    if (form.FERMENT_KL !== "") payload.calculatedInputs.FERMENT_KL = Number(form.FERMENT_KL);
    if (form.RENNET !== "") payload.calculatedInputs.RENNET = Number(form.RENNET);
    if (form.SALT !== "") payload.calculatedInputs.SALT = Number(form.SALT);
    if (form.CALCIUM !== "") payload.calculatedInputs.CALCIUM = Number(form.CALCIUM);

    // Stage 4
    if (form.ferment_lr_dx_add_time !== "") {
      payload.measurements.ferment_lr_dx_add_time_iso = timeBRTToISO(m.ferment_lr_dx_add_time_iso, form.ferment_lr_dx_add_time);
    }

    // Stage 5
    if (form.ferment_kl_coalho_add_time !== "") {
      payload.measurements.ferment_kl_coalho_add_time_iso = timeBRTToISO(m.ferment_kl_coalho_add_time_iso, form.ferment_kl_coalho_add_time);
    }

    // Stage 6
    if (form.flocculation_time !== "") payload.measurements.flocculation_time = form.flocculation_time;

    // Stage 7
    if (form.cut_point_time !== "") payload.measurements.cut_point_time = form.cut_point_time;

    // Stage 13
    if (form.initial_ph !== "") payload.measurements.initial_ph = Number(form.initial_ph);
    if (form.pieces_quantity !== "") payload.measurements.pieces_quantity = Number(form.pieces_quantity);

    // Stage 14
    if (form.press_start_time !== "") payload.measurements.press_start_time = form.press_start_time;

    // Stage 15 - pH measurements
    const phEdits = form.ph_measurements
      .map((v, i) => ({ index: i, value: Number(v) }))
      .filter((e, i) => form.ph_measurements[i] !== "");
    if (phEdits.length > 0) payload.measurements.ph_measurements = phEdits;

    // Stage 15 - viradas
    if (form.turningCyclesCount !== "") payload.topLevel.turningCyclesCount = Number(form.turningCyclesCount);

    // Stage 19
    if (form.chamber2EntryDate !== "") payload.topLevel.chamber2EntryDate = form.chamber2EntryDate;
    if (form.maturationEndDate !== "") payload.topLevel.maturationEndDate = form.maturationEndDate;

    // Top-level milk volume
    if (form.milkVolumeL !== "") payload.topLevel.milkVolumeL = Number(form.milkVolumeL);

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
