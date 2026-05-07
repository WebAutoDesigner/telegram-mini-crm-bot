import { notFound } from "next/navigation";
import { CallbackButton } from "@/components/CallbackButton";
import { PriceTable } from "@/components/PriceTable";
import { findService, site } from "@/data/site";
import { publicPath } from "@/lib/publicPath";

export function generateStaticParams() {
  return site.services.map((service) => ({ slug: service.href.replace(/^\/|\/$/g, "") }));
}

export default function ServicePage({ params }: { params: { slug: string } }) {
  const service = findService(params.slug);
  if (!service) notFound();

  const title = service.heroTitle || service.title;
  const hero = service.heroImage || service.image;
  const heroMobile = service.heroImageMobile || service.heroImage || service.imageMobile || service.image;
  const subservices = service.subservices || [];

  return (
    <>
      <section className="service-hero page-pad">
        <div className="shell">
          <a className="back-link" href={publicPath("/vse-uslugi/")}>
            ← Назад
          </a>
          <h1>{title}</h1>
          {hero ? (
            <picture className="service-hero__image">
              <source media="(max-width: 640px)" srcSet={publicPath(heroMobile)} />
              <img src={publicPath(hero)} alt="" />
            </picture>
          ) : null}
          {service.description ? <p>{service.description}</p> : null}
        </div>
      </section>

      {subservices.length ? (
        <section className="subservices">
          <div className="shell">
            {subservices.map((subservice, index) => (
              <article className="subservice subservice--carded" id={subservice.slug} key={`${subservice.slug}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}.</span>
                <h2>{subservice.heading || subservice.title}</h2>
                <SubserviceCard subservice={subservice} />
                {(subservice.contentBlocks || []).map((block, blockIndex) => (
                  <section className="child-block" key={`${block.heading}-${blockIndex}`}>
                    <h3>{block.heading || block.title}</h3>
                    {block.text ? <p>{block.text}</p> : null}
                    <ImageGrid images={block.images || []} />
                    <PriceTable rows={block.priceRows} />
                  </section>
                ))}
                <PriceTable rows={subservice.priceRows} />
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="service-empty">
          <div className="shell service-empty__inner">
            <h2>{service.title}</h2>
            <p>{service.description || "Подробное описание услуги скоро появится на сайте."}</p>
            <CallbackButton>Записаться</CallbackButton>
          </div>
        </section>
      )}

    </>
  );
}

function SubserviceCard({ subservice }: { subservice: { description?: string; images?: Array<{ image?: string; imageMobile?: string }> } }) {
  const image = (subservice.images || []).find((item) => item.image || item.imageMobile);
  if (!image && !subservice.description) return null;

  return (
    <div className="subservice-card">
      {image ? (
        <picture className="subservice-card__image">
          {image.imageMobile && image.imageMobile !== image.image ? <source media="(max-width: 640px)" srcSet={publicPath(image.imageMobile)} /> : null}
          <img src={publicPath(image.image || image.imageMobile)} alt="" loading="lazy" />
        </picture>
      ) : null}
      {subservice.description ? <p className="subservice-card__text">{subservice.description}</p> : null}
    </div>
  );
}

function ImageGrid({ images }: { images: Array<{ image?: string; imageMobile?: string }> }) {
  const visible = images.filter((image) => image.image || image.imageMobile);
  if (!visible.length) return null;

  return (
    <div className="image-grid">
      {visible.map((image, index) => (
        <picture key={`${image.image}-${index}`}>
          {image.imageMobile && image.imageMobile !== image.image ? <source media="(max-width: 640px)" srcSet={publicPath(image.imageMobile)} /> : null}
          <img src={publicPath(image.image || image.imageMobile)} alt="" loading="lazy" />
        </picture>
      ))}
    </div>
  );
}
