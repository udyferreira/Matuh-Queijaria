import { Link } from "wouter";
import { BookOpen, Plus, ChevronRight, Beaker } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

export default function Recipes() {
  const { data: recipes = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/recipes"],
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-display font-bold">Receitas</h1>
            <p className="text-muted-foreground mt-1">
              Gerencie as receitas de queijo disponíveis para produção
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map(i => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
        ) : recipes.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg">Nenhuma receita encontrada.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {recipes.map((recipe: any) => (
              <Link key={recipe.recipeId} href={`/recipes/${recipe.recipeId}`}>
                <div
                  className="glass-card p-6 rounded-2xl border border-white/10 hover:border-primary/30 transition-all cursor-pointer group"
                  data-testid={`card-recipe-${recipe.recipeId}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary group-hover:bg-primary/20 transition-colors">
                        <Beaker className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h2 className="text-xl font-bold">{recipe.name}</h2>
                          {recipe.family && (
                            <Badge variant="outline" className="text-xs">
                              {recipe.family}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {recipe.description || "Sem descrição"}
                        </p>
                        <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                          {recipe.batchMinL && recipe.batchMaxL && (
                            <span>Volume: {recipe.batchMinL}–{recipe.batchMaxL}L</span>
                          )}
                          {recipe.targetFinalPh && (
                            <span>pH alvo: {recipe.targetFinalPh}</span>
                          )}
                          {recipe.stages?.length > 0 && (
                            <span>{recipe.stages.length} etapas</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
