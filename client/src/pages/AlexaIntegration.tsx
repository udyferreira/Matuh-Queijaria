import { Navbar } from "@/components/layout/Navbar";
import { Mic, Check, Wifi, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AlexaIntegration() {
  const webhookUrl = `${window.location.origin}/api/alexa/webhook`;

  return (
    <div className="min-h-screen bg-background pb-20">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="text-center mb-12">
          <div className="w-20 h-20 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-6 text-blue-400">
            <Mic className="w-10 h-10" />
          </div>
          <h1 className="text-4xl font-display font-bold mb-4">Voice Control</h1>
          <p className="text-xl text-muted-foreground">
            Connect Alexa to control production hands-free.
          </p>
        </div>

        <div className="grid gap-8">
          <div className="glass-card p-8 rounded-2xl border border-white/10">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Wifi className="w-5 h-5 text-primary" />
              Connection Details
            </h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2 text-muted-foreground">Webhook URL</label>
                <div className="flex gap-2">
                  <Input readOnly value={webhookUrl} className="font-mono bg-secondary/50" />
                  <Button variant="outline" onClick={() => navigator.clipboard.writeText(webhookUrl)}>
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Paste this URL into your Alexa Skill configuration console.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-muted-foreground">Access Token</label>
                <div className="flex gap-2">
                   <div className="relative flex-1">
                      <Input readOnly value="sk_production_88291..." type="password" className="font-mono bg-secondary/50 pr-10" />
                      <Key className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                   </div>
                   <Button variant="outline">Regenerate</Button>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-bold text-lg">Supported Commands</h3>
            <div className="grid md:grid-cols-2 gap-4">
              {[
                'Alexa, ask Nete status',
                'Alexa, tell Nete I added the rennet',
                'Alexa, ask Nete for the next step',
                'Alexa, set a timer for 30 minutes'
              ].map((cmd, i) => (
                <div key={i} className="bg-secondary/30 p-4 rounded-xl border border-white/5 flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                    <Check className="w-3 h-3 text-blue-400" />
                  </div>
                  <span className="font-medium italic text-muted-foreground">"{cmd}"</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
