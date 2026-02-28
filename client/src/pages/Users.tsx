import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { UserPlus, Trash2, Users as UsersIcon } from "lucide-react";

interface UserData {
  id: number;
  username: string;
  name: string;
  role: string;
  createdAt: string;
}

export default function Users() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const { data: users = [], isLoading } = useQuery<UserData[]>({
    queryKey: ["/api/users"],
    refetchInterval: 10000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/users", { name, username, password });
    },
    onSuccess: () => {
      toast({ title: "Usuário criado com sucesso" });
      setName("");
      setUsername("");
      setPassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (err: any) => {
      const msg = err.message?.includes("409") ? "Usuário já existe" : "Erro ao criar usuário";
      toast({ title: msg, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Usuário removido" });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (err: any) => {
      const msg = err.message?.includes("400") ? "Não é possível remover seu próprio usuário" : "Erro ao remover";
      toast({ title: msg, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast({ title: "Senha deve ter pelo menos 6 caracteres", variant: "destructive" });
      return;
    }
    createMutation.mutate();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <UsersIcon className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Gestão de Usuários</h1>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Novo Usuário
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  data-testid="input-user-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nome completo"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="new-username">Usuário</Label>
                  <Input
                    id="new-username"
                    data-testid="input-new-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="nome.usuario"
                    autoComplete="off"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">Senha</Label>
                  <Input
                    id="new-password"
                    data-testid="input-new-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                data-testid="button-create-user"
              >
                {createMutation.isPending ? "Criando..." : "Criar Usuário"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Usuários Cadastrados</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground text-center py-4">Carregando...</p>
            ) : users.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">Nenhum usuário cadastrado</p>
            ) : (
              <div className="space-y-2">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between bg-secondary/30 rounded-md px-4 py-3"
                    data-testid={`row-user-${user.id}`}
                  >
                    <div>
                      <span className="font-medium">{user.name}</span>
                      <span className="text-muted-foreground text-sm ml-2">@{user.username}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString("pt-BR")}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(user.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-user-${user.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
