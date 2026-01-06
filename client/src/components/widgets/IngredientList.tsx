import { Droplet, Milk, TestTube } from "lucide-react";

interface CalculatedInputs {
  milk_volume_l?: number;
  ingredients?: {
    ferment_lr_ml?: number;
    ferment_dx_ml?: number;
    ferment_kl_ml?: number;
    rennet_ml?: number;
  };
}

export function IngredientList({ inputs }: { inputs: CalculatedInputs }) {
  if (!inputs.ingredients) return null;

  const items = [
    { name: "Ferment LR", value: inputs.ingredients.ferment_lr_ml, unit: "ml", icon: TestTube, color: "text-blue-400" },
    { name: "Ferment DX", value: inputs.ingredients.ferment_dx_ml, unit: "ml", icon: TestTube, color: "text-purple-400" },
    { name: "Ferment KL", value: inputs.ingredients.ferment_kl_ml, unit: "ml", icon: TestTube, color: "text-pink-400" },
    { name: "Rennet", value: inputs.ingredients.rennet_ml, unit: "ml", icon: Droplet, color: "text-amber-400" },
  ];

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
