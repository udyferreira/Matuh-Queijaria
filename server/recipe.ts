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
  timer?: {
    duration_min?: number;
    duration_hours?: number;
    blocking?: boolean;
    interval_hours?: number;
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

interface Recipe {
  schema_version: string;
  recipe_id: string;
  name: string;
  description?: string;
  stages: RecipeStage[];
  inputs: RecipeInput[];
}

export class RecipeManager {
  private recipe: Recipe;

  constructor() {
    try {
      const recipePath = path.join(process.cwd(), 'server', 'recipe.yml');
      const fileContents = fs.readFileSync(recipePath, 'utf8');
      this.recipe = yaml.load(fileContents) as Recipe;
      console.log(`Loaded recipe: ${this.recipe.name} with ${this.recipe.stages.length} stages`);
    } catch (e) {
      console.error("Failed to load recipe:", e);
      throw new Error("Recipe loading failed");
    }
  }

  getRecipeName(): string {
    return this.recipe.name;
  }

  getStage(stageId: number): RecipeStage | undefined {
    return this.recipe.stages.find(s => s.id === stageId);
  }

  getNextStage(currentStageId: number): RecipeStage | undefined {
    return this.recipe.stages.find(s => s.id === currentStageId + 1);
  }

  // New methods for expanded API

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
      }))
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
        intervalHours: stage.timer.interval_hours
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
    // For MVP, we only have one recipe
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
    if (!lock.locked) return true; // No lock, any intent allowed
    if (!lock.expectedIntent) return true; // No specific intent required
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
    
    // Parse the condition (e.g., "ph_value <= 5.2")
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
    return !!(stage?.timer?.interval_hours);
  }

  // Check if stage has a reminder
  hasReminder(stageId: number): boolean {
    const stage = this.getStage(stageId);
    return !!stage?.reminder;
  }

  calculateInputs(milkVolumeL: number): Record<string, number> {
    const calculated: Record<string, number> = {};
    
    this.recipe.inputs.forEach(input => {
      if (!input.dosing) return;
      
      let amount = 0;
      if (input.dosing.mode === 'per_2_liters') {
        amount = (milkVolumeL / 2) * input.dosing.value;
      } else if (input.dosing.mode === 'per_20_liters') {
        amount = (milkVolumeL / 20) * input.dosing.value;
      }
      
      // Round to 2 decimal places
      calculated[input.id] = Math.round(amount * 100) / 100;
    });

    return calculated;
  }

  validateAdvance(batch: ProductionBatch, currentStage: RecipeStage): { allowed: boolean; reason?: string; missingInputs?: string[]; blockingTimer?: boolean } {
    // 1. Check required inputs
    if (currentStage.operator_input_required) {
      const measurements = batch.measurements as Record<string, any>;
      
      // Map expected measurement keys to what's actually stored
      const keyMapping: Record<string, string> = {
        'ph_value': currentStage.id === 13 ? 'initial_ph' : 'ph_value',
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
        const friendlyMessages = this.getFriendlyInputMessages(currentStage.id, missingInputs);
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
  // Messages aligned with Alexa interactionModel samples
  getFriendlyInputMessages(stageId: number, missingInputs: string[]): string {
    const messages: string[] = [];
    
    for (const input of missingInputs) {
      switch (input) {
        case 'flocculation_time':
          messages.push("Registre o horário de floculação. Diga: 'hora da floculação às vinte e três e nove'");
          break;
        case 'cut_point_time':
          messages.push("Registre o horário do ponto de corte. Diga: 'hora do corte às quinze e trinta'");
          break;
        case 'ph_value':
          if (stageId === 13) {
            messages.push("Registre o pH inicial e a quantidade de peças. Diga: 'pH cinco vírgula dois com doze peças'");
          } else {
            messages.push("Registre o pH atual. Diga: 'pH cinco vírgula dois'");
          }
          break;
        case 'pieces_quantity':
          if (stageId !== 13) {
            messages.push("Registre a quantidade de peças. Diga: 'são 12 peças'");
          }
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
          if (!messages.some(m => m.includes('iniciar novo lote'))) {
            messages.push("Para iniciar um novo lote, diga: 'iniciar novo lote com 130 litros, temperatura 32 graus, pH seis vírgula cinco'");
          }
          break;
        default:
          messages.push(`Registre: ${input}`);
      }
    }
    
    return messages.join('. ');
  }
  
  // Get the intent hint for a missing input
  // Intent names must match exactly the Alexa interactionModel
  getIntentHintForInput(stageId: number, inputKey: string): string {
    switch (inputKey) {
      case 'flocculation_time':
        // TIME_TYPE slot values: floculação, floculacao
        return 'LogTimeIntent com timeType=floculação';
      case 'cut_point_time':
        // TIME_TYPE slot values: corte (synonym: ponto de corte)
        return 'LogTimeIntent com timeType=corte';
      case 'press_start_time':
        // TIME_TYPE slot values: prensa
        return 'LogTimeIntent com timeType=prensa';
      case 'ph_value':
      case 'pieces_quantity':
        return 'RegisterPHAndPiecesIntent';
      case 'chamber_2_entry_date':
        // Fixed: correct intent name from interactionModel
        return 'RegisterChamberEntryDateIntent';
      default:
        return 'ProcessCommandIntent';
    }
  }
}

export const recipeManager = new RecipeManager();

// Export TEST_MODE for use in routes
export { TEST_MODE };

// Helper function to get timer duration in minutes, respecting TEST_MODE
export function getTimerDurationMinutes(stage: RecipeStage | undefined): number {
  if (!stage?.timer) return 0;
  
  // In TEST_MODE, all timers are 1 minute
  if (TEST_MODE) return 1;
  
  // Normal mode: calculate from stage definition (sum both if present)
  const durationMin = stage.timer.duration_min || 0;
  const durationHours = stage.timer.duration_hours || 0;
  
  return durationMin + (durationHours * 60);
}

// Helper function to get interval duration in minutes, respecting TEST_MODE
export function getIntervalDurationMinutes(stage: RecipeStage | undefined): number {
  if (!stage?.timer?.interval_hours) return 0;
  
  // In TEST_MODE, all intervals are 1 minute
  if (TEST_MODE) return 1;
  
  return stage.timer.interval_hours * 60;
}

export function getWaitSpecForStage(stageId: number): WaitSpec | null {
  const stage = recipeManager.getStage(stageId);
  if (!stage) return null;

  if (stage.timer && (stage.timer.duration_min || stage.timer.duration_hours)) {
    const minutes = getTimerDurationMinutes(stage);
    if (minutes > 0) {
      return { seconds: minutes * 60, kind: 'timer', stageName: stage.name };
    }
  }

  if (stage.type === 'loop' && stage.max_loop_duration_hours) {
    const hours = stage.max_loop_duration_hours;
    const seconds = TEST_MODE ? 120 : hours * 3600;
    return { seconds, kind: 'loop_timeout', stageName: stage.name };
  }

  return null;
}
