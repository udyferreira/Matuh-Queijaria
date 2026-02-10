import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

export default function TermsOfUse() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <main className="container mx-auto px-4 py-12 flex-1 max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-display font-bold mb-2" data-testid="text-terms-title">
          Termos de Uso – Matuh Queijaria
        </h1>
        <p className="text-sm text-muted-foreground mb-8">Última atualização: 09/02/2026</p>

        <div className="space-y-6 text-foreground/90 leading-relaxed">
          <p>
            Ao utilizar a skill Matuh Queijaria, o usuário concorda com os termos e condições descritos a seguir.
          </p>

          <section>
            <h2 className="text-xl font-semibold mb-2">Finalidade da skill</h2>
            <p className="mb-3">
              A Matuh Queijaria é uma ferramenta de apoio operacional destinada a auxiliar no acompanhamento do processo produtivo de queijos artesanais, fornecendo orientações por voz, registrando informações operacionais e emitindo alertas de tempo quando aplicável.
            </p>
            <p>
              A skill tem caráter informativo e assistivo, não substituindo o conhecimento técnico, a experiência profissional ou a tomada de decisão do operador responsável pela produção.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Uso adequado</h2>
            <p>
              O usuário compromete-se a utilizar a Matuh Queijaria exclusivamente para fins relacionados ao acompanhamento do processo produtivo, de forma responsável e de acordo com as boas práticas da atividade exercida.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Limitação de responsabilidade</h2>
            <p className="mb-3">
              A Matuh Queijaria é fornecida "no estado em que se encontra", sem garantias de qualquer natureza.
            </p>
            <p className="mb-3">Os desenvolvedores não se responsabilizam por:</p>
            <ul className="list-disc list-inside space-y-1 pl-2 text-foreground/80">
              <li>falhas no processo produtivo;</li>
              <li>perdas financeiras;</li>
              <li>resultados decorrentes do uso inadequado das orientações fornecidas pela skill;</li>
              <li>interrupções no serviço causadas por indisponibilidade da plataforma Alexa ou da conexão à internet.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Alertas e lembretes</h2>
            <p className="mb-3">
              Quando autorizado pelo usuário, a skill pode criar lembretes utilizando os serviços nativos da Amazon Alexa.
            </p>
            <p>
              A entrega dos alertas depende da disponibilidade e funcionamento da plataforma Alexa, não sendo garantida em todos os cenários.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Modificações</h2>
            <p>
              Os Termos de Uso podem ser atualizados a qualquer momento para refletir melhorias na skill ou alterações legais. O uso contínuo da skill após eventuais atualizações implica concordância com os novos termos.
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
