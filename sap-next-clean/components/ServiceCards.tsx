import Link from "next/link";
import { servicePath, site } from "@/data/site";

type Props = {
  variant?: "home" | "all";
};

export function ServiceCards({ variant = "home" }: Props) {
  return (
    <section className={`services services--${variant}`}>
      <div className="shell">
        <div className="section-head">
          <h2>{variant === "all" ? "ВСЕ УСЛУГИ ДЕТЕЙЛИНГ-ЦЕНТРА" : site.home.servicesTitle}</h2>
          {variant === "home" ? <p>{site.home.servicesDescription}</p> : null}
        </div>
        <div className="services__grid">
          {site.services.map((service) => (
            <Link
              className="service-card"
              key={service.href}
              href={servicePath(service)}
              style={{ backgroundImage: `linear-gradient(180deg, rgba(0,0,0,.08), rgba(0,0,0,.78)), url("${service.image}")` }}
            >
              <span>{service.title}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
