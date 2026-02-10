import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <main className="container mx-auto px-4 py-12 flex-1 max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-display font-bold mb-2" data-testid="text-privacy-title">
          Política de Privacidade – Matuh Queijaria
        </h1>
        <p className="text-sm text-muted-foreground mb-8">Última atualização: 09/02/2026</p>

        <div className="space-y-6 text-foreground/90 leading-relaxed">
          <p>
            A aplicação e a skill Matuh Queijaria foram desenvolvidas para auxiliar no acompanhamento do processo produtivo de queijos artesanais por meio de interação por voz e interface web.
          </p>

          <section>
            <h2 className="text-xl font-semibold mb-2">Coleta de informações</h2>
            <p className="mb-3">
              A Matuh Queijaria não coleta, armazena ou processa dados pessoais dos usuários, tais como nome, endereço, e-mail, telefone ou localização.
            </p>
            <p className="mb-3">
              As informações utilizadas pela aplicação e pela skill referem-se exclusivamente a dados operacionais do processo produtivo, incluindo, mas não se limitando a:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2 text-foreground/80">
              <li>identificação de lotes de produção;</li>
              <li>etapas do processo;</li>
              <li>registros de horários;</li>
              <li>medições de pH;</li>
              <li>quantidade de peças;</li>
              <li>datas relacionadas ao processo produtivo.</li>
            </ul>
            <p className="mt-3">
              Essas informações não identificam indivíduos e são utilizadas apenas para o funcionamento da solução.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Uso de lembretes da Alexa</h2>
            <p className="mb-3">
              A skill Matuh Queijaria pode criar lembretes utilizando os serviços nativos da Amazon Alexa, mediante autorização explícita do usuário.
            </p>
            <p>
              Os lembretes são gerenciados integralmente pela plataforma Amazon Alexa, de acordo com as políticas de privacidade da Amazon. A Matuh Queijaria não armazena, acessa ou compartilha dados relacionados aos lembretes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Compartilhamento de dados</h2>
            <p>A Matuh Queijaria não compartilha informações com terceiros.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Armazenamento e segurança</h2>
            <p>
              Os dados operacionais são utilizados exclusivamente para o funcionamento da aplicação e da skill. Medidas técnicas adequadas são adotadas para proteger as informações contra acesso não autorizado.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Exclusão de dados</h2>
            <p>
              Como não há coleta de dados pessoais, não existem dados pessoais a serem excluídos. O usuário pode interromper o uso da skill a qualquer momento desabilitando-a no aplicativo da Alexa.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">Alterações nesta política</h2>
            <p>
              Esta Política de Privacidade pode ser atualizada periodicamente para refletir melhorias na aplicação ou alterações legais.
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
