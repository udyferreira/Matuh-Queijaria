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
  system_actions?: string[];
  timer?: {
    duration_min?: number;
    duration_hours?: number;
    blocking?: boolean;
    interval_hours?: number;
  };
  validations?: Array<{ rule: string }>;
  loop_condition?: { until: string };
  llm_guidance?: string;
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
  recipe_id: string;
  name: string;
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
