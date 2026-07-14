import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ProductionBatch } from '@shared/schema';

// TEST_MODE: When enabled, all timers are reduced to 1 minute for faster testing
const TEST_MODE = process.env.TEST_MODE === 'true';

if (TEST_MODE) {
  console.log('[TEST_MODE] All timers reduced to 1 minute for testing');
}

export interface WaitSpec {
  seconds: number;
  kind: 'timer' | 'loop_timeout';
  stageName: string;
}

export interface RecipeStage {
  id: number;
  name: string;
  type: string;
  operator_input_required?: string[];
  stored_values?: string[];
  system_actions?: string[];
  instructions?: string[];
  auto_record_timestamp?: string;
  timer?: {
    duration_min?: number;
    duration_hours?: number;
    blocking?: boolean;
    interval_hours?: number;
    interval_min?: number;
  };
  reminder?: {
    frequency: string;
  };
  validations?: Array<{ rule: string }>;
  loop_condition?: { until: string };
  max_loop_duration_hours?: number;
  loop_actions?: string[];
  llm_guidance?: string;
  parameters?: Record<string, any>;
  expected_intent?: string;
  expected_time_type?: string;
  input_prompt?: string;
}

interface RecipeInput {
  id: string;
  name: string;
  unit: string;
  dosing: {
    mode: string;
    value: number;
  };
}

interface DerivedVolume {
  id: string;
  name: string;
  description?: string;
  pct_of_milk: number;
  unit: string;
}

interface RecipeProcess {
  target_temperature_c?: number;
  temperature_tolerance_c?: number;
  target_final_ph?: number;
  maturation_target_days?: number;
  semi_cook_target_temp_c?: number;
  semi_cook_rate_c_per_min?: number;
}

interface Recipe {
  schema_version: string;
  recipe_id: string;
  name: string;
  description?: string;
  stages: RecipeStage[];
  inputs: RecipeInput[];
  derived_volumes?: DerivedVolume[];
  process?: RecipeProcess;
}

export class RecipeManager {
  private recipe: Recipe;

  constructor(recipeData: Recipe) {
    this.recipe = recipeData;
  }

  static fromData(data: any): RecipeManager {
    return new RecipeManager(data as Recipe);
  }

  getRecipeName(): string {
    return this.recipe.name;
  }

  getRecipeId(): string {
    return this.recipe.recipe_id;
  }

  getMaturationDays(): number {
    return this.recipe.process?.maturation_target_days ?? 90;
  }

  getDerivedVolumes(): DerivedVolume[] {
    return this.recipe.derived_volumes || [];
  }

  getStage(stageId: number): RecipeStage | undefined {
    return this.recipe.stages.find(s => s.id === stageId);
  }

  getNextStage(currentStageId: number): RecipeStage | undefined {
    return this.recipe.stages.find(s => s.id === currentStageId + 1);
  }

  getRecipeSummary() {
    return {
      recipeId: this.recipe.recipe_id,
      name: this.recipe.name,
      schemaVersion: this.recipe.schema_version || "1.0",
      stageCount: this.recipe.stages.length
    };
  }

  getRecipeDetail() {
    return {
      ...this.getRecipeSummary(),
      description: this.recipe.description,
      stages: this.recipe.stages.map(s => this.formatStageDetail(s)),
      inputs: this.recipe.inputs.map(i => ({
        id: i.id,
        name: i.name,
        unit: i.unit,
        dosing: i.dosing
      })),
      derivedVolumes: this.recipe.derived_volumes || []
    };
  }

  formatStageDetail(stage: RecipeStage) {
    return {
      stageId: stage.id,
      name: stage.name,
      type: stage.type,
      instructions: stage.instructions,
      requiredInputs: stage.operator_input_required,
      storedValues: stage.stored_values,
      validations: stage.validations,
      timer: stage.timer ? {
        durationMin: stage.timer.duration_min,
        durationHours: stage.timer.duration_hours,
        blocking: stage.timer.blocking,
        intervalHours: stage.timer.interval_hours,
        intervalMin: stage.timer.interval_min
      } : undefined,
      reminder: stage.reminder,
      loopCondition: stage.loop_condition ? {
        until: stage.loop_condition.until
      } : undefined,
      loopActions: stage.loop_actions,
      llmGuidance: stage.llm_guidance,
      parameters: stage.parameters
    };
  }

  getAllRecipes() {
    return [this.getRecipeSummary()];
  }

