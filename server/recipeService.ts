import { db } from "./db";
import { recipes, productionBatches } from "@shared/schema";
import { eq, isNull, or } from "drizzle-orm";
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Build a recipe snapshot object from a DB recipe row
export function buildRecipeSnapshot(recipe: any): Record<string, any> {
  return {
    schema_version: recipe.schemaVersion || "1.0",
    recipe_id: recipe.recipeId,
    name: recipe.name,
    family: recipe.family || null,
    description: recipe.description || null,
    inputs: recipe.inputs || [],
    stages: recipe.stages || [],
  };
}

// Seed recipes table from YAML if table is empty
export async function seedRecipesIfEmpty(): Promise<void> {
  try {
    const existing = await db.select({ id: recipes.id }).from(recipes).limit(1);
    if (existing.length > 0) {
      console.log('[recipeService] Recipes table already seeded, skipping');
      return;
    }

    const recipePath = path.join(process.cwd(), 'server', 'recipe.yml');
    const yamlData = yaml.load(fs.readFileSync(recipePath, 'utf8')) as any;

    await db.insert(recipes).values({
      recipeId: yamlData.recipe_id,
      name: yamlData.name,
      family: yamlData.family || null,
      description: yamlData.description ? yamlData.description.trim() : null,
      schemaVersion: yamlData.schema_version || "1.0",
      batchMinL: yamlData.batch?.milk_volume_l?.min != null
        ? String(yamlData.batch.milk_volume_l.min)
        : null,
      batchMaxL: yamlData.batch?.milk_volume_l?.max != null
        ? String(yamlData.batch.milk_volume_l.max)
        : null,
      targetTemperatureC: yamlData.process?.target_temperature_c != null
        ? String(yamlData.process.target_temperature_c)
        : null,
      targetFinalPh: yamlData.process?.target_final_ph != null
        ? String(yamlData.process.target_final_ph)
        : null,
      maturationTargetDays: yamlData.process?.maturation_target_days ?? null,
      inputs: yamlData.inputs || [],
      stages: yamlData.stages || [],
    });

    console.log(`[recipeService] Seeded recipe: ${yamlData.name} (${yamlData.recipe_id})`);
  } catch (err) {
    console.error('[recipeService] Error seeding recipes:', err);
  }
}

// Backfill recipe_snapshot and recipe_name for existing batches that lack them
export async function backfillBatchSnapshots(): Promise<void> {
  try {
    // Find all batches where recipe_snapshot is null
    const batchesWithoutSnapshot = await db
      .select({ id: productionBatches.id, recipeId: productionBatches.recipeId })
      .from(productionBatches)
      .where(isNull(productionBatches.recipeSnapshot));

    if (batchesWithoutSnapshot.length === 0) {
      console.log('[recipeService] All batches already have snapshots');
      return;
    }

    // Group by recipeId so we fetch each recipe only once
    const recipeIdSet = [...new Set(batchesWithoutSnapshot.map(b => b.recipeId))];
    const recipeMap: Record<string, any> = {};

    for (const rid of recipeIdSet) {
      const [recipe] = await db.select().from(recipes).where(eq(recipes.recipeId, rid));
      if (recipe) {
        recipeMap[rid] = recipe;
      }
    }

    let count = 0;
    for (const batch of batchesWithoutSnapshot) {
      const recipe = recipeMap[batch.recipeId];
      if (!recipe) continue;

      const snapshot = buildRecipeSnapshot(recipe);
      await db.update(productionBatches)
        .set({ recipeSnapshot: snapshot, recipeName: recipe.name, updatedAt: new Date() })
        .where(eq(productionBatches.id, batch.id));
      count++;
    }

    console.log(`[recipeService] Backfilled ${count} batch(es) with recipe snapshots`);
  } catch (err) {
    console.error('[recipeService] Error backfilling batch snapshots:', err);
  }
}

// --- CRUD ---

export async function getAllRecipes() {
  return await db.select().from(recipes).orderBy(recipes.name);
}

export async function getRecipeById(recipeId: string) {
  const [recipe] = await db.select().from(recipes).where(eq(recipes.recipeId, recipeId));
  return recipe ?? null;
}

export async function getRecipeByDbId(id: number) {
  const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
  return recipe ?? null;
}

export async function createRecipe(data: {
  recipeId: string;
  name: string;
  family?: string | null;
  description?: string | null;
  schemaVersion?: string | null;
  batchMinL?: string | null;
  batchMaxL?: string | null;
  targetTemperatureC?: string | null;
  targetFinalPh?: string | null;
  maturationTargetDays?: number | null;
  inputs?: any[];
  stages?: any[];
}) {
  const [recipe] = await db.insert(recipes).values({
    ...data,
    inputs: data.inputs || [],
    stages: data.stages || [],
  }).returning();
  return recipe;
}

export async function updateRecipe(
  recipeId: string,
  data: Partial<{
    name: string;
    family: string | null;
    description: string | null;
    schemaVersion: string | null;
    batchMinL: string | null;
    batchMaxL: string | null;
    targetTemperatureC: string | null;
    targetFinalPh: string | null;
    maturationTargetDays: number | null;
    inputs: any[];
    stages: any[];
  }>
) {
  const [recipe] = await db.update(recipes)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(recipes.recipeId, recipeId))
    .returning();
  return recipe ?? null;
}

export async function deleteRecipe(recipeId: string): Promise<{ deleted: boolean; reason?: string }> {
  // Check for active batches using this recipe
  const activeBatches = await db
    .select({ id: productionBatches.id })
    .from(productionBatches)
    .where(eq(productionBatches.recipeId, recipeId));

  const activeOnes = activeBatches.filter(b => true); // All batches referencing this recipe
  // Actually only block on active/in-progress ones
  const allBatchesForRecipe = await db
    .select({ id: productionBatches.id, status: productionBatches.status })
    .from(productionBatches)
    .where(eq(productionBatches.recipeId, recipeId));

  const blockers = allBatchesForRecipe.filter(b => b.status === 'active');
  if (blockers.length > 0) {
    return {
      deleted: false,
      reason: `Há ${blockers.length} lote(s) ativo(s) usando esta receita. Conclua ou cancele os lotes antes de excluir.`,
    };
  }

  await db.delete(recipes).where(eq(recipes.recipeId, recipeId));
  return { deleted: true };
}

// Get snapshot + name for batch creation
export async function getRecipeSnapshotForBatch(recipeId: string): Promise<{ snapshot: any; name: string } | null> {
  const recipe = await getRecipeById(recipeId);
  if (!recipe) return null;
  return {
    snapshot: buildRecipeSnapshot(recipe),
    name: recipe.name,
  };
}
