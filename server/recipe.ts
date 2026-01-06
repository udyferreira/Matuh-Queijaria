import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ProductionBatch } from '@shared/schema';

// Types matching the YAML structure
interface RecipeStage {
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
  loop_actions?: string[];
  llm_guidance?: string;
  parameters?: Record<string, any>;
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

  validateAdvance(batch: ProductionBatch, currentStage: RecipeStage): { allowed: boolean; reason?: string } {
    // 1. Check required inputs
    if (currentStage.operator_input_required) {
      const measurements = batch.measurements as Record<string, any>;
      const missingInputs = currentStage.operator_input_required.filter(key => !measurements || measurements[key] === undefined);
      
      // Special case for initial milk volume which is on the batch root
      if (currentStage.operator_input_required.includes('milk_volume_l') && !batch.milkVolumeL) {
         return { allowed: false, reason: "Missing milk volume" };
      }

      if (missingInputs.length > 0 && !missingInputs.includes('milk_volume_l')) {
        return { allowed: false, reason: `Missing required inputs: ${missingInputs.join(', ')}` };
      }
    }

    // 2. Check blocking timers
    if (currentStage.timer && currentStage.timer.blocking) {
      const activeTimers = (batch.activeTimers as any[]) || [];
      const stageTimer = activeTimers.find(t => t.stageId === currentStage.id);
      
      // Timer blocking DEVE existir para esta etapa
      if (!stageTimer) {
        // Isso pode acontecer se o timer não foi iniciado corretamente
        // Não deveria ocorrer em fluxo normal, mas protege contra manipulação
        return { allowed: false, reason: `Esta etapa requer aguardar o timer. Reinicie a etapa.` };
      }
      
      const now = new Date();
      const endTime = new Date(stageTimer.endTime);
      
      if (now < endTime) {
        const remainingMin = Math.ceil((endTime.getTime() - now.getTime()) / 60000);
        return { allowed: false, reason: `Aguarde o timer. Faltam ${remainingMin} minutos.` };
      }
      // Timer expirou - permite avançar
    }

    // 3. Loop conditions (e.g. pH check)
    if (currentStage.type === 'loop' && currentStage.loop_condition) {
       // Logic to check if loop exit condition is met
       // Simplification: logic is handled in the route handler or specific specialized logic
    }

    return { allowed: true };
  }
}

export const recipeManager = new RecipeManager();