  getExpectedInputsForStage(stageId: number): string[] {
    const stage = this.getStage(stageId);
    return stage?.operator_input_required || [];
  }

  isValidInputForStage(stageId: number, key: string): boolean {
    const expectedInputs = this.getExpectedInputsForStage(stageId);
    return expectedInputs.includes(key);
  }

  // Stage input lock: returns expected intent and prompt if stage requires structured input
  getStageInputLock(stageId: number): { locked: boolean; expectedIntent?: string; expectedTimeType?: string; inputPrompt?: string } {
    const stage = this.getStage(stageId);
    if (!stage?.operator_input_required || stage.operator_input_required.length === 0) {
      return { locked: false };
    }
    
    return {
      locked: true,
      expectedIntent: stage.expected_intent,
      expectedTimeType: stage.expected_time_type,
      inputPrompt: stage.input_prompt || `Esta etapa requer input do operador: ${stage.operator_input_required.join(', ')}`
    };
  }

  // Check if intent matches stage expectation
  isExpectedIntentForStage(stageId: number, intentName: string): boolean {
    const lock = this.getStageInputLock(stageId);
    if (!lock.locked) return true;
    if (!lock.expectedIntent) return true;
    return lock.expectedIntent === intentName;
  }

  // Check if stage has a loop condition
  isLoopStage(stageId: number): boolean {
    const stage = this.getStage(stageId);
    return stage?.type === 'loop' && !!stage.loop_condition;
  }

  // Check if loop exit condition is met
  checkLoopExitCondition(stageId: number, measurements: Record<string, any>): boolean {
    const stage = this.getStage(stageId);
    if (!stage?.loop_condition) return true;
    
    const condition = stage.loop_condition.until;
    if (condition.includes('ph_value')) {
      const match = condition.match(/ph_value\s*(<=|<|>=|>|==)\s*([\d.]+)/);
      if (match) {
        const operator = match[1];
        const targetValue = parseFloat(match[2]);
        const currentPh = measurements.ph_value;
        
        if (currentPh === undefined) return false;
        
        switch (operator) {
          case '<=': return currentPh <= targetValue;
          case '<': return currentPh < targetValue;
          case '>=': return currentPh >= targetValue;
          case '>': return currentPh > targetValue;
          case '==': return currentPh === targetValue;
          default: return false;
        }
      }
    }
    return false;
  }

  // Check if stage has an interval timer (for loops)
  hasIntervalTimer(stageId: number): boolean {
    const stage = this.getStage(stageId);
    return !!(stage?.timer?.interval_hours || stage?.timer?.interval_min);
  }

  // Check if stage has a reminder
  hasReminder(stageId: number): boolean {
    const stage = this.getStage(stageId);
    return !!stage?.reminder;
  }

  calculateInputs(milkVolumeL: number): Record<string, number> {
    const calculated: Record<string, number> = {};
    
    // Calculate ferment/rennet inputs
    this.recipe.inputs.forEach(input => {
      if (!input.dosing) return;
      
      let amount = 0;
      if (input.dosing.mode === 'per_2_liters') {
        amount = (milkVolumeL / 2) * input.dosing.value;
      } else if (input.dosing.mode === 'per_20_liters') {
        amount = (milkVolumeL / 20) * input.dosing.value;
      }
      
      calculated[input.id] = Math.round(amount * 100) / 100;
    });

    // Calculate derived volumes (e.g. SMALL_TANK_MILK=10%, HOT_WATER=20%, WHEY_TO_REMOVE=20%)
    if (this.recipe.derived_volumes) {
      this.recipe.derived_volumes.forEach(dv => {
        const amount = milkVolumeL * dv.pct_of_milk;
        calculated[dv.id] = Math.round(amount * 100) / 100;
      });
    }

    return calculated;
  }

