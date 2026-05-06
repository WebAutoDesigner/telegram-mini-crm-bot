import { ConsultationSection } from "@/components/ConsultationSection";
import { ServiceCards } from "@/components/ServiceCards";

export default function ServicesPage() {
  return (
    <>
      <section className="services-page page-pad">
        <div className="shell">
          <a className="back-link" href="/">
            ← На главную
          </a>
        </div>
        <ServiceCards variant="all" />
      </section>
      <ConsultationSection />
    </>
  );
}
