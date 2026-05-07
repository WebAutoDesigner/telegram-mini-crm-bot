import { site } from "@/data/site";
import { publicPath } from "@/lib/publicPath";

export default function ContactPage() {
  return (
    <section className="contact-page page-pad">
      <div className="shell">
        <a className="back-link" href={publicPath("/")}>
          ← На главную
        </a>
        <h1>Контакты</h1>
        <div className="contact-page__grid">
          <div>
            <span>Связаться с нами:</span>
            <a href={site.contacts.phoneHref}>{site.contacts.phoneDisplay}</a>
            <a href={`mailto:${site.contacts.email}`}>{site.contacts.email}</a>
          </div>
          <div>
            <span>Адрес:</span>
            <b>{site.contactBlock.address}</b>
            <p>{site.contactBlock.hours}</p>
          </div>
        </div>
        <iframe
          className="map-frame contact-page__map"
          title="Карта Самары"
          src="https://yandex.ru/map-widget/v1/?ll=50.100202%2C53.195873&z=11&mode=search&text=%D0%A1%D0%B0%D0%BC%D0%B0%D1%80%D0%B0"
          loading="lazy"
        />
      </div>
    </section>
  );
}
