import { Switch, Route } from "wouter";
import { queryClient, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Home from "@/pages/Home";
import NewBatch from "@/pages/NewBatch";
import BatchDetail from "@/pages/BatchDetail";
import AlexaIntegration from "@/pages/AlexaIntegration";
import Reports from "@/pages/Reports";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import TermsOfUse from "@/pages/TermsOfUse";
import Users from "@/pages/Users";
import Login from "@/pages/Login";

function AuthenticatedRouter() {
  const { data: user, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/privacy" component={PrivacyPolicy} />
        <Route path="/terms" component={TermsOfUse} />
        <Route>
          <Login onLogin={() => refetch()} />
        </Route>
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/new" component={NewBatch} />
      <Route path="/batch/:id" component={BatchDetail} />
      <Route path="/alexa" component={AlexaIntegration} />
      <Route path="/reports" component={Reports} />
      <Route path="/users" component={Users} />
      <Route path="/privacy" component={PrivacyPolicy} />
      <Route path="/terms" component={TermsOfUse} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthenticatedRouter />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
