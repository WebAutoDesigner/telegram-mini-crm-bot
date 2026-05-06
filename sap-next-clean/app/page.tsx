import { CallbackButton } from "@/components/CallbackButton";
import { ConsultationSection } from "@/components/ConsultationSection";
import { HomePricePreview } from "@/components/HomePricePreview";
import { ServiceCards } from "@/components/ServiceCards";
import { WorksGallery } from "@/components/WorksGallery";
import { site } from "@/data/site";
import { publicPath } from "@/lib/publicPath";

export default function HomePage() {
  const works = site.works.filter((work) => work.image);

  return (
    <>
      <section className="hero">
        <picture>
          <source media="(max-width: 640px)" srcSet={publicPath(site.heroImageMobile)} />
          <img src={publicPath(site.heroImage)} alt="" />
        </picture>
        <div className="shell hero__content">
          <h1 dangerouslySetInnerHTML={{ __html: site.home.heroTitleHtml }} />
          <p>{site.home.heroDescription}</p>
          <CallbackButton className="hero__button">Записаться</CallbackButton>
        </div>
      </section>

      <ServiceCards />
      <HomePricePreview />
      <ConsultationSection />

      <section className="reviews">
        <div className="shell">
          <h2>Отзывы клиентов</h2>
          <div className="reviews__grid">
            {(site.reviews.length
              ? site.reviews
              : [{ name: "Клиент", text: "Отличная работа и внимательное отношение к деталям." }]
            )
              .slice(0, 3)
              .map((review, index) => (
                <article className="review" key={`${review.name}-${index}`}>
                  <b>{review.name}</b>
                  <p>{review.text}</p>
                </article>
              ))}
          </div>
        </div>
      </section>

      <WorksGallery works={works} />

      <section className="map-section">
        <div className="shell">
          <iframe
            className="map-frame"
            title="Карта Самары"
            src="https://yandex.ru/map-widget/v1/?ll=50.100202%2C53.195873&z=11&mode=search&text=%D0%A1%D0%B0%D0%BC%D0%B0%D1%80%D0%B0"
            loading="lazy"
          />
        </div>
      </section>
    </>
  );
}
