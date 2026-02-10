import { Link } from "wouter";

export function Footer() {
  return (
    <footer className="border-t border-border/40 bg-background/95 py-6">
      <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>Matuh Queijaria</span>
        <div className="flex items-center gap-4">
          <Link
            href="/privacy"
            className="hover:text-foreground transition-colors"
            data-testid="link-privacy-policy"
          >
            Política de Privacidade
          </Link>
          <Link
            href="/terms"
            className="hover:text-foreground transition-colors"
            data-testid="link-terms-of-use"
          >
            Termos de Uso
          </Link>
        </div>
      </div>
    </footer>
  );
}
