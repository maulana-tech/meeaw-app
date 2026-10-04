import { Chrome } from "../components/landing/Chrome";
import { Faq } from "../components/landing/Faq";
import { FinalCta } from "../components/landing/FinalCta";
import { Footer } from "../components/landing/Footer";
import { Hero } from "../components/landing/Hero";
import { ProblemStatement } from "../components/landing/ProblemStatement";
import { Solution } from "../components/landing/Solution";
import { Steps } from "../components/landing/Steps";
import { Users } from "../components/landing/Users";

export default function Home() {
  return (
    <Chrome>
      <main id="main-content" className="overflow-x-clip">
        <Hero />
        <ProblemStatement />
        <Solution />
        <Steps />
        <Users />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </Chrome>
  );
}