  validateAdvance(batch: ProductionBatch, currentStage: RecipeStage): { allowed: boolean; reason?: string; missingInputs?: string[]; blockingTimer?: boolean } {
    // 1. Check required inputs
    if (currentStage.operator_input_required) {
      const measurements = batch.measurements as Record<string, any>;
      
      // Use stored_values to detect the initial_ph stage (works for any recipe)
      const isInitialPhStage = currentStage.stored_values?.includes('initial_ph') ?? false;
      const keyMapping: Record<string, string> = {
        'ph_value': isInitialPhStage ? 'initial_ph' : 'ph_value',
        'flocculation_time': 'flocculation_time',
        'cut_point_time': 'cut_point_time',
        'press_start_time': 'press_start_time',
        'chamber_2_entry_date': 'chamber_2_entry_date',
        'pieces_quantity': 'pieces_quantity',
        'milk_volume_l': 'milk_volume_l',
        'milk_temperature_c': 'milk_temperature_c',
        'milk_ph': 'milk_ph'
      };
      
      const missingInputs = currentStage.operator_input_required.filter(key => {
        if (key === 'milk_volume_l') {
          return !batch.milkVolumeL;
        }
        if (key === 'chamber_2_entry_date') {
          return !(batch as any).chamber2EntryDate;
        }
        const storedKey = keyMapping[key] || key;
        return !measurements || measurements[storedKey] === undefined;
      });
      
      if (missingInputs.length > 0) {
        const friendlyMessages = this.getFriendlyInputMessages(currentStage, missingInputs);
        return { 
          allowed: false, 
          reason: friendlyMessages,
          missingInputs
        };
      }
    }

    // 2. Check blocking timers
    if (currentStage.timer && currentStage.timer.blocking) {
      const activeTimers = (batch.activeTimers as any[]) || [];
      const stageTimer = activeTimers.find(t => t.stageId === currentStage.id);
      
      if (stageTimer) {
        const now = new Date();
        const endTime = new Date(stageTimer.endTime);
        
        if (now < endTime) {
          const remainingMin = Math.ceil((endTime.getTime() - now.getTime()) / 60000);
          return { 
            allowed: false, 
            reason: `Aguarde o timer terminar. Faltam ${remainingMin} minuto${remainingMin > 1 ? 's' : ''}.`,
            blockingTimer: true
          };
        }
      }
    }

    // 3. Loop conditions (e.g. pH check) - handled in batchService
    if (currentStage.type === 'loop' && currentStage.loop_condition) {
       // Logic is handled in batchService.advanceBatch
    }

    return { allowed: true };
  }
  
  // Generate friendly messages based on stage and missing inputs
  getFriendlyInputMessages(stage: RecipeStage, missingInputs: string[]): string {
    const messages: string[] = [];
    const isInitialPhStage = stage.stored_values?.includes('initial_ph') ?? false;
    
    for (const input of missingInputs) {
      switch (input) {
        case 'flocculation_time':
          messages.push("Registre o horário de floculação. Diga: 'hora da floculação às vinte e três e nove'");
          break;
        case 'cut_point_time':
          messages.push("Registre o horário do ponto de corte. Diga: 'hora do corte às quinze e trinta'");
          break;
        case 'ph_value':
          if (isInitialPhStage) {
            messages.push("Registre o pH inicial. Diga: 'pH cinco vírgula dois'");
          } else {
            messages.push("Registre o pH atual. Diga: 'pH cinco vírgula dois'");
          }
          break;
        case 'pieces_quantity':
          messages.push("Registre a quantidade de peças. Diga: 'doze peças'");
          break;
        case 'press_start_time':
          messages.push("Registre o horário de início da prensa. Diga: 'hora da prensa às dezesseis e dez'");
          break;
        case 'chamber_2_entry_date':
          messages.push("Registre a data de entrada na Câmara 2. Diga: 'coloquei na câmara dois hoje'");
          break;
        case 'milk_volume_l':
        case 'milk_temperature_c':
        case 'milk_ph':
          if (!messages.some(m => m.includes('novo lote'))) {
            messages.push("Para iniciar um novo lote, diga apenas a quantidade de leite. Por exemplo: 'novo lote com 130 litros'. Eu perguntarei a temperatura e o pH depois");
          }
          break;
        default:
          messages.push(`Registre: ${input}`);
      }
    }
    
    return messages.join('. ');
  }
  
  // Get the intent hint for a missing input
  getIntentHintForInput(stageId: number, inputKey: string): string {
    switch (inputKey) {
      case 'flocculation_time':
        return 'LogTimeIntent com timeType=floculação';
      case 'cut_point_time':
        return 'LogTimeIntent com timeType=corte';
      case 'press_start_time':
        return 'LogTimeIntent com timeType=prensa';
      case 'ph_value':
      case 'pieces_quantity':
        return 'RegisterPHAndPiecesIntent';
      case 'chamber_2_entry_date':
        return 'RegisterChamberEntryDateIntent';
      default:
        return 'ProcessCommandIntent';
    }
  }
}

// --- RecipeRegistry: loads all recipe-*.yml files at startup ---

class RecipeRegistry {
  private managers: Map<string, RecipeManager> = new Map();

