import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { 
  type InsertBatch, 
  type StartBatchRequest,
  type AdvanceStageRequest,
  type LogMeasurementRequest
} from "@shared/schema";

export function useBatches() {
  return useQuery({
    queryKey: [api.batches.list.path],
    queryFn: async () => {
      const res = await fetch(api.batches.list.path);
      if (!res.ok) throw new Error("Failed to fetch batches");
      return api.batches.list.responses[200].parse(await res.json());
    },
    refetchInterval: 5000, // Poll for updates
  });
}

export function useBatch(id: number) {
  return useQuery({
    queryKey: [api.batches.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.batches.get.path, { id });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Batch not found");
      return api.batches.get.responses[200].parse(await res.json());
    },
    refetchInterval: 2000, // Frequent updates for active production
  });
}

export function useBatchStatus(id: number) {
  return useQuery({
    queryKey: [api.batches.status.path, id],
    queryFn: async () => {
      const url = buildUrl(api.batches.status.path, { id });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Status not found");
      return api.batches.status.responses[200].parse(await res.json());
    },
    refetchInterval: 1000, // Real-time timer updates
  });
}

export function useBatchLogs(id: number) {
  return useQuery({
    queryKey: [api.batches.logs.path, id],
    queryFn: async () => {
      const url = buildUrl(api.batches.logs.path, { id });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Logs not found");
      return api.batches.logs.responses[200].parse(await res.json());
    },
  });
}

export function useStartBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: StartBatchRequest) => {
      const res = await fetch(api.batches.start.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to start batch");
      }
      return api.batches.start.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.batches.list.path] });
    },
  });
}

export function useAdvanceStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: AdvanceStageRequest }) => {
      const url = buildUrl(api.batches.advance.path, { id });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to advance stage");
      }
      return api.batches.advance.responses[200].parse(await res.json());
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [api.batches.get.path, id] });
      queryClient.invalidateQueries({ queryKey: [api.batches.status.path, id] });
      queryClient.invalidateQueries({ queryKey: [api.batches.logs.path, id] });
    },
  });
}

export function useLogMeasurement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: LogMeasurementRequest }) => {
      const url = buildUrl(api.batches.input.path, { id });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to log measurement");
      }
      return api.batches.input.responses[200].parse(await res.json());
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [api.batches.get.path, id] });
      queryClient.invalidateQueries({ queryKey: [api.batches.status.path, id] });
      queryClient.invalidateQueries({ queryKey: [api.batches.logs.path, id] });
    },
  });
}

export function usePauseBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason?: string }) => {
      const res = await fetch(`/api/batches/${id}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to pause batch");
      }
      return res.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [api.batches.get.path, id] });
      queryClient.invalidateQueries({ queryKey: [api.batches.list.path] });
    },
  });
}

export function useResumeBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const res = await fetch(`/api/batches/${id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to resume batch");
      }
      return res.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [api.batches.get.path, id] });
      queryClient.invalidateQueries({ queryKey: [api.batches.list.path] });
    },
  });
}

export function useCompleteBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const res = await fetch(`/api/batches/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to complete batch");
      }
      return res.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [api.batches.get.path, id] });
      queryClient.invalidateQueries({ queryKey: [api.batches.list.path] });
    },
  });
}

export function useCancelBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const res = await fetch(`/api/batches/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to cancel batch");
      }
      return res.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [api.batches.get.path, id] });
      queryClient.invalidateQueries({ queryKey: [api.batches.list.path] });
    },
  });
}
