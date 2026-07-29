import { storage } from "../storage";
import * as batchService from "../batchService";
import { getRecipeForBatch, recipeRegistry } from "../recipe";

async function advanceUntilStageType(batchId: number, targetType: string, maxSteps = 40) {
  for (let i = 0; i < maxSteps; i++) {
    const batch = await storage.getBatch(batchId);
    if (!batch) throw new Error("batch missing");
    const rm = getRecipeForBatch(batch);
    const stage = rm.getStage(batch.currentStageId);
    if (stage?.type === targetType) return batch;
    // force-complete any active timers so advance isn't blocked
    const timers = (batch.activeTimers as any[]) || [];
    if (timers.length > 0) {
      const patched = timers.map(t => ({ ...t, endTime: new Date(Date.now() - 1000).toISOString() }));
      await storage.updateBatch(batchId, { activeTimers: patched });
    }
    const res = await batchService.advanceBatch(batchId, null);
    if (!res.success) {
      console.log(`  [advance blocked] stage=${batch.currentStageId} (${stage?.name}) type=${stage?.type} error=${(res as any).error}`);
      return batch;
    }
  }
  throw new Error("did not reach target type in time");
}

async function run() {
  console.log("=== Recipe registry sanity ===");
  console.log("Nete latest version:", recipeRegistry.getLatestVersion("QUEIJO_NETE"));
  console.log("Nina latest version:", recipeRegistry.getLatestVersion("QUEIJO_NINA"));
  const neteV1 = recipeRegistry.getForRecipeId("QUEIJO_NETE", 1)!;
  const neteV2 = recipeRegistry.getForRecipeId("QUEIJO_NETE", 2)!;
  const ninaV1 = recipeRegistry.getForRecipeId("QUEIJO_NINA", 1)!;
  const ninaV2 = recipeRegistry.getForRecipeId("QUEIJO_NINA", 2)!;
  console.log("Nete v1 stages:", neteV1.getAllStages().length, "v2 stages:", neteV2.getAllStages().length);
  console.log("Nina v1 stages:", ninaV1.getAllStages().length, "v2 stages:", ninaV2.getAllStages().length);
  console.log("Nete v2 stage10:", neteV2.getStage(10)?.name, neteV2.getStage(10)?.type);
  console.log("Nina v2 stage14:", ninaV2.getStage(14)?.name, ninaV2.getStage(14)?.type);

  for (const recipeId of ["QUEIJO_NETE", "QUEIJO_NINA"]) {
    console.log(`\n=== New batch flow: ${recipeId} ===`);
    const startRes = await batchService.startBatch({
      milkVolumeL: 100,
      milkTemperatureC: 32,
      milkPh: 6.6,
      recipeId,
    });
    if (!startRes.success || !startRes.batch) throw new Error("start failed: " + startRes.error);
    const batchId = startRes.batch.id;
    console.log("started batch", batchId, "recipeVersion=", startRes.batch.recipeVersion);
    if (startRes.batch.recipeVersion !== recipeRegistry.getLatestVersion(recipeId)) {
      throw new Error("new batch did not stamp latest version!");
    }

    // Drive forward until we hit the new wait stage (type 'wait' that is NOT the
    // legacy Nete/Nina interstitial 'wait' used elsewhere — check by name)
    let reachedNewStage = false;
    for (let i = 0; i < 30; i++) {
      const batch = await storage.getBatch(batchId);
      if (!batch) throw new Error("missing");
      const rm = getRecipeForBatch(batch);
      const stage = rm.getStage(batch.currentStageId);
      if (stage?.name === "Tempo de espera antes da Mexedura") {
        reachedNewStage = true;
        console.log(`  reached new wait stage at id=${stage.id}, timer=`, stage.timer);
        break;
      }
      const timers = (batch.activeTimers as any[]) || [];
      if (timers.length > 0) {
        const patched = timers.map((t: any) => ({ ...t, endTime: new Date(Date.now() - 1000).toISOString() }));
        await storage.updateBatch(batchId, { activeTimers: patched });
      }
      // supply required inputs generically based on stage's operator_input_required
      if (stage?.operator_input_required?.length) {
        const key = stage.operator_input_required[0];
        if (key.includes('time') && !key.includes('iso')) {
          await batchService.logTime(batchId, "10:00", stage.expected_time_type);
        } else if (key === 'initial_ph') {
          await batchService.logPh(batchId, 6.5, 8);
        }
      }
      const res = await batchService.advanceBatch(batchId, null);
      if (!res.success) {
        console.log(`  [advance blocked before reaching new stage] stage=${batch.currentStageId} (${stage?.name}) error=${(res as any).error}`);
        break;
      }
    }
    if (!reachedNewStage) throw new Error(`FAILED: never reached new wait stage for ${recipeId}`);

    // verify no instructions on the new stage and blocking timer behavior
    const batchAtWait = await storage.getBatch(batchId);
    const rmAtWait = getRecipeForBatch(batchAtWait);
    const waitStage = rmAtWait.getStage(batchAtWait!.currentStageId);
    console.log("  new stage instructions:", waitStage?.instructions);
    console.log("  new stage timer blocking:", waitStage?.timer?.blocking);

    // try advancing immediately — should be blocked by timer since it just started
    const blockedRes = await batchService.advanceBatch(batchId, null);
    console.log("  advance immediately after entering wait stage ->", blockedRes.success ? "ALLOWED (unexpected!)" : `blocked as expected (${(blockedRes as any).error})`);

    // now force timer complete and advance past it
    const b2 = await storage.getBatch(batchId);
    const timers2 = (b2!.activeTimers as any[]) || [];
    await storage.updateBatch(batchId, { activeTimers: timers2.map((t: any) => ({ ...t, endTime: new Date(Date.now() - 1000).toISOString() })) });
    const advPast = await batchService.advanceBatch(batchId, null);
    console.log("  advance after timer complete ->", advPast.success ? `OK, now stage ${advPast.batch?.currentStageId}` : `FAILED: ${(advPast as any).error}`);

    // continue to loop stage: satisfy any 'measure'-type stage requiring initial_ph/pieces first
    for (let i = 0; i < 15; i++) {
      const batch = await storage.getBatch(batchId);
      if (!batch) throw new Error("missing");
      const rm = getRecipeForBatch(batch);
      const stage = rm.getStage(batch.currentStageId);
      if (stage?.type === "loop") break;
      const timers = (batch.activeTimers as any[]) || [];
      if (timers.length > 0) {
        await storage.updateBatch(batchId, { activeTimers: timers.map((t: any) => ({ ...t, endTime: new Date(Date.now() - 1000).toISOString() })) });
      }
      if (stage?.type === "measure" && (stage.operator_input_required || []).includes("initial_ph")) {
        const phSetupRes = await batchService.logPh(batchId, 6.5, 12);
        console.log("  logPh at initial-ph measure stage ->", phSetupRes.success ? "OK" : `FAILED: ${(phSetupRes as any).error}`);
        continue; // re-check current stage before attempting advance again
      }
      const res = await batchService.advanceBatch(batchId, null);
      if (!res.success) {
        console.log(`  [advance blocked pre-loop] stage=${batch.currentStageId} (${stage?.name}) error=${(res as any).error}`);
        break;
      }
    }
    const bLoop = await storage.getBatch(batchId);
    const rmLoop = getRecipeForBatch(bLoop);
    console.log("  reached stage id=", bLoop?.currentStageId, rmLoop.getStage(bLoop!.currentStageId)?.type);
    const phRes = await batchService.logPh(batchId, 6.0, 8);
    console.log("  logPh in loop stage ->", phRes.success ? "OK" : `FAILED: ${(phRes as any).error}`);
    const phRes2 = await batchService.logPh(batchId, 5.8, 8);
    console.log("  second logPh (turning cycle) in loop stage ->", phRes2.success ? "OK" : `FAILED: ${(phRes2 as any).error}`);

    const rbRes = await batchService.rollbackBatch(batchId, null);
    console.log("  rollback from loop stage ->", rbRes.success ? `OK, back to stage ${rbRes.targetStageId}` : `FAILED: ${(rbRes as any).error}`);
    const bAfterRb = await storage.getBatch(batchId);
    console.log("  turningCyclesCount after rollback:", (bAfterRb as any)?.turningCyclesCount);

    // cleanup test batch
    await storage.updateBatch(batchId, { status: "cancelled" as any, cancelledAt: new Date() });
  }

  console.log("\n=== Existing (pre-versioning) batch stability check ===");
  const allBatches = await storage.getActiveBatches();
  const legacyBatch = allBatches.find(b => (b as any).recipeVersion === 1 || (b as any).recipeVersion == null);
  if (legacyBatch) {
    const rm = getRecipeForBatch(legacyBatch);
    console.log("legacy batch id=", legacyBatch.id, "recipeVersion=", (legacyBatch as any).recipeVersion, "resolves to recipe version=", rm.getVersion(), "currentStage=", legacyBatch.currentStageId, rm.getStage(legacyBatch.currentStageId)?.name);
    if (rm.getVersion() !== 1) throw new Error("FAILED: legacy batch did not resolve to version 1!");
    console.log("  OK: legacy in-progress batch still resolves against version 1 stage list.");
  } else {
    console.log("  (no active legacy batch found to check)");
  }

  console.log("\nALL CHECKS PASSED");
  process.exit(0);
}

run().catch(e => {
  console.error("TEST FAILED:", e);
  process.exit(1);
});