  constructor() {
    const serverDir = path.join(process.cwd(), 'server');
    let files: string[] = [];
    try {
      files = fs.readdirSync(serverDir).filter(f => /^recipe-.+\.yml$/.test(f)).sort();
    } catch (e) {
      console.error('[RecipeRegistry] Could not read server directory:', e);
    }

    for (const file of files) {
      try {
        const filePath = path.join(serverDir, file);
        const contents = fs.readFileSync(filePath, 'utf8');
        const data = yaml.load(contents) as Recipe;
        const manager = new RecipeManager(data);
        this.managers.set(data.recipe_id, manager);
        console.log(`[RecipeRegistry] Loaded: ${data.name} (${data.recipe_id}) — ${data.stages.length} stages`);
      } catch (e) {
        console.error(`[RecipeRegistry] Failed to load ${file}:`, e);
      }
    }

    if (this.managers.size === 0) {
      throw new Error('[RecipeRegistry] No recipes loaded. Check server/recipe-*.yml files.');
    }
  }

  getForRecipeId(recipeId: string): RecipeManager | undefined {
    return this.managers.get(recipeId);
  }

  getDefault(): RecipeManager {
    return this.managers.get('QUEIJO_NETE') || [...this.managers.values()][0];
  }

  getAllSummaries() {
    return [...this.managers.values()].map(m => m.getRecipeSummary());
  }
}

export const recipeRegistry = new RecipeRegistry();

// Keep recipeManager pointing to Nete for backward compatibility
// (used in alexaReminders.ts and places in routes.ts that need any valid recipe)
export const recipeManager = recipeRegistry.getDefault();

// Export TEST_MODE for use in routes
export { TEST_MODE };

// Returns the RecipeManager for the given batch, dispatching by recipeId
export function getRecipeForBatch(batch: any): RecipeManager {
  const recipeId = batch?.recipeId;
  if (recipeId) {
    const rm = recipeRegistry.getForRecipeId(recipeId);
    if (rm) return rm;
  }
  return recipeManager;
}

// Helper function to get timer duration in minutes, respecting TEST_MODE
export function getTimerDurationMinutes(stage: RecipeStage | undefined): number {
  if (!stage?.timer) return 0;
  
  if (TEST_MODE) return 1;
  
  const durationMin = stage.timer.duration_min || 0;
  const durationHours = stage.timer.duration_hours || 0;
  
  return durationMin + (durationHours * 60);
}

// Helper function to get interval duration in minutes, respecting TEST_MODE
export function getIntervalDurationMinutes(stage: RecipeStage | undefined): number {
  if (!stage?.timer) return 0;
  
  if (TEST_MODE) return 1;
  
  if (stage.timer.interval_min) return stage.timer.interval_min;
  if (stage.timer.interval_hours) return stage.timer.interval_hours * 60;
  return 0;
}

export function getWaitSpecForStage(stageId: number): WaitSpec | null {
  const stage = recipeManager.getStage(stageId);
  return getWaitSpecForStageData(stage);
}

// Batch-isolated variant: accepts a stage object already resolved from the batch's snapshot.
// Use this instead of getWaitSpecForStage() whenever a batch object is in scope.
export function getWaitSpecForStageData(stage: RecipeStage | undefined | null): WaitSpec | null {
  if (!stage) return null;

  if (stage.timer && (stage.timer.duration_min || stage.timer.duration_hours)) {
    const minutes = getTimerDurationMinutes(stage);
    if (minutes > 0) {
      return { seconds: minutes * 60, kind: 'timer', stageName: stage.name };
    }
  }

  if (stage.type === 'loop' && stage.max_loop_duration_hours) {
    // Loop stages controlled by periodic pH checks manage their own timer in logPh
    if (stage.loop_actions?.includes('medir_ph')) return null;
    const hours = stage.max_loop_duration_hours;
    const seconds = TEST_MODE ? 120 : hours * 3600;
    return { seconds, kind: 'loop_timeout', stageName: stage.name };
  }

  // Interval stages (e.g. Nina stage 15 semi-cozimento: interval_min:3)
  // Schedule an Alexa reminder for the interval duration so operator is alerted periodically
  if (stage.timer && (stage.timer.interval_min || stage.timer.interval_hours)) {
    const minutes = getIntervalDurationMinutes(stage);
    if (minutes > 0) {
      const seconds = TEST_MODE ? 60 : minutes * 60;
      return { seconds, kind: 'timer', stageName: stage.name };
    }
  }

  return null;
}
