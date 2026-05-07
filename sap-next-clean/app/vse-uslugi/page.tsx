import { ConsultationSection } from "@/components/ConsultationSection";
import { ServiceCards } from "@/components/ServiceCards";
import { publicPath } from "@/lib/publicPath";

export default function ServicesPage() {
  return (
    <>
      <section className="services-page page-pad">
        <div className="shell">
          <a className="back-link" href={publicPath("/")}>
            ← На главную
          </a>
        </div>
        <ServiceCards variant="all" />
      </section>
      <ConsultationSection />
    </>
  );
}
