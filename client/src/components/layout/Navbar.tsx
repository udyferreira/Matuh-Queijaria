import { Link, useLocation } from "wouter";
import { Activity, Settings, ChefHat, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import logoMatuh from "@assets/logoMatuh_1767667488292.jpg";

export function Navbar() {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Painel", icon: Activity },
    { href: "/new", label: "Novo Lote", icon: ChefHat },
    { href: "/reports", label: "Relatórios", icon: FileText },
    { href: "/alexa", label: "Integrações", icon: Settings },
  ];

  return (
    <nav className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <img 
            src={logoMatuh} 
            alt="Matuh Queijaria" 
            className="w-10 h-10 rounded-lg object-cover shadow-lg"
          />
          <span className="font-display font-bold text-xl tracking-tight">
            Matuh <span className="text-primary">Queijaria</span>
          </span>
        </Link>

        <div className="flex items-center gap-1">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200",
              location === item.href 
                ? "bg-primary/10 text-primary" 
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}>
              <item.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
