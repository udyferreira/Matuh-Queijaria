import { Droplet, TestTube } from "lucide-react";

interface CalculatedInputs {
  FERMENT_LR?: number;
  FERMENT_DX?: number;
  FERMENT_KL?: number;
  RENNET?: number;
}

export function IngredientList({ inputs }: { inputs: CalculatedInputs }) {
  if (!inputs || Object.keys(inputs).length === 0) return null;

  const items = [
    { name: "Fermento LR", value: inputs.FERMENT_LR, unit: "ml", icon: TestTube, color: "text-blue-400" },
    { name: "Fermento DX", value: inputs.FERMENT_DX, unit: "ml", icon: TestTube, color: "text-purple-400" },
    { name: "Fermento KL", value: inputs.FERMENT_KL, unit: "ml", icon: TestTube, color: "text-pink-400" },
    { name: "Coalho", value: inputs.RENNET, unit: "ml", icon: Droplet, color: "text-amber-400" },
  ].filter(item => item.value !== undefined);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((item) => (
        <div key={item.name} className="bg-secondary/30 rounded-xl p-4 border border-white/5 flex flex-col items-center text-center hover:bg-secondary/50 transition-colors">
          <div className={`p-2 rounded-full bg-background mb-3 ${item.color}`}>
            <item.icon className="w-5 h-5" />
          </div>
          <span className="text-sm text-muted-foreground font-medium">{item.name}</span>
          <span className="text-2xl font-bold mt-1">
            {item.value}<span className="text-sm font-normal text-muted-foreground ml-1">{item.unit}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
